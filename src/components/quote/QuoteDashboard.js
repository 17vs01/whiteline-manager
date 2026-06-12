import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatPrice, BUSINESS_TYPES } from './quoteConstants';

function QuoteDashboard({ currentUser, staffList, onOpenCustomer }) {
  const [quotes, setQuotes]       = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [period, setPeriod]       = useState('month'); // 'month' | 'quarter' | 'year'

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [qSnap, cSnap] = await Promise.all([
        getDocs(collection(db, 'quotes')),
        getDocs(collection(db, 'quoteCustomers')),
      ]);
      setQuotes(qSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCustomers(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // 기간 필터
  const now = new Date();
  const filterByPeriod = (list, dateField = 'createdAt') => {
    return list.filter(item => {
      if (!item[dateField]) return false;
      const d = new Date(item[dateField]);
      if (period === 'month')   return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (period === 'quarter') return Math.floor(d.getMonth()/3) === Math.floor(now.getMonth()/3) && d.getFullYear() === now.getFullYear();
      if (period === 'year')    return d.getFullYear() === now.getFullYear();
      return true;
    });
  };

  const filteredQuotes    = filterByPeriod(quotes);
  const filteredCustomers = filterByPeriod(customers);

  // 통계 계산
  const totalQuotes     = filteredQuotes.length;
  const sentQuotes      = filteredQuotes.filter(q => ['sent','viewed','approved','contracted','rejected'].includes(q.status));
  const viewedQuotes    = filteredQuotes.filter(q => q.viewedAt);
  const approvedQuotes  = filteredQuotes.filter(q => q.status === 'approved' || q.status === 'contracted');
  const rejectedQuotes  = filteredQuotes.filter(q => q.status === 'rejected');
  const contractedQuotes= filteredQuotes.filter(q => q.status === 'contracted');
  const viewRate        = sentQuotes.length > 0 ? Math.round(viewedQuotes.length / sentQuotes.length * 100) : 0;
  const approveRate     = sentQuotes.length > 0 ? Math.round(approvedQuotes.length / sentQuotes.length * 100) : 0;
  const contractRate    = sentQuotes.length > 0 ? Math.round(contractedQuotes.length / sentQuotes.length * 100) : 0;
  const avgMonthly      = filteredQuotes.length > 0
    ? Math.round(filteredQuotes.reduce((s, q) => s + (q.monthlyTotal || 0), 0) / filteredQuotes.filter(q=>q.monthlyTotal>0).length || 0)
    : 0;
  const totalAnnual     = filteredQuotes.reduce((s, q) => {
    const im = q.hasInitial ? (q.initialMonths || 2) : 0;
    return s + im * (q.initialTotal || 0) + (12 - im) * (q.monthlyTotal || 0);
  }, 0);

  // 담당자별 통계
  const staffStats = staffList.map(s => {
    const myQuotes = filteredQuotes.filter(q => q.createdBy === s.name);
    const myContracted = myQuotes.filter(q => q.status === 'contracted').length;
    const myApproved = myQuotes.filter(q => ['approved','contracted'].includes(q.status)).length;
    return {
      ...s,
      total: myQuotes.length,
      sent: myQuotes.filter(q => q.status !== 'draft').length,
      approved: myApproved,
      contracted: myContracted,
      rate: myQuotes.filter(q=>q.status!=='draft').length > 0
        ? Math.round(myApproved / myQuotes.filter(q=>q.status!=='draft').length * 100) : 0,
      totalAnnual: myQuotes.reduce((s2, q) => {
        const im = q.hasInitial ? (q.initialMonths||2) : 0;
        return s2 + im*(q.initialTotal||0) + (12-im)*(q.monthlyTotal||0);
      }, 0),
    };
  }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);

  // 거절 사유 통계
  const rejectStats = rejectedQuotes.reduce((acc, q) => {
    const cat = q.rejectedCategory || 'direct';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});
  const rejectLabels = { price:'금액 문제', other:'타업체 계약', timing:'시기상조', review:'내부 검토', scope:'서비스 범위', direct:'기타' };

  // 월별 추이 (최근 6개월)
  const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const m = d.getMonth(), y = d.getFullYear();
    const mQuotes = quotes.filter(q => {
      if (!q.createdAt) return false;
      const qd = new Date(q.createdAt);
      return qd.getMonth() === m && qd.getFullYear() === y;
    });
    return {
      label: `${m+1}월`,
      total: mQuotes.length,
      contracted: mQuotes.filter(q => q.status === 'contracted').length,
    };
  });
  const maxTrend = Math.max(...monthlyTrend.map(m => m.total), 1);

  if (loading) return <div style={s.loading}>로딩 중...</div>;

  return (
    <div style={s.container}>
      {/* 기간 선택 */}
      <div style={s.periodRow}>
        {[['month','이번 달'],['quarter','이번 분기'],['year','올해']].map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)}
            style={{ ...s.periodBtn, ...(period===v ? s.periodBtnActive : {}) }}>{l}</button>
        ))}
        <button onClick={fetchData} style={s.refreshBtn}>🔄</button>
      </div>

      {/* 핵심 지표 카드 */}
      <div style={s.statsGrid}>
        <StatCard icon="📄" label="총 견적 수" value={totalQuotes} unit="건" color="#3b82f6" />
        <StatCard icon="📤" label="발송 완료" value={sentQuotes.length} unit="건" color="#8b5cf6" />
        <StatCard icon="👁️" label="열람률" value={viewRate} unit="%" color="#0ea5e9" />
        <StatCard icon="✅" label="승인률" value={approveRate} unit="%" color="#10b981" />
        <StatCard icon="🎉" label="계약전환률" value={contractRate} unit="%" color="#f59e0b" />
        <StatCard icon="💰" label="평균 월 금액" value={avgMonthly > 0 ? Math.round(avgMonthly/10000) : 0} unit="만원" color="#ef4444" />
      </div>

      {/* 연간 예상 매출 */}
      {totalAnnual > 0 && (
        <div style={s.annualBox}>
          <span style={s.annualLabel}>📆 기간 내 견적 연간 총계</span>
          <span style={s.annualValue}>{formatPrice(totalAnnual)}</span>
        </div>
      )}

      {/* 월별 추이 차트 */}
      <div style={s.section}>
        <div style={s.sectionTitle}>📈 월별 견적 추이 (최근 6개월)</div>
        <div style={s.chart}>
          {monthlyTrend.map((m, i) => (
            <div key={i} style={s.chartCol}>
              <div style={s.chartBarWrap}>
                <div style={{ ...s.chartBar, height: `${Math.round(m.total/maxTrend*80)}px`, background: '#3b82f6' }}>
                  {m.total > 0 && <span style={s.barLabel}>{m.total}</span>}
                </div>
                {m.contracted > 0 && (
                  <div style={{ ...s.chartBar, height: `${Math.round(m.contracted/maxTrend*80)}px`, background: '#10b981', position: 'absolute', bottom: 0 }}>
                  </div>
                )}
              </div>
              <div style={s.chartMonth}>{m.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:'16px', fontSize:'11px', color:'#64748b', justifyContent:'flex-end', marginTop:'6px' }}>
          <span><span style={{ display:'inline-block', width:'10px', height:'10px', background:'#3b82f6', borderRadius:'2px', marginRight:'4px' }}/>견적</span>
          <span><span style={{ display:'inline-block', width:'10px', height:'10px', background:'#10b981', borderRadius:'2px', marginRight:'4px' }}/>계약전환</span>
        </div>
      </div>

      {/* 담당자별 성과 */}
      {staffStats.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>👤 담당자별 성과</div>
          <table style={s.table}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                <th style={s.th}>담당자</th>
                <th style={s.th}>견적</th>
                <th style={s.th}>발송</th>
                <th style={s.th}>승인</th>
                <th style={s.th}>계약</th>
                <th style={s.th}>전환율</th>
                <th style={s.th}>연간 예상</th>
              </tr>
            </thead>
            <tbody>
              {staffStats.map((st, i) => (
                <tr key={st.id || i} style={{ background: i%2?'#f8fafc':'white' }}>
                  <td style={s.td}><b>{st.name}</b></td>
                  <td style={{ ...s.tdC, color:'#3b82f6', fontWeight:'bold' }}>{st.total}</td>
                  <td style={s.tdC}>{st.sent}</td>
                  <td style={{ ...s.tdC, color:'#10b981' }}>{st.approved}</td>
                  <td style={{ ...s.tdC, color:'#f59e0b', fontWeight:'bold' }}>{st.contracted}</td>
                  <td style={{ ...s.tdC }}>
                    <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:'bold',
                      background: st.rate>=50?'#d1fae5':st.rate>=30?'#fef3c7':'#fee2e2',
                      color: st.rate>=50?'#065f46':st.rate>=30?'#92400e':'#991b1b' }}>
                      {st.rate}%
                    </span>
                  </td>
                  <td style={{ ...s.tdC, color:'#1e3a5f', fontWeight:'bold', fontSize:'12px' }}>
                    {st.totalAnnual > 0 ? `${Math.round(st.totalAnnual/10000)}만원` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 거절 사유 분석 */}
      {rejectedQuotes.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>❌ 거절 사유 분석</div>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {Object.entries(rejectStats).sort((a,b)=>b[1]-a[1]).map(([cat, count]) => (
              <div key={cat} style={s.rejectRow}>
                <span style={s.rejectLabel}>{rejectLabels[cat] || cat}</span>
                <div style={s.rejectBar}>
                  <div style={{ ...s.rejectFill, width:`${Math.round(count/rejectedQuotes.length*100)}%` }} />
                </div>
                <span style={s.rejectCount}>{count}건 ({Math.round(count/rejectedQuotes.length*100)}%)</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize:'12px', color:'#94a3b8', marginTop:'8px' }}>
            💡 가장 많은 거절 사유를 참고해 견적 전략을 개선해보세요.
          </div>
        </div>
      )}

      {/* 최근 견적 활동 */}
      <div style={s.section}>
        <div style={s.sectionTitle}>🕐 최근 견적 활동</div>
        {filteredQuotes.slice(0,8).map((q, i) => {
          const statusMap = { draft:'📝', sent:'📤', viewed:'👁️', approved:'✅', rejected:'❌', contracted:'🎉', expired:'⏰', reQuote:'🔄' };
          return (
            <div key={q.id} style={{ ...s.activityRow, background: i%2?'#f8fafc':'white' }}>
              <span style={{ fontSize:'16px' }}>{statusMap[q.status]||'📄'}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:'13px', fontWeight:'bold', color:'#1e293b' }}>{q.custName}</div>
                <div style={{ fontSize:'11px', color:'#94a3b8' }}>{q.title} · {q.createdBy}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:'12px', fontWeight:'bold', color:'#10b981' }}>
                  {q.monthlyTotal > 0 ? formatPrice(q.monthlyTotal)+'/월' : '-'}
                </div>
                <div style={{ fontSize:'11px', color:'#94a3b8' }}>{q.createdAt?.split('T')[0]}</div>
              </div>
            </div>
          );
        })}
        {filteredQuotes.length === 0 && (
          <div style={{ textAlign:'center', color:'#94a3b8', padding:'20px', fontSize:'13px' }}>이 기간에 견적이 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, unit, color }) {
  return (
    <div style={{ background:'white', borderRadius:'12px', padding:'14px 16px', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', borderTop:`3px solid ${color}` }}>
      <div style={{ fontSize:'20px', marginBottom:'6px' }}>{icon}</div>
      <div style={{ fontSize:'22px', fontWeight:'bold', color }}>{value}<span style={{ fontSize:'14px', fontWeight:'normal', color:'#64748b', marginLeft:'2px' }}>{unit}</span></div>
      <div style={{ fontSize:'12px', color:'#64748b', marginTop:'2px' }}>{label}</div>
    </div>
  );
}

const s = {
  container: { paddingBottom:'20px' },
  loading: { textAlign:'center', padding:'40px', color:'#64748b' },
  periodRow: { display:'flex', gap:'6px', marginBottom:'14px', alignItems:'center' },
  periodBtn: { padding:'7px 14px', border:'1px solid #e2e8f0', borderRadius:'20px', background:'white', cursor:'pointer', fontSize:'13px', color:'#64748b' },
  periodBtnActive: { background:'#1e3a5f', color:'white', border:'1px solid #1e3a5f', fontWeight:'bold' },
  refreshBtn: { marginLeft:'auto', padding:'7px 12px', border:'1px solid #e2e8f0', borderRadius:'8px', background:'white', cursor:'pointer', fontSize:'14px' },
  statsGrid: { display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'10px', marginBottom:'12px' },
  annualBox: { display:'flex', justifyContent:'space-between', alignItems:'center', background:'#1e3a5f', borderRadius:'10px', padding:'12px 16px', marginBottom:'12px' },
  annualLabel: { color:'#94a3b8', fontSize:'13px' },
  annualValue: { color:'#fbbf24', fontSize:'20px', fontWeight:'bold' },
  section: { background:'white', borderRadius:'12px', padding:'14px 16px', marginBottom:'12px', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' },
  sectionTitle: { fontSize:'14px', fontWeight:'bold', color:'#1e3a5f', marginBottom:'12px', paddingBottom:'8px', borderBottom:'1px solid #f1f5f9' },
  chart: { display:'flex', gap:'6px', alignItems:'flex-end', height:'100px', padding:'0 4px' },
  chartCol: { flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' },
  chartBarWrap: { position:'relative', width:'100%', display:'flex', justifyContent:'center', alignItems:'flex-end', flex:1 },
  chartBar: { width:'70%', borderRadius:'4px 4px 0 0', minHeight:'4px', display:'flex', alignItems:'flex-start', justifyContent:'center' },
  barLabel: { fontSize:'10px', color:'white', fontWeight:'bold', marginTop:'2px' },
  chartMonth: { fontSize:'11px', color:'#64748b' },
  table: { width:'100%', borderCollapse:'collapse', fontSize:'13px' },
  th: { padding:'8px 10px', textAlign:'center', fontWeight:'bold', color:'#374151', borderBottom:'1px solid #e2e8f0', fontSize:'12px' },
  td: { padding:'8px 10px', borderBottom:'1px solid #f1f5f9', color:'#374151' },
  tdC: { padding:'8px 10px', textAlign:'center', borderBottom:'1px solid #f1f5f9', color:'#374151' },
  rejectRow: { display:'flex', alignItems:'center', gap:'10px', fontSize:'13px' },
  rejectLabel: { minWidth:'90px', color:'#374151', fontSize:'12px' },
  rejectBar: { flex:1, height:'16px', background:'#f1f5f9', borderRadius:'8px', overflow:'hidden' },
  rejectFill: { height:'100%', background:'#ef4444', borderRadius:'8px', transition:'width 0.3s' },
  rejectCount: { minWidth:'80px', textAlign:'right', fontSize:'12px', color:'#64748b' },
  activityRow: { display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderBottom:'1px solid #f8fafc' },
};

export default QuoteDashboard;
