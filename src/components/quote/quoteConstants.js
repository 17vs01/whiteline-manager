// =============================================
// 방역 견적서 - 업종별 단가 및 상수 정의
// =============================================

// 업종 목록
export const BUSINESS_TYPES = [
  { value: 'apartment', label: '아파트/빌라', icon: '🏢' },
  { value: 'house', label: '단독주택/다가구', icon: '🏠' },
  { value: 'officetel', label: '오피스텔/원룸', icon: '🏨' },
  { value: 'restaurant', label: '음식점/식당', icon: '🍽️' },
  { value: 'cafe', label: '카페/베이커리', icon: '☕' },
  { value: 'mart', label: '마트/편의점', icon: '🛒' },
  { value: 'office', label: '사무실/업무시설', icon: '💼' },
  { value: 'hotel', label: '호텔/숙박시설', icon: '🏩' },
  { value: 'school', label: '학교/교육시설', icon: '🎓' },
  { value: 'hospital', label: '병원/의료시설', icon: '🏥' },
  { value: 'factory', label: '공장/창고', icon: '🏭' },
  { value: 'public', label: '공공기관/관공서', icon: '🏛️' },
  { value: 'welfare', label: '복지시설/요양원', icon: '♿' },
  { value: 'multiUnit', label: '다세대/연립주택', icon: '🏘️' },
  { value: 'other', label: '기타', icon: '📋' },
];

// 서비스 항목
export const SERVICE_ITEMS = [
  { value: 'general', label: '일반방제 (해충통합관리)', icon: '🪳', desc: '바퀴벌레, 개미, 파리 등 보행해충 방제' },
  { value: 'rodent', label: '구서방제 (쥐)', icon: '🐀', desc: '쥐 유입 차단 및 포획, 구서함 설치/관리' },
  { value: 'mosquito', label: '모기/날벌레 방제', icon: '🦟', desc: '모기, 날파리 등 비행해충 방제' },
  { value: 'disinfection', label: '살균소독', icon: '🧴', desc: '표면 살균 및 바이러스 소독' },
  { value: 'termite', label: '흰개미 방제', icon: '🐜', desc: '흰개미 진단 및 방제' },
  { value: 'bedbug', label: '빈대 방제', icon: '🛏️', desc: '빈대 정밀 진단 및 집중 방제' },
  { value: 'wasp', label: '벌집 제거', icon: '🐝', desc: '말벌, 땅벌 등 벌집 제거' },
  { value: 'blocking', label: '해충 유입 차단', icon: '🚫', desc: '침입경로 봉쇄 및 차단 시공' },
];

