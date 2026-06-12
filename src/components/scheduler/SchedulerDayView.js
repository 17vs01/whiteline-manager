// =============================================
// 스케쥴러 일간 뷰
// =============================================
import React, { useState, useMemo } from 'react';
import { EVENT_TYPES } from './schedulerConstants';

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06~22시
const HOUR_HEIGHT = 60;
const START_HOUR  = 6;

const S = {
  container: { display: 'flex', gap: 0 },
  timeCol: { width: 48, flexShrink: 0 },
  mainCol: { flex: 1, position: 'relative' },
  timeLabel: {
    height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start',
    justifyContent: 'flex-end', paddingRight: 8, paddingTop: 2,
    fontSize: 11, color: '#94a3b8', borderRight: '1px solid #e5e7eb',
  },
  hourLine: {
    height: HOUR_HEIGHT, borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer', position: 'relative',
  },
  eventBlock: (color, top, height, leftPct, widthPct) => ({
    position: 'absolute', top, height: Math.max(height, 24),
    left: `${leftPct}%`, width: `${widthPct}%`,
    background: color + 'ee', border: `1.5px solid ${color}`,
    borderRadius: 6, padding: '3px 6px', overflow: 'hidden',
    cursor: 'pointer', zIndex: 5, boxSizing: 'border-box',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  }),
  assignSection: {
    background: '#f0fdf4', border: '1px solid #a7f3d0',
    borderRadius: 10, padding: '10px 14px', marginBottom: 12,
  },
  assignHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  assignTitle: { fontSize: 14, fontWeight: 'bold', color: '#059669' },
  assignCard: {
    background: 'white', borderRadius: 8, padding: '8px 10px',
    marginBottom: 6, fontSize: 13, boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  refreshBtn: {
    background: 'none', border: '1px solid #6ee7b7', color: '#059669',
    borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer',
  },
  sortBtn: {
    background: 'none', border: '1px solid #d1fae5', color: '#059669',
    borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
  },
};

export default function SchedulerDayView({
  date,
  scheduleEvents,
  assignCustomers,   // 해당 날짜 배정 고객 배열
  onTimeClick,       // (date, time) => void
  onEventClick,
  onAssignOrderChange, // (newOrder) => void
  onAssignReset,     // () => void
}) {
  const [showAssign, setShowAssign]   = useState(true);
  const [sortMode, setSortMode]       = useState('original'); // 'original' | 'time'
  const [assignOrder, setAssignOrder] = useState(null); // null = 원본 순서

  const timeToMinutes = (t) => {
    const [h, m] = (t || '09:00').split(':').map(Number);
    return h * 60 + m;
  };

  // 이벤트 충돌 감지 → 겹치는 이벤트 좌우 분할
  const positionedEvents = useMemo(() => {
    const timed = scheduleEvents.filter(e => !e.allDay && e.type !== 'holiday');
    // 간단 레이아웃: 겹치면 50% 나눔
    const result = [];
    timed.forEach((ev, i) => {
      const start = timeToMinutes(ev.startTime);
      const end   = timeToMinutes(ev.endTime || ev.startTime) || start + 60;
      const top   = ((start - START_HOUR * 60) / 60) * HOUR_HEIGHT;
      const height= ((end - start) / 60) * HOUR_HEIGHT;
      const info  = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
      const color = ev.isShared ? '#0891b2' : info.color;

      // 충돌 체크
      const overlapping = result.filter(r => {
        const rs = timeToMinutes(r.ev.startTime);
        const re = timeToMinutes(r.ev.endTime || r.ev.startTime) || rs + 60;
        return !(end <= rs || start >= re);
      });
      const col   = overlapping.length;
      const total = col + 1;
      result.push({ ev, top, height, color, info, col, total });
    });
    return result;
  }, [scheduleEvents]);

  // 배정 고객 순서
  const displayCustomers = useMemo(() => {
    const base = assignOrder || assignCustomers || [];
    if (sortMode === 'time') {
      return [...base].sort((a, b) => {
        const ta = a.customerStatus?.preferredTime || '';
        const tb = b.customerStatus?.preferredTime || '';
        return ta.localeCompare(tb);
      });
    }
    return base;
  }, [assignCustomers, assignOrder, sortMode]);

  const moveItem = (idx, dir) => {
    const arr = [...displayCustomers];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= arr.length) return;
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setAssignOrder(arr);
    if (onAssignOrderChange) onAssignOrderChange(arr);
  };

  const handleReset = () => {
    setAssignOrder(null);
    setSortMode('original');
    if (onAssignReset) onAssignReset();
  };

  const allDayEvents = scheduleEvents.filter(e => e.allDay || e.type === 'holiday');

  const dateObj = new Date(date + 'T00:00:00');
  const dayNames = ['일','월','화','수','목','금','토'];
  const dayLabel = `${dateObj.getMonth()+1}월 ${dateObj.getDate()}일 (${dayNames[dateObj.getDay()]})`;

  return (
    <div>
      {/* 날짜 헤더 */}
      <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 16, color: '#1e293b', padding: '8px 0 4px' }}>
        {dayLabel}
      </div>

      {/* 종일 이벤트 */}
      {allDayEvents.length > 0 && (
        <div style={{ padding: '4px 8px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {allDayEvents.map(ev => {
            const info = EVENT_TYPES[ev.type] || EVENT_TYPES.other;
            return (
              <span key={ev.id}
                style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: info.color + '22', color: info.color, fontWeight: 'bold', cursor: 'pointer' }}
                onClick={() => onEventClick(ev)}>
                {info.icon} {ev.title || info.label}
              </span>
            );
          })}
        </div>
      )}

      {/* 배정플랜 섹션 */}
      {(assignCustomers?.length > 0) && (
        <div style={S.assignSection}>
          <div style={S.assignHeader}>
            <span style={S.assignTitle}>👥 배정 고객 {displayCustomers.length}명</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={S.sortBtn}
                onClick={() => setSortMode(m => m === 'time' ? 'original' : 'time')}>
                {sortMode === 'time' ? '⏰ 시간순' : '📋 배정순'}
              </button>
              <button style={S.refreshBtn} onClick={handleReset} title="배정플랜 원본 순서로">
                🔄
              </button>
              <button style={S.refreshBtn} onClick={() => setShowAssign(v => !v)}>
                {showAssign ? '▲' : '▼'}
              </button>
            </div>
          </div>
          {showAssign && displayCustomers.map((c, idx) => (
            <div key={c.id || idx} style={S.assignCard}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{c.name || c.custName}</span>
                {c.customerStatus?.preferredTime && (
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>
                    ⏰ {c.customerStatus.preferredTime}
                  </span>
                )}
                {c.customerStatus?.mainIssues?.length > 0 && (
                  <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 6 }}>
                    ⚠️ {c.customerStatus.mainIssues.slice(0,2).join(',')}
                  </span>
                )}
                {c.phone && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.phone}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button style={{ ...S.refreshBtn, padding: '1px 6px' }} onClick={() => moveItem(idx, -1)} disabled={idx === 0}>▲</button>
                <button style={{ ...S.refreshBtn, padding: '1px 6px' }} onClick={() => moveItem(idx, 1)} disabled={idx === displayCustomers.length - 1}>▼</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 시간대 타임라인 */}
      <div style={S.container}>
        <div style={S.timeCol}>
          {HOURS.map(h => (
            <div key={h} style={S.timeLabel}>
              {String(h).padStart(2,'0')}
            </div>
          ))}
        </div>
        <div style={S.mainCol}>
          {/* 시간 격자 */}
          {HOURS.map(h => (
            <div key={h} style={S.hourLine}
              onClick={() => onTimeClick && onTimeClick(date, `${String(h).padStart(2,'0')}:00`)} />
          ))}
          {/* 이벤트 블록 */}
          {positionedEvents.map(({ ev, top, height, color, info, col, total }) => (
            <div
              key={ev.id}
              style={S.eventBlock(color, top, height, col * (100 / total), 100 / total)}
              onClick={() => onEventClick(ev)}
            >
              <div style={{ fontSize: 11, fontWeight: 'bold', color: 'white' }}>
                {info.icon} {ev.startTime} {ev.isShared && '👥'}
              </div>
              <div style={{ fontSize: 12, color: 'white', fontWeight: 'bold' }}>
                {ev.title || info.label}
              </div>
              {ev.memo && (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
                  {ev.memo}
                </div>
              )}
            </div>
          ))}
          {/* 현재 시간선 */}
          <NowLine startHour={START_HOUR} hourHeight={HOUR_HEIGHT} date={date} />
        </div>
      </div>
    </div>
  );
}

// 현재 시간 표시선
function NowLine({ startHour, hourHeight, date }) {
  const today = new Date().toISOString().split('T')[0];
  if (date !== today) return null;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = ((minutes - startHour * 60) / 60) * hourHeight;
  if (top < 0) return null;
  return (
    <div style={{
      position: 'absolute', top, left: 0, right: 0, zIndex: 10,
      display: 'flex', alignItems: 'center', pointerEvents: 'none',
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 1.5, background: '#ef4444' }} />
    </div>
  );
}
