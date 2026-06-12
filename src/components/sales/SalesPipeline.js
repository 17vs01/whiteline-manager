// =============================================
// 영업 파이프라인 대시보드
// 견적 → 계약 전환율 및 단계별 현황
// =============================================
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';

// 파이프라인 단계 정의
const PIPELINE_STAGES = [
  { key: 'draft',      label: '작성중',   color: '#64748b', bg: '#f1f5f9',  icon: '📝' },
  { key: 'sent',       label: '발송',     color: '#3b82f6', bg: '#eff6ff',  icon: '📤' },
  { key: 'viewed',     label: '열람',     color: '#8b5cf6', bg: '#f5f3ff',  icon: '👁️' },
  { key: 'approved',   label: '승인',     color: '#10b981', bg: '#d1fae5',  icon: '✅' },
  { key: 'contracted', label: '계약전환', color: '#059669', bg: '#ecfdf5',  icon: '🎉' },
];

const CONTRACT_STAGES = [
  { key: 'sent',       label: '발송',     color: '#3b82f6', bg: '#eff6ff' },
  { key: 'signed',     label: '서명완료', color: '#10b981', bg: '#d1fae5' },
  { key: 'registered', label: '고객등록', color: '#059669', bg: '#ecfdf5' },
];

export default function SalesPipeline({ staffList, currentUser }) {
  const [quotes,    setQuotes]    = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [period,    setPeriod]    = useState(3);   // 최근 N개월
  const [staffFilter, setStaffFilter] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [qSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db, 'quotes'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'contracts'), orderBy('createdAt', 'desc'))),
      ]);
      setQuotes(qSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setContracts(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  // ── 기간 필터 ─────────────────────────────────
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - period);
  const cutoffStr = cutoff.toISOString();

  const filteredQuotes = quotes.filter(q => {
    if (q.createdAt < cutoffStr) return false;
    if (staffFilter !== 'all' && q.staffName !== staffFilter) return false;
    return true;
  });

  const filteredContracts = contracts.filter(c => {
    if (c.createdAt < cutoffStr) return false;
    if (staffFilter !== 'all' && c.staffName !== staffFilter) return false;
    return true;
  });

  // ── 단계별 건수 ───────────────────────────────
  const stageCounts = {};
  PIPELINE_STAGES.forEach(s => {
    stageCounts[s.key] = filteredQuotes.filter(q => q.status === s.key).length;
  });

  const contractStageCounts = {};
  CONTRACT_STAGES.forEach(s => {
    contractStageCounts[s.key] = filteredContracts.filter(c => c.status === s.key).length;
  });

  // ── 전환율 계산 ───────────────────────────────
  const totalSent       = filteredQuotes.filter(q => q.status !== 'draft').length;
  const totalViewed     = filteredQuotes.filter(q => ['viewed','approved','contracted','reQuote'].includes(q.status)).length;
  const totalApproved   = filteredQuotes.filter(q => ['approved','contracted'].includes(q.status)).length;
  const totalContracted = filteredQuotes.filter(q => q.status === 'contracted').length;
  const totalRejected   = filteredQuotes.filter(q => ['rejected','closed'].includes(q.status)).length;
  const totalSigned     = filteredContracts.filter(c => c.status === 'signed').length;
  const totalRegistered = filteredContracts.filter(c => c.status === 'registered').length;

  const rate = (num, den) => den > 0 ? Math.round(num / den * 100) : 0;

  // ── 평균 소요일 계산 ──────────────────────────
  const avgDays = (() => {
    const completed = filteredQuotes.filter(q =>
      q.status === 'contracted' && q.createdAt && q.approvedAt
    );
    if (!completed.length) return null;
    const total = completed.reduce((sum, q) => {
      const diff = new Date(q.approvedAt) - new Date(q.createdAt);
      return sum + diff / (1000 * 60 * 60 * 24);
    }, 0);
    return Math.round(total / completed.length);
  })();

  // ── 담당자별 실적 ─────────────────────────────
  const staffStats = {};
  filteredQuotes.forEach(q => {
    const name = q.staffName || '미배정';
    if (!staffStats[name]) staffStats[name] = { sent:0, contracted:0, rejected:0 };
    if (q.status !== 'draft') staffStats[name].sent++;
    if (q.status === 'contracted') staffStats[name].contracted++;
    if (['rejected','closed'].includes(q.status)) staffStats[name].rejected++;
  });
  const staffRanking = Object.entries(staffStats)
    .map(([name, s]) => ({ name, ...s, rate: rate(s.contracted, s.sent) }))
    .sort((a, b) => b.contracted - a.contracted);

  // ── 월별 추이 (최근 6개월) ────────────────────
  const monthlyData = (() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const label = `${d.getMonth()+1}월`;
      const sent       = quotes.filter(q => q.createdAt?.startsWith(ym) && q.status !== 'draft').length;
      const contracted = quotes.filter(q => q.createdAt?.startsWith(ym) && q.status === 'contracted').length;
      months.push({ label, sent, contracted });
    }
    return months;
  })();

  const maxMonthly = Math.max(...monthlyData.map(m => m.sent), 1);

  // ── 거절 사유 분석 ────────────────────────────
  const rejectReasons = {};
  filteredQuotes.filter(q => q.rejectedCategory).forEach(q => {
    const r = q.rejectedCategory;
    rejectReasons[r] = (rejectReasons[r] || 0) + 1;
  });

  if (loading) return (
    <div style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>
      <div style={{ fontSize:24 }}>⏳</div>
      <div style={{ fontSize:14, marginTop:8 }}>데이터 불러오는 중...</div>
    </div>
  );

  return (
    <div style={S.wrap}>

      {/* 필터 */}
      <div style={S.filterRow}>
        <select value={period} onChange={e=>setPeriod(Number(e.target.value))} style={S.select}>
          <option value={1}>최근 1개월</option>
          <option value={3}>최근 3개월</option>
          <option value={6}>최근 6개월</option>
          <option value={12}>최근 12개월</option>
        </select>
        <select value={staffFilter} onChange={e=>setStaffFilter(e.target.value)} style={S.select}>
          <option value="all">전체 담당자</option>
          {staffList?.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <button style={S.refreshBtn} onClick={loadData}>🔄</button>
      </div>

      {/* 핵심 지표 4개 */}
      <div style={S.kpiGrid}>
        <KpiCard label="견적 발송" value={totalSent} sub="건" color="#3b82f6" icon="📤" />
        <KpiCard label="승인율" value={`${rate(totalApproved, totalSent)}%`} sub={`${totalApproved}건`} color="#10b981" icon="✅" />
        <KpiCard label="계약 전환" value={totalContracted} sub="건" color="#059669" icon="🎉" />
        <KpiCard label="전환율" value={`${rate(totalContracted, totalSent)}%`} sub={avgDays ? `평균 ${avgDays}일` : '-'} color="#7c3aed" icon="📊" />
      </div>

      {/* 파이프라인 퍼널 */}
      <Section title="🔽 견적 파이프라인">
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const count = stageCounts[stage.key] || 0;
            const prev  = i > 0 ? (stageCounts[PIPELINE_STAGES[i-1].key] || 0) : totalSent + stageCounts.draft;
            const pct   = totalSent > 0 ? Math.round(count / (totalSent + stageCounts.draft) * 100) : 0;
            const width = Math.max(pct, 5);
            return (
              <div key={stage.key}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:12, width:60, color:'#64748b', flexShrink:0 }}>{stage.icon} {stage.label}</span>
                  <div style={{ flex:1, background:'#f1f5f9', borderRadius:6, height:24, overflow:'hidden' }}>
                    <div style={{ width:`${width}%`, background:stage.color, height:'100%', borderRadius:6, display:'flex', alignItems:'center', paddingLeft:8, transition:'width 0.5s', minWidth:30 }}>
                      <span style={{ fontSize:11, color:'white', fontWeight:700 }}>{count}건</span>
                    </div>
                  </div>
                  <span style={{ fontSize:11, color:'#64748b', width:30, textAlign:'right' }}>{pct}%</span>
                </div>
                {i < PIPELINE_STAGES.length-1 && count > 0 && (
                  <div style={{ textAlign:'center', fontSize:10, color:'#94a3b8', marginBottom:2 }}>
                    ↓ 다음 단계 전환율: {rate(stageCounts[PIPELINE_STAGES[i+1]?.key]||0, count)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {totalRejected > 0 && (
          <div style={{ marginTop:8, padding:'8px 12px', background:'#fef2f2', borderRadius:8, fontSize:12, color:'#dc2626' }}>
            ❌ 거절/종료: {totalRejected}건 ({rate(totalRejected, totalSent+stageCounts.draft)}%)
          </div>
        )}
      </Section>

      {/* 계약 파이프라인 */}
      <Section title="📃 계약서 현황">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {CONTRACT_STAGES.map(s => (
            <div key={s.key} style={{ ...S.contractCard, background:s.bg, borderColor:s.color }}>
              <div style={{ fontSize:20, fontWeight:800, color:s.color }}>{contractStageCounts[s.key]||0}</div>
              <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        {totalSigned > 0 && (
          <div style={{ marginTop:8, fontSize:12, color:'#64748b', textAlign:'center' }}>
            서명→등록 전환율: <b style={{ color:'#059669' }}>{rate(totalRegistered, totalSigned)}%</b>
          </div>
        )}
      </Section>

      {/* 월별 추이 */}
      <Section title="📈 월별 추이 (최근 6개월)">
        <div style={{ display:'flex', gap:6, alignItems:'flex-end', height:100 }}>
          {monthlyData.map((m, i) => (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:80 }}>
                <div style={{ width:14, background:'#3b82f6', borderRadius:'3px 3px 0 0', height: `${Math.round(m.sent/maxMonthly*70)+5}px`, opacity:0.8 }} title={`발송 ${m.sent}건`} />
                <div style={{ width:14, background:'#059669', borderRadius:'3px 3px 0 0', height: `${Math.round(m.contracted/maxMonthly*70)+2}px` }} title={`계약 ${m.contracted}건`} />
              </div>
              <div style={{ fontSize:10, color:'#64748b' }}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:12, justifyContent:'center', marginTop:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'#64748b' }}>
            <div style={{ width:10, height:10, background:'#3b82f6', borderRadius:2 }} /> 견적 발송
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'#64748b' }}>
            <div style={{ width:10, height:10, background:'#059669', borderRadius:2 }} /> 계약 전환
          </div>
        </div>
      </Section>

      {/* 담당자별 실적 */}
      {staffRanking.length > 0 && (
        <Section title="👤 담당자별 실적">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4, fontSize:10, color:'#94a3b8', marginBottom:4, padding:'0 4px' }}>
            <span>담당자</span><span style={{ textAlign:'center' }}>발송/전환</span><span style={{ textAlign:'right' }}>전환율</span>
          </div>
          {staffRanking.map((s, i) => (
            <div key={s.name} style={S.staffRow}>
              <div style={{ display:'flex', alignItems:'center', gap:6, flex:1 }}>
                <span style={{ ...S.rankBadge, background: i===0?'#fbbf24':i===1?'#9ca3af':i===2?'#cd7c2f':'#e2e8f0', color: i<3?'white':'#64748b' }}>
                  {i+1}
                </span>
                <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>{s.name}</span>
              </div>
              <span style={{ fontSize:12, color:'#64748b' }}>{s.sent}건 / {s.contracted}건</span>
              <span style={{ fontSize:13, fontWeight:700, color: s.rate>=50?'#059669':s.rate>=30?'#f59e0b':'#64748b', minWidth:36, textAlign:'right' }}>
                {s.rate}%
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* 거절 사유 분석 */}
      {Object.keys(rejectReasons).length > 0 && (
        <Section title="❌ 거절 사유 분석">
          {Object.entries(rejectReasons)
            .sort((a,b)=>b[1]-a[1])
            .map(([reason, count]) => {
              const total = Object.values(rejectReasons).reduce((s,v)=>s+v,0);
              const pct = rate(count, total);
              return (
                <div key={reason} style={{ marginBottom:6 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                    <span style={{ fontSize:12, color:'#374151' }}>{reason}</span>
                    <span style={{ fontSize:12, color:'#94a3b8' }}>{count}건 ({pct}%)</span>
                  </div>
                  <div style={{ background:'#fee2e2', borderRadius:4, height:6 }}>
                    <div style={{ width:`${pct}%`, background:'#ef4444', height:'100%', borderRadius:4 }} />
                  </div>
                </div>
              );
            })
          }
        </Section>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background:'white', borderRadius:12, padding:'12px', textAlign:'center', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', border:`1px solid ${color}20` }}>
      <div style={{ fontSize:20 }}>{icon}</div>
      <div style={{ fontSize:22, fontWeight:800, color, margin:'4px 0 2px' }}>{value}</div>
      <div style={{ fontSize:11, color:'#64748b' }}>{label}</div>
      <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{sub}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background:'white', borderRadius:12, padding:'14px', marginBottom:10, boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize:14, fontWeight:700, color:'#1e293b', marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );
}

const S = {
  wrap:         { padding:'12px', paddingBottom:20 },
  filterRow:    { display:'flex', gap:8, marginBottom:12, alignItems:'center' },
  select:       { flex:1, padding:'8px 10px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12, outline:'none', background:'white' },
  refreshBtn:   { padding:'8px 10px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, cursor:'pointer' },
  kpiGrid:      { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:10 },
  contractCard: { borderRadius:10, padding:'10px', textAlign:'center', border:'1.5px solid' },
  staffRow:     { display:'flex', alignItems:'center', gap:8, padding:'8px 4px', borderBottom:'1px solid #f1f5f9' },
  rankBadge:    { width:20, height:20, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 },
};
