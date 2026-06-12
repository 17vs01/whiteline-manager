// =============================================
// 구획/모니터링 상수
// =============================================

// 구획 레벨
export const AREA_LEVELS = [
  { value: 'building',  label: '건물',  icon: '🏗️' },
  { value: 'category',  label: '분류',  icon: '📁' },
  { value: 'floor',     label: '층',    icon: '📐' },
  { value: 'location',  label: '장소',  icon: '📍' },
];

// 구획 타입
export const AREA_TYPES = [
  { value: 'general',   label: '일반',     icon: '📁', color: '#6b7280' },
  { value: 'office',    label: '사무실',   icon: '💼', color: '#3b82f6' },
  { value: 'restroom',  label: '화장실',   icon: '🚻', color: '#0891b2' },
  { value: 'rest',      label: '휴게실',   icon: '🛋️', color: '#f97316' },
  { value: 'facility',  label: '부대시설', icon: '🔧', color: '#92400e' },
  { value: 'common',    label: '공용',     icon: '🚶', color: '#16a34a' },
  { value: 'storage',   label: '창고',     icon: '📦', color: '#475569' },
  { value: 'kitchen',   label: '주방',     icon: '🍳', color: '#dc2626' },
  { value: 'hall',      label: '홀/강당',  icon: '🏛️', color: '#7c3aed' },
];

// 트랩 종류
export const TRAP_TYPES = [
  { value: 'monitoringTrap',  label: '모니터링트랩',  prefix: 'MT', icon: '📋', category: 'monitoring' },
  { value: 'mouseGlue',       label: '쥐끈끈이',      prefix: 'MG', icon: '🐭', category: 'monitoring' },
  { value: 'flyRibbon',       label: '파리끈끈이',    prefix: 'FR', icon: '🪰', category: 'monitoring' },
  { value: 'uvLight',         label: 'UV포충등',       prefix: 'UV', icon: '💡', category: 'uv' },
  { value: 'baitStation',     label: '베이트스테이션', prefix: 'BT', icon: '🧲', category: 'bait' },
  { value: 'roachHouse',      label: '바퀴하우스',    prefix: 'RH', icon: '🪳', category: 'bait' },
  { value: 'mouseSnap',       label: '쥐덫',           prefix: 'MS', icon: '🪤', category: 'monitoring' },
  { value: 'indianMealMoth',  label: '화랑곡나방트랩', prefix: 'IM', icon: '🦋', category: 'monitoring' },
  { value: 'cigaretteBeetle', label: '권연벌레트랩',   prefix: 'CB', icon: '🐛', category: 'monitoring' },
  { value: 'silverfish',      label: '좀벌레트랩',    prefix: 'SF', icon: '🪲', category: 'monitoring' },
  { value: 'other',           label: '기타',           prefix: 'OT', icon: '📌', category: 'monitoring' },
];

// 트랩 카테고리
export const TRAP_CATEGORY = {
  monitoring: ['monitoringTrap', 'mouseGlue', 'mouseSnap', 'indianMealMoth', 'cigaretteBeetle', 'silverfish', 'other'],
  uv: ['uvLight', 'flyRibbon'],
  bait: ['baitStation', 'roachHouse'],
};

// 트랩 상태
export const TRAP_STATUS = {
  normal:    { label: '정상',     color: '#22c55e', bg: '#dcfce7' },
  needCheck: { label: '점검필요', color: '#f59e0b', bg: '#fef3c7' },
  replaced:  { label: '교체완료', color: '#3b82f6', bg: '#dbeafe' },
  damaged:   { label: '파손',     color: '#ef4444', bg: '#fee2e2' },
};

// 신호등 점수
export const TRAFFIC_SCORE = {
  green:  { value: 1, label: '양호', emoji: '🟢', color: '#22c55e', bg: '#dcfce7' },
  yellow: { value: 3, label: '주의', emoji: '🟡', color: '#f59e0b', bg: '#fef3c7' },
  red:    { value: 5, label: '위험', emoji: '🔴', color: '#ef4444', bg: '#fee2e2' },
};

export const SCORE_ITEMS = [
  { key: 'cleanScore',      label: '청소상태' },
  { key: 'organizeScore',   label: '정리정돈' },
  { key: 'preventionScore', label: '방충시설' },
];

