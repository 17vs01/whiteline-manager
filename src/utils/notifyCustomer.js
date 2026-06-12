// =============================================
// notifyCustomer.js — 견적서/계약서 고객앱 알림 발송
// 링크 방식은 그대로 유지 + 앱 알림을 추가로 발송
// =============================================
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { sendPushToCustomer } from './customerPush';

/**
 * 견적서 발송 시 고객앱 알림 + Firestore 알림 저장
 * @param {object} quote      - 견적서 데이터 (id, title, customerCode, custName 등)
 * @param {string} customerId - customers 컬렉션 문서 ID (없으면 코드로 조회)
 */
export async function notifyQuoteSent(quote, customerId) {
  const resolvedId = customerId || await resolveCustomerId(quote.customerCode || quote.quoteCustomerId);
  if (!resolvedId) return { success: false, reason: '고객 ID 없음' };

  const link = `${window.location.origin}/quote-view/${quote.id}`;

  // 1. Firestore 알림 저장 (앱에서 읽음)
  await saveCustomerNotification({
    customerId:   resolvedId,
    customerCode: quote.customerCode || '',
    type:         'quote',
    title:        '📋 새 견적서가 도착했어요',
    body:         `${quote.title || '견적서'}를 확인하고 승인해주세요`,
    link,
    quoteId:      quote.id,
    read:         false,
  });

  // 2. FCM 푸시 (앱 설치된 경우에만 도달)
  const pushResult = await sendPushToCustomer(resolvedId, {
    title: '📋 새 견적서가 도착했어요',
    body:  `${quote.title || '견적서'}를 확인하고 승인해주세요`,
    data:  { type: 'quote', quoteId: quote.id, link },
  });

  return { success: true, push: pushResult };
}

/**
 * 계약서 서명 요청 시 고객앱 알림 + Firestore 알림 저장
 * @param {object} contract   - 계약서 데이터 (id, custName, customerCode 등)
 * @param {string} customerId - customers 컬렉션 문서 ID
 */
export async function notifyContractSent(contract, customerId) {
  const resolvedId = customerId || await resolveCustomerId(contract.customerCode);
  if (!resolvedId) return { success: false, reason: '고객 ID 없음' };

  const link = `${window.location.origin}/contract-sign/${contract.id}`;

  // 1. Firestore 알림 저장
  await saveCustomerNotification({
    customerId:   resolvedId,
    customerCode: contract.customerCode || '',
    type:         'contract',
    title:        '📝 계약서 서명 요청이 왔어요',
    body:         `${contract.custName || ''}님, 계약서를 확인하고 서명해주세요`,
    link,
    contractId:   contract.id,
    read:         false,
  });

  // 2. FCM 푸시
  const pushResult = await sendPushToCustomer(resolvedId, {
    title: '📝 계약서 서명 요청',
    body:  `${contract.custName || ''}님, 계약서를 확인하고 서명해주세요`,
    data:  { type: 'contract', contractId: contract.id, link },
  });

  return { success: true, push: pushResult };
}

// ── Firestore customerNotifications에 알림 저장 ──
async function saveCustomerNotification(data) {
  try {
    await addDoc(collection(db, 'customerNotifications'), {
      ...data,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('고객 알림 저장 오류:', e);
  }
}

// ── customerCode → customerId 조회 ──────────────
async function resolveCustomerId(customerCode) {
  if (!customerCode) return null;
  try {
    const snap = await getDocs(query(
      collection(db, 'customers'),
      where('code', '==', String(customerCode)),
    ));
    if (!snap.empty) return snap.docs[0].id;
  } catch (e) {
    console.error('고객ID 조회 오류:', e);
  }
  return null;
}
