import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, doc, updateDoc,
  query, orderBy, where, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { sendPushToCustomer } from '../utils/customerPush';
import Swal from 'sweetalert2';

const STATUS_LIST = [
  { key: 'all',        label: '전체',    color: '#64748b' },
  { key: 'pending',    label: '미처리',  color: '#f59e0b' },
  { key: 'inProgress', label: '처리중',  color: '#2563eb' },
  { key: 'done',       label: '완료',    color: '#059669' },
];

const TYPE_INFO = {
  inquiry: { label: '💬 일반 문의',  bg: '#eff6ff', color: '#2563eb' },
  claim:   { label: '🚨 클레임',     bg: '#fef2f2', color: '#dc2626' },
  praise:  { label: '⭐ 칭찬',       bg: '#fffbeb', color: '#d97706' },
  payment: { label: '💳 결제 문의',  bg: '#f0fdf4', color: '#059669' },
  pest:    { label: '🐛 해충 문의',  bg: '#f5f3ff', color: '#7c3aed' },
};

export default function CustomerInquiryPanel({ currentUser, onClose }) {
  const [inquiries,  setInquiries]  = useState([]);
  const [filter,     setFilter]     = useState('all');
  const [selected,   setSelected]   = useState(null);
  const [reply,      setReply]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading,    setLoading]    = useState(true);

  // ── 실시간 문의 구독 ──────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'customerInquiries'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setInquiries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      console.error('문의 로드 오류:', err);
      setLoading(false);
    });
    return unsub;
  }, []);

  // ── 필터링 ────────────────────────────────────
  const filtered = filter === 'all'
    ? inquiries
    : inquiries.filter(q => q.status === filter);

  // ── 미처리 건수 ───────────────────────────────
  const pendingCount = inquiries.filter(q => q.status === 'pending').length;

  // ── 상태 변경 ─────────────────────────────────
  const handleStatusChange = async (id, status) => {
    try {
      await updateDoc(doc(db, 'customerInquiries', id), {
        status,
        updatedAt: new Date().toISOString(),
      });
      if (selected?.id === id) setSelected(prev => ({ ...prev, status }));
    } catch(e) {
      console.error(e);
    }
  };

  // ── 답변 저장 ─────────────────────────────────
  const handleReply = async () => {
    if (!reply.trim()) { Swal.fire('알림', '답변 내용을 입력해주세요.', 'warning'); return; }
    if (!selected) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'customerInquiries', selected.id), {
        reply:      reply.trim(),
        repliedAt:  new Date().toISOString(),
        repliedBy:  currentUser?.name || currentUser?.email || '',
        status:     'done',
        updatedAt:  new Date().toISOString(),
      });
      setSelected(prev => ({ ...prev, reply: reply.trim(), status: 'done' }));
      setReply('');

      // 고객에게 푸시 알림 발송
      try {
        await sendPushToCustomer(selected.customerId, {
          title: '💬 문의 답변이 등록됐어요',
          body:  `"${selected.title}"에 대한 답변을 확인해보세요.`,
          data:  { type: 'reply', inquiryId: selected.id },
        });
      } catch(e) { console.warn('푸시 발송 실패:', e); }

      Swal.fire({ icon:'success', title:'답변 완료!', timer:1200, showConfirmButton:false });
    } catch(e) {
      console.error(e);
      Swal.fire('오류', '잠시 후 다시 시도해주세요.', 'error');
    }
    setSubmitting(false);
  };

  const statusColor = (s) => ({
    pending:    '#f59e0b',
    inProgress: '#2563eb',
    done:       '#059669',
  }[s] || '#64748b');

  const statusLabel = (s) => ({
    pending:    '미처리',
    inProgress: '처리중',
    done:       '완료',
  }[s] || s);

  const formatDate = (str) => {
    if (!str) return '';
    const d = new Date(str);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    if (isToday) return d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
    return d.toLocaleDateString('ko-KR', { month:'short', day:'numeric' });
  };

  // ── 상세 뷰 ─────────────────────────────────
  if (selected) {
    const t = TYPE_INFO[selected.type] || TYPE_INFO.inquiry;
    return (
      <div style={S.wrap}>
        {/* 헤더 */}
        <div style={S.header}>
          <button style={S.backBtn} onClick={() => { setSelected(null); setReply(''); }}>← 목록</button>
          <div style={{ flex:1, fontSize:15, fontWeight:700 }}>문의 상세</div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.detailBody}>
          {/* 유형 + 상태 */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <span style={{ ...S.typeBadge, background:t.bg, color:t.color }}>{t.label}</span>
            <select
              value={selected.status || 'pending'}
              onChange={e => handleStatusChange(selected.id, e.target.value)}
              style={{ ...S.statusSelect, color: statusColor(selected.status) }}
            >
              {STATUS_LIST.filter(s => s.key !== 'all').map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* 제목 */}
          <div style={S.detailTitle}>{selected.title}</div>
          <div style={S.detailMeta}>
            {selected.customerName} · {selected.staffName && `담당: ${selected.staffName} · `}
            {formatDate(selected.createdAt)}
          </div>

          {/* 내용 */}
          <div style={S.detailContent}>{selected.content}</div>

          {/* 사진 */}
          {selected.images?.length > 0 && (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
              {selected.images.map((img, i) => (
                <img key={i} src={img} alt="" style={S.detailImg}
                  onClick={() => window.open(img, '_blank')} />
              ))}
            </div>
          )}

          {/* 해충 AI 분석 결과 */}
          {selected.pestResult?.found && (
            <div style={S.pestBox}>
              <div style={{ fontSize:13, fontWeight:700, color:'#7c3aed', marginBottom:6 }}>
                🐛 AI 해충 분석 결과
              </div>
              <div style={{ fontSize:13, color:'#374151' }}>
                <b>해충명:</b> {selected.pestResult.name}<br/>
                <b>위험도:</b> {selected.pestResult.riskLevel}<br/>
                {selected.pestResult.description}
              </div>
              {selected.pestResult.needProfessional && (
                <div style={{ marginTop:6, fontSize:12, color:'#dc2626', fontWeight:600 }}>
                  ⚠️ 전문 방역 필요: {selected.pestResult.professionalReason}
                </div>
              )}
            </div>
          )}

          {/* 기존 답변 */}
          {selected.reply && (
            <div style={S.replyBox}>
              <div style={{ fontSize:12, fontWeight:700, color:'#2563eb', marginBottom:6 }}>
                💬 답변 ({selected.repliedBy} · {formatDate(selected.repliedAt)})
              </div>
              <div style={{ fontSize:14, color:'#374151', lineHeight:1.7 }}>{selected.reply}</div>
            </div>
          )}

          {/* 답변 작성 */}
          <div style={S.replyWrite}>
            <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:8 }}>
              {selected.reply ? '답변 수정' : '답변 작성'}
            </div>
            <textarea
              style={S.textarea}
              placeholder="고객에게 전달할 답변을 입력해주세요"
              value={reply}
              onChange={e => setReply(e.target.value)}
              rows={4}
            />
            <button
              style={{ ...S.replyBtn, opacity: submitting ? 0.7 : 1 }}
              onClick={handleReply}
              disabled={submitting}
            >
              {submitting ? '저장 중...' : selected.reply ? '답변 수정' : '답변 저장'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 뷰 ─────────────────────────────────
  return (
    <div style={S.wrap}>
      {/* 헤더 */}
      <div style={S.header}>
        <div style={{ fontSize:16, fontWeight:700, flex:1 }}>
          고객 문의
          {pendingCount > 0 && (
            <span style={S.pendingBadge}>{pendingCount}</span>
          )}
        </div>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* 필터 탭 */}
      <div style={S.filterRow}>
        {STATUS_LIST.map(s => (
          <button key={s.key}
            style={{ ...S.filterBtn, ...(filter === s.key ? { background: s.color, color:'white' } : {}) }}
            onClick={() => setFilter(s.key)}>
            {s.label}
            {s.key !== 'all' && (
              <span style={{ marginLeft:4, fontSize:11 }}>
                ({inquiries.filter(q => q.status === s.key).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div style={S.listBody}>
        {loading ? (
          <div style={S.empty}><div style={{ fontSize:24 }}>⏳</div><div>불러오는 중...</div></div>
        ) : filtered.length === 0 ? (
          <div style={S.empty}><div style={{ fontSize:32 }}>💬</div><div style={{ marginTop:8 }}>문의가 없어요</div></div>
        ) : (
          filtered.map(q => {
            const t = TYPE_INFO[q.type] || TYPE_INFO.inquiry;
            return (
              <div key={q.id} style={S.card} onClick={() => { setSelected(q); setReply(q.reply || ''); }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                  <span style={{ ...S.typeBadge, background:t.bg, color:t.color, fontSize:11 }}>{t.label}</span>
                  <span style={{ fontSize:11, color: statusColor(q.status), fontWeight:600 }}>
                    {statusLabel(q.status)}
                  </span>
                </div>
                <div style={{ fontSize:14, fontWeight:600, color:'#1e293b', marginBottom:2 }}>{q.title}</div>
                <div style={{ fontSize:12, color:'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {q.content}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
                  <span style={{ fontSize:11, color:'#94a3b8' }}>
                    {q.customerName}{q.staffName ? ` · ${q.staffName}` : ''}
                  </span>
                  <span style={{ fontSize:11, color:'#94a3b8' }}>{formatDate(q.createdAt)}</span>
                </div>
                {q.reply && (
                  <div style={{ fontSize:11, color:'#2563eb', marginTop:4 }}>💬 답변 완료</div>
                )}
                {q.images?.length > 0 && (
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>📷 사진 {q.images.length}장</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const S = {
  wrap:         { display:'flex', flexDirection:'column', height:'100%', background:'#f8fafc' },
  header:       { display:'flex', alignItems:'center', gap:8, padding:'14px 16px', background:'white', borderBottom:'1px solid #e2e8f0', flexShrink:0 },
  backBtn:      { background:'none', border:'none', color:'#64748b', fontSize:14, padding:'0 8px 0 0', cursor:'pointer' },
  closeBtn:     { background:'none', border:'none', color:'#94a3b8', fontSize:18, padding:'4px', cursor:'pointer' },
  filterRow:    { display:'flex', gap:6, padding:'10px 16px', background:'white', borderBottom:'1px solid #e2e8f0', overflowX:'auto', flexShrink:0 },
  filterBtn:    { padding:'5px 12px', border:'1px solid #e2e8f0', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer', background:'white', color:'#64748b', whiteSpace:'nowrap' },
  listBody:     { flex:1, overflowY:'auto', padding:'12px' },
  card:         { background:'white', borderRadius:12, padding:'12px 14px', marginBottom:8, boxShadow:'0 1px 4px rgba(0,0,0,0.06)', cursor:'pointer' },
  typeBadge:    { display:'inline-block', padding:'3px 8px', borderRadius:20, fontSize:12, fontWeight:600 },
  empty:        { textAlign:'center', padding:'48px 0', color:'#94a3b8', fontSize:14 },
  pendingBadge: { display:'inline-block', background:'#ef4444', color:'white', borderRadius:20, fontSize:11, fontWeight:700, padding:'1px 7px', marginLeft:8 },
  detailBody:   { flex:1, overflowY:'auto', padding:'16px' },
  detailTitle:  { fontSize:17, fontWeight:700, color:'#1e293b', margin:'8px 0 4px' },
  detailMeta:   { fontSize:12, color:'#94a3b8', marginBottom:12 },
  detailContent:{ fontSize:14, color:'#374151', lineHeight:1.8, whiteSpace:'pre-wrap', background:'white', borderRadius:12, padding:14, marginBottom:12 },
  detailImg:    { width:90, height:90, objectFit:'cover', borderRadius:8, cursor:'pointer' },
  pestBox:      { background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:12, padding:14, marginBottom:12 },
  replyBox:     { background:'#eff6ff', borderRadius:12, padding:14, marginBottom:12 },
  replyWrite:   { background:'white', borderRadius:12, padding:14 },
  textarea:     { width:'100%', padding:'10px 12px', border:'1.5px solid #e2e8f0', borderRadius:10, fontSize:14, outline:'none', resize:'none', lineHeight:1.6, marginBottom:8 },
  replyBtn:     { width:'100%', padding:'12px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' },
  statusSelect: { padding:'5px 10px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, outline:'none', cursor:'pointer' },
};