// 업종별 기본 단가표 (방역서비스_통합단가표.docx 기반)
export const DEFAULT_PRICE_TABLE = {
  // 일반 가정 (아파트/빌라/오피스텔/단독주택)
  residential: {
    label: '일반 가정',
    byArea: [
      { maxArea: 10, label: '10평 이하', visitPrice: 40000, initialPrice: 70000, desc: '원룸/오피스텔' },
      { maxArea: 20, label: '10~20평', visitPrice: 45000, initialPrice: 80000, desc: '소형 아파트' },
      { maxArea: 30, label: '20~30평', visitPrice: 50000, initialPrice: 90000, desc: '중형 아파트' },
      { maxArea: 50, label: '30~50평', visitPrice: 60000, initialPrice: 110000, desc: '대형 아파트' },
      { maxArea: 9999, label: '50평 초과', visitPrice: 0, initialPrice: 0, desc: '별도 협의' },
    ]
  },
  // 음식점/상가/사무실
  commercial: {
    label: '음식점/상가/사무실',
    byArea: [
      { maxArea: 10, label: '소규모 (10평 이하)', visitPrice: 35000, initialPrice: 60000, monthlyPrice: 35000, desc: '' },
      { maxArea: 30, label: '30평', visitPrice: 50000, initialPrice: 80000, monthlyPrice: 50000, desc: '' },
      { maxArea: 50, label: '50평', visitPrice: 80000, initialPrice: 160000, monthlyPrice: 80000, desc: '' },
      { maxArea: 70, label: '70평', visitPrice: 60000, initialPrice: 100000, monthlyPrice: 60000, desc: '' },
      { maxArea: 100, label: '100평', visitPrice: 100000, initialPrice: 200000, monthlyPrice: 100000, desc: '' },
      { maxArea: 150, label: '150평', visitPrice: 90000, initialPrice: 180000, monthlyPrice: 90000, desc: '' },
      { maxArea: 9999, label: '200평 이상', visitPrice: 0, initialPrice: 0, monthlyPrice: 0, desc: '별도 협의' },
    ]
  },
  // 살균소독
  disinfection: {
    label: '살균소독',
    byArea: [
      { maxArea: 30, label: '소규모 (30평 이하)', visitPrice: 200000, desc: '원룸/사무실' },
      { maxArea: 50, label: '50평', visitPrice: 250000, desc: '소형 매장' },
      { maxArea: 70, label: '70평', visitPrice: 350000, desc: '중형 매장' },
      { maxArea: 100, label: '100평', visitPrice: 500000, desc: '대형 매장/창고' },
      { maxArea: 150, label: '150평', visitPrice: 600000, desc: '추가인원 포함' },
      { maxArea: 9999, label: '200평 이상', visitPrice: 0, desc: '별도 협의' },
    ]
  },
  // 해충 유입 차단
  blocking: {
    label: '해충 유입 차단',
    method: '기본 2회 방문 (설치 → 추가설치, 침입구 막기)',
    basePrice: 100000,
    extraPer30: 50000,
    desc: '30평 초과 시 50,000원씩 추가'
  },
  // 빈대 방제
  bedbug: {
    label: '침대빈대 방제',
    byTime: [
      { label: '1시간 이내', price: 200000 },
      { label: '1시간~2시간', price: 300000 },
      { label: '2시간 초과', price: 0, desc: '별도 협의' },
    ]
  },
  // 다세대/빌라 (호실 기반)
  multiUnit: {
    label: '다세대/빌라 (세대수 기반)',
    minUnits: 10,
    pricePerUnit: { min: 20000, max: 30000 },
    minMonths: 2,
    example: '10세대 × 2개월 = 600,000원~'
  }
};

// 업종 → 단가표 카테고리 매핑
export const BUSINESS_TO_PRICE_CATEGORY = {
  apartment: 'residential',
  house: 'residential',
  officetel: 'residential',
  restaurant: 'commercial',
  cafe: 'commercial',
  mart: 'commercial',
  office: 'commercial',
  hotel: 'commercial',
  school: 'commercial',
  hospital: 'commercial',
  factory: 'commercial',
  public: 'commercial',
  welfare: 'commercial',
  multiUnit: 'multiUnit',
  other: 'commercial',
};

// 호실 기반 업종 (호실 수 입력 필요)
export const UNIT_BASED_TYPES = ['apartment', 'hotel', 'multiUnit', 'officetel'];

// 견적 상태
export const QUOTE_STATUS = {
  draft: { label: '작성중', color: '#f59e0b', bg: '#fef3c7' },
  sent: { label: '발송완료', color: '#3b82f6', bg: '#eff6ff' },
  confirmed: { label: '계약전환', color: '#10b981', bg: '#d1fae5' },
  rejected: { label: '거절', color: '#ef4444', bg: '#fee2e2' },
};

// 견적고객 상태
export const QUOTE_CUSTOMER_STATUS = {
  pending: { label: '견적중', color: '#f59e0b', bg: '#fef3c7' },
  sent: { label: '발송완료', color: '#3b82f6', bg: '#eff6ff' },
  contracted: { label: '계약전환', color: '#10b981', bg: '#d1fae5' },
  cancelled: { label: '해약(재견적)', color: '#ef4444', bg: '#fee2e2' },
};

// 비교 견적 레이블
export const COMPARE_LABELS = ['A', 'B', 'C', 'D', 'E'];

// 초기비용 기본 설정
export const INITIAL_COST_DEFAULTS = {
  months: 2,         // 초기 기간 (기본 2개월)
  extraRate: 0.4,    // 월 단가 대비 추가 비율 (40%)
  minVisitsPerMonth: 2, // 초기 최소 작업횟수
};

