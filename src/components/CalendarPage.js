import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { collection, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import { showPesticidePopup, saveCustomerPesticides } from './pesticideUtils';
import { showCertSendPopup } from '../utils/certPdfSender';
import { confirmVisitAndNotify, confirmAllVisitsForDate } from '../utils/visitNotify';
import CalendarDashboard from './CalendarDashboard';
import CalendarNewCustomersTab from './CalendarNewCustomersTab';
import { useAppContext } from '../context/AppContext';
import { CustomerStatusSummary } from './CustomerStatusTab';
import TodayDashboard from './TodayDashboard';

function CalendarPage({ currentUser, staffList }) {
  // 권한 체크 (컴포넌트 레벨에서 정의)
  const isMaster = ['master','master1','master2'].includes(currentUser?.role);

  const [events, setEvents] = useState([]);
  const [prevMonthEvents, setPrevMonthEvents] = useState([]); // 전월 이벤트 (복귀/누락 계산용)
  const [waitingList, setWaitingList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [folders, setFolders] = useState([]); // 폴더 목록
  const [loading, setLoading] = useState(true);
  const [calendarMainTab, setCalendarMainTab] = useState('calendar'); // 'calendar' | 'newCustomers'
  const [newCustomerSubTab, setNewCustomerSubTab] = useState('new'); // 'new' | 'return' | 'missing'
  const [monthClosed, setMonthClosed] = useState(false);
  const [dailyClosedDates, setDailyClosedDates] = useState([]); // 일일마감된 날짜들
  const { settings: appSettings } = useAppContext();
  // 로컬 settings는 appSettings에서 가져옴 (Firestore 중복 fetch 방지)
  const [settings, setSettings] = useState({ overtimeHour: 10, overtimeMinute: 0, overtimeEnabled: true, aiAssignEnabled: true, anthropicApiKey: '' });
  const [currentViewMode, setCurrentViewMode] = useState('self');
  const [isAdminView, setIsAdminView] = useState(false);
  // currentMonth를 문자열로 관리 (무한루프 방지)
  const [currentMonthStr, setCurrentMonthStr] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const calendarRef = useRef(null);
  const waitingRef = useRef(null);

  // 모바일 감지
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  
  // 모바일 드래그 상태
  const [mobileDragItem, setMobileDragItem] = useState(null);
  const [mobileDragPos, setMobileDragPos] = useState({ x: 0, y: 0 });
  const mobileDragPosRef = useRef({ x: 0, y: 0 }); // ref로도 관리
  const [showScrollZones, setShowScrollZones] = useState(false);
  const scrollIntervalRef = useRef(null);

  // 대시보드 통계
  const [stats, setStats] = useState({ expected: 0, done: 0, overtime: 0, count: 0 });
  const [statsModal, setStatsModal] = useState(null); // null | 'expected' | 'done' | 'overtime'
  const [showLiveStatus, setShowLiveStatus] = useState(false); // 직원 실시간 작업현황

  // currentMonth를 Date 객체로 변환 (필요할 때만)
  const currentMonth = new Date(currentMonthStr + '-01');

  // 모바일 감지 useEffect
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 월/뷰 변경 시 데이터 재로드 + customers 실시간 감지 (이중 fetch 방지)
  // - 월/뷰 변경 시: 즉시 fetchData
  // - customers 변경 시: 500ms debounce 후 fetchData (연속 변경 최적화)
  useEffect(() => {
    let debounceTimer = null;
    let isFirstRun = true;

    // 첫 실행 시 즉시 fetch
    fetchData();

    const unsub = onSnapshot(collection(db, 'customers'), () => {
      // 첫 snapshot은 구독 직후 즉시 발생하므로 skip (위에서 이미 fetchData 호출)
      if (isFirstRun) { isFirstRun = false; return; }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { fetchData(); }, 500);
    });
    return () => {
      unsub();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonthStr, currentViewMode, isAdminView]);

  // 대기목록 드래그 초기화
  const draggableInstance = useRef(null);
  
  useEffect(() => {
    // 약간의 지연을 두고 초기화 (DOM 렌더링 완료 후)
    const timer = setTimeout(() => {
      // 기존 인스턴스 정리
      if (draggableInstance.current) {
        draggableInstance.current.destroy();
        draggableInstance.current = null;
      }
      
      // 대기목록이 있을 때 드래그 가능
      if (waitingRef.current && waitingList.length > 0) {
        try {
          draggableInstance.current = new Draggable(waitingRef.current, {
            itemSelector: '.waiting-card',
            eventData: (el) => {
              const data = JSON.parse(el.getAttribute('data-event'));
              return {
                title: data.title,
                extendedProps: data.extendedProps
              };
            }
          });
          console.log('✅ Draggable 초기화 완료, 대기목록:', waitingList.length);
        } catch (error) {
          console.error('Draggable 초기화 오류:', error);
        }
      }
    }, 200); // 지연시간 늘림
    
    return () => {
      clearTimeout(timer);
      if (draggableInstance.current) {
        draggableInstance.current.destroy();
        draggableInstance.current = null;
      }
    };
  }, [waitingList]); // waitingList 전체를 dependency로

  // 상태별 색상 (fetchData에서 사용하므로 먼저 정의)
  const getStatusColor = useCallback((status, isCoWork = false) => {
    // 공동작업자 이벤트는 별도 색상 (연보라색 계열)
    if (isCoWork) {
      if (status === '완료') return '#a78bfa'; // 완료 - 연보라
      if (status === '야근') return '#c084fc'; // 야근 - 보라
      return '#8b5cf6'; // 배정 - 보라
    }
    // 일반 이벤트
    if (status === '완료') return '#059669';
    if (status === '야근') return '#7e22ce';
    if (status === '마감완료') return '#059669';
    return '#3788d8';
  }, []);

  const fetchData = async () => {
    // 스크롤 위치 저장 (고객카드 이동 후 복원)
    const savedScrollY = window.scrollY || document.documentElement.scrollTop;
    setLoading(true);
    try {
      // 고객 데이터
      const custSnap = await getDocs(collection(db, 'customers'));
      const custList = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomers(custList);

      // 월별 이벤트 조회 (현재월 ± 1달)
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      
      // 전월 1일
      const prevMonth = new Date(year, month - 1, 1);
      const startDate = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      
      // 익월 말일
      const nextMonth = new Date(year, month + 2, 0);
      const endDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(nextMonth.getDate()).padStart(2, '0')}`;

      // 날짜 범위로 이벤트 조회 (최적화)
      const eventSnap = await getDocs(query(
        collection(db, 'events'),
        where('date', '>=', startDate),
        where('date', '<=', endDate)
      ));
      
      let eventList = eventSnap.docs.map(doc => {
        const data = doc.data();
        const isCoWork = data.isCoWork || false;
        const isSpecialWork = data.workType === 'special';
        const isExtraWork = data.workType === 'extra';
        const isFolder = data.workType === 'folder' || (data.isFolder && !isCoWork); // 폴더 이벤트
        const isNoWork = data.status === '미작업'; // 미작업 상태
        
        // 고객 정보에서 미수 확인
        const customer = custList.find(c => c.id === data.customerCode);
        const unpaid = customer?.unpaid || 0;
        
        // 색상 결정 (미작업=회색, 폴더=보라, 추가업무=주황, 특별=노랑, 일반=파랑)
        let eventColor;
        if (isNoWork) {
          eventColor = '#9ca3af'; // 미작업 - 회색
        } else if (isFolder && !isCoWork) {
          if (data.status === '완료') eventColor = '#7c3aed'; // 완료 - 진한 보라
          else if (data.status === '야근') eventColor = '#6d28d9'; // 야근
          else eventColor = '#8b5cf6'; // 배정 - 보라
        } else if (isExtraWork) {
          if (data.status === '완료') eventColor = '#ea580c'; // 완료 - 진한 주황
          else if (data.status === '야근') eventColor = '#c2410c'; // 야근 - 더 진한 주황
          else eventColor = '#f97316'; // 배정 - 주황
        } else if (isSpecialWork) {
          if (data.status === '완료') eventColor = '#059669';
          else if (data.status === '야근') eventColor = '#7e22ce';
          else eventColor = '#f59e0b'; // 배정 - 노란색
        } else {
          eventColor = getStatusColor(data.status, isCoWork);
        }
        
        // 제목 설정 (미작업=⛔, 폴더=📁, 미수=💰 표시)
        // 타이틀에서 앞의 고객코드 제거 (예: "0139 장찬기김밥" → "장찬기김밥")
        // 다양한 공백 문자 대응 + 공백 없는 경우도 대응
        const codeMatch = data.title?.match(/^(\d{3,4})[\s\u00A0\u3000]*/);
        // 고객관리 코드: 타이틀에서 추출 → 없으면 고객 데이터에서 찾기
        const customerInfo = custList.find(c => c.id === data.customerCode);
        const displayCode = codeMatch ? codeMatch[1] : (customerInfo?.code || null);
        let cleanTitle = data.title?.replace(/^\d{3,4}[\s\u00A0\u3000]*/, '').trim() || data.title;
        let eventTitle = cleanTitle;
        if (isNoWork) eventTitle = `⛔ ${cleanTitle}`;
        else if (isCoWork) eventTitle = `👥 ${cleanTitle}`;
        else if (isFolder) eventTitle = `📁 ${cleanTitle}`;
        else if (isExtraWork) eventTitle = `📝 ${cleanTitle}`;
        else if (isSpecialWork) eventTitle = `🌟 ${cleanTitle}`;
        if (unpaid > 0 && !isExtraWork && !isFolder && !isNoWork) eventTitle = `💰 ${eventTitle}`;
        
        return {
          id: doc.id,
          title: eventTitle,
          start: data.date,
          backgroundColor: eventColor,
          borderColor: eventColor,
          extendedProps: {
            customerCode: data.customerCode,
            displayCode: displayCode, // 고객관리 코드 (0139 등)
            price: data.price || 0,
            status: data.status || '배정',
            staffId: data.staffId,
            staffName: data.staffName,
            completedBy: data.completedBy || '',
            phone: data.phone,
            address: data.address,
            isCoWork: isCoWork,
            isFolder: isFolder,
            parentEventId: data.parentEventId || null,
            coWorkPrice: data.coWorkPrice || 0,
            workType: data.workType || 'regular',
            mainStaffName: data.mainStaffName || '',
            unpaid: unpaid,
            folderId: data.folderId || null,
            folderName: data.folderName || '',
            customerIds: data.customerIds || [],
            customerNames: data.customerNames || [],
            noWorkReason: data.noWorkReason || '',
            isCarryOver: data.isCarryOver || false
          }
        };
      });

      // 뷰 모드에 따른 필터링
      if (!isAdminView && currentViewMode !== 'admin') {
        const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
        eventList = eventList.filter(e => e.extendedProps.staffId === targetStaffId);
      }

      // 전월 이벤트 별도 저장 (복귀/누락 계산용) — 현재월 필터링 전에 추출
      const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
      const prevEvents = eventList.filter(e =>
        e.start && e.start.startsWith(prevMonthStr) &&
        e.extendedProps?.workType !== 'extra' &&
        !e.extendedProps?.isCoWork
      );
      setPrevMonthEvents(prevEvents);

      // 현재 월 이벤트만 표시 (다른 월 이벤트 제외)
      eventList = eventList.filter(e => e.start && e.start.startsWith(currentMonthStr));

      setEvents(eventList);

      // 현재 월 계산
      const currentMonthNum = currentMonth.getMonth() + 1;

      // 동절기 월 판단
      const winterMonths = [1, 2, 3, 12];
      const isWinterMonth = winterMonths.includes(currentMonthNum);

      // 고객별 현재 월 배정 횟수 계산
      const currentMonthPrefix = currentMonthStr; // '2026-02' 형식
      const getAssignedCount = (customerId) => {
        const assignedEvents = eventList.filter(e =>
          e.extendedProps.customerCode === customerId &&
          !e.extendedProps.isCoWork &&
          e.extendedProps.workType !== 'special' &&
          e.start && e.start.startsWith(currentMonthPrefix)
        );
        if (assignedEvents.length === 0) return 0;

        // workRound가 저장된 이벤트가 있으면 → max(workRound) + 1 사용
        // (회차 인덱스 0부터 시작, 배정된 이벤트 중 가장 높은 회차 + 1 = 다음 대기 회차)
        const hasWorkRound = assignedEvents.some(e => e.extendedProps.workRound !== undefined && e.extendedProps.workRound !== null);
        if (hasWorkRound) {
          const maxRound = Math.max(...assignedEvents.map(e => e.extendedProps.workRound ?? 0));
          return maxRound + 1;
        }
        // workRound 없으면 기존 방식 (이벤트 개수)
        return assignedEvents.length;
      };

      // 고객별 실제 적용 금액 계산 (동절기 반영)
      const getCustomerPrice = (customer, priceOverride = 0) => {
        if (priceOverride > 0) return priceOverride;
        
        const basePrice = getTotalPrice(customer);
        const winterEnabled = customer.winterEnabled !== false;
        const winterPrice = customer.winterPrice || 0;
        
        if (winterEnabled && isWinterMonth && winterPrice > 0) {
          return winterPrice;
        }
        return basePrice;
      };

      // 설치장비 금액 계산 (해당 월에 체크된 경우만)
      const getEquipmentPrice = (customer) => {
        const equipment = customer.equipment || {};
        // 장비 활성화 여부 확인
        if (!equipment.enabled) return 0;
        // 해당 월에 비용발생 체크되어 있는지 확인
        const equipmentMonths = equipment.months || [1,2,3,4,5,6,7,8,9,10,11,12];
        if (!equipmentMonths.includes(currentMonthNum)) return 0;
        // 대수 × 대당금액
        const count = equipment.count || 0;
        const pricePerUnit = equipment.pricePerUnit || 0;
        return count * pricePerUnit;
      };

      // 대기목록 생성 (횟수 기반)
      let waiting = [];
      
      custList.forEach(c => {
        if (c.status === '해약' || c.custStatus === '해약' || c.custStatus === '삭제') return;
        if (!c.staffName) return;

        // ===== 작업개시일 체크 =====
        // workStartDate가 있으면 해당 월 이전은 대기목록 생성 안 함
        if (c.workStartDate) {
          const startYM = c.workStartDate.substring(0, 7); // "2025-06"
          if (currentMonthStr < startYM) return; // 개시 전 달은 스킵
        }

        // 뷰 모드에 따른 필터링 (1회성 담당 반영)
        if (!isAdminView && currentViewMode !== 'admin') {
          const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
          const staffName = staffList.find(s => s.visibleId === targetStaffId)?.name;
          const effectiveStaff = getEffectiveStaffName(c, currentMonthStr);
          if (effectiveStaff !== staffName) return;
        }

        // 작업월 데이터 확인
        const workMonthsData = c.workMonthsData || {};
        let monthData = workMonthsData[currentMonthNum];
        
        // 이전 형식 호환
        if (!monthData) {
          const oldWorkMonths = Array.isArray(c.workMonths) ? c.workMonths : [1,2,3,4,5,6,7,8,9,10,11,12];
          monthData = {
            enabled: oldWorkMonths.includes(currentMonthNum),
            count: 1,
            prices: [0],
            charged: [true]
          };
        }

        if (!monthData.enabled) return;

        const totalCount = monthData.count || 1;
        const assignedCount = getAssignedCount(c.id);
        const remainingCount = totalCount - assignedCount;
        const chargedArr = monthData.charged || [];
        
        // 설치장비 금액 (해당 월에 체크된 경우만)
        const equipmentPrice = getEquipmentPrice(c);
        // 이미 배정된 작업이 있으면 장비비는 이미 포함됨
        const shouldAddEquipment = assignedCount === 0 && equipmentPrice > 0;

        // 남은 횟수만큼 대기목록에 추가
        for (let i = 0; i < remainingCount; i++) {
          const currentIdx = assignedCount + i;
          const isCharged = chargedArr[currentIdx] !== false; // 기본값 true
          const priceOverride = (monthData.prices && monthData.prices[currentIdx]) || 0;
          
          // 금액부과 체크 여부에 따라 금액 결정
          let price;
          if (!isCharged) {
            // 금액부과 안함 → 0원
            price = 0;
          } else if (priceOverride > 0) {
            // 금액부과 + 금액 입력됨 → 해당 금액
            // splitPrice가 true이면 입력된 금액을 횟수로 나눔
            price = c.splitPrice ? Math.round(priceOverride / totalCount) : priceOverride;
          } else {
            // 금액부과 + 금액 0 → 기본금액 (동절기 반영)
            const basePrice = getCustomerPrice(c, 0);
            // splitPrice가 true이면 기본금액을 횟수로 나눔
            price = c.splitPrice ? Math.round(basePrice / totalCount) : basePrice;
          }
          
          // 장비 금액 계산
          // - splitPrice: 모든 항목에 나눠서 추가
          // - 일반: 첫 번째 항목에만 전체 추가
          let finalEquipmentPrice = 0;
          if (shouldAddEquipment) {
            if (c.splitPrice) {
              // 금액 나누기 모드: 모든 항목에 장비비 나눠서 추가
              finalEquipmentPrice = Math.round(equipmentPrice / totalCount);
            } else if (i === 0) {
              // 일반 모드: 첫 번째 항목에만 장비비 전체 추가
              finalEquipmentPrice = equipmentPrice;
            }
          }
          
          const effectiveStaffForWaiting = getEffectiveStaffName(c, currentMonthStr);
          const isOnetimeStaff = effectiveStaffForWaiting !== (c.staffName || '');
          waiting.push({
            ...c,
            id: `${c.id}_${currentIdx}`,
            originalId: c.id,
            code: c.code,
            price: price + finalEquipmentPrice,
            basePrice: price,
            equipmentPrice: finalEquipmentPrice,
            priceOverride: priceOverride,
            isCharged: isCharged,
            splitPrice: c.splitPrice || false,
            currentIndex: currentIdx,
            totalCount: totalCount,
            staffName: effectiveStaffForWaiting, // 1회성 담당 반영
            isOnetimeStaff: isOnetimeStaff,      // 1회성 여부 표시용
            originalStaffName: c.staffName || '',// 기본 담당자 보존
            displayName: totalCount > 1 ? `${c.name} (${currentIdx + 1}/${totalCount})` : c.name
          });
        }
      });

      // 특별작업 대기목록 (customers 컬렉션의 specialWork 필드에서 가져오기)
      const specialWaitingList = custList.filter(c => {
        // 특별작업이 없으면 제외
        if (!c.specialWork) return false;
        
        // 디버깅
        console.log('특별작업 고객:', c.name, c.specialWork);
        
        // 해약/삭제 고객 제외
        if (c.status === '해약' || c.custStatus === '해약' || c.custStatus === '삭제') return false;
        
        // 작업월 확인
        const specialWorkMonths = c.specialWork.workMonths || [1,2,3,4,5,6,7,8,9,10,11,12];
        console.log('작업월:', specialWorkMonths, '현재월:', currentMonthNum, '포함여부:', specialWorkMonths.includes(currentMonthNum));
        if (!specialWorkMonths.includes(currentMonthNum)) return false;
        
        // 완료횟수 확인 (totalCount보다 작아야 대기목록에 표시)
        const totalCount = c.specialWork.totalCount || 1;
        const completedCount = c.specialWork.completedCount || 0;
        console.log('특별작업 횟수:', completedCount, '/', totalCount);
        if (completedCount >= totalCount) return false;  // 다 완료했으면 제외
        
        // 관리자 모드 체크
        console.log('관리자모드:', isAdminView, '뷰모드:', currentViewMode);
        
        // 뷰 모드에 따른 필터링
        if (isAdminView || currentViewMode === 'admin') {
          // 관리자 모드: 모든 특별작업 표시
          console.log('관리자 모드 - 표시');
          return true;
        } else {
          // 개별 직원 모드: 담당자가 있어야 하고, 해당 직원 것만
          if (!c.specialWork.staffName) return false;
          
          const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
          const staffName = staffList.find(s => s.visibleId === targetStaffId)?.name;
          
          console.log('개별모드 - 타겟:', staffName, '특별작업담당:', c.specialWork.staffName);
          return c.specialWork.staffName === staffName;
        }
      }).map(c => {
        const totalCount = c.specialWork.totalCount || 1;
        const completedCount = c.specialWork.completedCount || 0;
        const currentRound = completedCount + 1;  // 다음 회차
        
        return {
          id: `special_${c.id}`,
          customerId: c.id,
          code: c.code,
          name: c.name,
          title: `🌟 ${c.name} (${currentRound}/${totalCount})`,
          displayName: c.name,
          isSpecial: true,
          specialWork: c.specialWork,
          price: c.specialWork.price || 0,
          staffName: c.specialWork.staffName || '미지정',
          phone: c.phone || '',
          address: c.address || '',
          currentRound: currentRound,
          totalCount: totalCount
        };
      });
      
      console.log('특별작업 대기목록:', specialWaitingList);
      
      waiting = [...waiting, ...specialWaitingList];

      // 추가업무 대기목록 (extraWork 컬렉션에서 가져오기)
      const extraWorkSnap = await getDocs(query(
        collection(db, 'extraWork'),
        where('month', '==', currentMonthStr),
        where('status', '==', '대기')
      ));
      
      const extraWorkList = extraWorkSnap.docs
        .filter(doc => {
          const data = doc.data();
          // 뷰 모드에 따른 필터링
          if (isAdminView || currentViewMode === 'admin') {
            return true;
          } else {
            const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
            return data.staffId === targetStaffId;
          }
        })
        .map(doc => {
          const data = doc.data();
          // 수금은 금액 0 (이중계산 방지)
          const extraPrice = data.category === '수금' ? 0 : (data.price || 0);
          return {
            id: `extra_${doc.id}`,
            extraWorkId: doc.id,
            name: data.title,
            title: data.title,
            displayName: `📝 ${data.title}`,
            isExtraWork: true,
            category: data.category,
            price: extraPrice,
            staffId: data.staffId,
            staffName: data.staffName
          };
        });
      
      console.log('추가업무 대기목록:', extraWorkList);
      
      waiting = [...waiting, ...extraWorkList];

      // 폴더 불러오기
      const foldersSnap = await getDocs(query(
        collection(db, 'folders'),
        where('month', '==', currentMonthStr)
      ));
      // active, partial, assigned 상태의 폴더만 (deleted, completed 제외)
      const folderList = foldersSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(f => f.status === 'active' || f.status === 'partial' || f.status === 'assigned');
      
      // 폴더에 포함된 고객 ID들
      const folderCustomerIds = folderList.flatMap(f => f.customerIds || []);
      
      // 대기목록에서 폴더에 포함된 고객 제외
      waiting = waiting.filter(w => !folderCustomerIds.includes(w.originalId || w.id?.replace(/^(special_|extra_)/, '').split('_')[0]));
      
      setFolders(folderList);
      setWaitingList(waiting);

      // 월마감 상태 확인
      const closeSnap = await getDocs(query(
        collection(db, 'monthClose'),
        where('year', '==', currentMonth.getFullYear()),
        where('month', '==', currentMonth.getMonth() + 1),
        where('staffId', '==', currentUser.id)
      ));
      setMonthClosed(closeSnap.docs.length > 0);

      // 일일마감 데이터 가져오기 (현재 보고 있는 직원 기준)
      const viewingStaffId = (currentViewMode === 'self' || currentViewMode === 'admin') 
        ? currentUser.id 
        : currentViewMode;
      const dailyCloseSnap = await getDocs(query(
        collection(db, 'dailyClose'),
        where('staffId', '==', viewingStaffId)
      ));
      const closedDates = dailyCloseSnap.docs
        .map(doc => doc.data().date)
        .filter(date => date && date.startsWith(currentMonthStr));
      setDailyClosedDates(closedDates);

      // 설정은 AppContext에서 가져옴 (Firestore 중복 fetch 방지)
      setSettings({
        overtimeHour:    appSettings.overtimeHour    ?? 10,
        overtimeMinute:  appSettings.overtimeMinute  ?? 0,
        overtimeEnabled: appSettings.overtimeEnabled ?? true,
        aiAssignEnabled: appSettings.aiAssignEnabled ?? true,
        anthropicApiKey: appSettings.anthropicApiKey || '',
        showCertPopup:   appSettings.showCertPopup   ?? true, // 소독증명서 팝업 표시 여부
      });

      // 대시보드 업데이트
      updateDashboard(eventList);

    } catch (error) {
      console.error('Error:', error);
    }
    setLoading(false);
    // 스크롤 위치 복원 (고객카드 이동 후 최상단으로 튀는 현상 방지)
    if (savedScrollY > 100) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      });
    }
  };

  // ── 작업 전 방문 예정 알림 (수동 발송) ────────────────────────
  const sendVisitReminders = useCallback(async () => {
    const todayStr = toLocalDateStr(new Date());
    const todayEvents = events.filter(e =>
      (e.start || e.extendedProps?.date || '').startsWith(todayStr) &&
      e.extendedProps?.status === '배정' && !e.extendedProps?.isCoWork
    );

    if (todayEvents.length === 0) {
      Swal.fire('알림 없음', '오늘 배정된 고객이 없습니다.', 'info');
      return;
    }

    const phoneList = todayEvents
      .map(e => {
        const cust = customers.find(c => c.id === e.extendedProps?.customerCode || c.code === e.extendedProps?.customerCode);
        return cust ? { name: cust.name, phone: cust.phone } : null;
      })
      .filter(c => c && c.phone);

    if (phoneList.length === 0) {
      Swal.fire('알림 없음', '전화번호가 등록된 고객이 없습니다.', 'info');
      return;
    }

    const msgTemplate = `안녕하세요! 오늘 방문 예정입니다. 잠시 후 방역 서비스를 진행할 예정이오니 준비 부탁드립니다. 감사합니다. - ${settings.companyName || '화이트라인'}`;

    const html = `
      <div style="text-align:left;font-size:13px;">
        <div style="background:#eff6ff;padding:10px;border-radius:8px;margin-bottom:12px;">
          <div style="font-weight:bold;color:#1e40af;margin-bottom:6px;">📱 발송 메시지</div>
          <div style="color:#374151;font-size:12px;line-height:1.6;">${msgTemplate}</div>
        </div>
        <div style="font-weight:bold;margin-bottom:8px;">발송 대상 (${phoneList.length}명)</div>
        ${phoneList.map(c => `<div style="padding:4px 0;border-bottom:1px solid #f1f5f9;">
          <span style="font-weight:bold;">${c.name}</span>
          <span style="color:#6b7280;margin-left:8px;">${c.phone}</span>
        </div>`).join('')}
      </div>`;

    const { isConfirmed } = await Swal.fire({
      title: '📱 방문 예정 알림 발송',
      html,
      showCancelButton: true,
      confirmButtonText: '문자 앱으로 발송',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
    });

    if (isConfirmed) {
      // SMS 앱으로 연결 (다수 발송은 각각)
      const phones = phoneList.map(c => c.phone.replace(/[^0-9]/g,'')).join(',');
      const encoded = encodeURIComponent(msgTemplate);
      window.open(`sms:${phones}?body=${encoded}`, '_blank');
    }
  }, [events, customers, settings]);

  const updateDashboard = useCallback((eventList) => {
    let expected = 0, done = 0, overtime = 0, count = 0;
    
    // 현재 월의 이벤트만 필터링 (공동작업 이벤트 제외 - 이중 계산 방지)
    const currentMonthEvents = eventList.filter(e => {
      const eventDate = e.start || e.extendedProps?.date;
      if (!eventDate || !eventDate.startsWith(currentMonthStr)) return false;
      // 공동작업 이벤트는 제외 (메인 이벤트에서만 계산)
      if (e.extendedProps?.isCoWork) return false;
      return true;
    });
    
    currentMonthEvents.forEach(e => {
      const price = parseInt(e.extendedProps.price) || 0;
      expected += price;
      if (['완료', '야근', '마감완료'].includes(e.extendedProps.status)) {
        done += price;
      }
      if (e.extendedProps.status === '야근') {
        overtime++;
      }
      count++;
    });
    setStats({ expected, done, overtime, count });
  }, [currentMonthStr]);

  // 이벤트 클릭
  const handleEventClick = (info) => {
    const event = info.event;
    const props = event.extendedProps;
    const isCoWork = props.isCoWork || false;
    const isSpecialWork = props.workType === 'special';
    const isExtraWork = props.workType === 'extra';
    const eventDate = event.startStr;
    const isDailyClosed = dailyClosedDates.includes(eventDate);
    
    // 최신 고객 정보 가져오기 (실시간 반영)
    const customerInfo = customers.find(c => c.id === props.customerCode || c.code === props.customerCode);
    
    // 정기/부정기 판단
    const getCustomerTypeInfo = (c) => {
      if (!c) return { type: '정기', months: null };
      const workMonthsData = c.workMonthsData || {};
      const enabledMonths = [];
      for (let m = 1; m <= 12; m++) {
        if (workMonthsData[m]?.enabled !== false) {
          enabledMonths.push(m);
        }
      }
      if (enabledMonths.length === 12) {
        return { type: '정기', months: null };
      } else if (enabledMonths.length > 0) {
        return { type: '부정기', months: enabledMonths };
      }
      return { type: '정기', months: null };
    };
    
    // 설치장비 정보
    const getEquipmentHtml = (c) => {
      if (!c || !c.equipment || !c.equipment.enabled) return '';
      const eq = c.equipment;
      const count = eq.count || 1;
      const pricePerUnit = eq.pricePerUnit || 0;
      const totalPrice = count * pricePerUnit;
      return `
        <div style="background:#ecfdf5;padding:8px;border-radius:6px;margin-top:8px;border:1px solid #a7f3d0;">
          <div style="font-size:11px;color:#059669;font-weight:bold;">🔧 ${eq.equipmentName || '설치장비'}</div>
          <div style="font-size:10px;color:#047857;">${count}대 × ${pricePerUnit.toLocaleString()}원 = <strong>${totalPrice.toLocaleString()}원</strong></div>
        </div>
      `;
    };
    
    // 최신 금액 계산 (고객관리에서 수정된 금액 반영)
    const getLatestPrice = () => {
      if (isExtraWork || isCoWork) return props.price || 0;
      if (!customerInfo) return props.price || 0;
      
      // 기본 서비스 금액
      let basePrice = 0;
      if (customerInfo.services && customerInfo.services.length > 0) {
        basePrice = customerInfo.services.reduce((sum, s) => sum + (s.price || 0), 0);
      } else {
        basePrice = customerInfo.price || 0;
      }
      return basePrice;
    };
    
    // 마지막 작업일 가져오기
    const getLastWorkDate = () => {
      if (!customerInfo) return null;
      // 고객 데이터에 저장된 lastWorkDate 사용
      if (customerInfo.lastWorkDate) return customerInfo.lastWorkDate;
      // 없으면 events에서 찾기
      const customerEvents = events.filter(e => 
        (e.customerCode === props.customerCode || e.extendedProps?.customerCode === props.customerCode) &&
        (e.extendedProps?.status === '완료' || e.extendedProps?.status === '야근')
      );
      if (customerEvents.length > 0) {
        const sorted = customerEvents.sort((a, b) => new Date(b.start) - new Date(a.start));
        return sorted[0].start;
      }
      return null;
    };
    
    const latestPrice = getLatestPrice();
    const lastWorkDate = getLastWorkDate();
    const typeInfo = getCustomerTypeInfo(customerInfo);
    const equipmentHtml = getEquipmentHtml(customerInfo);
    
    let statusBtns = '';
    if (monthClosed) {
      statusBtns = '<div style="color:#64748b; padding:10px;">🔒 월마감 완료 - 수정 불가</div>';
    } else if (isDailyClosed) {
      statusBtns = '<div style="color:#64748b; padding:10px;">📋 일일마감 완료 - 수정 불가<br><small>해제하려면 일일마감 버튼을 다시 누르세요</small></div>';
    } else if (isCoWork) {
      // 공동작업자 이벤트는 완료 버튼 없음
      statusBtns = `
        <div style="color:#8b5cf6; padding:10px; background:#f3e8ff; border-radius:8px; margin-bottom:10px;">
          👥 공동작업 - 담당자(${props.mainStaffName || '?'})가 완료하면 자동 완료됩니다
        </div>
      `;
      // 폴더에 속한 공동작업이면 폴더 삭제 버튼 추가 (관리자용) - isFolder가 true인 경우만
      if (props.folderId && props.isFolder && (currentUser.role === 'master' || currentUser.role === 'master1')) {
        statusBtns += `
          <button onclick="window.deleteFolderAll('${props.folderId}')" class="popup-btn" style="background:#dc2626">🗑️ 폴더전체삭제</button>
        `;
      }
      // 개별 삭제 버튼
      statusBtns += `
        <button onclick="window.deleteCoWorkEvent('${event.id}')" class="popup-btn" style="background:#ef4444">🗑️ 이 공동작업 삭제</button>
      `;
    } else if (isExtraWork) {
      // 추가업무 이벤트
      if (props.status === '배정') {
        statusBtns = `
          <button onclick="window.completeExtraWork('${event.id}', '${props.extraWorkId || ''}')" class="popup-btn" style="background:#f97316">✅ 완료</button>
        `;
      } else {
        statusBtns = `
          <div style="background:#f0fdf4;padding:10px;border-radius:8px;margin-bottom:10px;">
            <div style="color:#059669;font-weight:bold;">✅ 완료됨</div>
            ${props.completedNote ? `<div style="margin-top:5px;color:#666;font-size:12px;">📝 ${props.completedNote}</div>` : ''}
          </div>
        `;
      }
      statusBtns += `
        <button onclick="window.openDateChange('${event.id}', '${event.startStr}')" class="popup-btn" style="background:#6366f1">📅 일정변경</button>
        <button onclick="window.deleteExtraWork('${event.id}', '${props.extraWorkId || ''}')" class="popup-btn" style="background:#ef4444">🗑️ 삭제</button>
      `;
    } else {
      // 담당자 이벤트
      // 고객의 구역 설정 확인
      const hasZones = customerInfo?.zones && customerInfo.zones.length > 0 && customerInfo.zoneTemplate;
      
      if (props.status === '배정') {
        if (hasZones) {
          // 구역 설정된 고객 - 리포트 버튼 추가
          statusBtns = `
            <button onclick="window.openReportPopup('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-large" style="background:#059669">📋 리포트 작성 후 완료</button>
            <button onclick="window.changeStatus('${event.id}', '완료')" class="popup-btn popup-btn-small" style="background:#10b981;margin-top:6px;">✅ 리포트 없이 완료</button>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px;">
              <button onclick="window.changeStatus('${event.id}', '야근')" class="popup-btn popup-btn-small" style="background:#7e22ce">🌙 야근</button>
              <button onclick="window.manageCoWorkers('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#8b5cf6">👥 공동</button>
              <button onclick="window.openNoWorkPopup('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#6b7280">⛔ 미작업</button>
            </div>
          `;
        } else {
          // 구역 설정 없는 고객 - 기존 방식
          statusBtns = `
            <button onclick="window.changeStatus('${event.id}', '완료')" class="popup-btn popup-btn-large" style="background:#059669">✅ 완료</button>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px;">
              <button onclick="window.changeStatus('${event.id}', '야근')" class="popup-btn popup-btn-small" style="background:#7e22ce">🌙 야근</button>
              <button onclick="window.manageCoWorkers('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#8b5cf6">👥 공동</button>
              <button onclick="window.openNoWorkPopup('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#6b7280">⛔ 미작업</button>
            </div>
          `;
        }
        // 폴더 이벤트인 경우에만 폴더 관련 버튼 추가 (isFolder가 true일 때)
        if (props.isFolder && props.folderId) {
          statusBtns += `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
              <button onclick="window.completeFolderAll('${props.folderId}', '완료')" class="popup-btn popup-btn-small" style="background:#10b981">📁 폴더완료</button>
              <button onclick="window.completeFolderAll('${props.folderId}', '야근')" class="popup-btn popup-btn-small" style="background:#7e22ce">🌙 폴더야근</button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px;">
              <button onclick="window.copyFolderEvent('${event.id}')" class="popup-btn popup-btn-small" style="background:#8b5cf6">📋 폴더복사</button>
              <button onclick="window.deleteFolderAll('${props.folderId}')" class="popup-btn popup-btn-small" style="background:#dc2626">🗑️ 폴더삭제</button>
            </div>
          `;
        }
        statusBtns += `
          <button onclick="window.openChangeStaff('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#0891b2;margin-top:8px;">👤 담당자 변경</button>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
            <button onclick="window.openDateChange('${event.id}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#6366f1">📅 일정변경</button>
            <button onclick="window.deletePlan('${event.id}', '${props.customerCode}', false)" class="popup-btn popup-btn-small" style="background:#ef4444">🗑️ 배정취소</button>
          </div>
          <button onclick="window.openCustomerStatusFromCalendar('${props.customerCode || customerInfo?.id || ''}'); Swal.close();" class="popup-btn popup-btn-small" style="background:#0369a1;margin-top:6px;">🔍 고객현황 업데이트</button>
          <button onclick="window.confirmSingleVisit('${event.id}')" class="popup-btn popup-btn-small" style="background:${props.visitConfirmed ? '#94a3b8' : '#0ea5e9'};margin-top:6px;">
            ${props.visitConfirmed ? '✅ 방문확정 완료됨' : '📲 방문확정 알림 발송'}
          </button>
          <button onclick="window.createClaimVisit('${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#dc2626;margin-top:6px;">🔧 클레임 추가방문 배정</button>
        `;
      } else if (props.status === '미작업') {
        // 미작업 상태
        statusBtns = `
          <div style="background:#f3f4f6;padding:12px;border-radius:8px;margin-bottom:10px;">
            <div style="color:#6b7280;font-weight:bold;">⛔ 미작업 완료</div>
            ${props.noWorkReason ? `<div style="margin-top:5px;color:#666;font-size:12px;">📝 ${props.noWorkReason}</div>` : ''}
            ${props.isCarryOver ? `<div style="margin-top:5px;color:#f59e0b;font-size:12px;">🔄 이월작업 생성됨</div>` : ''}
          </div>
          <button onclick="window.cancelComplete('${event.id}')" class="popup-btn popup-btn-small" style="background:#f59e0b">↩️ 완료취소</button>
        `;
      } else {
        // 완료/야근 상태
        statusBtns = `<button onclick="window.cancelComplete('${event.id}')" class="popup-btn popup-btn-small" style="background:#f59e0b">↩️ 완료취소</button>`;
        // ① certTarget 여부 상관없이 소독증명서 발급 버튼 표시
        statusBtns += `<button onclick="window.reissueCert('${event.id}')" class="popup-btn popup-btn-small" style="background:#059669;margin-top:6px;">🧾 소독증명서 발급</button>`;
        // ③ 발급 이력 조회 버튼
        statusBtns += `<button onclick="window.showCertLogs('${props.customerCode}', '${props.customerName || ''}')" class="popup-btn popup-btn-small" style="background:#6366f1;margin-top:6px;">📋 발급 이력</button>`;
        // 방역 사진 공유 버튼
        statusBtns += `<button onclick="window.shareWorkPhoto('${event.id}', '${props.customerCode}')" class="popup-btn popup-btn-small" style="background:#8b5cf6;margin-top:6px;">📸 방역 사진 고객에게 공유</button>`;
      }
      if (props.status !== '배정') {
        statusBtns += `
          <button onclick="window.openChangeStaff('${event.id}', '${props.customerCode}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#0891b2;margin-top:8px;">👤 담당자 변경</button>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
            <button onclick="window.openDateChange('${event.id}', '${event.startStr}')" class="popup-btn popup-btn-small" style="background:#6366f1">📅 일정변경</button>
            <button onclick="window.deletePlan('${event.id}', '${props.customerCode}', false)" class="popup-btn popup-btn-small" style="background:#ef4444">🗑️ 배정취소</button>
          </div>
        `;
      }
    }
    
    // 배경색 설정
    let bgColor = '#f8fafc';
    if (isCoWork) bgColor = '#f3e8ff';
    else if (props.status === '미작업') bgColor = '#f3f4f6'; // 미작업 - 회색
    else if (props.isFolder) bgColor = '#ede9fe'; // 폴더 이벤트 (isFolder가 true일 때만)
    else if (isExtraWork) bgColor = '#fff7ed';
    else if (isSpecialWork) bgColor = '#fef3c7';

    Swal.fire({
      title: event.title,
      html: `
        <div style="text-align:left; padding:10px; background:${bgColor}; border-radius:8px; margin-bottom:15px;">
          ${props.isFolder ? `<div style="color:#8b5cf6; font-weight:bold; margin-bottom:5px;">📁 폴더: ${props.folderName || '폴더'}</div>` : ''}
          ${isCoWork ? '<div style="color:#8b5cf6; font-weight:bold; margin-bottom:5px;">👥 공동작업</div>' : ''}
          ${isExtraWork ? `<div style="color:#f97316; font-weight:bold; margin-bottom:5px;">📝 추가업무 [${props.category || '기타'}]</div>` : ''}
          ${isSpecialWork && !isCoWork ? '<div style="color:#f59e0b; font-weight:bold; margin-bottom:5px;">🌟 특별작업</div>' : ''}
          ${!isExtraWork && !isCoWork ? `<div style="color:${typeInfo.type === '부정기' ? '#d97706' : '#059669'}; font-weight:bold; margin-bottom:5px; padding:4px 8px; background:${typeInfo.type === '부정기' ? '#fef3c7' : '#dcfce7'}; border-radius:4px; display:inline-block;">📅 ${typeInfo.type}${typeInfo.months ? `(${typeInfo.months.join(',')})` : ''}</div>` : ''}
          ${props.unpaid > 0 && !isExtraWork ? `<div style="color:#dc2626; font-weight:bold; margin-bottom:5px; padding:5px; background:#fee2e2; border-radius:4px;">💰 미수금: ${parseInt(props.unpaid).toLocaleString()}원</div>` : ''}
          ${!isExtraWork ? `<div style="font-size:11px;color:#666;margin-bottom:5px;">🏷️ 코드: ${props.customerCode || '-'}${props.displayCode ? ` (${props.displayCode})` : ''}</div>` : ''}
          ${!isExtraWork ? `<div>📍 ${props.address || '-'}</div>` : ''}
          ${!isExtraWork ? `<div>📞 ${props.phone || '-'}</div>` : ''}
          <div>💵 ${isExtraWork ? (props.price > 0 ? `${parseInt(props.price).toLocaleString()}원` : '무료') : `${parseInt(latestPrice || 0).toLocaleString()}원${isCoWork ? ' (공동작업비)' : ''}`}</div>
          ${equipmentHtml}
          ${customerInfo?.customerStatus ? `
            <div style="margin-top:8px;padding:8px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">
              <div style="font-size:11px;font-weight:bold;color:#0369a1;margin-bottom:4px;">📊 고객현황</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${customerInfo.customerStatus.preferredTime ? `<span style="background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:10px;font-size:11px;">⏰ ${customerInfo.customerStatus.preferredTime}</span>` : ''}
                ${(customerInfo.customerStatus.mainIssues||[]).map(i => `<span style="background:#fee2e2;color:#dc2626;padding:1px 6px;border-radius:10px;font-size:11px;">⚠️ ${i}</span>`).join('')}
                ${customerInfo.customerStatus.accessMethod ? `<span style="background:#f0fdf4;color:#059669;padding:1px 6px;border-radius:10px;font-size:11px;">🔑 ${customerInfo.customerStatus.accessMethod}</span>` : ''}
                ${(customerInfo.customerStatus.customerTrait||[]).slice(0,2).map(t => `<span style="background:#ede9fe;color:#7c3aed;padding:1px 6px;border-radius:10px;font-size:11px;">${t}</span>`).join('')}
              </div>
              ${customerInfo.customerStatus.siteNote ? `<div style="font-size:11px;color:#64748b;margin-top:4px;font-style:italic;">📝 ${customerInfo.customerStatus.siteNote.slice(0,60)}</div>` : ''}
            </div>
          ` : ''}
          <div>👤 담당: ${props.staffName || '-'}</div>
          ${!isExtraWork && !isCoWork && lastWorkDate ? `<div style="color:#6366f1;">🕐 최근작업: ${lastWorkDate}</div>` : ''}
          ${isCoWork && props.mainStaffName ? `<div>👤 주담당: ${props.mainStaffName}</div>` : ''}
          <div>📋 상태: <b style="color:${isExtraWork && props.status === '완료' ? '#059669' : getStatusColor(props.status, isCoWork)}">${props.status}</b></div>
          ${props.completedBy ? `<div>✅ 완료자: ${props.completedBy}</div>` : ''}
        </div>
        ${statusBtns}
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  };

  // ===== 고객현황 열기 (배정플랜에서) =====
  window.openCustomerStatusFromCalendar = (customerCode) => {
    if (window.__openCustomerStatus) {
      window.__openCustomerStatus(customerCode);
    }
  };

  // ===== 담당자 변경 (배정플랜 팝업에서) =====
  window.openChangeStaff = async (eventId, customerCode, eventDate) => {
    Swal.close();

    // 고객 정보
    const customer = customers.find(c => c.id === customerCode || c.code === customerCode);
    if (!customer) {
      Swal.fire('오류', '고객 정보를 찾을 수 없습니다.', 'error');
      return;
    }

    // 현재 담당자 정보
    const eventMonth = eventDate.substring(0, 7); // "2025-05"
    const currentBase = customer.staffName || '(없음)';
    const currentOnetime = customer.onetimeStaff?.[eventMonth] || null;
    const currentEffective = currentOnetime || currentBase;

    // 직원 목록 옵션
    const staffOpts = staffList.map(s =>
      `<option value="${s.name}" ${s.name === currentEffective ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const [yr, mo] = eventMonth.split('-');
    const monthLabel = `${yr}년 ${parseInt(mo)}월`;

    const { value: changeType } = await Swal.fire({
      title: '👤 담당자 변경',
      html: `
        <div style="text-align:left;padding:0 4px;">
          <div style="background:#f1f5f9;padding:12px;border-radius:8px;margin-bottom:14px;font-size:13px;">
            <div>고객: <b>${customer.name}</b></div>
            <div style="margin-top:4px;">기본 담당자: <b style="color:#1e40af;">${currentBase}</b></div>
            ${currentOnetime ? `<div style="margin-top:4px;">이번달(${monthLabel}) 1회성: <b style="color:#059669;">${currentOnetime}</b></div>` : ''}
            <div style="margin-top:4px;">현재 적용중: <b style="color:#0891b2;">${currentEffective}</b></div>
          </div>
          <div style="font-size:13px;font-weight:bold;color:#374151;margin-bottom:10px;">어떻게 변경할까요?</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button type="button" id="btn-base" style="padding:14px;background:#1e40af;color:white;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:bold;text-align:left;">
              👤 기본 담당자로 변경
              <div style="font-size:11px;font-weight:normal;opacity:0.85;margin-top:3px;">전체 월에 적용 · 영구 변경</div>
            </button>
            <button type="button" id="btn-onetime" style="padding:14px;background:#0891b2;color:white;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:bold;text-align:left;">
              🔁 1회성 담당자로 변경
              <div style="font-size:11px;font-weight:normal;opacity:0.85;margin-top:3px;">${monthLabel}만 적용 · 다음달 기본 담당자로 자동 복귀</div>
            </button>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true,
      didOpen: () => {
        document.getElementById('btn-base').addEventListener('click', () => Swal.close({ value: 'base' }));
        document.getElementById('btn-onetime').addEventListener('click', () => Swal.close({ value: 'onetime' }));
      },
    });

    if (!changeType) return;

    // 직원 선택
    const { value: newStaffName } = await Swal.fire({
      title: changeType === 'base' ? '👤 기본 담당자 선택' : `🔁 ${monthLabel} 1회성 담당자 선택`,
      html: `
        <div style="font-size:13px;color:#6b7280;margin-bottom:12px;">
          ${changeType === 'base'
            ? '선택한 직원이 <b>전체 월의 기본 담당자</b>로 변경됩니다.'
            : `선택한 직원이 <b>${monthLabel}만</b> 담당합니다.<br>다음달부터는 기본 담당자(${currentBase})로 자동 복귀됩니다.`}
        </div>
        <select id="new-staff-select" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;">
          <option value="">-- 직원 선택 --</option>
          ${staffOpts}
        </select>
      `,
      showCancelButton: true,
      confirmButtonText: '변경',
      cancelButtonText: '취소',
      confirmButtonColor: changeType === 'base' ? '#1e40af' : '#0891b2',
      preConfirm: () => {
        const val = document.getElementById('new-staff-select').value;
        if (!val) { Swal.showValidationMessage('직원을 선택해주세요'); return false; }
        return val;
      },
    });

    if (!newStaffName) return;

    try {
      Swal.fire({ title: '변경 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const newStaffMember = staffList.find(s => s.name === newStaffName);
      const newStaffId = newStaffMember?.visibleId || '';

      if (changeType === 'base') {
        // ── 기본 담당자 변경 ──────────────────────────────
        // 1) 고객 staffName 업데이트
        await updateDoc(doc(db, 'customers', customer.id), {
          staffName: newStaffName,
        });

        // 2) 이 달 미완료 이벤트 staffName/staffId 동기화
        const monthEvents = events.filter(e => {
          const eCode = e.extendedProps?.customerCode;
          return (eCode === customerCode || eCode === customer.id) &&
            (e.start || '').startsWith(eventMonth) &&
            e.extendedProps?.status === '배정';
        });
        await Promise.all(monthEvents.map(e =>
          updateDoc(doc(db, 'events', e.id), { staffName: newStaffName, staffId: newStaffId })
        ));

        await fetchData();
        Swal.fire({
          icon: 'success',
          title: '기본 담당자 변경 완료',
          html: `<b>${newStaffName}</b>이(가) <b>${customer.name}</b>의 기본 담당자로 변경되었습니다.<br><span style="font-size:12px;color:#6b7280;">전체 월에 적용됩니다.</span>`,
          timer: 2000, showConfirmButton: false,
        });

      } else {
        // ── 1회성 담당자 변경 ────────────────────────────
        // 1) 고객 onetimeStaff 업데이트
        const updatedOnetime = { ...(customer.onetimeStaff || {}), [eventMonth]: newStaffName };
        await updateDoc(doc(db, 'customers', customer.id), {
          onetimeStaff: updatedOnetime,
        });

        // 2) 이 달 배정 이벤트 staffName/staffId 동기화
        const monthEvents = events.filter(e => {
          const eCode = e.extendedProps?.customerCode;
          return (eCode === customerCode || eCode === customer.id) &&
            (e.start || '').startsWith(eventMonth) &&
            e.extendedProps?.status === '배정';
        });
        await Promise.all(monthEvents.map(e =>
          updateDoc(doc(db, 'events', e.id), { staffName: newStaffName, staffId: newStaffId })
        ));

        await fetchData();
        Swal.fire({
          icon: 'success',
          title: '1회성 담당자 변경 완료',
          html: `<b>${monthLabel}</b>만 <b>${newStaffName}</b>이(가) 담당합니다.<br><span style="font-size:12px;color:#6b7280;">다음달부터는 기본 담당자(${currentBase})로 자동 복귀됩니다.</span>`,
          timer: 2500, showConfirmButton: false,
        });
      }
    } catch (e) {
      console.error('담당자 변경 오류:', e);
      Swal.fire('오류', '담당자 변경에 실패했습니다: ' + e.message, 'error');
    }
  };

  // ── 개별 방문확정 알림 발송 ─────────────────────
  window.confirmSingleVisit = async (eventId) => {
    Swal.close();
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    if (event.extendedProps?.visitConfirmed) {
      Swal.fire({ toast: true, position: 'top', icon: 'info', title: '이미 방문확정 알림을 보냈어요', timer: 2000, showConfirmButton: false });
      return;
    }
    const custCode = event.extendedProps?.customerCode;
    const customer = customers.find(c => c.id === custCode || c.code === custCode);
    const { isConfirmed } = await Swal.fire({
      title: '📲 방문확정 알림 발송',
      html: `<b>${customer?.name || '고객'}</b>님께 방문 일정 확정 알림을 보낼까요?<br><small style="color:#64748b">${event.start || event.extendedProps?.date || ''}</small>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '알림 발송',
      cancelButtonText: '취소',
      confirmButtonColor: '#0ea5e9',
    });
    if (!isConfirmed) return;
    const result = await confirmVisitAndNotify(event, customers);
    if (result.success) {
      Swal.fire({ toast: true, position: 'top', icon: 'success', title: `${result.customerName}님께 알림 발송 완료!`, timer: 2000, showConfirmButton: false });
      fetchData();
    } else {
      Swal.fire({ toast: true, position: 'top', icon: 'warning', title: `알림 발송 실패: ${result.reason}`, timer: 3000, showConfirmButton: false });
    }
  };

  // ── 날짜 전체 방문확정 알림 발송 ────────────────
  window.confirmAllVisitsForDay = async (dateStr) => {
    const dayEvents = events.filter(e => {
      const d = e.start || e.extendedProps?.date || '';
      return d.startsWith(dateStr) && (e.extendedProps?.status || e.status) === '배정' && !e.extendedProps?.isCoWork;
    });
    const unconfirmed = dayEvents.filter(e => !e.extendedProps?.visitConfirmed);
    if (unconfirmed.length === 0) {
      Swal.fire({ toast: true, position: 'top', icon: 'info', title: '이 날짜의 모든 고객에게 이미 알림을 보냈어요', timer: 2500, showConfirmButton: false });
      return;
    }
    const names = unconfirmed.map(e => {
      const c = customers.find(x => x.id === e.extendedProps?.customerCode || x.code === e.extendedProps?.customerCode);
      return c?.name || '고객';
    });
    const { isConfirmed } = await Swal.fire({
      title: `📲 ${dateStr} 방문확정 알림`,
      html: `<b>${unconfirmed.length}명</b>의 고객에게 방문 확정 알림을 보낼까요?<br><small style="color:#64748b">${names.slice(0,5).join(', ')}${names.length > 5 ? ` 외 ${names.length-5}명` : ''}</small>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '전체 발송',
      cancelButtonText: '취소',
      confirmButtonColor: '#0ea5e9',
    });
    if (!isConfirmed) return;
    Swal.fire({ title: '발송 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const result = await confirmAllVisitsForDate(dateStr, events, customers);
    Swal.fire({
      icon: result.confirmed > 0 ? 'success' : 'warning',
      title: `알림 발송 완료`,
      html: `✅ ${result.confirmed}명 발송${result.failed > 0 ? `<br>⚠️ ${result.failed}명 실패 (앱 미설치)` : ''}`,
      timer: 3000, showConfirmButton: false,
    });
    fetchData();
  };

    // 상태 변경
  window.changeStatus = async (eventId, status) => {
    Swal.close();
    
    // 완료자 결정
    let completedBy = '';
    if (status === '완료' || status === '야근') {
      if (isAdminView) {
        completedBy = currentUser.name;
      } else if (currentViewMode !== 'self' && currentViewMode !== currentUser.id) {
        const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
        completedBy = viewingStaff ? viewingStaff.name : currentUser.name;
      } else {
        completedBy = currentUser.name;
      }

      // 🧪 약제 팝업 (완료/야근 시)
      const _evtDoc = events.find(e => e.id === eventId);
      const _custCode = _evtDoc?.extendedProps?.customerCode;
      const _custName = _evtDoc?.extendedProps?.customerName || _evtDoc?.title || '';
      if (_custCode) {
        // 고객 certTarget 여부 확인
        const _custObj = customers.find(c =>
          String(c.code) === String(_custCode) || String(c.id) === String(_custCode)
        );
        const _isCertRequired = !!_custObj?.certTarget;
        const _pesticideResult = await showPesticidePopup(
          String(_custCode), _custName,
          { required: _isCertRequired }
        );
        // 필수인데 취소하면 완료 처리 중단
        if (_isCertRequired && _pesticideResult === null) {
          Swal.fire({
            toast: true, position: 'top', icon: 'warning',
            title: '약제 기입이 필요합니다. 완료가 취소되었습니다.',
            timer: 2500, showConfirmButton: false
          });
          return;
        }
      }
    }

    try {
      // 담당자 이벤트 업데이트
      await updateDoc(doc(db, 'events', eventId), { 
        status, 
        completedBy,
        completedAt: new Date().toISOString()
      });
      
      // 공동작업자 이벤트도 같이 업데이트 (parentEventId로 연결된 것)
      const coWorkSnap = await getDocs(query(
        collection(db, 'events'),
        where('parentEventId', '==', eventId)
      ));
      
      for (const coWorkDoc of coWorkSnap.docs) {
        await updateDoc(doc(db, 'events', coWorkDoc.id), {
          status,
          completedBy: completedBy + ' (담당자)',
          completedAt: new Date().toISOString()
        });
      }
      
      // 완료/야근 시 고객의 마지막 작업일 업데이트
      if (status === '완료' || status === '야근') {
        // 고객의 마지막 작업일 업데이트
        try {
          const eventDoc = events.find(e => e.id === eventId);
          const custCode = eventDoc?.extendedProps?.customerCode;
          if (eventDoc && custCode) {
            const customerDoc = customers.find(c => c.id === custCode || c.code === custCode);
            if (customerDoc) {
              await updateDoc(doc(db, 'customers', customerDoc.id), {
                lastWorkDate: eventDoc.start || toLocalDateStr(new Date())
              });
            }
          }
        } catch (e) {
          console.log('마지막 작업일 업데이트 오류:', e);
        }
      }

      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: `${status} 처리됨` });

      fetchData();

      // 🧾 소독증명서 자동발송 팝업 (완료/야근 시)
      if (status === '완료' || status === '야근') {
        try {
          const eventDoc = events.find(e => e.id === eventId);
          const custCode = eventDoc?.extendedProps?.customerCode;
          if (custCode) {
            let customerDoc = customers.find(c =>
              String(c.id) === String(custCode) || String(c.code) === String(custCode)
            );
            const workDate = eventDoc.start || eventDoc.extendedProps?.date || toLocalDateStr(new Date());

            if (!customerDoc?.certTarget) {
              // certTarget 아닌 고객: showCertPopup 설정 확인
              if (settings.showCertPopup !== false) {
                // ON: 모달 팝업으로 소독증명서 발급 여부 확인
                const r = await Swal.fire({
                  title: '✅ 작업 완료!',
                  html: `<div style="font-size:13px;color:#374151;line-height:1.8;">
                    <b>${customerDoc?.name || ''}</b> 작업이 완료 처리됐어요.<br>
                    <span style="color:#6b7280;font-size:12px;">소독증명서가 필요하신가요?</span>
                  </div>`,
                  icon: 'success',
                  showConfirmButton: true,
                  confirmButtonText: '🧾 소독증명서 발급',
                  showDenyButton: true,
                  denyButtonText: '필요없음',
                  confirmButtonColor: '#059669',
                  denyButtonColor: '#9ca3af',
                });
                if (r.isConfirmed) {
                  const { loadCustomerPesticides } = await import('./pesticideUtils');
                  const pesticideData = await loadCustomerPesticides(String(custCode));
                  await showCertSendPopup({
                    customer: customerDoc,
                    workDate,
                    pesticides: pesticideData?.pesticides || [],
                    certNo: '',
                  });
                }
              }
              // OFF: 팝업 없이 완료 처리만 (토스트로 가볍게 알림)
              else {
                Swal.fire({
                  toast: true, position: 'bottom',
                  icon: 'success',
                  title: `✅ ${customerDoc?.name || ''} 완료!`,
                  timer: 2000,
                  showConfirmButton: false,
                });
              }
            }

            if (customerDoc?.certTarget) {
              const _workDate = workDate;

              // ── 필수항목 체크 ──────────────────────────────────
              const requiredFields = [
                { key: 'name',    label: '상호(고객명)',   placeholder: '예) 피에프창용산아이파크몰점' },
                { key: 'area',    label: '실시 면적(㎡)',  placeholder: '예) 500',  type: 'number' },
                { key: 'address', label: '소재지',         placeholder: '예) 서울특별시 용산구 한강대로23길 55' },
                { key: 'ceoName', label: '대표자 성명',    placeholder: '예) 홍길동' },
              ];

              const missing = requiredFields.filter(f =>
                !customerDoc[f.key] || String(customerDoc[f.key]).trim() === '' || String(customerDoc[f.key]).trim() === '-'
              );

              if (missing.length > 0) {
                // 미입력 항목 입력 팝업
                const { value: filled, isConfirmed } = await Swal.fire({
                  title: '📋 소독증명서 필수 정보 입력',
                  html: `
                    <div style="text-align:left;font-size:13px;">
                      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
                        <div style="font-weight:bold;color:#92400e;margin-bottom:4px;">⚠️ 소독증명서 발급에 필요한 정보가 없습니다</div>
                        <div style="color:#78350f;font-size:12px;">아래 항목을 입력해야 증명서 발급이 가능합니다</div>
                      </div>
                      ${missing.map(f => `
                        <div style="margin-bottom:10px;">
                          <label style="font-size:12px;font-weight:bold;color:#374151;display:block;margin-bottom:4px;">
                            ${f.label} <span style="color:#ef4444;">*</span>
                          </label>
                          <input id="cert-req-${f.key}"
                            type="${f.type || 'text'}"
                            value="${customerDoc[f.key] || ''}"
                            placeholder="${f.placeholder}"
                            style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box;">
                        </div>`).join('')}
                    </div>`,
                  showCancelButton: true,
                  confirmButtonText: '저장 후 발급',
                  cancelButtonText: '나중에',
                  confirmButtonColor: '#059669',
                  allowOutsideClick: false,
                  preConfirm: () => {
                    const result = {};
                    for (const f of missing) {
                      const val = document.getElementById(`cert-req-${f.key}`)?.value?.trim();
                      if (!val) {
                        Swal.showValidationMessage(`${f.label}을(를) 입력해 주세요`);
                        return false;
                      }
                      result[f.key] = val;
                    }
                    return result;
                  },
                });

                if (!isConfirmed || !filled) {
                  // 나중에 → 발급 취소
                  return;
                }

                // Firestore 고객 정보 업데이트
                try {
                  await updateDoc(doc(db, 'customers', customerDoc.id), filled);
                  customerDoc = { ...customerDoc, ...filled };
                } catch (e) {
                  console.warn('고객정보 저장 오류:', e);
                }
              }

              // ── 약제 데이터 로드 후 발급 팝업 ──────────────
              const { loadCustomerPesticides } = await import('./pesticideUtils');
              const pesticideData = await loadCustomerPesticides(String(custCode));
              const pesticides = pesticideData?.pesticides || [];

              await showCertSendPopup({
                customer:   customerDoc,
                workDate:   _workDate,
                pesticides: pesticides,
                certNo:     '',
              });
            }
          }
        } catch (e) {
          console.log('소독증명서 팝업 오류:', e);
        }
      }
    } catch (error) {
      Swal.fire('오류', '상태 변경 실패', 'error');
    }
  };

  // 폴더 전체 완료
  window.completeFolderAll = async (folderId, status) => {
    Swal.close();
    
    const folder = folders.find(f => f.id === folderId);
    if (!folder) {
      // 배정된 폴더의 경우 events에서 찾기
      const folderEvents = events.filter(e => e.extendedProps?.folderId === folderId);
      if (folderEvents.length === 0) {
        Swal.fire('알림', '폴더 정보를 찾을 수 없습니다', 'info');
        return;
      }
      
      const confirm = await Swal.fire({
        title: '📁 폴더 전체 완료',
        text: `${folderEvents.length}건의 작업을 모두 ${status === '야근' ? '야근' : '완료'} 처리하시겠습니까?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: status === '야근' ? '전체 야근' : '전체 완료',
        cancelButtonText: '취소',
        confirmButtonColor: status === '야근' ? '#7e22ce' : '#10b981'
      });
      
      if (!confirm.isConfirmed) return;
      
      await handleFolderComplete(folderId, status);
      return;
    }
    
    const confirm = await Swal.fire({
      title: `📁 ${folder.name} ${status === '야근' ? '전체 야근' : '전체 완료'}`,
      html: `
        <div style="text-align:left;">
          <div>${folder.customerIds?.length || 0}건의 작업을 모두 ${status === '야근' ? '야근' : '완료'} 처리합니다.</div>
          ${folder.coWorkers?.length > 0 ? `
            <div style="margin-top:10px;padding:10px;background:#ede9fe;border-radius:8px;">
              <div style="font-weight:bold;margin-bottom:5px;">👥 공동작업자도 함께 완료됩니다:</div>
              ${folder.coWorkers.map(cw => `<div>• ${cw.staffName}: ${cw.price.toLocaleString()}원</div>`).join('')}
            </div>
          ` : ''}
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: status === '야근' ? '전체 야근' : '전체 완료',
      cancelButtonText: '취소',
      confirmButtonColor: status === '야근' ? '#7e22ce' : '#10b981'
    });
    
    if (!confirm.isConfirmed) return;
    
    await handleFolderComplete(folderId, status);
  };

  // 폴더 전체 삭제
  window.deleteFolderAll = async (folderId) => {
    Swal.close();
    
    // 폴더에 속한 모든 이벤트 찾기
    const folderEvents = events.filter(e => e.extendedProps?.folderId === folderId);
    
    if (folderEvents.length === 0) {
      Swal.fire('알림', '삭제할 이벤트가 없습니다', 'info');
      return;
    }
    
    const confirm = await Swal.fire({
      title: '🗑️ 폴더 전체 삭제',
      html: `
        <div style="text-align:left;">
          <div style="color:#dc2626;font-weight:bold;">⚠️ ${folderEvents.length}건의 이벤트를 모두 삭제합니다.</div>
          <div style="margin-top:10px;padding:10px;background:#fee2e2;border-radius:8px;font-size:12px;">
            담당자와 공동작업자 이벤트가 모두 삭제됩니다.<br>
            이 작업은 되돌릴 수 없습니다.
          </div>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '전체 삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#dc2626'
    });
    
    if (!confirm.isConfirmed) return;
    
    try {
      // 모든 관련 이벤트 삭제
      for (const event of folderEvents) {
        await deleteDoc(doc(db, 'events', event.id));
      }
      
      // 폴더 상태 업데이트 (삭제됨)
      try {
        await updateDoc(doc(db, 'folders', folderId), {
          status: 'deleted',
          deletedAt: new Date().toISOString()
        });
      } catch (e) {
        // 폴더 문서가 없을 수도 있음
        console.log('폴더 문서 업데이트 실패:', e);
      }
      
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: `${folderEvents.length}건 삭제됨`,
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('폴더 삭제 오류:', error);
      Swal.fire('오류', '폴더 삭제 실패', 'error');
    }
  };

  // 📋 폴더 복사 (0원으로 추가 배정)
  window.copyFolderEvent = async (eventId) => {
    Swal.close();

    const originalEvent = events.find(e => e.id === eventId);
    if (!originalEvent) {
      Swal.fire('오류', '원본 이벤트를 찾을 수 없습니다', 'error');
      return;
    }

    const props = originalEvent.extendedProps;
    const originalDate = originalEvent.start;

    // 복사 설정 팝업
    const { value: formData } = await Swal.fire({
      title: `📋 ${originalEvent.title} 복사`,
      html: `
        <div style="text-align:left;">
          <div style="padding:10px;background:#ede9fe;border-radius:8px;margin-bottom:15px;">
            <div style="font-size:13px;color:#6d28d9;">원본: <b>${originalEvent.title}</b></div>
            <div style="font-size:12px;color:#7c3aed;">날짜: ${originalDate} | 금액: ${(props.price || 0).toLocaleString()}원</div>
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="font-size:13px;font-weight:bold;color:#374151;">복사 횟수</label>
            <input type="number" id="copy-count" value="3" min="1" max="10" 
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:16px;margin-top:4px;">
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="font-size:13px;font-weight:bold;color:#374151;">복사본 금액</label>
            <input type="number" id="copy-price" value="0" min="0" 
              style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:16px;margin-top:4px;">
            <div style="font-size:11px;color:#9ca3af;margin-top:2px;">0원이면 무료 추가작업</div>
          </div>

          <div id="date-inputs-container">
            <label style="font-size:13px;font-weight:bold;color:#374151;">배정 날짜</label>
            <div id="date-inputs" style="margin-top:4px;"></div>
          </div>
          
          <div style="font-size:11px;color:#9ca3af;margin-top:8px;">
            💡 공동작업자도 함께 복사됩니다 (0원)
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '복사',
      cancelButtonText: '취소',
      confirmButtonColor: '#8b5cf6',
      width: '95%',
      didOpen: () => {
        const countInput = document.getElementById('copy-count');
        const dateContainer = document.getElementById('date-inputs');
        
        const generateDateInputs = () => {
          const count = parseInt(countInput.value) || 1;
          let html = '';
          for (let i = 0; i < count; i++) {
            html += `
              <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                <span style="font-size:12px;color:#6b7280;min-width:45px;">${i + 1}회차</span>
                <input type="date" class="copy-date-input" value="" 
                  style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;">
              </div>
            `;
          }
          dateContainer.innerHTML = html;
        };
        
        countInput.addEventListener('input', generateDateInputs);
        generateDateInputs();
      },
      preConfirm: () => {
        const dates = Array.from(document.querySelectorAll('.copy-date-input'))
          .map(input => input.value)
          .filter(d => d !== '');
        
        if (dates.length === 0) {
          Swal.showValidationMessage('최소 1개 날짜를 입력하세요');
          return false;
        }
        
        return {
          dates,
          price: parseInt(document.getElementById('copy-price').value) || 0
        };
      }
    });

    if (!formData) return;

    try {
      Swal.fire({ title: '복사 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      let copyCount = 0;

      for (const date of formData.dates) {
        // 담당자 이벤트 복사
        const copyRef = await addDoc(collection(db, 'events'), {
          title: originalEvent.title.replace('📁 ', ''),
          date: date,
          price: formData.price,
          status: '배정',
          staffId: props.staffId,
          staffName: props.staffName,
          folderId: props.folderId,
          folderName: props.folderName,
          isFolder: true,
          customerIds: props.customerIds || [],
          customerNames: props.customerNames || [],
          workType: 'folder',
          isCopy: true, // 복사본 표시
          originalEventId: eventId,
          createdAt: new Date().toISOString()
        });

        // 공동작업자도 함께 복사 (0원)
        const coWorkSnap = await getDocs(query(
          collection(db, 'events'),
          where('parentEventId', '==', eventId)
        ));
        
        for (const coWorkDoc of coWorkSnap.docs) {
          const coData = coWorkDoc.data();
          await addDoc(collection(db, 'events'), {
            title: coData.title,
            date: date,
            price: 0,
            coWorkPrice: 0,
            status: '배정',
            staffId: coData.staffId,
            staffName: coData.staffName,
            isCoWork: true,
            folderId: props.folderId,
            folderName: props.folderName,
            mainStaffName: props.staffName,
            parentEventId: copyRef.id,
            workType: 'folder',
            isCopy: true,
            createdAt: new Date().toISOString()
          });
        }

        copyCount++;
      }

      Swal.fire({
        toast: true, position: 'top', icon: 'success',
        title: `📋 ${copyCount}건 복사 완료 (${formData.price.toLocaleString()}원)`,
        timer: 2000, showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('폴더 복사 오류:', error);
      Swal.fire('오류', '복사 실패', 'error');
    }
  };

  // 공동작업 개별 삭제
  window.deleteCoWorkEvent = async (eventId) => {
    Swal.close();
    
    const confirm = await Swal.fire({
      title: '공동작업 삭제',
      text: '이 공동작업을 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });
    
    if (!confirm.isConfirmed) return;
    
    try {
      await deleteDoc(doc(db, 'events', eventId));
      
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: '삭제됨',
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('공동작업 삭제 오류:', error);
      Swal.fire('오류', '삭제 실패', 'error');
    }
  };

  // 미작업 팝업
  window.openNoWorkPopup = async (eventId, customerCode, eventDate) => {
    Swal.close();
    
    const result = await Swal.fire({
      title: '⛔ 미작업 처리',
      html: `
        <div style="text-align:left;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">미작업 사유</label>
          <textarea id="nowork-reason" placeholder="예: 고객 부재, 일정 변경 요청 등" 
            style="width:100%;height:80px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;resize:none;"></textarea>
          <div style="margin-top:15px;padding:12px;background:#fef3c7;border-radius:8px;">
            <div style="font-size:13px;font-weight:bold;color:#92400e;margin-bottom:8px;">🔄 이월작업</div>
            <div style="font-size:12px;color:#666;margin-bottom:8px;">다음달에 해달라는 요청 시 체크하세요.<br>다음달 첫째 날에 이월고객으로 추가 생성됩니다.</div>
            <label style="display:flex;align-items:center;cursor:pointer;">
              <input type="checkbox" id="carry-over-check" style="width:18px;height:18px;margin-right:8px;">
              <span style="font-size:13px;">이월작업으로 처리</span>
            </label>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '⛔ 미작업 완료',
      cancelButtonText: '취소',
      confirmButtonColor: '#6b7280',
      preConfirm: () => {
        const reason = document.getElementById('nowork-reason').value.trim();
        const isCarryOver = document.getElementById('carry-over-check').checked;
        if (!reason) {
          Swal.showValidationMessage('미작업 사유를 입력하세요');
          return false;
        }
        return { reason, isCarryOver };
      }
    });

    if (!result.isConfirmed) return;

    const { reason, isCarryOver } = result.value;

    try {
      Swal.fire({ title: '처리중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      // 이벤트 상태를 미작업으로 변경
      await updateDoc(doc(db, 'events', eventId), {
        status: '미작업',
        noWorkReason: reason,
        isCarryOver: isCarryOver,
        completedBy: currentUser.name,
        completedAt: new Date().toISOString()
      });

      // 이월작업인 경우: 다음달 대기목록에 이월 고객 직접 추가
      if (isCarryOver) {
        const customer = customers.find(c => c.id === customerCode);
        if (customer) {
          // 다음달 계산
          const eventDateObj = new Date(eventDate);
          const carryNextMonth = eventDateObj.getMonth() + 2; // 0-indexed + 1 for next
          const carryNextYear = carryNextMonth > 12 ? eventDateObj.getFullYear() + 1 : eventDateObj.getFullYear();
          const carryMonth = carryNextMonth > 12 ? carryNextMonth - 12 : carryNextMonth;

          // staffId 결정: 이벤트 담당자 > 고객 담당자 > staffName 검색 > 현재 뷰 직원
          const eventDoc = events.find(e => e.id === eventId);
          let carryStaffId = eventDoc?.extendedProps?.staffId || null;
          
          // admin이 아닌 유효한 staffId인지 확인
          if (!carryStaffId || carryStaffId === 'admin') {
            carryStaffId = (customer.staffId && customer.staffId !== 'admin') ? customer.staffId : null;
          }
          if (!carryStaffId) {
            // 1회성 담당 반영: 다음달 이월 시 다음달 기준 effective staff 사용
            const carryMonthStr = `${carryNextYear}-${String(carryMonth).padStart(2,'0')}`;
            const effectiveName = getEffectiveStaffName(customer, carryMonthStr);
            const staffMember = staffList.find(s => s.name === effectiveName);
            if (staffMember) carryStaffId = staffMember.visibleId;
          }
          if (!carryStaffId) {
            carryStaffId = currentUser.id;
          }

          // 이월 고객 → 다음달 대기목록에 직접 생성 (events 컬렉션)
          await addDoc(collection(db, 'events'), {
            customerCode: customerCode,
            customerId: customerCode,
            title: customer.name,
            date: '', // 날짜 미지정 (대기)
            staffId: carryStaffId,
            staffName: staffList.find(s => s.visibleId === carryStaffId)?.name || customer.staffName || currentUser.name,
            price: customer.prices?.regular || customer.price || 0,
            status: '대기',
            workType: 'regular',
            isCarryOver: true,
            carryOverFrom: eventDate,
            carryOverMonth: eventDateObj.getMonth() + 1,
            targetMonth: carryMonth,
            targetYear: carryNextYear,
            phone: customer.phone || '',
            address: customer.address || '',
            createdAt: new Date().toISOString()
          });
        }
      }

      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: isCarryOver ? '⛔ 미작업 + 🔄 이월 생성' : '⛔ 미작업 완료',
        timer: 2000,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('미작업 처리 오류:', error);
      Swal.fire('오류', '처리 실패', 'error');
    }
  };

  // 작업 리포트 팝업
  window.openReportPopup = async (eventId, customerCode, eventDate) => {
    Swal.close();
    
    const customer = customers.find(c => c.id === customerCode);
    if (!customer || !customer.zones || customer.zones.length === 0) {
      Swal.fire('알림', '구역 설정이 없습니다. 고객관리에서 구역을 설정해주세요.', 'info');
      return;
    }

    const enabledZones = customer.zones.filter(z => z.enabled !== false);
    
    // 하위구역별 입력 폼 생성 함수 (모바일 최적화)
    const createSubZoneForm = (zoneIdx, subZoneIdx, subZoneName, isOnlySubZone = false) => {
      const dataKey = `${zoneIdx}-${subZoneIdx}`;
      return `
        <div class="subzone-form" data-key="${dataKey}" style="background:#fff;padding:14px;border-radius:10px;margin-bottom:10px;border-left:4px solid #3b82f6;">
          <div style="font-size:15px;color:#1e40af;font-weight:bold;margin-bottom:12px;">${isOnlySubZone ? '' : '└ '}${subZoneName}</div>
          
          <!-- 트랩 -->
          <div style="margin-bottom:12px;">
            <div style="font-size:13px;color:#374151;margin-bottom:8px;font-weight:600;">🪤 트랩 포획</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <div style="text-align:center;flex:1;min-width:70px;">
                <div style="font-size:12px;color:#666;margin-bottom:4px;">쥐</div>
                <input type="number" class="trap-rat" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:10px 6px;text-align:center;border:2px solid #e5e7eb;border-radius:8px;font-size:16px;font-weight:bold;">
              </div>
              <div style="text-align:center;flex:1;min-width:70px;">
                <div style="font-size:12px;color:#666;margin-bottom:4px;">바퀴</div>
                <input type="number" class="trap-roach" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:10px 6px;text-align:center;border:2px solid #e5e7eb;border-radius:8px;font-size:16px;font-weight:bold;">
              </div>
              <div style="text-align:center;flex:1;min-width:70px;">
                <div style="font-size:12px;color:#666;margin-bottom:4px;">페로몬</div>
                <input type="number" class="trap-pheromone" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:10px 6px;text-align:center;border:2px solid #e5e7eb;border-radius:8px;font-size:16px;font-weight:bold;">
              </div>
            </div>
          </div>
          
          <!-- 포충기 -->
          <div style="margin-bottom:12px;">
            <div style="font-size:13px;color:#374151;margin-bottom:8px;font-weight:600;">💡 포충기 포획</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">파리</div><input type="number" class="light-fly" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">나방</div><input type="number" class="light-moth" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">나방파리</div><input type="number" class="light-mothfly" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">하루살이</div><input type="number" class="light-mayfly" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">초파리</div><input type="number" class="light-fruitfly" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">모기</div><input type="number" class="light-mosquito" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
              <div style="text-align:center;"><div style="font-size:11px;color:#666;margin-bottom:2px;">기타</div><input type="number" class="light-other" data-key="${dataKey}" value="0" min="0" style="width:100%;padding:8px 4px;text-align:center;border:2px solid #e5e7eb;border-radius:6px;font-size:15px;font-weight:bold;"></div>
            </div>
          </div>
          
          <!-- 발견 해충 -->
          <div style="margin-bottom:12px;">
            <div style="font-size:13px;color:#374151;margin-bottom:8px;font-weight:600;">🪳 발견해충</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
              <span style="font-size:14px;font-weight:500;">바퀴:</span>
              <select class="pest-roach-type" data-key="${dataKey}" style="padding:10px;font-size:15px;border:2px solid #e5e7eb;border-radius:8px;min-width:80px;">
                <option value="">없음</option><option value="일본">일본</option><option value="미국">미국</option><option value="독일">독일</option><option value="먹">먹</option><option value="산">산</option><option value="경도">경도</option>
              </select>
              <input type="number" class="pest-roach-count" data-key="${dataKey}" value="0" min="0" style="width:60px;padding:10px;text-align:center;border:2px solid #e5e7eb;border-radius:8px;font-size:15px;font-weight:bold;">
              <span style="font-size:14px;">마리</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
              <span style="font-size:14px;font-weight:500;">쥐:</span>
              <select class="pest-rat-type" data-key="${dataKey}" style="padding:10px;font-size:15px;border:2px solid #e5e7eb;border-radius:8px;min-width:80px;">
                <option value="">없음</option><option value="시궁">시궁</option><option value="집">집</option><option value="생">생</option><option value="땃">땃</option>
              </select>
              <input type="number" class="pest-rat-count" data-key="${dataKey}" value="0" min="0" style="width:60px;padding:10px;text-align:center;border:2px solid #e5e7eb;border-radius:8px;font-size:15px;font-weight:bold;">
              <span style="font-size:14px;">마리</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              <label style="display:flex;align-items:center;padding:8px 12px;background:#f3f4f6;border-radius:8px;font-size:13px;"><input type="checkbox" class="pest-other" data-key="${dataKey}" value="파리" style="width:20px;height:20px;margin-right:6px;">파리</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#f3f4f6;border-radius:8px;font-size:13px;"><input type="checkbox" class="pest-other" data-key="${dataKey}" value="개미" style="width:20px;height:20px;margin-right:6px;">개미</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#f3f4f6;border-radius:8px;font-size:13px;"><input type="checkbox" class="pest-other" data-key="${dataKey}" value="나방파리" style="width:20px;height:20px;margin-right:6px;">나방파리</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#f3f4f6;border-radius:8px;font-size:13px;"><input type="checkbox" class="pest-other" data-key="${dataKey}" value="초파리" style="width:20px;height:20px;margin-right:6px;">초파리</label>
            </div>
          </div>
          
          <!-- 작업 -->
          <div style="margin-bottom:10px;">
            <div style="font-size:13px;color:#374151;margin-bottom:8px;font-weight:600;">🔧 작업</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              <label style="display:flex;align-items:center;padding:8px 12px;background:#dbeafe;border-radius:8px;font-size:13px;"><input type="checkbox" class="work-item" data-key="${dataKey}" value="점검" style="width:20px;height:20px;margin-right:6px;">점검</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#dbeafe;border-radius:8px;font-size:13px;"><input type="checkbox" class="work-item" data-key="${dataKey}" value="약제살포" style="width:20px;height:20px;margin-right:6px;">약제살포</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#dbeafe;border-radius:8px;font-size:13px;"><input type="checkbox" class="work-item" data-key="${dataKey}" value="트랩교체" style="width:20px;height:20px;margin-right:6px;">트랩교체</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#dbeafe;border-radius:8px;font-size:13px;"><input type="checkbox" class="work-item" data-key="${dataKey}" value="청소권고" style="width:20px;height:20px;margin-right:6px;">청소권고</label>
              <label style="display:flex;align-items:center;padding:8px 12px;background:#dbeafe;border-radius:8px;font-size:13px;"><input type="checkbox" class="work-item" data-key="${dataKey}" value="포충기점검" style="width:20px;height:20px;margin-right:6px;">포충기점검</label>
            </div>
          </div>
          
          <!-- 메모 -->
          <input type="text" class="subzone-memo" data-key="${dataKey}" placeholder="메모 입력" style="width:100%;padding:12px;font-size:15px;border:2px solid #e5e7eb;border-radius:8px;box-sizing:border-box;">
        </div>
      `;
    };

    // 구역별 입력 폼 생성
    const zonesHtml = enabledZones.map((zone, idx) => {
      const subZones = (zone.subZones || []).filter(sz => sz.enabled !== false);
      
      let subZonesHtml = '';
      if (subZones.length > 0) {
        // 하위구역이 있으면 하위구역별로 폼 생성
        subZonesHtml = subZones.map((sz, szIdx) => createSubZoneForm(idx, szIdx, sz.name, false)).join('');
      } else {
        // 하위구역이 없으면 구역 자체에서 폼 생성
        subZonesHtml = createSubZoneForm(idx, 0, '전체', true);
      }
      
      return `
        <div class="report-zone" data-idx="${idx}" style="background:#f8fafc;padding:12px;border-radius:10px;margin-bottom:12px;border:1px solid #e5e7eb;">
          <div style="font-weight:bold;color:#1e40af;margin-bottom:10px;font-size:14px;padding-bottom:8px;border-bottom:2px solid #3b82f6;">
            📍 ${idx + 1}. ${zone.name}
          </div>
          ${subZonesHtml}
        </div>
      `;
    }).join('');

    // 현재 시간 기본값
    const now = new Date();
    const defaultHour = now.getHours();
    const defaultMin = Math.floor(now.getMinutes() / 5) * 5;

    // 시간 옵션 생성 (00~23)
    const hourOptions = Array.from({length: 24}, (_, i) => 
      `<option value="${i}" ${i === defaultHour ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`
    ).join('');

    // 분 옵션 생성 (00, 05, 10, ..., 55)
    const minOptions = Array.from({length: 12}, (_, i) => {
      const m = i * 5;
      return `<option value="${m}" ${m === defaultMin ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>`;
    }).join('');

    // 소요 시간 버튼 (5분~120분) - 모바일 최적화
    const durationButtons = [5, 10, 15, 20, 25, 30, 40, 50, 60, 90, 120].map(m => 
      `<button type="button" class="duration-btn" data-minutes="${m}" style="padding:12px 16px;margin:4px;border:2px solid #e5e7eb;border-radius:10px;background:#fff;font-size:15px;font-weight:600;cursor:pointer;min-width:60px;min-height:48px;">${m >= 60 ? (m/60) + '시간' : m + '분'}</button>`
    ).join('');

    const result = await Swal.fire({
      title: `📋 작업 리포트`,
      html: `
        <div style="text-align:left;max-height:500px;overflow-y:auto;padding:5px;">
          <div style="background:#dbeafe;padding:14px;border-radius:12px;margin-bottom:14px;">
            <div style="font-weight:bold;color:#1e40af;font-size:17px;">🏢 ${customer.name}</div>
            <div style="color:#3b82f6;margin-top:6px;font-size:15px;">📅 ${eventDate}</div>
          </div>
          
          <!-- 작업 시작 시간 -->
          <div style="background:#ecfdf5;padding:16px;border-radius:12px;margin-bottom:14px;border:2px solid #86efac;">
            <div style="font-size:14px;color:#166534;font-weight:bold;margin-bottom:12px;">⏰ 작업 시작 시간</div>
            <div style="display:flex;align-items:center;gap:12px;justify-content:center;">
              <select id="start-hour" style="padding:14px 20px;font-size:20px;border:2px solid #86efac;border-radius:10px;font-weight:bold;background:#fff;">
                ${hourOptions}
              </select>
              <span style="font-size:24px;font-weight:bold;color:#166534;">:</span>
              <select id="start-min" style="padding:14px 20px;font-size:20px;border:2px solid #86efac;border-radius:10px;font-weight:bold;background:#fff;">
                ${minOptions}
              </select>
            </div>
          </div>
          
          ${zonesHtml}
          
          <!-- 사진 첨부 -->
          <div style="padding:10px;background:#fef3c7;border-radius:8px;margin-bottom:12px;">
            <div style="font-size:11px;color:#92400e;margin-bottom:6px;">📸 사진 첨부 (선택)</div>
            <input type="file" id="report-photos" multiple accept="image/*" style="font-size:11px;">
          </div>
          
          <!-- 작업 소요 시간 -->
          <div style="background:#f0fdf4;padding:12px;border-radius:8px;border:1px solid #86efac;">
            <div style="font-size:12px;color:#166534;font-weight:bold;margin-bottom:8px;">⏱️ 작업 소요 시간</div>
            <div id="duration-buttons" style="display:flex;flex-wrap:wrap;justify-content:center;">
              ${durationButtons}
            </div>
            <div id="time-result" style="margin-top:14px;padding:16px;background:#dcfce7;border-radius:12px;text-align:center;display:none;border:2px solid #86efac;">
              <div style="font-size:18px;font-weight:bold;color:#166534;">
                📌 <span id="start-time-display">00:00</span> ~ <span id="end-time-display">00:00</span>
              </div>
              <div style="font-size:15px;color:#15803d;margin-top:6px;font-weight:600;">총 <span id="duration-display">0</span>분</div>
            </div>
          </div>
        </div>
      `,
      width: '95%',
      showCancelButton: true,
      confirmButtonText: '📋 리포트 저장 + 완료',
      cancelButtonText: '취소',
      confirmButtonColor: '#059669',
      didOpen: () => {
        // 소요 시간 버튼 클릭 이벤트
        let selectedDuration = 0;
        
        document.querySelectorAll('.duration-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            // 버튼 스타일 초기화
            document.querySelectorAll('.duration-btn').forEach(b => {
              b.style.background = '#fff';
              b.style.borderColor = '#e5e7eb';
              b.style.color = '#333';
            });
            
            // 선택된 버튼 스타일
            this.style.background = '#059669';
            this.style.borderColor = '#059669';
            this.style.color = '#fff';
            
            selectedDuration = parseInt(this.dataset.minutes);
            
            // 시간 계산
            const startHour = parseInt(document.getElementById('start-hour').value);
            const startMin = parseInt(document.getElementById('start-min').value);
            
            const startTotalMin = startHour * 60 + startMin;
            const endTotalMin = startTotalMin + selectedDuration;
            
            const endHour = Math.floor(endTotalMin / 60) % 24;
            const endMin = endTotalMin % 60;
            
            // 결과 표시
            document.getElementById('start-time-display').textContent = 
              String(startHour).padStart(2, '0') + ':' + String(startMin).padStart(2, '0');
            document.getElementById('end-time-display').textContent = 
              String(endHour).padStart(2, '0') + ':' + String(endMin).padStart(2, '0');
            document.getElementById('duration-display').textContent = selectedDuration;
            document.getElementById('time-result').style.display = 'block';
          });
        });
        
        // 시작 시간 변경 시 종료 시간 재계산
        ['start-hour', 'start-min'].forEach(id => {
          document.getElementById(id).addEventListener('change', () => {
            const selectedBtn = document.querySelector('.duration-btn[style*="background: rgb(5, 150, 105)"]');
            if (selectedBtn) selectedBtn.click();
          });
        });
      },
      preConfirm: () => {
        // 소요 시간 선택 확인
        const selectedBtn = document.querySelector('.duration-btn[style*="background: rgb(5, 150, 105)"]');
        if (!selectedBtn) {
          Swal.showValidationMessage('작업 소요 시간을 선택해주세요');
          return false;
        }
        
        const startHour = parseInt(document.getElementById('start-hour').value);
        const startMin = parseInt(document.getElementById('start-min').value);
        const duration = parseInt(selectedBtn.dataset.minutes);
        
        const startTotalMin = startHour * 60 + startMin;
        const endTotalMin = startTotalMin + duration;
        const endHour = Math.floor(endTotalMin / 60) % 24;
        const endMin = endTotalMin % 60;
        
        // 리포트 데이터 수집
        const reportData = {
          customerId: customerCode,
          customerName: customer.name,
          eventId: eventId,
          date: eventDate,
          staffId: currentUser.id,
          staffName: currentUser.name,
          // 작업 시간 정보
          startTime: String(startHour).padStart(2, '0') + ':' + String(startMin).padStart(2, '0'),
          endTime: String(endHour).padStart(2, '0') + ':' + String(endMin).padStart(2, '0'),
          duration: duration,
          zones: []
        };

        enabledZones.forEach((zone, idx) => {
          const subZones = (zone.subZones || []).filter(sz => sz.enabled !== false);
          const zoneData = {
            name: zone.name,
            subZones: []
          };

          // 하위구역 데이터 수집
          const subZoneCount = subZones.length > 0 ? subZones.length : 1;
          for (let szIdx = 0; szIdx < subZoneCount; szIdx++) {
            const dataKey = `${idx}-${szIdx}`;
            const subZoneName = subZones.length > 0 ? subZones[szIdx].name : '전체';
            
            const subZoneData = {
              name: subZoneName,
              traps: {
                rat: Number(document.querySelector('.trap-rat[data-key="' + dataKey + '"]')?.value) || 0,
                roach: Number(document.querySelector('.trap-roach[data-key="' + dataKey + '"]')?.value) || 0,
                pheromone: Number(document.querySelector('.trap-pheromone[data-key="' + dataKey + '"]')?.value) || 0
              },
              lightTrap: {
                fly: Number(document.querySelector('.light-fly[data-key="' + dataKey + '"]')?.value) || 0,
                moth: Number(document.querySelector('.light-moth[data-key="' + dataKey + '"]')?.value) || 0,
                mothfly: Number(document.querySelector('.light-mothfly[data-key="' + dataKey + '"]')?.value) || 0,
                mayfly: Number(document.querySelector('.light-mayfly[data-key="' + dataKey + '"]')?.value) || 0,
                fruitfly: Number(document.querySelector('.light-fruitfly[data-key="' + dataKey + '"]')?.value) || 0,
                mosquito: Number(document.querySelector('.light-mosquito[data-key="' + dataKey + '"]')?.value) || 0,
                other: Number(document.querySelector('.light-other[data-key="' + dataKey + '"]')?.value) || 0
              },
              pests: {
                roach: {
                  type: document.querySelector('.pest-roach-type[data-key="' + dataKey + '"]')?.value || '',
                  count: Number(document.querySelector('.pest-roach-count[data-key="' + dataKey + '"]')?.value) || 0
                },
                rat: {
                  type: document.querySelector('.pest-rat-type[data-key="' + dataKey + '"]')?.value || '',
                  count: Number(document.querySelector('.pest-rat-count[data-key="' + dataKey + '"]')?.value) || 0
                },
                others: []
              },
              work: [],
              memo: document.querySelector('.subzone-memo[data-key="' + dataKey + '"]')?.value || ''
            };

            // 기타 해충 체크
            document.querySelectorAll('.pest-other[data-key="' + dataKey + '"]:checked').forEach(cb => {
              subZoneData.pests.others.push(cb.value);
            });

            // 작업 내용 체크
            document.querySelectorAll('.work-item[data-key="' + dataKey + '"]:checked').forEach(cb => {
              subZoneData.work.push(cb.value);
            });

            zoneData.subZones.push(subZoneData);
          }

          reportData.zones.push(zoneData);
        });

        return reportData;
      }
    });

    if (!result.isConfirmed || !result.value) return;

    // 🧪 약제 팝업 (certTarget 필수 여부 확인)
    const _certRequired = !!customers.find(c =>
      String(c.code) === String(customerCode) || String(c.id) === String(customerCode)
    )?.certTarget;
    const _pestResult = await showPesticidePopup(
      String(customerCode), customer.name, { required: _certRequired }
    );
    if (_certRequired && _pestResult === null) {
      Swal.fire({
        toast: true, position: 'top', icon: 'warning',
        title: '약제 기입이 필요합니다. 완료가 취소되었습니다.',
        timer: 2500, showConfirmButton: false
      });
      return;
    }

    try {
      Swal.fire({ title: '저장중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      // 리포트 저장
      const reportData = {
        ...result.value,
        createdAt: new Date().toISOString()
      };
      
      const reportDocRef = await addDoc(collection(db, 'reports'), reportData);

      // 이벤트 완료 처리
      await updateDoc(doc(db, 'events', eventId), {
        status: '완료',
        completedBy: currentUser.name,
        completedAt: new Date().toISOString(),
        hasReport: true
      });

      // 공동작업자 이벤트도 완료 처리
      const eventSnap = await getDocs(collection(db, 'events'));
      const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);
      for (const coWorkDoc of coWorkEvents) {
        await updateDoc(doc(db, 'events', coWorkDoc.id), {
          status: '완료',
          completedBy: currentUser.name + ' (담당자)',
          completedAt: new Date().toISOString()
        });
      }

      // 공유하기 팝업
      const reportUrl = `${window.location.origin}/report/${reportDocRef.id}`;
      
      const shareResult = await Swal.fire({
        title: '✅ 리포트 저장 완료!',
        html: `
          <div style="text-align:center;">
            <div style="background:#dcfce7;padding:15px;border-radius:10px;margin-bottom:15px;">
              <div style="font-size:14px;color:#166534;font-weight:bold;">🏢 ${customer.name}</div>
              <div style="font-size:13px;color:#15803d;margin-top:5px;">
                ⏰ ${result.value.startTime} ~ ${result.value.endTime} (${result.value.duration}분)
              </div>
            </div>
            <p style="font-size:13px;color:#666;margin-bottom:10px;">고객에게 리포트를 공유하시겠습니까?</p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '📤 공유하기',
        cancelButtonText: '나중에',
        confirmButtonColor: '#3b82f6'
      });

      if (shareResult.isConfirmed) {
        // Web Share API 사용
        const shareData = {
          title: '화이트라인 작업 리포트',
          text: `[${customer.name}] ${eventDate} 방제작업 리포트입니다.\n작업시간: ${result.value.startTime} ~ ${result.value.endTime}`,
          url: reportUrl
        };

        try {
          if (navigator.share) {
            await navigator.share(shareData);
          } else {
            // PC: 클립보드 복사
            await navigator.clipboard.writeText(reportUrl);
            Swal.fire({
              toast: true,
              position: 'top',
              icon: 'success',
              title: '📋 링크가 복사되었습니다!',
              timer: 2000,
              showConfirmButton: false
            });
          }
        } catch (shareError) {
          console.log('공유 취소 또는 오류:', shareError);
        }
      }

      fetchData();
    } catch (error) {
      console.error('리포트 저장 오류:', error);
      Swal.fire('오류', '저장 실패', 'error');
    }
  };

  // 추가업무 완료
  window.completeExtraWork = async (eventId, extraWorkId) => {
    const { value: note } = await Swal.fire({
      title: '📝 추가업무 완료',
      html: `
        <div style="text-align:left;">
          <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">완료 내용 (간략히)</label>
          <textarea id="extra-note" placeholder="예: 상담 완료, 계약 진행 예정" 
            style="width:100%;height:80px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;resize:none;"></textarea>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '완료',
      cancelButtonText: '취소',
      confirmButtonColor: '#059669',
      preConfirm: () => document.getElementById('extra-note').value.trim()
    });

    if (note === undefined) return; // 취소 시

    try {
      // 이벤트 상태 업데이트
      await updateDoc(doc(db, 'events', eventId), {
        status: '완료',
        completedNote: note,
        completedBy: currentUser.name,
        completedAt: new Date().toISOString()
      });

      // extraWork 상태 업데이트
      if (extraWorkId) {
        await updateDoc(doc(db, 'extraWork', extraWorkId), {
          status: '완료',
          completedNote: note,
          completedBy: currentUser.name,
          completedAt: new Date().toISOString()
        });
      }

      Swal.fire({
        icon: 'success',
        title: '완료 처리됨',
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('추가업무 완료 오류:', error);
      Swal.fire('오류', '완료 처리 실패', 'error');
    }
  };

  // 추가업무 삭제
  window.deleteExtraWork = async (eventId, extraWorkId) => {
    const result = await Swal.fire({
      title: '삭제 확인',
      text: '이 추가업무를 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });

    if (!result.isConfirmed) return;

    try {
      // 이벤트 삭제
      await deleteDoc(doc(db, 'events', eventId));

      // extraWork 삭제
      if (extraWorkId) {
        await deleteDoc(doc(db, 'extraWork', extraWorkId));
      }

      Swal.fire({
        icon: 'success',
        title: '삭제됨',
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('추가업무 삭제 오류:', error);
      Swal.fire('오류', '삭제 실패', 'error');
    }
  };

  // 🔧 클레임 추가방문 배정 + 고객 알림
  window.createClaimVisit = async (custCode, fromDateStr) => {
    Swal.close();
    const customer = customers.find(c => c.id === custCode || c.code === custCode);
    if (!customer) return;

    // 날짜 & 메모 입력
    const { value, isConfirmed } = await Swal.fire({
      title: `🔧 클레임 추가방문 배정`,
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="font-weight:bold;color:#1e293b;margin-bottom:12px;">${customer.name}</div>
          <label style="display:block;margin-bottom:4px;color:#374151;">방문 날짜 *</label>
          <input type="date" id="claim-date" value="${fromDateStr || ''}" min="${new Date().toISOString().split('T')[0]}"
            style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;">
          <label style="display:block;margin-bottom:4px;color:#374151;">클레임 내용 *</label>
          <textarea id="claim-memo" placeholder="클레임 발생 경위 및 처리 내용을 입력하세요"
            style="width:100%;height:80px;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;resize:none;box-sizing:border-box;"></textarea>
          <div style="margin-top:12px;padding:10px;background:#fef2f2;border-radius:8px;">
            <div style="font-size:12px;color:#dc2626;font-weight:bold;">배정 후 고객 앱에 자동 알림이 발송됩니다</div>
          </div>
        </div>`,
      showCancelButton: true,
      confirmButtonText: '🔧 배정 + 알림 발송',
      cancelButtonText: '취소',
      confirmButtonColor: '#dc2626',
      preConfirm: () => {
        const date = document.getElementById('claim-date').value;
        const memo = document.getElementById('claim-memo').value.trim();
        if (!date) { Swal.showValidationMessage('날짜를 선택해주세요'); return false; }
        if (!memo) { Swal.showValidationMessage('클레임 내용을 입력해주세요'); return false; }
        return { date, memo };
      },
    });
    if (!isConfirmed) return;
    const { date, memo } = value;

    Swal.fire({ title: '배정 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
      // 담당 직원 결정
      let staffId   = currentUser.id;
      let staffName = currentUser.name;
      if (currentViewMode !== 'self' && currentViewMode !== 'admin' && currentViewMode !== currentUser.id) {
        const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
        if (viewingStaff) { staffId = viewingStaff.visibleId; staffName = viewingStaff.name; }
      }

      // 이벤트 생성
      const newEvent = await addDoc(collection(db, 'events'), {
        customerCode:  customer.id,
        customerId:    customer.id,
        customerName:  customer.name,
        staffId,
        staffName,
        date,
        status:        '배정',
        isClaimVisit:  true,
        memo,
        price:         0,
        visitConfirmed: false,
        createdAt:     new Date().toISOString(),
      });

      // 방문확정 알림 발송 (isClaimVisit=true)
      const eventObj = {
        id: newEvent.id,
        start: date,
        extendedProps: {
          customerCode: customer.id,
          staffName,
          isClaimVisit: true,
        },
      };
      const notifyResult = await confirmVisitAndNotify(eventObj, customers);

      fetchData();

      Swal.fire({
        icon: 'success',
        title: '클레임 추가방문 배정 완료!',
        html: `<b>${customer.name}</b>님 ${date} 추가방문 배정<br>
          <small style="color:#64748b">${notifyResult.success ? '✅ 고객 앱 알림 발송 완료' : '⚠️ 알림 발송 실패 (앱 미설치)'}</small>`,
        timer: 3000, showConfirmButton: false,
      });
    } catch (e) {
      console.error('클레임 배정 오류:', e);
      Swal.fire('오류', '배정에 실패했어요. 다시 시도해주세요.', 'error');
    }
  };

  // 🔧 클레임 추가방문 배정 + 고객 알림 (끝)

  // 📸 방역 사진 고객 공유
  window.shareWorkPhoto = async (eventId, custCode) => {
    Swal.close();
    const customer = customers.find(c => c.id === custCode || c.code === custCode);
    if (!customer) {
      Swal.fire('오류', '고객 정보를 찾을 수 없어요.', 'error');
      return;
    }

    // 파일 선택 UI
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async (e) => {
      document.body.removeChild(input);
      const files = Array.from(e.target.files).slice(0, 5);
      if (files.length === 0) return;

      Swal.fire({ title: '사진 업로드 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      try {
        const { getStorage, ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage();
        const urls = [];

        for (const file of files) {
          const ext  = file.name.split('.').pop() || 'jpg';
          const path = `work-photos/${customer.id}/${eventId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          const storageRef = sRef(storage, path);
          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);
          urls.push(url);
        }

        // Firestore workPhotos 저장
        const event = events.find(ev => ev.id === eventId);
        await addDoc(collection(db, 'workPhotos'), {
          eventId,
          customerId:   customer.id,
          customerCode: customer.code || '',
          customerName: customer.name || '',
          staffName:    currentUser?.name || '',
          photoUrls:    urls,
          workDate:     event?.start || event?.extendedProps?.date || '',
          createdAt:    new Date().toISOString(),
        });

        // customerNotifications 저장
        await addDoc(collection(db, 'customerNotifications'), {
          customerId:  customer.id,
          type:        'work_photo',
          title:       '📸 방역 완료 사진이 도착했어요',
          body:        `${currentUser?.name || '담당자'}님이 방역 완료 사진 ${urls.length}장을 공유했어요`,
          photoUrls:   urls,
          eventId,
          read:        false,
          createdAt:   new Date().toISOString(),
        });

        // FCM 푸시 (customerPush 유틸 사용)
        const { sendPushToCustomer } = await import('../utils/customerPush');
        await sendPushToCustomer(customer.id, {
          title: '📸 방역 완료 사진이 도착했어요',
          body:  `${urls.length}장의 사진을 확인해보세요`,
          data:  { type: 'work_photo', eventId },
        });

        Swal.fire({
          icon: 'success',
          title: '사진 공유 완료!',
          html: `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:8px;">
            ${urls.slice(0,3).map(u => `<img src="${u}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;">`).join('')}
          </div>`,
          timer: 3000, showConfirmButton: false,
        });
      } catch (err) {
        console.error('사진 공유 오류:', err);
        Swal.fire('오류', '사진 업로드에 실패했어요. 잠시 후 다시 시도해주세요.', 'error');
      }
    };

    input.click();
  };

  // 완료 취소
  // 🧾 소독증명서 재발급
  window.reissueCert = async (eventId) => {
    Swal.close();
    try {
      const eventDocSnap = await getDoc(doc(db, 'events', eventId));
      if (!eventDocSnap.exists()) return;
      const evData = eventDocSnap.data();
      const custCode = evData.customerCode || evData.extendedProps?.customerCode || '';
      const workDate = evData.date || evData.start || new Date().toISOString().split('T')[0];
      const customerDoc = customers.find(c =>
        String(c.id) === String(custCode) || String(c.code) === String(custCode)
      );
      if (!customerDoc) {
        Swal.fire('알림', '고객 정보를 찾을 수 없습니다.', 'warning');
        return;
      }
      const { loadCustomerPesticides } = await import('./pesticideUtils');
      const pd = await loadCustomerPesticides(String(custCode));
      const { showCertSendPopup } = await import('../utils/certPdfSender');
      await showCertSendPopup({
        customer:   customerDoc,
        workDate,
        pesticides: pd?.pesticides || [],
      });
    } catch (e) {
      console.error('소독증명서 재발급 오류:', e);
      Swal.fire('오류', '소독증명서 발급 중 오류가 발생했습니다.', 'error');
    }
  };

  // ③ 발급 이력 조회
  window.showCertLogs = async (custCode, custName) => {
    Swal.close();
    try {
      const { collection: col, query: q, where, orderBy: ob, getDocs: gd } = await import('firebase/firestore');
      const { db: fdb } = await import('../firebase');
      const snap = await gd(q(
        col(fdb, 'certLogs'),
        where('customerId', '==', String(custCode)),
        ob('sentAt', 'desc')
      ));
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (!logs.length) {
        Swal.fire({
          title: '📋 발급 이력',
          html: `<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px;">
            <div style="font-size:32px;margin-bottom:8px;">📭</div>
            ${custName || custCode}의 발급 이력이 없어요
          </div>`,
          confirmButtonText: '확인',
        });
        return;
      }

      const methodLabel = { print: '🖨️ 인쇄', email: '📧 이메일', kakao_share: '💬 카카오공유', kakao_download: '📥 카카오저장', email_download: '📥 이메일저장' };
      const rows = logs.map(l => `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 6px;font-size:12px;color:#374151;">${(l.workDate || l.issuedAt?.slice(0,10) || '-')}</td>
          <td style="padding:8px 6px;font-size:12px;color:#374151;">제 ${l.certNo || '-'} 호</td>
          <td style="padding:8px 6px;font-size:12px;">${methodLabel[l.sendMethod] || l.sendMethod || '-'}</td>
          <td style="padding:8px 6px;font-size:11px;color:${l.success ? '#059669' : '#ef4444'};">${l.success ? '✅ 성공' : '❌ 실패'}</td>
        </tr>
      `).join('');

      Swal.fire({
        title: `📋 발급 이력 — ${custName || custCode}`,
        width: '90%',
        html: `
          <div style="max-height:320px;overflow-y:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#1e3a5f;color:white;">
                  <th style="padding:8px 6px;text-align:left;font-size:11px;">작업일</th>
                  <th style="padding:8px 6px;text-align:left;font-size:11px;">필증번호</th>
                  <th style="padding:8px 6px;text-align:left;font-size:11px;">발급방법</th>
                  <th style="padding:8px 6px;text-align:left;font-size:11px;">결과</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:8px;text-align:right;">총 ${logs.length}건</div>
        `,
        confirmButtonText: '닫기',
        confirmButtonColor: '#6366f1',
      });
    } catch (e) {
      console.error('발급이력 조회 오류:', e);
      Swal.fire('오류', '발급 이력을 불러오지 못했습니다.', 'error');
    }
  };

  window.cancelComplete = async (eventId) => {
    Swal.close();
    try {
      // 현재 이벤트 정보 가져오기 (단건 조회)
      const eventDocSnap = await getDoc(doc(db, 'events', eventId));
      // eslint-disable-next-line no-unused-vars
      const currentEvent = eventDocSnap.exists() ? eventDocSnap.data() : null;
      
      // 담당자 이벤트 취소
      await updateDoc(doc(db, 'events', eventId), { status: '배정', completedBy: '', completedAt: '' });
      
      // 공동작업자 이벤트도 같이 취소 (쿼리 최적화)
      const coWorkSnap = await getDocs(query(
        collection(db, 'events'),
        where('parentEventId', '==', eventId)
      ));
      
      for (const coWorkDoc of coWorkSnap.docs) {
        await updateDoc(doc(db, 'events', coWorkDoc.id), {
          status: '배정',
          completedBy: '',
          completedAt: ''
        });
      }
      
      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: '완료 취소됨' });
      fetchData();
    } catch (error) {
      Swal.fire('오류', '취소 실패', 'error');
    }
  };

  // 📦 일괄완료: 해당 날짜 미완료 이벤트 전부 완료 처리
  const handleBulkComplete = async (dateStr, mode) => {
    const dateEvents = events.filter(e => e.start === dateStr);
    const pendingEvents = dateEvents.filter(e => 
      !['완료', '야근', '미작업', '마감완료'].includes(e.extendedProps?.status) && 
      !e.extendedProps?.isCoWork // 공동작업자는 담당자 완료 시 자동 처리
    );

    if (pendingEvents.length === 0) {
      Swal.fire('알림', '완료할 일정이 없습니다', 'info');
      return;
    }

    const result = await Swal.fire({
      title: `✅ ${dateStr} 일괄완료`,
      html: `<div style="font-size:16px;"><b>${pendingEvents.length}건</b>을 모두 완료 처리합니다.</div>
        <div style="max-height:200px;overflow-y:auto;margin-top:10px;text-align:left;">
          ${pendingEvents.map(e => `<div style="padding:4px 8px;font-size:13px;">• ${e.title}</div>`).join('')}
        </div>`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: `✅ ${pendingEvents.length}건 완료`,
      cancelButtonText: '취소',
      confirmButtonColor: '#059669'
    });

    if (!result.isConfirmed) return;

    try {
      Swal.fire({ title: '처리 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      let completedBy = '';
      if (isAdminView) {
        completedBy = currentUser.name;
      } else if (currentViewMode !== 'self' && currentViewMode !== currentUser.id) {
        const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
        completedBy = viewingStaff ? viewingStaff.name : currentUser.name;
      } else {
        completedBy = currentUser.name;
      }

      let count = 0;
      for (const event of pendingEvents) {
        // 담당자 이벤트 완료
        await updateDoc(doc(db, 'events', event.id), {
          status: '완료',
          completedBy,
          completedAt: new Date().toISOString()
        });

        // 공동작업자 이벤트도 같이 완료
        const coWorkSnap = await getDocs(query(
          collection(db, 'events'),
          where('parentEventId', '==', event.id)
        ));
        for (const coWorkDoc of coWorkSnap.docs) {
          await updateDoc(doc(db, 'events', coWorkDoc.id), {
            status: '완료',
            completedBy: completedBy + ' (담당자)',
            completedAt: new Date().toISOString()
          });
        }

        // 고객 마지막 작업일 업데이트
        try {
          const custCode = event.extendedProps?.customerCode;
          if (custCode) {
            const customerDoc = customers.find(c => c.id === custCode || c.code === custCode);
            if (customerDoc) {
              await updateDoc(doc(db, 'customers', customerDoc.id), {
                lastWorkDate: event.start || dateStr
              });
            }
          }
        } catch (e) { /* skip */ }

        count++;
      }

      Swal.fire({
        toast: true, position: 'top', icon: 'success',
        title: `✅ ${count}건 일괄완료`, timer: 2000, showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('일괄완료 오류:', error);
      Swal.fire('오류', '일괄완료 실패', 'error');
    }
  };

  // ☑️ 선택처리: 체크박스로 원하는 이벤트 선택 → 완료 또는 취소
  const handleMultiSelectAction = async (dateStr) => {
    const dateEvents = events.filter(e => e.start === dateStr && !e.extendedProps?.isCoWork);

    if (dateEvents.length === 0) {
      Swal.fire('알림', '처리할 일정이 없습니다', 'info');
      return;
    }

    const checkboxList = dateEvents.map((e, idx) => {
      const status = e.extendedProps?.status;
      const isCompleted = ['완료', '야근', '미작업'].includes(status);
      const statusIcon = isCompleted ? '✅' : '⏳';
      const price = (e.extendedProps?.price || 0).toLocaleString();
      const bgColor = isCompleted ? '#dcfce7' : '#fef3c7';
      const borderColor = isCompleted ? '#22c55e' : '#f59e0b';

      return `
        <label style="display:flex;align-items:center;padding:12px;margin:4px 0;background:${bgColor};border-radius:8px;cursor:pointer;border:1px solid ${borderColor};min-height:44px;">
          <input type="checkbox" class="multi-action-check" value="${e.id}" data-completed="${isCompleted}" style="width:22px;height:22px;min-width:22px;margin-right:12px;">
          <span style="flex:1;font-size:14px;">${statusIcon} ${e.title}</span>
          <span style="font-size:12px;color:#666;">${price}원</span>
        </label>
      `;
    }).join('');

    // eslint-disable-next-line no-unused-vars
    const { value: action } = await Swal.fire({
      title: `☑️ ${dateStr} 선택처리`,
      html: `
        <div style="margin-bottom:10px;display:flex;gap:8px;">
          <button type="button" onclick="document.querySelectorAll('.multi-action-check').forEach(c=>c.checked=true);window._updateMultiCount();" style="flex:1;padding:10px;border:none;background:#3b82f6;color:white;border-radius:6px;font-size:13px;">전체선택</button>
          <button type="button" onclick="document.querySelectorAll('.multi-action-check').forEach(c=>c.checked=false);window._updateMultiCount();" style="flex:1;padding:10px;border:none;background:#64748b;color:white;border-radius:6px;font-size:13px;">전체해제</button>
        </div>
        <div style="max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch;text-align:left;">
          ${checkboxList}
        </div>
        <div style="margin-top:10px;padding:8px;background:#f1f5f9;border-radius:8px;font-size:14px;">
          선택: <span id="multi-count">0</span>건
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button type="button" id="multi-complete-btn" style="flex:1;padding:12px;background:#059669;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;">✅ 선택 완료</button>
          <button type="button" id="multi-cancel-btn" style="flex:1;padding:12px;background:#f59e0b;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;">↩️ 선택 취소</button>
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: '닫기',
      width: '95%',
      didOpen: () => {
        window._updateMultiCount = () => {
          const count = document.querySelectorAll('.multi-action-check:checked').length;
          document.getElementById('multi-count').textContent = count;
        };
        document.querySelectorAll('.multi-action-check').forEach(cb => {
          cb.addEventListener('change', window._updateMultiCount);
        });

        // 선택 완료 버튼
        document.getElementById('multi-complete-btn').addEventListener('click', async () => {
          const checked = Array.from(document.querySelectorAll('.multi-action-check:checked'))
            .filter(cb => cb.dataset.completed === 'false')
            .map(cb => cb.value);
          
          if (checked.length === 0) {
            Swal.showValidationMessage('완료할 미완료 항목을 선택하세요');
            return;
          }
          Swal.close();
          await processBulkStatusChange(checked, dateStr, '완료');
        });

        // 선택 취소 버튼
        document.getElementById('multi-cancel-btn').addEventListener('click', async () => {
          const checked = Array.from(document.querySelectorAll('.multi-action-check:checked'))
            .filter(cb => cb.dataset.completed === 'true')
            .map(cb => cb.value);
          
          if (checked.length === 0) {
            Swal.showValidationMessage('취소할 완료 항목을 선택하세요');
            return;
          }
          Swal.close();
          await processBulkStatusChange(checked, dateStr, '배정');
        });
      }
    });
  };

  // 📦 일괄취소: 해당 날짜 완료 이벤트 전부 취소
  const handleBulkCancelComplete = async (dateStr) => {
    const dateEvents = events.filter(e => e.start === dateStr);
    const completedEvents = dateEvents.filter(e => 
      ['완료', '야근'].includes(e.extendedProps?.status) && 
      !e.extendedProps?.isCoWork
    );

    if (completedEvents.length === 0) {
      Swal.fire('알림', '취소할 완료 일정이 없습니다', 'info');
      return;
    }

    const result = await Swal.fire({
      title: `↩️ ${dateStr} 일괄취소`,
      html: `<div style="font-size:16px;"><b>${completedEvents.length}건</b>의 완료를 모두 취소합니다.</div>
        <div style="max-height:200px;overflow-y:auto;margin-top:10px;text-align:left;">
          ${completedEvents.map(e => `<div style="padding:4px 8px;font-size:13px;">• ${e.title}</div>`).join('')}
        </div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: `↩️ ${completedEvents.length}건 취소`,
      cancelButtonText: '닫기',
      confirmButtonColor: '#f59e0b'
    });

    if (!result.isConfirmed) return;

    const eventIds = completedEvents.map(e => e.id);
    await processBulkStatusChange(eventIds, dateStr, '배정');
  };

  // 🔧 공통: 여러 이벤트의 상태를 한번에 변경 (완료 or 취소)
  const processBulkStatusChange = async (eventIds, dateStr, newStatus) => {
    try {
      Swal.fire({ title: '처리 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const isComplete = newStatus === '완료';
      let completedBy = '';
      if (isComplete) {
        if (isAdminView) {
          completedBy = currentUser.name;
        } else if (currentViewMode !== 'self' && currentViewMode !== currentUser.id) {
          const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
          completedBy = viewingStaff ? viewingStaff.name : currentUser.name;
        } else {
          completedBy = currentUser.name;
        }
      }

      let count = 0;
      for (const eventId of eventIds) {
        // 담당자 이벤트 상태 변경
        const updateData = isComplete
          ? { status: '완료', completedBy, completedAt: new Date().toISOString() }
          : { status: '배정', completedBy: '', completedAt: '' };
        
        await updateDoc(doc(db, 'events', eventId), updateData);

        // 공동작업자 이벤트도 같이 처리
        const coWorkSnap = await getDocs(query(
          collection(db, 'events'),
          where('parentEventId', '==', eventId)
        ));
        for (const coWorkDoc of coWorkSnap.docs) {
          const coUpdateData = isComplete
            ? { status: '완료', completedBy: completedBy + ' (담당자)', completedAt: new Date().toISOString() }
            : { status: '배정', completedBy: '', completedAt: '' };
          await updateDoc(doc(db, 'events', coWorkDoc.id), coUpdateData);
        }

        // 완료 시 고객 마지막 작업일 업데이트
        if (isComplete) {
          try {
            const eventObj = events.find(e => e.id === eventId);
            const custCode = eventObj?.extendedProps?.customerCode;
            if (custCode) {
              const customerDoc = customers.find(c => c.id === custCode || c.code === custCode);
              if (customerDoc) {
                await updateDoc(doc(db, 'customers', customerDoc.id), {
                  lastWorkDate: dateStr
                });
              }
            }
          } catch (e) { /* skip */ }
        }

        count++;
      }

      Swal.fire({
        toast: true, position: 'top', icon: 'success',
        title: isComplete ? `✅ ${count}건 완료` : `↩️ ${count}건 취소`,
        timer: 2000, showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('일괄 상태변경 오류:', error);
      Swal.fire('오류', '처리 실패', 'error');
    }
  };

  // 일정 변경
  window.openDateChange = async (eventId, currentDate) => {
    Swal.close();
    
    // 일일마감된 날짜에서는 이동 불가
    if (dailyClosedDates.includes(currentDate)) {
      Swal.fire('일일마감 완료', '마감 해제 후 변경하세요', 'warning');
      return;
    }
    
    // 현재 이벤트 상태 확인
    const eventSnap = await getDocs(collection(db, 'events'));
    const currentEvent = eventSnap.docs.find(d => d.id === eventId)?.data();
    const currentStatus = currentEvent?.status;
    
    Swal.fire({
      title: '📅 일정 변경',
      html: `<div style="margin-bottom:10px;">현재: ${currentDate}</div>
             ${['완료', '야근'].includes(currentStatus) ? '<div style="color:#ef4444; font-size:12px; margin-bottom:10px;">⚠️ 이동 시 완료 이력이 삭제됩니다</div>' : ''}
             <input type="date" id="swal-new-date" class="swal2-input" value="${currentDate}">`,
      showCancelButton: true, confirmButtonText: '변경', cancelButtonText: '취소',
      preConfirm: () => document.getElementById('swal-new-date').value
    }).then(async (r) => {
      if (r.isConfirmed && r.value && r.value !== currentDate) {
        try {
          // 담당자 이벤트 날짜 변경 + 상태 리셋
          const updateData = { date: r.value };
          if (['완료', '야근'].includes(currentStatus)) {
            updateData.status = '배정';
            updateData.completedBy = '';
            updateData.completedAt = '';
          }
          await updateDoc(doc(db, 'events', eventId), updateData);
          
          // 공동작업자 이벤트도 같이 날짜 변경 + 상태 리셋
          const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);
          
          for (const coWorkDoc of coWorkEvents) {
            const coUpdateData = { date: r.value };
            if (['완료', '야근'].includes(currentStatus)) {
              coUpdateData.status = '배정';
              coUpdateData.completedBy = '';
              coUpdateData.completedAt = '';
            }
            await updateDoc(doc(db, 'events', coWorkDoc.id), coUpdateData);
          }
          
          const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
          toast.fire({ icon: 'success', title: '일정 변경됨' });
          fetchData();
        } catch (error) {
          Swal.fire('오류', '변경 실패', 'error');
        }
      }
    });
  };

  // 배정 취소 (대기목록으로)
  // 공동작업 관리 (직원 복수 선택 + 금액)
  window.manageCoWorkers = async (eventId, customerCode, eventDate) => {
    Swal.close();
    
    // 현재 이벤트 정보 가져오기
    const eventSnap = await getDocs(collection(db, 'events'));
    const currentEvent = eventSnap.docs.find(d => d.id === eventId)?.data();
    if (!currentEvent) return;
    
    // 기존 공동작업자 목록
    const existingCoWorkers = eventSnap.docs
      .filter(d => d.data().parentEventId === eventId)
      .map(d => ({ id: d.id, ...d.data() }));
    
    // 담당자 제외한 직원 목록 생성
    const availableStaff = staffList.filter(s => s.name !== currentEvent.staffName);
    
    let staffCheckboxes = availableStaff.map(s => {
      const existing = existingCoWorkers.find(cw => cw.staffName === s.name);
      return `
        <div style="display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid #eee;">
          <input type="checkbox" id="cowork-${s.visibleId}" value="${s.name}" data-id="${s.visibleId}" 
            ${existing ? 'checked' : ''} style="width:18px; height:18px;">
          <label for="cowork-${s.visibleId}" style="flex:1; cursor:pointer;">${s.name}</label>
          <input type="number" id="cowork-price-${s.visibleId}" value="${existing?.price || 0}" 
            placeholder="금액" step="5000" min="0" style="width:80px; padding:5px; border:1px solid #ddd; border-radius:4px; font-size:12px;">
          <span style="font-size:11px; color:#666;">원</span>
        </div>
      `;
    }).join('');
    
    const result = await Swal.fire({
      title: '👥 공동작업 관리',
      html: `
        <div style="text-align:left; margin-bottom:15px;">
          <div style="font-size:12px; color:#666; margin-bottom:10px;">
            📌 담당자: <b>${currentEvent.staffName}</b> | 📅 ${eventDate}
          </div>
          <div style="max-height:250px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:8px;">
            ${staffCheckboxes || '<div style="padding:20px; text-align:center; color:#999;">선택 가능한 직원이 없습니다</div>'}
          </div>
          <div style="font-size:11px; color:#888; margin-top:10px;">
            ✅ 체크한 직원에게 같은 날짜로 공동작업이 배정됩니다
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '저장',
      cancelButtonText: '취소',
      confirmButtonColor: '#8b5cf6',
      width: '350px'
    });
    
    if (!result.isConfirmed) return;
    
    // 🔴 중요: Swal이 닫히기 전에 DOM에서 값을 먼저 수집!
    // (처리중... 팝업이 뜨면 이전 DOM이 사라짐)
    const selectedCoWorkers = [];
    availableStaff.forEach(s => {
      const checkbox = document.getElementById(`cowork-${s.visibleId}`);
      const priceInput = document.getElementById(`cowork-price-${s.visibleId}`);
      console.log('체크박스:', s.name, checkbox, checkbox?.checked);
      if (checkbox?.checked) {
        selectedCoWorkers.push({
          staffId: s.visibleId,
          staffName: s.name,
          price: Number(priceInput?.value) || 0
        });
      }
    });
    
    console.log('선택된 공동작업자:', selectedCoWorkers);
    
    try {
      Swal.fire({ title: '처리중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      
      // 기존 공동작업자 중 선택 해제된 것 삭제
      for (const existing of existingCoWorkers) {
        const stillSelected = selectedCoWorkers.find(s => s.staffName === existing.staffName);
        if (!stillSelected) {
          await deleteDoc(doc(db, 'events', existing.id));
        }
      }
      
      // 새로운 공동작업자 추가 또는 금액 업데이트
      for (const coWorker of selectedCoWorkers) {
        const existing = existingCoWorkers.find(cw => cw.staffName === coWorker.staffName);
        
        if (existing) {
          // 금액만 업데이트
          await updateDoc(doc(db, 'events', existing.id), {
            price: coWorker.price,
            coWorkPrice: coWorker.price
          });
        } else {
          // 새로 생성
          await addDoc(collection(db, 'events'), {
            title: currentEvent.title,
            date: eventDate,
            customerCode: customerCode,
            price: coWorker.price,
            coWorkPrice: coWorker.price,
            status: '배정',
            staffId: coWorker.staffId,
            staffName: coWorker.staffName,
            phone: currentEvent.phone,
            address: currentEvent.address,
            isCoWork: true,
            workType: currentEvent.workType || 'regular',
            parentEventId: eventId,
            mainStaffName: currentEvent.staffName,
            createdAt: new Date().toISOString()
          });
        }
      }
      
      Swal.fire({
        icon: 'success',
        title: '저장 완료',
        text: `공동작업자 ${selectedCoWorkers.length}명`,
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
      
    } catch (error) {
      console.error('공동작업 저장 오류:', error);
      Swal.fire('오류', '저장 실패', 'error');
    }
  };

  window.deletePlan = async (eventId, customerCode, isCoWorkOnly = false) => {
    Swal.close();
    
    // 현재 이벤트 정보 먼저 가져오기 (단건 조회)
    const eventDocSnap = await getDoc(doc(db, 'events', eventId));
    const currentEvent = eventDocSnap.exists() ? eventDocSnap.data() : null;
    const isFolder = currentEvent?.isFolder || currentEvent?.workType === 'folder';
    const folderId = currentEvent?.folderId;
    
    const result = await Swal.fire({
      title: isFolder ? '📁 폴더 배정 취소' : '배정 취소',
      text: isCoWorkOnly ? '공동작업 배정을 취소합니다' : (isFolder ? '폴더가 대기목록으로 돌아갑니다' : '대기목록으로 이동합니다'),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '취소하기',
      cancelButtonText: '닫기'
    });

    if (result.isConfirmed) {
      try {
        if (isCoWorkOnly) {
          // 공동작업자 이벤트만 삭제
          await deleteDoc(doc(db, 'events', eventId));
        } else {
          // 담당자 이벤트 삭제 + 공동작업자 이벤트도 같이 삭제
          // parentEventId로 연결된 공동작업자 찾기
          const coWorkByParent = await getDocs(query(
            collection(db, 'events'),
            where('parentEventId', '==', eventId)
          ));
          
          // folderId로 연결된 공동작업자도 찾기
          let coWorkByFolder = { docs: [] };
          if (folderId) {
            coWorkByFolder = await getDocs(query(
              collection(db, 'events'),
              where('folderId', '==', folderId),
              where('isCoWork', '==', true)
            ));
          }
          
          // 중복 제거 후 삭제
          const deletedIds = new Set();
          for (const coWorkDoc of [...coWorkByParent.docs, ...coWorkByFolder.docs]) {
            if (!deletedIds.has(coWorkDoc.id)) {
              await deleteDoc(doc(db, 'events', coWorkDoc.id));
              deletedIds.add(coWorkDoc.id);
            }
          }
          
          // 담당자 이벤트 삭제
          await deleteDoc(doc(db, 'events', eventId));
          
          // 폴더인 경우: assignedCount 감소, 0이면 active / 아직 남으면 partial 유지
          if (isFolder && folderId) {
            try {
              const folderSnap = await getDoc(doc(db, 'folders', folderId));
              if (folderSnap.exists()) {
                const fd = folderSnap.data();
                const newCount = Math.max(0, (fd.assignedCount || 1) - 1);
                await updateDoc(doc(db, 'folders', folderId), {
                  assignedCount: newCount,
                  status: newCount === 0 ? 'active' : 'partial',
                  // 완전히 미배정이면 날짜/이벤트ID 초기화
                  ...(newCount === 0 ? { assignedDate: null, mainEventId: null } : {}),
                });
              }
            } catch (e) {
              console.log('폴더 상태 업데이트 오류:', e);
            }
          }
        }
        
        const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        toast.fire({ icon: 'success', title: isFolder ? '📁 폴더가 대기목록으로 이동됨' : '대기목록으로 이동됨' });
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  // 드래그로 배정
  const handleEventReceive = async (info) => {
    // 드래그된 임시 이벤트 제거 (중복 방지)
    info.event.remove();
    
    if (monthClosed) {
      Swal.fire('월마감 완료', '배정이 불가합니다', 'warning');
      return;
    }

    const eventData = info.event.extendedProps;
    const isExtraWork = eventData.isExtraWork || eventData.workType === 'extra';
    const customer = customers.find(c => c.id === eventData.customerCode);
    
    // 추가작업이 아닌 경우에만 고객 정보 필수
    if (!customer && !isExtraWork) {
      Swal.fire('오류', '고객 정보를 찾을 수 없습니다', 'error');
      return;
    }

    // 직원 결정
    let targetStaffId = currentUser.id;
    let targetStaffName = currentUser.name;
    if (currentViewMode !== 'self' && currentViewMode !== 'admin' && currentViewMode !== currentUser.id) {
      const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
      if (viewingStaff) {
        targetStaffId = viewingStaff.visibleId;
        targetStaffName = viewingStaff.name;
      }
    }

    try {
      const isSpecialWork = eventData.isSpecial || eventData.workType === 'special';
      // 무료 회차(isCharged=false)이면 0원 강제, 아니면 대기목록 price 사용
      let eventPrice;
      if (eventData.isCharged === false) {
        eventPrice = 0;
      } else {
        eventPrice = eventData.price || (isSpecialWork ? (customer?.specialWork?.price || 0) : (customer ? getTotalPrice(customer) : 0));
      }
      
      // 추가작업인 경우
      if (isExtraWork) {
        // 추가작업 이벤트 생성
        const extraEventRef = await addDoc(collection(db, 'events'), {
          title: info.event.title,
          date: info.event.startStr,
          customerCode: eventData.extraWorkId || eventData.customerCode,
          price: eventData.price || 0,
          status: '배정',
          staffId: targetStaffId,
          staffName: targetStaffName,
          workType: 'extra',
          category: eventData.category,
          extraWorkId: eventData.extraWorkId,
          createdAt: new Date().toISOString()
        });
        
        // extraWork 컬렉션 상태 업데이트
        if (eventData.extraWorkId) {
          await updateDoc(doc(db, 'extraWork', eventData.extraWorkId), {
            status: '배정됨',
            assignedDate: info.event.startStr,
            eventId: extraEventRef.id
          });
        }
        
        const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        toast.fire({ icon: 'success', title: '추가작업 배정 완료' });
        fetchData();
        return;
      }
      
      // 공동작업비 계산 (담당자 금액에서 차감)
      let totalCoWorkPrice = 0;
      if (!isSpecialWork) {
        const coWorkersArray = customer.coWorkers || [];
        if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
          totalCoWorkPrice = customer.coWorker.price || 0;
        } else {
          totalCoWorkPrice = coWorkersArray.reduce((sum, cw) => sum + (cw.price || 0), 0);
        }
      }
      const mainEventPrice = Math.max(0, eventPrice - totalCoWorkPrice);
      
      // 담당자 이벤트 생성 (공동작업비 차감된 금액)
      const mainEventRef = await addDoc(collection(db, 'events'), {
        title: info.event.title || customer.name,
        date: info.event.startStr,
        customerCode: customer.id,
        price: mainEventPrice,
        originalPrice: eventPrice,  // 원래 금액 저장
        status: '배정',
        staffId: targetStaffId,
        staffName: targetStaffName,
        phone: customer.phone,
        address: customer.address,
        isCoWork: false,
        workType: isSpecialWork ? 'special' : 'regular',
        createdAt: new Date().toISOString()
      });

      // 일반 작업: 공동작업자 이벤트 생성
      if (!isSpecialWork) {
        const coWorkersArray = customer.coWorkers || [];
        // 옛날 coWorker 단일 구조도 호환
        if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
          coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
        }
        
        for (const coWorker of coWorkersArray) {
          if (coWorker.staffName) {
            const coWorkerStaff = staffList.find(s => s.name === coWorker.staffName);
            if (coWorkerStaff) {
              await addDoc(collection(db, 'events'), {
                title: info.event.title || customer.name,
                date: info.event.startStr,
                customerCode: customer.id,
                price: coWorker.price || 0,
                coWorkPrice: coWorker.price || 0,
                status: '배정',
                staffId: coWorkerStaff.visibleId,
                staffName: coWorkerStaff.name,
                phone: customer.phone,
                address: customer.address,
                isCoWork: true,
                workType: 'regular',
                parentEventId: mainEventRef.id,
                mainStaffName: targetStaffName,
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      }
      
      // 특별작업은 공동작업자를 배정 후 따로 추가하므로 여기서는 생성하지 않음

      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: '배정 완료' });
      fetchData();
    } catch (error) {
      console.error('배정 오류:', error);
      Swal.fire('오류', '배정 실패', 'error');
    }
  };

  const getTotalPrice = useCallback((c) => {
    if (c.services && c.services.length > 0) {
      return c.services.reduce((sum, s) => sum + (s.price || 0), 0);
    }
    return c.price || 0;
  }, []);

  // 모바일 드래그 배정 팝업
  // eslint-disable-next-line no-unused-vars
  const handleMobileDateClick = (info) => {
    if (monthClosed) {
      Swal.fire('월마감 완료', '배정이 불가합니다', 'warning');
      return;
    }

    // 해당 날짜의 이벤트 가져오기
    const dateEvents = events.filter(e => e.start === info.dateStr);
    
    // 대기목록 + 해당 날짜 이벤트 합쳐서 표시
    const listHtml = `
      <div style="text-align:left;">
        ${dateEvents.length > 0 ? `
          <div style="margin-bottom:15px;">
            <div style="font-size:12px;color:#666;margin-bottom:8px;">📋 배정된 일정 (${dateEvents.length}건)</div>
            ${dateEvents.map(e => `
              <div onclick="window.handleMobileEventClick('${e.id}')" 
                style="padding:10px;margin:4px 0;background:${e.backgroundColor};color:white;border-radius:6px;cursor:pointer;">
                ${e.title}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        ${waitingList.length > 0 ? `
          <div style="font-size:12px;color:#666;margin-bottom:8px;">📦 대기목록 (${waitingList.length}명) - 길게 눌러 드래그</div>
          <div id="mobile-drag-list" style="max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
            ${waitingList.slice(0, 30).map((c, idx) => {
              const isSpecial = c.isSpecial || c.id?.startsWith('special_');
              const isExtraWork = c.isExtraWork || c.id?.startsWith('extra_');
              const isFree = c.isCharged === false || (isExtraWork && !c.price);
              const price = isFree ? 0 : (c.price ?? (isSpecial ? 0 : getTotalPrice(c)));
              const icon = isExtraWork ? '📝' : (isSpecial ? '🌟' : (isFree ? '🆓' : (c.unpaid > 0 ? '💰' : '')));
              const bgColor = isExtraWork ? '#fff7ed' : (isSpecial ? '#f3e8ff' : '#f8fafc');
              const borderColor = isExtraWork ? '#f97316' : (isSpecial ? '#8b5cf6' : '#3b82f6');
              
              return `
                <div class="mobile-drag-item" data-customer-id="${c.id}" data-idx="${idx}"
                  style="padding:12px;margin:4px 0;background:${bgColor};border-radius:8px;border-left:3px solid ${borderColor};cursor:grab;user-select:none;">
                  <div style="font-weight:bold;font-size:14px;">${icon} ${c.displayName || c.name || c.title}</div>
                  <div style="font-size:12px;color:#666;">${isFree ? '무료' : price.toLocaleString() + '원'}</div>
                </div>
              `;
            }).join('')}
          </div>
        ` : '<div style="color:#999;padding:20px;text-align:center;">대기목록이 없습니다</div>'}
      </div>
    `;

    Swal.fire({
      title: `📅 ${info.dateStr}`,
      html: listHtml,
      showCancelButton: waitingList.length > 0,
      confirmButtonText: waitingList.length > 0 ? '체크박스 배정' : '확인',
      cancelButtonText: '닫기',
      width: '95%',
      didOpen: () => {
        // 이벤트 클릭 핸들러
        window.handleMobileEventClick = (eventId) => {
          Swal.close();
          const event = events.find(e => e.id === eventId);
          if (event) {
            handleEventClick({ event: { id: event.id, title: event.title, startStr: event.start, extendedProps: event.extendedProps } });
          }
        };

        // 드래그 아이템에 터치 이벤트 등록
        const items = document.querySelectorAll('.mobile-drag-item');
        items.forEach(item => {
          let pressTimer = null;
          let startX = 0, startY = 0;
          
          item.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            
            pressTimer = setTimeout(() => {
              // 길게 누르면 드래그 시작
              const idx = parseInt(item.dataset.idx);
              const customer = waitingList[idx];
              if (customer) {
                Swal.close();
                startMobileDrag(customer, e.touches[0].clientX, e.touches[0].clientY, info.dateStr);
              }
            }, 300); // 0.3초 길게 누르기
          });
          
          item.addEventListener('touchmove', (e) => {
            const moveX = Math.abs(e.touches[0].clientX - startX);
            const moveY = Math.abs(e.touches[0].clientY - startY);
            if (moveX > 10 || moveY > 10) {
              clearTimeout(pressTimer);
            }
          });
          
          item.addEventListener('touchend', () => {
            clearTimeout(pressTimer);
          });
        });
      }
    }).then((result) => {
      if (result.isConfirmed && waitingList.length > 0) {
        // 체크박스 배정 모드로 전환
        handleDateClickCheckbox(info);
      }
    });
  };

  // 📅 로컬 날짜 문자열 변환 (UTC 시차 버그 방지)
  // new Date().toISOString()은 UTC기준이라 KST에서 하루 밀림 → 이 함수 사용
  const toLocalDateStr = useCallback((date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  // 모바일 드래그 시작
  const startMobileDrag = (customer, x, y, fromDate) => {
    setMobileDragItem({ ...customer, fromDate });
    setMobileDragPos({ x, y });
    mobileDragPosRef.current = { x, y }; // ref도 업데이트
    setShowScrollZones(true);
    document.body.style.overflow = 'hidden'; // 스크롤 고정
    
    // 진동 피드백 (지원되는 경우)
    if (navigator.vibrate) navigator.vibrate(50);
  };

  // mobileDragItem이 있을 때 document 레벨에서 터치 이벤트 처리
  useEffect(() => {
    if (!mobileDragItem) return;
    
    const onTouchMove = (e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const newPos = { x: touch.clientX, y: touch.clientY };
        setMobileDragPos(newPos);
        mobileDragPosRef.current = newPos; // ref 업데이트
        
        const scrollZoneHeight = 60;
        if (touch.clientY < scrollZoneHeight) {
          if (!scrollIntervalRef.current) {
            scrollIntervalRef.current = setInterval(() => {
              window.scrollBy(0, -80);
            }, 100);
          }
        } else if (touch.clientY > window.innerHeight - scrollZoneHeight) {
          if (!scrollIntervalRef.current) {
            scrollIntervalRef.current = setInterval(() => {
              window.scrollBy(0, 80);
            }, 100);
          }
        } else {
          if (scrollIntervalRef.current) {
            clearInterval(scrollIntervalRef.current);
            scrollIntervalRef.current = null;
          }
        }
      }
      e.preventDefault();
    };
    
    const onTouchEnd = async () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
      
      document.body.style.overflow = '';
      
      // ref에서 최신 위치 가져오기
      const dropX = mobileDragPosRef.current.x;
      const dropY = mobileDragPosRef.current.y;
      
      const elements = document.elementsFromPoint(dropX, dropY);
      const dateCell = elements.find(el => el.classList.contains('fc-day') || el.closest('.fc-day'));
      const targetCell = dateCell?.classList.contains('fc-day') ? dateCell : dateCell?.closest('.fc-day');
      
      if (targetCell) {
        const dateAttr = targetCell.getAttribute('data-date');
        if (dateAttr) {
          if (mobileDragItem.isExistingEvent && mobileDragItem.eventId) {
            try {
              await updateDoc(doc(db, 'events', mobileDragItem.eventId), { 
                date: dateAttr,
                status: '배정'
              });
              const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
              toast.fire({ icon: 'success', title: `${dateAttr}로 이동됨` });
              fetchData();
            } catch (error) {
              console.error('일정 변경 오류:', error);
              Swal.fire('오류', '일정 변경 실패', 'error');
            }
          } else {
            await assignCustomerToDate(mobileDragItem, dateAttr);
          }
        }
      }
      
      setMobileDragItem(null);
      setShowScrollZones(false);
    };
    
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    
    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileDragItem]); // mobileDragPos 제거!

  // 모바일 드래그 이동 핸들러 (기존 - 백업용)
  // eslint-disable-next-line no-unused-vars
  const handleMobileTouchMove = (e) => {
    if (!mobileDragItem) return;
    
    const touch = e.touches[0];
    setMobileDragPos({ x: touch.clientX, y: touch.clientY });
    
    // 스크롤 영역 체크
    const scrollZoneHeight = 60;
    if (touch.clientY < scrollZoneHeight) {
      // 상단 영역 - 화면 위로 스크롤
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = setInterval(() => {
          window.scrollBy(0, -80);
        }, 100);
      }
    } else if (touch.clientY > window.innerHeight - scrollZoneHeight) {
      // 하단 영역 - 화면 아래로 스크롤
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = setInterval(() => {
          window.scrollBy(0, 80);
        }, 100);
      }
    } else {
      // 스크롤 영역 벗어남
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }
    
    e.preventDefault();
  };

  // 모바일 드래그 종료 핸들러 (기존 - 백업용)
  // eslint-disable-next-line no-unused-vars
  const handleMobileTouchEnd = async (e) => {
    // useEffect에서 처리됨
  };

  // 고객을 날짜에 배정하는 함수
  const assignCustomerToDate = async (customer, dateStr) => {
    let targetStaffId = currentUser.id;
    let targetStaffName = currentUser.name;
    
    if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
      const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
      if (viewingStaff) {
        targetStaffId = viewingStaff.visibleId;
        targetStaffName = viewingStaff.name;
      }
    }

    try {
      const isSpecialWork = customer.isSpecial || customer.id?.startsWith('special_');
      const isExtraWork = customer.isExtraWork || customer.id?.startsWith('extra_');
      // 추가업무도 금액 저장 (수금 제외 - 이미 대기목록에서 0으로 처리됨)
      // isCharged === false(무료 회차)이면 0원 강제 — price=0인데 || 로 기본금액 들어가는 버그 방지
      let eventPrice;
      if (customer.isCharged === false) {
        eventPrice = 0; // 무료 회차
      } else {
        eventPrice = isExtraWork ? (customer.price || 0) : (customer.price || (isSpecialWork ? 0 : getTotalPrice(customer)));
      }
      const realCustomerId = customer.originalId || (isSpecialWork ? customer.customerId : (isExtraWork ? customer.extraWorkId : customer.id));

      // 공동작업비 계산 (담당자 금액에서 차감)
      let totalCoWorkPrice = 0;
      if (!isSpecialWork && !isExtraWork) {
        const coWorkersArray = customer.coWorkers || [];
        if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
          totalCoWorkPrice = customer.coWorker.price || 0;
        } else {
          totalCoWorkPrice = coWorkersArray.reduce((sum, cw) => sum + (cw.price || 0), 0);
        }
      }
      const mainEventPrice = Math.max(0, eventPrice - totalCoWorkPrice);

      const eventData = {
        title: customer.displayName || customer.name || customer.title,
        date: dateStr,
        customerCode: realCustomerId,
        price: mainEventPrice,
        originalPrice: eventPrice,  // 원래 금액 저장
        status: '배정',
        staffId: targetStaffId,
        staffName: targetStaffName,
        phone: customer.phone || '',
        address: customer.address || '',
        isCoWork: false,
        workType: isExtraWork ? 'extra' : (isSpecialWork ? 'special' : 'regular'),
        workRound: (customer.currentIndex !== undefined) ? customer.currentIndex : 0, // 회차 인덱스 (0부터)
        totalCount: customer.totalCount || 1,
        isCharged: customer.isCharged !== false,
        createdAt: new Date().toISOString()
      };

      if (isExtraWork) {
        eventData.category = customer.category;
        eventData.extraWorkId = customer.extraWorkId;
      }

      const mainEventRef = await addDoc(collection(db, 'events'), eventData);

      if (isExtraWork && customer.extraWorkId) {
        await updateDoc(doc(db, 'extraWork', customer.extraWorkId), {
          status: '배정됨',
          assignedDate: dateStr,
          eventId: mainEventRef.id
        });
      }

      // 일반 작업: 공동작업자 이벤트도 생성
      if (!isSpecialWork && !isExtraWork) {
        const coWorkersArray = customer.coWorkers || [];
        if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
          coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
        }
        
        for (const coWorker of coWorkersArray) {
          if (coWorker.staffName) {
            const coWorkerStaff = staffList.find(s => s.name === coWorker.staffName);
            if (coWorkerStaff) {
              await addDoc(collection(db, 'events'), {
                title: customer.displayName || customer.name || customer.title,
                date: dateStr,
                customerCode: realCustomerId,
                price: coWorker.price || 0,
                coWorkPrice: coWorker.price || 0,
                status: '배정',
                staffId: coWorkerStaff.visibleId,
                staffName: coWorkerStaff.name,
                phone: customer.phone || '',
                address: customer.address || '',
                isCoWork: true,
                mainStaffName: targetStaffName,
                parentEventId: mainEventRef.id,
                workType: 'regular',
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      }

      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: `${dateStr}에 배정됨` });
      fetchData();
    } catch (error) {
      console.error('배정 오류:', error);
      Swal.fire('오류', '배정 실패', 'error');
    }
  };

  // 날짜 클릭 (체크박스 방식 - PC용 또는 모바일에서 선택 시)
  const handleDateClickCheckbox = (info) => {
    if (monthClosed) {
      Swal.fire('월마감 완료', '배정이 불가합니다', 'warning');
      return;
    }

    if (waitingList.length === 0) {
      Swal.fire('대기목록 없음', '배정할 고객이 없습니다', 'info');
      return;
    }

    // 체크박스 리스트 생성 - 모바일 친화적
    const checkboxList = waitingList.slice(0, 30).map((c, idx) => {
      const isSpecial = c.isSpecial || c.id?.startsWith('special_');
      const isExtraWork = c.isExtraWork || c.id?.startsWith('extra_');
      // 추가업무도 금액 있으면 무료 아님
      const isFree = c.isCharged === false || (isExtraWork && !c.price);
      const price = isFree ? 0 : (c.price ?? (isSpecial ? 0 : getTotalPrice(c)));
      const icon = isExtraWork ? '📝' : (isSpecial ? '🌟' : (isFree ? '🆓' : (c.unpaid > 0 ? '💰' : '')));
      const countBadge = (c.totalCount > 1 && !isSpecial && !isExtraWork) ? `<span style="color:#6366f1;font-size:11px;">(${c.currentIndex + 1}/${c.totalCount})</span>` : '';
      const categoryBadge = isExtraWork ? `<span style="color:#f97316;font-size:10px;">[${c.category}]</span>` : '';
      const priceText = isFree ? '<span style="color:#94a3b8;">무료</span>' : `${parseInt(price).toLocaleString()}원`;
      
      // 배경색: 추가업무=주황, 특별=보라, 무료=회색, 기본=흰색
      const bgColor = isExtraWork ? '#fff7ed' : (isSpecial ? '#f3e8ff' : (isFree ? '#f1f5f9' : '#f8fafc'));
      const borderColor = isExtraWork ? '#fed7aa' : (isSpecial ? '#c4b5fd' : '#e2e8f0');
      
      return `
        <label style="display:flex;align-items:center;padding:12px;margin:4px 0;background:${bgColor};border-radius:8px;cursor:pointer;border:1px solid ${borderColor};opacity:${isFree && !isExtraWork ? '0.7' : '1'};min-height:44px;">
          <input type="checkbox" class="customer-check" value="${c.id}" data-special="${isSpecial}" data-extra="${isExtraWork}" data-original-id="${c.originalId || c.extraWorkId || c.id}" data-price="${price}" style="width:22px;height:22px;min-width:22px;margin-right:12px;">
          <span style="flex:1;font-size:14px;">${icon} ${c.displayName || c.name || c.title} ${countBadge} ${categoryBadge}</span>
          <span style="font-size:12px;color:${isFree ? '#94a3b8' : '#666'};">${priceText}</span>
        </label>
      `;
    }).join('');

    Swal.fire({
      title: `📅 ${info.dateStr} 배정`,
      html: `
        <div style="margin-bottom:12px;display:flex;gap:8px;">
          <button type="button" onclick="document.querySelectorAll('.customer-check').forEach(c=>c.checked=true);window.updateSelectedCount();" style="flex:1;padding:10px;border:none;background:#3b82f6;color:white;border-radius:6px;font-size:13px;min-height:40px;">전체선택</button>
          <button type="button" onclick="document.querySelectorAll('.customer-check').forEach(c=>c.checked=false);window.updateSelectedCount();" style="flex:1;padding:10px;border:none;background:#64748b;color:white;border-radius:6px;font-size:13px;min-height:40px;">전체해제</button>
        </div>
        <div style="max-height:350px;overflow-y:auto;-webkit-overflow-scrolling:touch;text-align:left;">
          ${checkboxList}
        </div>
        <div style="margin-top:12px;padding:10px;background:#f1f5f9;border-radius:8px;font-size:14px;">
          선택: <span id="selected-count">0</span>명
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '배정',
      cancelButtonText: '취소',
      width: '95%',
      didOpen: () => {
        // 선택 개수 업데이트 함수
        window.updateSelectedCount = () => {
          const count = document.querySelectorAll('.customer-check:checked').length;
          document.getElementById('selected-count').textContent = count;
        };
        // 체크박스 변경 시 업데이트
        document.querySelectorAll('.customer-check').forEach(cb => {
          cb.addEventListener('change', window.updateSelectedCount);
        });
      },
      preConfirm: () => {
        const checked = document.querySelectorAll('.customer-check:checked');
        if (checked.length === 0) {
          Swal.showValidationMessage('최소 1명을 선택하세요');
          return false;
        }
        return Array.from(checked).map(cb => ({
          id: cb.value,
          originalId: cb.dataset.originalId,
          price: Number(cb.dataset.price) || 0,
          isSpecial: cb.dataset.special === 'true',
          isExtraWork: cb.dataset.extra === 'true'
        }));
      }
    }).then(async (r) => {
      if (r.isConfirmed && r.value && r.value.length > 0) {
        for (const selected of r.value) {
          const customer = waitingList.find(c => c.id === selected.id);
          if (customer) {
            await assignCustomerToDate(customer, info.dateStr);
          }
        }
      }
    });
  };

  // 날짜 요약 팝업 (배정플랜용 - 일일완료 버튼 포함)
  // ── 단기고객 등록 팝업 (캘린더 날짜에서 호출) ──
  const openShortTermPopup = async (prefillDate) => {
    const staffOptions = (staffList || [])
      .map(s => `<option value="${s.name}" ${s.visibleId === currentUser?.id ? 'selected' : ''}>${s.name}</option>`)
      .join('');

    const catOptions = [
      { key:'home',       icon:'🏠', label:'가정집' },
      { key:'small',      icon:'🏪', label:'소규모' },
      { key:'large',      icon:'🏢', label:'대규모' },
      { key:'store',      icon:'🛒', label:'상가' },
      { key:'restaurant', icon:'🍽️', label:'음식점' },
      { key:'warehouse',  icon:'📦', label:'창고·물류' },
      { key:'etc',        icon:'📋', label:'기타' },
    ].map(c => `<option value="${c.key}">${c.icon} ${c.label}</option>`).join('');

    const { value: formData, isConfirmed } = await Swal.fire({
      title: `🟡 단기고객 등록 (${prefillDate})`,
      width: '95%',
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">분류</label>
            <select id="stc-category" class="swal2-input" style="margin:4px 0;font-size:13px;">${catOptions}</select>
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">고객명 *</label>
            <input id="stc-name" class="swal2-input" placeholder="고객명" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">전화번호</label>
            <input id="stc-phone" class="swal2-input" placeholder="010-0000-0000" type="tel" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">주소</label>
            <input id="stc-address" class="swal2-input" placeholder="주소" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <div style="flex:1;">
              <label style="font-size:11px;color:#6b7280;font-weight:bold;">면적(㎡)</label>
              <input id="stc-area" class="swal2-input" type="number" placeholder="50" style="margin:4px 0;font-size:13px;">
            </div>
            <div style="flex:1;">
              <label style="font-size:11px;color:#6b7280;font-weight:bold;">단가(원)</label>
              <input id="stc-price" class="swal2-input" type="number" placeholder="100000" style="margin:4px 0;font-size:13px;">
            </div>
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">문제해충</label>
            <input id="stc-pests" class="swal2-input" placeholder="바퀴벌레, 쥐 등" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">담당자</label>
            <select id="stc-staff" class="swal2-input" style="margin:4px 0;font-size:13px;">${staffOptions}</select>
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">작업횟수</label>
            <select id="stc-sessions" class="swal2-input" style="margin:4px 0;font-size:13px;"
              onchange="
                const v=parseInt(this.value);
                document.getElementById('stc-date2-wrap').style.display = v>=2?'block':'none';
              ">
              <option value="1">1회</option>
              <option value="2">2회</option>
              <option value="3">3회</option>
            </select>
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">1회차 날짜</label>
            <input id="stc-date1" class="swal2-input" type="date" value="${prefillDate}" style="margin:4px 0;font-size:13px;">
          </div>
          <div id="stc-date2-wrap" style="display:none;margin-bottom:8px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">2회차 날짜</label>
            <input id="stc-date2" class="swal2-input" type="date" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="padding:10px;background:#fef9c3;border-radius:8px;border:1px solid #fde68a;margin-top:4px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="stc-paid" style="width:18px;height:18px;"> 💰 수금 완료
            </label>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      confirmButtonColor: '#f59e0b',
      preConfirm: () => {
        const name = document.getElementById('stc-name')?.value?.trim();
        if (!name) { Swal.showValidationMessage('고객명을 입력해주세요.'); return false; }
        const sessions = parseInt(document.getElementById('stc-sessions')?.value || '1');
        const date2    = document.getElementById('stc-date2')?.value;
        if (sessions >= 2 && !date2) { Swal.showValidationMessage('2회차 날짜를 입력해주세요.'); return false; }
        return {
          category:    document.getElementById('stc-category')?.value,
          name,
          phone:       document.getElementById('stc-phone')?.value?.trim(),
          address:     document.getElementById('stc-address')?.value?.trim(),
          area:        document.getElementById('stc-area')?.value,
          price:       parseInt(document.getElementById('stc-price')?.value || '0'),
          pests:       document.getElementById('stc-pests')?.value?.trim(),
          staffName:   document.getElementById('stc-staff')?.value,
          sessions,
          date1:       document.getElementById('stc-date1')?.value || prefillDate,
          date2:       sessions >= 2 ? date2 : null,
          paymentDone: document.getElementById('stc-paid')?.checked,
        };
      },
    });

    if (!isConfirmed || !formData) return;

    try {
      const sessionList = [{ date: formData.date1, status: 'pending', type: 'paid', memo: '' }];
      if (formData.sessions >= 2 && formData.date2) {
        sessionList.push({ date: formData.date2, status: 'pending', type: 'paid', memo: '' });
      }

      const ref = await addDoc(collection(db, 'shortTermCustomers'), {
        category:      formData.category,
        name:          formData.name,
        phone:         formData.phone    || '',
        address:       formData.address  || '',
        area:          formData.area     || '',
        price:         formData.price    || 0,
        pests:         formData.pests    || '',
        staffName:     formData.staffName|| currentUser?.name || '',
        staffId:       currentUser?.id   || '',
        sessions:      sessionList,
        totalSessions: formData.sessions,
        paymentDone:   formData.paymentDone || false,
        paymentDate:   formData.paymentDone ? new Date().toISOString().split('T')[0] : null,
        memo:          '',
        status:        'active',
        createdAt:     new Date().toISOString(),
      });

      // 캘린더 이벤트 생성
      for (const sess of sessionList) {
        await addDoc(collection(db, 'events'), {
          customerCode: ref.id,
          customerName: formData.name,
          title:        `🟡 ${formData.name}`,
          date:         sess.date,
          start:        sess.date,
          staffName:    formData.staffName || currentUser?.name || '',
          price:        formData.price || 0,
          status:       '배정',
          isShortTerm:  true,
          shortTermId:  ref.id,
          createdAt:    new Date().toISOString(),
        });
      }

      fetchData(); // 캘린더 새로고침
      Swal.fire({ icon:'success', title:'✅ 단기고객 등록 완료', timer:1500, showConfirmButton:false });
    } catch (e) {
      console.error(e);
      Swal.fire('오류', '등록에 실패했습니다.', 'error');
    }
  };

  const handleDateSummary = async (info) => {
    const dateStr = info.dateStr;
    const dateEvents = events.filter(e => e.start === dateStr);
    
    // 총매출 계산 (공동작업 제외 - 담당자 금액만 합산)
    const totalRevenue = dateEvents
      .filter(e => !e.extendedProps?.isCoWork)
      .reduce((sum, e) => sum + (e.extendedProps?.price || 0), 0);
    
    // 완료/미완료 분류 (완료, 야근, 미작업은 완료로 처리)
    const completedEvents = dateEvents.filter(e => ['완료', '야근', '미작업'].includes(e.extendedProps?.status));
    const pendingEvents = dateEvents.filter(e => !['완료', '야근', '미작업'].includes(e.extendedProps?.status));
    
    // 모두 완료인지 확인
    const allCompleted = dateEvents.length > 0 && pendingEvents.length === 0;
    
    // 이미 일일마감 되었는지 확인
    const isAlreadyClosed = dailyClosedDates.includes(dateStr);
    
    // 고객 리스트 HTML 생성
    const createEventHtml = (e, idx) => {
      const status = e.extendedProps?.status;
      const isCompleted = ['완료', '야근', '미작업'].includes(status);
      const isOvertime = status === '야근';
      const isNoWork = status === '미작업';
      const price = e.extendedProps?.price || 0;
      const statusIcon = isNoWork ? '⛔' : (isCompleted ? (isOvertime ? '🌙' : '✅') : '⏳');
      const bgColor = isNoWork ? '#f3f4f6' : (isCompleted ? '#dcfce7' : '#fef3c7');
      const borderColor = isNoWork ? '#9ca3af' : (isCompleted ? '#22c55e' : '#f59e0b');
      
      return `
        <div class="date-event-item" data-event-id="${e.id}" data-idx="${idx}"
          style="display:flex;align-items:center;padding:12px;margin:6px 0;background:${bgColor};border-radius:8px;border-left:4px solid ${borderColor};cursor:grab;user-select:none;"
          draggable="true">
          <span style="font-size:18px;margin-right:10px;">${statusIcon}</span>
          <div style="flex:1;">
            <div style="font-weight:bold;font-size:14px;">${e.title}</div>
            <div style="font-size:12px;color:#666;">${price.toLocaleString()}원</div>
          </div>
          <span style="font-size:12px;color:#999;">⋮⋮</span>
        </div>
      `;
    };
    
    const eventsHtml = dateEvents.length > 0 
      ? dateEvents.map((e, idx) => createEventHtml(e, idx)).join('')
      : '<div style="padding:30px;text-align:center;color:#999;">배정된 일정이 없습니다</div>';
    
    // 일일완료 버튼 HTML (배정플랜만)
    const dailyCloseBtn = isAlreadyClosed
      ? `<button type="button" id="daily-close-btn" style="width:100%;padding:14px;background:#22c55e;color:white;border:none;border-radius:8px;font-size:15px;font-weight:bold;margin-top:15px;">✅ 일일마감 완료됨 (해제하려면 클릭)</button>`
      : allCompleted
        ? `<button type="button" id="daily-close-btn" style="width:100%;padding:14px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:15px;font-weight:bold;margin-top:15px;">📋 일일마감 처리</button>`
        : `<button type="button" id="daily-close-btn" disabled style="width:100%;padding:14px;background:#d1d5db;color:#6b7280;border:none;border-radius:8px;font-size:15px;font-weight:bold;margin-top:15px;">⏳ 미완료 ${pendingEvents.length}건 (일일마감 불가)</button>`;
    
    // eslint-disable-next-line no-unused-vars
    const { value: action } = await Swal.fire({
      title: `📅 ${dateStr}`,
      html: `
        <div style="text-align:left;">
          <!-- 요약 정보 -->
          <div style="display:flex;gap:10px;margin-bottom:15px;">
            <div style="flex:1;padding:12px;background:#dbeafe;border-radius:8px;text-align:center;">
              <div style="font-size:11px;color:#1d4ed8;">총매출</div>
              <div style="font-size:18px;font-weight:bold;color:#1e40af;">${totalRevenue.toLocaleString()}원</div>
            </div>
            <div style="flex:1;padding:12px;background:#dcfce7;border-radius:8px;text-align:center;">
              <div style="font-size:11px;color:#16a34a;">완료</div>
              <div style="font-size:18px;font-weight:bold;color:#15803d;">${completedEvents.length}건</div>
            </div>
            <div style="flex:1;padding:12px;background:#fef3c7;border-radius:8px;text-align:center;">
              <div style="font-size:11px;color:#d97706;">대기</div>
              <div style="font-size:18px;font-weight:bold;color:#b45309;">${pendingEvents.length}건</div>
            </div>
          </div>
          
          <!-- 고객 목록 (드래그 가능) -->
          <div style="font-size:12px;color:#666;margin-bottom:8px;">📋 고객 목록 (드래그로 날짜 이동)</div>
          <div id="date-events-list" style="max-height:280px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
            ${eventsHtml}
          </div>
          
          <!-- 일괄 완료/취소 버튼 -->
          ${!isAlreadyClosed && !monthClosed && dateEvents.length > 0 ? `
            <div style="display:flex;gap:6px;margin-top:10px;">
              ${pendingEvents.length > 0 ? `
                <button type="button" id="bulk-complete-btn" style="flex:1;padding:10px;background:#059669;color:white;border:none;border-radius:8px;font-size:13px;font-weight:bold;">✅ 일괄완료 (${pendingEvents.length})</button>
              ` : ''}
              <button type="button" id="multi-select-btn" style="flex:1;padding:10px;background:#6366f1;color:white;border:none;border-radius:8px;font-size:13px;font-weight:bold;">☑️ 선택처리</button>
              ${completedEvents.length > 0 ? `
                <button type="button" id="bulk-cancel-btn" style="flex:1;padding:10px;background:#f59e0b;color:white;border:none;border-radius:8px;font-size:13px;font-weight:bold;">↩️ 일괄취소 (${completedEvents.length})</button>
              ` : ''}
            </div>
          ` : ''}
          
          <!-- 일일완료 버튼 -->
          ${dailyCloseBtn}
          
          <!-- 완료 공유 버튼 -->
          <button type="button" id="share-day-btn"
            style="width:100%;padding:12px;background:#10b981;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;margin-top:8px;">
            📤 완료 일정 공유
          </button>

          <!-- 방문확정 알림 발송 버튼 -->
          ${pendingEvents.filter(e => !e.extendedProps?.isCoWork).length > 0 ? `
          <button type="button" id="confirm-visits-btn"
            style="width:100%;padding:12px;background:#0ea5e9;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;margin-top:8px;">
            📲 방문확정 알림 발송 (${pendingEvents.filter(e => !e.extendedProps?.isCoWork && !e.extendedProps?.visitConfirmed).length}명)
          </button>
          ` : ''}

          <!-- AI 일정 교체 버튼 -->
          ${settings.aiAssignEnabled !== false ? `
          <button type="button" id="ai-replace-btn"
            style="width:100%;padding:12px;background:#0ea5e9;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;margin-top:8px;">
            📷 사진/텍스트로 일정 교체
          </button>
          ` : ''}
          
          <!-- 불러오기 + 배정 추가 버튼 -->
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button type="button" id="load-to-date-btn" style="flex:1;padding:12px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:14px;">🔍 불러오기</button>
            ${waitingList.length > 0 ? `
              <button type="button" id="add-assignment-btn" style="flex:1;padding:12px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:14px;">➕ 배정 (${waitingList.length})</button>
            ` : ''}
          </div>
          <!-- 단기고객 등록 버튼 -->
          <button type="button" id="add-shortterm-btn"
            style="width:100%;padding:12px;background:#f59e0b;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;margin-top:8px;">
            🟡 단기고객 등록
          </button>
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: '닫기',
      width: '95%',
      didOpen: () => {
        // 일일마감 버튼 클릭
        const closeBtn = document.getElementById('daily-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            Swal.close();
            handleDailyClose(dateStr);
          });
        }

        // 완료 공유 버튼 클릭
        const shareBtn = document.getElementById('share-day-btn');
        if (shareBtn) {
          shareBtn.addEventListener('click', () => {
            Swal.close();
            handleShareDay(dateStr);
          });
        }

        // 방문확정 알림 발송 버튼 클릭
        const confirmVisitsBtn = document.getElementById('confirm-visits-btn');
        if (confirmVisitsBtn) {
          confirmVisitsBtn.addEventListener('click', () => {
            Swal.close();
            window.confirmAllVisitsForDay(dateStr);
          });
        }

        // AI 일정 교체 버튼 클릭
        const aiReplaceBtn = document.getElementById('ai-replace-btn');
        if (aiReplaceBtn) {
          aiReplaceBtn.addEventListener('click', () => {
            Swal.close();
            handleAIReplace(dateStr);
          });
        }
        
        // 불러오기 버튼 클릭
        const loadBtn = document.getElementById('load-to-date-btn');
        if (loadBtn) {
          loadBtn.addEventListener('click', () => {
            Swal.close();
            handleLoadToDate(dateStr);
          });
        }
        
        // 배정 추가 버튼 클릭
        const addBtn = document.getElementById('add-assignment-btn');
        if (addBtn) {
          addBtn.addEventListener('click', () => {
            Swal.close();
            handleDateClickCheckbox(info);
          });
        }

        // 단기고객 등록 버튼 클릭
        const shortTermBtn = document.getElementById('add-shortterm-btn');
        if (shortTermBtn) {
          shortTermBtn.addEventListener('click', () => {
            Swal.close();
            openShortTermPopup(dateStr);
          });
        }
        
        // 일괄완료 버튼 클릭
        const bulkCompleteBtn = document.getElementById('bulk-complete-btn');
        if (bulkCompleteBtn) {
          bulkCompleteBtn.addEventListener('click', () => {
            Swal.close();
            handleBulkComplete(dateStr, 'all');
          });
        }
        
        // 선택처리 버튼 클릭
        const multiSelectBtn = document.getElementById('multi-select-btn');
        if (multiSelectBtn) {
          multiSelectBtn.addEventListener('click', () => {
            Swal.close();
            handleMultiSelectAction(dateStr);
          });
        }
        
        // 일괄취소 버튼 클릭
        const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
        if (bulkCancelBtn) {
          bulkCancelBtn.addEventListener('click', () => {
            Swal.close();
            handleBulkCancelComplete(dateStr);
          });
        }
        
        // 이벤트 클릭 (상세보기)
        document.querySelectorAll('.date-event-item').forEach(item => {
          item.addEventListener('click', (e) => {
            if (e.target.closest('.date-event-item').dataset.dragging === 'true') return;
            const eventId = item.dataset.eventId;
            const event = events.find(ev => ev.id === eventId);
            if (event) {
              Swal.close();
              handleEventClick({ event: { id: event.id, title: event.title, startStr: event.start, extendedProps: event.extendedProps } });
            }
          });
        });
        
        // PC 드래그 이벤트
        if (!isMobile) {
          let draggedEventId = null;
          
          document.querySelectorAll('.date-event-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
              draggedEventId = item.dataset.eventId;
              item.dataset.dragging = 'true';
              e.dataTransfer.setData('text/plain', draggedEventId);
              e.dataTransfer.effectAllowed = 'move';
              item.style.opacity = '0.5';
            });
            
            item.addEventListener('dragend', (e) => {
              item.style.opacity = '1';
              setTimeout(() => { item.dataset.dragging = 'false'; }, 100);
            });
          });
        }
        
        // 모바일 드래그 (길게 누르기)
        if (isMobile) {
          document.querySelectorAll('.date-event-item').forEach(item => {
            let pressTimer = null;
            let startX = 0, startY = 0;
            
            item.addEventListener('touchstart', (e) => {
              startX = e.touches[0].clientX;
              startY = e.touches[0].clientY;
              
              pressTimer = setTimeout(() => {
                const eventId = item.dataset.eventId;
                const event = events.find(ev => ev.id === eventId);
                if (event) {
                  item.dataset.dragging = 'true';
                  Swal.close();
                  // 이벤트 드래그 시작
                  startEventDrag(event, e.touches[0].clientX, e.touches[0].clientY);
                }
              }, 300);
            });
            
            item.addEventListener('touchmove', (e) => {
              const moveX = Math.abs(e.touches[0].clientX - startX);
              const moveY = Math.abs(e.touches[0].clientY - startY);
              if (moveX > 10 || moveY > 10) {
                clearTimeout(pressTimer);
              }
            });
            
            item.addEventListener('touchend', () => {
              clearTimeout(pressTimer);
            });
          });
        }
      }
    });
  };

  // 이벤트 드래그 시작 (모바일)
  const startEventDrag = (event, clientX, clientY) => {
    setMobileDragItem({
      ...event,
      type: 'event',
      displayName: event.title
    });
    setShowScrollZones(true);
    mobileDragPosRef.current = { x: clientX, y: clientY };
    
    // document 레벨 이벤트
    const handleTouchMove = (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      mobileDragPosRef.current = { x: touch.clientX, y: touch.clientY };
      setMobileDragItem(prev => prev ? { ...prev, x: touch.clientX, y: touch.clientY } : null);
      
      // 스크롤 영역 체크
      const scrollZoneHeight = 60;
      if (touch.clientY < scrollZoneHeight) {
        calendarRef.current?.getApi().prev();
      } else if (touch.clientY > window.innerHeight - scrollZoneHeight) {
        calendarRef.current?.getApi().next();
      }
    };
    
    const handleTouchEnd = async (e) => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      
      setMobileDragItem(null);
      setShowScrollZones(false);
      
      // 드롭 위치에서 날짜 찾기
      const dropX = mobileDragPosRef.current.x;
      const dropY = mobileDragPosRef.current.y;
      const elements = document.elementsFromPoint(dropX, dropY);
      const dayCell = elements.find(el => el.classList.contains('fc-daygrid-day'));
      
      if (dayCell) {
        const newDate = dayCell.getAttribute('data-date');
        if (newDate && newDate !== event.start) {
          // 날짜 변경
          try {
            await updateDoc(doc(db, 'events', event.id), { date: newDate });
            Swal.fire({ toast: true, position: 'top', icon: 'success', title: `${newDate}로 이동`, timer: 1500, showConfirmButton: false });
            fetchData();
          } catch (error) {
            Swal.fire('오류', '이동 실패', 'error');
          }
        }
      }
    };
    
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  };

  // 날짜 클릭 - PC/모바일 공통 (요약 팝업)
  const handleDateClick = (info) => {
    handleDateSummary(info);
  };

  // 월마감
  const handleMonthClose = async () => {
    if (currentUser.role === 'master') {
      // 관리자: 직원 선택 + 토글
      let staffOpts = `<option value="${currentUser.id}">${currentUser.name} (본인)</option>`;
      staffList.forEach(s => {
        if (s.visibleId !== currentUser.id) {
          staffOpts += `<option value="${s.visibleId}">${s.name}</option>`;
        }
      });

      const { value: staffId, isConfirmed } = await Swal.fire({
        title: '🔐 월마감 관리',
        html: `
          <div style="margin-bottom:15px;">${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월</div>
          <select id="swal-staff-select" class="swal2-input">${staffOpts}</select>
        `,
        showCancelButton: true,
        confirmButtonText: '마감 토글',
        cancelButtonText: '닫기',
        preConfirm: () => document.getElementById('swal-staff-select').value
      });

      if (isConfirmed && staffId) {
        // 토글 처리
        const closeQuery = query(
          collection(db, 'monthClose'),
          where('year', '==', currentMonth.getFullYear()),
          where('month', '==', currentMonth.getMonth() + 1),
          where('staffId', '==', staffId)
        );
        const closeSnap = await getDocs(closeQuery);

        if (closeSnap.docs.length > 0) {
          // 해제
          await deleteDoc(closeSnap.docs[0].ref);
          Swal.fire('해제 완료', '월마감이 해제되었습니다', 'success');
        } else {
          // 마감
          await addDoc(collection(db, 'monthClose'), {
            year: currentMonth.getFullYear(),
            month: currentMonth.getMonth() + 1,
            staffId: staffId,
            closedAt: new Date().toISOString()
          });
          Swal.fire('마감 완료', '월마감 처리되었습니다', 'success');
        }
        fetchData();
      }
    } else {
      // 직원: 조건 체크
      if (monthClosed) {
        Swal.fire('이미 마감됨', '수정이 필요하면 관리자에게 요청하세요', 'info');
        return;
      }

      // 작업이 있는 날짜들 추출
      const workDates = [...new Set(events.map(e => e.start))].sort();
      
      // 일일마감 안 된 날짜 확인
      const notClosedDates = workDates.filter(date => !dailyClosedDates.includes(date));
      
      if (notClosedDates.length > 0) {
        const listHtml = notClosedDates.slice(0, 10).map(d => `• ${d}`).join('<br>');
        Swal.fire({
          title: '❌ 월마감 불가',
          html: `<div style="text-align:left;max-height:200px;overflow:auto;"><b>일일마감 안 된 날짜:</b><br>${listHtml}${notClosedDates.length > 10 ? '<br>...' : ''}</div><br><b>모든 날짜 일일마감 후 월마감하세요</b>`,
          icon: 'warning'
        });
        return;
      }

      // 미완료 체크
      const incomplete = events.filter(e => !['완료', '야근', '마감완료'].includes(e.extendedProps.status));
      const activeFolders = folders.filter(f => f.status === 'active' || (f.status === 'partial' && (f.assignedCount || 0) < (f.workCount || 1)));
      
      if (incomplete.length > 0 || waitingList.length > 0 || activeFolders.length > 0) {
        let listHtml = '<div style="max-height:200px; overflow-y:auto; text-align:left;">';
        if (incomplete.length > 0) {
          listHtml += '<div style="color:red; font-weight:bold;">⚠️ 미완료:</div>';
          incomplete.slice(0, 5).forEach(e => {
            listHtml += `<div>- ${e.title} (${e.start})</div>`;
          });
        }
        if (waitingList.length > 0) {
          listHtml += '<div style="color:orange; font-weight:bold; margin-top:10px;">📦 대기목록:</div>';
          waitingList.slice(0, 5).forEach(c => {
            listHtml += `<div>- ${c.name || c.title}</div>`;
          });
        }
        if (activeFolders.length > 0) {
          listHtml += '<div style="color:#8b5cf6; font-weight:bold; margin-top:10px;">📁 미배정 폴더:</div>';
          activeFolders.forEach(f => {
            listHtml += `<div>- ${f.name} (${f.customerIds?.length || 0}명)</div>`;
          });
        }
        listHtml += '</div>';

        Swal.fire({
          title: '❌ 월마감 불가',
          html: listHtml + '<br><b>모든 작업 완료 후 마감하세요</b>',
          icon: 'warning'
        });
        return;
      }

      // 마감 진행
      const result = await Swal.fire({
        title: '✅ 월마감',
        text: '이번 달 작업을 마감합니다',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '마감',
        cancelButtonText: '취소'
      });

      if (result.isConfirmed) {
        await addDoc(collection(db, 'monthClose'), {
          year: currentMonth.getFullYear(),
          month: currentMonth.getMonth() + 1,
          staffId: currentUser.id,
          closedAt: new Date().toISOString()
        });
        Swal.fire('마감 완료', '월마감 처리되었습니다', 'success');
        fetchData();
      }
    }
  };


  // 📷 AI 사진/텍스트 배정
  const handleAIAssign = async () => {

    // ── Step 1: 입력 팝업 ──
    const { value: formValues } = await Swal.fire({
      title: '📷 사진/텍스트 자동배정',
      html: `
        <div style="text-align:left;font-size:13px;color:#555;margin-bottom:12px;">
          날짜별 고객 목록이 담긴 <b>사진</b>이나 <b>텍스트</b>를 입력하세요.<br>
          AI가 날짜와 고객명을 인식해서 자동 배정합니다.
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-weight:bold;font-size:13px;">📎 이미지 업로드</label>
          <input type="file" id="ai-img-input" accept="image/*"
            style="display:block;width:100%;margin-top:6px;font-size:13px;"/>
        </div>
        <div style="text-align:center;color:#aaa;margin:8px 0;font-size:12px;">── 또는 ──</div>
        <div>
          <label style="font-weight:bold;font-size:13px;">📝 텍스트 직접 입력</label>
          <textarea id="ai-text-input" placeholder="예)&#10;5월 15일: 홍길동, 신세계강남&#10;5월 16일: 박철수"
            style="width:100%;height:120px;margin-top:6px;padding:8px;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;resize:none;box-sizing:border-box;"></textarea>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '🔍 AI 분석',
      cancelButtonText: '취소',
      confirmButtonColor: '#7c3aed',
      preConfirm: () => {
        const file = document.getElementById('ai-img-input').files[0];
        const text = document.getElementById('ai-text-input').value.trim();
        if (!file && !text) {
          Swal.showValidationMessage('이미지 또는 텍스트를 입력해주세요');
          return false;
        }
        return { file, text };
      }
    });

    if (!formValues) return;

    // ── Step 2: Claude AI로 날짜·고객명 추출 ──
    Swal.fire({ title: 'AI 분석 중...', html: '날짜와 고객명을 인식하고 있어요 🤖', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // API 키 확인
    const apiKey = settings.anthropicApiKey;
    if (!apiKey) {
      Swal.fire('API 키 없음', '설정 페이지에서 Anthropic API 키를 먼저 등록해주세요.', 'warning');
      return;
    }

    let aiResult = null;
    try {
      const currentYear = currentMonth.getFullYear();
      const currentMonthNum = currentMonth.getMonth() + 1;

      const systemPrompt = `당신은 날짜와 고객명 목록을 추출하는 전문가입니다.
입력에서 날짜별 고객/업체 이름 목록을 추출해서 반드시 아래 JSON 형식으로만 응답하세요.
날짜는 YYYY-MM-DD 형식으로 변환하세요. 연도가 없으면 ${currentYear}년으로 처리하세요.
월이 없으면 ${currentMonthNum}월로 처리하세요.

날짜 파싱 규칙:
- 날짜가 나오면 그 아래 나열된 이름들은 모두 그 날짜에 속합니다.
- 다음 날짜가 나올 때까지 이전 날짜가 계속 적용됩니다.
- 이름만 있고 날짜가 없으면 가장 최근에 나온 날짜에 포함시키세요.
- 구분선(----, ====, 빈줄 등)은 무시하고 날짜 기준으로만 구분하세요.
- 날짜 표현 예시: "4월1일", "4/1", "04-01", "4월 1일", "April 1" 등 모두 인식하세요.

JSON 외 다른 텍스트는 절대 출력하지 마세요.
형식: [{"date":"YYYY-MM-DD","customers":["이름1","이름2"]}]`;

      let messageContent;
      if (formValues.file) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(formValues.file);
        });
        const mediaType = formValues.file.type || 'image/jpeg';
        messageContent = [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: '이 이미지에서 날짜별 고객/업체 이름 목록을 추출해서 JSON으로 반환하세요.' }
        ];
      } else {
        messageContent = [{ type: 'text', text: formValues.text }];
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: messageContent }]
        })
      });

      const data = await response.json();
      const rawText = data.content?.find(b => b.type === 'text')?.text || '[]';
      const clean = rawText.replace(/```json|```/g, '').trim();
      aiResult = JSON.parse(clean);
    } catch (err) {
      console.error('AI 분석 오류:', err);
      Swal.fire('오류', 'AI 분석 중 오류가 발생했어요. 다시 시도해주세요.', 'error');
      return;
    }

    if (!aiResult || aiResult.length === 0) {
      Swal.fire('인식 실패', '날짜나 고객명을 찾지 못했어요.\n입력 내용을 확인해주세요.', 'warning');
      return;
    }

    // ── Step 3: 고객명 매칭 ──
    const thisYearNum = currentMonth.getFullYear();
    const thisMonthNum = currentMonth.getMonth() + 1;

    // 현재 달 배정된 이벤트 (공동작업 제외)
    const targetableEvents = events.filter(e => {
      if (!e.start) return false;
      const [ey, em] = e.start.split('-').map(Number);
      return ey === thisYearNum && em === thisMonthNum && !e.extendedProps?.isCoWork;
    });

    // 이름 유사도: 포함 관계 우선, 그 다음 공통 글자 비율
    const similarity = (a, b) => {
      const sa = a.replace(/\s/g, '');
      const sb = b.replace(/\s/g, '');
      if (sa.includes(sb) || sb.includes(sa)) return 1;
      let common = 0;
      for (const ch of sa) { if (sb.includes(ch)) common++; }
      return common / Math.max(sa.length, sb.length);
    };

    // 이벤트/대기목록 제목 정리 (회차·이모지 제거)
    const cleanTitle = (title) =>
      (title || '').replace(/\s*\(\d+\/\d+\).*$/, '').replace(/^[🌟📝]\s*/, '').trim();

    // 매칭 결과 분류
    const exactEventMatches  = []; // 이미 배정된 이벤트 → 날짜 이동
    const exactWaitingMatches = []; // 대기목록 → 신규 이벤트 생성
    const fuzzyMatches        = []; // 유사 매칭 (이벤트 or 대기목록) → 확인 필요
    const alreadyOnDate       = []; // 이미 해당 날짜에 있음
    const notFound            = []; // 아무것도 못 찾음

    for (const { date, customers } of aiResult) {
      for (const customerName of customers) {
        const trimName = customerName.trim();
        if (!trimName) continue;

        // 1) 이미 해당 날짜 배정 여부 (events)
        const alreadyThere = targetableEvents.find(e =>
          e.start === date && similarity(trimName, cleanTitle(e.title)) === 1
        );
        if (alreadyThere) {
          alreadyOnDate.push({ date, eventTitle: alreadyThere.title, customerName: trimName });
          continue;
        }

        // 2) 다른 날짜에 이미 배정된 이벤트 정확 매칭
        const exactEvent = targetableEvents.find(e =>
          e.start !== date && similarity(trimName, cleanTitle(e.title)) === 1
        );
        if (exactEvent) {
          exactEventMatches.push({ date, eventId: exactEvent.id, eventTitle: exactEvent.title, customerName: trimName, oldDate: exactEvent.start, source: 'event' });
          continue;
        }

        // 3) 대기목록 정확 매칭
        const exactWaiting = waitingList.find(w =>
          !w.isExtraWork && similarity(trimName, cleanTitle(w.title || w.name)) === 1
        );
        if (exactWaiting) {
          exactWaitingMatches.push({ date, customer: exactWaiting, customerName: trimName, source: 'waiting' });
          continue;
        }

        // 4) 유사 매칭 (events + 대기목록 통합 검색)
        let bestScore = 0, bestItem = null, bestSource = null;

        for (const e of targetableEvents) {
          if (e.start === date) continue;
          const score = similarity(trimName, cleanTitle(e.title));
          if (score > bestScore) { bestScore = score; bestItem = e; bestSource = 'event'; }
        }
        for (const w of waitingList) {
          if (w.isExtraWork) continue;
          const score = similarity(trimName, cleanTitle(w.title || w.name));
          if (score > bestScore) { bestScore = score; bestItem = w; bestSource = 'waiting'; }
        }

        if (bestItem && bestScore >= 0.5) {
          fuzzyMatches.push({
            date,
            customerName: trimName,
            score: bestScore,
            source: bestSource,
            // event
            eventId: bestSource === 'event' ? bestItem.id : null,
            eventTitle: bestSource === 'event' ? bestItem.title : null,
            oldDate: bestSource === 'event' ? bestItem.start : null,
            // waiting
            customer: bestSource === 'waiting' ? bestItem : null,
          });
        } else {
          notFound.push({ date, customerName: trimName, reason: '고객을 찾지 못했어요' });
        }
      }
    }

    Swal.close();

    // ── Step 4: 유사 매칭 확인 팝업 ──
    let confirmedFuzzy = [];
    let rejectedFuzzy  = [];

    if (fuzzyMatches.length > 0) {
      const fuzzyHtml = fuzzyMatches.map((f, i) => {
        const matchedLabel = f.source === 'event'
          ? `배정 이벤트: <b>${f.eventTitle}</b> (현재: ${f.oldDate})`
          : `대기목록: <b>${cleanTitle(f.customer?.title || f.customer?.name)}</b> → 신규 배정`;
        return `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;">
            <input type="checkbox" id="fuzzy-${i}" checked style="width:16px;height:16px;cursor:pointer;flex-shrink:0;margin-top:2px;"/>
            <div style="text-align:left;font-size:13px;">
              <div>AI 인식: <b style="color:#7c3aed;">${f.customerName}</b> → <b>${f.date}</b></div>
              <div style="color:#64748b;">${matchedLabel}</div>
              <div style="color:#f59e0b;font-size:11px;">유사도 ${Math.round(f.score * 100)}%</div>
            </div>
          </div>`;
      }).join('');

      const { isConfirmed: fuzzyOk } = await Swal.fire({
        title: '🔍 유사 고객 확인',
        html: `<div style="font-size:13px;color:#555;margin-bottom:12px;">정확히 일치하지 않는 고객이에요.<br>체크된 항목만 배정합니다.</div>${fuzzyHtml}`,
        showCancelButton: true,
        confirmButtonText: '✅ 선택 배정',
        cancelButtonText: '모두 건너뜀',
        confirmButtonColor: '#7c3aed',
        width: '90%',
      });

      fuzzyMatches.forEach((f, i) => {
        const cb = document.getElementById(`fuzzy-${i}`);
        if (fuzzyOk && cb?.checked) confirmedFuzzy.push(f);
        else rejectedFuzzy.push({ ...f, reason: fuzzyOk ? '사용자가 거절함' : '사용자가 건너뜀' });
      });
    }

    // ── Step 5: 직원 정보 결정 ──
    let targetStaffId = currentUser.id;
    let targetStaffName = currentUser.name;
    if (currentViewMode !== 'self' && currentViewMode !== 'admin' && currentViewMode !== currentUser.id) {
      const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
      if (viewingStaff) { targetStaffId = viewingStaff.visibleId; targetStaffName = viewingStaff.name; }
    }

    // ── Step 6: Firestore 업데이트 ──
    const allToProcess = [
      ...exactEventMatches.map(m => ({ ...m })),
      ...exactWaitingMatches.map(m => ({ ...m })),
      ...confirmedFuzzy,
    ];

    if (allToProcess.length === 0 && notFound.length === 0 && alreadyOnDate.length === 0) {
      Swal.fire('알림', '배정할 항목이 없어요.', 'info');
      return;
    }

    Swal.fire({ title: '배정 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const moveSuccesses  = [];
    const createSuccesses = [];
    const moveFailures   = [...notFound, ...rejectedFuzzy];

    for (const item of allToProcess) {
      try {
        if (item.source === 'event') {
          // 이미 배정된 이벤트 → 날짜만 변경
          const ev = targetableEvents.find(e => e.id === item.eventId);
          const updateData = { date: item.date };
          if (ev && ['완료', '야근'].includes(ev.extendedProps?.status)) {
            updateData.status = '배정';
            updateData.completedBy = '';
            updateData.completedAt = '';
          }
          await updateDoc(doc(db, 'events', item.eventId), updateData);

          // 공동작업자도 같이 이동
          const coSnap = await getDocs(query(collection(db, 'events'), where('parentEventId', '==', item.eventId)));
          for (const coDoc of coSnap.docs) {
            await updateDoc(doc(db, 'events', coDoc.id), { date: item.date });
          }
          moveSuccesses.push(item);

        } else if (item.source === 'waiting') {
          // 대기목록 고객 → 신규 이벤트 생성
          const w = item.customer;
          const customer = customers.find(c => c.id === (w.originalId || w.customerId || w.id));

          if (w.isSpecial) {
            // 특별작업
            await addDoc(collection(db, 'events'), {
              title: w.title || w.name,
              date: item.date,
              customerCode: w.customerId,
              price: w.price || 0,
              status: '배정',
              staffId: targetStaffId,
              staffName: targetStaffName,
              phone: customer?.phone || '',
              address: customer?.address || '',
              isCoWork: false,
              workType: 'special',
              createdAt: new Date().toISOString()
            });
          } else {
            // 일반 정기작업
            const coWorkersArray = customer?.coWorkers || [];
            if (coWorkersArray.length === 0 && customer?.coWorker?.enabled && customer?.coWorker?.staffName) {
              coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
            }
            const totalCoWorkPrice = coWorkersArray.reduce((sum, cw) => sum + (cw.price || 0), 0);
            const mainPrice = Math.max(0, (w.price || 0) - totalCoWorkPrice);

            const mainRef = await addDoc(collection(db, 'events'), {
              title: w.title || w.displayName || w.name,
              date: item.date,
              customerCode: w.originalId || w.id,
              price: mainPrice,
              originalPrice: w.price || 0,
              status: '배정',
              staffId: targetStaffId,
              staffName: targetStaffName,
              phone: customer?.phone || '',
              address: customer?.address || '',
              isCoWork: false,
              workType: 'regular',
              createdAt: new Date().toISOString()
            });

            // 공동작업자 이벤트 생성
            for (const cw of coWorkersArray) {
              if (!cw.staffName) continue;
              const cwStaff = staffList.find(s => s.name === cw.staffName);
              if (!cwStaff) continue;
              await addDoc(collection(db, 'events'), {
                title: w.title || w.displayName || w.name,
                date: item.date,
                customerCode: w.originalId || w.id,
                price: cw.price || 0,
                coWorkPrice: cw.price || 0,
                status: '배정',
                staffId: cwStaff.visibleId,
                staffName: cwStaff.name,
                phone: customer?.phone || '',
                address: customer?.address || '',
                isCoWork: true,
                workType: 'regular',
                parentEventId: mainRef.id,
                mainStaffName: targetStaffName,
                createdAt: new Date().toISOString()
              });
            }
          }
          createSuccesses.push(item);
        }
      } catch (err) {
        console.error('배정 실패:', item.customerName, err);
        moveFailures.push({ ...item, reason: 'Firestore 오류' });
      }
    }

    // ── Step 7: 결과 팝업 ──
    await fetchData();
    Swal.close();

    const movedHtml = moveSuccesses.length > 0
      ? `<div style="margin-bottom:14px;">
          <div style="font-weight:bold;color:#10b981;margin-bottom:6px;">✅ 날짜 이동 ${moveSuccesses.length}건</div>
          ${moveSuccesses.map(s => `<div style="font-size:13px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
            ${s.customerName} <span style="color:#94a3b8;font-size:11px;">${s.oldDate} → ${s.date}</span>
          </div>`).join('')}
        </div>` : '';

    const createdHtml = createSuccesses.length > 0
      ? `<div style="margin-bottom:14px;">
          <div style="font-weight:bold;color:#3b82f6;margin-bottom:6px;">🆕 신규 배정 ${createSuccesses.length}건</div>
          ${createSuccesses.map(s => `<div style="font-size:13px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
            ${s.customerName} <span style="color:#94a3b8;font-size:11px;">→ ${s.date}</span>
          </div>`).join('')}
        </div>` : '';

    const alreadyHtml = alreadyOnDate.length > 0
      ? `<div style="margin-bottom:14px;">
          <div style="font-weight:bold;color:#f59e0b;margin-bottom:6px;">📌 이미 해당 날짜 ${alreadyOnDate.length}건</div>
          ${alreadyOnDate.map(s => `<div style="font-size:13px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
            ${s.customerName} <span style="color:#94a3b8;font-size:11px;">(${s.date})</span>
          </div>`).join('')}
        </div>` : '';

    const failHtml = moveFailures.length > 0
      ? `<div>
          <div style="font-weight:bold;color:#ef4444;margin-bottom:6px;">❌ 실패 ${moveFailures.length}건</div>
          ${moveFailures.map(f => `<div style="font-size:13px;padding:3px 0;border-bottom:1px solid #f1f5f9;">
            ${f.customerName} <span style="color:#94a3b8;font-size:11px;">— ${f.reason}</span>
          </div>`).join('')}
        </div>` : '';

    const totalSuccess = moveSuccesses.length + createSuccesses.length;
    await Swal.fire({
      title: '📋 배정 결과',
      html: `<div style="text-align:left;max-height:420px;overflow-y:auto;padding:4px;">
        ${movedHtml}${createdHtml}${alreadyHtml}${failHtml}
      </div>`,
      icon: totalSuccess > 0 ? 'success' : 'info',
      confirmButtonText: '확인',
      width: '90%'
    });
  };

  // 📷 특정 날짜 일정 교체 (미완료 → 대기목록 복귀, 새 고객 배정)
  const handleAIReplace = async (dateStr) => {

    // API 키 확인
    const apiKey = settings.anthropicApiKey;
    if (!apiKey) {
      Swal.fire('API 키 없음', '설정 페이지에서 Anthropic API 키를 먼저 등록해주세요.', 'warning');
      return;
    }

    // eslint-disable-next-line no-unused-vars
    const [y, m, d] = dateStr.split('-');

    // ── Step 1: 입력 팝업 ──
    const { value: formValues } = await Swal.fire({
      title: `📷 ${m}월 ${d}일 일정 교체`,
      html: `
        <div style="text-align:left;font-size:13px;color:#555;margin-bottom:12px;">
          이 날짜에 배정할 고객 목록을 <b>사진</b>이나 <b>텍스트</b>로 입력하세요.<br>
          <span style="color:#ef4444;">⚠️ 미완료 일정은 대기목록으로 돌아갑니다.</span>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-weight:bold;font-size:13px;">📎 이미지 업로드</label>
          <input type="file" id="replace-img-input" accept="image/*"
            style="display:block;width:100%;margin-top:6px;font-size:13px;"/>
        </div>
        <div style="text-align:center;color:#aaa;margin:8px 0;font-size:12px;">── 또는 ──</div>
        <div>
          <label style="font-weight:bold;font-size:13px;">📝 텍스트 직접 입력</label>
          <textarea id="replace-text-input" placeholder="고객 이름을 한 줄씩 입력&#10;예)&#10;홍길동&#10;신세계강남&#10;박철수"
            style="width:100%;height:120px;margin-top:6px;padding:8px;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;resize:none;box-sizing:border-box;"></textarea>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '🔍 AI 분석',
      cancelButtonText: '취소',
      confirmButtonColor: '#0ea5e9',
      preConfirm: () => {
        const file = document.getElementById('replace-img-input').files[0];
        const text = document.getElementById('replace-text-input').value.trim();
        if (!file && !text) {
          Swal.showValidationMessage('이미지 또는 텍스트를 입력해주세요');
          return false;
        }
        return { file, text };
      }
    });

    if (!formValues) return;

    // ── Step 2: AI로 고객명만 추출 (날짜 불필요) ──
    Swal.fire({ title: 'AI 분석 중...', html: '고객명을 인식하고 있어요 🤖', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    let newCustomerNames = [];
    try {
      const systemPrompt = `당신은 고객/업체 이름 목록을 추출하는 전문가입니다.
입력에서 고객/업체 이름만 추출해서 반드시 아래 JSON 배열 형식으로만 응답하세요.
날짜, 번호, 기호 등은 무시하고 이름만 추출하세요.
JSON 외 다른 텍스트는 절대 출력하지 마세요.
형식: ["이름1","이름2","이름3"]`;

      let messageContent;
      if (formValues.file) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(formValues.file);
        });
        const mediaType = formValues.file.type || 'image/jpeg';
        messageContent = [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: '이 이미지에서 고객/업체 이름 목록만 추출해서 JSON 배열로 반환하세요.' }
        ];
      } else {
        messageContent = [{ type: 'text', text: formValues.text }];
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: messageContent }]
        })
      });

      const data = await response.json();
      const rawText = data.content?.find(b => b.type === 'text')?.text || '[]';
      const clean = rawText.replace(/```json|```/g, '').trim();
      newCustomerNames = JSON.parse(clean);
    } catch (err) {
      console.error('AI 분석 오류:', err);
      Swal.fire('오류', 'AI 분석 중 오류가 발생했어요.', 'error');
      return;
    }

    if (!newCustomerNames || newCustomerNames.length === 0) {
      Swal.fire('인식 실패', '고객명을 찾지 못했어요.\n입력 내용을 확인해주세요.', 'warning');
      return;
    }

    Swal.close();

    // ── Step 3: 현재 날짜 미완료 이벤트 파악 ──
    const thisYearNum = currentMonth.getFullYear();
    const thisMonthNum = currentMonth.getMonth() + 1;
    const dayEvents = events.filter(e => {
      if (!e.start) return false;
      const [ey, em] = e.start.split('-').map(Number);
      return ey === thisYearNum && em === thisMonthNum && e.start === dateStr && !e.extendedProps?.isCoWork;
    });
    const incompleteEvents = dayEvents.filter(e => !['완료', '야근'].includes(e.extendedProps?.status));
    const completedEvents  = dayEvents.filter(e =>  ['완료', '야근'].includes(e.extendedProps?.status));

    // ── Step 4: 새 고객 매칭 ──
    const similarity = (a, b) => {
      const sa = a.replace(/\s/g, '');
      const sb = b.replace(/\s/g, '');
      if (sa.includes(sb) || sb.includes(sa)) return 1;
      let common = 0;
      for (const ch of sa) { if (sb.includes(ch)) common++; }
      return common / Math.max(sa.length, sb.length);
    };
    const cleanTitle = (title) =>
      (title || '').replace(/\s*\(\d+\/\d+\).*$/, '').replace(/^[🌟📝]\s*/, '').trim();

    // 매칭 대상: 현재 달 다른 날 이벤트 + 대기목록
    const otherEvents = events.filter(e => {
      if (!e.start) return false;
      const [ey, em] = e.start.split('-').map(Number);
      return ey === thisYearNum && em === thisMonthNum && e.start !== dateStr && !e.extendedProps?.isCoWork;
    });

    const exactEventMatches  = [];
    const exactWaitingMatches = [];
    const fuzzyMatches        = [];
    const notFound            = [];

    for (const customerName of newCustomerNames) {
      const trimName = customerName.trim();
      if (!trimName) continue;

      // 다른 날 이벤트 정확 매칭
      const exactEvent = otherEvents.find(e => similarity(trimName, cleanTitle(e.title)) === 1);
      if (exactEvent) {
        exactEventMatches.push({ date: dateStr, eventId: exactEvent.id, eventTitle: exactEvent.title, customerName: trimName, oldDate: exactEvent.start, source: 'event' });
        continue;
      }

      // 대기목록 정확 매칭
      const exactWaiting = waitingList.find(w => !w.isExtraWork && similarity(trimName, cleanTitle(w.title || w.name)) === 1);
      if (exactWaiting) {
        exactWaitingMatches.push({ date: dateStr, customer: exactWaiting, customerName: trimName, source: 'waiting' });
        continue;
      }

      // 유사 매칭
      let bestScore = 0, bestItem = null, bestSource = null;
      for (const e of otherEvents) {
        const score = similarity(trimName, cleanTitle(e.title));
        if (score > bestScore) { bestScore = score; bestItem = e; bestSource = 'event'; }
      }
      for (const w of waitingList) {
        if (w.isExtraWork) continue;
        const score = similarity(trimName, cleanTitle(w.title || w.name));
        if (score > bestScore) { bestScore = score; bestItem = w; bestSource = 'waiting'; }
      }

      if (bestItem && bestScore >= 0.5) {
        fuzzyMatches.push({
          date: dateStr, customerName: trimName, score: bestScore, source: bestSource,
          eventId: bestSource === 'event' ? bestItem.id : null,
          eventTitle: bestSource === 'event' ? bestItem.title : null,
          oldDate: bestSource === 'event' ? bestItem.start : null,
          customer: bestSource === 'waiting' ? bestItem : null,
        });
      } else {
        notFound.push({ customerName: trimName, reason: '고객을 찾지 못했어요' });
      }
    }

    // ── Step 5: 최종 확인 팝업 ──
    const incompleteHtml = incompleteEvents.length > 0
      ? `<div style="margin-bottom:12px;padding:10px;background:#fff7ed;border-radius:8px;border:1px solid #fed7aa;">
          <div style="font-weight:bold;color:#ea580c;margin-bottom:4px;">↩️ 대기목록으로 복귀 ${incompleteEvents.length}건</div>
          ${incompleteEvents.map(e => `<div style="font-size:12px;color:#555;">${e.title}</div>`).join('')}
        </div>` : '';

    const newHtml = `<div style="margin-bottom:12px;padding:10px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        <div style="font-weight:bold;color:#16a34a;margin-bottom:4px;">🆕 새로 배정 ${exactEventMatches.length + exactWaitingMatches.length + fuzzyMatches.length}명</div>
        ${[...exactEventMatches, ...exactWaitingMatches].map(e => `<div style="font-size:12px;color:#555;">${e.customerName}</div>`).join('')}
        ${fuzzyMatches.map(f => `<div style="font-size:12px;color:#f59e0b;">⚠️ ${f.customerName} (유사매칭 ${Math.round(f.score*100)}%)</div>`).join('')}
        ${notFound.length > 0 ? `<div style="font-size:12px;color:#ef4444;margin-top:4px;">❌ 못찾음 ${notFound.length}건: ${notFound.map(n=>n.customerName).join(', ')}</div>` : ''}
      </div>`;

    const { isConfirmed } = await Swal.fire({
      title: `📋 ${m}월 ${d}일 일정 교체 확인`,
      html: `<div style="text-align:left;">${incompleteHtml}${newHtml}${completedEvents.length > 0 ? `<div style="font-size:12px;color:#94a3b8;">✅ 완료/야근 ${completedEvents.length}건은 유지됩니다.</div>` : ''}</div>`,
      showCancelButton: true,
      confirmButtonText: '교체 실행',
      cancelButtonText: '취소',
      confirmButtonColor: '#0ea5e9',
      width: '90%'
    });

    if (!isConfirmed) return;

    // ── Step 6: 유사 매칭 확인 ──
    let confirmedFuzzy = [];
    let rejectedFuzzy  = [];

    if (fuzzyMatches.length > 0) {
      const fuzzyHtml = fuzzyMatches.map((f, i) => {
        const matchedLabel = f.source === 'event'
          ? `배정 이벤트: <b>${f.eventTitle}</b> (현재: ${f.oldDate})`
          : `대기목록: <b>${cleanTitle(f.customer?.title || f.customer?.name)}</b>`;
        return `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;">
            <input type="checkbox" id="rfuzzy-${i}" checked style="width:16px;height:16px;cursor:pointer;flex-shrink:0;margin-top:2px;"/>
            <div style="text-align:left;font-size:13px;">
              <div>AI 인식: <b style="color:#0ea5e9;">${f.customerName}</b></div>
              <div style="color:#64748b;">${matchedLabel}</div>
              <div style="color:#f59e0b;font-size:11px;">유사도 ${Math.round(f.score * 100)}%</div>
            </div>
          </div>`;
      }).join('');

      const { isConfirmed: fuzzyOk } = await Swal.fire({
        title: '🔍 유사 고객 확인',
        html: `<div style="font-size:13px;color:#555;margin-bottom:12px;">정확히 일치하지 않는 고객이에요.<br>체크된 항목만 배정합니다.</div>${fuzzyHtml}`,
        showCancelButton: true,
        confirmButtonText: '✅ 선택 배정',
        cancelButtonText: '모두 건너뜀',
        confirmButtonColor: '#0ea5e9',
        width: '90%',
      });

      fuzzyMatches.forEach((f, i) => {
        const cb = document.getElementById(`rfuzzy-${i}`);
        if (fuzzyOk && cb?.checked) confirmedFuzzy.push(f);
        else rejectedFuzzy.push({ ...f, reason: fuzzyOk ? '사용자가 거절함' : '건너뜀' });
      });
    }

    // ── Step 7: Firestore 실행 ──
    Swal.fire({ title: '교체 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // 직원 정보
    let targetStaffId = currentUser.id;
    let targetStaffName = currentUser.name;
    if (currentViewMode !== 'self' && currentViewMode !== 'admin' && currentViewMode !== currentUser.id) {
      const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
      if (viewingStaff) { targetStaffId = viewingStaff.visibleId; targetStaffName = viewingStaff.name; }
    }

    // ① 미완료 이벤트 삭제 (완료/야근은 유지)
    for (const ev of incompleteEvents) {
      try {
        // 공동작업자 이벤트도 삭제
        const coSnap = await getDocs(query(collection(db, 'events'), where('parentEventId', '==', ev.id)));
        for (const coDoc of coSnap.docs) await deleteDoc(doc(db, 'events', coDoc.id));
        await deleteDoc(doc(db, 'events', ev.id));
      } catch (err) { console.error('삭제 실패:', ev.title, err); }
    }

    // ② 새 고객 배정
    const allToAssign = [...exactEventMatches, ...exactWaitingMatches, ...confirmedFuzzy];
    const createSuccesses = [];
    const moveSuccesses   = [];
    const failures        = [...notFound, ...rejectedFuzzy];

    for (const item of allToAssign) {
      try {
        if (item.source === 'event') {
          // 다른 날 이벤트 → 이 날짜로 이동
          const updateData = { date: dateStr };
          const ev = events.find(e => e.id === item.eventId);
          if (ev && ['완료', '야근'].includes(ev.extendedProps?.status)) {
            updateData.status = '배정'; updateData.completedBy = ''; updateData.completedAt = '';
          }
          await updateDoc(doc(db, 'events', item.eventId), updateData);
          const coSnap = await getDocs(query(collection(db, 'events'), where('parentEventId', '==', item.eventId)));
          for (const coDoc of coSnap.docs) await updateDoc(doc(db, 'events', coDoc.id), { date: dateStr });
          moveSuccesses.push(item);
        } else {
          // 대기목록 → 신규 이벤트 생성
          const w = item.customer;
          const customer = customers.find(c => c.id === (w.originalId || w.customerId || w.id));
          if (w.isSpecial) {
            await addDoc(collection(db, 'events'), {
              title: w.title || w.name, date: dateStr, customerCode: w.customerId,
              price: w.price || 0, status: '배정', staffId: targetStaffId, staffName: targetStaffName,
              phone: customer?.phone || '', address: customer?.address || '',
              isCoWork: false, workType: 'special', createdAt: new Date().toISOString()
            });
          } else {
            const coWorkersArray = customer?.coWorkers || [];
            if (coWorkersArray.length === 0 && customer?.coWorker?.enabled && customer?.coWorker?.staffName) {
              coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
            }
            const totalCoWorkPrice = coWorkersArray.reduce((sum, cw) => sum + (cw.price || 0), 0);
            const mainRef = await addDoc(collection(db, 'events'), {
              title: w.title || w.displayName || w.name, date: dateStr,
              customerCode: w.originalId || w.id, price: Math.max(0, (w.price || 0) - totalCoWorkPrice),
              originalPrice: w.price || 0, status: '배정', staffId: targetStaffId, staffName: targetStaffName,
              phone: customer?.phone || '', address: customer?.address || '',
              isCoWork: false, workType: 'regular', createdAt: new Date().toISOString()
            });
            for (const cw of coWorkersArray) {
              if (!cw.staffName) continue;
              const cwStaff = staffList.find(s => s.name === cw.staffName);
              if (!cwStaff) continue;
              await addDoc(collection(db, 'events'), {
                title: w.title || w.displayName || w.name, date: dateStr,
                customerCode: w.originalId || w.id, price: cw.price || 0, coWorkPrice: cw.price || 0,
                status: '배정', staffId: cwStaff.visibleId, staffName: cwStaff.name,
                phone: customer?.phone || '', address: customer?.address || '',
                isCoWork: true, workType: 'regular', parentEventId: mainRef.id,
                mainStaffName: targetStaffName, createdAt: new Date().toISOString()
              });
            }
          }
          createSuccesses.push(item);
        }
      } catch (err) {
        console.error('배정 실패:', item.customerName, err);
        failures.push({ ...item, reason: 'Firestore 오류' });
      }
    }

    // ── Step 8: 결과 팝업 ──
    await fetchData();
    Swal.close();

    const totalSuccess = moveSuccesses.length + createSuccesses.length;
    await Swal.fire({
      title: '📋 교체 결과',
      html: `<div style="text-align:left;max-height:400px;overflow-y:auto;padding:4px;">
        ${incompleteEvents.length > 0 ? `<div style="margin-bottom:12px;"><div style="font-weight:bold;color:#ea580c;margin-bottom:4px;">↩️ 대기목록 복귀 ${incompleteEvents.length}건</div>${incompleteEvents.map(e=>`<div style="font-size:13px;padding:2px 0;">${e.title}</div>`).join('')}</div>` : ''}
        ${moveSuccesses.length > 0 ? `<div style="margin-bottom:12px;"><div style="font-weight:bold;color:#3b82f6;margin-bottom:4px;">✅ 날짜 이동 ${moveSuccesses.length}건</div>${moveSuccesses.map(s=>`<div style="font-size:13px;padding:2px 0;">${s.customerName} <span style="color:#94a3b8;font-size:11px;">${s.oldDate} → ${dateStr}</span></div>`).join('')}</div>` : ''}
        ${createSuccesses.length > 0 ? `<div style="margin-bottom:12px;"><div style="font-weight:bold;color:#10b981;margin-bottom:4px;">🆕 신규 배정 ${createSuccesses.length}건</div>${createSuccesses.map(s=>`<div style="font-size:13px;padding:2px 0;">${s.customerName}</div>`).join('')}</div>` : ''}
        ${failures.length > 0 ? `<div><div style="font-weight:bold;color:#ef4444;margin-bottom:4px;">❌ 실패 ${failures.length}건</div>${failures.map(f=>`<div style="font-size:13px;padding:2px 0;">${f.customerName} <span style="color:#94a3b8;font-size:11px;">— ${f.reason}</span></div>`).join('')}</div>` : ''}
      </div>`,
      icon: totalSuccess > 0 ? 'success' : 'info',
      confirmButtonText: '확인',
      width: '90%'
    });
  };

  // 🚀 자동배치: 이전달 완료 기록 기반으로 대기목록 고객을 캘린더에 자동 배정
  const handleAutoAssign = async () => {
    const thisYear = currentMonth.getFullYear();
    const thisMonth = currentMonth.getMonth() + 1;
    const prevMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const prevYear = thisMonth === 1 ? thisYear - 1 : thisYear;

    // 대기목록이 비어있으면 안내
    if (waitingList.length === 0) {
      Swal.fire('알림', '대기목록에 배정할 고객이 없습니다', 'info');
      return;
    }

    // 정기 작업만 필터 (특별작업·추가업무 제외)
    const regularWaiting = waitingList.filter(c => !c.isSpecial && !c.isExtraWork && !c.id?.startsWith('special_') && !c.id?.startsWith('extra_'));

    const result = await Swal.fire({
      title: '🚀 자동배치',
      html: `
        <div style="text-align:left; padding:10px; background:#f8fafc; border-radius:8px;">
          <div style="margin-bottom:10px;"><b>${prevYear}년 ${prevMonth}월</b> 완료 기록 기반 → <b>${thisYear}년 ${thisMonth}월</b> 자동 배정</div>
          <div style="font-size:13px; color:#333; margin-bottom:8px;">대기목록: <b>${regularWaiting.length}명</b> (정기)</div>
          <div style="font-size:12px; color:#666;">
            ✅ 대기목록의 정기 고객만 대상<br>
            ✅ 같은 주차 + 같은 요일로 배정<br>
            ✅ 이전달 기록 없는 고객은 대기목록 유지<br>
            ❌ 특별작업·추가업무는 수동 배정
          </div>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '자동배치',
      cancelButtonText: '취소'
    });

    if (!result.isConfirmed) return;

    try {
      Swal.fire({ title: '자동배치 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      // 현재 보고 있는 직원의 staffId (fetchData와 동일 로직)
      let targetStaffId = currentUser.id;
      let targetStaffName = currentUser.name;
      if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
        const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
        if (viewingStaff) {
          targetStaffId = viewingStaff.visibleId;
          targetStaffName = viewingStaff.name;
        }
      }

      console.log('🚀 자동배치 - targetStaffId:', targetStaffId, 'targetStaffName:', targetStaffName);

      // 1. 이전달 완료 이벤트 조회 - 현재 보고 있는 직원의 이름 기준으로도 검색
      const prevMonthPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
      
      // staffId로 조회
      const prevEventsSnap = await getDocs(query(
        collection(db, 'events'),
        where('staffId', '==', targetStaffId)
      ));
      
      // 고객별 이전달 완료 기록 맵 (customerId → [날짜들])
      const prevRecords = {};
      for (const d of prevEventsSnap.docs) {
        const data = d.data();
        if (!data.date || !data.date.startsWith(prevMonthPrefix)) continue;
        if ((data.status === '완료' || data.status === '야근') && 
            !data.isCoWork && data.workType !== 'special' && !data.isCarryOver) {
          const custId = data.customerCode;
          if (!prevRecords[custId]) prevRecords[custId] = [];
          prevRecords[custId].push(data.date);
        }
      }
      
      // 이름으로도 fallback 시도 (staffId가 다를 수 있음)
      if (Object.keys(prevRecords).length === 0 && targetStaffName) {
        console.log('⚠️ staffId로 이전달 기록 0건 → staffName으로 재검색:', targetStaffName);
        const prevByNameSnap = await getDocs(query(
          collection(db, 'events'),
          where('staffName', '==', targetStaffName)
        ));
        for (const d of prevByNameSnap.docs) {
          const data = d.data();
          if (!data.date || !data.date.startsWith(prevMonthPrefix)) continue;
          if ((data.status === '완료' || data.status === '야근') && 
              !data.isCoWork && data.workType !== 'special' && !data.isCarryOver) {
            const custId = data.customerCode;
            if (!prevRecords[custId]) prevRecords[custId] = [];
            prevRecords[custId].push(data.date);
          }
        }
      }

      // 각 고객의 날짜를 오름차순 정렬
      for (const custId of Object.keys(prevRecords)) {
        prevRecords[custId].sort();
      }

      console.log('📊 이전달 완료 기록:', Object.keys(prevRecords).length, '명 -', prevRecords);

      // 2. 대기목록에서 이전달 기록 기반으로 자동 배정
      // 고객별 몇 번째 배정인지 추적 (월 2회 이상 대응)
      const customerAssignCount = {};
      let assignedCount = 0;
      let skippedCount = 0;

      for (const customer of regularWaiting) {
        const custId = customer.originalId || customer.id?.split('_')[0];
        if (!custId) { skippedCount++; continue; }

        // 이전달 기록 확인
        const prevDates = prevRecords[custId];
        if (!prevDates || prevDates.length === 0) {
          skippedCount++;
          continue;
        }

        // 이 고객의 몇 번째 배정인지 (월 2회 이상 처리)
        if (!customerAssignCount[custId]) customerAssignCount[custId] = 0;
        const dateIndex = customerAssignCount[custId];
        customerAssignCount[custId]++;

        // 해당 인덱스의 이전달 날짜가 없으면 스킵
        if (dateIndex >= prevDates.length) {
          skippedCount++;
          continue;
        }

        const prevDate = prevDates[dateIndex];
        const oldDate = new Date(prevDate);
        const weekOfMonth = Math.ceil(oldDate.getDate() / 7);
        const dayOfWeek = oldDate.getDay();

        // 이번달 같은 주차 + 같은 요일 계산
        const newDate = new Date(thisYear, thisMonth - 1, 1);
        newDate.setDate(1 + (weekOfMonth - 1) * 7 + (dayOfWeek - newDate.getDay() + 7) % 7);
        
        // 이번달 벗어나면 1주 앞당김
        if (newDate.getMonth() !== thisMonth - 1) {
          newDate.setDate(newDate.getDate() - 7);
        }

        const newDateStr = toLocalDateStr(newDate); // UTC 시차 버그 방지

        // 공동작업비 계산
        let totalCoWorkPrice = 0;
        const coWorkersArray = customer.coWorkers || [];
        if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
          totalCoWorkPrice = customer.coWorker.price || 0;
        } else {
          totalCoWorkPrice = coWorkersArray.reduce((sum, cw) => sum + (cw.price || 0), 0);
        }
        const eventPrice = customer.price || 0;
        const mainEventPrice = Math.max(0, eventPrice - totalCoWorkPrice);

        // 이벤트 생성 (assignCustomerToDate와 동일 구조)
        const mainEventRef = await addDoc(collection(db, 'events'), {
          title: customer.displayName || customer.name || customer.title,
          date: newDateStr,
          customerCode: custId,
          price: mainEventPrice,
          originalPrice: eventPrice,
          status: '배정',
          staffId: targetStaffId,
          staffName: targetStaffName,
          phone: customer.phone || '',
          address: customer.address || '',
          isCoWork: false,
          workType: 'regular',
          workRound: customer.currentIndex !== undefined ? customer.currentIndex : 0, // ✅ 회차 인덱스 저장
          totalCount: customer.totalCount || 1,
          isCharged: customer.isCharged !== false, // ✅ 무료 여부 저장
          priceOverride: customer.priceOverride || 0, // ✅ 회차별 금액 저장
          createdAt: new Date().toISOString()
        });

        // 공동작업자 이벤트 생성
        const allCoWorkers = [...coWorkersArray];
        if (allCoWorkers.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
          allCoWorkers.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
        }
        for (const coWorker of allCoWorkers) {
          if (coWorker.staffName) {
            const coWorkerStaff = staffList.find(s => s.name === coWorker.staffName);
            if (coWorkerStaff) {
              await addDoc(collection(db, 'events'), {
                title: customer.displayName || customer.name || customer.title,
                date: newDateStr,
                customerCode: custId,
                price: coWorker.price || 0,
                coWorkPrice: coWorker.price || 0,
                status: '배정',
                staffId: coWorkerStaff.visibleId,
                staffName: coWorkerStaff.name,
                phone: customer.phone || '',
                address: customer.address || '',
                isCoWork: true,
                parentEventId: mainEventRef.id,
                mainStaffName: targetStaffName,
                workType: 'regular',
                createdAt: new Date().toISOString()
              });
            }
          }
        }

        console.log(`✅ 자동배치: ${customer.name} → ${newDateStr} (이전달: ${prevDate}, ${weekOfMonth}째주 ${['일','월','화','수','목','금','토'][dayOfWeek]})`);
        assignedCount++;
      }

      const specialCount = waitingList.length - regularWaiting.length;

      Swal.fire({
        title: '🚀 자동배치 완료',
        html: `
          <div style="font-size:20px; font-weight:bold; color:#059669; margin-bottom:10px;">${assignedCount}건 자동 배정</div>
          ${skippedCount > 0 ? `<div style="color:#666;">${skippedCount}건 수동 배정 필요 (이전달 기록 없음)</div>` : ''}
          ${specialCount > 0 ? `<div style="color:#8b5cf6; margin-top:5px;">${specialCount}건 특별/추가업무 (수동 배정)</div>` : ''}
          <div style="margin-top:10px; font-size:12px; color:#999;">캘린더에서 날짜를 확인/조정하세요</div>
        `,
        icon: 'success'
      });

      fetchData();
    } catch (error) {
      console.error('자동배치 오류:', error);
      Swal.fire('오류', '자동배치 실패: ' + error.message, 'error');
    }
  };

  // 출근 기록
  const handleClockIn = async () => {
    const today = toLocalDateStr(new Date()); // UTC 시차 버그 방지
    
    // 이미 오늘 출근 기록이 있는지 확인
    const attSnap = await getDocs(query(
      collection(db, 'attendance'),
      where('staffId', '==', currentUser.id),
      where('date', '==', today),
      where('type', '==', 'clockIn')
    ));
    
    if (attSnap.docs.length > 0) {
      const existingTime = new Date(attSnap.docs[0].data().time);
      Swal.fire('이미 출근됨', `오늘 출근 시간: ${existingTime.toLocaleTimeString('ko-KR')}`, 'info');
      return;
    }
    
    const result = await Swal.fire({
      title: '🏃 출근',
      text: '출근을 기록하시겠습니까?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '출근',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        const now = new Date();
        const clockInHour = now.getHours();
        const clockInMinute = now.getMinutes();
        
        // 출근 기록 저장
        await addDoc(collection(db, 'attendance'), {
          staffId: currentUser.id,
          staffName: currentUser.name,
          type: 'clockIn',
          date: today,
          time: now.toISOString(),
          hour: clockInHour,
          minute: clockInMinute
        });
        
        // 야근인정제도가 켜져 있으면 전날 야근 체크
        let overtimeMessage = '';
        if (settings.overtimeEnabled) {
          // 전날 날짜 계산
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = toLocalDateStr(yesterday); // UTC 시차 버그 방지
          
          // 전날 야근 이벤트 확인
          const eventSnap = await getDocs(collection(db, 'events'));
          const yesterdayOvertimeEvents = eventSnap.docs.filter(d => {
            const data = d.data();
            return data.staffId === currentUser.id && 
                   data.date === yesterdayStr && 
                   data.status === '야근';
          });
          
          if (yesterdayOvertimeEvents.length > 0) {
            const limitHour = settings.overtimeHour || 10;
            const limitMinute = settings.overtimeMinute || 0;
            const clockInTime = clockInHour * 60 + clockInMinute;
            const limitTime = limitHour * 60 + limitMinute;
            
            if (clockInTime > limitTime) {
              // 야근 불인정 → 본인 이벤트만 완료로 변경
              for (const eventDoc of yesterdayOvertimeEvents) {
                await updateDoc(doc(db, 'events', eventDoc.id), { status: '완료' });
              }
              overtimeMessage = `<br><span style="color:#ef4444;">⚠️ 어제(${yesterdayStr}) 야근 ${yesterdayOvertimeEvents.length}건 불인정</span>`;
            } else {
              // 야근 인정
              overtimeMessage = `<br><span style="color:#7c3aed;">✅ 어제(${yesterdayStr}) 야근 ${yesterdayOvertimeEvents.length}건 인정</span>`;
            }
          }
        }
        
        Swal.fire({
          icon: 'success',
          title: '출근 완료!',
          html: `출근 시간: ${now.toLocaleTimeString('ko-KR')}${overtimeMessage}`
        });
        fetchData();
      } catch (error) {
        Swal.fire('오류', '기록 실패', 'error');
      }
    }
  };

  // 일일마감
  // 📤 하루 완료 일정 공유
  const handleShareDay = async (dateStr) => {
    const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
    const targetStaff = staffList.find(s => s.visibleId === targetStaffId || s.id === targetStaffId);
    const staffName = targetStaff?.name || currentUser?.name || '';

    // 이미 로드된 events 상태에서 필터링 (Firestore 재조회 불필요)
    const done = events.filter(e =>
      e.start === dateStr &&
      (e.extendedProps?.status === '완료' || e.extendedProps?.status === '야근') &&
      !e.extendedProps?.isCoWork  // 공동작업 제외
    );

    if (done.length === 0) {
      Swal.fire({ toast: true, icon: 'info', title: '완료된 일정이 없어요', timer: 2000, showConfirmButton: false, position: 'top' });
      return;
    }

    const [, m, d] = dateStr.split('-');
    const total = done.reduce((sum, e) => sum + (e.extendedProps?.price || 0), 0);
    const lines = done.map((e, i) => {
      const props = e.extendedProps || {};
      const price = (props.price || 0).toLocaleString();
      const workType = props.workType || 'regular';
      const category = props.category || '';

      // 유형 접두사 결정
      let prefix = '';
      if (workType === 'special') prefix = '[특별] ';
      else if (workType === 'extra') prefix = `[${category || '추가'}] `;

      // 제목에서 이모지 제거
      const cleanTitle = e.title.replace(/^[🌟📝]\s*/, '');

      return `${i + 1}. ${prefix}${cleanTitle} ${price}원`;
    }).join('\n');

    const msg = `📋 [${staffName}] ${m}월 ${d}일 완료 보고\n\n${lines}\n\n총 ${done.length}건 | 합계 ${total.toLocaleString()}원 ✅`;

    // 미리보기 팝업 - 복사하기 + 공유하기 항상 표시
    await Swal.fire({
      title: `📋 ${m}월 ${d}일 완료 보고`,
      html: `
        <textarea id="share-msg-text" readonly
          style="width:100%;height:160px;padding:10px;font-size:13px;line-height:1.6;border:1px solid #e2e8f0;border-radius:8px;resize:none;background:#f8fafc;font-family:inherit;"
        >${msg}</textarea>
        <button type="button" id="share-copy-btn"
          style="width:100%;padding:12px;background:#10b981;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;margin-top:10px;">
          📋 복사하기
        </button>
        <button type="button" id="share-native-btn"
          style="width:100%;padding:12px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:14px;font-weight:bold;margin-top:8px;">
          📤 공유하기 (카카오톡 등)
        </button>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: '닫기',
      width: '90%',
      didOpen: () => {
        // 복사 버튼
        document.getElementById('share-copy-btn')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(msg);
            const btn = document.getElementById('share-copy-btn');
            btn.textContent = '✅ 복사됐어요!';
            btn.style.background = '#059669';
            setTimeout(() => {
              btn.textContent = '📋 복사하기';
              btn.style.background = '#10b981';
            }, 2000);
          } catch {
            // clipboard API 실패 시 textarea 선택
            const ta = document.getElementById('share-msg-text');
            ta.select();
            document.execCommand('copy');
          }
        });
        // 모바일 공유 버튼
        document.getElementById('share-native-btn')?.addEventListener('click', async () => {
          try { await navigator.share({ text: msg }); } catch (err) {
            if (err?.name !== 'AbortError') console.error('공유 오류:', err);
          }
        });
      }
    });
  };

  // 📤 날짜 선택 후 공유 (툴바 버튼용)
  const handleShareDayPicker = async () => {
    const today = toLocalDateStr(new Date());
    const { value: dateStr } = await Swal.fire({
      title: '📤 완료 일정 공유',
      html: `<input type="date" id="share-date" class="swal2-input" value="${today}">`,
      showCancelButton: true,
      confirmButtonText: '공유',
      cancelButtonText: '취소',
      confirmButtonColor: '#10b981',
      preConfirm: () => document.getElementById('share-date').value
    });
    if (dateStr) await handleShareDay(dateStr);
  };

  const handleDailyClose = async (targetDate = null) => {
    const today = toLocalDateStr(new Date()); // UTC 시차 버그 방지
    let selectedDate = targetDate || today;
    
    // 날짜 선택 팝업
    const showDatePicker = async () => {
      // 직원: 7일 이내만 / 마스터: 무제한
      const isMaster = currentUser.role === 'master';
      const minDate = isMaster ? '2020-01-01' : toLocalDateStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)); // UTC 시차 버그 방지
      
      const { value: newDate } = await Swal.fire({
        title: '📅 마감 날짜 선택',
        html: `
          <input type="date" id="close-date" value="${selectedDate}" 
            min="${minDate}" max="${today}"
            style="padding:10px;font-size:16px;border:1px solid #ddd;border-radius:8px;width:100%;">
          <p style="font-size:12px;color:#666;margin-top:10px;">
            ${isMaster ? '✅ 관리자: 모든 날짜 선택 가능' : '⚠️ 직원: 최근 7일만 선택 가능'}
          </p>
        `,
        showCancelButton: true,
        confirmButtonText: '선택',
        cancelButtonText: '취소',
        preConfirm: () => document.getElementById('close-date').value
      });
      return newDate;
    };
    
    // 이미 일일마감 되었는지 확인
    if (dailyClosedDates.includes(selectedDate)) {
      // 마감 해제
      const result = await Swal.fire({
        title: '🔓 일일마감 해제',
        text: `${selectedDate} 마감을 해제하시겠습니까?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '해제',
        cancelButtonText: '취소',
        confirmButtonColor: '#f59e0b'
      });
      
      if (result.isConfirmed) {
        try {
          // 현재 보고 있는 직원 ID로 삭제
          const viewingStaffId = (currentViewMode === 'self' || currentViewMode === 'admin') 
            ? currentUser.id 
            : currentViewMode;
          const closeSnap = await getDocs(query(
            collection(db, 'dailyClose'),
            where('staffId', '==', viewingStaffId),
            where('date', '==', selectedDate)
          ));
          for (const docSnap of closeSnap.docs) {
            await deleteDoc(doc(db, 'dailyClose', docSnap.id));
          }
          Swal.fire('해제 완료', '일일마감이 해제되었습니다', 'success');
          fetchData();
        } catch (error) {
          Swal.fire('오류', '해제 실패', 'error');
        }
      }
      return;
    }
    
    // 해당 날짜 작업 확인
    const dateEvents = events.filter(e => e.start === selectedDate);
    
    // 작업 없음 - 날짜변경 옵션 제공
    if (dateEvents.length === 0) {
      const result = await Swal.fire({
        title: '작업 없음',
        html: `
          <p>${selectedDate}에 배정된 작업이 없습니다.</p>
          <p style="margin-top:10px;font-size:12px;color:#666;">다른 날짜를 마감하시겠습니까?</p>
        `,
        icon: 'info',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '📅 날짜변경',
        denyButtonText: '취소',
        cancelButtonText: '닫기',
        confirmButtonColor: '#3b82f6'
      });
      
      if (result.isConfirmed) {
        const newDate = await showDatePicker();
        if (newDate) {
          handleDailyClose(newDate);
        }
      }
      return;
    }
    
    // 미완료 작업 확인 (미작업도 처리 완료로 인정)
    const incompleteEvents = dateEvents.filter(e => 
      !['완료', '야근', '미작업'].includes(e.extendedProps.status)
    );
    
    if (incompleteEvents.length > 0) {
      const listHtml = incompleteEvents.map(e => `• ${e.title}`).join('<br>');
      Swal.fire({
        title: '❌ 일일마감 불가',
        html: `<div style="text-align:left;max-height:200px;overflow:auto;">${listHtml}</div><br><b>모든 작업 완료 후 마감하세요</b>`,
        icon: 'warning'
      });
      return;
    }
    
    // 야근 작업 확인
    const overtimeEvents = dateEvents.filter(e => e.extendedProps.status === '야근');
    const noWorkEvents = dateEvents.filter(e => e.extendedProps.status === '미작업');
    
    // 마감 확인 (날짜변경 버튼 포함)
    const confirmHtml = `
      <div style="text-align:left;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span style="font-size:16px;font-weight:bold;">📅 ${selectedDate}</span>
          <button type="button" id="change-date-btn" style="padding:6px 12px;background:#64748b;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;">날짜변경</button>
        </div>
        <p>✅ 완료: ${dateEvents.filter(e => e.extendedProps.status === '완료').length}건</p>
        <p>🌙 야근: ${overtimeEvents.length}건</p>
        ${noWorkEvents.length > 0 ? `<p>⛔ 미작업: ${noWorkEvents.length}건</p>` : ''}
        ${overtimeEvents.length > 0 && settings.overtimeEnabled ? `<p style="color:#7c3aed;margin-top:10px;font-size:12px;">※ 야근은 내일 출근 시간에 따라 인정됩니다</p>` : ''}
        ${selectedDate === today ? '<p style="color:#666;margin-top:10px;font-size:12px;">※ 일일마감 시 자동 퇴근 처리됩니다</p>' : '<p style="color:#f59e0b;margin-top:10px;font-size:12px;">※ 지난 날짜 마감 (퇴근 기록 없음)</p>'}
      </div>
    `;
    
    const result = await Swal.fire({
      title: '📋 일일마감',
      html: confirmHtml,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '마감',
      cancelButtonText: '취소',
      confirmButtonColor: '#059669',
      didOpen: () => {
        document.getElementById('change-date-btn')?.addEventListener('click', async () => {
          Swal.close();
          const newDate = await showDatePicker();
          if (newDate) {
            handleDailyClose(newDate);
          }
        });
      }
    });
    
    if (!result.isConfirmed) return;
    
    try {
      Swal.fire({ title: '처리중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      
      const now = new Date();
      
      // 퇴근 기록 (오늘만)
      if (selectedDate === today) {
        await addDoc(collection(db, 'attendance'), {
          staffId: currentUser.id,
          staffName: currentUser.name,
          type: 'clockOut',
          date: selectedDate,
          time: now.toISOString(),
          hour: now.getHours(),
          minute: now.getMinutes()
        });
      }
      
      // 현재 보고 있는 직원 정보
      const viewingStaffId = (currentViewMode === 'self' || currentViewMode === 'admin') 
        ? currentUser.id 
        : currentViewMode;
      const viewingStaff = staffList.find(s => s.visibleId === viewingStaffId || s.id === viewingStaffId);
      const viewingStaffName = viewingStaff?.name || currentUser.name;
      
      // 일일마감 기록
      await addDoc(collection(db, 'dailyClose'), {
        staffId: viewingStaffId,
        staffName: viewingStaffName,
        date: selectedDate,
        closedAt: now.toISOString(),
        totalEvents: dateEvents.length,
        overtimeCount: overtimeEvents.length,
        noWorkCount: noWorkEvents.length // 미작업 건수도 기록
      });
      
      Swal.fire({
        icon: 'success',
        title: '일일마감 완료',
        html: selectedDate === today ? `퇴근 시간: ${now.toLocaleTimeString('ko-KR')}` : `${selectedDate} 마감 완료`,
        timer: 2000,
        showConfirmButton: false
      });
      fetchData();
      
    } catch (error) {
      console.error('일일마감 오류:', error);
      Swal.fire('오류', '마감 실패', 'error');
    }
  };

  // 대기목록 불러오기 (배정된 고객 검색해서 대기목록으로 복귀)
  const handleLoadFromEvents = async () => {
    // 현재 월의 배정된 이벤트 가져오기
    const targetStaffId = currentViewMode === 'self' ? currentUser.id : (currentViewMode !== 'admin' ? currentViewMode : null);
    
    let assignedEvents = events.filter(e => {
      if (!e.start?.startsWith(currentMonthStr)) return false;
      if (targetStaffId && e.extendedProps?.staffId !== targetStaffId) return false;
      return true;
    });

    if (assignedEvents.length === 0) {
      Swal.fire('알림', '이번 달 배정된 일정이 없습니다', 'info');
      return;
    }

    // 이벤트 데이터 복사 (클로저 문제 방지)
    const eventsData = assignedEvents.map(e => ({
      id: e.id,
      title: e.title,
      start: e.start,
      status: e.extendedProps?.status,
      price: e.extendedProps?.price || 0,
      workType: e.extendedProps?.workType,
      extraWorkId: e.extendedProps?.extraWorkId
    }));

    const { value: result } = await Swal.fire({
      title: '🔍 대기목록으로 불러오기',
      html: `
        <div style="text-align:left;">
          <input type="text" id="search-customer" placeholder="고객명 검색..." 
            style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:10px;">
          <div style="margin-bottom:10px;display:flex;gap:8px;">
            <button type="button" id="select-all-btn" style="flex:1;padding:8px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;">전체선택</button>
            <button type="button" id="deselect-all-btn" style="flex:1;padding:8px;background:#6b7280;color:white;border:none;border-radius:6px;font-size:12px;">전체해제</button>
          </div>
          <div id="search-results" style="max-height:280px;overflow-y:auto;">
            ${eventsData.map(e => {
              const isCompleted = e.status === '완료';
              const statusIcon = isCompleted ? '✅' : '📋';
              const statusColor = isCompleted ? '#dcfce7' : '#dbeafe';
              const borderColor = isCompleted ? '#22c55e' : '#3b82f6';
              const dateStr = e.start?.substring(5).replace('-', '/');
              return `
                <label class="search-result-item" data-event-id="${e.id}" data-status="${e.status || ''}" data-date="${e.start}"
                  style="display:flex;align-items:center;padding:12px;margin:4px 0;background:${statusColor};border-radius:8px;cursor:pointer;border-left:4px solid ${borderColor};">
                  <input type="checkbox" class="load-check" value="${e.id}" ${isCompleted ? 'disabled' : ''} style="width:20px;height:20px;margin-right:10px;">
                  <span style="font-size:16px;margin-right:8px;">${statusIcon}</span>
                  <div style="flex:1;">
                    <div style="font-weight:bold;font-size:14px;">${e.title}</div>
                    <div style="font-size:11px;color:#666;">${dateStr} | ${e.price.toLocaleString()}원</div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
          <div style="margin-top:10px;padding:8px;background:#f1f5f9;border-radius:6px;font-size:12px;">
            선택: <span id="selected-count">0</span>건 | ✅ 완료된 일정은 선택 불가
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '불러오기',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      width: '95%',
      didOpen: () => {
        const searchInput = document.getElementById('search-customer');
        const allItems = document.querySelectorAll('.search-result-item');
        const allChecks = document.querySelectorAll('.load-check:not(:disabled)');
        
        const updateCount = () => {
          const count = document.querySelectorAll('.load-check:checked').length;
          document.getElementById('selected-count').textContent = count;
        };
        
        // 검색 필터링
        searchInput.addEventListener('input', (e) => {
          const term = e.target.value.toLowerCase();
          allItems.forEach(item => {
            const title = item.querySelector('div div').textContent.toLowerCase();
            item.style.display = title.includes(term) ? 'flex' : 'none';
          });
        });
        
        // 전체선택/해제
        document.getElementById('select-all-btn').onclick = () => {
          allChecks.forEach(cb => cb.checked = true);
          updateCount();
        };
        document.getElementById('deselect-all-btn').onclick = () => {
          allChecks.forEach(cb => cb.checked = false);
          updateCount();
        };
        
        // 체크박스 변경
        allChecks.forEach(cb => cb.addEventListener('change', updateCount));
        
        searchInput.focus();
      },
      preConfirm: () => {
        const checked = document.querySelectorAll('.load-check:checked');
        if (checked.length === 0) {
          Swal.showValidationMessage('최소 1건을 선택하세요');
          return false;
        }
        return Array.from(checked).map(cb => cb.value);
      }
    });

    if (result && result.length > 0) {
      try {
        let successCount = 0;
        
        for (const eventId of result) {
          const eventData = eventsData.find(e => e.id === eventId);
          if (!eventData) continue;
          
          // events에서 삭제
          await deleteDoc(doc(db, 'events', eventId));
          
          // 공동작업 이벤트도 삭제
          const coWorkEvents = events.filter(e => e.extendedProps?.parentEventId === eventId);
          for (const coEvent of coWorkEvents) {
            await deleteDoc(doc(db, 'events', coEvent.id));
          }
          
          // 추가업무인 경우 extraWork 상태 업데이트
          if (eventData.workType === 'extra' && eventData.extraWorkId) {
            await updateDoc(doc(db, 'extraWork', eventData.extraWorkId), {
              status: '대기',
              assignedDate: null,
              eventId: null
            });
          }
          
          successCount++;
        }
        
        Swal.fire({
          toast: true,
          position: 'top',
          icon: 'success',
          title: `${successCount}건 대기목록으로 이동`,
          timer: 1500,
          showConfirmButton: false
        });
        
        fetchData();
      } catch (error) {
        console.error('불러오기 오류:', error);
        Swal.fire('오류', '불러오기 실패', 'error');
      }
    }
  };

  // 날짜 팝업에서 불러오기 (다른 날짜에서 이 날짜로 이동)
  const handleLoadToDate = async (targetDate) => {
    // 현재 월의 배정된 이벤트 (선택한 날짜 제외)
    const targetStaffId = currentViewMode === 'self' ? currentUser.id : (currentViewMode !== 'admin' ? currentViewMode : null);
    
    let assignedEvents = events.filter(e => {
      if (!e.start?.startsWith(currentMonthStr)) return false;
      if (e.start === targetDate) return false; // 선택한 날짜 제외
      if (targetStaffId && e.extendedProps?.staffId !== targetStaffId) return false;
      return true;
    });

    if (assignedEvents.length === 0) {
      Swal.fire('알림', '불러올 수 있는 일정이 없습니다', 'info');
      return;
    }

    // 이벤트 데이터 복사
    const eventsData = assignedEvents.map(e => ({
      id: e.id,
      title: e.title,
      start: e.start,
      status: e.extendedProps?.status,
      price: e.extendedProps?.price || 0
    }));

    const { value: result } = await Swal.fire({
      title: `🔍 ${targetDate}로 불러오기`,
      html: `
        <div style="text-align:left;">
          <input type="text" id="search-load" placeholder="고객명 검색..." 
            style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:10px;">
          <div style="margin-bottom:10px;display:flex;gap:8px;">
            <button type="button" id="load-select-all" style="flex:1;padding:8px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;">전체선택</button>
            <button type="button" id="load-deselect-all" style="flex:1;padding:8px;background:#6b7280;color:white;border:none;border-radius:6px;font-size:12px;">전체해제</button>
          </div>
          <div id="load-results" style="max-height:280px;overflow-y:auto;">
            ${eventsData.map((e, idx) => {
              const isCompleted = e.status === '완료';
              const statusIcon = isCompleted ? '✅' : '📋';
              const dateStr = e.start?.substring(8, 10) + '일';
              return `
                <label id="load-item-${idx}" class="load-item" data-event-id="${e.id}" data-status="${e.status || ''}" data-date="${e.start}" data-idx="${idx}"
                  style="display:flex;align-items:center;padding:12px;margin:4px 0;background:#f8fafc;border-radius:8px;cursor:pointer;border:2px solid #e2e8f0;transition:all 0.2s;">
                  <input type="checkbox" class="load-to-date-check" value="${e.id}" data-completed="${isCompleted}" data-idx="${idx}"
                    style="width:24px;height:24px;min-width:24px;margin-right:12px;accent-color:#3b82f6;cursor:pointer;">
                  <span style="font-size:16px;margin-right:8px;">${statusIcon}</span>
                  <div style="flex:1;">
                    <div style="font-weight:bold;font-size:14px;">${e.title}</div>
                    <div style="font-size:11px;color:#666;">${dateStr} | ${e.price.toLocaleString()}원</div>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
          <div style="margin-top:10px;padding:10px;background:#f1f5f9;border-radius:6px;font-size:13px;font-weight:bold;">
            선택: <span id="load-selected-count" style="color:#3b82f6;">0</span>건 / 전체: ${eventsData.length}건 | ✅ 완료된 일정은 이동 불가 (알림 표시)
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '불러오기',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      width: '95%',
      didOpen: () => {
        const searchInput = document.getElementById('search-load');
        const allItems = document.querySelectorAll('.load-item');
        const allChecks = document.querySelectorAll('.load-to-date-check');
        
        // 아이템 스타일 업데이트 함수
        const updateItemStyle = (checkbox) => {
          const idx = checkbox.dataset.idx;
          const label = document.getElementById('load-item-' + idx);
          if (label) {
            if (checkbox.checked) {
              label.style.background = '#dbeafe';
              label.style.borderColor = '#3b82f6';
            } else {
              label.style.background = '#f8fafc';
              label.style.borderColor = '#e2e8f0';
            }
          }
        };
        
        const updateCount = () => {
          const count = document.querySelectorAll('.load-to-date-check:checked').length;
          document.getElementById('load-selected-count').textContent = count;
        };
        
        // 체크박스 변경 시 스타일 + 카운트 업데이트
        allChecks.forEach(cb => {
          cb.addEventListener('change', () => {
            updateItemStyle(cb);
            updateCount();
          });
        });
        
        // 검색 필터링
        searchInput.addEventListener('input', (e) => {
          const term = e.target.value.toLowerCase();
          allItems.forEach(item => {
            const title = item.querySelector('div div').textContent.toLowerCase();
            item.style.display = title.includes(term) ? 'flex' : 'none';
          });
        });
        
        // 전체선택/해제
        document.getElementById('load-select-all').onclick = () => {
          allChecks.forEach(cb => {
            cb.checked = true;
            updateItemStyle(cb);
          });
          updateCount();
        };
        document.getElementById('load-deselect-all').onclick = () => {
          allChecks.forEach(cb => {
            cb.checked = false;
            updateItemStyle(cb);
          });
          updateCount();
        };
        
        // 체크박스 변경
        allChecks.forEach(cb => cb.addEventListener('change', updateCount));
        
        searchInput.focus();
      },
      preConfirm: () => {
        const checked = document.querySelectorAll('.load-to-date-check:checked');
        if (checked.length === 0) {
          Swal.showValidationMessage('최소 1건을 선택하세요');
          return false;
        }
        return Array.from(checked).map(cb => ({
          id: cb.value,
          isCompleted: cb.dataset.completed === 'true'
        }));
      }
    });

    if (result && result.length > 0) {
      try {
        let successCount = 0;
        let completedList = [];
        
        for (const item of result) {
          const eventData = eventsData.find(e => e.id === item.id);
          if (!eventData) continue;
          
          // 완료된 경우 - 알림용 리스트에 추가
          if (item.isCompleted || eventData.status === '완료') {
            const day = eventData.start?.substring(8, 10);
            completedList.push(`${eventData.title} (${day}일 완료)`);
            continue;
          }
          
          // 날짜 변경
          await updateDoc(doc(db, 'events', item.id), { date: targetDate });
          
          // 공동작업 이벤트도 날짜 변경
          const coWorkEvents = events.filter(e => e.extendedProps?.parentEventId === item.id);
          for (const coEvent of coWorkEvents) {
            await updateDoc(doc(db, 'events', coEvent.id), { date: targetDate });
          }
          
          successCount++;
        }
        
        // 결과 알림
        if (completedList.length > 0) {
          await Swal.fire({
            icon: 'warning',
            title: '일부 이동 불가',
            html: `
              <div style="text-align:left;max-height:200px;overflow-y:auto;">
                <div style="color:#22c55e;margin-bottom:10px;"><b>✅ ${successCount}건 이동 완료</b></div>
                <div style="color:#dc2626;"><b>❌ 완료되어 이동 불가:</b></div>
                ${completedList.map(c => `<div style="padding:4px 0;font-size:13px;">• ${c}</div>`).join('')}
              </div>
            `
          });
        } else {
          Swal.fire({
            toast: true,
            position: 'top',
            icon: 'success',
            title: `${successCount}건 ${targetDate}로 이동`,
            timer: 1500,
            showConfirmButton: false
          });
        }
        
        fetchData();
      } catch (error) {
        console.error('불러오기 오류:', error);
        Swal.fire('오류', '불러오기 실패', 'error');
      }
    }
  };

  // 추가업무 등록
  const handleAddExtraWork = async () => {
    const { value: formData } = await Swal.fire({
      title: '📝 추가업무 등록',
      html: `
        <div style="text-align:left;">
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">고객/업체명</label>
            <input type="text" id="extra-title" placeholder="예: 홍길동, ABC회사" 
              style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">업무 항목</label>
            <select id="extra-category" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;" onchange="
              const priceDiv = document.getElementById('extra-price-div');
              if(this.value === '수금') {
                priceDiv.style.display = 'none';
                document.getElementById('extra-price').value = 0;
              } else {
                priceDiv.style.display = 'block';
              }
            ">
              <option value="상담">📞 상담</option>
              <option value="영업">💼 영업</option>
              <option value="수금">💰 수금</option>
              <option value="클레임">⚠️ 클레임</option>
              <option value="기타">📋 기타</option>
            </select>
          </div>
          <div id="extra-price-div" style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">금액 (원)</label>
            <input type="number" id="extra-price" placeholder="0" value="0"
              style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <p style="font-size:11px;color:#f97316;margin-top:10px;">
            ※ 수금은 금액이 합산되지 않습니다 (이중계산 방지)
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      confirmButtonColor: '#f97316',
      preConfirm: () => {
        const title = document.getElementById('extra-title').value.trim();
        const category = document.getElementById('extra-category').value;
        const price = category === '수금' ? 0 : (Number(document.getElementById('extra-price').value) || 0);
        if (!title) {
          Swal.showValidationMessage('고객/업체명을 입력하세요');
          return false;
        }
        return { title, category, price };
      }
    });

    if (!formData) return;

    try {
      // 현재 보고 있는 직원 정보
      let targetStaffId = currentUser.id;
      let targetStaffName = currentUser.name;
      
      if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
        const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
        if (viewingStaff) {
          targetStaffId = viewingStaff.visibleId;
          targetStaffName = viewingStaff.name;
        }
      }

      await addDoc(collection(db, 'extraWork'), {
        title: formData.title,
        category: formData.category,
        price: formData.price,
        staffId: targetStaffId,
        staffName: targetStaffName,
        month: currentMonthStr,
        status: '대기',
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name
      });

      Swal.fire({
        icon: 'success',
        title: '등록 완료',
        html: `📝 ${formData.title} (${formData.category})${formData.price > 0 ? ` - ${formData.price.toLocaleString()}원` : ''}<br>대기목록에 추가되었습니다.`,
        timer: 2000,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('추가업무 등록 오류:', error);
      Swal.fire('오류', '등록 실패', 'error');
    }
  };

  // ========== 폴더 기능 ==========
  
  // 폴더 만들기
  const handleCreateFolder = async () => {
    if (monthClosed) {
      Swal.fire('알림', '🔒 월마감 완료 - 폴더 생성 불가', 'warning');
      return;
    }

    // 현재 담당자 정보 (폴더 생성자)
    let mainStaffId = currentUser.id;
    let mainStaffName = currentUser.name;
    if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
      const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
      if (viewingStaff) {
        mainStaffId = viewingStaff.visibleId;
        mainStaffName = viewingStaff.name;
      }
    }

    // 공동작업자 옵션 (담당자 제외)
    const coworkerOptions = staffList
      .filter(s => s.name !== mainStaffName)
      .map(s => `<option value="${s.name}">${s.name}</option>`)
      .join('');

    // 대기목록에서 폴더 생성 가능한 고객들
    const availableCustomers = waitingList.filter(c => !c.isSpecial && !c.isExtraWork);
    
    if (availableCustomers.length < 2) {
      Swal.fire('알림', '폴더를 만들려면 대기목록에 2명 이상의 고객이 필요합니다', 'info');
      return;
    }

    // 공유 변수 (didOpen과 preConfirm 양쪽에서 접근)
    let coworkers = [];
    let workCount = 1;
    let workPrices = [0];

    const { value: formData } = await Swal.fire({
      title: '📁 폴더 만들기',
      html: `
        <div style="text-align:left;max-height:70vh;overflow-y:auto;">
          <div style="background:#e0f2fe;padding:10px;border-radius:8px;margin-bottom:12px;">
            <div style="font-size:12px;color:#0369a1;">👤 담당자: <b>${mainStaffName}</b></div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">폴더명 *</label>
            <input type="text" id="folder-name" placeholder="예: 강남 빌딩군" 
              style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">고객 선택</label>
            <input type="text" id="folder-search" placeholder="검색..." 
              style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;margin-bottom:8px;">
            <div id="folder-customer-list" style="max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px;">
              ${availableCustomers.map(c => `
                <label style="display:flex;align-items:center;padding:8px;border-radius:6px;cursor:pointer;margin-bottom:4px;background:#f8fafc;" 
                  class="folder-customer-item" data-name="${c.name}" data-price="${c.price || 0}" data-staff="${c.staffName || ''}">
                  <input type="checkbox" class="folder-customer-check" value="${c.originalId || c.id}" 
                    data-price="${c.price || 0}" data-staff="${c.staffName || ''}" data-name="${c.name}"
                    style="width:18px;height:18px;margin-right:10px;">
                  <div style="flex:1;">
                    <div style="font-weight:bold;font-size:13px;">${c.displayName || c.name}</div>
                    <div style="font-size:11px;color:#666;">${c.staffName || '-'} | ${(c.price || 0).toLocaleString()}원</div>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>
          
          <div style="background:#f0f9ff;padding:12px;border-radius:8px;margin-bottom:12px;">
            <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">📊 선택 합계</div>
            <div id="folder-summary">
              <div>선택: <span id="folder-count">0</span>명</div>
              <div>총금액: <span id="folder-total">0</span>원</div>
            </div>
          </div>
          
          <div style="background:#f0fdf4;padding:12px;border-radius:8px;margin-bottom:12px;">
            <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">🔢 작업횟수</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <label style="font-size:12px;color:#666;">횟수:</label>
              <button type="button" id="work-count-minus" style="width:32px;height:32px;background:#e2e8f0;border:none;border-radius:6px;font-size:16px;cursor:pointer;">−</button>
              <span id="work-count-display" style="font-size:18px;font-weight:bold;min-width:30px;text-align:center;">1</span>
              <button type="button" id="work-count-plus" style="width:32px;height:32px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:16px;cursor:pointer;">+</button>
              <span style="font-size:11px;color:#666;margin-left:4px;">회</span>
            </div>
            <div id="work-prices-container"></div>
            <div id="work-price-remaining" style="font-size:12px;color:#059669;margin-top:6px;"></div>
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">👥 공동작업자 (선택)</label>
            <div id="coworker-list"></div>
            <button type="button" id="add-coworker-btn" style="padding:8px 12px;background:#8b5cf6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;margin-top:8px;">
              + 공동작업자 추가
            </button>
          </div>
          
          <div style="background:#fef3c7;padding:12px;border-radius:8px;">
            <div style="font-size:13px;font-weight:bold;margin-bottom:4px;">💰 금액 배분</div>
            <div style="font-size:12px;">
              <div>공동작업자 합계: <span id="coworker-total">0</span>원</div>
              <div>담당자 배분: <span id="main-share">0</span>원</div>
            </div>
          </div>
          <div id="coworker-options-data" style="display:none;">${coworkerOptions}</div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '생성',
      cancelButtonText: '취소',
      confirmButtonColor: '#8b5cf6',
      width: '95%',
      didOpen: () => {
        const searchInput = document.getElementById('folder-search');
        const customerItems = document.querySelectorAll('.folder-customer-item');
        const customerChecks = document.querySelectorAll('.folder-customer-check');
        const coworkerList = document.getElementById('coworker-list');
        const addCoworkerBtn = document.getElementById('add-coworker-btn');
        const staffOptions = document.getElementById('coworker-options-data').innerHTML;
        
        // 작업횟수 UI 렌더링
        const renderWorkPrices = () => {
          const container = document.getElementById('work-prices-container');
          const totalStr = document.getElementById('folder-total').textContent;
          const totalPrice = parseInt(totalStr.replace(/,/g, '')) || 0;
          
          if (workCount <= 1) {
            container.innerHTML = '<div style="font-size:12px;color:#666;">1회 = 총금액 전체</div>';
            workPrices = [0];
            document.getElementById('work-price-remaining').textContent = '';
            return;
          }
          
          // 기존 입력값 보존
          while (workPrices.length < workCount) workPrices.push(0);
          workPrices = workPrices.slice(0, workCount);
          
          let html = '';
          for (let i = 0; i < workCount; i++) {
            html += `
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                <span style="font-size:12px;color:#666;min-width:50px;">${i + 1}회차:</span>
                <input type="number" class="work-price-input" data-idx="${i}" 
                  value="${workPrices[i] || ''}" placeholder="0"
                  style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                <span style="font-size:12px;color:#666;">원</span>
              </div>
            `;
          }
          container.innerHTML = html;
          
          // 이벤트 바인딩
          container.querySelectorAll('.work-price-input').forEach(input => {
            input.addEventListener('input', (e) => {
              const idx = parseInt(e.target.dataset.idx);
              const val = parseInt(e.target.value) || 0;
              
              // 다른 회차 합계 계산
              let otherSum = 0;
              workPrices.forEach((p, i) => { if (i !== idx) otherSum += p; });
              
              // 총금액 초과 방지
              const maxAllowed = Math.max(0, totalPrice - otherSum);
              if (val > maxAllowed) {
                e.target.value = maxAllowed;
                workPrices[idx] = maxAllowed;
              } else {
                workPrices[idx] = val;
              }
              
              updateWorkRemaining();
            });
          });
          
          updateWorkRemaining();
        };
        
        // 잔여금액 표시
        const updateWorkRemaining = () => {
          const totalStr = document.getElementById('folder-total').textContent;
          const totalPrice = parseInt(totalStr.replace(/,/g, '')) || 0;
          const usedSum = workPrices.reduce((s, p) => s + p, 0);
          const remaining = totalPrice - usedSum;
          
          const el = document.getElementById('work-price-remaining');
          if (workCount > 1) {
            if (usedSum === 0) {
              el.innerHTML = `<span style="color:#666;">미입력 시 균등배분: 각 ${Math.round(totalPrice / workCount).toLocaleString()}원</span>`;
            } else if (remaining > 0) {
              el.innerHTML = `<span style="color:#f59e0b;">잔여: ${remaining.toLocaleString()}원 (미배분)</span>`;
            } else {
              el.innerHTML = `<span style="color:#059669;">✅ 전액 배분 완료</span>`;
            }
          }
        };
        
        // 합계 업데이트
        const updateSummary = () => {
          const checked = document.querySelectorAll('.folder-customer-check:checked');
          let total = 0;
          checked.forEach(cb => { total += parseInt(cb.dataset.price) || 0; });
          
          document.getElementById('folder-count').textContent = checked.length;
          document.getElementById('folder-total').textContent = total.toLocaleString();
          
          // 공동작업자 금액 합계
          let coworkerTotal = 0;
          coworkers.forEach(cw => { coworkerTotal += cw.price; });
          document.getElementById('coworker-total').textContent = coworkerTotal.toLocaleString();
          document.getElementById('main-share').textContent = Math.max(0, total - coworkerTotal).toLocaleString();
          
          // 총금액 바뀌면 작업횟수 금액도 갱신
          renderWorkPrices();
        };
        
        // 검색 필터
        searchInput.addEventListener('input', (e) => {
          const term = e.target.value.toLowerCase();
          customerItems.forEach(item => {
            const name = item.dataset.name.toLowerCase();
            item.style.display = name.includes(term) ? 'flex' : 'none';
          });
        });
        
        // 체크박스 변경
        customerChecks.forEach(cb => cb.addEventListener('change', updateSummary));
        
        // 작업횟수 +/- 버튼
        document.getElementById('work-count-plus').addEventListener('click', () => {
          if (workCount < 10) {
            workCount++;
            document.getElementById('work-count-display').textContent = workCount;
            renderWorkPrices();
          }
        });
        document.getElementById('work-count-minus').addEventListener('click', () => {
          if (workCount > 1) {
            workCount--;
            document.getElementById('work-count-display').textContent = workCount;
            renderWorkPrices();
          }
        });
        
        // 초기 렌더링
        renderWorkPrices();
        
        // 공동작업자 추가
        addCoworkerBtn.onclick = () => {
          const idx = coworkers.length;
          const div = document.createElement('div');
          div.className = 'coworker-item';
          div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:8px;background:#f8fafc;border-radius:6px;';
          div.innerHTML = `
            <select class="coworker-name" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;">
              <option value="">직원선택</option>
              ${staffOptions}
            </select>
            <input type="number" class="coworker-price" placeholder="금액" value="0" style="width:80px;padding:8px;border:1px solid #ddd;border-radius:6px;">
            <button type="button" class="coworker-remove" style="padding:6px 10px;background:#ef4444;color:white;border:none;border-radius:6px;">✕</button>
          `;
          coworkerList.appendChild(div);
          
          // 금액 변경 시 업데이트
          div.querySelector('.coworker-price').addEventListener('input', (e) => {
            coworkers[idx] = { name: div.querySelector('.coworker-name').value, price: parseInt(e.target.value) || 0 };
            updateSummary();
          });
          div.querySelector('.coworker-name').addEventListener('change', (e) => {
            coworkers[idx] = { ...coworkers[idx], name: e.target.value };
          });
          div.querySelector('.coworker-remove').onclick = () => {
            coworkers.splice(idx, 1);
            div.remove();
            // 인덱스 재정렬
            document.querySelectorAll('.coworker-item').forEach((item, i) => {
              const priceInput = item.querySelector('.coworker-price');
              const nameSelect = item.querySelector('.coworker-name');
              priceInput.addEventListener('input', (e) => {
                coworkers[i] = { name: nameSelect.value, price: parseInt(e.target.value) || 0 };
                updateSummary();
              });
            });
            updateSummary();
          };
          
          coworkers.push({ name: '', price: 0 });
        };
        
        updateSummary();
      },
      preConfirm: () => {
        const name = document.getElementById('folder-name').value.trim();
        if (!name) {
          Swal.showValidationMessage('폴더명을 입력하세요');
          return false;
        }
        
        const checked = document.querySelectorAll('.folder-customer-check:checked');
        if (checked.length < 2) {
          Swal.showValidationMessage('2명 이상의 고객을 선택하세요');
          return false;
        }
        
        const customerIds = Array.from(checked).map(cb => cb.value);
        const customerNames = Array.from(checked).map(cb => cb.dataset.name);
        let totalPrice = 0;
        checked.forEach(cb => { totalPrice += parseInt(cb.dataset.price) || 0; });
        
        // 공동작업자 정보
        const coWorkers = [];
        document.querySelectorAll('.coworker-item').forEach(item => {
          const name = item.querySelector('.coworker-name').value;
          const price = parseInt(item.querySelector('.coworker-price').value) || 0;
          if (name && price > 0) {
            coWorkers.push({ staffName: name, price });
          }
        });
        
        const coWorkerTotal = coWorkers.reduce((sum, cw) => sum + cw.price, 0);
        
        // 작업횟수별 금액 계산
        let finalWorkPrices = [...workPrices].slice(0, workCount);
        const priceSum = finalWorkPrices.reduce((s, p) => s + p, 0);
        
        if (workCount > 1 && priceSum === 0) {
          // 미입력 시 균등배분
          const each = Math.floor(totalPrice / workCount);
          const remainder = totalPrice - (each * workCount);
          finalWorkPrices = Array(workCount).fill(each);
          finalWorkPrices[0] += remainder; // 나머지는 1회차에
        } else if (workCount > 1 && priceSum < totalPrice) {
          // 부분 입력 시 잔여를 마지막 회차에 추가
          finalWorkPrices[workCount - 1] += (totalPrice - priceSum);
        }
        
        return { name, customerIds, customerNames, totalPrice, coWorkers, mainPrice: totalPrice - coWorkerTotal, workCount, workPrices: finalWorkPrices };
      }
    });

    if (!formData) return;

    try {
      await addDoc(collection(db, 'folders'), {
        name: formData.name,
        customerIds: formData.customerIds,
        customerNames: formData.customerNames,
        totalPrice: formData.totalPrice,
        coWorkers: formData.coWorkers,
        mainPrice: formData.mainPrice,
        workCount: formData.workCount,
        workPrices: formData.workPrices,
        assignedCount: 0,
        staffId: mainStaffId,
        staffName: mainStaffName,
        month: currentMonthStr,
        status: 'active',
        createdAt: new Date().toISOString()
      });

      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: `📁 ${formData.name} 폴더 생성됨`,
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('폴더 생성 오류:', error);
      Swal.fire('오류', '폴더 생성 실패', 'error');
    }
  };

  // 폴더 클릭 (상세/해체/배정/삭제)
  const handleFolderCardClick = async (folder, roundIndex = 0) => {
    const wc = folder.workCount || 1;
    const ac = folder.assignedCount || 0;
    const wp = folder.workPrices || [];
    const roundPrice = (wp[roundIndex] !== undefined && wp[roundIndex] !== null) ? wp[roundIndex] : Math.round((folder.totalPrice || 0) / wc);
    const roundLabel = wc > 1 ? ` (${roundIndex + 1}/${wc}회차)` : '';
    
    const customerList = (folder.customerNames || []).map((name, idx) => `
      <div style="padding:8px;background:#f8fafc;border-radius:6px;margin-bottom:4px;display:flex;justify-content:space-between;">
        <span>${name}</span>
        <span style="color:#666;">${((folder.customerPrices || [])[idx] || 0).toLocaleString()}원</span>
      </div>
    `).join('');
    
    const coWorkerList = (folder.coWorkers || []).map(cw => `
      <div style="padding:6px;background:#ede9fe;border-radius:4px;margin-bottom:4px;">
        👥 ${cw.staffName}: ${cw.price.toLocaleString()}원
      </div>
    `).join('');

    // eslint-disable-next-line no-unused-vars
    const { value: action, dismiss } = await Swal.fire({
      title: `📁 ${folder.name}${roundLabel}`,
      html: `
        <div style="text-align:left;">
          ${wc > 1 ? `
            <div style="background:#dbeafe;padding:10px;border-radius:8px;margin-bottom:12px;">
              <div style="font-size:13px;">🔢 작업횟수: <b>${ac}/${wc}회</b> 배정됨</div>
              <div style="font-size:12px;color:#2563eb;margin-top:4px;">이번 회차 금액: <b>${roundPrice.toLocaleString()}원</b></div>
            </div>
          ` : ''}
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;color:#666;margin-bottom:4px;">포함 고객 (${folder.customerIds?.length || 0}명)</div>
            <div style="max-height:150px;overflow-y:auto;">${customerList || '없음'}</div>
          </div>
          
          <div style="background:#fef3c7;padding:12px;border-radius:8px;margin-bottom:12px;">
            <div style="font-weight:bold;margin-bottom:8px;">💰 금액 정보</div>
            <div>총금액: ${(folder.totalPrice || 0).toLocaleString()}원</div>
            ${wc > 1 ? `<div style="margin-top:4px;font-size:12px;color:#666;">회차별: ${wp.map((p, i) => `${i+1}회:${p.toLocaleString()}`).join(' / ')}</div>` : ''}
            ${coWorkerList ? `<div style="margin-top:8px;">${coWorkerList}</div>` : ''}
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #fcd34d;">
              담당자: ${(folder.mainPrice || 0).toLocaleString()}원
            </div>
          </div>
          
          <button id="delete-folder-btn" style="width:100%;padding:12px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-top:10px;">
            🗑️ 폴더 삭제
          </button>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '🔓 해체',
      denyButtonText: '📅 배정',
      cancelButtonText: '닫기',
      confirmButtonColor: '#ef4444',
      denyButtonColor: '#3b82f6',
      didOpen: () => {
        document.getElementById('delete-folder-btn').onclick = async () => {
          Swal.close();
          const confirmDelete = await Swal.fire({
            title: '폴더 삭제',
            text: `"${folder.name}" 폴더를 삭제하시겠습니까?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소',
            confirmButtonColor: '#dc2626'
          });
          
          if (confirmDelete.isConfirmed) {
            try {
              await deleteDoc(doc(db, 'folders', folder.id));
              Swal.fire({ toast: true, position: 'top', icon: 'success', title: '폴더 삭제됨', timer: 1500, showConfirmButton: false });
              fetchData();
            } catch (error) {
              console.error('폴더 삭제 오류:', error);
              Swal.fire('오류', '삭제 실패', 'error');
            }
          }
        };
      }
    });

    if (action === true) {
      // 해체
      await handleDissolveFolder(folder);
    } else if (action === false) {
      // 배정 (날짜 선택)
      const { value: date } = await Swal.fire({
        title: '📅 배정 날짜 선택',
        input: 'date',
        inputValue: toLocalDateStr(new Date()),
        showCancelButton: true,
        confirmButtonText: '배정',
        cancelButtonText: '취소'
      });
      
      if (date) {
        await handleFolderAssign(folder, date, roundIndex);
      }
    }
  };

  // 폴더 해체
  const handleDissolveFolder = async (folder) => {
    const confirm = await Swal.fire({
      title: '폴더 해체',
      text: `"${folder.name}" 폴더를 해체하시겠습니까?\n고객들이 개별로 대기목록에 돌아갑니다.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '해체',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });

    if (!confirm.isConfirmed) return;

    try {
      await updateDoc(doc(db, 'folders', folder.id), {
        status: 'dissolved',
        dissolvedAt: new Date().toISOString()
      });

      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: '폴더 해체됨',
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('폴더 해체 오류:', error);
      Swal.fire('오류', '폴더 해체 실패', 'error');
    }
  };

  // 폴더 배정 (담당자, 공동작업자 각각 1개 이벤트)
  const handleFolderAssign = async (folder, date, roundIndex = 0) => {
    if (monthClosed) {
      Swal.fire('알림', '🔒 월마감 완료 - 배정 불가', 'warning');
      return;
    }

    try {
      const wc = folder.workCount || 1;
      const wp = folder.workPrices || [];
      const ac = folder.assignedCount || 0;
      
      // 이번 회차 금액 계산
      const roundPrice = (wp[roundIndex] !== undefined && wp[roundIndex] !== null) ? wp[roundIndex] : Math.round((folder.totalPrice || 0) / wc);
      
      // 공동작업자 금액은 횟수에 비례 배분
      const coWorkerRatio = wc > 1 ? (roundPrice / (folder.totalPrice || 1)) : 1;
      
      const roundLabel = wc > 1 ? ` (${roundIndex + 1}/${wc})` : '';

      // 담당자 이벤트 1개 생성
      // 공동작업자 금액 차감
      let coWorkerTotalForRound = 0;
      for (const cw of (folder.coWorkers || [])) {
        coWorkerTotalForRound += Math.round((cw.price || 0) * coWorkerRatio);
      }
      const mainPrice = Math.max(0, roundPrice - coWorkerTotalForRound);

      const mainEventRef = await addDoc(collection(db, 'events'), {
        title: folder.name + roundLabel,
        date: date,
        price: mainPrice,
        originalPrice: roundPrice,
        status: '배정',
        staffId: folder.staffId || currentUser.id,
        staffName: folder.staffName || currentUser.name,
        folderId: folder.id,
        folderName: folder.name,
        isFolder: true,
        customerIds: folder.customerIds,
        customerNames: folder.customerNames,
        workType: 'folder',
        workRound: roundIndex + 1,
        workCountTotal: wc,
        createdAt: new Date().toISOString()
      });

      // 공동작업자 이벤트 생성
      for (const coWorker of (folder.coWorkers || [])) {
        const cwRoundPrice = Math.round((coWorker.price || 0) * coWorkerRatio);
        await addDoc(collection(db, 'events'), {
          title: `${folder.name}${roundLabel} (공동)`,
          date: date,
          price: cwRoundPrice,
          coWorkPrice: cwRoundPrice,
          status: '배정',
          staffId: staffList.find(s => s.name === coWorker.staffName)?.visibleId || '',
          staffName: coWorker.staffName,
          isCoWork: true,
          folderId: folder.id,
          folderName: folder.name,
          mainStaffName: folder.staffName || currentUser.name,
          parentEventId: mainEventRef.id,
          workType: 'folder',
          workRound: roundIndex + 1,
          workCountTotal: wc,
          createdAt: new Date().toISOString()
        });
      }

      // 폴더 상태 업데이트
      const newAssignedCount = ac + 1;
      const isFullyAssigned = newAssignedCount >= wc;
      
      await updateDoc(doc(db, 'folders', folder.id), {
        assignedCount: newAssignedCount,
        [`assignedDate_${roundIndex + 1}`]: date,
        [`mainEventId_${roundIndex + 1}`]: mainEventRef.id,
        ...(isFullyAssigned ? { status: 'assigned', assignedDate: date, mainEventId: mainEventRef.id } : { status: 'partial' })
      });

      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: wc > 1 
          ? `📁 ${folder.name} ${roundIndex + 1}/${wc}회차 배정됨`
          : `📁 ${folder.name} 전체 배정됨`,
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('폴더 배정 오류:', error);
      Swal.fire('오류', '폴더 배정 실패', 'error');
    }
  };

  // 폴더 완료 (폴더에 속한 이벤트 전체 완료)
  const handleFolderComplete = async (folderId, status = '완료') => {
    try {
      // Firebase에서 직접 폴더에 속한 모든 이벤트 찾기 (담당자 + 공동작업자)
      const folderEventsSnap = await getDocs(query(
        collection(db, 'events'),
        where('folderId', '==', folderId)
      ));
      
      if (folderEventsSnap.docs.length === 0) {
        Swal.fire('알림', '배정된 이벤트가 없습니다', 'info');
        return;
      }

      // 완료자 결정
      let completedBy = currentUser.name;
      if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
        const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
        if (viewingStaff) completedBy = viewingStaff.name;
      }

      // 담당자 이벤트 (폴더) 찾기
      const mainFolderEvent = folderEventsSnap.docs.find(doc => !doc.data().isCoWork);

      // 🧪 약제 팝업 (폴더 전체 완료 시)
      if (mainFolderEvent) {
        const mainData = mainFolderEvent.data();
        const folderCustomerIds = mainData.customerIds || [];
        if (folderCustomerIds.length > 0) {
          const firstCust = customers.find(
            c => c.id === folderCustomerIds[0] || c.code === folderCustomerIds[0]
          );
          if (firstCust) {
            // 폴더 내 고객 중 1명이라도 certTarget이면 필수
            const anyCertRequired = folderCustomerIds.some(cid => {
              const c = customers.find(cu => cu.id === cid || cu.code === cid);
              return !!c?.certTarget;
            });
            const subNote = folderCustomerIds.length > 1
              ? `(폴더 전체 ${folderCustomerIds.length}명에 동일 적용)`
              : '';
            const pesticideResult = await showPesticidePopup(
              String(firstCust.code || firstCust.id),
              firstCust.name,
              { required: anyCertRequired, subTitle: subNote }
            );
            // 필수인데 취소하면 폴더 완료 중단
            if (anyCertRequired && pesticideResult === null) {
              Swal.fire({
                toast: true, position: 'top', icon: 'warning',
                title: '약제 기입이 필요합니다. 완료가 취소되었습니다.',
                timer: 2500, showConfirmButton: false
              });
              return;
            }
            // 저장 결과가 있으면 나머지 고객에도 동일 약제 저장
            if (pesticideResult && folderCustomerIds.length > 1) {
              for (let i = 1; i < folderCustomerIds.length; i++) {
                const cust = customers.find(
                  c => c.id === folderCustomerIds[i] || c.code === folderCustomerIds[i]
                );
                if (cust) {
                  try {
                    await saveCustomerPesticides(
                      String(cust.code || cust.id), cust.name, pesticideResult
                    );
                  } catch (e) { /* 저장 실패해도 계속 */ }
                }
              }
            }
          }
        }
      }
      
      // 모든 이벤트 완료 처리 (담당자 + 공동작업자 모두)
      for (const eventDoc of folderEventsSnap.docs) {
        const eventData = eventDoc.data();
        const isCoWork = eventData.isCoWork;
        await updateDoc(doc(db, 'events', eventDoc.id), {
          status: status,
          completedBy: isCoWork ? completedBy + ' (담당자)' : completedBy,
          completedAt: new Date().toISOString()
        });
      }

      // 폴더 상태 업데이트
      try {
        await updateDoc(doc(db, 'folders', folderId), {
          status: 'completed',
          completedAt: new Date().toISOString(),
          completedBy: completedBy
        });
      } catch (e) {
        console.log('폴더 문서 업데이트 실패:', e);
      }

      // 폴더 내 고객들의 lastWorkDate 업데이트
      if (mainFolderEvent) {
        const mainData = mainFolderEvent.data();
        const customerIds = mainData.customerIds || [];
        const eventDate = mainData.date || toLocalDateStr(new Date());
        
        for (const custId of customerIds) {
          try {
            const customerDoc = customers.find(c => c.id === custId || c.code === custId);
            if (customerDoc) {
              await updateDoc(doc(db, 'customers', customerDoc.id), {
                lastWorkDate: eventDate
              });
            }
          } catch (e) {
            console.log('고객 lastWorkDate 업데이트 오류:', custId, e);
          }
        }
      }

      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'success',
        title: status === '야근' ? '🌙 폴더 전체 야근 처리됨' : '📁 폴더 전체 완료됨',
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('폴더 완료 오류:', error);
      Swal.fire('오류', '폴더 완료 실패', 'error');
    }
  };


  // 관리자모드 토글
  const toggleAdminView = () => {
    setIsAdminView(!isAdminView);
    if (!isAdminView) {
      Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 })
        .fire({ icon: 'warning', title: '⚡ 관리자모드', text: '완료 시 관리자 실적으로 집계' });
    }
  };

  // 직원 선택 변경
  const handleStaffViewChange = (e) => {
    setCurrentViewMode(e.target.value);
    setIsAdminView(false);
  };

  // 대기목록 카드 클릭
  const handleWaitingCardClick = (customer) => {
    if (monthClosed) {
      Swal.fire(customer.name || customer.title, '🔒 월마감 완료 - 배정 불가', 'info');
      return;
    }

    const today = toLocalDateStr(new Date()); // UTC 시차 버그 방지
    // isCharged === false(무료)이면 0원, 아니면 price(무료면 0이 저장됨) 사용
    const displayPrice = (customer.isCharged === false) ? 0 : (customer.price || (customer.isSpecial ? 0 : getTotalPrice(customer)));
    const displayStaff = customer.isSpecial ? (customer.specialWork?.staffName || '-') : (customer.staffName || '-');
    const countBadge = (customer.totalCount > 1 && !customer.isSpecial) ? ` (${customer.currentIndex + 1}/${customer.totalCount})` : '';
    
    // 현재 월의 날짜 버튼 생성
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let dateButtonsHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:10px;">';
    // 요일 헤더
    ['일','월','화','수','목','금','토'].forEach((d, i) => {
      dateButtonsHtml += `<div style="text-align:center;font-size:10px;color:${i===0?'#ef4444':i===6?'#3b82f6':'#666'};padding:4px;">${d}</div>`;
    });
    
    // 첫 날 요일 만큼 빈칸
    const firstDay = new Date(year, month, 1).getDay();
    for (let i = 0; i < firstDay; i++) {
      dateButtonsHtml += '<div></div>';
    }
    
    // 날짜 버튼들
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month, d).getDay();
      const isToday = dateStr === today;
      const color = dayOfWeek === 0 ? '#ef4444' : dayOfWeek === 6 ? '#3b82f6' : '#374151';
      dateButtonsHtml += `
        <button type="button" class="date-pick-btn" data-date="${dateStr}" 
          style="padding:6px 2px;border:${isToday ? '2px solid #f59e0b' : '1px solid #e5e7eb'};
          background:${isToday ? '#fef3c7' : 'white'};border-radius:4px;cursor:pointer;font-size:11px;color:${color};"
          onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='${isToday ? '#fef3c7' : 'white'}'"
        >${d}</button>`;
    }
    dateButtonsHtml += '</div>';

    Swal.fire({
      title: `${customer.isSpecial ? '🌟 ' : ''}${customer.name || customer.title}${countBadge}`,
      html: `
        <div style="text-align:left;padding:10px;background:${customer.isSpecial ? '#fef3c7' : '#f8fafc'};border-radius:8px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;">
            <span>👤 ${displayStaff}</span>
            <span>💰 ${parseInt(displayPrice).toLocaleString()}원</span>
          </div>
        </div>
        <div style="font-size:12px;color:#374151;font-weight:bold;margin-bottom:5px;">📅 ${year}년 ${month + 1}월 - 날짜 선택</div>
        ${dateButtonsHtml}
        ${currentUser.role === 'master' && customer.isSpecial ? 
          `<button onclick="window.deleteSpecialWork('${customer.customerId}')" style="width:100%;margin-top:15px;padding:8px;background:#ef4444;color:white;border:none;border-radius:6px;cursor:pointer;">🗑️ 특별작업 삭제</button>` : ''}
      `,
      showConfirmButton: false,
      showCloseButton: true,
      width: '340px',
      didOpen: () => {
        // 날짜 버튼 클릭 이벤트
        document.querySelectorAll('.date-pick-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const selectedDate = btn.dataset.date;
            Swal.close();
            
            // 배정 실행
            await assignCustomerToDate(customer, selectedDate);
          });
        });
      }
    });
  };

  // 대기 카드 배정
  window.assignWaitingCard = (customerId, isSpecial = false) => {
    Swal.close();
    const today = toLocalDateStr(new Date()); // UTC 시차 버그 방지
    
    Swal.fire({
      title: '📅 날짜 배정',
      html: `<input type="date" id="swal-assign-date" class="swal2-input" value="${today}">`,
      showCancelButton: true,
      confirmButtonText: '배정',
      cancelButtonText: '취소',
      preConfirm: () => document.getElementById('swal-assign-date').value
    }).then(async (r) => {
      if (r.isConfirmed && r.value) {
        const waitingItem = waitingList.find(c => c.id === customerId);
        if (!waitingItem) return;
        
        // 특별작업인 경우 실제 고객 정보 가져오기
        const actualCustomerId = isSpecial ? waitingItem.customerId : waitingItem.id;
        const customer = customers.find(c => c.id === actualCustomerId);
        if (!customer) return;

        let targetStaffId = currentUser.id;
        let targetStaffName = currentUser.name;
        if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
          const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
          if (viewingStaff) {
            targetStaffId = viewingStaff.visibleId;
            targetStaffName = viewingStaff.name;
          }
        }

        try {
          let eventPrice = isSpecial ? (customer.specialWork?.price || 0) : getTotalPrice(customer);
          
          // 공동작업비 계산 (담당자 금액에서 차감)
          let totalCoWorkPrice = 0;
          if (!isSpecial) {
            const coWorkersArray = customer.coWorkers || [];
            if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
              totalCoWorkPrice = customer.coWorker.price || 0;
            } else {
              totalCoWorkPrice = coWorkersArray.reduce((sum, cw) => sum + (cw.price || 0), 0);
            }
          }
          const mainEventPrice = Math.max(0, eventPrice - totalCoWorkPrice);
          
          // 담당자 이벤트 생성 (공동작업비 차감된 금액)
          const mainEventRef = await addDoc(collection(db, 'events'), {
            title: customer.name,
            date: r.value,
            customerCode: customer.id,
            price: mainEventPrice,
            originalPrice: eventPrice,
            status: '배정',
            staffId: targetStaffId,
            staffName: targetStaffName,
            phone: customer.phone,
            address: customer.address,
            isCoWork: false,
            workType: isSpecial ? 'special' : 'regular',
            createdAt: new Date().toISOString()
          });
          
          // 일반 작업: 공동작업자 이벤트 생성
          if (!isSpecial) {
            const coWorkersArray = customer.coWorkers || [];
            if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
              coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
            }
            
            for (const coWorker of coWorkersArray) {
              if (coWorker.staffName) {
                const coWorkerStaff = staffList.find(s => s.name === coWorker.staffName);
                if (coWorkerStaff) {
                  await addDoc(collection(db, 'events'), {
                    title: customer.name,
                    date: r.value,
                    customerCode: customer.id,
                    price: coWorker.price || 0,
                    coWorkPrice: coWorker.price || 0,
                    status: '배정',
                    staffId: coWorkerStaff.visibleId,
                    staffName: coWorkerStaff.name,
                    phone: customer.phone,
                    address: customer.address,
                    isCoWork: true,
                    workType: 'regular',
                    parentEventId: mainEventRef.id,
                    mainStaffName: targetStaffName,
                    createdAt: new Date().toISOString()
                  });
                }
              }
            }
          }
          
          // 특별작업은 공동작업자를 배정 후 따로 추가하므로 여기서는 생성하지 않음
          
          fetchData();
        } catch (error) {
          Swal.fire('오류', '배정 실패', 'error');
        }
      }
    });
  };

  // 특별작업 삭제 (customers 컬렉션의 specialWork 필드를 null로)
  window.deleteSpecialWork = async (customerId) => {
    Swal.close();
    const result = await Swal.fire({
      title: '특별작업을 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '삭제',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        await updateDoc(doc(db, 'customers', customerId), {
          specialWork: null
        });
        fetchData();
        Swal.fire('완료', '특별작업이 삭제되었습니다', 'success');
      } catch (error) {
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  // 폴더 클릭 (10명 이상) - 모바일 친화적
  // eslint-disable-next-line no-unused-vars
  const handleFolderClick = () => {
    // 체크박스 리스트 생성
    let listHtml = '<div style="max-height:320px; overflow-y:auto; -webkit-overflow-scrolling:touch; text-align:left;">';
    waitingList.forEach((c, idx) => {
      const displayPrice = c.price ?? (c.isSpecial ? 0 : getTotalPrice(c));
      const displayStaff = c.isSpecial ? (c.specialWork?.staffName || '-') : (c.staffName || '-');
      const isSpecial = c.isSpecial || c.id?.startsWith('special_');
      const isExtraWork = c.isExtraWork || c.id?.startsWith('extra_');
      const isFree = c.isCharged === false;
      
      // 회차 표시 (특별작업도 포함)
      let countBadge = '';
      if (isSpecial && c.totalCount > 1) {
        countBadge = `<span style="color:#7c3aed;font-size:11px;font-weight:bold;">(${c.currentRound || 1}/${c.totalCount})</span>`;
      } else if (c.totalCount > 1 && !isSpecial) {
        countBadge = `<span style="color:#6366f1;font-size:11px;">(${c.currentIndex + 1}/${c.totalCount})</span>`;
      }
      
      const icon = isSpecial ? '🌟' : (isExtraWork ? '📝' : (isFree ? '🆓' : (c.unpaid > 0 ? '💰' : '')));
      const priceText = isFree ? '<span style="color:#94a3b8;">무료</span>' : `${parseInt(displayPrice).toLocaleString()}원`;
      
      listHtml += `
        <label id="folder-item-${idx}" style="display:flex;align-items:center;padding:12px;margin:4px 0;background:${isSpecial ? '#f3e8ff' : (isExtraWork ? '#fff7ed' : (isFree ? '#f1f5f9' : '#f8fafc'))};border-radius:8px;cursor:pointer;border:2px solid ${isSpecial ? '#c4b5fd' : (isExtraWork ? '#fdba74' : '#e2e8f0')};opacity:${isFree ? '0.7' : '1'};min-height:50px;transition:all 0.2s;">
          <input type="checkbox" class="folder-customer-check" value="${c.id}" 
            data-original-id="${c.customerId || c.originalId || c.id}" 
            data-price="${isFree ? 0 : displayPrice}" 
            data-special="${isSpecial}"
            data-extra="${isExtraWork}"
            data-extra-work-id="${c.extraWorkId || ''}"
            data-idx="${idx}"
            style="width:22px;height:22px;min-width:22px;margin-right:12px;accent-color:#3b82f6;">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:500;">${icon} ${c.displayName || c.name || c.title} ${countBadge}</div>
            <div style="font-size:12px;color:${isFree ? '#94a3b8' : '#666'};">${displayStaff} | ${priceText}</div>
          </div>
        </label>`;
    });
    listHtml += '</div>';

    Swal.fire({
      title: `📦 대기 목록 (${waitingList.length}명)`,
      html: `
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" onclick="document.querySelectorAll('.folder-customer-check').forEach(c=>{c.checked=true;window.updateItemStyle(c);});window.updateFolderCount();" style="flex:1;min-width:80px;padding:10px;border:none;background:#3b82f6;color:white;border-radius:6px;font-size:13px;min-height:40px;">전체선택</button>
          <button type="button" onclick="document.querySelectorAll('.folder-customer-check').forEach(c=>{c.checked=false;window.updateItemStyle(c);});window.updateFolderCount();" style="flex:1;min-width:80px;padding:10px;border:none;background:#64748b;color:white;border-radius:6px;font-size:13px;min-height:40px;">전체해제</button>
        </div>
        ${listHtml}
        <div style="margin-top:12px;padding:10px;background:#f1f5f9;border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <span style="font-size:14px;font-weight:bold;">선택: <span id="folder-selected-count" style="color:#3b82f6;">0</span>명 / 전체: ${waitingList.length}명</span>
          <input type="date" id="folder-assign-date" value="${toLocalDateStr(new Date())}" style="padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '📅 선택 배정',
      cancelButtonText: '닫기',
      width: '95%',
      didOpen: () => {
        // 아이템 스타일 업데이트 함수
        window.updateItemStyle = (checkbox) => {
          const idx = checkbox.dataset.idx;
          const label = document.getElementById('folder-item-' + idx);
          if (label) {
            if (checkbox.checked) {
              label.style.background = '#dbeafe';
              label.style.borderColor = '#3b82f6';
              label.style.borderWidth = '2px';
            } else {
              const isSpecial = checkbox.dataset.special === 'true';
              label.style.background = isSpecial ? '#f3e8ff' : '#f8fafc';
              label.style.borderColor = isSpecial ? '#c4b5fd' : '#e2e8f0';
            }
          }
        };
        
        // 선택 개수 업데이트 함수
        window.updateFolderCount = () => {
          const count = document.querySelectorAll('.folder-customer-check:checked').length;
          document.getElementById('folder-selected-count').textContent = count;
        };
        
        // 체크박스 변경 시 카운트 + 스타일 업데이트
        document.querySelectorAll('.folder-customer-check').forEach(cb => {
          cb.addEventListener('change', () => {
            window.updateItemStyle(cb);
            window.updateFolderCount();
          });
        });
      },
      preConfirm: () => {
        const checked = document.querySelectorAll('.folder-customer-check:checked');
        const date = document.getElementById('folder-assign-date').value;
        
        if (checked.length === 0) {
          Swal.showValidationMessage('최소 1명을 선택하세요');
          return false;
        }
        if (!date) {
          Swal.showValidationMessage('날짜를 선택하세요');
          return false;
        }
        
        return {
          date: date,
          customers: Array.from(checked).map(cb => ({
            id: cb.value,
            originalId: cb.dataset.originalId,
            price: Number(cb.dataset.price) || 0,
            isSpecial: cb.dataset.special === 'true',
            isExtra: cb.dataset.extra === 'true',
            extraWorkId: cb.dataset.extraWorkId || ''
          }))
        };
      }
    }).then(async (r) => {
      if (r.isConfirmed && r.value) {
        await assignSelectedCustomers(r.value.date, r.value.customers);
      }
    });
  };

  // 선택된 고객들 배정 (공통 함수)
  const assignSelectedCustomers = async (date, selectedList) => {
    let targetStaffId = currentUser.id;
    let targetStaffName = currentUser.name;
    if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
      const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
      if (viewingStaff) {
        targetStaffId = viewingStaff.visibleId;
        targetStaffName = viewingStaff.name;
      }
    }

    try {
      let successCount = 0;
      
      for (const selected of selectedList) {
        const customer = waitingList.find(c => c.id === selected.id);
        if (!customer) continue;

        const isSpecialWork = selected.isSpecial;
        const isExtraWork = selected.isExtra || customer.isExtraWork || customer.id?.startsWith('extra_');
        const extraWorkId = customer.extraWorkId || selected.extraWorkId || '';
        const eventPrice = selected.price || (isSpecialWork ? (customer.price || 0) : getTotalPrice(customer));
        const realCustomerId = selected.originalId || (isSpecialWork ? customer.customerId : (isExtraWork ? extraWorkId : customer.id));

        // 추가업무인 경우
        if (isExtraWork) {
          const extraEventRef = await addDoc(collection(db, 'events'), {
            title: customer.displayName || customer.name || customer.title,
            date: date,
            customerCode: extraWorkId || realCustomerId,
            price: customer.price || 0,
            status: '배정',
            staffId: targetStaffId,
            staffName: targetStaffName,
            workType: 'extra',
            category: customer.category,
            extraWorkId: extraWorkId,
            createdAt: new Date().toISOString()
          });
          
          // extraWork 컬렉션 상태 업데이트
          if (extraWorkId) {
            await updateDoc(doc(db, 'extraWork', extraWorkId), {
              status: '배정됨',
              assignedDate: date,
              eventId: extraEventRef.id
            });
          }
          
          successCount++;
          continue;
        }

        // 담당자 이벤트 생성
        const mainEventRef = await addDoc(collection(db, 'events'), {
          title: customer.displayName || customer.name || customer.title,
          date: date,
          customerCode: realCustomerId,
          price: eventPrice,
          status: '배정',
          staffId: targetStaffId,
          staffName: targetStaffName,
          phone: customer.phone || '',
          address: customer.address || '',
          isCoWork: false,
          workType: isSpecialWork ? 'special' : 'regular',
          createdAt: new Date().toISOString()
        });

        // 일반 작업: 공동작업자 이벤트도 생성
        if (!isSpecialWork) {
          const coWorkersArray = customer.coWorkers || [];
          if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
            coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
          }
          
          for (const coWorker of coWorkersArray) {
            if (coWorker.staffName) {
              const coWorkerStaff = staffList.find(s => s.name === coWorker.staffName);
              if (coWorkerStaff) {
                await addDoc(collection(db, 'events'), {
                  title: customer.displayName || customer.name || customer.title,
                  date: date,
                  customerCode: realCustomerId,
                  price: coWorker.price || 0,
                  coWorkPrice: coWorker.price || 0,
                  status: '배정',
                  staffId: coWorkerStaff.visibleId,
                  staffName: coWorkerStaff.name,
                  phone: customer.phone || '',
                  address: customer.address || '',
                  isCoWork: true,
                  workType: 'regular',
                  parentEventId: mainEventRef.id,
                  mainStaffName: targetStaffName,
                  createdAt: new Date().toISOString()
                });
              }
            }
          }
        }
        
        // 특별작업이면 completedCount +1 업데이트
        if (isSpecialWork) {
          try {
            // 특별작업의 실제 고객 ID 확인
            const actualCustomerId = customer.customerId || selected.originalId || realCustomerId;
            console.log('🌟 특별작업 배정:', {
              customerId: actualCustomerId,
              customerName: customer.name || customer.displayName,
              currentCount: customer.specialWork?.completedCount || 0,
              totalCount: customer.specialWork?.totalCount || 1
            });
            
            if (actualCustomerId && !actualCustomerId.startsWith('special_')) {
              const currentCount = customer.specialWork?.completedCount || 0;
              await updateDoc(doc(db, 'customers', actualCustomerId), {
                'specialWork.completedCount': currentCount + 1
              });
              console.log('✅ 특별작업 완료횟수 업데이트:', currentCount + 1, '/', customer.specialWork?.totalCount || 1);
            } else {
              console.log('❌ 유효하지 않은 고객 ID:', actualCustomerId);
            }
          } catch (e) {
            console.log('❌ completedCount 업데이트 오류:', e);
          }
        }
        
        successCount++;
      }

      Swal.fire({
        icon: 'success',
        title: '배정 완료!',
        text: `${successCount}건 배정되었습니다`,
        timer: 1500,
        showConfirmButton: false
      });
      fetchData();
    } catch (error) {
      console.error('배정 오류:', error);
      Swal.fire('오류', '배정 중 오류가 발생했습니다', 'error');
    }
  };

  window.handleWaitingSelect = (id) => {
    Swal.close();
    const customer = waitingList.find(c => c.id === id);
    if (customer) handleWaitingCardClick(customer);
  };

  window.bulkAssignAll = () => {
    Swal.close();
    const today = toLocalDateStr(new Date()); // UTC 시차 버그 방지

    Swal.fire({
      title: `📦 전체 배정 (${waitingList.length}명)`,
      html: `<input type="date" id="swal-bulk-date" class="swal2-input" value="${today}">`,
      showCancelButton: true,
      confirmButtonText: '전체 배정',
      cancelButtonText: '취소',
      preConfirm: () => document.getElementById('swal-bulk-date').value
    }).then(async (r) => {
      if (r.isConfirmed && r.value) {
        let targetStaffId = currentUser.id;
        let targetStaffName = currentUser.name;
        if (currentViewMode !== 'self' && currentViewMode !== 'admin') {
          const viewingStaff = staffList.find(s => s.visibleId === currentViewMode);
          if (viewingStaff) {
            targetStaffId = viewingStaff.visibleId;
            targetStaffName = viewingStaff.name;
          }
        }

        try {
          for (const customer of waitingList) {
            // 담당자 이벤트 생성
            const mainEventRef = await addDoc(collection(db, 'events'), {
              title: customer.name || customer.title,
              date: r.value,
              customerCode: customer.id,
              price: getTotalPrice(customer),
              status: '배정',
              staffId: targetStaffId,
              staffName: targetStaffName,
              phone: customer.phone,
              address: customer.address,
              isCoWork: false,
              createdAt: new Date().toISOString()
            });
            
            // 공동작업자가 있으면 공동작업자 이벤트도 생성 (coWorkers 배열 지원)
            const coWorkersArray = customer.coWorkers || [];
            // 옛날 coWorker 단일 구조도 호환
            if (coWorkersArray.length === 0 && customer.coWorker?.enabled && customer.coWorker?.staffName) {
              coWorkersArray.push({ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 });
            }
            
            for (const coWorker of coWorkersArray) {
              if (coWorker.staffName) {
                const coWorkerStaff = staffList.find(s => s.name === coWorker.staffName);
                if (coWorkerStaff) {
                  await addDoc(collection(db, 'events'), {
                    title: customer.name || customer.title,
                    date: r.value,
                    customerCode: customer.id,
                    price: coWorker.price || 0,
                    coWorkPrice: coWorker.price || 0,
                    status: '배정',
                    staffId: coWorkerStaff.visibleId,
                    staffName: coWorkerStaff.name,
                    phone: customer.phone,
                    address: customer.address,
                    isCoWork: true,
                    parentEventId: mainEventRef.id,
                    mainStaffName: targetStaffName,
                    createdAt: new Date().toISOString()
                  });
                }
              }
            }
          }
          Swal.fire('완료', `${waitingList.length}명 배정 완료`, 'success');
          fetchData();
        } catch (error) {
          Swal.fire('오류', '배정 실패', 'error');
        }
      }
    });
  };

  window.deleteAllSpecial = async () => {
    Swal.close();
    const specials = waitingList.filter(c => c.isSpecial);
    if (specials.length === 0) {
      Swal.fire('없음', '삭제할 특별작업이 없습니다', 'info');
      return;
    }

    const result = await Swal.fire({
      title: '특별작업 전체 삭제',
      text: `${specials.length}건을 삭제합니다`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '삭제',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        for (const s of specials) {
          await deleteDoc(doc(db, 'specialWorks', s.id));
        }
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  // 캘린더 내 이벤트 드래그로 날짜 변경
  const handleEventDrop = async (info) => {
    if (monthClosed) {
      info.revert();
      Swal.fire('월마감 완료', '일정 변경이 불가합니다', 'warning');
      return;
    }

    const eventId = info.event.id;
    const newDate = info.event.startStr;
    const oldDate = info.oldEvent.startStr;
    const isCoWork = info.event.extendedProps.isCoWork;
    const currentStatus = info.event.extendedProps.status;

    // 일일마감된 날짜에서는 이동 불가
    if (dailyClosedDates.includes(oldDate)) {
      info.revert();
      Swal.fire('일일마감 완료', '마감 해제 후 이동하세요', 'warning');
      return;
    }

    // 공동작업자 이벤트는 개별 이동 불가 (담당자 이벤트와 함께 이동)
    if (isCoWork) {
      info.revert();
      Swal.fire('알림', '공동작업 일정은 담당자 일정과 함께 이동됩니다', 'info');
      return;
    }

    // 완료/야근 상태면 배정으로 리셋 경고
    if (['완료', '야근'].includes(currentStatus)) {
      const confirm = await Swal.fire({
        title: '⚠️ 완료 상태 초기화',
        html: '이동하면 <b>완료 이력이 삭제</b>되고<br>배정 상태로 변경됩니다.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '이동',
        cancelButtonText: '취소',
        confirmButtonColor: '#3b82f6'
      });

      if (!confirm.isConfirmed) {
        info.revert();
        return;
      }
    }

    try {
      // 담당자 이벤트 날짜 변경 + 상태 리셋
      const updateData = { date: newDate };
      if (['완료', '야근'].includes(currentStatus)) {
        updateData.status = '배정';
        updateData.completedBy = '';
        updateData.completedAt = '';
      }
      await updateDoc(doc(db, 'events', eventId), updateData);

      // 공동작업자 이벤트도 같이 날짜 변경 + 상태 리셋
      const eventSnap = await getDocs(collection(db, 'events'));
      const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);

      for (const coWorkDoc of coWorkEvents) {
        const coUpdateData = { date: newDate };
        if (['완료', '야근'].includes(currentStatus)) {
          coUpdateData.status = '배정';
          coUpdateData.completedBy = '';
          coUpdateData.completedAt = '';
        }
        await updateDoc(doc(db, 'events', coWorkDoc.id), coUpdateData);
      }

      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: '일정 변경됨' });
      fetchData();
    } catch (error) {
      info.revert();
      Swal.fire('오류', '일정 변경 실패', 'error');
    }
  };


  // ===== 1회성 담당 헬퍼: 해당 연월에 유효한 담당자 이름 반환 =====
  const getEffectiveStaffName = (customer, yearMonthStr) => {
    // yearMonthStr: "2025-05" 형식
    if (customer.onetimeStaff && customer.onetimeStaff[yearMonthStr]) {
      return customer.onetimeStaff[yearMonthStr];
    }
    return customer.staffName || '';
  };

  // ===== 변동 현황 탭 데이터 계산 =====
  const calcNewCustomers = () => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth() + 1;
    const thisMonthStr = `${thisYear}-${String(thisMonth).padStart(2, '0')}`;
    const winterMonths = [1, 2, 3, 12];
    const isWinterMonth = winterMonths.includes(thisMonth);

    // 전체 고객 (삭제 제외)
    const allCustomers = customers.filter(c => c.custStatus !== '삭제');
    // 정상 고객만 (해약 제외)
    const activeCustomers = allCustomers.filter(c => c.custStatus !== '해약');

    // 🆕 신규고객: 이번달에 createdAt이 있는 정상 고객
    const newOnes = activeCustomers.filter(c => {
      const created = (c.createdAt || '').substring(0, 7);
      return created === thisMonthStr;
    });

    // 이번달 이벤트 (extra·coWork 제외)
    const thisMonthEvents = events.filter(e =>
      e.extendedProps?.workType !== 'extra' && !e.extendedProps?.isCoWork
    );

    // 전월 이벤트 (fetchData에서 저장한 prevMonthEvents 사용)
    const prevEventsAll = prevMonthEvents;

    // 고객이 해당 이벤트 목록에 있는지 확인 (customerCode = c.id 또는 c.code)
    const hasEvent = (c, monthEvents) =>
      monthEvents.some(e =>
        e.extendedProps?.customerCode === c.id ||
        e.extendedProps?.customerCode === c.code
      );

    // 대기목록에 있는지 확인
    const isInWaiting = (c) =>
      waitingList.some(w =>
        (w.originalId || w.id?.replace(/^(special_|extra_)/, '').split('_')[0]) === c.id
      );

    // 🔄 복귀고객:
    // 지난달 배정 이벤트 없었는데 이번달 배정 이벤트 있는 고객
    // (신규 제외 - 이번달 새로 등록된 고객은 신규로 분류)
    const newCustomerIds = new Set(newOnes.map(c => c.id));
    const returnOnes = activeCustomers.filter(c => {
      if (newCustomerIds.has(c.id)) return false;     // 신규는 제외
      if (!hasEvent(c, thisMonthEvents)) return false; // 이번달 배정 없으면 제외
      if (hasEvent(c, prevEventsAll)) return false;    // 지난달에도 있었으면 복귀 아님
      return true;
    });

    // ── 누락 사유 자동 추정 헬퍼 ──────────────────────
    const getMissingReason = (c) => {
      // 1. 해약
      if (c.custStatus === '해약') {
        const reason = c.cancelReason ? `해약 (${c.cancelReason})` : '해약';
        const date = c.cancelDate ? ` · ${c.cancelDate}` : '';
        return { label: reason + date, color: '#dc2626', bg: '#fef2f2' };
      }
      // 2. 이번달 작업계획 비활성
      const wmd = c.workMonthsData || {};
      const thisMonthData = wmd[thisMonth];
      const isActiveThisMonth = thisMonthData
        ? thisMonthData.enabled !== false
        : (Array.isArray(c.workMonths) ? c.workMonths : [1,2,3,4,5,6,7,8,9,10,11,12]).includes(thisMonth);
      if (!isActiveThisMonth) {
        // 동절기 비활성인지 확인
        if (isWinterMonth && c.winterEnabled === false) {
          return { label: '동절기 휴무', color: '#0891b2', bg: '#e0f2fe' };
        }
        return { label: '이번달 작업계획 없음', color: '#6b7280', bg: '#f3f4f6' };
      }
      // 3. 담당자 미배정 (staffName 없음)
      if (!c.staffName) {
        return { label: '담당자 미지정', color: '#d97706', bg: '#fef3c7' };
      }
      // 4. 그 외 — 담당자명 표시
      return { label: `배정 필요 · 담당: ${c.staffName}`, color: '#ef4444', bg: '#fef2f2' };
    };

    // ⚠️ 누락고객:
    // 지난달 배정 이벤트 있었는데 이번달 배정+대기 모두 없는 고객
    // (해약 포함, 삭제만 제외)
    const missingOnes = allCustomers
      .filter(c => {
        if (!hasEvent(c, prevEventsAll)) return false;   // 지난달 배정 없으면 제외
        if (hasEvent(c, thisMonthEvents)) return false;  // 이번달 배정 있으면 제외
        if (isInWaiting(c)) return false;                // 대기목록에 있으면 제외
        return true;
      })
      .map(c => {
        const isCancelledMissing = c.custStatus === '해약';
        const isUrgent = !isCancelledMissing;
        const missingReason = getMissingReason(c);
        return { ...c, isCancelledMissing, isUrgent, missingReason };
      });

    return { newOnes, returnOnes, missingOnes, thisMonthStr };
  };
  // 컴포넌트 언마운트 시 window.* 전역 함수 정리 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      delete window.assignWaitingCard;
      delete window.deleteSpecialWork;
      delete window.handleWaitingSelect;
      delete window.bulkAssignAll;
      delete window._updateMultiCount;
      delete window.handleMobileEventClick;
      delete window.updateSelectedCount;
      delete window.updateItemStyle;
      delete window.updateFolderCount;
    };
  }, []);

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 모바일 드래그 시 스크롤 영역 */}
      {showScrollZones && (
        <>
          <div style={styles.scrollZoneTop}>
            ▲ 위로 스크롤
          </div>
          <div style={styles.scrollZoneBottom}>
            ▼ 아래로 스크롤
          </div>
        </>
      )}

      {/* 모바일 드래그 중인 카드 */}
      {mobileDragItem && (
        <div style={{
          position: 'fixed',
          left: mobileDragPos.x - 60,
          top: mobileDragPos.y - 25,
          backgroundColor: '#3b82f6',
          color: 'white',
          padding: '8px 15px',
          borderRadius: '8px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
          zIndex: 10000,
          pointerEvents: 'none',
          fontSize: '13px',
          fontWeight: 'bold',
          maxWidth: '150px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {mobileDragItem.displayName || mobileDragItem.name || mobileDragItem.title}
        </div>
      )}

      {/* 상단 버튼들 - PC/모바일 분기 */}
      <div style={isMobile ? styles.topButtonsMobile : styles.topButtons}>
        {currentUser.role === 'master' && (
          <>
            <select 
              value={currentViewMode} 
              onChange={handleStaffViewChange}
              style={isMobile ? styles.staffSelectMobile : styles.staffSelect}
            >
              <option value="self">{isMobile ? currentUser.name : `${currentUser.name} (나)`}</option>
              {staffList.filter(s => s.visibleId !== currentUser.id).map(s => (
                <option key={s.id} value={s.visibleId}>{s.name}</option>
              ))}
            </select>
            <button 
              onClick={toggleAdminView}
              style={{
                ...(isMobile ? styles.topBtnMobile : styles.topBtn),
                backgroundColor: isAdminView ? '#dc2626' : '#7c3aed'
              }}
              title={isAdminView ? '관리자모드' : '전체현황'}
            >
              {isMobile ? (isAdminView ? '⚡전체' : '📋전체') : (isAdminView ? '⚡ 관리자모드' : '📋 전체현황')}
            </button>
          </>
        )}
        <button onClick={handleMonthClose} style={{
          ...(isMobile ? styles.topBtnMobile : styles.topBtn),
          backgroundColor: monthClosed ? '#64748b' : '#f59e0b'
        }} title={monthClosed ? '마감완료' : '월마감'}>
          {isMobile ? (monthClosed ? '🔒월' : '🔓월') : (monthClosed ? '🔒 마감완료' : '🔓 월마감')}
        </button>
        <button onClick={handleClockIn} style={{...(isMobile ? styles.topBtnMobile : styles.topBtn), backgroundColor: '#10b981'}} title="출근">
          {isMobile ? '🏃출' : '🏃 출근'}
        </button>
        <button onClick={() => handleDailyClose()} style={{
          ...(isMobile ? styles.topBtnMobile : styles.topBtn),
          backgroundColor: dailyClosedDates.includes(toLocalDateStr(new Date())) ? '#64748b' : '#3b82f6'
        }} title={dailyClosedDates.includes(toLocalDateStr(new Date())) ? '마감해제' : '일일마감'}>
          {isMobile ? '📋일' : (dailyClosedDates.includes(toLocalDateStr(new Date())) ? '📋 마감해제' : '📋 일일마감')}
        </button>
        <button onClick={handleShareDayPicker} style={{
          ...(isMobile ? styles.topBtnMobile : styles.topBtn),
          backgroundColor: '#10b981'
        }} title="완료 공유">
          {isMobile ? '📤' : '📤 완료 공유'}
        </button>
      </div>

      {/* 메인 탭 - 배정플랜 / 신규추가 */}
      {(() => {
        const { newOnes, returnOnes, missingOnes } = calcNewCustomers();
        const totalNew = newOnes.length + returnOnes.length;
        const totalMissing = missingOnes.length;
        const totalBadge = totalNew + totalMissing;
        return (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            <button
              onClick={() => setCalendarMainTab('calendar')}
              style={{
                flex: 1, padding: '10px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 'bold', fontSize: '13px',
                background: calendarMainTab === 'calendar' ? '#3b82f6' : '#e5e7eb',
                color: calendarMainTab === 'calendar' ? 'white' : '#374151',
              }}
            >
              📅 배정플랜
            </button>
            <button
              onClick={() => setCalendarMainTab('newCustomers')}
              style={{
                flex: 1, padding: '10px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 'bold', fontSize: '13px', position: 'relative',
                background: calendarMainTab === 'newCustomers' ? '#f59e0b' : '#e5e7eb',
                color: calendarMainTab === 'newCustomers' ? 'white' : '#374151',
              }}
            >
              🔔 변동 현황
              {totalBadge > 0 && (
                <span style={{
                  position: 'absolute', top: '4px', right: '6px',
                  background: totalMissing > 0 ? '#ef4444' : '#10b981',
                  color: 'white', borderRadius: '50%',
                  width: '18px', height: '18px', fontSize: '10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold'
                }}>{totalBadge > 9 ? '9+' : totalBadge}</span>
              )}
            </button>
          </div>
        );
      })()}

      {/* 변동 현황 탭 콘텐츠 */}
      {calendarMainTab === 'newCustomers' && (() => {
        const { newOnes, returnOnes, missingOnes, thisMonthStr } = calcNewCustomers();
        return (
          <CalendarNewCustomersTab
            newOnes={newOnes}
            returnOnes={returnOnes}
            missingOnes={missingOnes}
            thisMonthStr={thisMonthStr}
            newCustomerSubTab={newCustomerSubTab}
            setNewCustomerSubTab={setNewCustomerSubTab}
          />
        );
      })()}

      {/* ── Today 대시보드 (통합형) ── */}
      {calendarMainTab === 'calendar' && (
        <TodayDashboard
          currentUser={currentUser}
          staffList={staffList}
          stats={stats}
          statsModal={statsModal}
          setStatsModal={setStatsModal}
          events={events}
          waitingList={waitingList}
          sendVisitReminders={currentMonthStr === new Date().toISOString().substring(0,7) ? sendVisitReminders : null}
          currentMonthStr={currentMonthStr}
          currentViewMode={currentViewMode}
          isAdminView={isAdminView}
        />
      )}

      {/* 통계 상세 패널 (CalendarDashboard에서 statsModal 펼치면 보임) */}
      {calendarMainTab === 'calendar' && statsModal && (
        <CalendarDashboard
          stats={stats}
          statsModal={statsModal}
          setStatsModal={setStatsModal}
          currentMonthStr={currentMonthStr}
          events={events}
          waitingList={waitingList}
          detailOnly={true}
        />
      )}


      {/* 캘린더+대기목록 - 배정플랜 탭에서만 표시 */}
      {calendarMainTab === 'calendar' && (
        <div>
          <div style={styles.calendarContainer} className={isMobile ? 'mobile-calendar' : ''}>
        <FullCalendar
          key={currentMonthStr}
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={`${currentMonthStr}-01`}
          locale="ko"
          headerToolbar={{
            left: '',
            center: 'title',
            right: ''
          }}
          events={events}
          eventClick={(info) => {
            // +more 팝업(popover) 닫기
            document.querySelectorAll('.fc-popover').forEach(el => el.remove());
            handleEventClick(info);
          }}
          dateClick={handleDateClick}
          eventReceive={handleEventReceive}
          eventDrop={handleEventDrop}
          droppable={!isMobile}
          editable={!monthClosed && !isMobile}
          height="auto"
          dayMaxEvents={isMobile ? 2 : 3}
          eventDisplay="block"
          moreLinkClick={isMobile ? (info) => {
            // 모바일: 커스텀 드래그 팝업
            const dateStr = info.dateStr || toLocalDateStr(info.date); // UTC 시차 버그 방지
            const dateEvents = info.allSegs.map(seg => seg.event);
            
            const listHtml = `
              <div style="text-align:left;max-height:60vh;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;">
                ${dateEvents.map(e => {
                  const props = e.extendedProps || {};
                  const bgColor = e.backgroundColor || '#3b82f6';
                  return `
                    <div class="mobile-event-drag" data-event-id="${e.id}" 
                      style="padding:12px;margin:6px 0;background:${bgColor};color:white;border-radius:8px;cursor:grab;user-select:none;">
                      <div style="font-weight:bold;">${e.title}</div>
                      <div style="font-size:12px;opacity:0.9;">${props.status || '배정'} | ${(props.price || 0).toLocaleString()}원</div>
                    </div>
                  `;
                }).join('')}
              </div>
              <div style="margin-top:10px;padding:10px;background:#f1f5f9;border-radius:8px;font-size:12px;color:#666;text-align:center;">
                💡 카드를 <b>0.3초 길게 누르면</b> 드래그할 수 있어요
              </div>
            `;
            
            Swal.fire({
              title: `📅 ${dateStr}`,
              html: listHtml,
              showConfirmButton: false,
              showCloseButton: true,
              width: '95%',
              didOpen: () => {
                const items = document.querySelectorAll('.mobile-event-drag');
                items.forEach(item => {
                  let pressTimer = null;
                  let startX = 0, startY = 0;
                  
                  item.addEventListener('touchstart', (e) => {
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    
                    pressTimer = setTimeout(() => {
                      // 길게 누르면 드래그 시작
                      const eventId = item.dataset.eventId;
                      const event = events.find(ev => ev.id === eventId);
                      if (event) {
                        Swal.close();
                        // 이벤트 정보로 드래그 아이템 설정
                        const dragItem = {
                          id: event.id,
                          title: event.title,
                          displayName: event.title,
                          price: event.extendedProps?.price || 0,
                          isExistingEvent: true,
                          eventId: event.id,
                          originalDate: event.start
                        };
                        startMobileDrag(dragItem, e.touches[0].clientX, e.touches[0].clientY, dateStr);
                      }
                    }, 300);
                  }, { passive: false });
                  
                  item.addEventListener('touchmove', (e) => {
                    const moveX = Math.abs(e.touches[0].clientX - startX);
                    const moveY = Math.abs(e.touches[0].clientY - startY);
                    if (moveX > 10 || moveY > 10) {
                      clearTimeout(pressTimer);
                    }
                  });
                  
                  item.addEventListener('touchend', () => {
                    clearTimeout(pressTimer);
                  });
                  
                  // 짧게 클릭하면 상세보기
                  item.addEventListener('click', () => {
                    const eventId = item.dataset.eventId;
                    const event = events.find(ev => ev.id === eventId);
                    if (event) {
                      Swal.close();
                      handleEventClick({ 
                        event: { 
                          id: event.id, 
                          title: event.title, 
                          startStr: event.start, 
                          extendedProps: event.extendedProps,
                          backgroundColor: event.backgroundColor
                        } 
                      });
                    }
                  });
                });
              }
            });
            
            return 'none'; // 기본 popover 안 열리게
          } : undefined}
          eventDidMount={isMobile ? (info) => {
            // 모바일: 캘린더에 보이는 모든 이벤트에 터치 드래그 추가
            const el = info.el;
            let pressTimer = null;
            let startX = 0, startY = 0;
            
            el.addEventListener('touchstart', (e) => {
              startX = e.touches[0].clientX;
              startY = e.touches[0].clientY;
              
              pressTimer = setTimeout(() => {
                // 0.3초 길게 누르면 드래그 시작
                const event = info.event;
                const dragItem = {
                  id: event.id,
                  title: event.title,
                  displayName: event.title,
                  price: event.extendedProps?.price || 0,
                  isExistingEvent: true,
                  eventId: event.id,
                  originalDate: event.startStr
                };
                startMobileDrag(dragItem, e.touches[0].clientX, e.touches[0].clientY, event.startStr);
              }, 300); // 0.3초로 단축
            }, { passive: true });
            
            el.addEventListener('touchmove', (e) => {
              const moveX = Math.abs(e.touches[0].clientX - startX);
              const moveY = Math.abs(e.touches[0].clientY - startY);
              if (moveX > 10 || moveY > 10) {
                clearTimeout(pressTimer);
              }
            });
            
            el.addEventListener('touchend', () => {
              clearTimeout(pressTimer);
            });
          } : undefined}
        />
      </div>

      {/* 🚀 자동배치 버튼 */}
      <button onClick={handleAutoAssign} style={styles.autoAssignBtn}>
        🚀 자동배치 (이전달 기록 기반)
      </button>

      {/* 📷 AI 사진/텍스트 배정 버튼 */}
      {settings.aiAssignEnabled !== false && (
        <button onClick={handleAIAssign} style={{...styles.autoAssignBtn, backgroundColor: '#0ea5e9', marginTop: '8px'}}>
          📷 사진/텍스트 자동배정 (AI)
        </button>
      )}

      {/* 대기목록 */}
      <div style={styles.waitingSection}>
        {/* 월 이동 컨트롤 */}
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:'12px',marginBottom:'12px',padding:'8px',background:'#f1f5f9',borderRadius:'8px'}}>
          <button 
            onClick={() => {
              const [y, m] = currentMonthStr.split('-').map(Number);
              let newYear = y;
              let newMonth = m - 1;
              if (newMonth < 1) {
                newMonth = 12;
                newYear -= 1;
              }
              setCurrentMonthStr(`${newYear}-${String(newMonth).padStart(2, '0')}`);
            }} 
            style={{padding:'6px 12px',background:'#3b82f6',color:'white',border:'none',borderRadius:'6px',fontSize:'14px',cursor:'pointer',fontWeight:'bold'}}
          >
            ◀ 이전
          </button>
          <span style={{fontSize:'16px',fontWeight:'bold',color:'#1e293b',minWidth:'120px',textAlign:'center'}}>
            {currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월
          </span>
          <button 
            onClick={() => {
              const [y, m] = currentMonthStr.split('-').map(Number);
              let newYear = y;
              let newMonth = m + 1;
              if (newMonth > 12) {
                newMonth = 1;
                newYear += 1;
              }
              setCurrentMonthStr(`${newYear}-${String(newMonth).padStart(2, '0')}`);
            }} 
            style={{padding:'6px 12px',background:'#3b82f6',color:'white',border:'none',borderRadius:'6px',fontSize:'14px',cursor:'pointer',fontWeight:'bold'}}
          >
            다음 ▶
          </button>
        </div>
        
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
          {/* active 폴더만 대기목록에 표시 (배정된 폴더는 제외) */}
          {(() => {
            const activeFolders = folders.filter(f => f.status === 'active' || (f.status === 'partial' && (f.assignedCount || 0) < (f.workCount || 1)));
            return <h4 style={{...styles.waitingTitle, margin:0}}>📦 대기목록 ({waitingList.length}명{activeFolders.length > 0 ? ` + ${activeFolders.length}폴더` : ''})</h4>;
          })()}
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            <button onClick={handleCreateFolder} style={{padding:'6px 12px',background:'#8b5cf6',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>
              📁 폴더만들기
            </button>
            <button onClick={handleLoadFromEvents} style={{padding:'6px 12px',background:'#3b82f6',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>
              🔍 불러오기
            </button>
            <button onClick={handleAddExtraWork} style={{padding:'6px 12px',background:'#f97316',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',cursor:'pointer'}}>
              ➕ 추가업무
            </button>
          </div>
        </div>
        {(() => {
          const activeFolders = folders.filter(f => f.status === 'active' || (f.status === 'partial' && (f.assignedCount || 0) < (f.workCount || 1)));
          return isMobile && (waitingList.length > 0 || activeFolders.length > 0) && (
            <div style={{fontSize:'11px',color:'#666',marginBottom:'8px',textAlign:'center'}}>
              💡 카드를 <b>0.3초 길게 누르면</b> 드래그 가능
            </div>
          );
        })()}
        
        {/* 폴더 카드들 (active + 부분배정) */}
        {(() => {
          const activeFolders = folders.filter(f => f.status === 'active' || (f.status === 'partial' && (f.assignedCount || 0) < (f.workCount || 1)));
          if (activeFolders.length === 0) return null;
          
          // 폴더별 남은 회차 카드 생성
          const folderCards = [];
          activeFolders.forEach(folder => {
            const wc = folder.workCount || 1;
            const ac = folder.assignedCount || 0;
            const wp = folder.workPrices || [];
            
            for (let i = ac; i < wc; i++) {
              const roundPrice = (wp[i] !== undefined && wp[i] !== null) ? wp[i] : Math.round((folder.totalPrice || 0) / wc);
              folderCards.push({
                ...folder,
                _roundIndex: i,
                _roundLabel: wc > 1 ? ` (${i + 1}/${wc})` : '',
                _roundPrice: roundPrice,
                _isMulti: wc > 1
              });
            }
          });
          
          return folderCards.length > 0 && (
            <div style={{marginBottom:'12px'}}>
              <div style={{fontSize:'12px',color:'#8b5cf6',marginBottom:'6px',fontWeight:'bold'}}>📁 폴더</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
                {folderCards.map((fc, idx) => (
                  <div
                    key={`${fc.id}_${fc._roundIndex}`}
                    onClick={() => handleFolderCardClick(fc, fc._roundIndex)}
                    style={{
                      backgroundColor: '#ede9fe',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      borderLeft: '4px solid #8b5cf6',
                      minWidth: '120px'
                    }}
                  >
                    <div style={{fontWeight:'bold',fontSize:'13px',color:'#5b21b6'}}>📁 {fc.name}{fc._roundLabel}</div>
                    <div style={{fontSize:'11px',color:'#7c3aed',marginTop:'4px'}}>
                      {fc.customerIds?.length || 0}명 | {(fc._roundPrice).toLocaleString()}원
                    </div>
                    {fc.coWorkers?.length > 0 && (
                      <div style={{fontSize:'10px',color:'#a78bfa',marginTop:'2px'}}>
                        👥 공동 {fc.coWorkers.length}명
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        
        <div ref={waitingRef} style={styles.waitingList}>
          {(() => {
            const activeFolders = folders.filter(f => f.status === 'active' || (f.status === 'partial' && (f.assignedCount || 0) < (f.workCount || 1)));
            if (waitingList.length === 0 && activeFolders.length === 0) {
              return <div style={styles.emptyWaiting}>배정 대기 없음</div>;
            } else if (waitingList.length === 0) {
              return <div style={{...styles.emptyWaiting, color:'#8b5cf6'}}>개별 대기 없음 (폴더만 있음)</div>;
            } else {
              // 개별 카드로 표시 (인원수 무관)
              return waitingList.map(c => {
                const isExtraWork = c.isExtraWork || c.id?.startsWith('extra_');
                const borderColor = isExtraWork ? '#f97316' : (c.isSpecial ? '#f59e0b' : (c.unpaid > 0 ? '#dc2626' : '#3b82f6'));
              
              // 모바일 터치 핸들러
              let pressTimer = null;
              const handleTouchStart = (e) => {
                if (!isMobile) return;
                const touch = e.touches[0];
                const startX = touch.clientX;
                const startY = touch.clientY;
                
                pressTimer = setTimeout(() => {
                  // 길게 누르면 드래그 시작
                  startMobileDrag(c, touch.clientX, touch.clientY, null);
                }, 300);
                
                // 움직이면 취소
                const handleMove = (ev) => {
                  const moveX = Math.abs(ev.touches[0].clientX - startX);
                  const moveY = Math.abs(ev.touches[0].clientY - startY);
                  if (moveX > 10 || moveY > 10) {
                    clearTimeout(pressTimer);
                  }
                };
                const handleEnd = () => {
                  clearTimeout(pressTimer);
                  document.removeEventListener('touchmove', handleMove);
                  document.removeEventListener('touchend', handleEnd);
                };
                document.addEventListener('touchmove', handleMove);
                document.addEventListener('touchend', handleEnd);
              };
              
              return (
                <div
                  key={c.id}
                  className="waiting-card fc-event"
                  style={{
                    ...styles.waitingCard,
                    borderLeft: `3px solid ${borderColor}`,
                    opacity: (c.isCharged === false && !isExtraWork) ? 0.6 : 1,
                    backgroundColor: isExtraWork ? '#fff7ed' : '#f8fafc'
                  }}
                  data-event={JSON.stringify({
                    title: c.displayName || c.name || c.title,
                    extendedProps: { 
                      customerCode: c.isSpecial ? c.customerId : (isExtraWork ? c.extraWorkId : (c.originalId || c.id)), 
                      price: c.price ?? (isExtraWork ? 0 : (c.isSpecial ? 0 : getTotalPrice(c))),
                      priceOverride: c.priceOverride || 0,
                      isSpecial: c.isSpecial || false,
                      isExtraWork: isExtraWork,
                      extraWorkId: c.extraWorkId,
                      category: c.category,
                      workType: isExtraWork ? 'extra' : (c.isSpecial ? 'special' : 'regular'),
                      unpaid: c.unpaid || 0,
                      currentIndex: c.currentIndex || 0,
                      totalCount: c.totalCount || 1,
                      isCharged: c.isCharged !== false
                    }
                  })}
                  onClick={() => !mobileDragItem && handleWaitingCardClick(c)}
                  onTouchStart={handleTouchStart}
                >
                  <div style={styles.waitingCardTitle}>
                    {c.unpaid > 0 && !isExtraWork && <span style={{color:'#dc2626'}}>💰 </span>}
                    {c.isCharged === false && !isExtraWork && <span style={{color:'#94a3b8'}}>🆓 </span>}
                    {isExtraWork && <span style={{color:'#f97316'}}>📝 </span>}
                    {c.displayName || c.name || c.title}
                    {c.isSpecial && <span style={styles.specialBadge}>🌟</span>}
                    {isExtraWork && <span style={{fontSize:'9px',color:'#f97316',marginLeft:'3px'}}>[{c.category}]</span>}
                    {c.isOnetimeStaff && <span style={{fontSize:'9px',background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:'4px',marginLeft:'3px',fontWeight:'bold'}}>1회성</span>}
                  </div>
                  <div style={{...styles.waitingCardPrice, color: isExtraWork ? '#f97316' : (c.isCharged === false ? '#94a3b8' : '#666')}}>
                    {isExtraWork ? (c.price > 0 ? `${parseInt(c.price).toLocaleString()}원` : '무료') : (c.isCharged === false ? '무료' : `${parseInt(c.price ?? getTotalPrice(c)).toLocaleString()}원`)}
                    {c.unpaid > 0 && !isExtraWork && <span style={{color:'#dc2626', fontSize:'10px', marginLeft:'5px'}}>미수{parseInt(c.unpaid).toLocaleString()}</span>}
                  </div>
                </div>
              );
            });
            }
          })()}
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  loading: { textAlign: 'center', padding: '50px', color: '#666' },
  
  // PC 버전
  topButtons: { display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap' },
  staffSelect: { padding: '8px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '12px' },
  topBtn: { padding: '8px 12px', color: 'white', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  
  // 모바일 버전 - 한 줄로
  topButtonsMobile: { display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'nowrap', alignItems: 'center' },
  staffSelectMobile: { padding: '6px 4px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '11px', minWidth: '50px', maxWidth: '70px' },
  topBtnMobile: { padding: '6px 8px', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' },
  
  dashboard: { display: 'flex', gap: '10px', marginBottom: '15px' },
  statBox: { flex: 1, backgroundColor: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  statValue: { display: 'block', fontSize: '18px', fontWeight: 'bold' },
  statLabel: { fontSize: '11px', color: '#666' },
  
  calendarContainer: { backgroundColor: 'white', borderRadius: '10px', padding: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', marginBottom: '15px' },
  
  autoAssignBtn: { width: '100%', padding: '12px', backgroundColor: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '15px' },
  
  waitingSection: { backgroundColor: 'white', borderRadius: '10px', padding: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' },
  waitingTitle: { margin: '0 0 10px 0', fontSize: '14px', color: '#374151' },
  waitingList: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  emptyWaiting: { color: '#999', fontSize: '13px', padding: '10px' },
  
  waitingFolder: { backgroundColor: '#fef3c7', padding: '15px 25px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', fontWeight: 'bold' },
  folderIcon: { fontSize: '24px', marginBottom: '5px' },
  
  waitingCard: { backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: '6px', cursor: 'grab', minWidth: '100px', userSelect: 'none', touchAction: 'none' },
  waitingCardTitle: { fontWeight: 'bold', fontSize: '13px', marginBottom: '3px' },
  waitingCardPrice: { fontSize: '11px', color: '#666' },
  specialBadge: { marginLeft: '5px' },
  
  // 모바일 드래그 스크롤 영역
  scrollZoneTop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '60px',
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    zIndex: 9999
  },
  scrollZoneBottom: {
    position: 'fixed',
    bottom: '70px',
    left: 0,
    right: 0,
    height: '60px',
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    zIndex: 9999
  }
};

// CSS for popup buttons and draggable
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .popup-btn {
    display: block;
    width: 100%;
    padding: 12px;
    margin-top: 8px;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
  }
  .popup-btn:hover {
    opacity: 0.9;
  }
  .waiting-card {
    touch-action: none;
    user-select: none;
  }
  .waiting-card:active {
    cursor: grabbing;
    opacity: 0.8;
    transform: scale(1.02);
  }
  .fc-event-dragging {
    opacity: 0.7;
  }
  
  /* 모바일 캘린더 헤더 - 한 줄로 */
  @media (max-width: 768px) {
    .mobile-calendar .fc-toolbar {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 5px !important;
      flex-wrap: nowrap !important;
    }
    .mobile-calendar .fc-toolbar-chunk {
      display: flex !important;
      align-items: center !important;
    }
    .mobile-calendar .fc-toolbar-title {
      font-size: 16px !important;
      margin: 0 10px !important;
    }
    .mobile-calendar .fc-button {
      padding: 6px 12px !important;
      font-size: 14px !important;
    }
    .mobile-calendar .fc-daygrid-event {
      font-size: 10px !important;
      padding: 1px 3px !important;
    }
    .mobile-calendar .fc-daygrid-day-number {
      font-size: 12px !important;
      padding: 2px 4px !important;
    }
    .mobile-calendar .fc-col-header-cell-cushion {
      font-size: 11px !important;
    }
    .mobile-calendar .fc-daygrid-more-link {
      font-size: 10px !important;
    }
  }
`;
document.head.appendChild(styleSheet);

export default CalendarPage;
