// =============================================
// 공지사항 / 메모 기능
// 관리자 → 전 직원 공지 발송
// =============================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, where, orderBy, onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { sendPushToAllCustomers } from '../utils/customerPush';
import Swal from 'sweetalert2';

const S = {
  container: { paddingBottom: 20 },
  header: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  title:  { fontSize:16, fontWeight:'bold', color:'#1e293b' },
  addBtn: { padding:'9px 16px', background:'#3b82f6', color:'white', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:'bold' },
  card:   (pinned) => ({
    background: pinned ? '#fef9c3' : 'white',
    border: `1px solid ${pinned ? '#fde68a' : '#e2e8f0'}`,
    borderRadius:12, padding:'14px 16px', marginBottom:10,
    boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
    borderLeft: `4px solid ${pinned ? '#f59e0b' : '#e2e8f0'}`,
  }),
  cardHeader: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 },
  cardTitle:  { fontSize:15, fontWeight:'bold', color:'#1e293b' },
  cardMeta:   { fontSize:11, color:'#94a3b8', marginTop:2 },
  cardBody:   { fontSize:13, color:'#374151', lineHeight:1.7, whiteSpace:'pre-wrap' },
  badge:      (color,bg) => ({ padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:'bold', color, background:bg, marginRight:6 }),
  actions:    { display:'flex', gap:6, marginTop:10 },
  actionBtn:  (color) => ({ padding:'5px 12px', background:color+'18', color, border:`1px solid ${color}44`, borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:'bold' }),
  empty:      { textAlign:'center', padding:'50px 20px', color:'#94a3b8' },
};

const NOTICE_TARGETS = ['전체', '마스터', '직원'];

