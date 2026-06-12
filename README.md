# WhiteLine Manager v2.0 - 전체 기능 버전

## 📦 설치 방법

### 1. 기존 프로젝트에 덮어쓰기
```bash
# 기존 프로젝트 폴더로 이동
cd C:\Users\snike\whiteline-manager

# 다운로드한 파일들을 복사:
# - src/App.js
# - src/firebase.js
# - src/index.js
# - src/index.css
# - src/components/CalendarPage.js
# - src/components/CustomerList.js
# - src/components/AssignmentPage.js
# - src/components/StatsPage.js
# - src/components/SettingPage.js

# 필요한 패키지 설치
npm install @fullcalendar/core @fullcalendar/daygrid @fullcalendar/interaction @fullcalendar/react chart.js react-chartjs-2

# 실행
npm start
```

### 2. 새 프로젝트로 시작
```bash
# 프로젝트 생성
npx create-react-app whiteline-manager
cd whiteline-manager

# 다운로드한 src 폴더 전체 덮어쓰기

# 패키지 설치
npm install firebase sweetalert2 xlsx @fullcalendar/core @fullcalendar/daygrid @fullcalendar/interaction @fullcalendar/react chart.js react-chartjs-2

# 실행
npm start
```

---

## 🔐 테스트 계정
- ID: admin (또는 admin@test.com)
- PW: 123456

---

## ✅ 구현된 기능 목록

### 📅 배정 플랜 (캘린더)
- [x] 캘린더 기본
- [x] 대시보드 (배정금액, 완료매출, 야근/건수)
- [x] 완료/야근/배정 상태 변경
- [x] 완료자(completedBy) 기록
- [x] 일정 변경 팝업
- [x] 배정 취소 → 대기목록 이동
- [x] 관리자모드 (전체현황 보기)
- [x] 직원선택 드롭다운
- [x] 출근 기록

### 📦 대기목록
- [x] 대기목록 표시 (캘린더 하단)
- [x] 개별 카드 (10명 미만)
- [x] 폴더로 묶기 (10명 이상)
- [x] 폴더 클릭 → 리스트 + 전체배정
- [x] 드래그앤드롭 캘린더 배정
- [x] 날짜 선택 배정

### 👥 고객 관리
- [x] 목록/검색/등록/수정/삭제
- [x] 엑셀 업로드 (서비스별 분리)
- [x] 계약기간 → 자동 해약
- [x] 작업월 설정 (1~12월 체크박스)
- [x] 메모 기능
- [x] 미수금/클레임 관리
- [x] 태그 (클레임, 신규, 상담, 추가)
- [x] 해약 처리 (사유 입력)
- [x] 재계약 처리
- [x] Soft Delete (삭제된 고객 필터)
- [x] 엑셀 내보내기

### 🤵 직원 배정
- [x] 체크박스 선택
- [x] 필터 (미배정, 재계약, 태그별)
- [x] 담당자 일괄 배정
- [x] 특별작업 등록
- [x] 알림 발송 (시뮬레이션)

### 🌟 특별작업
- [x] 타입 선택 (클레임/신규/상담/추가)
- [x] 대기목록에 추가
- [x] 특별작업 삭제 (관리자만)

### 🔐 월마감
- [x] 직원용: 조건 체크 후 마감
- [x] 관리자용: 직원별 토글 (마감/해제)
- [x] 마감 후 수정 불가

### 🚀 익월 자동 배정
- [x] 월마감 후 다음달 복사
- [x] 같은 주차 + 같은 요일로
- [x] 해약/작업월 제외

### 📊 매출 통계
- [x] 월별 차트
- [x] 직원별 실적 탭
- [x] 야근 건수 표시
- [x] 순위 (🥇🥈🥉)

### 📱 알림톡
- [x] 내일 방문 알림 발송 (시뮬레이션)
- [x] 개별 알림 발송

### ⚙️ 설정
- [x] 직원 등록/수정/삭제
- [x] 자동배정 옵션
- [x] 시스템 초기화

---

## 📁 파일 구조
```
src/
├── App.js                    # 메인 레이아웃 + 라우팅
├── firebase.js               # Firebase 설정
├── index.js                  # 진입점
├── index.css                 # 전역 스타일
└── components/
    ├── CalendarPage.js       # 캘린더 + 대기목록 + 월마감
    ├── CustomerList.js       # 고객관리
    ├── AssignmentPage.js     # 직원배정 + 특별작업
    ├── StatsPage.js          # 매출통계
    └── SettingPage.js        # 직원/시스템 설정
```

---

## 🔧 문제 해결

### "Module not found" 오류
```bash
npm install [패키지명]
```

### Firebase 오류
- firebase.js의 설정이 올바른지 확인
- Firebase Console에서 Firestore 규칙 확인

### 캘린더 드래그 안됨
- @fullcalendar/interaction 패키지 설치 확인

---

## 📞 문의
추가 기능이나 수정이 필요하면 말씀해주세요!
