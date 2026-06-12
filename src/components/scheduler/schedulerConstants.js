// =============================================
// 스케쥴러 상수 정의
// =============================================

// 약속 유형
export const EVENT_TYPES = {
  quote:     { label: '견적',  icon: '📋', color: '#3b82f6', bg: '#eff6ff' },
  claim:     { label: '클레임', icon: '🔧', color: '#ef4444', bg: '#fee2e2' },
  consult:   { label: '상담',  icon: '💬', color: '#10b981', bg: '#d1fae5' },
  sales:     { label: '영업',  icon: '🏪', color: '#8b5cf6', bg: '#ede9fe' },
  other:     { label: '기타',  icon: '📌', color: '#f59e0b', bg: '#fef3c7' },
  holiday:   { label: '휴무',  icon: '🏖️', color: '#6b7280', bg: '#f3f4f6' },
  shared:    { label: '공유',  icon: '👥', color: '#0891b2', bg: '#e0f2fe' },
};

// 휴무 사유
export const HOLIDAY_REASONS = [
  '연차', '반차(오전)', '반차(오후)', '병가', '경조사', '교육/출장', '공휴일', '직접입력'
];

// 영업 연락 방법
export const SALES_CONTACT_METHODS = ['전화', '이메일', '메신저', '방문', '기타'];

// 알림 시간 옵션 (분)
export const ALARM_OPTIONS = [
  { value: 0,   label: '알림 없음' },
  { value: 10,  label: '10분 전' },
  { value: 15,  label: '15분 전' },
  { value: 30,  label: '30분 전' },
  { value: 60,  label: '1시간 전' },
  { value: 120, label: '2시간 전' },
  { value: 1440,label: '하루 전' },
];

// 반복 옵션
export const REPEAT_OPTIONS = [
  { value: 'none',    label: '반복 없음' },
  { value: 'daily',   label: '매일' },
  { value: 'weekly',  label: '매주' },
  { value: 'monthly', label: '매월' },
];

// 고객현황 - 작업 선호 시간
export const PREFERRED_TIME_OPTIONS = [
  '오전 (09:00~12:00)',
  '점심 (12:00~13:00)',
  '오후 (13:00~17:00)',
  '저녁 (17:00~19:00)',
  '야간 (19:00~)',
  '무관',
];

// 고객현황 - 중점 문제
export const MAIN_PEST_ISSUES = [
  '바퀴벌레', '쥐', '개미', '파리', '모기', '초파리',
  '빈대', '담배벌레', '좀', '그리마', '지네', '기타',
];

// 고객현황 - 심각도
export const SEVERITY_LEVELS = [
  { value: 'critical', label: '매우 심각', color: '#dc2626' },
  { value: 'high',     label: '심각',     color: '#f97316' },
  { value: 'medium',   label: '보통',     color: '#f59e0b' },
  { value: 'low',      label: '양호',     color: '#10b981' },
];

// 고객현황 - 출입 방법
export const ACCESS_METHODS = [
  '담당자 연락', '키패드', '열쇠', '경비실 통해서', '항상 오픈', '기타',
];

// 고객현황 - 고객 성향
export const CUSTOMER_TRAITS = [
  '꼼꼼', '무관심', '예민', '친절', '까다로움', '협조적', '바쁨',
];

// 뷰 타입
export const VIEW_TYPES = {
  month: '월간',
  week:  '주간',
  day:   '일간',
};

// 빈 스케쥴 이벤트
export const emptyScheduleEvent = (date = '') => ({
  type: 'quote',
  title: '',
  date: date,
  startTime: '09:00',
  endTime: '10:00',
  allDay: false,
  memo: '',
  alarm: 30,
  repeat: 'none',
  repeatEndDate: '',
  sharedWith: [],    // 공유 직원 목록 (visibleId)
  isShared: false,   // 공유 받은 이벤트 여부
  sharedFrom: '',    // 공유 원본 작성자
  linkedCustomerId: '',
  // 영업 전용 필드
  sales: {
    bizName: '',
    area: '',
    workTypes: [],
    hasInitial: false,
    initialFee: 0,
    monthlyFee: 0,
    contactMethod: '전화',
    nextVisitDate: '',
    contactPerson: '',
    memo: '',
  },
  // 휴무 전용 필드
  holiday: {
    startDate: '',
    endDate: '',
    reason: '',
    reasonDirect: '',
  },
});

// 빈 고객현황
export const emptyCustomerStatus = () => ({
  preferredTime: '',
  preferredTimeDetail: '',
  mainIssues: [],          // 중점 문제 배열
  issueSeverity: 'medium', // 심각도
  siteNote: '',            // 현장 특이사항
  accessMethod: '',        // 출입 방법
  accessDetail: '',        // 출입 상세
  customerTrait: [],       // 고객 성향
  lastComplainDate: '',     // 최근 컴플레인 날짜
  lastComplainNote: '',     // 최근 컴플레인 내용
  tags: [],                // 자유 태그
  updatedAt: '',
  updatedBy: '',
});
