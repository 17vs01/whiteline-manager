import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';

function CalendarPage({ currentUser, staffList }) {
  const [events, setEvents] = useState([]);
  const [waitingList, setWaitingList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthClosed, setMonthClosed] = useState(false);
  const [currentViewMode, setCurrentViewMode] = useState('self');
  const [isAdminView, setIsAdminView] = useState(false);
  // currentMonth를 문자열로 관리 (무한루프 방지)
  const [currentMonthStr, setCurrentMonthStr] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const calendarRef = useRef(null);
  const waitingRef = useRef(null);

  // 대시보드 통계
  const [stats, setStats] = useState({ expected: 0, done: 0, overtime: 0, count: 0 });

  // currentMonth를 Date 객체로 변환 (필요할 때만)
  const currentMonth = new Date(currentMonthStr + '-01');

  useEffect(() => {
    fetchData();
  }, [currentMonthStr, currentViewMode, isAdminView]);

  // 대기목록 드래그 초기화
  const draggableInstance = useRef(null);
  
  useEffect(() => {
    // 기존 인스턴스 정리
    if (draggableInstance.current) {
      draggableInstance.current.destroy();
      draggableInstance.current = null;
    }
    
    if (waitingRef.current && waitingList.length > 0 && waitingList.length < 10) {
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
    }
    
    return () => {
      if (draggableInstance.current) {
        draggableInstance.current.destroy();
        draggableInstance.current = null;
      }
    };
  }, [waitingList.length]);

  // 상태별 색상 (fetchData에서 사용하므로 먼저 정의)
  const getStatusColor = (status, isCoWork = false) => {
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
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // 고객 데이터
      const custSnap = await getDocs(collection(db, 'customers'));
      const custList = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomers(custList);

      // 이벤트 데이터
      const eventSnap = await getDocs(collection(db, 'events'));
      let eventList = eventSnap.docs.map(doc => {
        const data = doc.data();
        const isCoWork = data.isCoWork || false;
        return {
          id: doc.id,
          title: isCoWork ? `👥 ${data.title}` : data.title,
          start: data.date,
          backgroundColor: getStatusColor(data.status, isCoWork),
          borderColor: getStatusColor(data.status, isCoWork),
          extendedProps: {
            customerCode: data.customerCode,
            price: data.price || 0,
            status: data.status || '배정',
            staffId: data.staffId,
            staffName: data.staffName,
            completedBy: data.completedBy || '',
            phone: data.phone,
            address: data.address,
            isCoWork: isCoWork,
            parentEventId: data.parentEventId || null,
            coWorkPrice: data.coWorkPrice || 0
          }
        };
      });

      // 뷰 모드에 따른 필터링
      if (!isAdminView && currentViewMode !== 'admin') {
        const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
        eventList = eventList.filter(e => e.extendedProps.staffId === targetStaffId);
      }

      setEvents(eventList);

      // 대기목록 (해당 월 작업월인 고객 중 미배정)
      const month = currentMonth.getMonth() + 1;
      const assignedCodes = eventList.map(e => e.extendedProps.customerCode);
      
      let waiting = custList.filter(c => {
        if (c.status === '해약' || c.custStatus === '해약' || c.custStatus === '삭제') return false;
        
        // workMonths가 배열인지 확인
        let workMonths = c.workMonths;
        if (!Array.isArray(workMonths)) {
          workMonths = [1,2,3,4,5,6,7,8,9,10,11,12];
        }
        
        if (!workMonths.includes(month)) return false;
        if (assignedCodes.includes(c.id)) return false;
        
        // 뷰 모드에 따른 필터링
        if (!isAdminView && currentViewMode !== 'admin') {
          const targetStaffId = currentViewMode === 'self' ? currentUser.id : currentViewMode;
          const staffName = staffList.find(s => s.visibleId === targetStaffId)?.name;
          if (c.staffName && c.staffName !== staffName) return false;
        }
        return true;
      });

      // 특별작업 대기목록
      const specialSnap = await getDocs(collection(db, 'specialWorks'));
      const specialList = specialSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), isSpecial: true }));
      waiting = [...waiting, ...specialList.filter(s => !assignedCodes.includes(s.customerId))];

      setWaitingList(waiting);

      // 월마감 상태 확인
      const closeSnap = await getDocs(query(
        collection(db, 'monthClose'),
        where('year', '==', currentMonth.getFullYear()),
        where('month', '==', currentMonth.getMonth() + 1),
        where('staffId', '==', currentUser.id)
      ));
      setMonthClosed(closeSnap.docs.length > 0);

      // 대시보드 업데이트
      updateDashboard(eventList);

    } catch (error) {
      console.error('Error:', error);
    }
    setLoading(false);
  };

  const updateDashboard = (eventList) => {
    let expected = 0, done = 0, overtime = 0;
    eventList.forEach(e => {
      const price = parseInt(e.extendedProps.price) || 0;
      expected += price;
      if (['완료', '야근', '마감완료'].includes(e.extendedProps.status)) {
        done += price;
      }
      if (e.extendedProps.status === '야근') {
        overtime++;
      }
    });
    setStats({ expected, done, overtime, count: eventList.length });
  };

  // 이벤트 클릭
  const handleEventClick = (info) => {
    const event = info.event;
    const props = event.extendedProps;
    const isCoWork = props.isCoWork || false;
    
    let statusBtns = '';
    if (monthClosed) {
      statusBtns = '<div style="color:#64748b; padding:10px;">🔒 월마감 완료 - 수정 불가</div>';
    } else if (isCoWork) {
      // 공동작업자 이벤트는 완료 버튼 없음
      statusBtns = `
        <div style="color:#8b5cf6; padding:10px; background:#f3e8ff; border-radius:8px; margin-bottom:10px;">
          👥 공동작업 - 담당자(${props.mainStaffName || '?'})가 완료하면 자동 완료됩니다
        </div>
        <button onclick="window.deletePlan('${event.id}', '${props.customerCode}', true)" class="popup-btn" style="background:#ef4444">🗑️ 배정취소</button>
      `;
    } else {
      if (props.status === '배정') {
        statusBtns = `
          <button onclick="window.changeStatus('${event.id}', '완료')" class="popup-btn" style="background:#059669">✅ 완료</button>
          <button onclick="window.changeStatus('${event.id}', '야근')" class="popup-btn" style="background:#7e22ce">🌙 야근</button>
        `;
      } else {
        statusBtns = `<button onclick="window.cancelComplete('${event.id}')" class="popup-btn" style="background:#f59e0b">↩️ 완료취소</button>`;
      }
      statusBtns += `
        <button onclick="window.openDateChange('${event.id}', '${event.startStr}')" class="popup-btn" style="background:#6366f1">📅 일정변경</button>
        <button onclick="window.deletePlan('${event.id}', '${props.customerCode}', false)" class="popup-btn" style="background:#ef4444">🗑️ 배정취소</button>
      `;
    }

    Swal.fire({
      title: event.title,
      html: `
        <div style="text-align:left; padding:10px; background:${isCoWork ? '#f3e8ff' : '#f8fafc'}; border-radius:8px; margin-bottom:15px;">
          ${isCoWork ? '<div style="color:#8b5cf6; font-weight:bold; margin-bottom:5px;">👥 공동작업</div>' : ''}
          <div>📍 ${props.address || '-'}</div>
          <div>📞 ${props.phone || '-'}</div>
          <div>💰 ${parseInt(props.price || 0).toLocaleString()}원${isCoWork ? ' (공동작업비)' : ''}</div>
          <div>👤 담당: ${props.staffName || '-'}</div>
          ${isCoWork && props.mainStaffName ? `<div>👤 주담당: ${props.mainStaffName}</div>` : ''}
          <div>📋 상태: <b style="color:${getStatusColor(props.status, isCoWork)}">${props.status}</b></div>
          ${props.completedBy ? `<div>✅ 완료자: ${props.completedBy}</div>` : ''}
        </div>
        ${statusBtns}
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
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
    }

    try {
      // 담당자 이벤트 업데이트
      await updateDoc(doc(db, 'events', eventId), { 
        status, 
        completedBy,
        completedAt: new Date().toISOString()
      });
      
      // 공동작업자 이벤트도 같이 업데이트 (parentEventId로 연결된 것)
      const eventSnap = await getDocs(collection(db, 'events'));
      const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);
      
      for (const coWorkDoc of coWorkEvents) {
        await updateDoc(doc(db, 'events', coWorkDoc.id), {
          status,
          completedBy: completedBy + ' (담당자)',
          completedAt: new Date().toISOString()
        });
      }
      
      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: `${status} 처리됨` });
      
      fetchData();
    } catch (error) {
      Swal.fire('오류', '상태 변경 실패', 'error');
    }
  };

  // 완료 취소
  window.cancelComplete = async (eventId) => {
    Swal.close();
    try {
      // 담당자 이벤트 취소
      await updateDoc(doc(db, 'events', eventId), { status: '배정', completedBy: '', completedAt: '' });
      
      // 공동작업자 이벤트도 같이 취소
      const eventSnap = await getDocs(collection(db, 'events'));
      const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);
      
      for (const coWorkDoc of coWorkEvents) {
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

  // 일정 변경
  window.openDateChange = (eventId, currentDate) => {
    Swal.close();
    Swal.fire({
      title: '📅 일정 변경',
      html: `<div style="margin-bottom:10px;">현재: ${currentDate}</div>
             <input type="date" id="swal-new-date" class="swal2-input" value="${currentDate}">`,
      showCancelButton: true, confirmButtonText: '변경', cancelButtonText: '취소',
      preConfirm: () => document.getElementById('swal-new-date').value
    }).then(async (r) => {
      if (r.isConfirmed && r.value && r.value !== currentDate) {
        try {
          // 담당자 이벤트 날짜 변경
          await updateDoc(doc(db, 'events', eventId), { date: r.value });
          
          // 공동작업자 이벤트도 같이 날짜 변경
          const eventSnap = await getDocs(collection(db, 'events'));
          const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);
          
          for (const coWorkDoc of coWorkEvents) {
            await updateDoc(doc(db, 'events', coWorkDoc.id), { date: r.value });
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
  window.deletePlan = async (eventId, customerCode, isCoWorkOnly = false) => {
    Swal.close();
    const result = await Swal.fire({
      title: '배정 취소',
      text: isCoWorkOnly ? '공동작업 배정을 취소합니다' : '대기목록으로 이동합니다',
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
          const eventSnap = await getDocs(collection(db, 'events'));
          const coWorkEvents = eventSnap.docs.filter(d => d.data().parentEventId === eventId);
          
          // 공동작업자 이벤트 먼저 삭제
          for (const coWorkDoc of coWorkEvents) {
            await deleteDoc(doc(db, 'events', coWorkDoc.id));
          }
          
          // 담당자 이벤트 삭제
          await deleteDoc(doc(db, 'events', eventId));
        }
        
        const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        toast.fire({ icon: 'success', title: '대기목록으로 이동됨' });
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  // 드래그로 배정
  const handleEventReceive = async (info) => {
    if (monthClosed) {
      info.revert();
      Swal.fire('월마감 완료', '배정이 불가합니다', 'warning');
      return;
    }

    const eventData = info.event.extendedProps;
    const customer = customers.find(c => c.id === eventData.customerCode);
    
    if (!customer) {
      info.revert();
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
      // 담당자 이벤트 생성
      const mainEventRef = await addDoc(collection(db, 'events'), {
        title: customer.name,
        date: info.event.startStr,
        customerCode: customer.id,
        price: customer.price || getTotalPrice(customer),
        status: '배정',
        staffId: targetStaffId,
        staffName: targetStaffName,
        phone: customer.phone,
        address: customer.address,
        isCoWork: false,
        createdAt: new Date().toISOString()
      });

      // 공동작업자가 있으면 공동작업자 이벤트도 생성
      if (customer.coWorker?.enabled && customer.coWorker?.staffName) {
        const coWorkerStaff = staffList.find(s => s.name === customer.coWorker.staffName);
        if (coWorkerStaff) {
          await addDoc(collection(db, 'events'), {
            title: customer.name,
            date: info.event.startStr,
            customerCode: customer.id,
            price: customer.coWorker.price || 0,
            coWorkPrice: customer.coWorker.price || 0,
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

      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
      toast.fire({ icon: 'success', title: '배정 완료' });
      fetchData();
    } catch (error) {
      info.revert();
      Swal.fire('오류', '배정 실패', 'error');
    }
  };

  const getTotalPrice = (c) => {
    if (c.services && c.services.length > 0) {
      return c.services.reduce((sum, s) => sum + (s.price || 0), 0);
    }
    return c.price || 0;
  };

  // 날짜 클릭 (빈 날짜)
  const handleDateClick = (info) => {
    if (monthClosed) {
      Swal.fire('월마감 완료', '배정이 불가합니다', 'warning');
      return;
    }

    if (waitingList.length === 0) {
      Swal.fire('대기목록 없음', '배정할 고객이 없습니다', 'info');
      return;
    }

    // 대기목록에서 선택
    let options = waitingList.slice(0, 20).map(c => 
      `<option value="${c.id}">${c.name || c.title} (${parseInt(getTotalPrice(c)).toLocaleString()}원)</option>`
    ).join('');

    Swal.fire({
      title: `${info.dateStr} 배정`,
      html: `<select id="swal-customer" class="swal2-input">${options}</select>`,
      showCancelButton: true,
      confirmButtonText: '배정',
      cancelButtonText: '취소',
      preConfirm: () => document.getElementById('swal-customer').value
    }).then(async (r) => {
      if (r.isConfirmed && r.value) {
        const customer = waitingList.find(c => c.id === r.value);
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
          // 담당자 이벤트 생성
          const mainEventRef = await addDoc(collection(db, 'events'), {
            title: customer.name || customer.title,
            date: info.dateStr,
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

          // 공동작업자가 있으면 공동작업자 이벤트도 생성
          if (customer.coWorker?.enabled && customer.coWorker?.staffName) {
            const coWorkerStaff = staffList.find(s => s.name === customer.coWorker.staffName);
            if (coWorkerStaff) {
              await addDoc(collection(db, 'events'), {
                title: customer.name || customer.title,
                date: info.dateStr,
                customerCode: customer.id,
                price: customer.coWorker.price || 0,
                coWorkPrice: customer.coWorker.price || 0,
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

          fetchData();
        } catch (error) {
          Swal.fire('오류', '배정 실패', 'error');
        }
      }
    });
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

      // 미완료 체크
      const incomplete = events.filter(e => !['완료', '야근', '마감완료'].includes(e.extendedProps.status));
      if (incomplete.length > 0 || waitingList.length > 0) {
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

  // 익월 자동 배정 (스케줄 복사)
  const handleCopyNextMonth = async () => {
    if (!monthClosed) {
      Swal.fire('월마감 필요', '월마감 후 복사가 가능합니다', 'warning');
      return;
    }

    const nextMonth = currentMonth.getMonth() + 2 > 12 ? 1 : currentMonth.getMonth() + 2;
    const nextYear = currentMonth.getMonth() + 2 > 12 ? currentMonth.getFullYear() + 1 : currentMonth.getFullYear();

    const result = await Swal.fire({
      title: '🚀 익월 자동 배정',
      html: `
        <div style="text-align:left; padding:10px; background:#f8fafc; border-radius:8px;">
          <div style="margin-bottom:10px;"><b>${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월</b> → <b>${nextYear}년 ${nextMonth}월</b></div>
          <div style="font-size:12px; color:#666;">
            ✅ 정기 고객만 복사<br>
            ✅ 같은 주차 + 같은 요일로 배정<br>
            ❌ 해약 고객 제외<br>
            ❌ 작업월 아닌 고객 제외
          </div>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '복사',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        let copyCount = 0;
        let skipCount = 0;

        for (const event of events) {
          const customer = customers.find(c => c.id === event.extendedProps.customerCode);
          if (!customer) { skipCount++; continue; }
          if (customer.status === '해약' || customer.custStatus === '해약') { skipCount++; continue; }
          
          let workMonths = customer.workMonths;
          if (!Array.isArray(workMonths)) {
            workMonths = [1,2,3,4,5,6,7,8,9,10,11,12];
          }
          if (!workMonths.includes(nextMonth)) { skipCount++; continue; }

          // 같은 주차 + 같은 요일 계산
          const oldDate = new Date(event.start);
          const weekOfMonth = Math.ceil(oldDate.getDate() / 7);
          const dayOfWeek = oldDate.getDay();

          // 다음 달 해당 주차, 해당 요일 찾기
          const newDate = new Date(nextYear, nextMonth - 1, 1);
          newDate.setDate(1 + (weekOfMonth - 1) * 7 + (dayOfWeek - newDate.getDay() + 7) % 7);
          
          // 다음 달을 벗어나면 마지막 주로
          if (newDate.getMonth() !== nextMonth - 1) {
            newDate.setDate(newDate.getDate() - 7);
          }

          await addDoc(collection(db, 'events'), {
            title: event.title,
            date: newDate.toISOString().split('T')[0],
            customerCode: event.extendedProps.customerCode,
            price: event.extendedProps.price,
            status: '배정',
            staffId: event.extendedProps.staffId,
            staffName: event.extendedProps.staffName,
            phone: event.extendedProps.phone,
            address: event.extendedProps.address,
            createdAt: new Date().toISOString()
          });
          copyCount++;
        }

        Swal.fire({
          title: '✅ 복사 완료',
          html: `<div style="font-size:24px; font-weight:bold; color:#059669;">${copyCount}건 복사됨</div>
                 ${skipCount > 0 ? `<div style="margin-top:10px; color:#666;">${skipCount}건 제외</div>` : ''}`,
          icon: 'success'
        });

      } catch (error) {
        Swal.fire('오류', '복사 실패', 'error');
      }
    }
  };

  // 출근 기록
  const handleClockIn = async () => {
    const result = await Swal.fire({
      title: '출근',
      text: '출근을 기록하시겠습니까?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '출근',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        await addDoc(collection(db, 'attendance'), {
          staffId: currentUser.id,
          staffName: currentUser.name,
          type: 'start',
          time: new Date().toISOString()
        });
        Swal.fire('출근 완료!', '', 'success');
      } catch (error) {
        Swal.fire('오류', '기록 실패', 'error');
      }
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

    const today = new Date().toISOString().split('T')[0];
    let buttonsHtml = `<button onclick="window.assignWaitingCard('${customer.id}')" class="popup-btn" style="background:#3b82f6">📅 날짜 배정</button>`;
    
    if (currentUser.role === 'master' && customer.isSpecial) {
      buttonsHtml += `<button onclick="window.deleteSpecialWork('${customer.id}')" class="popup-btn" style="background:#ef4444">🗑️ 삭제</button>`;
    }

    Swal.fire({
      title: customer.name || customer.title,
      html: `
        <div style="text-align:left; padding:10px; background:#f8fafc; border-radius:8px; margin-bottom:15px;">
          <div>👤 담당: ${customer.staffName || '-'}</div>
          <div>💰 금액: ${parseInt(getTotalPrice(customer)).toLocaleString()}원</div>
        </div>
        ${buttonsHtml}
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  };

  // 대기 카드 배정
  window.assignWaitingCard = (customerId) => {
    Swal.close();
    const today = new Date().toISOString().split('T')[0];
    
    Swal.fire({
      title: '📅 날짜 배정',
      html: `<input type="date" id="swal-assign-date" class="swal2-input" value="${today}">`,
      showCancelButton: true,
      confirmButtonText: '배정',
      cancelButtonText: '취소',
      preConfirm: () => document.getElementById('swal-assign-date').value
    }).then(async (r) => {
      if (r.isConfirmed && r.value) {
        const customer = waitingList.find(c => c.id === customerId);
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
          await addDoc(collection(db, 'events'), {
            title: customer.name || customer.title,
            date: r.value,
            customerCode: customer.id,
            price: getTotalPrice(customer),
            status: '배정',
            staffId: targetStaffId,
            staffName: targetStaffName,
            phone: customer.phone,
            address: customer.address,
            createdAt: new Date().toISOString()
          });
          fetchData();
        } catch (error) {
          Swal.fire('오류', '배정 실패', 'error');
        }
      }
    });
  };

  // 특별작업 삭제
  window.deleteSpecialWork = async (id) => {
    Swal.close();
    const result = await Swal.fire({
      title: '삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '삭제',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'specialWorks', id));
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  // 폴더 클릭 (10명 이상)
  const handleFolderClick = () => {
    let listHtml = '<div style="max-height:250px; overflow-y:auto;">';
    waitingList.forEach(c => {
      listHtml += `<div style="padding:8px; border-bottom:1px solid #eee; cursor:pointer;" 
        onclick="window.handleWaitingSelect('${c.id}')">
        <div style="font-weight:bold;">${c.name || c.title}</div>
        <div style="font-size:12px; color:#666;">${c.staffName || '-'} | ${parseInt(getTotalPrice(c)).toLocaleString()}원</div>
      </div>`;
    });
    listHtml += '</div>';

    Swal.fire({
      title: `📦 대기 목록 (${waitingList.length}명)`,
      html: listHtml + `
        <button onclick="window.bulkAssignAll()" class="popup-btn" style="background:#3b82f6; margin-top:15px;">📅 전체 날짜 배정</button>
        ${currentUser.role === 'master' ? `<button onclick="window.deleteAllSpecial()" class="popup-btn" style="background:#ef4444">🗑️ 특별작업 전체 삭제</button>` : ''}
      `,
      showConfirmButton: false,
      showCloseButton: true
    });
  };

  window.handleWaitingSelect = (id) => {
    Swal.close();
    const customer = waitingList.find(c => c.id === id);
    if (customer) handleWaitingCardClick(customer);
  };

  window.bulkAssignAll = () => {
    Swal.close();
    const today = new Date().toISOString().split('T')[0];

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
            await addDoc(collection(db, 'events'), {
              title: customer.name || customer.title,
              date: r.value,
              customerCode: customer.id,
              price: getTotalPrice(customer),
              status: '배정',
              staffId: targetStaffId,
              staffName: targetStaffName,
              phone: customer.phone,
              address: customer.address,
              createdAt: new Date().toISOString()
            });
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

  const handleDatesSet = (dateInfo) => {
    const d = dateInfo.start;
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // 값이 다를 때만 업데이트 (무한루프 방지)
    setCurrentMonthStr(prev => prev === monthStr ? prev : monthStr);
  };

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 상단 버튼들 */}
      <div style={styles.topButtons}>
        {currentUser.role === 'master' && (
          <>
            <select 
              value={currentViewMode} 
              onChange={handleStaffViewChange}
              style={styles.staffSelect}
            >
              <option value="self">{currentUser.name} (나)</option>
              {staffList.filter(s => s.visibleId !== currentUser.id).map(s => (
                <option key={s.id} value={s.visibleId}>{s.name}</option>
              ))}
            </select>
            <button 
              onClick={toggleAdminView}
              style={{
                ...styles.topBtn,
                backgroundColor: isAdminView ? '#dc2626' : '#7c3aed'
              }}
            >
              {isAdminView ? '⚡ 관리자모드' : '📋 전체현황'}
            </button>
          </>
        )}
        <button onClick={handleMonthClose} style={{
          ...styles.topBtn,
          backgroundColor: monthClosed ? '#64748b' : '#f59e0b'
        }}>
          {monthClosed ? '🔒 마감완료' : '🔓 월마감'}
        </button>
        <button onClick={handleClockIn} style={{...styles.topBtn, backgroundColor: '#10b981'}}>
          🏃 출근
        </button>
      </div>

      {/* 대시보드 */}
      <div style={styles.dashboard}>
        <div style={styles.statBox}>
          <span style={{...styles.statValue, color: '#3b82f6'}}>{stats.expected.toLocaleString()}</span>
          <span style={styles.statLabel}>배정금액</span>
        </div>
        <div style={styles.statBox}>
          <span style={{...styles.statValue, color: '#059669'}}>{stats.done.toLocaleString()}</span>
          <span style={styles.statLabel}>완료매출</span>
        </div>
        <div style={styles.statBox}>
          <span style={styles.statValue}>{stats.overtime}/{stats.count}</span>
          <span style={styles.statLabel}>야근/건수</span>
        </div>
      </div>

      {/* 캘린더 */}
      <div style={styles.calendarContainer}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale="ko"
          headerToolbar={{
            left: 'prev',
            center: 'title',
            right: 'next'
          }}
          events={events}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          eventReceive={handleEventReceive}
          datesSet={handleDatesSet}
          droppable={true}
          height="auto"
          dayMaxEvents={3}
          eventDisplay="block"
        />
      </div>

      {/* 익월 복사 버튼 (관리자만) */}
      {currentUser.role === 'master' && monthClosed && (
        <button onClick={handleCopyNextMonth} style={styles.copyBtn}>
          🚀 익월 자동 배정
        </button>
      )}

      {/* 대기목록 */}
      <div style={styles.waitingSection}>
        <h4 style={styles.waitingTitle}>📦 대기목록 ({waitingList.length}명)</h4>
        <div ref={waitingRef} style={styles.waitingList}>
          {waitingList.length === 0 ? (
            <div style={styles.emptyWaiting}>배정 대기 없음</div>
          ) : waitingList.length >= 10 ? (
            // 10명 이상: 폴더
            <div style={styles.waitingFolder} onClick={handleFolderClick}>
              <div style={styles.folderIcon}>📦</div>
              <div>{waitingList.length}명 대기</div>
            </div>
          ) : (
            // 10명 미만: 개별 카드
            waitingList.map(c => (
              <div
                key={c.id}
                className="waiting-card"
                style={{
                  ...styles.waitingCard,
                  borderLeft: c.isSpecial ? '3px solid #f59e0b' : '3px solid #3b82f6'
                }}
                data-event={JSON.stringify({
                  title: c.name || c.title,
                  extendedProps: { customerCode: c.id, price: getTotalPrice(c) }
                })}
                onClick={() => handleWaitingCardClick(c)}
              >
                <div style={styles.waitingCardTitle}>
                  {c.name || c.title}
                  {c.isSpecial && <span style={styles.specialBadge}>🌟</span>}
                </div>
                <div style={styles.waitingCardPrice}>{parseInt(getTotalPrice(c)).toLocaleString()}원</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  loading: { textAlign: 'center', padding: '50px', color: '#666' },
  
  topButtons: { display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap' },
  staffSelect: { padding: '8px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '12px' },
  topBtn: { padding: '8px 12px', color: 'white', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  
  dashboard: { display: 'flex', gap: '10px', marginBottom: '15px' },
  statBox: { flex: 1, backgroundColor: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  statValue: { display: 'block', fontSize: '18px', fontWeight: 'bold' },
  statLabel: { fontSize: '11px', color: '#666' },
  
  calendarContainer: { backgroundColor: 'white', borderRadius: '10px', padding: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', marginBottom: '15px' },
  
  copyBtn: { width: '100%', padding: '12px', backgroundColor: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '15px' },
  
  waitingSection: { backgroundColor: 'white', borderRadius: '10px', padding: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' },
  waitingTitle: { margin: '0 0 10px 0', fontSize: '14px', color: '#374151' },
  waitingList: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  emptyWaiting: { color: '#999', fontSize: '13px', padding: '10px' },
  
  waitingFolder: { backgroundColor: '#fef3c7', padding: '15px 25px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', fontWeight: 'bold' },
  folderIcon: { fontSize: '24px', marginBottom: '5px' },
  
  waitingCard: { backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: '6px', cursor: 'grab', minWidth: '100px' },
  waitingCardTitle: { fontWeight: 'bold', fontSize: '13px', marginBottom: '3px' },
  waitingCardPrice: { fontSize: '11px', color: '#666' },
  specialBadge: { marginLeft: '5px' }
};

// CSS for popup buttons
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
`;
document.head.appendChild(styleSheet);

export default CalendarPage;
