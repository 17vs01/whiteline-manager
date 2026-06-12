// =============================================
// 스케쥴러 메인 페이지
// =============================================
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import {
  getScheduleEvents, getSharedEvents, getAllStaffEvents,
  addScheduleEvent, updateScheduleEvent,
  deleteScheduleEvent, deleteRepeatEvents,
} from './schedulerFirestore';
import { checkTodayAlarms } from '../../utils/fcmNotification';
import SchedulerMonthView from './SchedulerMonthView';
import SchedulerWeekView  from './SchedulerWeekView';
import SchedulerDayView   from './SchedulerDayView';
import SchedulerEventForm from './SchedulerEventForm';
import { EVENT_TYPES }    from './schedulerConstants';

const S = {
  container: { paddingBottom: 20 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12, padding: '0 2px',
  },
  monthLabel: { fontSize: 18, fontWeight: 'bold', color: '#1e293b' },
  navBtn: {
    background: 'none', border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '6px 12px', cursor: 'pointer', fontSize: 16, color: '#374151',
  },
  viewTabs: { display: 'flex', gap: 6, marginBottom: 12 },
  viewTab: (active) => ({
    flex: 1, padding: '8px 0', border: 'none', borderRadius: 8,
    background: active ? '#3b82f6' : '#f1f5f9',
    color: active ? 'white' : '#64748b',
    fontWeight: 'bold', fontSize: 13, cursor: 'pointer',
  }),
  addBtn: {
    position: 'fixed', bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))', right: 20, width: 52, height: 52,
    borderRadius: '50%', background: '#3b82f6', color: 'white',
    border: 'none', fontSize: 24, cursor: 'pointer', zIndex: 100,
    boxShadow: '0 4px 12px rgba(59,130,246,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  adminToggle: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, color: '#6b7280', cursor: 'pointer',
  },
};

