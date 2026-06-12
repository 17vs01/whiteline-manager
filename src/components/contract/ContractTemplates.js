import React, { useState, useEffect } from 'react';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { CONTRACT_TYPES } from './contractConstants';

function ContractTemplates({ onClose, onSelect }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'contractTemplates'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setTemplates(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleDelete = async (tpl) => {
    const r = await Swal.fire({
      title: `"${tpl.name}" 삭제`, text: '이 템플릿을 삭제하시겠습니까?',
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: '삭제', cancelButtonText: '취소',
    });
    if (!r.isConfirmed) return;
    await deleteDoc(doc(db, 'contractTemplates', tpl.id));
    fetchTemplates();
  };

  const getTypeLabel = (type) => CONTRACT_TYPES.find(t => t.value === type)?.label || type;
  const enabledCount = (tpl) => Object.values(tpl.clauses || {}).filter(c => c.enabled).length;

  return (
    <div style={ts.overlay}>
      <div style={ts.modal}>
        <div style={ts.header}>
          <div style={ts.title}>📋 계약서 템플릿</div>
          <button onClick={onClose} style={ts.closeBtn}>✕</button>
        </div>

        {loading ? (
          <div style={ts.empty}>로딩 중...</div>
        ) : templates.length === 0 ? (
          <div style={ts.empty}>
            저장된 템플릿이 없습니다.{'\n'}계약서 편집 화면에서 "📋 템플릿저장" 버튼을 눌러 저장하세요.
          </div>
        ) : (
          <div style={ts.list}>
            {templates.map(tpl => (
              <div key={tpl.id} style={ts.card}>
                <div style={ts.cardTop}>
                  <div style={ts.cardName}>{tpl.name}</div>
                  <div style={ts.cardMeta}>
                    {tpl.contractType && <span style={ts.metaBadge}>{getTypeLabel(tpl.contractType)}</span>}
                    <span style={ts.metaBadge}>{enabledCount(tpl)}개 조항</span>
                    {tpl.trapCount > 0 && <span style={{ ...ts.metaBadge, color: '#d97706', background: '#fef3c7' }}>🪰 포충기 {tpl.trapCount}대</span>}
                  </div>
                  {tpl.monthlyFee > 0 && (
                    <div style={{ fontSize: '13px', color: '#10b981', fontWeight: 'bold', marginTop: '4px' }}>
                      {tpl.monthlyFee.toLocaleString()}원/월
                    </div>
                  )}
                  <div style={ts.cardDate}>저장: {tpl.createdAt?.split('T')[0]} · {tpl.createdBy}</div>
                </div>
                <div style={ts.cardActions}>
                  <button onClick={() => onSelect(tpl)} style={ts.selectBtn}>이 템플릿 사용</button>
                  <button onClick={() => handleDelete(tpl)} style={ts.deleteBtn}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ts = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'white', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 14px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f' },
  closeBtn: { background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '14px' },
  list: { overflowY: 'auto', padding: '12px 16px', flex: 1 },
  empty: { textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: '13px', whiteSpace: 'pre-line' },
  card: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' },
  cardTop: { marginBottom: '10px' },
  cardName: { fontSize: '15px', fontWeight: 'bold', color: '#1e293b', marginBottom: '6px' },
  cardMeta: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' },
  metaBadge: { padding: '2px 8px', background: '#f1f5f9', borderRadius: '20px', fontSize: '11px', color: '#475569' },
  cardDate: { fontSize: '11px', color: '#cbd5e1', marginTop: '4px' },
  cardActions: { display: 'flex', gap: '8px' },
  selectBtn: { flex: 1, padding: '9px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  deleteBtn: { padding: '9px 12px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' },
};

export default ContractTemplates;
