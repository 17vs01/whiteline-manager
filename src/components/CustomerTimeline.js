// =============================================
// 고객 이력 타임라인
// 고객카드 팝업 내 탭으로 표시
// =============================================
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

const S = {
  container: { padding: '4px 0' },
  timeline:  { position: 'relative', paddingLeft: 24 },
  line:      { position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: '#e2e8f0' },
  item:      { position: 'relative', marginBottom: 14 },
  dot:       (color) => ({
    position: 'absolute', left: -20, top: 4,
    width: 12, height: 12, borderRadius: '50%',
    background: color, border: '2px solid white',
    boxShadow: `0 0 0 2px ${color}44`,
  }),
  date:      { fontSize: 11, color: '#94a3b8', marginBottom: 2 },
  content:   { background: '#f8fafc', borderRadius: 8, padding: '8px 10px', fontSize: 13 },
  type:      (color) => ({ fontWeight: 'bold', color, marginBottom: 3, fontSize: 12 }),
  note:      { color: '#374151', fontSize: 13 },
  empty:     { textAlign: 'center', padding: '30px 0', color: '#94a3b8', fontSize: 13 },
  loading:   { textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 },
};

// 이벤트 타입 정의
const TIMELINE_TYPES = {
  created:     { icon: '✨', label: '고객 등록',     color: '#10b981' },
  contracted:  { icon: '📝', label: '계약 체결',     color: '#3b82f6' },
  work_done:   { icon: '✅', label: '작업 완료',     color: '#059669' },
  work_night:  { icon: '🌙', label: '야근 완료',     color: '#7c3aed' },
  no_work:     { icon: '⛔', label: '미작업',        color: '#6b7280' },
  claim:       { icon: '🔧', label: '클레임',        color: '#ef4444' },
  cert:        { icon: '🧾', label: '소독증명서 발급', color: '#0891b2' },
  schedule:    { icon: '🗓️', label: '약속',         color: '#8b5cf6' },
  cancelled:   { icon: '🔴', label: '해약',          color: '#dc2626' },
  unpaid:      { icon: '💰', label: '미수금 발생',   color: '#f59e0b' },
  memo:        { icon: '📝', label: '메모',          color: '#6b7280' },
};

export default function CustomerTimeline({ customer }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer?.id) return;
    loadTimeline();
  }, [customer?.id]);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const timeline = [];

      // 1. 고객 등록일
      if (customer.createdAt) {
        timeline.push({
          type: 'created',
          date: customer.createdAt.split('T')[0],
          note: `고객코드 ${customer.code} 등록`,
        });
      }

      // 2. 계약 체결 (contracts 컬렉션)
      try {
        const cSnap = await getDocs(query(
          collection(db, 'contracts'),
          where('fromCustomerId', '==', customer.id),
        ));
        cSnap.docs.forEach(d => {
          const c = d.data();
          if (c.createdAt) {
            timeline.push({
              type: 'contracted',
              date: c.createdAt.split('T')[0],
              note: `계약서 작성 (${c.contractType === 'basic' ? '일반' : c.contractType || '일반'})`,
            });
          }
          if (c.signedAt) {
            timeline.push({
              type: 'contracted',
              date: c.signedAt.split('T')[0],
              note: '계약서 서명 완료',
            });
          }
        });
      } catch(e) {}

      // 3. 작업 이력 (events 컬렉션)
      try {
        const custCode = customer.code || customer.id;
        const eSnap = await getDocs(query(
          collection(db, 'events'),
          where('customerCode', '==', custCode),
        ));
        eSnap.docs.forEach(d => {
          const e = d.data();
          if (!e.date && !e.start) return;
          const date = e.date || e.start?.split('T')[0];
          if (e.status === '완료') {
            timeline.push({ type: 'work_done', date, note: `작업 완료${e.completedBy ? ` (${e.completedBy})` : ''}` });
          } else if (e.status === '야근') {
            timeline.push({ type: 'work_night', date, note: `야근 완료${e.completedBy ? ` (${e.completedBy})` : ''}` });
          } else if (e.status === '미작업') {
            timeline.push({ type: 'no_work', date, note: `미작업${e.noWorkReason ? `: ${e.noWorkReason}` : ''}` });
          }
        });
      } catch(e) {}

      // 4. 소독증명서 발급 (certLogs)
      try {
        const certSnap = await getDocs(query(
          collection(db, 'certLogs'),
          where('customerId', '==', customer.id),
        ));
        certSnap.docs.forEach(d => {
          const c = d.data();
          timeline.push({
            type: 'cert',
            date: (c.issuedAt || c.createdAt || '').split('T')[0],
            note: `소독증명서 발급${c.sentTo ? ` → ${c.sentTo}` : ''}`,
          });
        });
      } catch(e) {}

      // 5. 스케쥴 약속 (scheduleEvents)
      try {
        const schSnap = await getDocs(query(
          collection(db, 'scheduleEvents'),
          where('linkedCustomerId', '==', customer.id),
        ));
        schSnap.docs.forEach(d => {
          const e = d.data();
          if (e.date) {
            timeline.push({
              type: 'schedule',
              date: e.date,
              note: e.title || '약속',
            });
          }
        });
      } catch(e) {}

      // 6. 해약
      if (customer.custStatus === '해약' && customer.cancelledAt) {
        timeline.push({
          type: 'cancelled',
          date: customer.cancelledAt.split('T')[0],
          note: `해약 처리${customer.cancelledBy ? ` (${customer.cancelledBy})` : ''}`,
        });
      }

      // 7. 미수금
      if (customer.unpaid > 0) {
        timeline.push({
          type: 'unpaid',
          date: new Date().toISOString().split('T')[0],
          note: `미수금 ${(customer.unpaid||0).toLocaleString()}원 잔액`,
        });
      }

      // 날짜 내림차순 정렬
      timeline.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      setItems(timeline);
    } catch (e) {
      console.error('타임라인 로드 오류:', e);
    }
    setLoading(false);
  };

  if (loading) return <div style={S.loading}>⏳ 이력 불러오는 중...</div>;
  if (items.length === 0) return <div style={S.empty}>📋 이력이 없습니다.</div>;

  return (
    <div style={S.container}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
        총 {items.length}개 이력
      </div>
      <div style={S.timeline}>
        <div style={S.line} />
        {items.map((item, idx) => {
          const typeInfo = TIMELINE_TYPES[item.type] || TIMELINE_TYPES.memo;
          return (
            <div key={idx} style={S.item}>
              <div style={S.dot(typeInfo.color)} />
              <div style={S.date}>{item.date}</div>
              <div style={S.content}>
                <div style={S.type(typeInfo.color)}>
                  {typeInfo.icon} {typeInfo.label}
                </div>
                <div style={S.note}>{item.note}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