// 사용 약제 기본 목록
export const DEFAULT_CHEMICALS = {
  general: ['팡팡유제(종합살충)', '잡스올킬스마트(종합살충)', '레젼드겔(바퀴벌레)', '해충모니터링트랩'],
  rodent: ['스톰', '라쿠민TP', '라쿠민페이스트', '쥐끈끈이'],
  mosquito: ['잡스네츄라지과립(모기)', '팡팡유제'],
  disinfection: ['잡스그린퓨어액', '쿼트플러스알파액'],
};

// 평수 → 단가 자동계산 헬퍼
export const getPriceByArea = (category, area) => {
  const table = DEFAULT_PRICE_TABLE[category];
  if (!table || !table.byArea) return null;
  for (const row of table.byArea) {
    if (area <= row.maxArea) return row;
  }
  return table.byArea[table.byArea.length - 1];
};

// 금액 포맷 (1000 → 1,000원)
export const formatPrice = (price) => {
  if (!price || price === 0) return '0원';
  return price.toLocaleString() + '원';
};

// 금액 한글 변환 (200000 → 이십만원)
export const priceToKorean = (price) => {
  if (!price || price === 0) return '영원';
  const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const bigUnits = ['', '만', '억', '조'];
  let result = '';
  let num = price;
  let bigIdx = 0;

  while (num > 0) {
    const chunk = num % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      const thousands = Math.floor(chunk / 1000);
      const hundreds = Math.floor((chunk % 1000) / 100);
      const tens = Math.floor((chunk % 100) / 10);
      const ones = chunk % 10;
      if (thousands > 0) chunkStr += (thousands === 1 ? '' : units[thousands]) + '천';
      if (hundreds > 0) chunkStr += (hundreds === 1 ? '' : units[hundreds]) + '백';
      if (tens > 0) chunkStr += (tens === 1 ? '' : units[tens]) + '십';
      if (ones > 0) chunkStr += units[ones];
      result = chunkStr + bigUnits[bigIdx] + result;
    }
    num = Math.floor(num / 10000);
    bigIdx++;
  }
  return result + '원정';
};