export default function NoticeBoard({ currentUser }) {
  const [notices, setNotices]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all'); // all | mine | pinned

  const isMaster = ['master','master1','master2'].includes(currentUser?.role);
  const staffId  = currentUser?.visibleId || currentUser?.id;

  // 실시간 공지 구독
  useEffect(() => {
    const q = query(
      collection(db, 'notices'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setNotices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, e => {
      console.error('공지 로드 오류:', e);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 읽음 처리
  const markRead = useCallback(async (noticeId) => {
    try {
      const notice = notices.find(n => n.id === noticeId);
      if (!notice || (notice.readBy || []).includes(staffId)) return;
      await updateDoc(doc(db, 'notices', noticeId), {
        readBy: [...(notice.readBy || []), staffId],
      });
    } catch(e) { console.warn('읽음 처리 오류:', e); }
  }, [notices, staffId]);

  const handleAdd = async () => {
    const { value } = await Swal.fire({
      title: '📢 공지사항 작성',
      html: `
        <div style="text-align:left;padding:0 8px;">
          <div style="margin-bottom:10px;">
            <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px;">제목 *</label>
            <input id="n-title" class="swal2-input" placeholder="공지 제목" style="margin:0;">
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px;">내용 *</label>
            <textarea id="n-body" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;min-height:100px;resize:vertical;box-sizing:border-box;"
              placeholder="공지 내용을 입력하세요"></textarea>
          </div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;">
              <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px;">대상</label>
              <select id="n-target" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
                ${NOTICE_TARGETS.map(t => `<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1;display:flex;align-items:flex-end;gap:8px;">
              <label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <input type="checkbox" id="n-pin"> 📌 상단 고정
              </label>
            </div>
          </div>
        </div>
      `,
      width: '420px',
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      preConfirm: () => {
        const title  = document.getElementById('n-title')?.value?.trim();
        const body   = document.getElementById('n-body')?.value?.trim();
        const target = document.getElementById('n-target')?.value;
        const pinned = document.getElementById('n-pin')?.checked;
        if (!title || !body) { Swal.showValidationMessage('제목과 내용을 입력해주세요'); return false; }
        return { title, body, target, pinned };
      },
    });
    if (!value) return;

    try {
      await addDoc(collection(db, 'notices'), {
        ...value,
        authorId:   staffId,
        authorName: currentUser?.name || '',
        createdAt:  new Date().toISOString(),
        readBy:     [staffId],
      });
      // 고객 앱 전체 푸시 발송
      try {
        await sendPushToAllCustomers({
          title: '📢 새 공지사항',
          body:  value.title,
          data:  { type: 'notice' },
        });
      } catch(e) { console.warn('공지 푸시 실패:', e); }

      Swal.fire({ toast:true, position:'top', icon:'success', title:'공지 등록 완료', timer:1500, showConfirmButton:false });
    } catch(e) {
      Swal.fire('오류', '등록 실패: ' + e.message, 'error');
    }
  };

  const handleEdit = async (notice) => {
    const { value } = await Swal.fire({
      title: '✏️ 공지 수정',
      html: `
        <input id="e-title" class="swal2-input" value="${notice.title || ''}" style="margin-bottom:8px;">
        <textarea id="e-body" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;min-height:100px;resize:vertical;box-sizing:border-box;"
          >${notice.body || ''}</textarea>
        <label style="font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;margin-top:8px;padding-left:4px;">
          <input type="checkbox" id="e-pin" ${notice.pinned ? 'checked' : ''}> 📌 상단 고정
        </label>
      `,
      showCancelButton: true,
      confirmButtonText: '수정',
      cancelButtonText: '취소',
      preConfirm: () => ({
        title:  document.getElementById('e-title')?.value?.trim(),
        body:   document.getElementById('e-body')?.value?.trim(),
        pinned: document.getElementById('e-pin')?.checked,
      }),
    });
    if (!value) return;
    try {
      await updateDoc(doc(db, 'notices', notice.id), { ...value, updatedAt: new Date().toISOString() });
    } catch(e) { Swal.fire('오류', e.message, 'error'); }
  };

  const handleDelete = async (id) => {
    const r = await Swal.fire({ title:'삭제', text:'이 공지를 삭제할까요?', icon:'warning', showCancelButton:true, confirmButtonColor:'#ef4444', confirmButtonText:'삭제', cancelButtonText:'취소' });
    if (!r.isConfirmed) return;
    try {
      await deleteDoc(doc(db, 'notices', id));
    } catch(e) { Swal.fire('오류', e.message, 'error'); }
  };

  // 필터링
  const filtered = notices.filter(n => {
    if (filter === 'mine')   return n.authorId === staffId;
    if (filter === 'pinned') return n.pinned;
    return true;
  });

  // 읽지 않은 공지 수
  const unreadCount = notices.filter(n => !(n.readBy || []).includes(staffId)).length;

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div>
          <div style={S.title}>
            📢 공지사항
            {unreadCount > 0 && (
              <span style={{ marginLeft:8, background:'#ef4444', color:'white', borderRadius:'50%', width:18, height:18, fontSize:11, fontWeight:'bold', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                {unreadCount}
              </span>
            )}
          </div>
        </div>
        {isMaster && (
          <button style={S.addBtn} onClick={handleAdd}>+ 공지 작성</button>
        )}
      </div>

      {/* 필터 탭 */}
      <div style={{ display:'flex', gap:6, marginBottom:12 }}>
        {[['all','전체'],['pinned','📌 고정'],['mine','내 공지']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ padding:'7px 14px', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:'bold',
              background: filter===v ? '#3b82f6' : '#f1f5f9',
              color: filter===v ? 'white' : '#64748b' }}>
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={S.empty}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
          <div>공지사항이 없습니다.</div>
        </div>
      ) : (
        filtered.map(notice => {
          const isUnread = !(notice.readBy || []).includes(staffId);
          const readCount = (notice.readBy || []).length;
          return (
            <div key={notice.id} style={S.card(notice.pinned)}
              onClick={() => isUnread && markRead(notice.id)}>
              <div style={S.cardHeader}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                    {notice.pinned && <span>📌</span>}
                    {isUnread && <span style={S.badge('#dc2626','#fee2e2')}>NEW</span>}
                    {notice.target && notice.target !== '전체' && (
                      <span style={S.badge('#0369a1','#e0f2fe')}>{notice.target}</span>
                    )}
                    <span style={S.cardTitle}>{notice.title}</span>
                  </div>
                  <div style={S.cardMeta}>
                    {notice.authorName} · {(notice.createdAt||'').split('T')[0]}
                    {isMaster && ` · 읽음 ${readCount}명`}
                    {notice.updatedAt && ' · 수정됨'}
                  </div>
                </div>
              </div>
              <div style={S.cardBody}>{notice.body}</div>
              {isMaster && (
                <div style={S.actions}>
                  <button style={S.actionBtn('#3b82f6')} onClick={e => { e.stopPropagation(); handleEdit(notice); }}>✏️ 수정</button>
                  <button style={S.actionBtn('#ef4444')} onClick={e => { e.stopPropagation(); handleDelete(notice.id); }}>🗑️ 삭제</button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
