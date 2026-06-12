// =============================================
// 스케쥴러 주간 뷰
// =============================================
import React, { useMemo } from 'react';
import { EVENT_TYPES } from './schedulerConstants';

const HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 07~22시
const DAY_NAMES = ['일','월','화','수','목','금','토'];

const S = {
  container: { overflowX: 'hidden', width: '100%' },
  grid: { display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', width: '100%' },
  headerCell: (isToday) => ({
    padding: '4px 1px', textAlign: 'center', fontSize: 10, fontWeight: 'bold',
    borderBottom: '2px solid #e5e7eb', background: isToday ? '#eff6ff' : 'white',
    color: isToday ? '#3b82f6' : '#374151', position: 'sticky', top: 0, zIndex: 10,
  }),
  timeLabel: {
    fontSize: 9, color: '#94a3b8', textAlign: 'right', paddingRight: 3,
    paddingTop: 2, borderRight: '1px solid #f1f5f9',
  },
  hourCell: (isToday) => ({
    height: 36, borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9',
    position: 'relative', cursor: 'pointer',
    background: isToday ? '#fafcff' : 'transparent',
  }),
  eventBlock: (color, top, height) => ({
    position: 'absolute', left: 2, right: 2,
    top, height: Math.max(height, 20),
    background: color + 'dd', border: `1px solid ${color}`,
    borderRadius: 4, padding: '2px 4px', overflow: 'hidden',
    fontSize: 9, fontWeight: 'bold', color: 'white',
    cursor: 'pointer', zIndex: 5, boxSizing: 'border-box',
  }),
  assignChip: {
    fontSize: 9, padding: '1px 3px', background: '#d1fae5',
    color: '#059669', borderRadius: 3, fontWeight: 'bold',
    cursor: 'pointer', margin: '1px', display: 'inline-block',
  },
  allDayRow: {
    borderBottom: '1px solid #e5e7eb', minHeight: 28, display: 'flex',
    alignItems: 'center', flexWrap: 'wrap', padding: '2px',
  },
};

export default function SchedulerWeekView({
  weekStart,      // 주 시작일 (Date)
  scheduleEvents,
  assignCounts,
  onDateClick,
  onEventClick,
  onAssignClick,
}) {
  const today = (() => { const d = new Date(); return new Date(d.getTime()+9*60*60*1000).toISOString().split('T')[0]; })();

  // 7일 날짜 배열
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  }, [weekStart]);

  // 날짜별 이벤트 분류
  const { allDayMap, timedMap } = useMemo(() => {
    const allDayMap = {};
    const timedMap  = {};
    days.forEach(d => { allDayMap[d] = []; timedMap[d] = []; });
    scheduleEvents.forEach(ev => {
      if (!days.includes(ev.date)) return;
      if (ev.allDay || ev.type === 'holiday') allDayMap[ev.date].push(ev);
      else timedMap[ev.date].push(ev);
    });
    return { allDayMap, timedMap };
  }, [scheduleEvents, days]);

  const timeToMinutes = (t) => {
    const [h, m] = (t || '09:00').split(':').map(Number);
    return h * 60 + m;
  };

  const HOUR_HEIGHT = 36; // px per hour
  const START_HOUR  = 7;

  const getEventStyle = (ev) => {
    const startMin = timeToMinutes(ev.startTime);
    const endMin   = timeToMinutes(ev.endTime || ev.startTime);
    const top      = ((startMin - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const height   = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 22);
    const info     = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
    return { top, height, color: ev.isShared ? '#0891b2' : info.color, info };
  };

  return (
    <div style={S.container}>
      <div style={S.grid}>
        {/* 헤더 */}
        <div style={{ ...S.headerCell(false), borderBottom: '2px solid #e5e7eb' }} />
        {days.map((date, i) => {
          const isToday  = date === today;
          const dayNum   = parseInt(date.split('-')[2]);
          const dayName  = DAY_NAMES[new Date(date).getDay()];
          return (
            <div key={date} style={S.headerCell(isToday)} onClick={() => onDateClick(date)}>
              <div style={{ fontSize: 11, color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#6b7280' }}>{dayName}</div>
              <div style={{ fontSize: 13, fontWeight: 'bold',
                background: isToday ? '#3b82f6' : 'transparent',
                color: isToday ? 'white' : 'inherit',
                borderRadius: '50%', width: 26, height: 26,
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
              }}>
                {dayNum}
              </div>
            </div>
          );
        })}

        {/* 종일 이벤트 행 */}
        <div style={{ ...S.timeLabel, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 }}>
          <span style={{ fontSize: 9 }}>종일</span>
        </div>
        {days.map(date => (
          <div key={date + '-allday'} style={S.allDayRow}>
            {(assignCounts?.[date] || 0) > 0 && (
              <span style={S.assignChip} onClick={() => onAssignClick && onAssignClick(date)}>
                👥{assignCounts[date]}
              </span>
            )}
            {allDayMap[date].map(ev => {
              const info = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
              return (
                <span key={ev.id}
                  style={{ ...S.assignChip, background: info.color + '22', color: info.color }}
                  onClick={() => onEventClick(ev)}>
                  {info.icon} {ev.title || info.label}
                </span>
              );
            })}
          </div>
        ))}

        {/* 시간대 행 */}
        {HOURS.map(hour => (
          <React.Fragment key={hour}>
            <div style={{ ...S.timeLabel, height: HOUR_HEIGHT }}>
              {String(hour).padStart(2,'0')}:00
            </div>
            {days.map(date => (
              <div
                key={date + hour}
                style={S.hourCell(date === today)}
                onClick={() => onDateClick(date, `${String(hour).padStart(2,'0')}:00`)}
              >
                {/* 해당 시간대의 이벤트 렌더 (이 셀은 첫 시간 셀에만 그림) */}
                {hour === START_HOUR && timedMap[date].map(ev => {
                  const { top, height, color, info } = getEventStyle(ev);
                  return (
                    <div
                      key={ev.id}
                      style={S.eventBlock(color, top, height)}
                      onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                    >
                      {info.icon} {ev.startTime} {ev.title || info.label}
                      {ev.isShared && ' 👥'}
                    </div>
                  );
                })}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
