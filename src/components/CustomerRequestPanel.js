import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, doc, updateDoc,
  query, orderBy, where, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { sendPushToCustomer } from '../utils/customerPush';
import Swal from 'sweetalert2';

const REQUEST_TYPES = {
  schedule_change: { icon:'📅', label:'일정 변경' },
  disinfect_date:  { icon:'🗓️', label:'소독일 지정' },
  cert_issue:      { icon:'📄', label:'소독증명서' },
  contract_view:   { icon:'📝', label:'계약서 열람' },
};

const STATUS_INFO = {
  pending:          { label:'미처리',   color:'#f59e0b', bg:'#fffbeb' },
  reviewing:        { label:'검토 중',  color:'#2563eb', bg:'#eff6ff' },
  date_negotiating: { label:'날짜 협의',color:'#7c3aed', bg:'#f5f3ff' },
  accepted:         { label:'수락됨',   color:'#059669', bg:'#f0fdf4' },
  rejected:         { label:'거절됨',   color:'#dc2626', bg:'#fef2f2' },
};

export default function CustomerRequestPanel({ currentUser, onClose }) {
  const [requests,  setRequests]  = useState([]);
  const [filter,    setFilter]    = useState('pending');
  const [selected,  setSelected]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [memo,      setMemo]      = useState('');
  const [proposedDates, setProposedDates] = useState(['','','']);
  const [submitting,setSubmitting]= useState(false);

  const isMaster = ['master','master1','master2'].includes(currentUser?.role);

  // ── 실시간 요청 목록 ──────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'customerRequests'),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRequests(list);
      setLoading(false);

      // 30분 초과 미열람 체크
      checkDelayed(list);
    });
    return unsub;
  }, []);

  // ── 30분 초과 알림 체크 ───────────────────────
  const checkDelayed = useCallback(async (list) => {
    if (!isMaster) return;
    const now = new Date();
    const delayed = list.filter(r => {
      if (r.status !== 'pending') return false;
      if (r.firstViewedAt) return false;
      const created = new Date(r.createdAt);
      return (now - created) > 30 * 60 * 1000; // 30분
    });
    if (delayed.length > 0) {
      console.warn(`⚠️ ${delayed.length}건 30분 이상 미열람`);
      // 실제 FCM 발송은 Firebase Functions로 처리하는 것이 이상적
      // 현재는 관리자 화면에 경고 표시
    }
  }, [isMaster]);

  // ── 필터링 ────────────────────────────────────
  const filtered = filter === 'all'
    ? requests
    : requests.filter(r => r.status === filter);

  // ── 열람 처리 ─────────────────────────────────
  const handleView = async (req) => {
    setSelected(req);
    setMemo(req.staffMemo || '');
    setProposedDates(req.proposedDates?.length ? [...req.proposedDates, '', ''].slice(0,3) : ['','','']);

    // 첫 열람 기록
    if (!req.firstViewedAt) {
      try {
        await updateDoc(doc(db, 'customerRequests', req.id), {
          firstViewedAt: new Date().toISOString(),
          firstViewedBy: currentUser?.name || currentUser?.email || '',
          status: req.status === 'pending' ? 'reviewing' : req.status,
          updatedAt: new Date().toISOString(),
        });
      } catch(e) { console.error(e); }
    }
  };

  // ── 수락 ──────────────────────────────────────
  const handleAccept = async () => {
    if (!selected) return;
    const { isConfirmed } = await Swal.fire({
      title: '요청 수락',
      text: `${REQUEST_TYPES[selected.type]?.label} 요청을 수락할까요?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '수락',
      cancelButtonText: '취소',
    });
    if (!isConfirmed) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'customerRequests', selected.id), {
        status:     'accepted',
        acceptedBy: currentUser?.name || currentUser?.email || '',
        acceptedAt: new Date().toISOString(),
        staffMemo:  memo,
        updatedAt:  new Date().toISOString(),
      });
      // 고객에게 푸시
      await sendPushToCustomer(selected.customerId, {
        title: '✅ 요청이 수락됐어요',
        body:  `${REQUEST_TYPES[selected.type]?.label} 요청이 수락됐어요.${memo ? ` ${memo}` : ''}`,
        data:  { type: 'reply', requestId: selected.id },
      });
      setSelected(null);
      Swal.fire({ icon:'success', title:'수락 완료!', timer:1200, showConfirmButton:false });
    } catch(e) {
      console.error(e);
      Swal.fire('오류', '잠시 후 다시 시도해주세요.', 'error');
    }
    setSubmitting(false);
  };

  // ── 날짜 제안 ─────────────────────────────────
  const handleProposeDate = async () => {
    const dates = proposedDates.filter(Boolean);
    if (dates.length === 0) {
      Swal.fire('알림', '제안할 날짜를 하나 이상 입력해주세요.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'customerRequests', selected.id), {
        status:        'date_negotiating',
        proposedDates: dates,
        staffMemo:     memo,
        updatedAt:     new Date().toISOString(),
      });
      // 고객에게 푸시
      await sendPushToCustomer(selected.customerId, {
        title: '📅 담당자가 날짜를 제안했어요',
        body:  `${dates.length}개의 가능한 날짜 중 선택해주세요.`,
        data:  { type: 'reply', requestId: selected.id },
      });
      setSelected(null);
      Swal.fire({ icon:'success', title:'날짜 제안 완료!', timer:1200, showConfirmButton:false });
    } catch(e) {
      console.error(e);
    }
    setSubmitting(false);
  };

  // ── 거절 ──────────────────────────────────────
  const handleReject = async () => {
    const { value: reason } = await Swal.fire({
      title: '거절 사유',
      input: 'textarea',
      inputPlaceholder: '거절 사유를 입력해주세요 (고객에게 전달됩니다)',
      showCancelButton: true,
      confirmButtonText: '거절',
      cancelButtonText: '취소',
    });
    if (!reason) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'customerRequests', selected.id), {
        status:     'rejected',
        staffMemo:  reason,
        acceptedBy: currentUser?.name || currentUser?.email || '',
        updatedAt:  new Date().toISOString(),
      });
      await sendPushToCustomer(selected.customerId, {
        title: '❌ 요청을 처리하기 어려워요',
        body:  reason,
        data:  { type: 'reply', requestId: selected.id },
      });
      setSelected(null);
      Swal.fire({ icon:'info', title:'거절 처리됨', timer:1200, showConfirmButton:false });
    } catch(e) { console.error(e); }
    setSubmitting(false);
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const delayedCount = requests.filter(r => {
    if (r.status !== 'pending' || r.firstViewedAt) return false;
    return (new Date() - new Date(r.createdAt)) > 30 * 60 * 1000;
  }).length;

  const formatDate = (str) => {
    if (!str) return '';
    const d = new Date(str);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    if (isToday) return d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
    return d.toLocaleDateString('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  };

  // ── 상세 뷰 ──────────────────────────────────
  if (selected) {
    const rt = REQUEST_TYPES[selected.type] || {};
    const st = STATUS_INFO[selected.status] || STATUS_INFO.pending;
    const canAct = isMaster || selected.staffName === (currentUser?.name || '');

    return (
      <div style={S.wrap}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={() => setSelected(null)}>← 목록</button>
          <div style={{ flex:1, fontSize:15, fontWeight:700 }}>요청 상세</div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.detailBody}>
          {/* 상태 + 유형 */}
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
            <span style={{ ...S.badge, background:st.bg, color:st.color }}>{st.label}</span>
            <span style={{ fontSize:14, fontWeight:600 }}>{rt.icon} {rt.label}</span>
          </div>

          {/* 고객 정보 */}
          <div style={S.infoBox}>
            <div style={S.infoRow}><span style={S.infoLabel}>고객</span><span>{selected.customerName}</span></div>
            <div style={S.infoRow}><span style={S.infoLabel}>담당자</span><span>{selected.staffName || '-'}</span></div>
            <div style={S.infoRow}><span style={S.infoLabel}>요청일</span><span>{formatDate(selected.createdAt)}</span></div>
            {selected.firstViewedAt && (
              <div style={S.infoRow}><span style={S.infoLabel}>열람</span><span>{selected.firstViewedBy} · {formatDate(selected.firstViewedAt)}</span></div>
            )}
            {selected.acceptedBy && (
              <div style={S.infoRow}><span style={S.infoLabel}>처리</span><span style={{ color:'#059669', fontWeight:600 }}>{selected.acceptedBy}</span></div>
            )}
          </div>

          {/* 요청 내용 */}
          <div style={S.contentBox}>
            <div style={S.sectionLabel}>요청 내용</div>
            <div style={{ fontSize:14, color:'#374151', lineHeight:1.7 }}>{selected.content}</div>
          </div>

          {/* 희망 날짜 */}
          {selected.requestedDates?.filter(Boolean).length > 0 && (
            <div style={S.contentBox}>
              <div style={S.sectionLabel}>고객 희망 날짜</div>
              {selected.requestedDates.filter(Boolean).map((d,i) => (
                <div key={i} style={{ fontSize:14, color:'#374151' }}>📅 {d}</div>
              ))}
            </div>
          )}

          {/* 처리 영역 (수락 가능한 경우만) */}
          {canAct && !['accepted','rejected'].includes(selected.status) && (
            <>
              {/* 담당자 메모 */}
              <div style={{ marginBottom:12 }}>
                <div style={S.sectionLabel}>메모 (고객에게 전달)</div>
                <textarea
                  style={S.textarea}
                  placeholder="고객에게 전달할 메모 (선택)"
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  rows={2}
                />
              </div>

              {/* 날짜 제안 */}
              {['schedule_change','disinfect_date'].includes(selected.type) && (
                <div style={{ marginBottom:12 }}>
                  <div style={S.sectionLabel}>날짜 제안 (가능한 날짜)</div>
                  {proposedDates.map((d,i) => (
                    <input key={i} type="date" value={d}
                      onChange={e => { const next=[...proposedDates]; next[i]=e.target.value; setProposedDates(next); }}
                      style={{ ...S.dateInput, marginBottom:6 }} />
                  ))}
                  <button style={S.proposeBtn} onClick={handleProposeDate} disabled={submitting}>
                    📅 날짜 제안 발송
                  </button>
                </div>
              )}

              {/* 액션 버튼 */}
              <div style={{ display:'flex', gap:8 }}>
                <button style={{ ...S.acceptBtn, flex:1 }} onClick={handleAccept} disabled={submitting}>
                  ✅ 수락
                </button>
                <button style={{ ...S.rejectBtn, flex:1 }} onClick={handleReject} disabled={submitting}>
                  ❌ 거절
                </button>
              </div>
            </>
          )}

          {/* 완료 상태 */}
          {selected.status === 'accepted' && (
            <div style={{ ...S.contentBox, background:'#f0fdf4', border:'1px solid #bbf7d0' }}>
              <div style={{ fontSize:14, color:'#059669', fontWeight:700 }}>✅ 수락 완료</div>
              <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>
                {selected.acceptedBy} · {formatDate(selected.acceptedAt)}
              </div>
              {selected.staffMemo && <div style={{ fontSize:13, color:'#374151', marginTop:6 }}>{selected.staffMemo}</div>}
              {selected.selectedDate && <div style={{ fontSize:13, color:'#059669', marginTop:4 }}>확정 날짜: {selected.selectedDate}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 목록 뷰 ──────────────────────────────────
  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{ fontSize:16, fontWeight:700, flex:1 }}>
          고객 요청
          {pendingCount > 0 && <span style={S.badge2}>{pendingCount}</span>}
          {delayedCount > 0 && <span style={{ ...S.badge2, background:'#dc2626', marginLeft:4 }}>⚠️ {delayedCount}건 지연</span>}
        </div>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* 필터 */}
      <div style={S.filterRow}>
        {[
          { key:'all',      label:'전체' },
          { key:'pending',  label:'미처리' },
          { key:'reviewing',label:'검토중' },
          { key:'date_negotiating', label:'날짜협의' },
          { key:'accepted', label:'완료' },
        ].map(f => (
          <button key={f.key}
            style={{ ...S.filterBtn, ...(filter===f.key ? { background:'#1e40af', color:'white' } : {}) }}
            onClick={() => setFilter(f.key)}>
            {f.label}
            <span style={{ marginLeft:3, fontSize:11 }}>({requests.filter(r=>f.key==='all'?true:r.status===f.key).length})</span>
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div style={S.listBody}>
        {loading ? (
          <div style={S.empty}><div style={{ fontSize:24 }}>⏳</div><div>불러오는 중...</div></div>
        ) : filtered.length === 0 ? (
          <div style={S.empty}><div style={{ fontSize:32 }}>📋</div><div style={{ marginTop:8 }}>요청이 없어요</div></div>
        ) : (
          filtered.map(r => {
            const rt = REQUEST_TYPES[r.type] || {};
            const st = STATUS_INFO[r.status] || STATUS_INFO.pending;
            const isDelayed = r.status === 'pending' && !r.firstViewedAt &&
              (new Date() - new Date(r.createdAt)) > 30 * 60 * 1000;
            return (
              <div key={r.id} style={{ ...S.card, ...(isDelayed ? { borderLeft:'3px solid #dc2626' } : {}) }}
                onClick={() => handleView(r)}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{rt.icon} {rt.label}</span>
                  <span style={{ ...S.badge, background:st.bg, color:st.color, fontSize:11 }}>{st.label}</span>
                </div>
                <div style={{ fontSize:13, color:'#374151', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {r.content}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
                  <span style={{ fontSize:11, color:'#64748b' }}>{r.customerName} · {r.staffName || '-'}</span>
                  <span style={{ fontSize:11, color: isDelayed ? '#dc2626' : '#94a3b8', fontWeight: isDelayed ? 700 : 400 }}>
                    {isDelayed ? '⚠️ 30분 초과' : formatDate(r.createdAt)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const S = {
  wrap:       { display:'flex', flexDirection:'column', height:'100%', background:'#f8fafc' },
  header:     { display:'flex', alignItems:'center', gap:8, padding:'14px 16px', background:'white', borderBottom:'1px solid #e2e8f0', flexShrink:0 },
  backBtn:    { background:'none', border:'none', color:'#64748b', fontSize:14, padding:'0 8px 0 0', cursor:'pointer' },
  closeBtn:   { background:'none', border:'none', color:'#94a3b8', fontSize:18, padding:'4px', cursor:'pointer' },
  filterRow:  { display:'flex', gap:6, padding:'10px 16px', background:'white', borderBottom:'1px solid #e2e8f0', overflowX:'auto', flexShrink:0 },
  filterBtn:  { padding:'5px 10px', border:'1px solid #e2e8f0', borderRadius:20, fontSize:11, fontWeight:600, cursor:'pointer', background:'white', color:'#64748b', whiteSpace:'nowrap' },
  listBody:   { flex:1, overflowY:'auto', padding:'12px' },
  card:       { background:'white', borderRadius:12, padding:'12px 14px', marginBottom:8, boxShadow:'0 1px 4px rgba(0,0,0,0.06)', cursor:'pointer' },
  badge:      { display:'inline-block', padding:'3px 8px', borderRadius:20, fontSize:12, fontWeight:600 },
  badge2:     { display:'inline-block', background:'#f59e0b', color:'white', borderRadius:20, fontSize:11, fontWeight:700, padding:'1px 7px', marginLeft:8 },
  empty:      { textAlign:'center', padding:'48px 0', color:'#94a3b8', fontSize:14 },
  detailBody: { flex:1, overflowY:'auto', padding:'16px' },
  infoBox:    { background:'white', borderRadius:12, padding:'12px 14px', marginBottom:10, boxShadow:'0 1px 4px rgba(0,0,0,0.06)' },
  infoRow:    { display:'flex', gap:8, padding:'5px 0', fontSize:13, borderBottom:'1px solid #f1f5f9' },
  infoLabel:  { color:'#94a3b8', width:52, flexShrink:0 },
  contentBox: { background:'white', borderRadius:12, padding:'14px', marginBottom:10, boxShadow:'0 1px 4px rgba(0,0,0,0.06)' },
  sectionLabel:{ fontSize:12, fontWeight:700, color:'#64748b', marginBottom:6 },
  textarea:   { width:'100%', padding:'10px 12px', border:'1.5px solid #e2e8f0', borderRadius:10, fontSize:14, outline:'none', resize:'none' },
  dateInput:  { width:'100%', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:10, fontSize:14, outline:'none', display:'block' },
  proposeBtn: { width:'100%', padding:'10px', background:'#7c3aed', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:600, cursor:'pointer', marginTop:4 },
  acceptBtn:  { padding:'12px', background:'#059669', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' },
  rejectBtn:  { padding:'12px', background:'#f1f5f9', color:'#dc2626', border:'1px solid #fecaca', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' },
};
