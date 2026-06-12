import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { CONTRACT_TYPES } from './contractConstants';
import ContractEditor from './ContractEditor';

function ContractPage({ currentUser, staffList }) {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState('list'); // 'list' | 'editor'
  const [selected, setSelected]   = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => { fetchContracts(); }, []);

  const fetchContracts = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'contracts'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setContracts(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleNew = () => { setSelected(null); setView('editor'); };
  const handleEdit = (c) => { setSelected(c); setView('editor'); };
  const handleBack = () => { setView('list'); setSelected(null); fetchContracts(); };

  // 서명완료 계약서 → 정식 고객 등록
  const handleRegisterCustomer = async (c) => {
    const r = await Swal.fire({
      title: '👤 정식 고객으로 등록',
      html: `
        <div style="text-align:left;padding:0 10px;">
          <p><b>${c.custName}</b>을 정식 고객으로 등록합니다.</p>
          <p style="color:#10b981;font-size:13px;margin-top:8px;">✅ 고객코드가 자동 발급되고 고객관리에 등록됩니다.</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#1e3a5f',
      confirmButtonText: '등록',
      cancelButtonText: '취소',
    });
    if (!r.isConfirmed) return;

    try {
      Swal.fire({ title: '처리 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      // 새 고객코드 발급 (기존 최대+1, 4자리)
      const custSnap = await getDocs(collection(db, 'customers'));
      const codes = custSnap.docs.map(d => parseInt(d.data().code || '0')).filter(n => !isNaN(n));
      const newCode = String((codes.length > 0 ? Math.max(...codes) : 0) + 1).padStart(4, '0');

      // customers 컬렉션에 추가
      await addDoc(collection(db, 'customers'), {
        code: newCode,
        custName: c.custName,
        phone: c.phone || '',
        address: c.address || '',
        area: c.area || '',
        businessType: c.businessType || '',
        staffName: c.staffName || '',
        contractPeriod: c.contractStart && c.contractEnd
          ? `${c.contractStart.replace(/-/g,'.')} - ${c.contractEnd.replace(/-/g,'.')}`
          : '',
        services: [{
          serviceType: '일반방제',
          price: c.monthlyFee || 0,
        }],
        custStatus: '정상',
        memo: `계약서(${c.id})에서 등록`,
        createdAt: new Date().toISOString(),
      });

      // 계약서 상태 업데이트
      await updateDoc(doc(db, 'contracts', c.id), {
        status: 'registered',
        registeredCode: newCode,
        registeredAt: new Date().toISOString(),
      });

      // 견적고객 상태 업데이트 (fromQuoteCustomerId가 있는 경우)
      if (c.fromQuoteCustomerId) {
        try {
          await updateDoc(doc(db, 'quoteCustomers', c.fromQuoteCustomerId), {
            status: 'contracted',
            newCode,
            contractedAt: new Date().toISOString(),
          });
        } catch (e) { console.error('견적고객 계약상태 업데이트 오류:', e); }
      }

      await fetchContracts();
      Swal.fire({
        icon: 'success',
        title: '등록 완료!',
        html: `고객코드 <b>${newCode}</b>가 발급되었습니다.<br>고객관리 탭에서 확인하세요.`,
      });
    } catch (e) {
      Swal.fire('오류', '등록 실패: ' + e.message, 'error');
    }
  };

  const handleDelete = async (c) => {
    const r = await Swal.fire({
      title: '계약서 삭제',
      html: `<b>${c.custName}</b>의 계약서를 삭제하시겠습니까?`,
      icon: 'warning', showCancelButton: true,
      confirmButtonColor: '#ef4444', confirmButtonText: '삭제', cancelButtonText: '취소',
    });
    if (!r.isConfirmed) return;
    await deleteDoc(doc(db, 'contracts', c.id));
    fetchContracts();
  };

  const STATUS_MAP = {
    draft:      { label: '작성중',   color: '#64748b', bg: '#f1f5f9', icon: '📝' },
    sent:       { label: '발송완료', color: '#3b82f6', bg: '#eff6ff', icon: '📤' },
    signed:     { label: '서명완료', color: '#10b981', bg: '#d1fae5', icon: '✅' },
    expired:    { label: '만료',     color: '#94a3b8', bg: '#f8fafc', icon: '⏰' },
    cancelled:  { label: '해지',     color: '#ef4444', bg: '#fee2e2', icon: '🚫' },
    registered: { label: '고객등록', color: '#1e3a5f', bg: '#dbeafe', icon: '👤' },
  };

  // 서명완료 계약서 중 아직 고객등록 안 된 것 자동 안내
  const signedUnregistered = contracts.filter(c => c.status === 'signed' && !c.registeredCode);

  // eslint-disable-next-line no-unused-vars
  const getTypeLabel = (type) => CONTRACT_TYPES.find(t => t.value === type)?.label || type;

  const filtered = contracts.filter(c => {
    const matchSearch = !searchTerm || (c.custName||'').includes(searchTerm) || (c.address||'').includes(searchTerm);
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  if (view === 'editor') {
    return <ContractEditor contract={selected} currentUser={currentUser} onBack={handleBack} />;
  }

  return (
    <div style={cs.container}>
      {/* 헤더 */}
      <div style={cs.header}>
        <h2 style={cs.title}>📃 계약서 관리</h2>
        <button onClick={handleNew} style={cs.addBtn}>+ 새 계약서</button>
      </div>

      {/* 검색 + 필터 */}
      <div style={cs.searchRow}>
        <div style={cs.searchBox}>
          <span>🔍</span>
          <input style={cs.searchInput} placeholder="고객명, 주소 검색"
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          {searchTerm && <button onClick={() => setSearchTerm('')} style={cs.clearBtn}>✕</button>}
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={cs.filterSelect}>
          <option value="all">전체</option>
          {Object.entries(STATUS_MAP).map(([v, m]) => (
            <option key={v} value={v}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* 통계 카드 */}
      <div style={cs.statsRow}>
        {Object.entries(STATUS_MAP).map(([v, m]) => {
          const count = contracts.filter(c => c.status === v).length;
          if (count === 0) return null;
          return (
            <div key={v} style={{ ...cs.statCard, borderTop: `3px solid ${m.color}` }}>
              <div style={{ fontSize: '18px' }}>{m.icon}</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: m.color }}>{count}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{m.label}</div>
            </div>
          );
        })}
      </div>

      {/* 🔔 서명완료 → 고객등록 안내 배너 */}
      {signedUnregistered.length > 0 && (
        <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#065f46', marginBottom: '8px' }}>
            ✅ 서명 완료된 계약서 {signedUnregistered.length}건 — 고객으로 등록하세요!
          </div>
          {signedUnregistered.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid #a7f3d0', fontSize: '13px' }}>
              <span style={{ fontWeight: 'bold', color: '#065f46' }}>{c.custName}</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => handleEdit(c)} style={{ padding: '5px 10px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                  보기
                </button>
                <button onClick={() => handleRegisterCustomer(c)} style={{ padding: '5px 10px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                  👤 고객 등록
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 계약서 목록 */}
      {loading ? (
        <div style={cs.loading}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={cs.empty}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📃</div>
          <div style={{ color: '#666' }}>{searchTerm ? '검색 결과가 없습니다.' : '계약서가 없습니다.'}</div>
          {!searchTerm && <button onClick={handleNew} style={{ ...cs.addBtn, marginTop: '16px' }}>+ 새 계약서 작성</button>}
        </div>
      ) : (
        filtered.map(c => {
          const st = STATUS_MAP[c.status] || STATUS_MAP.draft;
          const typeInfo = CONTRACT_TYPES.find(t => t.value === c.contractType);
          return (
            <div key={c.id} style={{ ...cs.card, borderLeft: `4px solid ${st.color}` }}>
              <div style={cs.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ ...cs.badge, color: st.color, background: st.bg }}>{st.icon} {st.label}</span>
                  {typeInfo && <span style={cs.typeBadge}>{typeInfo.icon} {typeInfo.label}</span>}
                  <span style={cs.custName}>{c.custName || '(이름 없음)'}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{c.createdAt?.split('T')[0]}</div>
              </div>

              <div style={cs.cardInfo}>
                {c.address && <span>📍 {c.address}</span>}
                {c.contractPeriod && <span>📅 {c.contractPeriod}</span>}
                {c.monthlyFee > 0 && <span style={{ color: '#10b981', fontWeight: 'bold' }}>💰 {c.monthlyFee?.toLocaleString()}원/월</span>}
                {c.createdBy && <span>👤 {c.createdBy}</span>}
              </div>

              {c.signedAt && (
                <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}>
                  ✅ 서명 완료: {c.signedAt.split('T')[0]}
                </div>
              )}

              {/* 서명완료 → 고객 등록 강조 배너 */}
              {c.status === 'signed' && !c.registeredCode && (
                <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '8px', padding: '10px 12px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#065f46', fontWeight: 'bold', marginBottom: '6px' }}>
                    ✍️ 서명 완료! 정식 고객으로 등록하세요.
                  </div>
                  <button onClick={() => handleRegisterCustomer(c)}
                    style={{ width: '100%', padding: '9px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                    👤 정식 고객으로 등록
                  </button>
                </div>
              )}
              {c.registeredCode && (
                <div style={{ fontSize: '12px', color: '#1e3a5f', fontWeight: 'bold', marginBottom: '6px' }}>
                  👤 고객코드 {c.registeredCode} 등록완료
                </div>
              )}
              <div style={cs.cardActions}>
                <button onClick={() => handleEdit(c)} style={cs.editBtn}>✏️ 편집</button>
                {c.status === 'draft' && (
                  <button onClick={async () => {
                    await updateDoc(doc(db, 'contracts', c.id), { status: 'sent', sentAt: new Date().toISOString() });
                    fetchContracts();
                  }} style={cs.sendBtn}>📤 발송</button>
                )}
                {c.status === 'signed' && !c.registeredCode && (
                  <button onClick={() => handleRegisterCustomer(c)} style={{ ...cs.sendBtn, background: '#1e3a5f' }}>
                    👤 고객등록
                  </button>
                )}
                <button onClick={() => handleDelete(c)} style={cs.deleteBtn}>🗑️</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

const cs = {
  container: { paddingBottom: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  title: { fontSize: '18px', fontWeight: 'bold', color: '#1e3a5f', margin: 0 },
  addBtn: { padding: '10px 16px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' },
  searchRow: { display: 'flex', gap: '8px', marginBottom: '10px' },
  searchBox: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, background: 'white', border: '1px solid #ddd', borderRadius: '10px', padding: '8px 14px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '14px' },
  clearBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '16px' },
  filterSelect: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '10px', fontSize: '13px', background: 'white' },
  statsRow: { display: 'flex', gap: '8px', marginBottom: '12px', overflowX: 'auto' },
  statCard: { background: 'white', borderRadius: '10px', padding: '12px 14px', textAlign: 'center', minWidth: '70px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  loading: { textAlign: 'center', padding: '40px', color: '#666' },
  empty: { textAlign: 'center', padding: '60px 20px', color: '#999' },
  card: { background: 'white', borderRadius: '12px', padding: '14px 16px', marginBottom: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  badge: { padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold' },
  typeBadge: { padding: '3px 8px', background: '#f1f5f9', borderRadius: '20px', fontSize: '11px', color: '#475569' },
  custName: { fontSize: '15px', fontWeight: 'bold', color: '#1e293b' },
  cardInfo: { display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: '#64748b', marginBottom: '8px' },
  cardActions: { display: 'flex', gap: '6px', marginTop: '8px' },
  editBtn: { padding: '7px 14px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  sendBtn: { padding: '7px 14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  deleteBtn: { padding: '7px 10px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
};

export default ContractPage;
