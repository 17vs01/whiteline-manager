import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatPrice, QUOTE_STATUS_EXTENDED } from './quoteConstants';

function QuoteHistory({ quoteCustomer, onClose, onOpenQuote }) {
  const [quotes, setQuotes] = useState([]);
  const [qnaMap, setQnaMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, [quoteCustomer.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'quotes'));
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(q => q.quoteCustomerId === quoteCustomer.id)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setQuotes(list);

      // QnA 로드
      const qnaSnap = await getDocs(collection(db, 'quoteQnA'));
      const qnaByQuote = {};
      qnaSnap.docs.forEach(d => {
        const data = { id: d.id, ...d.data() };
        if (!qnaByQuote[data.quoteId]) qnaByQuote[data.quoteId] = [];
        qnaByQuote[data.quoteId].push(data);
      });
      setQnaMap(qnaByQuote);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // 견적별 이벤트 타임라인 생성
  const buildTimeline = (quote) => {
    const events = [];
    if (quote.createdAt) events.push({ date: quote.createdAt, icon: '📝', label: '견적 작성', color: '#64748b', detail: `${quote.createdBy} · ${quote.title}` });
    if (quote.status !== 'draft' && quote.updatedAt) events.push({ date: quote.updatedAt, icon: '📤', label: '발송 완료', color: '#3b82f6', detail: '고객에게 링크 공유' });
    if (quote.viewedAt) events.push({ date: quote.viewedAt, icon: '👁️', label: '고객 열람', color: '#8b5cf6', detail: '고객이 견적서를 확인했습니다' });
    if (quote.reQuoteRequest?.requestedAt) events.push({ date: quote.reQuoteRequest.requestedAt, icon: '🔄', label: '재견적 요청', color: '#f59e0b', detail: quote.reQuoteRequest.message || '고객 수정 요청' });
    if (quote.approvedAt) events.push({ date: quote.approvedAt, icon: '✅', label: '견적 승인', color: '#10b981', detail: '고객이 견적을 승인했습니다' });
    if (quote.rejectedAt) events.push({ date: quote.rejectedAt, icon: '❌', label: '견적 거절', color: '#ef4444', detail: quote.rejectedReason ? `사유: ${quote.rejectedReason}` : '거절' });
    if (quote.contractRequestedAt) events.push({ date: quote.contractRequestedAt, icon: '🎉', label: '계약 요청', color: '#f59e0b', detail: '고객이 계약을 요청했습니다' });
    // QnA 이벤트
    (qnaMap[quote.id] || []).forEach(qa => {
      events.push({ date: qa.createdAt, icon: '💬', label: 'Q&A 질문', color: '#0ea5e9', detail: qa.question });
      if (qa.answeredAt) events.push({ date: qa.answeredAt, icon: '💬', label: 'Q&A 답변', color: '#10b981', detail: qa.answer });
    });
    return events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  };

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <div style={hs.overlay}>
      <div style={hs.panel}>
        <div style={hs.header}>
          <div>
            <div style={hs.title}>📋 견적 이력</div>
            <div style={hs.subtitle}>{quoteCustomer.custName}</div>
          </div>
          <button onClick={onClose} style={hs.closeBtn}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>로딩 중...</div>
        ) : quotes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>견적 이력이 없습니다.</div>
        ) : (
          <div style={hs.content}>
            {/* 요약 */}
            <div style={hs.summary}>
              <div style={hs.summaryItem}>
                <div style={hs.summaryVal}>{quotes.length}</div>
                <div style={hs.summaryLabel}>총 견적</div>
              </div>
              <div style={hs.summaryItem}>
                <div style={{ ...hs.summaryVal, color: '#10b981' }}>{quotes.filter(q=>['approved','contracted'].includes(q.status)).length}</div>
                <div style={hs.summaryLabel}>승인</div>
              </div>
              <div style={hs.summaryItem}>
                <div style={{ ...hs.summaryVal, color: '#ef4444' }}>{quotes.filter(q=>q.status==='rejected').length}</div>
                <div style={hs.summaryLabel}>거절</div>
              </div>
              <div style={hs.summaryItem}>
                <div style={{ ...hs.summaryVal, color: '#f59e0b' }}>{quotes.filter(q=>q.status==='contracted').length}</div>
                <div style={hs.summaryLabel}>계약</div>
              </div>
            </div>

            {/* 견적별 타임라인 */}
            {quotes.map((quote, qi) => {
              const st = QUOTE_STATUS_EXTENDED[quote.status] || QUOTE_STATUS_EXTENDED.draft;
              const timeline = buildTimeline(quote);
              return (
                <div key={quote.id} style={hs.quoteBlock}>
                  {/* 견적 헤더 */}
                  <div style={hs.quoteHeader} onClick={() => onOpenQuote && onOpenQuote(quote.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ ...hs.statusBadge, color: st.color, background: st.bg }}>
                        {st.icon} {st.label}
                      </span>
                      <span style={hs.quoteTitle}>{quote.title || `${qi+1}안`}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {quote.monthlyTotal > 0 && (
                        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#10b981' }}>
                          {formatPrice(quote.monthlyTotal)}/월
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {quote.createdAt?.split('T')[0]}
                      </div>
                    </div>
                  </div>

                  {/* 타임라인 이벤트 */}
                  <div style={hs.timeline}>
                    {timeline.map((ev, ei) => (
                      <div key={ei} style={hs.timelineItem}>
                        <div style={{ ...hs.timelineDot, background: ev.color }}>
                          <span style={{ fontSize: '10px' }}>{ev.icon}</span>
                        </div>
                        {ei < timeline.length - 1 && <div style={hs.timelineLine} />}
                        <div style={hs.timelineContent}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: 'bold', color: ev.color }}>{ev.label}</span>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{formatDate(ev.date)}</span>
                          </div>
                          {ev.detail && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{ev.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const hs = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 },
  panel: { background: 'white', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '600px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f' },
  subtitle: { fontSize: '13px', color: '#64748b', marginTop: '2px' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '14px' },
  content: { overflowY: 'auto', padding: '16px', flex: 1 },
  summary: { display: 'flex', gap: '8px', marginBottom: '16px' },
  summaryItem: { flex: 1, background: '#f8fafc', borderRadius: '10px', padding: '12px', textAlign: 'center' },
  summaryVal: { fontSize: '22px', fontWeight: 'bold', color: '#1e3a5f' },
  summaryLabel: { fontSize: '11px', color: '#94a3b8', marginTop: '2px' },
  quoteBlock: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '12px', overflow: 'hidden' },
  quoteHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'white', cursor: 'pointer', borderBottom: '1px solid #f1f5f9' },
  statusBadge: { padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold' },
  quoteTitle: { fontSize: '14px', fontWeight: 'bold', color: '#1e293b' },
  timeline: { padding: '12px 14px' },
  timelineItem: { display: 'flex', gap: '10px', position: 'relative', marginBottom: '12px' },
  timelineDot: { width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1 },
  timelineLine: { position: 'absolute', left: '13px', top: '28px', bottom: '-12px', width: '2px', background: '#e2e8f0', zIndex: 0 },
  timelineContent: { flex: 1, paddingTop: '4px' },
};

export default QuoteHistory;
