import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { BUSINESS_TYPES, formatPrice } from './quoteConstants';

// 템플릿 목록 모달
function QuoteTemplates({ onSelect, onClose, currentUser }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'quoteTemplates'));
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setTemplates(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleDelete = async (tpl) => {
    const r = await Swal.fire({
      title: `"${tpl.name}" 삭제`,
      text: '이 템플릿을 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
    });
    if (!r.isConfirmed) return;
    await deleteDoc(doc(db, 'quoteTemplates', tpl.id));
    await fetchTemplates();
  };

  const filtered = templates.filter(t =>
    !searchTerm || (t.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getBusinessLabel = (value) => {
    const b = BUSINESS_TYPES.find(b => b.value === value);
    return b ? `${b.icon} ${b.label}` : value || '-';
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.title}>📋 견적 템플릿</div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.searchBox}>
          <span>🔍</span>
          <input
            style={styles.searchInput}
            placeholder="템플릿 검색"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        {loading ? (
          <div style={styles.empty}>로딩 중...</div>
        ) : filtered.length === 0 ? (
          <div style={styles.empty}>
            {searchTerm ? '검색 결과가 없습니다.' : '저장된 템플릿이 없습니다.\n견적 저장 시 "템플릿으로 저장" 체크하세요!'}
          </div>
        ) : (
          <div style={styles.list}>
            {filtered.map(tpl => (
              <div key={tpl.id} style={styles.card}>
                <div style={styles.cardTop}>
                  <div>
                    <div style={styles.cardName}>{tpl.name}</div>
                    <div style={styles.cardSub}>
                      {tpl.businessType && <span>{getBusinessLabel(tpl.businessType)}</span>}
                      {tpl.visitPerMonth && <span>월 {tpl.visitPerMonth}회</span>}
                      {tpl.monthlyTotal > 0 && <span style={{ color: '#10b981', fontWeight: 'bold' }}>{formatPrice(tpl.monthlyTotal)}/월</span>}
                    </div>
                    {tpl.memo && <div style={styles.cardMemo}>{tpl.memo}</div>}
                    <div style={styles.cardDate}>저장: {tpl.createdAt?.split('T')[0]} · {tpl.createdBy}</div>
                  </div>
                </div>
                <div style={styles.cardActions}>
                  <button onClick={() => onSelect(tpl)} style={styles.selectBtn}>
                    이 템플릿 사용
                  </button>
                  <button onClick={() => handleDelete(tpl)} style={styles.deleteBtn}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 템플릿 저장 함수 (QuoteDetail에서 호출)
export async function saveAsTemplate(quote, templateName, currentUser) {
  if (!templateName?.trim()) return;
  const { id, quoteCustomerId, custName, createdAt, updatedAt, status,
    viewedAt, approvedAt, rejectedAt, customerEdits, reQuoteRequest, qnaList, ...templateData } = quote;
  await addDoc(collection(db, 'quoteTemplates'), {
    ...templateData,
    name: templateName.trim(),
    createdAt: new Date().toISOString(),
    createdBy: currentUser?.name || '',
  });
}

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: 'white', borderRadius: '16px 16px 0 0',
    width: '100%', maxWidth: '600px', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9',
  },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f' },
  closeBtn: {
    background: '#f1f5f9', border: 'none', borderRadius: '50%',
    width: '32px', height: '32px', cursor: 'pointer', fontSize: '14px',
  },
  searchBox: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 20px', borderBottom: '1px solid #f1f5f9',
  },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '14px' },
  list: { overflowY: 'auto', padding: '12px 16px', flex: 1 },
  empty: {
    textAlign: 'center', padding: '40px 20px',
    color: '#94a3b8', fontSize: '13px', whiteSpace: 'pre-line',
  },
  card: {
    background: '#f8fafc', border: '1px solid #e2e8f0',
    borderRadius: '10px', padding: '12px 14px', marginBottom: '10px',
  },
  cardTop: { marginBottom: '10px' },
  cardName: { fontSize: '15px', fontWeight: 'bold', color: '#1e293b', marginBottom: '4px' },
  cardSub: { display: 'flex', gap: '10px', fontSize: '12px', color: '#64748b', flexWrap: 'wrap' },
  cardMemo: { fontSize: '12px', color: '#94a3b8', marginTop: '4px', fontStyle: 'italic' },
  cardDate: { fontSize: '11px', color: '#cbd5e1', marginTop: '4px' },
  cardActions: { display: 'flex', gap: '8px' },
  selectBtn: {
    flex: 1, padding: '9px', background: '#3b82f6', color: 'white',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontSize: '13px', fontWeight: 'bold',
  },
  deleteBtn: {
    padding: '9px 12px', background: '#fee2e2', color: '#ef4444',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
  },
};

export default QuoteTemplates;
