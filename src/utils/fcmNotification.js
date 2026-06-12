// =============================================
// FCM 푸시 알림 완전 활성화
// VAPID 키: BMIXShmTRl7ERRl36ZJJH24WAgeTqKyf4NOEnVzez64kdRU8xOgFICXcT1HQbuPvjeL87Dm8Sdc3a27Z8MHKnms
// =============================================
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { initializeApp, getApps }            from 'firebase/app';
import { doc, setDoc, addDoc, collection }   from 'firebase/firestore';
import { db, firebaseConfig }               from '../firebase';

// VAPID 키 (Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서)
const VAPID_KEY = 'BMIXShmTRl7ERRl36ZJJH24WAgeTqKyf4NOEnVzez64kdRU8xOgFICXcT1HQbuPvjeL87Dm8Sdc3a27Z8MHKnms';

let _messaging = null;

function getMsg() {
  try {
    if (_messaging) return _messaging;
    // 서비스워커 환경(SW)에서는 getMessaging 사용 불가
    if (typeof window === 'undefined') return null;
    const app = getApps()[0];
    if (!app) return null;
    _messaging = getMessaging(app);
    return _messaging;
  } catch (e) {
    console.warn('FCM 초기화 실패:', e.message);
    return null;
  }
}

// ── 1. 권한 요청 + FCM 토큰 등록 ──────────────────────

/**
 * 푸시 알림 권한 요청 후 FCM 토큰을 Firestore staff 문서에 저장
 * @param {string} staffDocId  - staff 컬렉션의 문서 ID
 * @returns {string|null}      - FCM 토큰 또는 null
 */
export async function requestNotificationPermission(staffDocId) {
  try {
    if (!('Notification' in window)) {
      console.warn('이 브라우저는 알림을 지원하지 않습니다.');
      return null;
    }

    // 서비스워커 등록 확인 (FCM은 SW 필요)
    if (!('serviceWorker' in navigator)) {
      console.warn('서비스워커 미지원 브라우저');
      return null;
    }

    // firebase-messaging-sw.js 서비스워커 등록
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('알림 권한 거부됨');
      return null;
    }

    const messaging = getMsg();
    if (!messaging) return null;

    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) {
      console.warn('FCM 토큰 발급 실패');
      return null;
    }

    // Firestore staff 문서에 토큰 저장
    if (staffDocId) {
      await setDoc(doc(db, 'staff', staffDocId), { fcmToken: token }, { merge: true });
    }
    console.log('✅ FCM 토큰 등록 완료');
    return token;

  } catch (e) {
    console.error('FCM 토큰 등록 오류:', e);
    return null;
  }
}

// ── 2. 포그라운드 메시지 수신 ──────────────────────────

/**
 * 앱이 열려 있을 때 푸시 메시지 수신 핸들러
 * @param {Function} callback - (payload) => void
 * @returns {Function} unsubscribe
 */
export function onForegroundMessage(callback) {
  try {
    const messaging = getMsg();
    if (!messaging) return () => {};
    return onMessage(messaging, callback);
  } catch (e) {
    console.warn('FCM 포그라운드 핸들러 오류:', e);
    return () => {};
  }
}

// ── 3. 알림 스케쥴 Firestore 저장 ─────────────────────

/**
 * 알림 발송 예약 저장 (Firebase Functions에서 트리거)
 */
export async function scheduleNotification({ staffId, eventId, title, body, alarmAt }) {
  try {
    await addDoc(collection(db, 'scheduleAlarms'), {
      staffId,
      eventId,
      title,
      body,
      alarmAt,
      sent: false,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('알림 스케쥴 저장 오류:', e);
  }
}

// ── 4. 오늘 일정 브라우저 타이머 알림 ────────────────

/**
 * 앱이 열려 있는 동안 타이머 기반 알림 (포그라운드용)
 * @param {Array}    events   - 스케쥴 이벤트 배열
 * @param {Function} onClick  - 알림 클릭 콜백
 */
export function checkTodayAlarms(events, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now   = new Date();
  const today = now.toISOString().split('T')[0];

  events
    .filter(e => e.date === today && !e.allDay && e.alarm && e.alarm > 0)
    .forEach(ev => {
      const [h, m]  = (ev.startTime || '09:00').split(':').map(Number);
      const evTime  = new Date(now);
      evTime.setHours(h, m, 0, 0);
      const alarmAt = new Date(evTime.getTime() - ev.alarm * 60 * 1000);
      const diff    = alarmAt.getTime() - now.getTime();

      if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
        setTimeout(() => {
          const n = new Notification(`⏰ ${ev.alarm}분 후 일정`, {
            body:  `${ev.startTime} ${ev.title || '약속'}`,
            icon:  '/logo192.png',
            badge: '/logo192.png',
            tag:   `schedule-${ev.id}`,
          });
          if (onClick) n.onclick = () => onClick(ev);
        }, diff);
      }
    });
}

// ── 5. 브라우저 로컬 알림 직접 표시 ──────────────────

export function showLocalNotification(title, body, onClick) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon:  '/logo192.png',
    badge: '/logo192.png',
    tag:   'schedule-alarm',
  });
  if (onClick) n.onclick = onClick;
}
