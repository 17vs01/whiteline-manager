// =============================================
// 스케쥴러 Firestore CRUD
// collection: 'scheduleEvents'
// =============================================
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, where, orderBy, writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';

const COL = 'scheduleEvents';

// ── 인덱스 오류 판별 헬퍼 ─────────────────────
// Firebase 인덱스가 아직 생성 안 됐을 때 폴백 처리
function isIndexError(e) {
  return e?.code === 'failed-precondition' || e?.message?.includes('index');
}

// ── 조회 ──────────────────────────────────────

/** 특정 직원의 특정 월 이벤트 조회 */
export async function getScheduleEvents(staffId, yearMonth) {
  try {
    const start = `${yearMonth}-01`;
    const end   = `${yearMonth}-31`;
    const q = query(
      collection(db, COL),
      where('staffId', '==', staffId),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date'),
      orderBy('startTime'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    if (isIndexError(e)) {
      // 인덱스 없을 때: orderBy 없이 재시도 후 JS에서 정렬
      console.warn('⚠️ scheduleEvents 인덱스 없음 - 폴백 모드로 조회');
      try {
        const q2 = query(
          collection(db, COL),
          where('staffId', '==', staffId),
          where('date', '>=', `${yearMonth}-01`),
          where('date', '<=', `${yearMonth}-31`),
        );
        const snap2 = await getDocs(q2);
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.date + (a.startTime||'')).localeCompare(b.date + (b.startTime||'')));
      } catch (e2) {
        console.error('스케쥴 조회 폴백 오류:', e2);
        return [];
      }
    }
    console.error('스케쥴 조회 오류:', e);
    return [];
  }
}

