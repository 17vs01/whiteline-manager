import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

function AssignmentPage({ currentUser, staffList }) {
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'customers'));
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setCustomers(list);
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  const handleCheckbox = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredCustomers.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCustomers.map(c => c.id));
    }
  };

  // 담당자 일괄 배정
  const handleStaffAssign = async () => {
    if (selectedIds.length === 0) {
      Swal.fire('선택 없음', '고객을 선택하세요', 'warning');
      return;
    }

    let staffOpts = '<option value="">담당자 선택</option>';
    staffList.forEach(s => { staffOpts += `<option value="${s.name}">${s.name}</option>`; });

    const { value: staffName, isConfirmed } = await Swal.fire({
      title: '👤 담당자 배정',
      html: `<div style="margin-bottom:10px;">${selectedIds.length}명 선택됨</div>
             <select id="swal-staff" class="swal2-input">${staffOpts}</select>`,
      showCancelButton: true,
      confirmButtonText: '배정',
      cancelButtonText: '취소',
      preConfirm: () => {
        const val = document.getElementById('swal-staff').value;
        if (!val) {
          Swal.showValidationMessage('담당자를 선택하세요');
          return false;
        }
        return val;
      }
    });

    if (isConfirmed && staffName) {
      try {
        for (const id of selectedIds) {
          await updateDoc(doc(db, 'customers', id), { 
            staffName: staffName,
            staffId: staffList.find(s => s.name === staffName)?.visibleId || ''
          });
        }
        Swal.fire('완료', `${selectedIds.length}명에게 ${staffName} 배정됨`, 'success');
        setSelectedIds([]);
        fetchData();
      } catch (error) {
        Swal.fire('오류', '배정 실패', 'error');
      }
    }
  };

  // 특별작업 등록
  const handleSpecialWork = async () => {
    if (selectedIds.length === 0) {
      Swal.fire('선택 없음', '고객을 선택하세요', 'warning');
      return;
    }

    const { value: workType, isConfirmed } = await Swal.fire({
      title: '🌟 특별작업 등록',
      html: `
        <div style="margin-bottom:10px;">${selectedIds.length}명 선택됨</div>
        <select id="swal-work-type" class="swal2-input">
          <option value="클레임">😡 클레임</option>
          <option value="신규작업">✨ 신규작업</option>
          <option value="고객상담">📞 고객상담</option>
          <option value="추가작업">➕ 추가작업</option>
        </select>
        <textarea id="swal-work-memo" class="swal2-textarea" placeholder="메모 (선택)" style="margin-top:10px;"></textarea>
      `,
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      confirmButtonColor: '#f59e0b',
      preConfirm: () => {
        return {
          type: document.getElementById('swal-work-type').value,
          memo: document.getElementById('swal-work-memo').value
        };
      }
    });

    if (isConfirmed && workType) {
      try {
        for (const id of selectedIds) {
          const customer = customers.find(c => c.id === id);
          if (!customer) continue;

          // 태그 추가
          const currentTags = customer.tags || [];
          if (!currentTags.includes(workType.type)) {
            await updateDoc(doc(db, 'customers', id), {
              tags: [...currentTags, workType.type]
            });
          }

          // 특별작업 대기목록에 추가
          await addDoc(collection(db, 'specialWorks'), {
            customerId: id,
            title: customer.name,
            name: customer.name,
            phone: customer.phone,
            address: customer.address,
            price: getTotalPrice(customer),
            staffName: customer.staffName,
            workType: workType.type,
            memo: workType.memo,
            isSpecial: true,
            createdAt: new Date().toISOString()
          });
        }
        
        Swal.fire('완료', `${selectedIds.length}건 특별작업 등록됨`, 'success');
        setSelectedIds([]);
        fetchData();
      } catch (error) {
        Swal.fire('오류', '등록 실패', 'error');
      }
    }
  };

  // 알림 발송 (시뮬레이션)
  const handleNotification = async () => {
    if (selectedIds.length === 0) {
      Swal.fire('선택 없음', '고객을 선택하세요', 'warning');
      return;
    }

    const selectedCustomers = customers.filter(c => selectedIds.includes(c.id));
    const withPhone = selectedCustomers.filter(c => c.phone);

    if (withPhone.length === 0) {
      Swal.fire('연락처 없음', '선택된 고객 중 연락처가 있는 고객이 없습니다', 'warning');
      return;
    }

    const { value: message, isConfirmed } = await Swal.fire({
      title: '📱 알림 발송',
      html: `
        <div style="margin-bottom:10px;">${withPhone.length}명에게 발송</div>
        <div style="font-size:12px; color:#666; margin-bottom:10px;">
          ${withPhone.slice(0, 5).map(c => c.name).join(', ')}${withPhone.length > 5 ? ` 외 ${withPhone.length - 5}명` : ''}
        </div>
        <textarea id="swal-message" class="swal2-textarea" placeholder="메시지 내용" style="height:100px;">안녕하세요, WhiteLine입니다.
내일 방문 예정입니다.
감사합니다.</textarea>
      `,
      showCancelButton: true,
      confirmButtonText: '발송',
      cancelButtonText: '취소',
      confirmButtonColor: '#10b981',
      preConfirm: () => document.getElementById('swal-message').value
    });

    if (isConfirmed && message) {
      // 실제로는 알림톡 API 호출
      // 여기서는 시뮬레이션
      Swal.fire({
        title: '발송 완료',
        html: `
          <div style="font-size:14px;">
            <div>✅ ${withPhone.length}명에게 발송됨</div>
            <div style="margin-top:10px; padding:10px; background:#f8fafc; border-radius:8px; text-align:left; font-size:12px;">
              ${message.replace(/\n/g, '<br>')}
            </div>
          </div>
        `,
        icon: 'success'
      });
      setSelectedIds([]);
    }
  };

  const getTotalPrice = (c) => {
    if (c.services && c.services.length > 0) {
      return c.services.reduce((sum, s) => sum + (s.price || 0), 0);
    }
    return c.price || 0;
  };

  const filteredCustomers = customers.filter(c => {
    // 삭제된 고객 제외
    if (c.custStatus === '삭제') return false;
    
    const matchSearch = 
      (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone || '').includes(searchTerm) ||
      (c.address || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchSearch) return false;

    if (filter === 'all') return c.custStatus !== '해약';
    if (filter === 'cancelled') return c.custStatus === '해약';
    if (filter === 'unassigned') return (!c.staffName || c.staffName === '-') && c.custStatus !== '해약';
    if (filter === 'recontract') return c.recontractDate && c.custStatus !== '해약';
    if (filter === 'tag-claim') return c.tags && c.tags.includes('클레임') && c.custStatus !== '해약';
    if (filter === 'tag-new') return c.tags && c.tags.includes('신규작업') && c.custStatus !== '해약';
    if (filter === 'tag-consult') return c.tags && c.tags.includes('고객상담') && c.custStatus !== '해약';
    if (filter.startsWith('staff_')) return c.staffName === filter.replace('staff_', '') && c.custStatus !== '해약';
    
    return c.custStatus !== '해약';
  });

  // 정렬
  let sortedCustomers = [...filteredCustomers];
  if (filter === 'sort-recent') {
    sortedCustomers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (filter === 'sort-assigned') {
    sortedCustomers.sort((a, b) => new Date(b.lastAssigned || 0) - new Date(a.lastAssigned || 0));
  } else if (filter === 'recontract') {
    sortedCustomers.sort((a, b) => new Date(b.recontractDate || 0) - new Date(a.recontractDate || 0));
  }

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="🔍 고객 검색"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.filterSelect}>
          <option value="all">전체</option>
          <option value="unassigned">❓ 미배정</option>
          <option value="recontract">🔄 재계약</option>
          <option value="sort-recent">🆕 최근가입</option>
          <option value="sort-assigned">📅 최근배정</option>
          <optgroup label="태그별">
            <option value="tag-claim">😡 클레임</option>
            <option value="tag-new">✨ 신규</option>
            <option value="tag-consult">📞 상담</option>
          </optgroup>
          <optgroup label="담당자별">
            {staffList.map(s => (
              <option key={s.id} value={`staff_${s.name}`}>👤 {s.name}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <div style={styles.countRow}>
        <label style={styles.selectAll}>
          <input 
            type="checkbox" 
            checked={selectedIds.length === filteredCustomers.length && filteredCustomers.length > 0}
            onChange={handleSelectAll}
          />
          전체선택
        </label>
        <span style={styles.countText}>
          {selectedIds.length > 0 ? `${selectedIds.length}명 선택됨 / ` : ''}
          총 {filteredCustomers.length}명
        </span>
      </div>

      <div style={styles.list}>
        {sortedCustomers.length === 0 ? (
          <div style={styles.empty}>해당 조건의 고객이 없습니다</div>
        ) : (
          sortedCustomers.slice(0, 100).map(customer => (
            <div key={customer.id} style={styles.card}>
              <div style={styles.cardContent}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(customer.id)}
                  onChange={() => handleCheckbox(customer.id)}
                  style={styles.checkbox}
                />
                <div style={styles.cardInfo}>
                  <div style={styles.cardHeader}>
                    <span style={styles.name}>{customer.name}</span>
                    <span style={styles.code}>{customer.code}</span>
                  </div>
                  <div style={styles.info}>📅 가입: {customer.createdAt || '-'}</div>
                  {customer.recontractDate && (
                    <div style={styles.recontractBadge}>🔄 재계약 {customer.recontractDate}</div>
                  )}
                  {customer.tags && customer.tags.length > 0 && (
                    <div style={styles.tagsRow}>
                      {customer.tags.map((t, idx) => (
                        <span key={idx} style={{
                          ...styles.tag,
                          backgroundColor: t === '클레임' ? '#fee2e2' : t === '신규작업' ? '#dbeafe' : '#fef3c7'
                        }}>{t}</span>
                      ))}
                    </div>
                  )}
                  <div style={{
                    ...styles.staffName,
                    color: customer.staffName ? '#2563eb' : '#ef4444'
                  }}>
                    👤 {customer.staffName || '(미배정)'}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        {sortedCustomers.length > 100 && (
          <div style={styles.moreText}>... 외 {sortedCustomers.length - 100}명</div>
        )}
      </div>

      {/* 하단 액션 바 */}
      {selectedIds.length > 0 && (
        <div style={styles.actionBar}>
          <button onClick={handleSpecialWork} style={{...styles.actionBtn, backgroundColor: '#f59e0b'}}>
            🌟 특별작업
          </button>
          <button onClick={handleStaffAssign} style={{...styles.actionBtn, backgroundColor: '#2563eb'}}>
            👤 담당배정
          </button>
          <button onClick={handleNotification} style={{...styles.actionBtn, backgroundColor: '#10b981'}}>
            📱 알림발송
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  toolbar: { display: 'flex', gap: '10px', marginBottom: '10px' },
  searchInput: { flex: 1, padding: '10px 15px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' },
  filterSelect: { padding: '10px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', maxWidth: '130px' },
  
  countRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '8px' },
  selectAll: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' },
  countText: { fontSize: '13px', color: '#666' },
  
  list: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '80px' },
  card: { backgroundColor: 'white', padding: '12px', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  cardContent: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  checkbox: { marginTop: '3px', width: '18px', height: '18px', cursor: 'pointer' },
  cardInfo: { flex: 1 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' },
  name: { fontSize: '15px', fontWeight: 'bold' },
  code: { fontSize: '11px', color: '#666', backgroundColor: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' },
  info: { fontSize: '12px', color: '#666', marginBottom: '3px' },
  recontractBadge: { fontSize: '11px', color: '#22c55e', marginBottom: '3px' },
  tagsRow: { display: 'flex', gap: '5px', marginBottom: '5px', flexWrap: 'wrap' },
  tag: { padding: '2px 8px', borderRadius: '10px', fontSize: '10px' },
  staffName: { fontSize: '13px', fontWeight: 'bold' },
  
  actionBar: { position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', gap: '10px', padding: '15px', backgroundColor: 'white', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)', zIndex: 100 },
  actionBtn: { flex: 1, padding: '12px', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' },
  
  loading: { textAlign: 'center', padding: '50px', color: '#666' },
  empty: { textAlign: 'center', padding: '50px', color: '#999' },
  moreText: { textAlign: 'center', padding: '15px', color: '#666', fontSize: '12px' }
};

export default AssignmentPage;
