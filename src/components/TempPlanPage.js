import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import Swal from 'sweetalert2';

function TempPlanPage({ currentUser, staffList }) {
  const calendarRef = useRef(null);
  const waitingRef = useRef(null);
  const [tempEvents, setTempEvents] = useState([]);
  const [waitingList, setWaitingList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [currentYearMonth, setCurrentYearMonth] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('self');
  const [hasChanges, setHasChanges] = useState(false);
  const [savedStatus, setSavedStatus] = useState(false);

  // 권한 체크
  const isMaster = currentUser?.role === 'master';
  const isMaster1 = currentUser?.role === 'master1';
  const isMaster2 = currentUser?.role === 'master2';
  const canSelectStaff = isMaster || isMaster1;

  // 다음달 계산
  const getNextMonth = () => {
    const now = new Date();
    const nextMonth = now.getMonth() + 2; // 0-indexed이므로 +2
    const nextYear = nextMonth > 12 ? now.getFullYear() + 1 : now.getFullYear();
    const month = nextMonth > 12 ? nextMonth - 12 : nextMonth;
    return { year: nextYear, month };
  };

  // 현재 사용자 visibleId
  const getCurrentUserVisibleId = () => currentUser?.visibleId?.split('@')[0] || currentUser?.visibleId || '';

  // 대상 직원 ID
  const getTargetStaffId = () => {
    if (selectedStaffId === 'self') return getCurrentUserVisibleId();
    return selectedStaffId;
  };

  // staffId 매칭
  const matchStaffId = (eventStaffId, targetStaffId) => {
    if (!eventStaffId || !targetStaffId) return false;
    const eventId = eventStaffId.split('@')[0];
    const targetId = targetStaffId.split('@')[0];
    return eventId === targetId;
  };

  // 데이터 로드
  const fetchData = async () => {
    const { year, month } = getNextMonth();
    setCurrentYearMonth(`${year}-${String(month).padStart(2, '0')}`);

    const targetStaffId = getTargetStaffId();

    // 고객 데이터
    const custSnap = await getDocs(collection(db, 'customers'));
    const custList = custSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    setCustomers(custList);

    // 임시플랜 데이터 로드
    const tempSnap = await getDocs(query(
      collection(db, 'tempPlan'),
      where('year', '==', year),
      where('month', '==', month)
    ));
    
    const allTempPlans = tempSnap.docs
      .filter(d => {
        const data = d.data();
        return matchStaffId(data.staffVisibleId, targetStaffId) || matchStaffId(data.staffId, targetStaffId);
      })
      .map(d => ({ id: d.id, ...d.data() }));

    setSavedStatus(allTempPlans.some(t => t.saved));

    // 날짜 있는 것 → 캘린더 이벤트
    const calendarEvents = allTempPlans
      .filter(t => t.date && t.date !== '')
      .map(t => ({
        id: t.id,
        title: t.title,
        start: t.date,
        backgroundColor: t.isSpecialWork ? '#f97316' : '#3b82f6',
        borderColor: t.isSpecialWork ? '#ea580c' : '#2563eb',
        extendedProps: { ...t }
      }));

    // 날짜 없는 것 → 대기목록
    const waitingItems = allTempPlans
      .filter(t => !t.date || t.date === '')
      .map(t => ({
        ...t,
        isNew: !t.saved
      }));

    setTempEvents(calendarEvents);
    setWaitingList(waitingItems);
    setHasChanges(false);
  };

  useEffect(() => {
    if (currentUser) {
      fetchData();
    }
  }, [currentUser, selectedStaffId]);

  // 관리자 로그인 시 기본으로 첫 번째 직원 선택
  useEffect(() => {
    if (currentUser?.role === 'master' && staffList.length > 0 && selectedStaffId === 'self') {
      const firstStaff = staffList.find(s => s.role === 'staff');
      if (firstStaff) {
        setSelectedStaffId(firstStaff.visibleId);
      }
    }
  }, [currentUser, staffList]);

  // 캘린더 날짜 초기화 (다음달로)
  useEffect(() => {
    if (calendarRef.current && currentYearMonth) {
      const calendarApi = calendarRef.current.getApi();
      calendarApi.gotoDate(`${currentYearMonth}-01`);
    }
  }, [currentYearMonth]);

  // 대기목록 드래그 초기화 (DOM 렌더링 후)
  useEffect(() => {
    let draggable = null;
    
    // DOM이 준비된 후 초기화
    const timer = setTimeout(() => {
      if (waitingRef.current && !waitingRef.current._draggableInitialized) {
        draggable = new Draggable(waitingRef.current, {
          itemSelector: '.waiting-item',
          eventData: (eventEl) => {
            const data = JSON.parse(eventEl.getAttribute('data-event') || '{}');
            return {
              title: data.title,
              backgroundColor: data.isSpecialWork ? '#f97316' : '#3b82f6',
              borderColor: data.isSpecialWork ? '#ea580c' : '#2563eb',
              extendedProps: data
            };
          }
        });
        waitingRef.current._draggableInitialized = true;
      }
    }, 100);
    
    // cleanup
    return () => {
      clearTimeout(timer);
      if (draggable) {
        draggable.destroy();
      }
    };
  }, []);

  // 외부에서 캘린더로 드롭 (대기목록 → 캘린더)
  const handleEventReceive = (info) => {
    const data = info.event.extendedProps;
    const dateStr = info.event.startStr;
    
    // 이미 같은 고객이 캘린더에 있는지 체크 (중복 방지)
    const alreadyExists = tempEvents.some(e => 
      e.extendedProps?.customerId === data.customerId && 
      e.extendedProps?.isSpecialWork === data.isSpecialWork
    );
    
    if (alreadyExists) {
      info.event.remove();
      return;
    }
    
    // 대기목록에서 해당 아이템 찾아서 제거
    setWaitingList(prev => prev.filter(item => 
      item.customerId !== data.customerId || item.isSpecialWork !== data.isSpecialWork
    ));
    
    // 새 이벤트로 상태 업데이트
    const newEvent = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: data.title,
      start: dateStr,
      backgroundColor: data.isSpecialWork ? '#f97316' : '#3b82f6',
      borderColor: data.isSpecialWork ? '#ea580c' : '#2563eb',
      extendedProps: {
        ...data,
        date: dateStr
      }
    };
    
    setTempEvents(prev => [...prev, newEvent]);
    setHasChanges(true);
    
    // FullCalendar가 자동으로 추가한 이벤트 제거 (우리가 state로 관리하므로)
    info.event.remove();
  };

  // 날짜에 드롭
  const handleDateClick = async (info) => {
    // 클릭한 날짜에 대기목록 항목 추가 팝업
    if (waitingList.length === 0) {
      Swal.fire('알림', '배정할 대기 고객이 없습니다.', 'info');
      return;
    }

    const { value: selectedIdx } = await Swal.fire({
      title: `📅 ${info.dateStr}에 배정`,
      html: `
        <div style="max-height:300px; overflow-y:auto; text-align:left;">
          ${waitingList.map((item, idx) => `
            <label style="display:block; padding:10px; border-bottom:1px solid #eee; cursor:pointer;">
              <input type="radio" name="waitingItem" value="${idx}" style="margin-right:10px;">
              <span style="font-weight:bold;">${item.title}</span>
              ${item.isSpecialWork ? '<span style="color:#f97316; font-size:11px;"> 🌟특별</span>' : ''}
              ${item.isNew ? '<span style="color:#22c55e; font-size:11px;"> NEW</span>' : ''}
            </label>
          `).join('')}
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '배정',
      preConfirm: () => {
        const selected = document.querySelector('input[name="waitingItem"]:checked');
        return selected ? parseInt(selected.value) : null;
      }
    });

    if (selectedIdx !== null && selectedIdx !== undefined) {
      const item = waitingList[selectedIdx];
      
      // 새 이벤트 생성
      const newEvent = {
        id: `temp_${Date.now()}`,
        title: item.title,
        start: info.dateStr,
        backgroundColor: item.isSpecialWork ? '#f97316' : '#3b82f6',
        borderColor: item.isSpecialWork ? '#ea580c' : '#2563eb',
        extendedProps: {
          ...item,
          date: info.dateStr
        }
      };

      setTempEvents(prev => [...prev, newEvent]);
      setWaitingList(prev => prev.filter((_, idx) => idx !== selectedIdx));
      setHasChanges(true);
    }
  };

  // 이벤트 드롭 (날짜 간 이동)
  const handleEventDrop = (info) => {
    const newDate = info.event.startStr;
    const eventId = info.event.id;

    setTempEvents(prev => prev.map(e => 
      e.id === eventId 
        ? { ...e, start: newDate, extendedProps: { ...e.extendedProps, date: newDate } }
        : e
    ));
    setHasChanges(true);
  };

  // 이벤트 클릭 (배정 취소)
  const handleEventClick = async (info) => {
    const event = info.event;
    const props = event.extendedProps;

    const result = await Swal.fire({
      title: event.title,
      html: `
        <div style="text-align:left; padding:10px;">
          <p><b>날짜:</b> ${event.startStr}</p>
          <p><b>유형:</b> ${props.isSpecialWork ? '🌟 특별작업' : '📋 정기작업'}</p>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '닫기',
      denyButtonText: '🗑️ 배정취소',
      denyButtonColor: '#ef4444'
    });

    if (result.isDenied) {
      // 대기목록으로 복귀
      const waitingItem = {
        customerId: props.customerId,
        title: event.title,
        staffId: props.staffId,
        staffVisibleId: props.staffVisibleId,
        price: props.price || 0,
        workType: props.workType || 'regular',
        isSpecialWork: props.isSpecialWork || false,
        isNew: false
      };

      setWaitingList(prev => [...prev, waitingItem]);
      setTempEvents(prev => prev.filter(e => e.id !== event.id));
      setHasChanges(true);
    }
  };

  // 저장
  const handleSave = async () => {
    const { year, month } = getNextMonth();
    const targetStaffId = getTargetStaffId();

    const result = await Swal.fire({
      title: '💾 임시플랜 저장',
      html: `${year}년 ${month}월 임시플랜을 저장합니다.<br><br>
        <span style="font-size:12px; color:#666;">월마감 시 이 배정대로 플랜이 생성됩니다.</span>`,
      showCancelButton: true,
      confirmButtonText: '저장',
      confirmButtonColor: '#22c55e'
    });

    if (!result.isConfirmed) return;

    Swal.fire({
      title: '저장 중...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      // 기존 임시플랜 삭제
      const tempSnap = await getDocs(query(
        collection(db, 'tempPlan'),
        where('year', '==', year),
        where('month', '==', month)
      ));
      
      for (const d of tempSnap.docs) {
        if (matchStaffId(d.data().staffVisibleId, targetStaffId)) {
          await deleteDoc(d.ref);
        }
      }

      // 배정된 이벤트 저장
      for (const event of tempEvents) {
        const props = event.extendedProps;
        await addDoc(collection(db, 'tempPlan'), {
          year,
          month,
          customerId: props.customerId,
          title: event.title,
          date: event.start,
          staffId: props.staffId || currentUser.id,
          staffVisibleId: props.staffVisibleId || targetStaffId,
          price: props.price || 0,
          workType: props.workType || 'regular',
          isSpecialWork: props.isSpecialWork || false,
          specialType: props.specialType || '',
          saved: true,
          savedAt: new Date().toISOString()
        });
      }

      // 대기목록도 저장 (미배정 상태로)
      for (const item of waitingList) {
        await addDoc(collection(db, 'tempPlan'), {
          year,
          month,
          customerId: item.customerId,
          title: item.title,
          date: '', // 미배정
          staffId: item.staffId || currentUser.id,
          staffVisibleId: item.staffVisibleId || targetStaffId,
          price: item.price || 0,
          workType: item.workType || 'regular',
          isSpecialWork: item.isSpecialWork || false,
          specialType: item.specialType || '',
          saved: true,
          savedAt: new Date().toISOString()
        });
      }

      Swal.fire('완료', '임시플랜이 저장되었습니다.', 'success');
      setHasChanges(false);
      setSavedStatus(true);
      fetchData();

    } catch (error) {
      console.error('저장 오류:', error);
      Swal.fire('오류', '저장 실패', 'error');
    }
  };

  // 새로고침
  const handleRefresh = async () => {
    if (hasChanges) {
      const result = await Swal.fire({
        title: '⚠️ 저장되지 않은 변경사항',
        text: '새로고침하면 변경사항이 사라집니다.',
        showCancelButton: true,
        confirmButtonText: '새로고침',
        cancelButtonText: '취소'
      });
      if (!result.isConfirmed) return;
    }
    fetchData();
  };

  // 동기화 (이번달 완료 고객 → 임시플랜에 추가)
  const handleSync = async () => {
    const { year, month } = getNextMonth();
    const targetStaffId = getTargetStaffId();

    const result = await Swal.fire({
      title: '🔗 동기화',
      html: `이번 달 완료된 고객을<br>${year}년 ${month}월 임시플랜에 추가합니다.<br><br>
        <label style="display:block; margin:10px 0; cursor:pointer;">
          <input type="checkbox" id="resetCheck" style="margin-right:8px;">
          <span style="color:#ef4444;">기존 데이터 초기화 후 동기화</span>
        </label>`,
      showCancelButton: true,
      confirmButtonText: '동기화',
      confirmButtonColor: '#8b5cf6',
      preConfirm: () => {
        return document.getElementById('resetCheck')?.checked || false;
      }
    });

    if (!result.isConfirmed) return;
    
    const shouldReset = result.value;

    Swal.fire({
      title: '동기화 중...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    try {
      // 현재달 정보
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // 초기화 체크 시 기존 데이터 삭제
      if (shouldReset) {
        const existingSnap = await getDocs(query(
          collection(db, 'tempPlan'),
          where('year', '==', year),
          where('month', '==', month)
        ));
        
        for (const d of existingSnap.docs) {
          const data = d.data();
          if (matchStaffId(data.staffVisibleId, targetStaffId) || matchStaffId(data.staffId, targetStaffId)) {
            await deleteDoc(d.ref);
          }
        }
      }

      // 이번달 완료된 이벤트 가져오기
      const eventsSnap = await getDocs(collection(db, 'events'));
      const completedEvents = eventsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(e => {
          const d = new Date(e.date);
          return matchStaffId(e.staffVisibleId || e.staffId, targetStaffId) &&
                 d.getFullYear() === currentYear &&
                 d.getMonth() + 1 === currentMonth &&
                 e.status !== '배정';
        });

      // 기존 임시플랜에 있는 고객 ID
      const tempSnap = await getDocs(query(
        collection(db, 'tempPlan'),
        where('year', '==', year),
        where('month', '==', month)
      ));
      const existingCustomerIds = new Set(
        tempSnap.docs
          .filter(d => {
            const data = d.data();
            return matchStaffId(data.staffVisibleId, targetStaffId) || matchStaffId(data.staffId, targetStaffId);
          })
          .map(d => d.data().customerId)
      );

      // 고객 데이터
      const custSnap = await getDocs(collection(db, 'customers'));
      const custList = custSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const nextMonthKey = month; // 숫자로 (workMonths[1] 형식)
      let addedCount = 0;
      let skippedCount = 0;

      for (const e of completedEvents) {
        const custId = e.customerCode || e.customerId;
        
        // 이미 있으면 스킵
        if (existingCustomerIds.has(custId)) {
          skippedCount++;
          continue;
        }

        const customer = custList.find(c => c.id === custId);
        if (!customer) continue;

        // 특별작업 여부
        const isSpecial = e.isSpecialWork || e.workType === 'special';

        // 정기작업: 다음달 작업월 체크 (workMonths 객체에서)
        if (!isSpecial) {
          const workMonthData = customer.workMonths?.[nextMonthKey];
          const hasWorkMonth = workMonthData?.enabled === true || 
                               (typeof workMonthData?.count === 'number' && workMonthData.count >= 1);
          if (!hasWorkMonth) {
            continue;
          }
        }

        // 같은 주/요일 계산
        const originalDate = new Date(e.date);
        const dayOfWeek = originalDate.getDay();
        const weekOfMonth = Math.ceil(originalDate.getDate() / 7);

        let newDate = new Date(year, month - 1, 1);
        const firstDayOfWeek = newDate.getDay();
        let targetDay = (dayOfWeek - firstDayOfWeek + 7) % 7 + 1 + (weekOfMonth - 1) * 7;

        const lastDay = new Date(year, month, 0).getDate();
        let tempDate = '';

        if (targetDay > lastDay) {
          targetDay -= 7;
        }

        if (targetDay >= 1 && targetDay <= lastDay) {
          newDate.setDate(targetDay);
          tempDate = newDate.toISOString().split('T')[0];
        }

        // 임시플랜에 저장
        await addDoc(collection(db, 'tempPlan'), {
          year,
          month,
          customerId: custId,
          title: e.title,
          date: tempDate,
          staffId: targetStaffId,
          staffVisibleId: targetStaffId,
          price: e.price || customer.price || 0,
          workType: e.workType || 'regular',
          isSpecialWork: isSpecial,
          specialType: e.specialType || '',
          saved: false,
          createdAt: new Date().toISOString(),
          originalDate: e.date
        });

        existingCustomerIds.add(custId);
        addedCount++;
      }

      Swal.fire('완료', `동기화 완료!\n추가: ${addedCount}건\n건너뜀: ${skippedCount}건`, 'success');
      fetchData();

    } catch (error) {
      console.error('동기화 오류:', error);
      Swal.fire('오류', '동기화 실패', 'error');
    }
  };

  // 전체 이동 (날짜의 모든 카드)
  const handleMoveAll = async (dateStr) => {
    const dayEvents = tempEvents.filter(e => e.start === dateStr);
    if (dayEvents.length === 0) return;

    const { year, month } = getNextMonth();
    const lastDay = new Date(year, month, 0).getDate();

    const { value: newDate } = await Swal.fire({
      title: '📅 전체 이동',
      html: `${dateStr}의 ${dayEvents.length}건을 이동합니다.<br><br>
        <input type="date" id="swal-date" class="swal2-input" value="${dateStr}" 
          min="${year}-${String(month).padStart(2,'0')}-01" 
          max="${year}-${String(month).padStart(2,'0')}-${lastDay}">`,
      showCancelButton: true,
      preConfirm: () => document.getElementById('swal-date').value
    });

    if (newDate && newDate !== dateStr) {
      setTempEvents(prev => prev.map(e => 
        e.start === dateStr 
          ? { ...e, start: newDate, extendedProps: { ...e.extendedProps, date: newDate } }
          : e
      ));
      setHasChanges(true);
    }
  };

  // 스타일
  const styles = {
    container: { padding: '10px', maxWidth: '1200px', margin: '0 auto' },
    header: { 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center',
      marginBottom: '15px',
      flexWrap: 'wrap',
      gap: '10px'
    },
    title: { fontSize: '18px', fontWeight: 'bold', color: '#1f2937' },
    controls: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
    select: { padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' },
    btn: { 
      padding: '8px 16px', 
      borderRadius: '8px', 
      border: 'none', 
      cursor: 'pointer', 
      fontWeight: 'bold',
      fontSize: '13px'
    },
    statusBadge: {
      padding: '4px 12px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: 'bold'
    },
    waitingSection: {
      marginTop: '15px',
      padding: '15px',
      backgroundColor: '#f8fafc',
      borderRadius: '12px',
      border: '1px solid #e2e8f0'
    },
    waitingTitle: { 
      fontSize: '14px', 
      fontWeight: 'bold', 
      marginBottom: '10px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    waitingList: { 
      display: 'flex', 
      flexWrap: 'wrap', 
      gap: '8px',
      minHeight: '60px'
    },
    waitingCard: {
      padding: '10px 14px',
      backgroundColor: '#fff',
      borderRadius: '8px',
      border: '1px solid #e2e8f0',
      cursor: 'grab',
      fontSize: '12px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      transition: 'transform 0.2s, box-shadow 0.2s'
    },
    specialCard: {
      borderLeft: '3px solid #f97316'
    },
    newBadge: {
      backgroundColor: '#22c55e',
      color: 'white',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '9px',
      marginLeft: '5px'
    },
    calendarWrapper: {
      backgroundColor: '#fff',
      borderRadius: '12px',
      padding: '15px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }
  };

  const { year, month } = getNextMonth();

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={styles.title}>📝 {year}년 {month}월 임시플랜</span>
          <span style={{
            ...styles.statusBadge,
            backgroundColor: savedStatus ? '#dcfce7' : '#fef3c7',
            color: savedStatus ? '#166534' : '#92400e'
          }}>
            {savedStatus ? '💾 저장됨' : '⏳ 미저장'}
          </span>
          {hasChanges && (
            <span style={{
              ...styles.statusBadge,
              backgroundColor: '#fee2e2',
              color: '#dc2626'
            }}>
              ⚠️ 변경사항 있음
            </span>
          )}
        </div>

        <div style={styles.controls}>
          {/* 직원 선택 */}
          {canSelectStaff && (
            <select 
              value={selectedStaffId} 
              onChange={(e) => setSelectedStaffId(e.target.value)}
              style={styles.select}
            >
              <option value="self">👤 {currentUser.name}</option>
              {staffList.filter(s => {
                // master는 전체, master1은 master 제외, 나머지는 staff만
                if (isMaster) return s.visibleId !== getCurrentUserVisibleId();
                if (isMaster1) return s.role !== 'master' && s.visibleId !== getCurrentUserVisibleId();
                return s.role === 'staff' && s.visibleId !== getCurrentUserVisibleId();
              }).map(s => (
                <option key={s.id} value={s.visibleId}>{s.name}</option>
              ))}
            </select>
          )}

          <button 
            onClick={handleRefresh} 
            style={{...styles.btn, backgroundColor: '#3b82f6', color: 'white'}}
          >
            🔄 새로고침
          </button>

          <button 
            onClick={handleSync} 
            style={{...styles.btn, backgroundColor: '#8b5cf6', color: 'white'}}
          >
            🔗 동기화
          </button>

          <button 
            onClick={handleSave} 
            style={{
              ...styles.btn, 
              backgroundColor: hasChanges ? '#22c55e' : '#9ca3af', 
              color: 'white'
            }}
          >
            💾 저장
          </button>
        </div>
      </div>

      {/* 달력 */}
      <div style={styles.calendarWrapper}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale="ko"
          headerToolbar={false}
          height="auto"
          events={tempEvents}
          editable={true}
          droppable={true}
          dateClick={handleDateClick}
          eventDrop={handleEventDrop}
          eventClick={handleEventClick}
          eventReceive={handleEventReceive}
          dayCellDidMount={(info) => {
            info.el.addEventListener('dblclick', () => {
              handleMoveAll(info.date.toISOString().split('T')[0]);
            });
          }}
          eventContent={(eventInfo) => {
            const props = eventInfo.event.extendedProps;
            return (
              <div style={{ padding: '2px 4px', fontSize: '11px', overflow: 'hidden' }}>
                {props.isSpecialWork && <span>🌟</span>}
                {eventInfo.event.title}
              </div>
            );
          }}
        />
      </div>

      {/* 대기목록 */}
      <div style={styles.waitingSection}>
        <div style={styles.waitingTitle}>
          <span>📋 대기목록 ({waitingList.length})</span>
          <span style={{ fontSize: '11px', color: '#6b7280' }}>
            드래그하여 날짜에 배정
          </span>
        </div>
        <div ref={waitingRef} style={styles.waitingList}>
          {waitingList.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: '13px', padding: '20px', width: '100%', textAlign: 'center' }}>
              배정 대기 중인 고객이 없습니다.
            </div>
          ) : (
            waitingList.map((item, idx) => (
              <div
                key={`${item.customerId}-${idx}`}
                className="waiting-item fc-event"
                style={{
                  ...styles.waitingCard,
                  ...(item.isSpecialWork ? styles.specialCard : {}),
                  cursor: 'grab'
                }}
                data-event={JSON.stringify({
                  title: item.title,
                  customerId: item.customerId,
                  isSpecialWork: item.isSpecialWork,
                  price: item.price,
                  workType: item.workType,
                  staffId: item.staffId,
                  staffVisibleId: item.staffVisibleId,
                  specialType: item.specialType || ''
                })}
              >
                <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                  {item.isSpecialWork && <span>🌟 </span>}
                  {item.title}
                  {item.isNew && <span style={styles.newBadge}>NEW</span>}
                </div>
                <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>
                  {item.isSpecialWork ? '특별작업' : '정기작업'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 안내 */}
      <div style={{ 
        marginTop: '15px', 
        padding: '12px', 
        backgroundColor: '#f0f9ff', 
        borderRadius: '8px',
        fontSize: '12px',
        color: '#0369a1'
      }}>
        💡 <b>사용법:</b> 대기목록 카드 드래그 → 날짜에 드롭 | 캘린더 카드 클릭 → 배정취소 | 캘린더 카드 드래그 → 날짜 이동 | 날짜 더블클릭 → 전체 이동
      </div>
    </div>
  );
}

export default TempPlanPage;
