// =============================================
// Today 대시보드 (통합형 - 접기/펼치기)
// 배정플랜 최상단에 표시
// =============================================
import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const S = {
  wrap: {
    background: 'white', borderRadius: 12,
    marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  // ── 접힌 헤더 ─────────────────────────────
  headerRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 14px', cursor: 'pointer', userSelect: 'none',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 13, fontWeight: 'bold', color: '#1e293b' },
  headerDate: { fontSize: 11, color: '#94a3b8' },
  toggleBtn: {
    fontSize: 11, color: '#3b82f6', fontWeight: 'bold',
    background: '#eff6ff', border: '1px solid #bfdbfe',
    borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
  },
  // ── 한 줄 요약 ────────────────────────────
  summaryRow: {
    display: 'flex', alignItems: 'stretch',
    padding: '0 0 8px', borderTop: '1px solid #f1f5f9',
  },
  summaryCell: (borderRight) => ({
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '5px 1px',
    borderRight: borderRight ? '1px solid #e5e7eb' : 'none',
    minWidth: 0,
  }),
  summaryLabel: { fontSize: 8, color: '#94a3b8', fontWeight: '500', marginBottom: 2, whiteSpace: 'nowrap', letterSpacing: '-0.2px' },
  summaryNum: (color) => ({ fontSize: 16, fontWeight: 'bold', color, lineHeight: 1 }),
  // 하위호환용 (사용 안함)
  chip: (color, bg) => ({ display: 'none' }),
  divider: { display: 'none' },
  // ── 펼친 내용 ─────────────────────────────
  expanded: { borderTop: '1px solid #f1f5f9', padding: '12px 14px' },
  // 오늘의 할일 그리드
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 12 },
  card: (color, bg) => ({
    background: bg, borderRadius: 10, padding: '10px 12px',
    borderLeft: `3px solid ${color}`, cursor: 'pointer',
  }),
  cardNum: (color) => ({ fontSize: 20, fontWeight: 'bold', color }),
  cardLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  detailBox: {
    background: '#f8fafc', borderRadius: 8,
    padding: '8px 12px', maxHeight: 180, overflowY: 'auto',
    marginTop: 8, marginBottom: 4,
  },
  detailItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 0', borderBottom: '1px solid #e2e8f0', fontSize: 12,
  },
  // 직원현황 섹션
  sectionBtn: (active) => ({
    width: '100%', padding: '8px 12px', border: 'none',
    borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 'bold',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: active ? '#1e40af' : '#eff6ff',
    color: active ? 'white' : '#1e40af',
    marginBottom: active ? 0 : 6,
  }),
  liveBox: {
    background: 'white', border: '1px solid #bfdbfe',
    borderTop: 'none', borderRadius: '0 0 8px 8px',
    padding: '10px 12px', marginBottom: 6,
  },
  // 방문알림 버튼
  visitBtn: {
    width: '100%', padding: '9px 14px', background: '#3b82f6',
    color: 'white', border: 'none', borderRadius: 8,
    fontSize: 12, fontWeight: 'bold', cursor: 'pointer', marginBottom: 8,
  },
  // CalendarDashboard 통합 (배정금액/완료매출/야근)
  statRow: { display: 'flex', gap: 8, marginTop: 4 },
  statBox: (borderColor) => ({
    flex: 1, background: 'white', padding: '10px 8px',
    borderRadius: 8, textAlign: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: `2px solid ${borderColor || 'transparent'}`,
    cursor: 'pointer',
  }),
  statValue: (color) => ({ fontSize: 15, fontWeight: 'bold', color, display: 'block' }),
  statLabel: { fontSize: 10, color: '#666', marginTop: 2 },
  refreshBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 15, color: '#6b7280', padding: '0 4px',
  },
};

