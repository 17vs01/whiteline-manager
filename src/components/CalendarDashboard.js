import React from 'react';

const styles = {
  dashboard: { display: 'flex', gap: '10px', marginBottom: '15px' },
  statBox: { flex: 1, backgroundColor: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  statValue: { display: 'block', fontSize: '18px', fontWeight: 'bold' },
  statLabel: { fontSize: '11px', color: '#666' },
};

const dayNames = ['일','월','화','수','목','금','토'];

const dateLabel = (d) => {
  if (d === '대기') return '📦 대기목록';
  const dt = new Date(d);
  return `${parseInt(d.split('-')[1])}/${parseInt(d.split('-')[2])} (${dayNames[dt.getDay()]})`;
};

const groupByDate = (list) => {
  const map = {};
  list.forEach(e => {
    const d = e.start || e.extendedProps?.date || '대기';
    if (!map[d]) map[d] = [];
    map[d].push(e);
  });
  return Object.entries(map).sort(([a],[b]) => a.localeCompare(b));
};

function CalendarDashboard({ stats, statsModal, setStatsModal, currentMonthStr, events, waitingList, detailOnly }) {
  const [yr, mo] = currentMonthStr.split('-');
  const monthLabel = `${yr}년 ${parseInt(mo)}월`;

  // 현재 월 이벤트 (공동작업 제외)
  const monthEvents = events.filter(e => {
    const d = e.start || e.extendedProps?.date || '';
    return d.startsWith(currentMonthStr) && !e.extendedProps?.isCoWork;
  });

  return (
    <>
      {/* 대시보드 통계 박스 - detailOnly 모드에서는 숨김 */}
      {!detailOnly && <div style={styles.dashboard}>
        <div
          style={{...styles.statBox, cursor:'pointer', border: statsModal === 'expected' ? '2px solid #3b82f6' : '2px solid transparent', transition:'all 0.15s'}}
          onClick={() => setStatsModal(statsModal === 'expected' ? null : 'expected')}
        >
          <span style={{...styles.statValue, color: '#3b82f6'}}>{stats.expected.toLocaleString()}</span>
          <span style={styles.statLabel}>배정금액 {statsModal === 'expected' ? '▲' : '▼'}</span>
        </div>
        <div
          style={{...styles.statBox, cursor:'pointer', border: statsModal === 'done' ? '2px solid #059669' : '2px solid transparent', transition:'all 0.15s'}}
          onClick={() => setStatsModal(statsModal === 'done' ? null : 'done')}
        >
          <span style={{...styles.statValue, color: '#059669'}}>{stats.done.toLocaleString()}</span>
          <span style={styles.statLabel}>완료매출 {statsModal === 'done' ? '▲' : '▼'}</span>
        </div>
        <div
          style={{...styles.statBox, cursor:'pointer', border: statsModal === 'overtime' ? '2px solid #7c3aed' : '2px solid transparent', transition:'all 0.15s'}}
          onClick={() => setStatsModal(statsModal === 'overtime' ? null : 'overtime')}
        >
          <span style={styles.statValue}>{stats.overtime}/{stats.count}</span>
          <span style={styles.statLabel}>야근/건수 {statsModal === 'overtime' ? '▲' : '▼'}</span>
        </div>
      </div>}

      {/* 통계 상세 패널 */}
      {statsModal && (() => {
        // ── 배정금액 패널 ──────────────────────────────
        if (statsModal === 'expected') {
          const assignedEvents = monthEvents;
          const assignedTotal = assignedEvents.reduce((s,e) => s + (parseInt(e.extendedProps?.price) || 0), 0);
          const waitingItems = waitingList.filter(c => c.isCharged !== false);
          const waitingTotal = waitingItems.reduce((s,c) => s + (parseInt(c.price) || 0), 0);
          const grandTotal = assignedTotal + waitingTotal;
          const grouped = groupByDate(assignedEvents);

          return (
            <div style={{background:'white', borderRadius:'12px', padding:'14px', marginBottom:'12px', boxShadow:'0 2px 10px rgba(0,0,0,0.08)', border:'2px solid #3b82f6'}}>
              <div style={{display:'flex', gap:'8px', marginBottom:'12px', flexWrap:'wrap'}}>
                <div style={{flex:1, background:'#eff6ff', borderRadius:'8px', padding:'10px', textAlign:'center'}}>
                  <div style={{fontSize:'11px', color:'#6b7280', marginBottom:'3px'}}>📅 배정고객</div>
                  <div style={{fontSize:'15px', fontWeight:'bold', color:'#3b82f6'}}>{assignedTotal.toLocaleString()}원</div>
                </div>
                <div style={{flex:1, background:'#fef3c7', borderRadius:'8px', padding:'10px', textAlign:'center'}}>
                  <div style={{fontSize:'11px', color:'#6b7280', marginBottom:'3px'}}>📦 대기목록</div>
                  <div style={{fontSize:'15px', fontWeight:'bold', color:'#d97706'}}>{waitingTotal.toLocaleString()}원</div>
                </div>
                <div style={{flex:1, background:'#f0fdf4', borderRadius:'8px', padding:'10px', textAlign:'center'}}>
                  <div style={{fontSize:'11px', color:'#6b7280', marginBottom:'3px'}}>💰 합계</div>
                  <div style={{fontSize:'15px', fontWeight:'bold', color:'#059669'}}>{grandTotal.toLocaleString()}원</div>
                </div>
              </div>
              <div style={{maxHeight:'320px', overflowY:'auto', WebkitOverflowScrolling:'touch'}}>
                {grouped.map(([date, evts]) => (
                  <div key={date} style={{marginBottom:'8px'}}>
                    <div style={{fontSize:'11px', fontWeight:'bold', color:'#64748b', padding:'4px 0', borderBottom:'1px solid #f1f5f9', marginBottom:'4px'}}>
                      {dateLabel(date)}
                      <span style={{marginLeft:'8px', color:'#94a3b8'}}>({evts.length}건 · {evts.reduce((s,e)=>s+(parseInt(e.extendedProps?.price)||0),0).toLocaleString()}원)</span>
                    </div>
                    {evts.map(e => {
                      const price = parseInt(e.extendedProps?.price) || 0;
                      const status = e.extendedProps?.status || '';
                      const isCharged = e.extendedProps?.isCharged !== false;
                      const statusColor = status === '완료' ? '#059669' : status === '야근' ? '#7c3aed' : '#3b82f6';
                      return (
                        <div key={e.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 4px', fontSize:'13px', borderBottom:'1px solid #f8fafc'}}>
                          <div style={{display:'flex', alignItems:'center', gap:'6px', flex:1, minWidth:0}}>
                            <span style={{width:'6px', height:'6px', borderRadius:'50%', background:statusColor, flexShrink:0}}></span>
                            <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: !isCharged ? '#94a3b8' : '#1e293b'}}>
                              {e.title}
                            </span>
                            {!isCharged && <span style={{fontSize:'10px', color:'#94a3b8', flexShrink:0}}>무료</span>}
                          </div>
                          <span style={{fontWeight:'bold', color: !isCharged ? '#94a3b8' : statusColor, flexShrink:0, marginLeft:'8px'}}>
                            {price > 0 ? price.toLocaleString()+'원' : '0원'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {waitingItems.length > 0 && (
                  <div style={{marginTop:'8px'}}>
                    <div style={{fontSize:'11px', fontWeight:'bold', color:'#d97706', padding:'4px 0', borderBottom:'1px solid #fef3c7', marginBottom:'4px', background:'#fffbeb', borderRadius:'4px', paddingLeft:'6px'}}>
                      📦 대기목록
                      <span style={{marginLeft:'8px', color:'#d97706'}}>({waitingItems.length}건 · {waitingTotal.toLocaleString()}원)</span>
                    </div>
                    {waitingItems.map(c => (
                      <div key={c.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 4px', fontSize:'13px', borderBottom:'1px solid #fef9c3'}}>
                        <div style={{display:'flex', alignItems:'center', gap:'6px', flex:1, minWidth:0}}>
                          <span style={{width:'6px', height:'6px', borderRadius:'50%', background:'#f59e0b', flexShrink:0}}></span>
                          <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                            {c.displayName || c.name}
                          </span>
                          <span style={{fontSize:'10px', color:'#f59e0b', flexShrink:0, background:'#fef3c7', padding:'1px 5px', borderRadius:'4px'}}>대기</span>
                        </div>
                        <span style={{fontWeight:'bold', color:'#d97706', flexShrink:0, marginLeft:'8px'}}>
                          {(parseInt(c.price)||0).toLocaleString()}원
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        }

        // ── 완료매출 패널 ──────────────────────────────
        if (statsModal === 'done') {
          const doneEvents = monthEvents.filter(e => ['완료','야근','마감완료'].includes(e.extendedProps?.status));
          const doneTotal = doneEvents.reduce((s,e) => s+(parseInt(e.extendedProps?.price)||0), 0);
          const grouped = groupByDate(doneEvents);

          return (
            <div style={{background:'white', borderRadius:'12px', padding:'14px', marginBottom:'12px', boxShadow:'0 2px 10px rgba(0,0,0,0.08)', border:'2px solid #059669'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                <span style={{fontSize:'13px', fontWeight:'bold', color:'#065f46'}}>✅ {monthLabel} 완료매출</span>
                <span style={{fontSize:'16px', fontWeight:'bold', color:'#059669'}}>{doneTotal.toLocaleString()}원</span>
              </div>
              <div style={{maxHeight:'320px', overflowY:'auto', WebkitOverflowScrolling:'touch'}}>
                {doneEvents.length === 0 ? (
                  <div style={{textAlign:'center', padding:'30px', color:'#9ca3af', fontSize:'13px'}}>완료된 작업이 없습니다.</div>
                ) : (
                  grouped.map(([date, evts]) => (
                    <div key={date} style={{marginBottom:'8px'}}>
                      <div style={{fontSize:'11px', fontWeight:'bold', color:'#64748b', padding:'4px 0', borderBottom:'1px solid #f1f5f9', marginBottom:'4px'}}>
                        {dateLabel(date)}
                        <span style={{marginLeft:'8px', color:'#94a3b8'}}>({evts.length}건 · {evts.reduce((s,e)=>s+(parseInt(e.extendedProps?.price)||0),0).toLocaleString()}원)</span>
                      </div>
                      {evts.map(e => {
                        const price = parseInt(e.extendedProps?.price) || 0;
                        const isOT = e.extendedProps?.status === '야근';
                        return (
                          <div key={e.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 4px', fontSize:'13px', borderBottom:'1px solid #f8fafc'}}>
                            <div style={{display:'flex', alignItems:'center', gap:'6px', flex:1, minWidth:0}}>
                              <span style={{width:'6px', height:'6px', borderRadius:'50%', background: isOT ? '#7c3aed' : '#059669', flexShrink:0}}></span>
                              <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{e.title}</span>
                              {isOT && <span style={{fontSize:'10px', color:'#7c3aed', background:'#f3e8ff', padding:'1px 5px', borderRadius:'4px', flexShrink:0}}>야근</span>}
                            </div>
                            <span style={{fontWeight:'bold', color: isOT ? '#7c3aed' : '#059669', flexShrink:0, marginLeft:'8px'}}>
                              {price.toLocaleString()}원
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        }

        // ── 야근 패널 ──────────────────────────────────
        if (statsModal === 'overtime') {
          const otEvents = monthEvents.filter(e => e.extendedProps?.status === '야근');
          const otTotal = otEvents.reduce((s,e) => s+(parseInt(e.extendedProps?.price)||0), 0);
          const grouped = groupByDate(otEvents);

          return (
            <div style={{background:'white', borderRadius:'12px', padding:'14px', marginBottom:'12px', boxShadow:'0 2px 10px rgba(0,0,0,0.08)', border:'2px solid #7c3aed'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                <span style={{fontSize:'13px', fontWeight:'bold', color:'#4c1d95'}}>🌙 {monthLabel} 야근</span>
                <span style={{fontSize:'16px', fontWeight:'bold', color:'#7c3aed'}}>{otEvents.length}건 · {otTotal.toLocaleString()}원</span>
              </div>
              <div style={{maxHeight:'320px', overflowY:'auto', WebkitOverflowScrolling:'touch'}}>
                {otEvents.length === 0 ? (
                  <div style={{textAlign:'center', padding:'30px', color:'#9ca3af', fontSize:'13px'}}>야근이 없습니다.</div>
                ) : (
                  grouped.map(([date, evts]) => (
                    <div key={date} style={{marginBottom:'8px'}}>
                      <div style={{fontSize:'11px', fontWeight:'bold', color:'#64748b', padding:'4px 0', borderBottom:'1px solid #f3e8ff', marginBottom:'4px'}}>
                        {dateLabel(date)}
                        <span style={{marginLeft:'8px', color:'#94a3b8'}}>({evts.length}건)</span>
                      </div>
                      {evts.map(e => {
                        const price = parseInt(e.extendedProps?.price) || 0;
                        return (
                          <div key={e.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 4px', fontSize:'13px', borderBottom:'1px solid #faf5ff'}}>
                            <div style={{display:'flex', alignItems:'center', gap:'6px', flex:1, minWidth:0}}>
                              <span style={{fontSize:'14px'}}>🌙</span>
                              <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{e.title}</span>
                            </div>
                            <span style={{fontWeight:'bold', color:'#7c3aed', flexShrink:0, marginLeft:'8px'}}>
                              {price.toLocaleString()}원
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        }

        return null;
      })()}
    </>
  );
}

export default CalendarDashboard;