// 일반 해충 (모니터링트랩용)
export const PEST_TYPES = [
  { value: 'cockroach', label: '바퀴벌레', weight: 5, icon: '🪳' },
  { value: 'mouse',     label: '쥐(소)',   weight: 5, icon: '🐭' },
  { value: 'rat',       label: '쥐(대)',   weight: 5, icon: '🐀' },
  { value: 'ant',       label: '개미',     weight: 1, icon: '🐜' },
  { value: 'other',     label: '기타',     weight: 1, icon: '🐛' },
];

// 날벌레 (UV 포충등용) — 8종
export const UV_INSECTS = [
  { value: 'fly',       label: '파리',         icon: '🪰' },
  { value: 'mosquito',  label: '모기',         icon: '🦟' },
  { value: 'mothFly',   label: '나방파리',     icon: '🦋' },
  { value: 'moth',      label: '나방',         icon: '🦋' },
  { value: 'mayfly',    label: '하루살이',     icon: '🦗' },
  { value: 'midge',     label: '깔따구',       icon: '🦗' },
  { value: 'fruitFly',  label: '초파리',       icon: '🪰' },
  { value: 'otherFly',  label: '기타(날파리)', icon: '🐛' },
];

// flyRibbon용 해충
export const FLY_INSECTS = [
  { value: 'fly',      label: '파리',   icon: '🪰' },
  { value: 'mosquito', label: '모기',   icon: '🦟' },
  { value: 'otherFly', label: '기타',   icon: '🐛' },
];

// 베이트/바퀴하우스용
export const BAIT_PESTS = [
  { value: 'cockroach', label: '바퀴벌레', icon: '🪳' },
  { value: 'mouse',     label: '쥐',       icon: '🐭' },
];

// 트랩 타입에 따라 표시할 해충 목록
export const getPestListByTrapType = (trapType) => {
  if (TRAP_CATEGORY.uv.includes(trapType)) {
    return trapType === 'flyRibbon' ? FLY_INSECTS : UV_INSECTS;
  }
  if (TRAP_CATEGORY.bait.includes(trapType)) return BAIT_PESTS;
  return PEST_TYPES;
};

// 헬퍼
export const getAreaTypeInfo  = (v) => AREA_TYPES.find(t => t.value === v) || AREA_TYPES[0];
export const getAreaLevelInfo = (v) => AREA_LEVELS.find(l => l.value === v) || AREA_LEVELS[3];
export const getTrapTypeInfo  = (v) => TRAP_TYPES.find(t => t.value === v) || TRAP_TYPES[TRAP_TYPES.length - 1];
export const getPestLabel     = (v) => {
  return [...PEST_TYPES, ...UV_INSECTS, ...FLY_INSECTS].find(p => p.value === v)?.label || v;
};

export const scoreToKey = (val) => val <= 1 ? 'green' : val <= 3 ? 'yellow' : 'red';
export const avgToGrade = (avg) => avg <= 1.5 ? 'green' : avg <= 3.0 ? 'yellow' : 'red';

// 월 표시 (2025-02 → 2025년 2월)
export const formatYearMonth = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${y}년 ${parseInt(m)}월`;
};

// n개월 전 yearMonth 계산
export const getRelativeMonth = (yearMonth, delta) => {
  const [y, m] = yearMonth.split('-').map(Number);
  let month = m + delta;
  let year  = y;
  while (month <= 0)  { month += 12; year--; }
  while (month > 12)  { month -= 12; year++; }
  return `${year}-${String(month).padStart(2, '0')}`;
};

// 비교에 필요한 yearMonth 목록 계산
export const getComparisonMonths = (currentYM) => {
  const set = new Set();
  // 최근 6개월
  for (let i = 5; i >= 0; i--) set.add(getRelativeMonth(currentYM, -i));
  // 작년 동월
  set.add(getRelativeMonth(currentYM, -12));
  return [...set].sort();
};

// 월별 레코드에서 전체 포획수 합산
export const sumTotalCatches = (monthlyRecord) => {
  if (!monthlyRecord?.trapCatches) return 0;
  let total = 0;
  Object.values(monthlyRecord.trapCatches).forEach(tc => {
    Object.values(tc?.catches || {}).forEach(c => { total += (c || 0); });
    Object.values(tc?.uvCatches || {}).forEach(c => { total += (c || 0); });
  });
  return total;
};
