import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc,
  updateDoc, doc, where, getDocs, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

export default function ChatManagePanel({ currentUser, onClose }) {
  const [rooms,    setRooms]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const [loading,  setLoading]  = useState(true);
  const bottomRef = useRef(null);
  const msgUnsubRef = useRef(null);

  // ── 채팅방 목록 실시간 ────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'chatRooms'), orderBy('lastMessageAt', 'desc')),
      async snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRooms(list);
        setLoading(false);
      },
      err => { console.error('채팅방 목록 오류:', err); setLoading(false); }
    );
    return unsub;
  }, []);

  // ── 채팅방 선택 → 메시지 구독 ─────────────────
  const selectRoom = useCallback((room) => {
    setSelected(room);
    if (msgUnsubRef.current) msgUnsubRef.current();

    const unsub = onSnapshot(
      query(
        collection(db, 'chatRooms', room.id, 'messages'),
        orderBy('createdAt', 'asc')
      ),
      snap => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    );
    msgUnsubRef.current = unsub;

    // 안 읽은 메시지 읽음 처리
    markRead(room.id);
  }, []);

  useEffect(() => () => { if (msgUnsubRef.current) msgUnsubRef.current(); }, []);

  const markRead = async (roomId) => {
    try {
      await updateDoc(doc(db, 'chatRooms', roomId), { unreadByManager: 0 });
    } catch (e) { console.error(e); }
  };

  // ── 메시지 전송 ───────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || !selected || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'chatRooms', selected.id, 'messages'), {
        text,
        sender:     'manager',
        senderName: currentUser?.name || '담당자',
        createdAt:  now,
      });
      await updateDoc(doc(db, 'chatRooms', selected.id), {
        lastMessage:       text,
        lastMessageAt:     now,
        unreadByCustomer:  (selected.unreadByCustomer || 0) + 1,
        unreadByManager:   0,
      });

      // 고객 앱 알림 (customerNotifications)
      if (selected.customerId) {
        await addDoc(collection(db, 'customerNotifications'), {
          customerId:  selected.customerId,
          type:        'chat',
          title:       `💬 ${currentUser?.name || '담당자'} 님이 메시지를 보냈어요`,
          body:        text.length > 30 ? text.slice(0, 30) + '...' : text,
          roomId:      selected.id,
          read:        false,
          createdAt:   now,
        });
      }
    } catch (e) {
      console.error('메시지 전송 오류:', e);
    }
    setSending(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const totalUnread = rooms.reduce((s, r) => s + (r.unreadByManager || 0), 0);

  // ── 목록 뷰 ──────────────────────────────────
  if (!selected) {
    return (
      <div style={S.wrap}>
        <div style={S.header}>
          <div style={S.headerLeft}>
            <span style={{ fontSize: 18 }}>💬</span>
            <span style={S.headerTitle}>1:1 채팅</span>
            {totalUnread > 0 && <span style={S.unreadBadge}>{totalUnread}</span>}
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.body}>
          {loading ? (
            <div style={S.center}><div style={{ color: '#94a3b8' }}>불러오는 중...</div></div>
          ) : rooms.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>💬</div>
              <div style={{ color: '#94a3b8', marginTop: 8, fontSize: 14 }}>채팅방이 없어요</div>
            </div>
          ) : (
            rooms.map(r => (
              <div key={r.id} style={S.roomCard} onClick={() => selectRoom(r)}>
                <div style={S.roomAvatar}>{(r.customerName || '?')[0]}</div>
                <div style={S.roomInfo}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{r.customerName || '고객'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {r.lastMessage || '채팅을 시작해보세요'}
                    </div>
                    {(r.unreadByManager || 0) > 0 && (
                      <span style={S.unreadDot}>{r.unreadByManager}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── 채팅 뷰 ──────────────────────────────────
  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <button style={S.backBtn} onClick={() => { setSelected(null); setMessages([]); }}>←</button>
          <div style={S.roomAvatar}>{(selected.customerName || '?')[0]}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.customerName || '고객'}</div>
            {selected.customerCode && (
              <div style={{ fontSize: 11, opacity: 0.8 }}>코드: {selected.customerCode}</div>
            )}
          </div>
        </div>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={S.msgArea}>
        {messages.map(m => {
          const isManager = m.sender === 'manager';
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: isManager ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{
                maxWidth: '75%',
                background: isManager ? '#1e40af' : 'white',
                color: isManager ? 'white' : '#1e293b',
                borderRadius: isManager ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                padding: '8px 12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{m.text}</div>
                <div style={{ fontSize: 10, opacity: 0.6, textAlign: isManager ? 'right' : 'left', marginTop: 2 }}>
                  {m.createdAt ? new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={S.inputArea}>
        <textarea
          style={S.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="메시지 입력... (Enter 전송)"
          rows={1}
        />
        <button style={{ ...S.sendBtn, opacity: (!input.trim() || sending) ? 0.5 : 1 }} onClick={sendMessage} disabled={!input.trim() || sending}>
          ▶
        </button>
      </div>
    </div>
  );
}

const S = {
  wrap:          { display: 'flex', flexDirection: 'column', height: '100%', background: '#f8fafc' },
  header:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#1e40af', color: 'white', flexShrink: 0 },
  headerLeft:    { display: 'flex', alignItems: 'center', gap: 8 },
  headerTitle:   { fontSize: 16, fontWeight: 700 },
  closeBtn:      { background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 14 },
  backBtn:       { background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 14 },
  unreadBadge:   { background: '#ef4444', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700 },
  body:          { flex: 1, overflowY: 'auto', padding: '12px 14px' },
  center:        { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 },
  roomCard:      { display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 12, padding: '12px 14px', marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer' },
  roomAvatar:    { width: 40, height: 40, borderRadius: '50%', background: '#1e40af', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 },
  roomInfo:      { flex: 1, minWidth: 0 },
  unreadDot:     { background: '#ef4444', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  msgArea:       { flex: 1, overflowY: 'auto', padding: '12px 14px', background: '#f8fafc' },
  inputArea:     { display: 'flex', gap: 8, padding: '10px 14px', background: 'white', borderTop: '1px solid #e2e8f0', flexShrink: 0 },
  textarea:      { flex: 1, border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 13, resize: 'none', outline: 'none', lineHeight: 1.5 },
  sendBtn:       { width: 40, height: 40, background: '#1e40af', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 16, flexShrink: 0 },
};
