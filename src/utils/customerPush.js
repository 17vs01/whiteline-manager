// =============================================
// 고객 푸시 알림 발송 유틸
// Firestore customerUsers 컬렉션의 FCM 토큰으로 발송
// [FIX-B2] sendFCM 내 동적 import 제거 → 정적 import 사용
// [ADD-I4] FCM 토큰 만료(실패) 시 자동 삭제 처리
// =============================================
import {
  collection, getDocs, query, where,
  doc, setDoc, deleteField, addDoc,   // [FIX-B2] 정적 import
} from 'firebase/firestore';
import { db } from '../firebase';

// ── 단일 고객에게 푸시 발송 ──────────────────────
export async function sendPushToCustomer(customerId, { title, body, data = {} }) {
  try {
    const snap = await getDocs(query(
      collection(db, 'customerUsers'),
      where('customerId', '==', customerId),
    ));
    if (snap.empty) return { success: false, reason: '고객 앱 미등록' };

    const userDoc  = snap.docs[0];
    const userData = userDoc.data();
    const token    = userData.fcmToken;
    if (!token) return { success: false, reason: '토큰 없음' };

    // 알림 설정 체크
    const notifSettings = userData.notificationSettings || {};
    const notifType     = data.type;
    if (notifType === 'reply'  && notifSettings.reply  === false) return { success: false, reason: '알림 OFF' };
    if (notifType === 'visit'  && notifSettings.visit  === false) return { success: false, reason: '알림 OFF' };
    if (notifType === 'notice' && notifSettings.notice === false) return { success: false, reason: '알림 OFF' };

    const result = await sendFCM(token, title, body, data);

    // [ADD-I4] 토큰 만료 감지 → Firestore에서 토큰 제거
    if (result?.tokenExpired) {
      try {
        await setDoc(userDoc.ref, { fcmToken: deleteField() }, { merge: true });
        console.log(`[FCM] 만료 토큰 삭제 완료: customerId=${customerId}`);
      } catch (e) {
        console.warn('[FCM] 만료 토큰 삭제 실패:', e);
      }
      return { success: false, reason: '토큰 만료 (자동 삭제됨)' };
    }

    return { success: true };
  } catch (e) {
    console.error('고객 푸시 발송 오류:', e);
    return { success: false, reason: e.message };
  }
}

// ── 전체 고객에게 푸시 발송 (공지사항 등) ────────
export async function sendPushToAllCustomers({ title, body, data = {} }) {
  try {
    const snap = await getDocs(collection(db, 'customerUsers'));
    if (snap.empty) return { sent: 0 };

    let sent = 0;
    const expiredRefs = [];

    const promises = snap.docs.map(async d => {
      const userData = d.data();
      const token    = userData.fcmToken;
      if (!token) return;

      const notifSettings = userData.notificationSettings || {};
      if (notifSettings.notice === false) return;

      const result = await sendFCM(token, title, body, data);

      // [ADD-I4] 만료 토큰 수집
      if (result?.tokenExpired) {
        expiredRefs.push(d.ref);
        return;
      }
      sent++;
    });

    await Promise.allSettled(promises);

    // [ADD-I4] 만료 토큰 일괄 삭제
    if (expiredRefs.length > 0) {
      await Promise.allSettled(
        expiredRefs.map(ref => setDoc(ref, { fcmToken: deleteField() }, { merge: true }))
      );
      console.log(`[FCM] 만료 토큰 ${expiredRefs.length}개 삭제`);
    }

    return { sent };
  } catch (e) {
    console.error('전체 고객 푸시 오류:', e);
    return { sent: 0 };
  }
}

// ── 방문 전날 알림 (배정플랜 기준) ───────────────
export async function sendVisitReminderPush(event) {
  try {
    if (!event.customerCode) return;

    const custSnap = await getDocs(query(
      collection(db, 'customers'),
      where('code', '==', event.customerCode),
    ));
    if (custSnap.empty) return;

    const customerId   = custSnap.docs[0].id;
    const customerName = custSnap.docs[0].data().name || '';

    await sendPushToCustomer(customerId, {
      title: '📅 내일 방역 방문 예정',
      body:  `${customerName} 고객님, 내일 방역 방문이 예정되어 있어요.${event.staffName ? ` 담당: ${event.staffName}` : ''}`,
      data:  { type: 'visit', eventId: event.id },
    });
  } catch (e) {
    console.error('방문 알림 발송 오류:', e);
  }
}

// ── FCM 큐 저장 (Functions에서 실제 발송) ─────────
// [FIX-B2] 동적 import 제거 → 상단 정적 import의 addDoc/collection 사용
async function sendFCM(token, title, body, data = {}) {
  try {
    await addDoc(collection(db, 'fcmQueue'), {
      token,
      title,
      body,
      data,
      createdAt: new Date().toISOString(),
      sent: false,
    });
    return { success: true };
  } catch (e) {
    console.error('FCM 큐 저장 오류:', e);
    // 토큰 만료/유효하지 않음 감지
    const msg = e.message || '';
    if (
      msg.includes('registration-token-not-registered') ||
      msg.includes('invalid-registration-token') ||
      msg.includes('Requested entity was not found')
    ) {
      return { tokenExpired: true };
    }
    throw e;
  }
}

export default { sendPushToCustomer, sendPushToAllCustomers, sendVisitReminderPush };