export default function SchedulerPage({ currentUser, staffList, onNavigateToSales }) {
  const [viewMode, setViewMode]     = useState('month'); // month|week|day
  const [currentDate, setCurrentDate] = useState(new Date());
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [editEvent, setEditEvent]   = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [assignCounts, setAssignCounts] = useState({});
  const [assignCustomersMap, setAssignCustomersMap] = useState({});
  const [isAdminView, setIsAdminView] = useState(false);
  const [selectedDayForDetail, setSelectedDayForDetail] = useState(null);

  const isMaster = ['master','master1','master2'].includes(currentUser?.role);
  const staffId  = currentUser?.visibleId || currentUser?.id;

  const yearMonth = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2,'0');
    return `${y}-${m}`;
  }, [currentDate]);

  // ── 데이터 로드 ───────────────────────────────
  const loadEvents = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      let mine    = await getScheduleEvents(staffId, yearMonth);
      let shared  = await getSharedEvents(staffId, yearMonth);
      // 공유 이벤트에 isShared 플래그
      shared = shared.map(e => ({ ...e, isShared: true }));
      // 관리자 전체보기
      let all = [];
      if (isMaster && isAdminView) {
        all = await getAllStaffEvents(yearMonth);
        all = all.filter(e => e.staffId !== staffId); // 내 것 중복 제거
      }
      setScheduleEvents([...mine, ...shared, ...all]);
    } catch (e) {
      console.error('스케쥴 로드 오류:', e);
    }
    setLoading(false);
  }, [staffId, yearMonth, isMaster, isAdminView]);

  // ── 배정플랜 데이터 로드 ──────────────────────
  const loadAssignData = useCallback(async () => {
    if (!staffId) return;
    try {
      // 관리자 전체보기일 때는 staffId 조건 없이 전체 조회
      const allEvSnap = await getDocs(query(
        collection(db, 'events'),
        where('date', '>=', `${yearMonth}-01`),
        where('date', '<=', `${yearMonth}-31`),
      ));
      const custSnap = await getDocs(collection(db, 'customers'));
      const custMap  = {};
      custSnap.docs.forEach(d => { custMap[d.id] = { id: d.id, ...d.data() }; });

      const counts = {};
      const custsByDate = {};

      allEvSnap.docs.forEach(d => {
        const ev = d.data();
        // 관리자 전체보기거나 내 배정만 보기
        if (!isMaster && ev.staffId !== staffId) return;
        if (!isMaster && isAdminView === false && ev.staffId !== staffId) return;
        const date = ev.date || ev.start?.split('T')[0];
        if (!date) return;
        if (!ev.isCoWork) {
          counts[date] = (counts[date] || 0) + 1;
          if (!custsByDate[date]) custsByDate[date] = [];
          const cust = custMap[ev.customerCode] || custMap[ev.id];
          if (cust) custsByDate[date].push(cust);
        }
      });

      setAssignCounts(counts);
      setAssignCustomersMap(custsByDate);
    } catch (e) {
      console.error('배정 데이터 로드 오류:', e);
    }
  }, [staffId, yearMonth, isMaster, isAdminView]);

  useEffect(() => {
    loadEvents();
    loadAssignData();
  }, [loadEvents, loadAssignData]);

  // 오늘 일정 알림 체크
  useEffect(() => {
    if (scheduleEvents.length > 0) {
      checkTodayAlarms(scheduleEvents, (ev) => {
        Swal.fire({ toast: true, position: 'top', icon: 'info',
          title: `⏰ ${ev.title}`, text: `${ev.startTime} 일정이 곧 시작됩니다`,
          timer: 5000, showConfirmButton: false });
      });
    }
  }, [scheduleEvents]);

  // ── 네비게이션 ────────────────────────────────
  const navigate = (dir) => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      if (viewMode === 'month')     d.setMonth(d.getMonth() + dir);
      else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
      else                          d.setDate(d.getDate() + dir);
      return d;
    });
  };

  const goToday = () => setCurrentDate(new Date());

  // ── 헤더 라벨 ────────────────────────────────
  const headerLabel = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth() + 1;
    if (viewMode === 'month') return `${y}년 ${m}월`;
    if (viewMode === 'week') {
      const weekStart = getWeekStart(currentDate);
      const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      return `${weekStart.getMonth()+1}/${weekStart.getDate()} ~ ${weekEnd.getMonth()+1}/${weekEnd.getDate()}`;
    }
    return `${m}월 ${currentDate.getDate()}일`;
  }, [currentDate, viewMode]);

  // ── 이벤트 핸들러 ─────────────────────────────
  const handleDateClick = (date, time) => {
    if (viewMode === 'month' || viewMode === 'week') {
      setCurrentDate(new Date(date + 'T00:00:00'));
      setViewMode('day');
      setSelectedDayForDetail(date);
    } else {
      setSelectedDate(date);
      setSelectedTime(time || null);
      setEditEvent(null);
      setShowForm(true);
    }
  };

  const handleEventClick = (ev) => {
    setEditEvent(ev);
    setSelectedDate(ev.date);
    setShowForm(true);
  };

  const handleAssignClick = (date) => {
    const custs = assignCustomersMap[date] || [];
    if (!custs.length) return;
    const html = custs.map(c =>
      `<div style="padding:8px;background:#f8fafc;border-radius:6px;margin-bottom:6px;text-align:left;">
        <b>${c.name||c.custName}</b>
        ${c.customerStatus?.preferredTime ? `<span style="font-size:11px;color:#6b7280;margin-left:6px;">⏰${c.customerStatus.preferredTime}</span>` : ''}
        ${c.phone ? `<div style="font-size:12px;color:#94a3b8;">${c.phone}</div>` : ''}
      </div>`
    ).join('');
    Swal.fire({ title: `👥 ${date} 배정 고객`, html: `<div style="max-height:350px;overflow-y:auto;">${html}</div>`, showConfirmButton: false, showCloseButton: true });
  };

  const handleSave = async (formData) => {
    try {
      const payload = {
        ...formData,
        title: formData.type === 'holiday'
          ? `🏖️ ${formData.holiday?.reason === '직접입력' ? formData.holiday?.reasonDirect : formData.holiday?.reason || '휴무'}`
          : formData.title,
      };
      if (editEvent?.id) {
        await updateScheduleEvent(editEvent.id, payload);
      } else {
        await addScheduleEvent(payload, staffId, currentUser?.name);
      }
      setShowForm(false);
      setEditEvent(null);
      await loadEvents();

      // 영업 일정 저장 후 → 견적서 원클릭 전환 제안
      if (formData.type === 'sales' && !editEvent?.id) {
        const r = await Swal.fire({
          toast: true, position: 'bottom',
          icon: 'success',
          title: '영업 일정 저장 완료!',
          html: '<span style="font-size:12px;">견적서도 바로 작성하시겠어요?</span>',
          showConfirmButton: true,
          confirmButtonText: '📄 견적서 작성',
          showDenyButton: true,
          denyButtonText: '나중에',
          timer: 6000,
          timerProgressBar: true,
        });
        if (r.isConfirmed && onNavigateToSales) {
          onNavigateToSales('quote', {
            custName:   formData.sales?.bizName || formData.title || '',
            area:       formData.sales?.area || '',
            monthlyFee: formData.sales?.monthlyFee || 0,
            memo:       `영업 방문 (${formData.date}) → 견적 전환`,
          });
        }
      } else {
        Swal.fire({ toast: true, position: 'top', icon: 'success', title: '저장 완료', timer: 1500, showConfirmButton: false });
      }
    } catch (e) {
      Swal.fire('오류', '저장에 실패했습니다: ' + e.message, 'error');
    }
  };

  const handleDelete = async (id, repeatGroupId) => {
    try {
      if (repeatGroupId) await deleteRepeatEvents(repeatGroupId);
      else               await deleteScheduleEvent(id);
      setShowForm(false);
      setEditEvent(null);
      await loadEvents();
      Swal.fire({ toast: true, position: 'top', icon: 'success', title: '삭제 완료', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '삭제에 실패했습니다: ' + e.message, 'error');
    }
  };

  // ── 주 시작일 계산 ────────────────────────────
  const weekStart = useMemo(() => getWeekStart(currentDate), [currentDate]);

  // ── 렌더 ─────────────────────────────────────
  return (
    <div style={S.container}>
      {/* 헤더 */}
      <div style={S.header}>
        <button style={S.navBtn} onClick={() => navigate(-1)}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={S.monthLabel}>{headerLabel}</div>
          {loading && <div style={{ fontSize: 11, color: '#94a3b8' }}>불러오는 중...</div>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={{ ...S.navBtn, fontSize: 13 }} onClick={goToday}>오늘</button>
          <button style={S.navBtn} onClick={() => navigate(1)}>›</button>
        </div>
      </div>

      {/* 뷰 탭 */}
      <div style={S.viewTabs}>
        {['month','week','day'].map(v => (
          <button key={v} style={S.viewTab(viewMode === v)} onClick={() => setViewMode(v)}>
            {v === 'month' ? '월간' : v === 'week' ? '주간' : '일간'}
          </button>
        ))}
        {isMaster && (
          <label style={{ ...S.adminToggle, paddingLeft: 6 }}>
            <input type="checkbox" checked={isAdminView}
              onChange={e => setIsAdminView(e.target.checked)} />
            전체
          </label>
        )}
      </div>

      {/* 뷰 렌더 */}
      {viewMode === 'month' && (
        <SchedulerMonthView
          yearMonth={yearMonth}
          scheduleEvents={scheduleEvents}
          assignCounts={assignCounts}
          onDateClick={handleDateClick}
          onEventClick={handleEventClick}
          onAssignClick={handleAssignClick}
        />
      )}
      {viewMode === 'week' && (
        <SchedulerWeekView
          weekStart={weekStart}
          scheduleEvents={scheduleEvents}
          assignCounts={assignCounts}
          onDateClick={handleDateClick}
          onEventClick={handleEventClick}
          onAssignClick={handleAssignClick}
        />
      )}
      {viewMode === 'day' && (
        <SchedulerDayView
          date={selectedDayForDetail || currentDate.toISOString().split('T')[0]}
          scheduleEvents={scheduleEvents.filter(e =>
            e.date === (selectedDayForDetail || currentDate.toISOString().split('T')[0])
          )}
          assignCustomers={assignCustomersMap[selectedDayForDetail || currentDate.toISOString().split('T')[0]] || []}
          onTimeClick={handleDateClick}
          onEventClick={handleEventClick}
          onAssignOrderChange={() => {}}
          onAssignReset={() => {}}
        />
      )}

      {/* 새 일정 추가 버튼 */}
      <button style={S.addBtn} onClick={() => {
        const todayStr = new Date().toISOString().split('T')[0];
        setSelectedDate(viewMode === 'day' ? (selectedDayForDetail || todayStr) : todayStr);
        setEditEvent(null);
        setShowForm(true);
      }}>
        +
      </button>

      {/* 이벤트 폼 (바텀시트) */}
      {showForm && (
        <SchedulerEventForm
          event={editEvent}
          defaultDate={selectedDate || new Date().toISOString().split('T')[0]}
          staffList={staffList}
          currentUser={currentUser}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setShowForm(false); setEditEvent(null); }}
        />
      )}
    </div>
  );
}

// 주 시작일(일요일) 계산
function getWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}