export default function TodayDashboard({
  currentUser,
  staffList,
  // CalendarDashboard 통합 props
  stats,
  statsModal,
  setStatsModal,
  events,        // CalendarPage events
  waitingList,
  sendVisitReminders,
  currentMonthStr,
  currentViewMode = "admin",  // 기본값: 관리자모드(전체)
  isAdminView = false,
}) {
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem('todayDashOpen') === 'true'; }
    catch { return false; }
  });

  const toggleOpen = (v) => {
    const next = typeof v === 'boolean' ? v : !open;
    setOpen(next);
    try { sessionStorage.setItem('todayDashOpen', String(next)); } catch {}
  };
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [detail, setDetail]       = useState(null);
  const [showLive, setShowLive]   = useState(false);

  // 한국 시간(UTC+9) 기준 오늘 날짜
  const today = (() => {
    const d = new Date();
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().split('T')[0];
  })();
  const staffId  = currentUser?.visibleId || currentUser?.id;
  const isMaster = ['master','master1','master2'].includes(currentUser?.role);

  // 뷰모드 기준으로 어떤 staffId를 필터할지 결정
  // isAdminView 또는 currentViewMode==='admin' 이면 전체 직원 조회
  // currentViewMode==='self' 이면 본인만
  // 그 외(특정 직원 선택) 이면 해당 직원만
  const isFullView = isAdminView || currentViewMode === 'admin';
  const viewStaffId = isFullView
    ? null
    : (currentViewMode === 'self' || !currentViewMode)
      ? staffId
      : currentViewMode;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [evSnap, custSnap, schSnap, schSharedSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'events'),
          where('date', '==', today),
          ...(viewStaffId ? [where('staffId', '==', viewStaffId)] : [])
        )),
        getDocs(collection(db, 'customers')),
        getDocs(query(collection(db, 'scheduleEvents'), where('staffId','==',staffId), where('date','==',today))),
        getDocs(query(collection(db, 'scheduleEvents'), where('sharedWith','array-contains',staffId), where('date','==',today))),
      ]);

      const evs   = evSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const custs = custSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const scheds = [
        ...schSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        ...schSharedSnap.docs.map(d => ({ id: d.id, ...d.data(), isShared: true })),
      ];

      const assignToday  = evs.filter(e => !e.isCoWork && e.status === '배정');
      const doneToday    = evs.filter(e => !e.isCoWork && (e.status === '완료' || e.status === '야근'));
      const totalToday   = evs.filter(e => !e.isCoWork);

      const unpaidList = custs.filter(c =>
        c.custStatus !== '해약' && c.custStatus !== '삭제' && c.unpaid > 0 &&
        (isMaster || c.staffName === currentUser?.name)
      );

      const now = new Date();
      const renewalList = custs.filter(c => {
        if (c.custStatus !== '정상' || !c.contractPeriod) return false;
        if (!isMaster && c.staffName !== currentUser?.name) return false;
        try {
          const parts = c.contractPeriod.split('-');
          const endStr = parts[parts.length-1].trim().replace(/\./g,'-');
          const endDate = new Date(endStr);
          if (isNaN(endDate)) return false;
          const days = Math.ceil((endDate - now) / 86400000);
          return days >= 0 && days <= 30;
        } catch { return false; }
      });

      setData({
        assignToday, doneToday, totalToday, scheds, unpaidList, renewalList,
        totalUnpaid: unpaidList.reduce((s,c)=>s+(c.unpaid||0),0),
      });
    } catch(e) { console.error('대시보드 오류:', e); }
    setLoading(false);
  }, [today, staffId, isMaster, currentUser, viewStaffId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // 오늘 배정 수 (방문알림용)
  const todayAssignCount = (events || []).filter(e =>
    (e.start || e.extendedProps?.date || '').startsWith(today) &&
    e.extendedProps?.status === '배정' && !e.extendedProps?.isCoWork
  ).length;

  // 직원 실시간 현황 계산
  const staffStats = (() => {
    if (!events || !staffList) return {};
    const map = {};
    staffList.forEach(s => { map[s.name] = { total:0, done:0, pending:0 }; });
    events.forEach(e => {
      const sn = e.extendedProps?.staffName || e.staffName;
      if (!sn || !map[sn]) return;
      if (e.extendedProps?.isCoWork) return;
      map[sn].total++;
      if (e.extendedProps?.status==='완료'||e.extendedProps?.status==='야근') map[sn].done++;
      else if (e.extendedProps?.status==='배정') map[sn].pending++;
    });
    return map;
  })();

  // ── 한 줄 요약 계산 ─────────────────────
  // 월전체 통계 (CalendarPage events props에서 계산)
  const monthStats = React.useMemo(() => {
    if (!events || !currentMonthStr) return { total: 0, undone: 0 };
    const monthEvs = events.filter(e =>
      (e.start || e.extendedProps?.date || '').startsWith(currentMonthStr) &&
      !e.extendedProps?.isCoWork
    );
    const undone = monthEvs.filter(e =>
      !['완료','야근','미작업'].includes(e.extendedProps?.status)
    ).length;
    return { total: monthEvs.length, undone };
  }, [events, currentMonthStr]);

  // 대기고객 수 (waitingList props에서)
  const waitingCount = (waitingList || []).length;

  const summaryData = data ? {
    assign:     data.assignToday.length,        // 오늘 배정
    undoneToday:Math.max(0, data.assignToday.length - data.doneToday.length), // 오늘 미완료
    schedule:   data.scheds.length,             // 오늘 약속
    monthTotal: monthStats.total,               // 월 전체 배정 고객
    waiting:    waitingCount,                   // 대기목록 고객
    monthUndone:monthStats.undone,              // 월 전체 미완료
  } : null;

  // ── 렌더 ─────────────────────────────────
  return (
    <div style={S.wrap}>
      {/* 헤더 (항상 표시) */}
      <div style={S.headerRow} onClick={() => toggleOpen()}>
        <div style={S.headerLeft}>
          <span style={{ fontSize: 16 }}>📊</span>
          <span style={S.headerTitle}>Today 대시보드</span>
          <span style={S.headerDate}>{today}</span>
          {!isFullView && viewStaffId && (
            <span style={{ fontSize:10, background:'#eff6ff', color:'#2563eb', padding:'2px 7px', borderRadius:10, fontWeight:600 }}>내 일정</span>
          )}
          {isFullView && (
            <span style={{ fontSize:10, background:'#f0fdf4', color:'#059669', padding:'2px 7px', borderRadius:10, fontWeight:600 }}>전체 직원</span>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          {!open && (
            <button style={S.refreshBtn} onClick={e => { e.stopPropagation(); load(); }}>🔄</button>
          )}
          <span style={S.toggleBtn}>{open ? '▲ 접기' : '▼ 펼치기'}</span>
        </div>
      </div>

      {/* 한 줄 요약 (접힌 상태) */}
      {!open && (
        <div style={S.summaryRow}>
          {loading || !summaryData ? (
            <div style={{ flex:1, textAlign:'center', fontSize:11, color:'#94a3b8', padding:'8px 0' }}>로딩 중...</div>
          ) : (
            <>
              <div style={S.summaryCell(true)}>
                <span style={S.summaryLabel}>배정</span>
                <span style={S.summaryNum('#3b82f6')}>{summaryData.assign}</span>
              </div>
              <div style={S.summaryCell(true)}>
                <span style={S.summaryLabel}>미완료</span>
                <span style={S.summaryNum(summaryData.undoneToday > 0 ? '#ef4444' : '#10b981')}>{summaryData.undoneToday}</span>
              </div>
              <div style={S.summaryCell(true)}>
                <span style={S.summaryLabel}>약속</span>
                <span style={S.summaryNum('#8b5cf6')}>{summaryData.schedule}</span>
              </div>
              <div style={S.summaryCell(true)}>
                <span style={S.summaryLabel}>총고객</span>
                <span style={S.summaryNum('#374151')}>{summaryData.monthTotal}</span>
              </div>
              <div style={S.summaryCell(true)}>
                <span style={S.summaryLabel}>대기</span>
                <span style={S.summaryNum('#f59e0b')}>{summaryData.waiting}</span>
              </div>
              <div style={S.summaryCell(false)}>
                <span style={S.summaryLabel}>총미완료</span>
                <span style={S.summaryNum(summaryData.monthUndone > 0 ? '#ef4444' : '#10b981')}>{summaryData.monthUndone}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 펼친 내용 */}
      {open && (
        <div style={S.expanded}>
          {loading || !data ? (
            <div style={{ textAlign:'center', padding:'16px 0', color:'#94a3b8', fontSize:13 }}>로딩 중...</div>
          ) : (
            <>
              {/* 새로고침 */}
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
                <button style={S.refreshBtn} onClick={load} title="새로고침">🔄 새로고침</button>
              </div>

              {/* 오늘의 할일 4칸 그리드 */}
              <div style={S.grid}>
                {[
                  { key:'assign',  num:data.assignToday.length, label:'오늘 배정',    color:'#3b82f6', bg:'#eff6ff', icon:'📅' },
                  { key:'schedule',num:data.scheds.length,      label:'오늘 약속',    color:'#8b5cf6', bg:'#ede9fe', icon:'🗓️' },
                  { key:'unpaid',  num:data.unpaidList.length,  label:`미수금 ${(data.totalUnpaid/10000).toFixed(0)}만원`, color:'#ef4444', bg:'#fee2e2', icon:'💰' },
                  { key:'renewal', num:data.renewalList.length, label:'재계약 임박',  color:'#f59e0b', bg:'#fef3c7', icon:'📋' },
                ].map(c => (
                  <div key={c.key} style={S.card(c.color, c.bg)}
                    onClick={() => setDetail(detail===c.key ? null : c.key)}>
                    <div style={S.cardNum(c.color)}>{c.icon} {c.num}</div>
                    <div style={S.cardLabel}>{c.label} {detail===c.key?'▲':'▼'}</div>
                  </div>
                ))}
              </div>

              {/* 배정 상세 */}
              {detail==='assign' && data.assignToday.length > 0 && (
                <div style={S.detailBox}>
                  {data.assignToday.map(e => (
                    <div key={e.id} style={S.detailItem}>
                      <span>{e.extendedProps?.customerName || e.title || '고객'}</span>
                      <span style={{ color:'#6b7280' }}>{e.extendedProps?.staffName || ''}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* 약속 상세 */}
              {detail==='schedule' && data.scheds.length > 0 && (
                <div style={S.detailBox}>
                  {data.scheds.sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||'')).map(e => (
                    <div key={e.id} style={S.detailItem}>
                      <span>{e.startTime} {e.title}</span>
                      {e.isShared && <span style={{ color:'#0891b2', fontSize:11 }}>👥</span>}
                    </div>
                  ))}
                </div>
              )}
              {/* 미수금 상세 */}
              {detail==='unpaid' && data.unpaidList.length > 0 && (
                <div style={S.detailBox}>
                  {data.unpaidList.map(c => (
                    <div key={c.id} style={S.detailItem}>
                      <span>{c.name}</span>
                      <span style={{ color:'#ef4444', fontWeight:'bold' }}>{(c.unpaid||0).toLocaleString()}원</span>
                    </div>
                  ))}
                </div>
              )}
              {/* 재계약 상세 */}
              {detail==='renewal' && data.renewalList.length > 0 && (
                <div style={S.detailBox}>
                  {data.renewalList.map(c => {
                    const parts = c.contractPeriod?.split('-')||[];
                    const endStr = parts[parts.length-1]?.trim().replace(/\./g,'-');
                    const days = Math.ceil((new Date(endStr)-new Date())/86400000);
                    return (
                      <div key={c.id} style={S.detailItem}>
                        <span>{c.name}</span>
                        <span style={{ color:days<=7?'#ef4444':'#f59e0b', fontWeight:'bold' }}>D-{days}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 직원 실시간 작업현황 (관리자) */}
              {isMaster && (
                <>
                  <button style={S.sectionBtn(showLive)} onClick={() => setShowLive(v=>!v)}>
                    <span>📊 직원 실시간 작업현황</span>
                    <span>{showLive ? '▲' : '▼'}</span>
                  </button>
                  {showLive && (
                    <div style={S.liveBox}>
                      {Object.entries(staffStats)
                        .filter(([,s]) => s.total > 0)
                        .sort((a,b) => b[1].done - a[1].done)
                        .map(([name, s]) => {
                          const pct = s.total > 0 ? Math.round(s.done/s.total*100) : 0;
                          return (
                            <div key={name} style={{ marginBottom:8 }}>
                              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:2 }}>
                                <span style={{ fontWeight:'bold' }}>👤 {name}</span>
                                <span style={{ color:'#6b7280' }}>{s.done}/{s.total}건 ({pct}%)</span>
                              </div>
                              <div style={{ height:7, background:'#e5e7eb', borderRadius:4, overflow:'hidden' }}>
                                <div style={{ height:'100%', width:`${pct}%`, background:pct===100?'#059669':'#3b82f6', borderRadius:4 }} />
                              </div>
                              {s.pending > 0 && <div style={{ fontSize:11, color:'#f59e0b', marginTop:1 }}>⏳ 미완료 {s.pending}건</div>}
                            </div>
                          );
                        })}
                      {Object.values(staffStats).every(s=>s.total===0) && (
                        <div style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'8px 0' }}>오늘 배정된 직원이 없습니다.</div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* 방문 예정 알림 */}
              {todayAssignCount > 0 && sendVisitReminders && (
                <button style={S.visitBtn} onClick={sendVisitReminders}>
                  📱 방문 예정 알림 ({todayAssignCount}명)
                </button>
              )}

              {/* 배정금액 / 완료매출 / 야근건수 */}
              {stats && (
                <div style={S.statRow}>
                  <div style={S.statBox(statsModal==='expected'?'#3b82f6':'transparent')}
                    onClick={()=>setStatsModal&&setStatsModal(statsModal==='expected'?null:'expected')}>
                    <span style={S.statValue('#3b82f6')}>{(stats.expected||0).toLocaleString()}</span>
                    <div style={S.statLabel}>배정금액 {statsModal==='expected'?'▲':'▼'}</div>
                  </div>
                  <div style={S.statBox(statsModal==='done'?'#059669':'transparent')}
                    onClick={()=>setStatsModal&&setStatsModal(statsModal==='done'?null:'done')}>
                    <span style={S.statValue('#059669')}>{(stats.done||0).toLocaleString()}</span>
                    <div style={S.statLabel}>완료매출 {statsModal==='done'?'▲':'▼'}</div>
                  </div>
                  <div style={S.statBox(statsModal==='overtime'?'#7c3aed':'transparent')}
                    onClick={()=>setStatsModal&&setStatsModal(statsModal==='overtime'?null:'overtime')}>
                    <span style={S.statValue('#7c3aed')}>{stats.overtime||0}/{stats.count||0}</span>
                    <div style={S.statLabel}>야근/건수 {statsModal==='overtime'?'▲':'▼'}</div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
