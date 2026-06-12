import React, { useState, useEffect } from 'react';
import {
  collection, onSnapshot, doc, updateDoc,
  query, orderBy, where, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';

const STAR = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];
const STAR_COLOR = ['', '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e'];

export default function ReviewPanel({ currentUser, onClose }) {
  const [reviews,   setReviews]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('all'); // all | 5 | 4 | 3 | 2 | 1
  const [stats,     setStats]     = useState({ avg: 0, total: 0, counts: {} });

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'customerReviews'), orderBy('createdAt', 'desc')),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setReviews(list);
        calcStats(list);
        setLoading(false);
      },
      err => { console.error('리뷰 로드 오류:', err); setLoading(false); }
    );
    return unsub;
  }, []);

  const calcStats = (list) => {
    if (list.length === 0) { setStats({ avg: 0, total: 0, counts: {} }); return; }
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let sum = 0;
    list.forEach(r => {
      const s = r.star || 5;
      counts[s] = (counts[s] || 0) + 1;
      sum += s;
    });
    setStats({ avg: (sum / list.length).toFixed(1), total: list.length, counts });
  };

  const filtered = filter === 'all' ? reviews : reviews.filter(r => String(r.star) === filter);

  const formatDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  return (
    <div style={S.wrap}>
      {/* 헤더 */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={{ fontSize: 18 }}>⭐</span>
          <span style={S.headerTitle}>고객 리뷰</span>
        </div>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>

      {loading ? (
        <div style={S.center}><div style={{ color: '#94a3b8' }}>불러오는 중...</div></div>
      ) : (
        <div style={S.body}>
          {/* 통계 카드 */}
          <div style={S.statsCard}>
            <div style={S.avgWrap}>
              <div style={S.avgNum}>{stats.avg || '—'}</div>
              <div style={S.avgLabel}>평균 별점</div>
              <div style={{ color: '#f59e0b', fontSize: 18, marginTop: 2 }}>
                {'★'.repeat(Math.round(Number(stats.avg || 0)))}
              </div>
            </div>
            <div style={S.barWrap}>
              {[5, 4, 3, 2, 1].map(n => {
                const cnt = stats.counts[n] || 0;
                const pct = stats.total ? Math.round((cnt / stats.total) * 100) : 0;
                return (
                  <div key={n} style={S.barRow}>
                    <span style={{ fontSize: 11, color: '#64748b', width: 10 }}>{n}</span>
                    <div style={S.barBg}>
                      <div style={{ ...S.barFill, width: `${pct}%`, background: STAR_COLOR[n] }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#64748b', width: 24, textAlign: 'right' }}>{cnt}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 필터 */}
          <div style={S.filterRow}>
            {['all', '5', '4', '3', '2', '1'].map(f => (
              <button
                key={f}
                style={{ ...S.filterBtn, ...(filter === f ? S.filterBtnActive : {}) }}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? `전체 ${stats.total}` : `${f}점 ${stats.counts[f] || 0}`}
              </button>
            ))}
          </div>

          {/* 리뷰 목록 */}
          {filtered.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>⭐</div>
              <div style={{ color: '#94a3b8', marginTop: 8, fontSize: 14 }}>리뷰가 없어요</div>
            </div>
          ) : (
            filtered.map(r => (
              <div key={r.id} style={S.card}>
                <div style={S.cardTop}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{r.customerName || '고객'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                      {r.visitDate || ''}{r.staffName ? ` · ${r.staffName}` : ''} · {formatDate(r.createdAt)}
                    </div>
                  </div>
                  <div style={{ color: STAR_COLOR[r.star || 5], fontSize: 14, fontWeight: 700 }}>
                    {STAR[r.star || 5]} {r.star || 5}점
                  </div>
                </div>
                {r.comment && (
                  <div style={S.comment}>{r.comment}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  wrap:          { display: 'flex', flexDirection: 'column', height: '100%', background: '#f8fafc' },
  header:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: '#1e40af', color: 'white', flexShrink: 0 },
  headerLeft:    { display: 'flex', alignItems: 'center', gap: 8 },
  headerTitle:   { fontSize: 16, fontWeight: 700 },
  closeBtn:      { background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 14 },
  body:          { flex: 1, overflowY: 'auto', padding: 14 },
  center:        { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 },
  statsCard:     { background: 'white', borderRadius: 12, padding: '14px 16px', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', display: 'flex', gap: 16, alignItems: 'center' },
  avgWrap:       { textAlign: 'center', flexShrink: 0 },
  avgNum:        { fontSize: 36, fontWeight: 800, color: '#1e293b', lineHeight: 1 },
  avgLabel:      { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  barWrap:       { flex: 1 },
  barRow:        { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 },
  barBg:         { flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' },
  barFill:       { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  filterRow:     { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  filterBtn:     { padding: '5px 10px', borderRadius: 20, border: '1px solid #e2e8f0', background: 'white', fontSize: 12, color: '#64748b', cursor: 'pointer' },
  filterBtnActive: { background: '#1e40af', color: 'white', borderColor: '#1e40af' },
  card:          { background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTop:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  comment:       { fontSize: 13, color: '#374151', lineHeight: 1.6, background: '#f8fafc', borderRadius: 8, padding: '8px 10px' },
};