/** 특정 직원에게 공유된 이벤트 조회 */
export async function getSharedEvents(staffId, yearMonth) {
  try {
    const start = `${yearMonth}-01`;
    const end   = `${yearMonth}-31`;
    const q = query(
      collection(db, COL),
      where('sharedWith', 'array-contains', staffId),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date'),
      orderBy('startTime'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    if (isIndexError(e)) {
      console.warn('⚠️ scheduleEvents(sharedWith) 인덱스 없음 - 폴백 모드');
      try {
        const q2 = query(
          collection(db, COL),
          where('sharedWith', 'array-contains', staffId),
        );
        const snap2 = await getDocs(q2);
        const start = `${yearMonth}-01`;
        const end   = `${yearMonth}-31`;
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(ev => ev.date >= start && ev.date <= end)
          .sort((a, b) => (a.date + (a.startTime||'')).localeCompare(b.date + (b.startTime||'')));
      } catch (e2) {
        console.error('공유 이벤트 폴백 오류:', e2);
        return [];
      }
    }
    console.error('공유 이벤트 조회 오류:', e);
    return [];
  }
}

/** 특정 날짜 단일 직원 이벤트 */
export async function getDayEvents(staffId, date) {
  try {
    const q = query(
      collection(db, COL),
      where('staffId', '==', staffId),
      where('date', '==', date),
      orderBy('startTime'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    if (isIndexError(e)) {
      console.warn('⚠️ getDayEvents 인덱스 없음 - 폴백 모드');
      try {
        const q2 = query(
          collection(db, COL),
          where('staffId', '==', staffId),
          where('date', '==', date),
        );
        const snap2 = await getDocs(q2);
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.startTime||'').localeCompare(b.startTime||''));
      } catch (e2) {
        console.error('일간 이벤트 폴백 오류:', e2);
        return [];
      }
    }
    console.error('일간 이벤트 조회 오류:', e);
    return [];
  }
}

/** 관리자용: 특정 월 전 직원 이벤트 */
export async function getAllStaffEvents(yearMonth) {
  try {
    const start = `${yearMonth}-01`;
    const end   = `${yearMonth}-31`;
    const q = query(
      collection(db, COL),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date'),
      orderBy('startTime'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    if (isIndexError(e)) {
      console.warn('⚠️ getAllStaffEvents 인덱스 없음 - 폴백 모드');
      try {
        const start = `${yearMonth}-01`;
        const end   = `${yearMonth}-31`;
        const q2 = query(
          collection(db, COL),
          where('date', '>=', start),
          where('date', '<=', end),
        );
        const snap2 = await getDocs(q2);
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.date + (a.startTime||'')).localeCompare(b.date + (b.startTime||'')));
      } catch (e2) {
        console.error('전체 이벤트 폴백 오류:', e2);
        return [];
      }
    }
    console.error('전체 이벤트 조회 오류:', e);
    return [];
  }
}

/** 특정 직원 휴무 조회 (직원관리용) */
export async function getHolidayEvents(staffId, year) {
  try {
    const q = query(
      collection(db, COL),
      where('staffId', '==', staffId),
      where('type', '==', 'holiday'),
      where('date', '>=', `${year}-01-01`),
      where('date', '<=', `${year}-12-31`),
      orderBy('date'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    if (isIndexError(e)) {
      console.warn('⚠️ getHolidayEvents 인덱스 없음 - 폴백 모드');
      try {
        const q2 = query(
          collection(db, COL),
          where('staffId', '==', staffId),
          where('type', '==', 'holiday'),
        );
        const snap2 = await getDocs(q2);
        return snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(ev => ev.date >= `${year}-01-01` && ev.date <= `${year}-12-31`)
          .sort((a, b) => a.date.localeCompare(b.date));
      } catch (e2) {
        console.error('휴무 폴백 오류:', e2);
        return [];
      }
    }
    console.error('휴무 조회 오류:', e);
    return [];
  }
}

// ── 저장/수정/삭제 ─────────────────────────────

/** 이벤트 저장 (신규) - 공유 포함 */
export async function addScheduleEvent(eventData, staffId, staffName) {
  try {
    const payload = {
      ...eventData,
      staffId,
      staffName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const docRef = await addDoc(collection(db, COL), payload);

    // 반복 이벤트 처리
    if (eventData.repeat && eventData.repeat !== 'none') {
      await createRepeatEvents(docRef.id, payload);
    }

    return docRef.id;
  } catch (e) {
    console.error('스케쥴 저장 오류:', e);
    throw e;
  }
}

/** 이벤트 수정 */
export async function updateScheduleEvent(id, eventData) {
  try {
    await updateDoc(doc(db, COL, id), {
      ...eventData,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('스케쥴 수정 오류:', e);
    throw e;
  }
}

/** 이벤트 삭제 */
export async function deleteScheduleEvent(id) {
  try {
    await deleteDoc(doc(db, COL, id));
  } catch (e) {
    console.error('스케쥴 삭제 오류:', e);
    throw e;
  }
}

/** 반복 이벤트 일괄 삭제 (같은 repeatGroupId) */
export async function deleteRepeatEvents(repeatGroupId) {
  try {
    const q = query(collection(db, COL), where('repeatGroupId', '==', repeatGroupId));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (e) {
    console.error('반복 이벤트 삭제 오류:', e);
    throw e;
  }
}

// ── 반복 이벤트 생성 헬퍼 ─────────────────────

async function createRepeatEvents(originalId, payload) {
  try {
    const { repeat, repeatEndDate, date } = payload;
    if (!repeatEndDate || !date) return;

    const groupId = originalId;
    const batch = writeBatch(db);

    await updateDoc(doc(db, COL, originalId), { repeatGroupId: groupId });

    let current = new Date(date);
    const end    = new Date(repeatEndDate);
    let count    = 0;
    const MAX    = 365;

    while (count < MAX) {
      if (repeat === 'daily')        current.setDate(current.getDate() + 1);
      else if (repeat === 'weekly')  current.setDate(current.getDate() + 7);
      else if (repeat === 'monthly') current.setMonth(current.getMonth() + 1);

      if (current > end) break;

      const nextDate = current.toISOString().split('T')[0];
      const newRef   = doc(collection(db, COL));
      batch.set(newRef, {
        ...payload,
        date: nextDate,
        repeatGroupId: groupId,
        isRepeatChild: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      count++;
    }

    await batch.commit();
  } catch (e) {
    console.error('반복 이벤트 생성 오류:', e);
  }
}

// ── 고객현황 CRUD ─────────────────────────────

export async function saveCustomerStatus(customerId, statusData, updatedByName) {
  try {
    await updateDoc(doc(db, 'customers', customerId), {
      customerStatus: {
        ...statusData,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedByName,
      },
    });
  } catch (e) {
    console.error('고객현황 저장 오류:', e);
    throw e;
  }
}

// ── FCM 알림 등록 헬퍼 ────────────────────────

export async function saveAlarmRecord(eventId, staffId, alarmAt, title) {
  try {
    await addDoc(collection(db, 'scheduleAlarms'), {
      eventId,
      staffId,
      alarmAt,
      title,
      sent: false,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('알람 저장 오류:', e);
  }
}
