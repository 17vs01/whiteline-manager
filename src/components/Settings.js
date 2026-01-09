import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

function Settings() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'staff'));
      const staffList = snapshot.docs.map(doc => ({
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

  // 직원 추가
  const handleAddStaff = async () => {
    const { value: formValues } = await Swal.fire({
      title: '직원 등록',
      html:
        '<input id="swal-name" class="swal2-input" placeholder="이름">' +
        '<input id="swal-email" class="swal2-input" placeholder="이메일">' +
        '<input id="swal-phone" class="swal2-input" placeholder="전화번호">' +
        '<select id="swal-role" class="swal2-select" style="width:100%;padding:10px;margin-top:10px;">' +
        '<option value="staff">직원</option>' +
        '<option value="master">관리자</option>' +
        '</select>',
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      preConfirm: () => {
        return {
          name: document.getElementById('swal-name').value,
          email: document.getElementById('swal-email').value,
          phone: document.getElementById('swal-phone').value,
          role: document.getElementById('swal-role').value
        };
      }
    });

    if (formValues && formValues.name) {
      try {
        await addDoc(collection(db, 'staff'), {
          ...formValues,
          createdAt: new Date().toISOString()
        });
        Swal.fire('완료', '직원이 등록되었습니다!', 'success');
        fetchStaff();
      } catch (error) {
        Swal.fire('오류', '등록 실패!', 'error');
      }
    }
  };

  // 직원 수정
  const handleEditStaff = async (staffMember) => {
    const { value: formValues } = await Swal.fire({
      title: '직원 수정',
      html:
        `<input id="swal-name" class="swal2-input" value="${staffMember.name || ''}" placeholder="이름">` +
        `<input id="swal-email" class="swal2-input" value="${staffMember.email || ''}" placeholder="이메일">` +
        `<input id="swal-phone" class="swal2-input" value="${staffMember.phone || ''}" placeholder="전화번호">` +
        `<select id="swal-role" class="swal2-select" style="width:100%;padding:10px;margin-top:10px;">` +
        `<option value="staff" ${staffMember.role === 'staff' ? 'selected' : ''}>직원</option>` +
        `<option value="master" ${staffMember.role === 'master' ? 'selected' : ''}>관리자</option>` +
        `</select>`,
      showCancelButton: true,
      confirmButtonText: '수정',
      cancelButtonText: '취소',
      preConfirm: () => {
        return {
          name: document.getElementById('swal-name').value,
          email: document.getElementById('swal-email').value,
          phone: document.getElementById('swal-phone').value,
          role: document.getElementById('swal-role').value
        };
      }
    });

    if (formValues) {
      try {
        await updateDoc(doc(db, 'staff', staffMember.id), formValues);
        Swal.fire('완료', '수정되었습니다!', 'success');
        fetchStaff();
      } catch (error) {
        Swal.fire('오류', '수정 실패!', 'error');
      }
    }
  };

  // 직원 삭제
  const handleDeleteStaff = async (staffMember) => {
    const result = await Swal.fire({
      title: '삭제 확인',
      text: `${staffMember.name} 직원을 삭제하시겠습니까?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'staff', staffMember.id));
        Swal.fire('완료', '삭제되었습니다!', 'success');
        fetchStaff();
      } catch (error) {
        Swal.fire('오류', '삭제 실패!', 'error');
      }
    }
  };

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 직원 관리 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>👥 직원 관리</h3>
          <button onClick={handleAddStaff} style={styles.addButton}>
            + 직원등록
          </button>
        </div>
        
        <div style={styles.list}>
          {staff.length === 0 ? (
            <div style={styles.empty}>등록된 직원이 없습니다</div>
          ) : (
            staff.map(member => (
              <div key={member.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.name}>{member.name}</span>
                  <span style={{
                    ...styles.role,
                    backgroundColor: member.role === 'master' ? '#fef3c7' : '#dbeafe',
                    color: member.role === 'master' ? '#d97706' : '#2563eb'
                  }}>
                    {member.role === 'master' ? '관리자' : '직원'}
                  </span>
                </div>
                <div style={styles.info}>📧 {member.email || '-'}</div>
                <div style={styles.info}>📞 {member.phone || '-'}</div>
                <div style={styles.buttons}>
                  <button onClick={() => handleEditStaff(member)} style={styles.editBtn}>수정</button>
                  <button onClick={() => handleDeleteStaff(member)} style={styles.deleteBtn}>삭제</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  section: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '10px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
    marginBottom: '20px'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px'
  },
  sectionTitle: {
    margin: 0,
    fontSize: '16px'
  },
  addButton: {
    padding: '8px 15px',
    backgroundColor: '#22c55e',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  card: {
    backgroundColor: '#f9fafb',
    padding: '15px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px'
  },
  name: {
    fontSize: '15px',
    fontWeight: 'bold'
  },
  role: {
    padding: '3px 8px',
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
  editBtn: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer'
  },
  deleteBtn: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#ef4444',
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
    padding: '30px',
    color: '#999'
  }
};

export default Settings;