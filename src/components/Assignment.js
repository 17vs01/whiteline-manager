import React, { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

function Assignment() {
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // 고객 불러오기
      const custSnapshot = await getDocs(collection(db, 'customers'));
      const custList = custSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCustomers(custList);

      // 직원 불러오기
      const staffSnapshot = await getDocs(collection(db, 'staff'));
      const staffList = staffSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setStaff(staffList);

      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  // 담당자 배정
  const handleAssign = async (customer) => {
    if (staff.length === 0) {
      Swal.fire('알림', '먼저 직원을 등록해주세요!', 'info');
      return;
    }

    const staffOptions = staff.map(s => 
      `<option value="${s.id}" ${customer.staffId === s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const { value: staffId } = await Swal.fire({
      title: '담당자 배정',
      html:
        `<p style="margin-bottom:15px;"><strong>${customer.name}</strong> 고객</p>` +
        `<select id="swal-staff" class="swal2-select" style="width:100%;padding:10px;">
          <option value="">-- 담당자 선택 --</option>
          ${staffOptions}
        </select>`,
      showCancelButton: true,
      confirmButtonText: '배정',
      cancelButtonText: '취소',
      preConfirm: () => {
        return document.getElementById('swal-staff').value;
      }
    });

    if (staffId) {
      const selectedStaff = staff.find(s => s.id === staffId);
      try {
        await updateDoc(doc(db, 'customers', customer.id), {
          staffId: staffId,
          staffName: selectedStaff ? selectedStaff.name : ''
        });
        Swal.fire('완료', '담당자가 배정되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '배정 실패!', 'error');
      }
    }
  };

  // 담당자 해제
  const handleUnassign = async (customer) => {
    const result = await Swal.fire({
      title: '배정 해제',
      text: `${customer.name} 고객의 담당자를 해제하시겠습니까?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '해제',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        await updateDoc(doc(db, 'customers', customer.id), {
          staffId: '',
          staffName: ''
        });
        Swal.fire('완료', '담당자가 해제되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '해제 실패!', 'error');
      }
    }
  };

  // 필터링
  const filteredCustomers = customers.filter(c => {
    if (filter === 'all') return true;
    if (filter === 'unassigned') return !c.staffId;
    if (filter === 'assigned') return c.staffId;
    return c.staffId === filter;
  });

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 필터 */}
      <div style={styles.toolbar}>
        <select 
          value={filter} 
          onChange={(e) => setFilter(e.target.value)}
          style={styles.filterSelect}
        >
          <option value="all">전체 고객</option>
          <option value="unassigned">❓ 미배정</option>
          <option value="assigned">✅ 배정완료</option>
          <optgroup label="담당자별">
            {staff.map(s => (
              <option key={s.id} value={s.id}>👤 {s.name}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* 통계 */}
      <div style={styles.statsRow}>
        <div style={styles.statBox}>
          <span style={styles.statValue}>{customers.length}</span>
          <span style={styles.statLabel}>전체</span>
        </div>
        <div style={styles.statBox}>
          <span style={{...styles.statValue, color: '#22c55e'}}>
            {customers.filter(c => c.staffId).length}
          </span>
          <span style={styles.statLabel}>배정완료</span>
        </div>
        <div style={styles.statBox}>
          <span style={{...styles.statValue, color: '#ef4444'}}>
            {customers.filter(c => !c.staffId).length}
          </span>
          <span style={styles.statLabel}>미배정</span>
        </div>
      </div>

      {/* 고객 목록 */}
      <div style={styles.list}>
        {filteredCustomers.length === 0 ? (
          <div style={styles.empty}>해당 고객이 없습니다</div>
        ) : (
          filteredCustomers.map(customer => (
            <div key={customer.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.name}>{customer.name}</span>
                {customer.staffId ? (
                  <span style={styles.assigned}>👤 {customer.staffName}</span>
                ) : (
                  <span style={styles.unassigned}>미배정</span>
                )}
              </div>
              <div style={styles.info}>📞 {customer.phone || '-'}</div>
              <div style={styles.info}>📍 {customer.address || '-'}</div>
              <div style={styles.buttons}>
                <button onClick={() => handleAssign(customer)} style={styles.assignBtn}>
                  {customer.staffId ? '담당자 변경' : '담당자 배정'}
                </button>
                {customer.staffId && (
                  <button onClick={() => handleUnassign(customer)} style={styles.unassignBtn}>
                    해제
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  toolbar: {
    marginBottom: '15px'
  },
  filterSelect: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px'
  },
  statsRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '15px'
  },
  statBox: {
    flex: 1,
    backgroundColor: 'white',
    padding: '15px',
    borderRadius: '8px',
    textAlign: 'center',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
  },
  statValue: {
    display: 'block',
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#2563eb'
  },
  statLabel: {
    fontSize: '12px',
    color: '#666'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  card: {
    backgroundColor: 'white',
    padding: '15px',
    borderRadius: '10px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px'
  },
  name: {
    fontSize: '16px',
    fontWeight: 'bold'
  },
  assigned: {
    padding: '3px 8px',
    backgroundColor: '#dcfce7',
    color: '#16a34a',
    borderRadius: '4px',
    fontSize: '12px'
  },
  unassigned: {
    padding: '3px 8px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    borderRadius: '4px',
    fontSize: '12px'
  },
  info: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '5px'
  },
  buttons: {
    display: 'flex',
    gap: '10px',
    marginTop: '10px'
  },
  assignBtn: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  unassignBtn: {
    padding: '8px 15px',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  loading: {
    textAlign: 'center',
    padding: '50px',
    color: '#666'
  },
  empty: {
    textAlign: 'center',
    padding: '50px',
    color: '#999'
  }
};

export default Assignment;