// =============================================
// 업종별 기본 구획(Zone) 정의
// =============================================
export const BUSINESS_ZONES = {
  hotel: [
    { key: 'room',       label: '객실',       countable: true,  defaultCount: 0, icon: '🛏️' },
    { key: 'lobby',      label: '로비',       countable: false, defaultCount: 1, icon: '🪑' },
    { key: 'kitchen',    label: '주방',       countable: false, defaultCount: 1, icon: '🍳' },
    { key: 'restaurant', label: '레스토랑',   countable: false, defaultCount: 1, icon: '🍽️' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 1, icon: '📦' },
    { key: 'laundry',    label: '세탁실',     countable: false, defaultCount: 1, icon: '👕' },
    { key: 'pool',       label: '수영장',     countable: false, defaultCount: 0, icon: '🏊' },
    { key: 'parking',    label: '주차장',     countable: false, defaultCount: 0, icon: '🚗' },
  ],
  hospital: [
    { key: 'clinic',     label: '진료실',     countable: true,  defaultCount: 0, icon: '🩺' },
    { key: 'testroom',   label: '검사실',     countable: true,  defaultCount: 0, icon: '🔬' },
    { key: 'ward',       label: '입원실',     countable: true,  defaultCount: 0, icon: '🛏️' },
    { key: 'reception',  label: '원무과',     countable: false, defaultCount: 1, icon: '🏥' },
    { key: 'pharmacy',   label: '약국',       countable: false, defaultCount: 1, icon: '💊' },
    { key: 'kitchen',    label: '급식실/주방', countable: false, defaultCount: 1, icon: '🍳' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 1, icon: '📦' },
    { key: 'corridor',   label: '복도/공용',  countable: false, defaultCount: 1, icon: '🚶' },
  ],
  school: [
    { key: 'classroom',  label: '교실',       countable: true,  defaultCount: 0, icon: '📚' },
    { key: 'cafeteria',  label: '급식실',     countable: false, defaultCount: 1, icon: '🍱' },
    { key: 'storage',    label: '하치장/창고', countable: false, defaultCount: 1, icon: '📦' },
    { key: 'toilet',     label: '화장실',     countable: true,  defaultCount: 0, icon: '🚻' },
    { key: 'lab',        label: '실험실',     countable: true,  defaultCount: 0, icon: '🔬' },
    { key: 'gym',        label: '체육관',     countable: false, defaultCount: 0, icon: '🏋️' },
    { key: 'staffroom',  label: '교무실',     countable: false, defaultCount: 1, icon: '👩‍🏫' },
    { key: 'corridor',   label: '복도/공용',  countable: false, defaultCount: 1, icon: '🚶' },
  ],
  cafe: [
    { key: 'hall',       label: '홀',         countable: false, defaultCount: 1, icon: '☕' },
    { key: 'kitchen',    label: '주방',       countable: false, defaultCount: 1, icon: '🍳' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 1, icon: '📦' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'outdoor',    label: '야외석',     countable: false, defaultCount: 0, icon: '🌿' },
    { key: 'bakery',     label: '베이커리 공간', countable: false, defaultCount: 0, icon: '🥐' },
  ],
  restaurant: [
    { key: 'hall',       label: '홀',         countable: false, defaultCount: 1, icon: '🍽️' },
    { key: 'kitchen',    label: '주방',       countable: false, defaultCount: 1, icon: '🍳' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 1, icon: '📦' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'staffroom',  label: '직원실',     countable: false, defaultCount: 0, icon: '👤' },
  ],
  mart: [
    { key: 'salesfloor', label: '판매장',     countable: false, defaultCount: 1, icon: '🛒' },
    { key: 'kitchen',    label: '조리실',     countable: false, defaultCount: 0, icon: '🍳' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 1, icon: '📦' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'loading',    label: '하역장',     countable: false, defaultCount: 0, icon: '🚛' },
  ],
  office: [
    { key: 'office',     label: '사무실',     countable: true,  defaultCount: 1, icon: '💼' },
    { key: 'meeting',    label: '회의실',     countable: true,  defaultCount: 0, icon: '📋' },
    { key: 'kitchen',    label: '탕비실',     countable: false, defaultCount: 1, icon: '☕' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 0, icon: '📦' },
  ],
  apartment: [
    { key: 'unit',       label: '세대',       countable: true,  defaultCount: 0, icon: '🏠' },
    { key: 'parking',    label: '지하주차장', countable: false, defaultCount: 0, icon: '🚗' },
    { key: 'corridor',   label: '공용복도',   countable: false, defaultCount: 1, icon: '🚶' },
    { key: 'lobby',      label: '로비',       countable: false, defaultCount: 1, icon: '🪑' },
    { key: 'trashroom',  label: '쓰레기장',   countable: false, defaultCount: 1, icon: '🗑️' },
  ],
  multiUnit: [
    { key: 'unit',       label: '세대',       countable: true,  defaultCount: 0, icon: '🏠' },
    { key: 'corridor',   label: '공용복도',   countable: false, defaultCount: 1, icon: '🚶' },
    { key: 'parking',    label: '주차장',     countable: false, defaultCount: 0, icon: '🚗' },
    { key: 'trashroom',  label: '쓰레기장',   countable: false, defaultCount: 1, icon: '🗑️' },
  ],
  factory: [
    { key: 'production', label: '생산라인',   countable: true,  defaultCount: 1, icon: '🏭' },
    { key: 'storage',    label: '창고',       countable: true,  defaultCount: 1, icon: '📦' },
    { key: 'office',     label: '사무실',     countable: false, defaultCount: 1, icon: '💼' },
    { key: 'kitchen',    label: '식당/주방',  countable: false, defaultCount: 0, icon: '🍳' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'loading',    label: '하역장',     countable: false, defaultCount: 1, icon: '🚛' },
  ],
  welfare: [
    { key: 'room',       label: '입소자실',   countable: true,  defaultCount: 0, icon: '🛏️' },
    { key: 'kitchen',    label: '급식실/주방', countable: false, defaultCount: 1, icon: '🍳' },
    { key: 'corridor',   label: '복도/공용',  countable: false, defaultCount: 1, icon: '🚶' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 1, icon: '📦' },
  ],
  public: [
    { key: 'office',     label: '사무실',     countable: true,  defaultCount: 1, icon: '💼' },
    { key: 'lobby',      label: '민원실/로비', countable: false, defaultCount: 1, icon: '🏛️' },
    { key: 'kitchen',    label: '구내식당',   countable: false, defaultCount: 0, icon: '🍳' },
    { key: 'toilet',     label: '화장실',     countable: false, defaultCount: 1, icon: '🚻' },
    { key: 'storage',    label: '창고',       countable: false, defaultCount: 0, icon: '📦' },
  ],
  house: [
    { key: 'livingroom', label: '거실/방',    countable: false, defaultCount: 1, icon: '🏠' },
    { key: 'kitchen',    label: '주방',       countable: false, defaultCount: 1, icon: '🍳' },
    { key: 'basement',   label: '지하/창고',  countable: false, defaultCount: 0, icon: '📦' },
  ],
  officetel: [
    { key: 'unit',       label: '호실',       countable: true,  defaultCount: 0, icon: '🏨' },
    { key: 'corridor',   label: '공용복도',   countable: false, defaultCount: 1, icon: '🚶' },
    { key: 'lobby',      label: '로비',       countable: false, defaultCount: 0, icon: '🪑' },
  ],
  other: [],
};

