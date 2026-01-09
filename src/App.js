import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, updateDoc, doc, deleteDoc, addDoc } from 'firebase/firestore';
import { db, auth, firebaseConfig } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import Swal from 'sweetalert2';
import CalendarPage from './components/CalendarPage';
import CustomerList from './components/CustomerList';
import StaffManagement from './components/StaffManagement';
import SettingPage from './components/SettingPage';
import TempPlanPage from './components/TempPlanPage';
import ExcelUploadPage from './components/ExcelUploadPage';

function App() {
  const [user, setUser] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [currentPage, setCurrentPage] = useState('calendar');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        await fetchStaffList();
        await findCurrentUser(firebaseUser.email);
      } else {
        setUser(null);
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 알림 로드
  useEffect(() => {
    if (currentUser?.role === 'master') {
      fetchNotifications();
    }
  }, [currentUser]);

  const fetchNotifications = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'notifications'), where('read', '==', false)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setNotifications(list);
    } catch (error) {
      console.error('알림 로드 오류:', error);
    }
  };

  const handleNotificationClick = async () => {
    if (notifications.length === 0) {
      Swal.fire('알림', '새 알림이 없습니다.', 'info');
      return;
    }

    let html = '<div style="max-height:400px; overflow-y:auto; text-align:left;">';
    notifications.forEach(n => {
      if (n.type === 'cancelRequest') {
        html += `
          <div style="padding:12px; border-bottom:1px solid #eee; background:#fef2f2; border-radius:8px; margin-bottom:8px;">
            <div style="font-weight:bold; color:#dc2626;">🔴 해약 요청</div>
            <div style="margin:5px 0;"><b>${n.customerName}</b></div>
            <div style="font-size:12px; color:#666;">요청: ${n.requestBy} (${n.requestAt?.split('T')[0] || '-'})</div>
            ${n.memo ? `<div style="font-size:12px; color:#666; margin-top:5px;">사유: ${n.memo}</div>` : ''}
            <div style="margin-top:10px; display:flex; gap:8px;">
              <button onclick="window.approveCancelRequest('${n.id}', '${n.customerCode}')" style="flex:1; padding:8px; background:#ef4444; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">해약 승인</button>
              <button onclick="window.dismissNotification('${n.id}')" style="flex:1; padding:8px; background:#6b7280; color:white; border:none; border-radius:6px; cursor:pointer;">나중에</button>
            </div>
          </div>
        `;
      }
    });
    html += '</div>';

    Swal.fire({
      title: `🔔 알림 (${notifications.length})`,
      html,
      showConfirmButton: false,
      showCloseButton: true,
      width: '400px'
    });

    // 해약 승인 처리
    window.approveCancelRequest = async (notifId, customerCode) => {
      Swal.close();
      
      // 특별작업 확인
      const customer = (await getDocs(collection(db, 'customers'))).docs.find(d => d.id === customerCode)?.data();
      const hasSpecialWork = customer?.specialWork?.staffId;

      if (hasSpecialWork) {
        const result = await Swal.fire({
          title: '특별작업 처리',
          html: '이 고객에게 등록된 특별작업이 있습니다.<br>특별작업도 삭제하시겠습니까?',
          icon: 'question',
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: '예 (함께 삭제)',
          denyButtonText: '아니오 (별도 처리)',
          cancelButtonText: '취소'
        });

        if (result.isConfirmed) {
          // 정기 해약 + 특별작업 삭제
          await updateDoc(doc(db, 'customers', customerCode), { 
            custStatus: '해약',
            cancelledAt: new Date().toISOString(),
            cancelledBy: currentUser.name,
            specialWork: null
          });
        } else if (result.isDenied) {
          // 정기만 해약
          await updateDoc(doc(db, 'customers', customerCode), { 
            custStatus: '해약',
            cancelledAt: new Date().toISOString(),
            cancelledBy: currentUser.name
          });
        } else {
          return; // 취소
        }
      } else {
        // 특별작업 없음 → 바로 해약
        await updateDoc(doc(db, 'customers', customerCode), { 
          custStatus: '해약',
          cancelledAt: new Date().toISOString(),
          cancelledBy: currentUser.name
        });
      }

      // 알림 읽음 처리
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
      
      Swal.fire('완료', '해약 처리 완료', 'success');
      fetchNotifications();
    };

    // 알림 나중에 (읽음 처리)
    window.dismissNotification = async (notifId) => {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
      Swal.close();
      fetchNotifications();
    };
  };

  const fetchStaffList = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'staff'));
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaffList(list);
      return list;
    } catch (error) {
      console.error('Error fetching staff:', error);
      return [];
    }
  };

  const findCurrentUser = async (email) => {
    try {
      const snapshot = await getDocs(collection(db, 'staff'));
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaffList(list);

      const emailId = email.split('@')[0];
      const found = list.find(s => s.visibleId === emailId);
      if (found) {
        setCurrentUser({ ...found, id: found.visibleId });
      } else {
        setCurrentUser({ id: emailId, name: emailId, role: 'master', visibleId: emailId });
      }
    } catch (error) {
      console.error('Error finding user:', error);
    }
  };

  // 비밀번호 찾기
  const handleForgotPassword = async () => {
    const { value: userId } = await Swal.fire({
      title: '🔐 비밀번호 찾기',
      html: `
        <div style="text-align:left; padding:10px;">
          <p style="font-size:13px; color:#666; margin-bottom:15px;">
            가입 시 등록한 이메일로 비밀번호 재설정 링크를 보내드립니다.
          </p>
          <input id="swal-userid" class="swal2-input" placeholder="아이디 입력" style="margin:0;">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '전송',
      cancelButtonText: '취소',
      preConfirm: () => {
        const id = document.getElementById('swal-userid').value.trim();
        if (!id) {
          Swal.showValidationMessage('아이디를 입력하세요');
          return false;
        }
        return id;
      }
    });

    if (!userId) return;

    try {
      // staff 컬렉션에서 이메일 조회
      const staffSnap = await getDocs(collection(db, 'staff'));
      const staffMember = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .find(s => s.visibleId === userId);

      if (!staffMember || !staffMember.email) {
        Swal.fire('오류', '해당 아이디를 찾을 수 없거나 등록된 이메일이 없습니다.', 'error');
        return;
      }

      // Firebase Auth 이메일 주소 (로그인용)
      const authEmail = `${userId}@test.com`;
      
      // 비밀번호 재설정 이메일 발송
      await sendPasswordResetEmail(auth, authEmail);

      Swal.fire({
        icon: 'success',
        title: '이메일 전송 완료',
        html: `
          <div style="text-align:left; padding:10px;">
            <p>비밀번호 재설정 링크를 전송했습니다.</p>
            <p style="color:#3b82f6; font-weight:bold; margin-top:10px;">${staffMember.email}</p>
            <p style="font-size:12px; color:#666; margin-top:15px;">
              ※ 이메일이 도착하지 않으면 스팸함을 확인해주세요.<br>
              ※ Firebase에서 발송되는 이메일입니다.
            </p>
          </div>
        `
      });
    } catch (error) {
      console.error('비밀번호 찾기 오류:', error);
      let errorMsg = '이메일 전송 실패';
      if (error.code === 'auth/user-not-found') {
        errorMsg = '등록되지 않은 사용자입니다.';
      }
      Swal.fire('오류', errorMsg, 'error');
    }
  };

  const handleLogin = async () => {
    const { value: formValues, isDenied, dismiss } = await Swal.fire({
      title: '로그인',
      html: `
        <input id="swal-id" class="swal2-input" placeholder="아이디">
        <input id="swal-pw" class="swal2-input" type="password" placeholder="비밀번호">
        <div style="margin-top:15px;">
          <button type="button" id="forgot-pw-btn" style="background:none; border:none; color:#3b82f6; cursor:pointer; font-size:13px; text-decoration:underline;">
            비밀번호를 잊으셨나요?
          </button>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '로그인',
      denyButtonText: '회원가입',
      denyButtonColor: '#22c55e',
      cancelButtonText: '취소',
      didOpen: () => {
        document.getElementById('forgot-pw-btn').addEventListener('click', () => {
          Swal.close();
          handleForgotPassword();
        });
      },
      preConfirm: () => {
        const id = document.getElementById('swal-id').value;
        const pw = document.getElementById('swal-pw').value;
        if (!id || !pw) {
          Swal.showValidationMessage('아이디와 비밀번호를 입력하세요');
          return false;
        }
        return { id, pw };
      }
    });

    if (isDenied) {
      handleRegister();
      return;
    }

    if (formValues) {
      try {
        const email = `${formValues.id}@test.com`;
        await signInWithEmailAndPassword(auth, email, formValues.pw);
        Swal.fire({ icon: 'success', title: '로그인 성공!', timer: 1500, showConfirmButton: false });
      } catch (error) {
        console.error('Login error:', error);
        let errorMsg = '로그인 실패';
        if (error.code === 'auth/user-not-found') errorMsg = '존재하지 않는 사용자입니다';
        else if (error.code === 'auth/wrong-password') errorMsg = '비밀번호가 틀렸습니다';
        else if (error.code === 'auth/invalid-credential') errorMsg = '아이디 또는 비밀번호를 확인하세요';
        Swal.fire('로그인 실패', errorMsg, 'error');
      }
    }
  };

  // 회원가입
  const handleRegister = async () => {
    const { value } = await Swal.fire({
      title: '📝 회원가입',
      html: `
        <div style="text-align:left; padding:0 10px; max-height:450px; overflow-y:auto;">
          <div style="font-weight:bold; margin:10px 0 5px; color:#dc2626; font-size:12px;">* 필수 입력</div>
          
          <input id="reg-id" class="swal2-input" placeholder="아이디 (영문/숫자)" style="margin:5px auto;">
          <input id="reg-pw" class="swal2-input" type="password" placeholder="비밀번호 (영문+숫자+특수문자, 8자 이상)" style="margin:5px auto;">
          <input id="reg-pw2" class="swal2-input" type="password" placeholder="비밀번호 확인" style="margin:5px auto;">
          <input id="reg-name" class="swal2-input" placeholder="성함" style="margin:5px auto;">
          <input id="reg-phone" class="swal2-input" placeholder="전화번호 (010-0000-0000)" style="margin:5px auto;">
          <input id="reg-address" class="swal2-input" placeholder="주소" style="margin:5px auto;">
          <input id="reg-email" class="swal2-input" type="email" placeholder="이메일" style="margin:5px auto;">
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#666; font-size:12px;">선택 입력</div>
          
          <input id="reg-dept" class="swal2-input" placeholder="부서" style="margin:5px auto;">
          <select id="reg-position" class="swal2-input" style="margin:5px auto;">
            <option value="">직급 선택</option>
            <option value="사원">사원</option>
            <option value="주임">주임</option>
            <option value="대리">대리</option>
            <option value="과장">과장</option>
            <option value="차장">차장</option>
            <option value="부장">부장</option>
            <option value="이사">이사</option>
          </select>
          <input id="reg-hobby" class="swal2-input" placeholder="취미" style="margin:5px auto;">
          <div style="display:flex; gap:8px; align-items:center; margin:5px 15px;">
            <input id="reg-birth" type="date" class="swal2-input" style="flex:1; margin:0;">
            <select id="reg-birthType" class="swal2-input" style="width:80px; margin:0;">
              <option value="solar">양력</option>
              <option value="lunar">음력</option>
            </select>
          </div>
          
          <div style="margin-top:15px; padding:10px; background:#f0f9ff; border-radius:8px; font-size:11px; color:#0369a1;">
            💡 비밀번호 양식: 영문, 숫자, 특수문자(!@#$%^&*) 조합 8자 이상
          </div>
        </div>
      `,
      width: '420px',
      showCancelButton: true,
      confirmButtonText: '가입하기',
      cancelButtonText: '취소',
      preConfirm: () => {
        const id = document.getElementById('reg-id').value.trim();
        const pw = document.getElementById('reg-pw').value;
        const pw2 = document.getElementById('reg-pw2').value;
        const name = document.getElementById('reg-name').value.trim();
        const phone = document.getElementById('reg-phone').value.trim();
        const address = document.getElementById('reg-address').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        
        // 필수 체크
        if (!id || !pw || !name || !phone || !address || !email) {
          Swal.showValidationMessage('필수 항목을 모두 입력하세요');
          return false;
        }
        
        // ID 형식
        if (!/^[a-zA-Z0-9]+$/.test(id)) {
          Swal.showValidationMessage('아이디는 영문/숫자만 가능합니다');
          return false;
        }
        
        // 비밀번호 양식 체크 (영문+숫자+특수문자, 8자 이상)
        if (pw.length < 8) {
          Swal.showValidationMessage('비밀번호는 8자 이상이어야 합니다');
          return false;
        }
        if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[!@#$%^&*]/.test(pw)) {
          Swal.showValidationMessage('비밀번호는 영문, 숫자, 특수문자(!@#$%^&*)를 포함해야 합니다');
          return false;
        }
        
        // 비밀번호 확인
        if (pw !== pw2) {
          Swal.showValidationMessage('비밀번호가 일치하지 않습니다');
          return false;
        }
        
        // 이메일 형식
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          Swal.showValidationMessage('올바른 이메일 형식을 입력하세요');
          return false;
        }
        
        return {
          visibleId: id,
          pw,
          name,
          phone,
          address,
          email,
          department: document.getElementById('reg-dept').value,
          position: document.getElementById('reg-position').value,
          hobby: document.getElementById('reg-hobby').value,
          birthDate: document.getElementById('reg-birth').value,
          birthType: document.getElementById('reg-birthType').value,
          role: 'staff' // 기본 역할
        };
      }
    });

    if (value) {
      // 로딩 표시
      Swal.fire({
        title: '가입 중...',
        text: '계정을 생성하고 있습니다.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      try {
        const loginEmail = `${value.visibleId}@test.com`;
        
        // Firebase Auth 계정 생성
        await createUserWithEmailAndPassword(auth, loginEmail, value.pw);
        
        // Firestore에 직원 정보 저장
        await addDoc(collection(db, 'staff'), {
          ...value,
          createdAt: new Date().toISOString()
        });
        
        await fetchStaffList();
        await findCurrentUser(loginEmail);
        
        Swal.fire({
          icon: 'success',
          title: '🎉 가입 완료!',
          html: `
            <div style="text-align:left; padding:10px;">
              <p><b>성함:</b> ${value.name}</p>
              <p><b>아이디:</b> ${value.visibleId}</p>
            </div>
            <div style="font-size:12px; color:#666;">자동 로그인되었습니다.</div>
          `
        });
        
      } catch (error) {
        console.error('가입 오류:', error);
        let errorMsg = '가입 실패';
        if (error.code === 'auth/email-already-in-use') {
          errorMsg = '이미 사용 중인 아이디입니다.';
        } else if (error.code === 'auth/weak-password') {
          errorMsg = '비밀번호가 너무 약합니다.';
        }
        Swal.fire('오류', errorMsg, 'error');
      }
    }
  };

  const handleLogout = async () => {
    const result = await Swal.fire({
      title: '로그아웃',
      text: '로그아웃 하시겠습니까?',
      showCancelButton: true,
      confirmButtonText: '로그아웃',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      await signOut(auth);
      setUser(null);
      setCurrentUser(null);
      setCurrentPage('calendar');
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>로딩중...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginBox}>
          <h1 style={styles.loginTitle}>📋 화이트라인</h1>
          <p style={styles.loginSubtitle}>고객관리 시스템</p>
          <button onClick={handleLogin} style={styles.loginButton}>로그인</button>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'calendar':
        return <CalendarPage currentUser={currentUser} staffList={staffList} onNotification={fetchNotifications} />;
      case 'tempPlan':
        return <TempPlanPage currentUser={currentUser} staffList={staffList} />;
      case 'customers':
        return <CustomerList currentUser={currentUser} staffList={staffList} setCurrentPage={setCurrentPage} />;
      case 'excel':
        return <ExcelUploadPage currentUser={currentUser} staffList={staffList} onComplete={() => setCurrentPage('customers')} />;
      case 'staff':
        return <StaffManagement currentUser={currentUser} staffList={staffList} onStaffUpdate={fetchStaffList} />;
      case 'settings':
        return <SettingPage currentUser={currentUser} staffList={staffList} onStaffUpdate={fetchStaffList} />;
      default:
        return <CalendarPage currentUser={currentUser} staffList={staffList} onNotification={fetchNotifications} />;
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerTitle}>📋 화이트라인</div>
        <div style={styles.headerRight}>
          {/* 알림 아이콘 (관리자만) */}
          {currentUser?.role === 'master' && (
            <div 
              onClick={handleNotificationClick}
              style={{
                position: 'relative',
                cursor: 'pointer',
                marginRight: '15px',
                fontSize: '20px'
              }}
            >
              🔔
              {notifications.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-5px',
                  right: '-8px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  minWidth: '16px',
                  textAlign: 'center'
                }}>
                  {notifications.length}
                </span>
              )}
            </div>
          )}
          <div style={styles.headerUser} onClick={handleLogout}>
            {currentUser?.name || '사용자'} 
            <span style={{
              ...styles.roleTag,
              backgroundColor: currentUser?.role === 'master' ? '#dc2626' : 
                              currentUser?.role === 'master1' ? '#7c3aed' : 
                              currentUser?.role === 'master2' ? '#0891b2' : '#3b82f6'
            }}>
              {currentUser?.role === 'master' ? '관리자' : 
               currentUser?.role === 'master1' ? '팀장' : 
               currentUser?.role === 'master2' ? '부팀장' : '직원'}
            </span>
          </div>
        </div>
      </header>

      <main style={styles.main}>{renderPage()}</main>

      <nav style={styles.nav}>
        <button onClick={() => setCurrentPage('calendar')} style={{...styles.navBtn, ...(currentPage === 'calendar' ? styles.navBtnActive : {})}}>
          <span style={styles.navIcon}>📅</span>
          <span style={styles.navText}>배정플랜</span>
        </button>
        <button onClick={() => setCurrentPage('tempPlan')} style={{...styles.navBtn, ...(currentPage === 'tempPlan' ? styles.navBtnActive : {})}}>
          <span style={styles.navIcon}>📝</span>
          <span style={styles.navText}>임시플랜</span>
        </button>
        <button onClick={() => setCurrentPage('customers')} style={{...styles.navBtn, ...(currentPage === 'customers' ? styles.navBtnActive : {})}}>
          <span style={styles.navIcon}>👥</span>
          <span style={styles.navText}>고객관리</span>
        </button>
        <button onClick={() => setCurrentPage('staff')} style={{...styles.navBtn, ...(currentPage === 'staff' ? styles.navBtnActive : {})}}>
          <span style={styles.navIcon}>📊</span>
          <span style={styles.navText}>직원관리</span>
        </button>
        {currentUser?.role === 'master' && (
          <button onClick={() => setCurrentPage('settings')} style={{...styles.navBtn, ...(currentPage === 'settings' ? styles.navBtnActive : {})}}>
            <span style={styles.navIcon}>⚙️</span>
            <span style={styles.navText}>설정</span>
          </button>
        )}
      </nav>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#f3f4f6', display: 'flex', flexDirection: 'column' },
  loadingContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f3f4f6' },
  loadingText: { fontSize: '18px', color: '#666' },
  loginContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#3b82f6' },
  loginBox: { backgroundColor: 'white', padding: '40px', borderRadius: '20px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  loginTitle: { fontSize: '28px', marginBottom: '10px', color: '#1e40af' },
  loginSubtitle: { color: '#666', marginBottom: '30px' },
  loginButton: { width: '100%', padding: '15px 40px', fontSize: '16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' },
  header: { backgroundColor: '#1e40af', color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: '18px', fontWeight: 'bold' },
  headerRight: { display: 'flex', alignItems: 'center' },
  headerUser: { fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' },
  roleTag: { backgroundColor: 'rgba(255,255,255,0.2)', padding: '3px 8px', borderRadius: '10px', fontSize: '11px' },
  main: { flex: 1, padding: '15px', paddingBottom: '80px', overflowY: 'auto' },
  nav: { position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: 'white', display: 'flex', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)', zIndex: 1000 },
  navBtn: { flex: 1, padding: '12px 0', border: 'none', backgroundColor: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', color: '#9ca3af' },
  navBtnActive: { color: '#3b82f6', backgroundColor: '#eff6ff' },
  navIcon: { fontSize: '20px', marginBottom: '3px' },
  navText: { fontSize: '11px', fontWeight: 'bold' }
};

export default App;
