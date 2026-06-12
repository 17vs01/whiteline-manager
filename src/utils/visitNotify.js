// =============================================
// visitNotify.js — 방문확정 알림 발송
// CalendarPage에서 방문확정 버튼 클릭 시 호출
// =============================================
import { collection, addDoc, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { sendPushToCustomer } from './customerPush';

/**
 * 단일 이벤트 방문확정 알림
 * @param {object} event      - events 컬렉션 문서 데이터 (extendedProps 포함)
 * @param {Array}  customers  - 고객 목록 (캐시)
 */
export async function confirmVisitAndNotify(event, customers) {
  const props      = event.extendedProps || event;
  const custCode   = props.customerCode;
  const date       = event.start || props.date || '';
  const staffName  = props.staffName || '';
  const isClaimVisit = !!props.isClaimVisit;

  if (!custCode || !date) return { success: false, reason: '정보 부족' };

  // 고객 찾기
  const customer = customers.find(c => c.id === custCode || c.code === custCode);
  if (!customer) return { success: false, reason: '고객 없음' };

  const customerId   = customer.id;
  const customerName = customer.name || '';

  const title = isClaimVisit
    ? '🔧 추가 방문 일정이 확정됐어요'
    : '📅 방문 일정이 확정됐어요';
  const body  = isClaimVisit
    ? `${customerName}님, 클레임 처리를 위한 추가 방문이 ${date}에 예정됐어요.${staffName ? ` 담당: ${staffName}` : ''}`
    : `${customerName}님, ${date} 방역 방문 일정이 확정됐어요.${staffName ? ` 담당: ${staffName}` : ''}`;

  try {
    // 1. events 문서에 visitConfirmed 플래그
    await updateDoc(doc(db, 'events', event.id), {
      visitConfirmed:   true,
      visitConfirmedAt: new Date().toISOString(),
    });

    // 2. customerNotifications 저장
    await addDoc(collection(db, 'customerNotifications'), {
      customerId,
      customerCode: customer.code || '',
      type:    isClaimVisit ? 'claim_visit' : 'visit_confirmed',
      title,
      body,
      date,
      eventId: event.id,
      read:    false,
      createdAt: new Date().toISOString(),
    });

    // 3. FCM 푸시 (앱 설치된 경우)
    const pushResult = await sendPushToCustomer(customerId, {
      title, body,
      data: { type: isClaimVisit ? 'claim_visit' : 'visit_confirmed', date, eventId: event.id },
    });

    return { success: true, push: pushResult, customerName };
  } catch (e) {
    console.error('방문확정 알림 오류:', e);
    return { success: false, reason: e.message };
  }
}

/**
 * 특정 날짜의 모든 배정 이벤트 방문확정
 * @param {string} dateStr    - 'YYYY-MM-DD'
 * @param {Array}  events     - 해당 날짜 이벤트 목록
 * @param {Array}  customers  - 고객 목록 (캐시)
 * @returns {{ confirmed: number, failed: number, names: string[] }}
 */
export async function confirmAllVisitsForDate(dateStr, events, customers) {
  // 해당 날짜의 배정 상태 이벤트만 (공동작업 제외)
  const targets = events.filter(e => {
    const eDate = e.start || e.extendedProps?.date || '';
    const status = e.extendedProps?.status || e.status;
    return eDate.startsWith(dateStr) && status === '배정' && !e.extendedProps?.isCoWork && !e.extendedProps?.visitConfirmed;
  });

  if (targets.length === 0) return { confirmed: 0, failed: 0, names: [] };

  let confirmed = 0, failed = 0;
  const names = [];

  for (const event of targets) {
    const result = await confirmVisitAndNotify(event, customers);
    if (result.success) {
      confirmed++;
      if (result.customerName) names.push(result.customerName);
    } else {
      failed++;
    }
  }

  return { confirmed, failed, names };
}
