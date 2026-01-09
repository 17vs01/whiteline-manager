import React, { useState, useEffect } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

function Calendar() {
  const [events, setEvents] = useState([]);
  const [customers, setCustomers] = useState([]);

  // 데이터 불러오기
  const fetchData = async () => {
    try {
      // 일정 불러오기
      const eventSnapshot = await getDocs(collection(db, 'events'));
      const eventList = eventSnapshot.docs.map(doc => ({
        id: doc.id,
        title: doc.data().customerName || '고객',
        start: doc.data().date,
        backgroundColor: doc.data().status === '완료' ? '#22c55e' : '#3b82f6',
        extendedProps: { ...doc.data() }
      }));
      setEvents(eventList);

      // 고객 불러오기
      const custSnapshot = await getDocs(collection(db, 'customers'));
      const custList = custSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCustomers(custList);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 날짜 클릭 - 일정 추가
  const handleDateClick = async (info) => {
    if (customers.length === 0) {
      Swal.fire('알림', '먼저 고객을 등록해주세요!', 'info');
      return;
    }

    const customerOptions = customers.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join('');

    const { value: formValues } = await Swal.fire({
      title: '일정 추가',
      html:
        `<p style="margin-bottom:10px;">📅 ${info.dateStr}</p>` +
        `<select id="swal-customer" class="swal2-select" style="width:100%;padding:10px;margin-bottom:10px;">
          <option value="">-- 고객 선택 --</option>
          ${customerOptions}
        </select>` +
        `<select id="swal-status" class="swal2-select" style="width:100%;padding:10px;">
          <option value="배정">배정</option>
          <option value="완료">완료</option>
        </select>`,
      showCancelButton: true,
      confirmButtonText: '추가',
      cancelButtonText: '취소',
      preConfirm: () => {
        const customerId = document.getElementById('swal-customer').value;
        const customer = customers.find(c => c.id === customerId);
        return {
          customerId: customerId,
          customerName: customer ? customer.name : '',
          status: document.getElementById('swal-status').value
        };
      }
    });

    if (formValues && formValues.customerId) {
      try {
        await addDoc(collection(db, 'events'), {
          date: info.dateStr,
          customerId: formValues.customerId,
          customerName: formValues.customerName,
          status: formValues.status,
          createdAt: new Date().toISOString()
        });
        Swal.fire('완료', '일정이 추가되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '추가 실패!', 'error');
      }
    }
  };

  // 이벤트 클릭 - 수정/삭제
  const handleEventClick = async (info) => {
    const event = info.event;
    const props = event.extendedProps;

    const result = await Swal.fire({
      title: event.title,
      html: `
        <p>📅 ${event.startStr}</p>
        <p>상태: ${props.status || '배정'}</p>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '완료 처리',
      denyButtonText: '삭제',
      cancelButtonText: '닫기',
      confirmButtonColor: '#22c55e',
      denyButtonColor: '#ef4444'
    });

    if (result.isConfirmed) {
      // 완료 처리
      try {
        await updateDoc(doc(db, 'events', event.id), {
          status: '완료'
        });
        Swal.fire('완료', '완료 처리되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '처리 실패!', 'error');
      }
    } else if (result.isDenied) {
      // 삭제
      try {
        await deleteDoc(doc(db, 'events', event.id));
        Swal.fire('완료', '삭제되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패!', 'error');
      }
    }
  };

  // 드래그 앤 드롭 - 날짜 변경
  const handleEventDrop = async (info) => {
    try {
      await updateDoc(doc(db, 'events', info.event.id), {
        date: info.event.startStr
      });
      Swal.fire({
        title: '이동 완료',
        icon: 'success',
        timer: 1000,
        showConfirmButton: false
      });
    } catch (error) {
      Swal.fire('오류', '이동 실패!', 'error');
      info.revert();
    }
  };

  return (
    <div style={styles.container}>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale="ko"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth'
        }}
        events={events}
        dateClick={handleDateClick}
        eventClick={handleEventClick}
        editable={true}
        eventDrop={handleEventDrop}
        height="auto"
      />
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: 'white',
    padding: '15px',
    borderRadius: '10px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
  }
};

export default Calendar;