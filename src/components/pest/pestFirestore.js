// =============================================
// Firestore CRUD
//
// customers/{clientId}/areas/           ← 구획 (영구)
// customers/{clientId}/area_traps/      ← 트랩 설치 (영구)
// customers/{clientId}/monthly/{YYYY-MM} ← 월별 점검 데이터
// =============================================
import {
  collection, doc, getDocs, getDoc, addDoc,
  setDoc, updateDoc, deleteDoc,
  query, where, orderBy, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';

// 경로
const areasCol   = (cid) => collection(db, 'customers', cid, 'areas');
const trapsCol   = (cid) => collection(db, 'customers', cid, 'area_traps');
const monthlyDoc = (cid, ym) => doc(db, 'customers', cid, 'monthly_records', ym);
const monthlyCol = (cid) => collection(db, 'customers', cid, 'monthly_records');

// ══════════════════════════════════════════
// 구획 (Areas) — 영구 유지
// ══════════════════════════════════════════
export const getAreas = async (clientId) => {
  const snap = await getDocs(query(areasCol(clientId), orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addArea = async (clientId, data) => {
  const siblings = await getDocs(
    query(areasCol(clientId), where('parentId', '==', data.parentId ?? null))
  );
  const maxOrder = siblings.docs.reduce((m, d) => Math.max(m, d.data().sortOrder ?? 0), 0);
  return await addDoc(areasCol(clientId), {
    ...data, clientId,
    sortOrder: maxOrder + 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateArea = async (clientId, areaId, data) => {
  await updateDoc(doc(areasCol(clientId), areaId), { ...data, updatedAt: serverTimestamp() });
};

export const deleteArea = async (clientId, areaId, allAreas) => {
  const batch = writeBatch(db);
  const toDelete = [];
  const collect = (id) => {
    toDelete.push(id);
    allAreas.filter(a => a.parentId === id).forEach(c => collect(c.id));
  };
  collect(areaId);
  for (const id of toDelete) {
    const trapSnap = await getDocs(query(trapsCol(clientId), where('areaId', '==', id)));
    trapSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(areasCol(clientId), id));
  }
  await batch.commit();
};

// ══════════════════════════════════════════
// 트랩 설치 (AreaTraps) — 영구 유지
// ══════════════════════════════════════════
export const getTrapsByArea = async (clientId, areaId) => {
  const snap = await getDocs(
    query(trapsCol(clientId), where('areaId', '==', areaId), orderBy('number'))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getAllTraps = async (clientId) => {
  const snap = await getDocs(trapsCol(clientId));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const getNextTrapNumber = async (clientId, areaId, trapType, prefix) => {
  const snap = await getDocs(
    query(trapsCol(clientId), where('areaId', '==', areaId), where('type', '==', trapType))
  );
  let max = 0;
  snap.docs.forEach(d => {
    const n = parseInt((d.data().number || '').replace(`${prefix}-`, '')) || 0;
    if (n > max) max = n;
  });
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
};

export const addTrap = async (clientId, data) => {
  return await addDoc(trapsCol(clientId), {
    ...data, clientId, status: 'normal',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
};

export const updateTrap = async (clientId, trapId, data) => {
  await updateDoc(doc(trapsCol(clientId), trapId), { ...data, updatedAt: serverTimestamp() });
};

export const deleteTrap = async (clientId, trapId) => {
  await deleteDoc(doc(trapsCol(clientId), trapId));
};

// ══════════════════════════════════════════
// 월별 점검 데이터 — 매월 새로 입력, 구획/트랩은 영구
// ══════════════════════════════════════════

// 단일 월 조회
export const getMonthlyRecord = async (clientId, yearMonth) => {
  const snap = await getDoc(monthlyDoc(clientId, yearMonth));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

// 여러 월 한번에 조회 (비교 분석용)
export const getMonthlyRecords = async (clientId, yearMonths) => {
  const results = {};
  await Promise.all(yearMonths.map(async ym => {
    const rec = await getMonthlyRecord(clientId, ym);
    if (rec) results[ym] = rec;
  }));
  return results;
};

// 해당 고객의 모든 월별 레코드 목록
export const listMonthlyRecords = async (clientId) => {
  const snap = await getDocs(query(monthlyCol(clientId), orderBy('yearMonth', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 월별 데이터 저장 (merge 방식 — 부분 업데이트 가능)
export const saveMonthlyRecord = async (clientId, yearMonth, data) => {
  const [y, m] = yearMonth.split('-').map(Number);
  await setDoc(monthlyDoc(clientId, yearMonth), {
    ...data,
    yearMonth,
    year: y,
    month: m,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

// 월별 데이터 초기 생성 (없을 때만)
export const initMonthlyRecord = async (clientId, yearMonth, inspectorName = '', companyName = '') => {
  const existing = await getMonthlyRecord(clientId, yearMonth);
  if (existing) return existing;
  const [y, m] = yearMonth.split('-').map(Number);
  const init = {
    yearMonth, year: y, month: m,
    inspectorName,
    companyName,
    isFinalized: false,
    areaScores:   {},   // {areaId: {cleanScore, organizeScore, preventionScore, memos...}}
    trapCatches:  {},   // {trapId: {catches:{}, uvCatches:{}, consumed:false, memo:''}}
    pesticideUsed: [],
    overallComment: '',
    specialNotes: '',
    reportConfig: {
      sections: {
        clientInfo: true, areaResults: true,
        monitoringTraps: true, uvTraps: true, baitStations: true,
        threeMonthTrend: true, yearOverYear: true, annualFlow: true,
        pesticideUse: true, conclusion: true,
      },
      chartTypes: { threeMonthTrend: 'chart', yearOverYear: 'chart', annualFlow: 'chart' },
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(monthlyDoc(clientId, yearMonth), init);
  return { id: yearMonth, ...init };
};

export const deleteMonthlyRecord = async (clientId, yearMonth) => {
  await deleteDoc(monthlyDoc(clientId, yearMonth));
};