// 포충기 설치 위치 기본 옵션 (업종별)
export const TRAP_LOCATION_PRESETS = {
  restaurant: ['홀', '주방', '창고', '화장실'],
  cafe:       ['홀', '주방', '창고'],
  mart:       ['판매장', '창고', '하역장'],
  hotel:      ['주방', '레스토랑', '로비', '창고'],
  hospital:   ['급식실', '창고', '복도'],
  factory:    ['생산라인', '창고', '하역장'],
  default:    ['주방', '창고', '홀'],
};

// 빈 포충기 데이터
export const emptyInsectTrap = () => ({
  enabled: false,
  locations: [],    // 설치 구역
  count: 1,
  unitPrice: 0,
  totalPrice: 0,
  note: '',
});

// 링크 공유 설정 기본값
export const defaultLinkSettings = () => ({
  allowEdit: false,          // 고객 수정 허용
  allowTrapToggle: false,    // 포충기 on/off 허용
  allowZoneAdjust: false,    // 구획 수량 조정 허용
  allowZoneRequest: false,   // 구획 추가 요청 허용
});

// =============================================
// 1단계 추가 상수
// =============================================

// 견적 상태 (확장)
export const QUOTE_STATUS_EXTENDED = {
  draft:      { label: '작성중',     color: '#64748b', bg: '#f1f5f9',  icon: '📝' },
  sent:       { label: '발송완료',   color: '#3b82f6', bg: '#eff6ff',  icon: '📤' },
  viewed:     { label: '열람함',     color: '#8b5cf6', bg: '#f5f3ff',  icon: '👁️' },
  approved:   { label: '승인',       color: '#10b981', bg: '#d1fae5',  icon: '✅' },
  rejected:   { label: '거절',       color: '#ef4444', bg: '#fee2e2',  icon: '❌' },
  reQuote:    { label: '재견적중',   color: '#f59e0b', bg: '#fef3c7',  icon: '🔄' },
  contracted: { label: '계약전환',   color: '#10b981', bg: '#d1fae5',  icon: '🎉' },
  expired:    { label: '만료',       color: '#94a3b8', bg: '#f8fafc',  icon: '⏰' },
  closed:     { label: '거절종료',   color: '#94a3b8', bg: '#f8fafc',  icon: '🚫' },
};

// 거절 사유 카테고리
export const REJECT_REASONS = [
  { value: 'price',    label: '💰 금액 문제',      desc: '견적 금액이 예산을 초과합니다' },
  { value: 'other',    label: '🏢 타업체 계약',     desc: '다른 업체와 계약을 진행했습니다' },
  { value: 'timing',   label: '⏳ 시기상조',        desc: '현재 시기가 맞지 않습니다' },
  { value: 'review',   label: '📋 내부 검토 중',    desc: '내부 검토 후 다시 연락드리겠습니다' },
  { value: 'scope',    label: '📐 서비스 범위',     desc: '원하는 서비스 범위와 다릅니다' },
  { value: 'direct',   label: '✏️ 직접 입력',       desc: '' },
];

// 유효기간 기본값 (일)
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
