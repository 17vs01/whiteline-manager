// =============================================
// 스케쥴러 월간 뷰
// =============================================
import React, { useMemo } from 'react';
import { EVENT_TYPES } from './schedulerConstants';

const S = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#e5e7eb' },
  dayHeader: {
    background: '#f8fafc', padding: '6px 0', textAlign: 'center',
    fontSize: 12, fontWeight: 'bold', color: '#6b7280',
  },
  cell: (isToday, isOtherMonth) => ({
    background: isToday ? '#eff6ff' : 'white',
    minHeight: 64, padding: '3px 2px', cursor: 'pointer',
    opacity: isOtherMonth ? 0.4 : 1,
    borderTop: isToday ? '2px solid #3b82f6' : 'none',
  }),
  dateNum: (isToday, isSun, isSat) => ({
    fontSize: 11, fontWeight: isToday ? 'bold' : 'normal',
    color: isToday ? '#3b82f6' : isSun ? '#ef4444' : isSat ? '#3b82f6' : '#374151',
    marginBottom: 3,
  }),
  eventChip: (color) => ({
    fontSize: 9, padding: '1px 3px', borderRadius: 3,
    background: color + '22', color, fontWeight: 'bold',
    marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap',
    textOverflow: 'ellipsis', cursor: 'pointer',
  }),
  assignBadge: {
    fontSize: 10, padding: '1px 4px', borderRadius: 4,
    background: '#f0fdf4', color: '#059669', fontWeight: 'bold',
    marginBottom: 2, cursor: 'pointer', display:'inline-flex',
    alignItems:'center', gap:2,
  },
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

export default function SchedulerMonthView({
  yearMonth,      // 'YYYY-MM'
  scheduleEvents, // 스케쥴 이벤트 배열
  assignCounts,   // { 'YYYY-MM-DD': number } 배정 수
  onDateClick,    // (date) => void
  onEventClick,   // (event) => void
  onAssignClick,  // (date) => void
}) {
  const [year, month] = yearMonth.split('-').map(Number);
  const today = (() => { const d = new Date(); return new Date(d.getTime()+9*60*60*1000).toISOString().split('T')[0]; })();

  // 달력 날짜 배열 생성
  const cells = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay  = new Date(year, month, 0);
    const startOffset = firstDay.getDay(); // 0=일요일
    const result = [];

    // 이전 달 날짜
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, -i);
      result.push({ date: d.toISOString().split('T')[0], otherMonth: true });
    }
    // 이번 달
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      result.push({ date, otherMonth: false });
    }
    // 다음 달 (6주 채우기)
    const remaining = 42 - result.length;
    for (let d = 1; d <= remaining; d++) {
      const nd = new Date(year, month, d);
      result.push({ date: nd.toISOString().split('T')[0], otherMonth: true });
    }
    return result;
  }, [year, month]);

  // 날짜별 이벤트 맵
  const eventMap = useMemo(() => {
    const map = {};
    scheduleEvents.forEach(ev => {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
  }, [scheduleEvents]);

  return (
    <div>
      {/* 요일 헤더 */}
      <div style={S.grid}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{ ...S.dayHeader, color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#6b7280' }}>
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div style={S.grid}>
        {cells.map(({ date, otherMonth }, idx) => {
          const isToday   = date === today;
          const dayOfWeek = idx % 7;
          const isSun     = dayOfWeek === 0;
          const isSat     = dayOfWeek === 6;
          const dayNum    = parseInt(date.split('-')[2]);
          const dayEvents = eventMap[date] || [];
          const count     = assignCounts?.[date] || 0;
          const MAX_SHOW  = 2;

          return (
            <div
              key={date}
              style={S.cell(isToday, otherMonth)}
              onClick={() => !otherMonth && onDateClick(date)}
            >
              <div style={S.dateNum(isToday, isSun, isSat)}>
                {isToday ? (
                  <span style={{ background: '#3b82f6', color: 'white', borderRadius: '50%', padding: '1px 5px' }}>
                    {dayNum}
                  </span>
                ) : dayNum}
              </div>

              {/* 배정플랜 배지 */}
              {count > 0 && !otherMonth && (
                <div style={S.assignBadge} onClick={e => { e.stopPropagation(); onAssignClick && onAssignClick(date); }}>
                  👥{count}
                </div>
              )}

              {/* 스케쥴 이벤트 칩 */}
              {dayEvents.slice(0, MAX_SHOW).map(ev => {
                const info = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
                const isShared = ev.isShared;
                return (
                  <div
                    key={ev.id}
                    style={{ ...S.eventChip(isShared ? '#0891b2' : info.color), opacity: isShared ? 0.8 : 1 }}
                    onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                  >
                    {info.icon} {ev.title || info.label}
                    {isShared && ' 👥'}
                  </div>
                );
              })}
              {dayEvents.length > MAX_SHOW && !otherMonth && (
                <div style={{ fontSize: 10, color: '#94a3b8' }}>
                  +{dayEvents.length - MAX_SHOW}개 더
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
