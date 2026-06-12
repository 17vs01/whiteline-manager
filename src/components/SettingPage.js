import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, firebaseConfig } from '../firebase';
import Swal from 'sweetalert2';
import { useAppContext } from '../context/AppContext';

function SettingPage({ currentUser, staffList, onStaffUpdate }) {
  const { settings: ctxSettings, fetchSettings: refreshCtxSettings } = useAppContext();
  const [staff, setStaff] = useState([]);
  const [settings, setSettings] = useState({
    fallbackOption: 'waiting',
    overtimeHour: 10,
    overtimeMinute: 0,
    overtimeEnabled: true,
    aiAssignEnabled: true,
    companyName: '화이트라인',
    companyLogo: '📋',
    priceStep: 1000  // 금액 증감 단위 (1000/5000/10000)
  });
  const [settingsDocId, setSettingsDocId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);

  // 사용약제 마스터 state
  const [pesticideTypes, setPesticideTypes] = useState([]);

  useEffect(() => { fetchData(); }, []);

  // staffList prop 변경 시 로컬 staff 동기화
  useEffect(() => {
    if (staffList && staffList.length > 0) setStaff(staffList);
  }, [staffList]);

  const fetchData = async () => {
    try {
      // staff: prop 우선 사용, 없으면 직접 fetch
      if (staffList && staffList.length > 0) {
        setStaff(staffList);
      } else {
        const staffSnap = await getDocs(collection(db, 'staff'));
        setStaff(staffSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }

      // settings: doc id가 필요해서 1회만 fetch (저장/수정에 필요)
      const settingsSnap = await getDocs(collection(db, 'settings'));
      if (settingsSnap.docs.length > 0) {
        setSettings(settingsSnap.docs[0].data());
        setSettingsDocId(settingsSnap.docs[0].id);
      }

      // 사용약제 마스터 로드
      const pestSnap = await getDocs(collection(db, 'pesticideTypes'));
      const pestList = pestSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      setPesticideTypes(pestList);

      setLoading(false);
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  const handleAddStaff = async () => {
    const { value } = await Swal.fire({
      title: '👤 직원 등록',
      html: `
        <div style="text-align:left; padding:0 10px; max-height:450px; overflow-y:auto;">
          <div style="font-weight:bold; margin:10px 0 5px; color:#dc2626; font-size:12px;">* 필수 입력</div>
          
          <input id="swal-id" class="swal2-input" placeholder="아이디 (영문/숫자)" style="margin:5px auto;">
          <input id="swal-pw" class="swal2-input" type="password" placeholder="비밀번호 (영문+숫자+특수문자, 8자 이상)" style="margin:5px auto;">
          <input id="swal-pw2" class="swal2-input" type="password" placeholder="비밀번호 확인" style="margin:5px auto;">
          <input id="swal-name" class="swal2-input" placeholder="성함" style="margin:5px auto;">
          <input id="swal-phone" class="swal2-input" placeholder="전화번호 (010-0000-0000)" style="margin:5px auto;">
          <input id="swal-address" class="swal2-input" placeholder="주소" style="margin:5px auto;">
          <input id="swal-email" class="swal2-input" type="email" placeholder="이메일" style="margin:5px auto;">
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#666; font-size:12px;">선택 입력</div>
          
          <input id="swal-dept" class="swal2-input" placeholder="부서" style="margin:5px auto;">
          <select id="swal-position" class="swal2-input" style="margin:5px auto;">
            <option value="">직급 선택</option>
            <option value="사원">사원</option>
            <option value="주임">주임</option>
            <option value="대리">대리</option>
            <option value="과장">과장</option>
            <option value="차장">차장</option>
            <option value="부장">부장</option>
            <option value="이사">이사</option>
          </select>
          <input id="swal-hobby" class="swal2-input" placeholder="취미" style="margin:5px auto;">
          <div style="display:flex; gap:8px; align-items:center; margin:5px 15px;">
            <input id="swal-birth" type="date" class="swal2-input" style="flex:1; margin:0;">
            <select id="swal-birthType" class="swal2-input" style="width:80px; margin:0;">
              <option value="solar">양력</option>
              <option value="lunar">음력</option>
            </select>
          </div>
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#374151; font-size:12px;">🔐 권한 설정</div>
          <select id="swal-role" class="swal2-input" style="margin:5px auto;">
            <option value="staff">직원</option>
            <option value="master2">부팀장</option>
            <option value="master1">팀장</option>
            <option value="master">관리자</option>
          </select>
          
          <div style="margin-top:15px; padding:10px; background:#f0f9ff; border-radius:8px; font-size:11px; color:#0369a1;">
            💡 비밀번호 양식: 영문, 숫자, 특수문자(!@#$%^&*) 조합 8자 이상
          </div>
        </div>
      `,
      width: '420px',
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      preConfirm: () => {
        const id = document.getElementById('swal-id').value.trim();
        const pw = document.getElementById('swal-pw').value;
        const pw2 = document.getElementById('swal-pw2').value;
        const name = document.getElementById('swal-name').value.trim();
        const phone = document.getElementById('swal-phone').value.trim();
        const address = document.getElementById('swal-address').value.trim();
        const email = document.getElementById('swal-email').value.trim();
        
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
          department: document.getElementById('swal-dept').value,
          position: document.getElementById('swal-position').value,
          hobby: document.getElementById('swal-hobby').value,
          birthDate: document.getElementById('swal-birth').value,
          birthType: document.getElementById('swal-birthType').value,
          role: document.getElementById('swal-role').value
        };
      }
    });

    if (value) {
      // 중복 ID 체크
      const existingStaff = staff.find(s => 
        s.visibleId === value.visibleId || 
        s.visibleId?.split('@')[0] === value.visibleId
      );
      if (existingStaff) {
        Swal.fire('오류', '이미 존재하는 ID입니다.', 'error');
        return;
      }

      // 로딩 표시
      Swal.fire({
        title: '등록 중...',
        text: '계정을 생성하고 있습니다.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      try {
        // Secondary App으로 Firebase Auth 계정 생성 (현재 세션 유지)
        const loginEmail = `${value.visibleId}@test.com`;
        
        // 기존 secondary app 있으면 삭제
        const existingApps = getApps();
        const secondaryAppExists = existingApps.find(app => app.name === 'Secondary');
        if (secondaryAppExists) {
          await deleteApp(secondaryAppExists);
        }
        
        // Secondary App 생성
        const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
        const secondaryAuth = getAuth(secondaryApp);
        
        // 새 계정 생성
        await createUserWithEmailAndPassword(secondaryAuth, loginEmail, value.pw);
        
        // Secondary App 정리
        await deleteApp(secondaryApp);
        
        // Firestore에 직원 정보 저장
        await addDoc(collection(db, 'staff'), { 
          ...value, 
          createdAt: new Date().toISOString() 
        });
        
        Swal.fire({
          icon: 'success',
          title: '등록 완료!',
          html: `
            <div style="text-align:left; padding:10px;">
              <p><b>성함:</b> ${value.name}</p>
              <p><b>아이디:</b> ${value.visibleId}</p>
              <p><b>비밀번호:</b> ${value.pw}</p>
              <p><b>권한:</b> ${value.role === 'master' ? '관리자' : value.role === 'master1' ? '팀장' : value.role === 'master2' ? '부팀장' : '직원'}</p>
            </div>
            <div style="font-size:11px; color:#666; margin-top:10px;">
              위 정보로 로그인 가능합니다.
            </div>
          `
        });
        
        fetchData();
        if (onStaffUpdate) onStaffUpdate();
        
      } catch (error) {
        console.error('직원 등록 오류:', error);
        let errorMsg = '등록 실패';
        if (error.code === 'auth/email-already-in-use') {
          errorMsg = '이미 사용 중인 ID입니다.';
        } else if (error.code === 'auth/weak-password') {
          errorMsg = '비밀번호가 너무 약합니다.';
        }
        Swal.fire('오류', errorMsg, 'error');
      }
    }
  };

  // 원조 관리자 확인 (isOriginal이 있거나, 없으면 visibleId='admin'인 master, 그것도 없으면 첫 번째 master)
  const getOriginalMaster = () => {
    if (!staff || staff.length === 0) return null;
    
    // 1. isOriginal: true인 사람
    const originalMaster = staff.find(s => s.isOriginal === true);
    if (originalMaster) return originalMaster;
    
    // 2. visibleId가 'admin' 또는 'admin@...'인 master
    const adminMaster = staff.find(s => s.role === 'master' && 
      (s.visibleId === 'admin' || s.visibleId?.split('@')[0] === 'admin'));
    if (adminMaster) return adminMaster;
    
    // 3. 첫 번째 master (id 순서로 정렬)
    const masters = staff.filter(s => s.role === 'master').sort((a, b) => a.id.localeCompare(b.id));
    return masters.length > 0 ? masters[0] : null;
  };
  
  const isOriginalMaster = (() => {
    if (!currentUser) return false;
    const original = getOriginalMaster();
    if (!original) return false;
    
    // visibleId 비교 (@ 앞부분만 비교)
    const originalId = original.visibleId?.split('@')[0];
    const currentId = currentUser.visibleId?.split('@')[0];
    return originalId === currentId || original.id === currentUser.id;
  })();

  const handleEditStaff = async (s) => {
    // 원조 관리자인지 확인
    const originalMaster = getOriginalMaster();
    const isTargetOriginal = originalMaster && (
      originalMaster.id === s.id || 
      originalMaster.visibleId?.split('@')[0] === s.visibleId?.split('@')[0]
    );
    
    // 원조 관리자 권한 보호 (원조가 아닌 사람은 원조 수정 불가)
    if (isTargetOriginal && !isOriginalMaster) {
      Swal.fire('권한 없음', '원조 관리자의 정보는 수정할 수 없습니다.', 'warning');
      return;
    }

    // 권한 수정 가능 여부 (원조는 모든 권한 수정 가능, 비원조는 master 수정 불가)
    const canEditRole = isOriginalMaster || s.role !== 'master';

    const { value, isDenied } = await Swal.fire({
      title: '👤 직원 정보',
      html: `
        <div style="text-align:left; padding:0 10px; max-height:450px; overflow-y:auto;">
          <div style="font-weight:bold; margin:10px 0 5px; color:#374151;">기본 정보</div>
          <input id="swal-id" class="swal2-input" value="${s.visibleId || ''}" placeholder="아이디" style="margin:5px auto;" readonly>
          <input id="swal-pw" class="swal2-input" value="${s.pw || ''}" placeholder="비밀번호" type="password" style="margin:5px auto;">
          <input id="swal-name" class="swal2-input" value="${s.name || ''}" placeholder="성함" style="margin:5px auto;">
          <input id="swal-phone" class="swal2-input" value="${s.phone || ''}" placeholder="전화번호" style="margin:5px auto;">
          <input id="swal-address" class="swal2-input" value="${s.address || ''}" placeholder="주소" style="margin:5px auto;">
          <input id="swal-email" class="swal2-input" value="${s.email || ''}" placeholder="이메일" type="email" style="margin:5px auto;">
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#374151;">소속 정보</div>
          <input id="swal-dept" class="swal2-input" value="${s.department || ''}" placeholder="부서" style="margin:5px auto;">
          <select id="swal-position" class="swal2-input" style="margin:5px auto;">
            <option value="">직급 선택</option>
            <option value="사원" ${s.position === '사원' ? 'selected' : ''}>사원</option>
            <option value="주임" ${s.position === '주임' ? 'selected' : ''}>주임</option>
            <option value="대리" ${s.position === '대리' ? 'selected' : ''}>대리</option>
            <option value="과장" ${s.position === '과장' ? 'selected' : ''}>과장</option>
            <option value="차장" ${s.position === '차장' ? 'selected' : ''}>차장</option>
            <option value="부장" ${s.position === '부장' ? 'selected' : ''}>부장</option>
            <option value="이사" ${s.position === '이사' ? 'selected' : ''}>이사</option>
          </select>
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#374151;">추가 정보</div>
          <input id="swal-hobby" class="swal2-input" value="${s.hobby || ''}" placeholder="취미" style="margin:5px auto;">
          <div style="display:flex; gap:8px; align-items:center; margin:5px 15px;">
            <input id="swal-birth" type="date" class="swal2-input" value="${s.birthDate || ''}" style="flex:1; margin:0;">
            <select id="swal-birthType" class="swal2-input" style="width:80px; margin:0;">
              <option value="solar" ${s.birthType !== 'lunar' ? 'selected' : ''}>양력</option>
              <option value="lunar" ${s.birthType === 'lunar' ? 'selected' : ''}>음력</option>
            </select>
          </div>
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#374151;">🔐 시스템 권한</div>
          <select id="swal-role" class="swal2-input" ${!canEditRole ? 'disabled' : ''} style="margin:5px auto;">
            <option value="staff" ${s.role === 'staff' ? 'selected' : ''}>직원</option>
            <option value="master2" ${s.role === 'master2' ? 'selected' : ''}>부팀장</option>
            <option value="master1" ${s.role === 'master1' ? 'selected' : ''}>팀장</option>
            <option value="master" ${s.role === 'master' ? 'selected' : ''}>관리자</option>
          </select>
          
          ${isTargetOriginal ? '<div style="margin-top:10px; color:#dc2626; font-size:12px;">👑 원조 관리자</div>' : ''}
          ${s.role === 'master' && !isTargetOriginal ? '<div style="margin-top:10px; color:#f59e0b; font-size:12px;">⭐ 2번째 관리자</div>' : ''}
        </div>
      `,
      width: '420px',
      showCancelButton: true,
      showDenyButton: !isTargetOriginal, // 원조는 삭제 불가
      confirmButtonText: '저장',
      denyButtonText: '삭제',
      denyButtonColor: '#ef4444',
      preConfirm: () => ({
        visibleId: document.getElementById('swal-id').value,
        pw: document.getElementById('swal-pw').value,
        name: document.getElementById('swal-name').value,
        phone: document.getElementById('swal-phone').value,
        address: document.getElementById('swal-address').value,
        email: document.getElementById('swal-email').value,
        department: document.getElementById('swal-dept').value,
        position: document.getElementById('swal-position').value,
        hobby: document.getElementById('swal-hobby').value,
        birthDate: document.getElementById('swal-birth').value,
        birthType: document.getElementById('swal-birthType').value,
        role: document.getElementById('swal-role').value
      })
    });

    if (isDenied) {
      // 관리자 삭제 시 비밀번호 확인
      if (s.role === 'master') {
        const { value: pw } = await Swal.fire({
          title: '🔐 비밀번호 확인',
          text: '관리자 삭제를 위해 본인 비밀번호를 입력하세요.',
          input: 'password',
          showCancelButton: true
        });
        if (!pw || pw !== currentUser.pw) {
          Swal.fire('실패', '비밀번호가 틀리거나 취소되었습니다.', 'error');
          return;
        }
      }

      const r = await Swal.fire({ title: '삭제?', text: s.name, showCancelButton: true, confirmButtonColor: '#ef4444' });
      if (r.isConfirmed) {
        await deleteDoc(doc(db, 'staff', s.id));
        fetchData();
        if (onStaffUpdate) onStaffUpdate();
      }
      return;
    }

    if (value) {
      // 역할을 master로 변경할 때 비밀번호 확인
      if (value.role === 'master' && s.role !== 'master') {
        const { value: pw } = await Swal.fire({
          title: '🔐 비밀번호 확인',
          text: '관리자 권한 부여를 위해 본인 비밀번호를 입력하세요.',
          input: 'password',
          showCancelButton: true
        });
        if (!pw || pw !== currentUser.pw) {
          Swal.fire('실패', '비밀번호가 틀리거나 취소되었습니다.', 'error');
          return;
        }
      }

      // 변경 사항 로그 기록
      const changes = [];
      if (s.role !== value.role) changes.push(`역할: ${s.role}→${value.role}`);
      if (s.name !== value.name) changes.push(`이름: ${s.name}→${value.name}`);
      
      await updateDoc(doc(db, 'staff', s.id), value);
      
      fetchData();
      if (onStaffUpdate) onStaffUpdate();
    }
  };

  // ── 사용약제 마스터 관리 ────────────────────────
  const UNIT_OPTIONS = ['ml', 'g', 'cc', 'L', 'kg', '봉', '개', '정'];

  const handleAddPesticide = async () => {
    const { value } = await Swal.fire({
      title: '🧪 약제 추가',
      html: `
        <div style="text-align:left;padding:0 8px;">
          <div style="margin-bottom:10px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">약제명 *</label>
            <input id="pest-name" class="swal2-input" placeholder="예: 사이클로나이트 50SC" style="margin:0;width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">단위 *</label>
            <select id="pest-unit" class="swal2-input" style="margin:0;width:100%;box-sizing:border-box;">
              ${UNIT_OPTIONS.map(u => `<option value="${u}">${u}</option>`).join('')}
            </select>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '추가',
      cancelButtonText: '취소',
      confirmButtonColor: '#10b981',
      preConfirm: () => {
        const name = document.getElementById('pest-name').value.trim();
        const unit = document.getElementById('pest-unit').value;
        if (!name) { Swal.showValidationMessage('약제명을 입력하세요'); return false; }
        return { name, unit };
      }
    });
    if (!value) return;
    try {
      const newOrder = pesticideTypes.length;
      const docRef = await addDoc(collection(db, 'pesticideTypes'), {
        name: value.name,
        unit: value.unit,
        order: newOrder,
        createdAt: new Date().toISOString()
      });
      setPesticideTypes(prev => [...prev, { id: docRef.id, name: value.name, unit: value.unit, order: newOrder }]);
    } catch (e) {
      Swal.fire('오류', '저장 실패', 'error');
    }
  };

  const handleEditPesticide = async (pest) => {
    const { value } = await Swal.fire({
      title: '🧪 약제 수정',
      html: `
        <div style="text-align:left;padding:0 8px;">
          <div style="margin-bottom:10px;">
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">약제명</label>
            <input id="pest-name" class="swal2-input" value="${pest.name}" style="margin:0;width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">단위</label>
            <select id="pest-unit" class="swal2-input" style="margin:0;width:100%;box-sizing:border-box;">
              ${UNIT_OPTIONS.map(u => `<option value="${u}" ${u === pest.unit ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '저장',
      denyButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      denyButtonColor: '#ef4444',
      preConfirm: () => {
        const name = document.getElementById('pest-name').value.trim();
        const unit = document.getElementById('pest-unit').value;
        if (!name) { Swal.showValidationMessage('약제명을 입력하세요'); return false; }
        return { name, unit };
      }
    });

    if (value) {
      // 수정
      try {
        await updateDoc(doc(db, 'pesticideTypes', pest.id), { name: value.name, unit: value.unit });
        setPesticideTypes(prev => prev.map(p => p.id === pest.id ? { ...p, name: value.name, unit: value.unit } : p));
      } catch (e) { Swal.fire('오류', '수정 실패', 'error'); }
    } else if (value === false) {
      // 삭제 버튼
      const confirm = await Swal.fire({
        title: '삭제 확인',
        text: `"${pest.name}" 약제를 삭제하시겠습니까?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#ef4444'
      });
      if (confirm.isConfirmed) {
        try {
          await deleteDoc(doc(db, 'pesticideTypes', pest.id));
          setPesticideTypes(prev => prev.filter(p => p.id !== pest.id));
        } catch (e) { Swal.fire('오류', '삭제 실패', 'error'); }
      }
    }
  };

  const handleSaveSettings = async () => {
    try {
      
      if (settingsDocId) {
        await updateDoc(doc(db, 'settings', settingsDocId), settings);
      } else {
        const docRef = await addDoc(collection(db, 'settings'), settings);
        setSettingsDocId(docRef.id);
      }
      await refreshCtxSettings(); // AppContext 갱신 → 전체 컴포넌트에 즉시 반영
      await Swal.fire({ icon: 'success', title: '완료', text: '설정이 저장되었습니다.', timer: 1500, showConfirmButton: false });
    } catch (error) {
      console.error('💾 저장 오류:', error);
      Swal.fire('오류', `저장 실패: ${error.message}`, 'error');
    }
  };

  const handleResetData = async () => {
    const { value: option } = await Swal.fire({
      title: '⚠️ 데이터 초기화',
      input: 'select',
      inputOptions: {
        'events': '일정만 삭제',
        'all': '전체 삭제 (고객+일정)'
      },
      showCancelButton: true,
      confirmButtonColor: '#ef4444'
    });

    if (option) {
      const r = await Swal.fire({ title: '정말 삭제?', showCancelButton: true, confirmButtonColor: '#ef4444' });
      if (r.isConfirmed) {
        const delCol = async (name) => {
          const snap = await getDocs(collection(db, name));
          for (const d of snap.docs) await deleteDoc(doc(db, name, d.id));
        };

        await delCol('events');
        await delCol('dailyClose');
        await delCol('monthClose');
        await delCol('attendance');

        if (option === 'all') await delCol('customers');

        Swal.fire('완료', '초기화됨', 'success');
      }
    }
  };

  // 데이터 백업
  const handleBackup = async (type) => {
    try {
      Swal.fire({
        title: '백업 준비 중...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      const today = new Date().toISOString().split('T')[0];
      
      if (type === 'customers' || type === 'all') {
        const custSnap = await getDocs(collection(db, 'customers'));
        const customers = custSnap.docs.map(doc => {
          const d = doc.data();
          return {
            '코드': d.code || '',
            '고객명': d.name || '',
            '연락처': d.phone || '',
            '주소': d.address || '',
            '이메일': d.email || '',
            '대표자명': d.representative || '',
            '사업자번호': d.businessNumber || '',
            '평수': d.size || '',
            '금액': d.price || 0,
            '담당자': d.staffName || '',
            '상태': d.custStatus || '정기',
            '계약시작': d.contractStart || '',
            '계약종료': d.contractEnd || '',
            '작업월': Object.keys(d.workMonths || {}).filter(m => d.workMonths[m]?.enabled).join(',') || '',
            '메모': d.memo || ''
          };
        });
        
        if (type === 'customers') {
          downloadExcel(customers, `고객데이터_${today}.xlsx`, '고객');
          Swal.fire('완료', `고객 ${customers.length}건 백업 완료`, 'success');
          return;
        }
      }
      
      if (type === 'staff' || type === 'all') {
        const staffSnap = await getDocs(collection(db, 'staff'));
        const staffData = staffSnap.docs.map(doc => {
          const d = doc.data();
          return {
            '아이디': d.visibleId || '',
            '이름': d.name || '',
            '연락처': d.phone || '',
            '이메일': d.email || '',
            '주소': d.address || '',
            '직급': d.position || '',
            '권한': d.role === 'master' ? '관리자' : d.role === 'master1' ? '팀장' : d.role === 'master2' ? '부팀장' : '직원',
            '생년월일': d.birthDate || '',
            '생일구분': d.birthType === 'lunar' ? '음력' : '양력'
          };
        });
        
        if (type === 'staff') {
          downloadExcel(staffData, `직원데이터_${today}.xlsx`, '직원');
          Swal.fire('완료', `직원 ${staffData.length}건 백업 완료`, 'success');
          return;
        }
      }
      
      if (type === 'events' || type === 'all') {
        const eventSnap = await getDocs(collection(db, 'events'));
        const events = eventSnap.docs.map(doc => {
          const d = doc.data();
          return {
            '날짜': d.date || '',
            '고객명': d.title || '',
            '담당자': d.staffName || '',
            '금액': d.price || 0,
            '상태': d.status || '',
            '작업유형': d.workType === 'special' ? '특별' : '일반',
            '완료일시': d.completedAt || '',
            '완료자': d.completedBy || ''
          };
        });
        
        if (type === 'events') {
          downloadExcel(events, `배정데이터_${today}.xlsx`, '배정');
          Swal.fire('완료', `배정 ${events.length}건 백업 완료`, 'success');
          return;
        }
      }
      
      // 전체 백업
      if (type === 'all') {
        const custSnap = await getDocs(collection(db, 'customers'));
        const customers = custSnap.docs.map(doc => {
          const d = doc.data();
          return {
            '코드': d.code || '',
            '고객명': d.name || '',
            '연락처': d.phone || '',
            '주소': d.address || '',
            '이메일': d.email || '',
            '금액': d.price || 0,
            '담당자': d.staffName || '',
            '상태': d.custStatus || '정기'
          };
        });
        
        const staffSnap = await getDocs(collection(db, 'staff'));
        const staffData = staffSnap.docs.map(doc => {
          const d = doc.data();
          return {
            '아이디': d.visibleId || '',
            '이름': d.name || '',
            '연락처': d.phone || '',
            '권한': d.role === 'master' ? '관리자' : '직원'
          };
        });
        
        const eventSnap = await getDocs(collection(db, 'events'));
        const events = eventSnap.docs.map(doc => {
          const d = doc.data();
          return {
            '날짜': d.date || '',
            '고객명': d.title || '',
            '담당자': d.staffName || '',
            '상태': d.status || ''
          };
        });
        
        downloadExcelMultiSheet({
          '고객': customers,
          '직원': staffData,
          '배정': events
        }, `전체백업_${today}.xlsx`);
        
        Swal.fire('완료', `전체 백업 완료\n- 고객: ${customers.length}건\n- 직원: ${staffData.length}건\n- 배정: ${events.length}건`, 'success');
      }
      
    } catch (error) {
      console.error('백업 오류:', error);
      Swal.fire('오류', '백업 실패: ' + error.message, 'error');
    }
  };

  // 엑셀 다운로드 (단일 시트)
  const downloadExcel = (data, filename, sheetName) => {
    import('xlsx').then(XLSX => {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, filename);
    });
  };

  // 엑셀 다운로드 (멀티 시트)
  const downloadExcelMultiSheet = (sheets, filename) => {
    import('xlsx').then(XLSX => {
      const wb = XLSX.utils.book_new();
      Object.keys(sheets).forEach(sheetName => {
        const ws = XLSX.utils.json_to_sheet(sheets[sheetName]);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });
      XLSX.writeFile(wb, filename);
    });
  };

  // 직원ID 일괄 변경 함수 (staffName 기준 자동 매칭)
  const handleMigrateStaffId = async () => {
    try {
      // 1단계: staff 목록에서 name → visibleId 매핑 가져오기
      const staffSnap = await getDocs(collection(db, 'staff'));
      const staffMap = {};  // { "이대일": "admin", "이창주": "changju" }
      staffSnap.docs.forEach(d => {
        const data = d.data();
        if (data.name && data.visibleId) {
          staffMap[data.name] = data.visibleId;
        }
      });

      if (Object.keys(staffMap).length === 0) {
        Swal.fire('알림', '등록된 직원이 없습니다.', 'info');
        return;
      }

      // 매핑 미리보기
      const staffMapHtml = Object.entries(staffMap)
        .map(([name, id]) => `• ${name} → ${id}`)
        .join('<br>');

      const startResult = await Swal.fire({
        title: '🔄 직원ID 통합 정리',
        html: `
          <div style="text-align:left; font-size:13px;">
            <p>모든 데이터에서 <b>staffName</b> 기준으로<br><b>staffId</b>를 자동으로 채웁니다.</p>
            <div style="background:#f0fdf4; padding:12px; border-radius:8px; margin:15px 0;">
              <div style="font-weight:bold; margin-bottom:8px; color:#16a34a;">📋 직원 매핑</div>
              <div style="font-size:12px;">${staffMapHtml}</div>
            </div>
            <p style="font-size:11px; color:#666;">
              ✅ staffId가 비어있거나 잘못된 경우 모두 수정됩니다.<br>
              ✅ customers, events 등 모든 데이터 정리
            </p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '다음 (미리보기)',
        cancelButtonText: '취소'
      });

      if (!startResult.isConfirmed) return;

      // 2단계: 각 컬렉션에서 변경될 문서 수 확인
      Swal.fire({
        title: '검색 중...',
        html: '변경될 데이터를 확인하고 있습니다.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      const collections = ['customers', 'events', 'dailyClose', 'monthClose', 'attendance', 'folders', 'extraWork'];
      const counts = {};
      const details = {};  // 상세 정보
      let totalCount = 0;

      for (const collName of collections) {
        try {
          const snap = await getDocs(collection(db, collName));
          let collCount = 0;
          const collDetails = [];

          for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const staffName = data.staffName;
            const currentStaffId = data.staffId || '';
            const correctStaffId = staffMap[staffName];

            // staffName이 있고, 올바른 ID를 알고 있고, 현재 ID가 다르면 변경 대상
            if (staffName && correctStaffId && currentStaffId !== correctStaffId) {
              collCount++;
              if (collDetails.length < 3) {
                collDetails.push(`${data.title || data.name || staffName}: "${currentStaffId || '(없음)'}" → "${correctStaffId}"`);
              }
            }
          }

          counts[collName] = collCount;
          details[collName] = collDetails;
          totalCount += collCount;
        } catch (e) {
          counts[collName] = 0;
          details[collName] = [];
        }
      }

      if (totalCount === 0) {
        Swal.fire('✅ 완료', '정리할 데이터가 없습니다.\n모든 staffId가 정상입니다.', 'success');
        return;
      }

      // 3단계: 미리보기 표시
      let previewHtml = '';
      for (const [collName, count] of Object.entries(counts)) {
        if (count > 0) {
          previewHtml += `<div style="margin-bottom:10px;">`;
          previewHtml += `<b>📁 ${collName}: ${count}건</b>`;
          if (details[collName].length > 0) {
            previewHtml += `<div style="font-size:11px; color:#666; margin-left:15px;">`;
            previewHtml += details[collName].join('<br>');
            if (count > 3) previewHtml += `<br>... 외 ${count - 3}건`;
            previewHtml += `</div>`;
          }
          previewHtml += `</div>`;
        }
      }

      const confirmResult = await Swal.fire({
        title: '📋 변경 미리보기',
        html: `
          <div style="text-align:left; font-size:13px;">
            <div style="background:#fef3c7; padding:10px; border-radius:8px; margin-bottom:15px;">
              <b>총 ${totalCount}건</b> 변경 예정
            </div>
            <div style="max-height:250px; overflow-y:auto;">
              ${previewHtml}
            </div>
            <p style="color:#ef4444; font-size:12px; margin-top:15px;">⚠️ 이 작업은 되돌릴 수 없습니다!</p>
          </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '정리 실행',
        cancelButtonText: '취소',
        confirmButtonColor: '#8b5cf6'
      });

      if (!confirmResult.isConfirmed) return;

      // 4단계: 실제 변경 실행
      Swal.fire({
        title: '정리 중...',
        html: '잠시만 기다려주세요.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      let successCount = 0;
      let errorCount = 0;

      for (const collName of collections) {
        try {
          const snap = await getDocs(collection(db, collName));
          for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const staffName = data.staffName;
            const currentStaffId = data.staffId || '';
            const correctStaffId = staffMap[staffName];

            if (staffName && correctStaffId && currentStaffId !== correctStaffId) {
              await updateDoc(doc(db, collName, docSnap.id), {
                staffId: correctStaffId,
                staffVisibleId: correctStaffId
              });
              successCount++;
            }
          }
        } catch (e) {
          console.error(`${collName} 오류:`, e);
          errorCount++;
        }
      }

      Swal.fire({
        title: '✅ 정리 완료',
        html: `
          <div style="text-align:center;">
            <p style="font-size:20px; margin-bottom:10px;">🎉</p>
            <p><b>${successCount}건</b> 정리 완료</p>
            ${errorCount > 0 ? `<p style="color:#ef4444;">오류: ${errorCount}건</p>` : ''}
            <p style="color:#666; font-size:12px; margin-top:15px;">페이지를 새로고침하세요.</p>
          </div>
        `,
        icon: 'success'
      });

    } catch (error) {
      console.error('ID 정리 오류:', error);
      Swal.fire('오류', '정리 중 오류가 발생했습니다.', 'error');
    }
  };

  // 중복 이벤트 정리 함수
  const handleCleanDuplicateEvents = async () => {
    try {
      Swal.fire({
        title: '검색 중...',
        html: '중복 이벤트를 찾고 있습니다.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      // events 컬렉션에서 모든 이벤트 가져오기
      const eventsSnap = await getDocs(collection(db, 'events'));
      const allEvents = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 날짜 + 고객명 + staffId 기준으로 그룹화
      const grouped = {};
      allEvents.forEach(e => {
        const key = `${e.date}_${e.title}_${e.staffId || ''}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(e);
      });

      // 중복 찾기 (2개 이상인 그룹)
      const duplicates = [];
      const toDelete = [];

      Object.entries(grouped).forEach(([key, events]) => {
        if (events.length > 1) {
          // 완료/야근 상태 우선 유지
          const completed = events.filter(e => ['완료', '야근', '마감완료'].includes(e.status));
          const pending = events.filter(e => !['완료', '야근', '마감완료'].includes(e.status));

          if (completed.length > 0) {
            // 완료된 게 있으면 배정 상태 삭제
            toDelete.push(...pending);
            duplicates.push({
              key,
              keep: completed[0],
              delete: pending,
              reason: '완료 유지, 배정 삭제'
            });
          } else {
            // 모두 배정 상태면 첫 번째만 유지
            const [keep, ...rest] = events;
            toDelete.push(...rest);
            duplicates.push({
              key,
              keep,
              delete: rest,
              reason: '첫 번째 유지, 나머지 삭제'
            });
          }
        }
      });

      if (toDelete.length === 0) {
        Swal.fire('✅ 완료', '중복 이벤트가 없습니다.', 'success');
        return;
      }

      // 미리보기
      let previewHtml = '';
      duplicates.slice(0, 10).forEach(d => {
        const [date, title] = d.key.split('_');
        previewHtml += `
          <div style="margin-bottom:12px; padding:10px; background:#f8fafc; border-radius:8px; text-align:left;">
            <div style="font-weight:bold; font-size:13px;">${title}</div>
            <div style="font-size:11px; color:#666;">${date}</div>
            <div style="font-size:11px; color:#16a34a;">✅ 유지: ${d.keep.status}</div>
            <div style="font-size:11px; color:#dc2626;">🗑️ 삭제: ${d.delete.length}건 (${d.delete.map(e => e.status).join(', ')})</div>
          </div>
        `;
      });

      if (duplicates.length > 10) {
        previewHtml += `<div style="color:#666; font-size:12px;">... 외 ${duplicates.length - 10}건</div>`;
      }

      const confirmResult = await Swal.fire({
        title: '🧹 중복 이벤트 정리',
        html: `
          <div style="text-align:left; font-size:13px;">
            <div style="background:#fef3c7; padding:10px; border-radius:8px; margin-bottom:15px;">
              <b>총 ${toDelete.length}건</b> 삭제 예정 (${duplicates.length}개 그룹)
            </div>
            <div style="max-height:300px; overflow-y:auto;">
              ${previewHtml}
            </div>
            <p style="color:#ef4444; font-size:12px; margin-top:15px;">⚠️ 이 작업은 되돌릴 수 없습니다!</p>
          </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '삭제 실행',
        cancelButtonText: '취소',
        confirmButtonColor: '#ef4444'
      });

      if (!confirmResult.isConfirmed) return;

      // 삭제 실행
      Swal.fire({
        title: '삭제 중...',
        html: '잠시만 기다려주세요.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });

      let successCount = 0;
      for (const event of toDelete) {
        try {
          await deleteDoc(doc(db, 'events', event.id));
          successCount++;
        } catch (e) {
          console.error('삭제 오류:', e);
        }
      }

      Swal.fire({
        title: '✅ 정리 완료',
        html: `
          <div style="text-align:center;">
            <p style="font-size:20px; margin-bottom:10px;">🧹</p>
            <p><b>${successCount}건</b> 삭제 완료</p>
            <p style="color:#666; font-size:12px; margin-top:15px;">페이지를 새로고침하세요.</p>
          </div>
        `,
        icon: 'success'
      });

    } catch (error) {
      console.error('중복 정리 오류:', error);
      Swal.fire('오류', '정리 중 오류가 발생했습니다.', 'error');
    }
  };

  // 고객 코드 정리 함수
  const handleNormalizeCode = async () => {
    try {
      const snap = await getDocs(collection(db, 'customers'));
      const customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // 정상 코드 판별: 순수 숫자 4자리 (0001~9999)
      const isNormalCode = (code) => {
        if (!code) return false;
        return /^\d{4}$/.test(code);
      };
      
      // 기존 정상 코드들 수집
      const normalCodes = customers
        .filter(c => isNormalCode(c.code))
        .map(c => parseInt(c.code));
      
      // 비정상 코드 고객들
      const abnormalCustomers = customers.filter(c => !isNormalCode(c.code));
      
      if (abnormalCustomers.length === 0) {
        Swal.fire('완료', '정리할 코드가 없습니다.\n모든 코드가 정상입니다.', 'info');
        return;
      }
      
      // 미리보기 표시
      const previewList = abnormalCustomers.slice(0, 10).map(c => 
        `• ${c.name} (${c.code || '없음'})`
      ).join('\n');
      
      const result = await Swal.fire({
        title: '🔧 코드 정리',
        html: `
          <div style="text-align:left; font-size:13px;">
            <p><b>정리 대상: ${abnormalCustomers.length}건</b></p>
            <div style="background:#f8fafc; padding:10px; border-radius:8px; max-height:200px; overflow-y:auto; font-size:12px; white-space:pre-line;">${previewList}${abnormalCustomers.length > 10 ? `\n... 외 ${abnormalCustomers.length - 10}건` : ''}</div>
            <p style="margin-top:10px; color:#666; font-size:11px;">
              ※ 순수 숫자 4자리 형식(0001~9999)으로 변환됩니다.<br>
              ※ 기존 정상 코드는 유지됩니다.
            </p>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '정리 실행',
        cancelButtonText: '취소',
        confirmButtonColor: '#3b82f6'
      });
      
      if (!result.isConfirmed) return;
      
      // 다음 코드 번호 계산
      let nextNum = normalCodes.length > 0 ? Math.max(...normalCodes) + 1 : 1;
      
      // 진행 표시
      Swal.fire({
        title: '코드 정리 중...',
        html: '잠시만 기다려주세요.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
      });
      
      // 비정상 코드 업데이트
      let updatedCount = 0;
      for (const customer of abnormalCustomers) {
        const newCode = String(nextNum).padStart(4, '0');
        await updateDoc(doc(db, 'customers', customer.id), { 
          code: newCode,
          previousCode: customer.code // 이전 코드 기록
        });
        nextNum++;
        updatedCount++;
      }
      
      Swal.fire({
        title: '✅ 완료',
        html: `<b>${updatedCount}건</b>의 코드가 정리되었습니다.`,
        icon: 'success'
      });
      
    } catch (error) {
      console.error('Code normalize error:', error);
      Swal.fire('오류', '코드 정리 실패: ' + error.message, 'error');
    }
  };

  if (loading) return <div style={styles.loading}>로딩중...</div>;

  return (
    <div>
      {/* 직원실적관리 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>👤 직원실적관리</h3>
          <button onClick={handleAddStaff} style={styles.addBtn}>+ 등록</button>
        </div>
        <div style={styles.staffList}>
          {staff.map(s => {
            const getRoleBadge = (role) => {
              switch(role) {
                case 'master': return { color: '#dc2626', text: '관리자' };
                case 'master1': return { color: '#7c3aed', text: '팀장' };
                case 'master2': return { color: '#0891b2', text: '부팀장' };
                default: return { color: '#3b82f6', text: '직원' };
              }
            };
            const badge = getRoleBadge(s.role);
            const originalMaster = getOriginalMaster();
            const isThisOriginal = originalMaster && (
              originalMaster.id === s.id || 
              originalMaster.visibleId?.split('@')[0] === s.visibleId?.split('@')[0]
            );
            return (
              <div key={s.id} style={styles.staffCard} onClick={() => handleEditStaff(s)}>
                <div style={styles.staffName}>
                  {s.name}
                  {s.position && <span style={{fontSize:'11px', color:'#6b7280', marginLeft:'4px'}}>({s.position})</span>}
                  <span style={{...styles.roleBadge, backgroundColor: badge.color}}>
                    {badge.text}
                  </span>
                  {isThisOriginal && <span style={{fontSize:'12px'}}>👑</span>}
                  {s.role === 'master' && !isThisOriginal && <span style={{fontSize:'12px'}}>⭐</span>}
                </div>
                <div style={styles.staffInfo}>
                  {s.department && <span style={{marginRight:'10px'}}>🏢 {s.department}</span>}
                  📱 {s.phone || '-'}
                  {s.birthDate && <span style={{marginLeft:'10px'}}>🎂 {s.birthDate} ({s.birthType === 'lunar' ? '음' : '양'})</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 내 정보 - 담당자 전화번호 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>👤 내 정보</h3>
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>📞 담당자 전화번호</label>
          <p style={styles.settingDesc}>
            견적서 PDF의 담당자 서명란에 표시되는 본인 연락처입니다.
          </p>
          <MyPhoneEditor currentUser={currentUser} />
        </div>
      </div>

      {/* 시스템 설정 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>⚙️ 시스템 설정</h3>
        
        {/* 업체명 설정 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🏢 업체명</label>
          <p style={styles.settingDesc}>앱 상단에 표시될 업체 이름입니다.</p>
          <input 
            type="text"
            value={settings.companyName || '화이트라인'}
            onChange={(e) => setSettings({...settings, companyName: e.target.value})}
            placeholder="업체명 입력"
            style={{
              padding: '10px 15px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              fontSize: '14px',
              width: '200px'
            }}
          />
        </div>

        {/* 앱 시작 탭 설정 */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontWeight: 'bold', marginBottom: 8, display: 'block' }}>앱 시작 탭</label>
          <select
            value={settings.startTab || 'calendar'}
            onChange={(e) => setSettings({...settings, startTab: e.target.value})}
            style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 14, width: 200 }}
          >
            <option value="calendar">📅 배정플랜</option>
            <option value="scheduler">🗓️ 스케쥴러</option>
            <option value="customers">👥 고객관리</option>
            <option value="staff">📊 직원관리</option>
            <option value="sales">💼 영업</option>
          </select>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>앱을 열었을 때 처음 표시되는 탭을 선택합니다.</p>
        </div>

        {/* 로고 이미지 설정 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🖼️ 로고 이미지</label>
          <p style={styles.settingDesc}>앱 상단에 표시될 로고 이미지입니다. (권장: 100x100px)</p>
          <div style={{display:'flex', gap:'15px', alignItems:'center', flexWrap:'wrap'}}>
            {/* 현재 로고 미리보기 */}
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '8px',
              border: '2px solid #ddd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f8fafc',
              overflow: 'hidden'
            }}>
              {settings.companyLogo ? (
                <img 
                  src={settings.companyLogo} 
                  alt="로고" 
                  style={{width:'100%', height:'100%', objectFit:'cover'}}
                />
              ) : (
                <span style={{fontSize:'30px'}}>📋</span>
              )}
            </div>
            
            {/* 이미지 업로드 버튼 */}
            <label style={{
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              📁 이미지 선택
              <input 
                type="file" 
                accept="image/*"
                style={{display:'none'}}
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    if (file.size > 500000) {
                      Swal.fire('오류', '이미지 크기는 500KB 이하로 해주세요', 'error');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setSettings({...settings, companyLogo: reader.result});
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
            
            {/* 로고 삭제 버튼 */}
            {settings.companyLogo && (
              <button
                onClick={() => setSettings({...settings, companyLogo: ''})}
                style={{
                  padding: '10px 15px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                🗑️ 삭제
              </button>
            )}
          </div>
          <p style={{fontSize:'11px', color:'#999', marginTop:'8px'}}>
            ※ 500KB 이하 이미지만 가능합니다
          </p>
        </div>

        {/* 미리보기 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>👁️ 미리보기</label>
          <div style={{
            backgroundColor: '#2563eb',
            color: 'white',
            padding: '15px 20px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            {settings.companyLogo ? (
              <img 
                src={settings.companyLogo} 
                alt="로고" 
                style={{width:'30px', height:'30px', borderRadius:'4px', objectFit:'cover'}}
              />
            ) : (
              <span style={{fontSize:'24px'}}>📋</span>
            )}
            <span style={{fontSize:'18px', fontWeight:'bold'}}>{settings.companyName || '화이트라인'}</span>
          </div>
        </div>

        {/* 대표자명 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>👤 대표자명</label>
          <p style={styles.settingDesc}>견적서 서명란에 표시됩니다.</p>
          <input
            type="text"
            value={settings.representative || ''}
            onChange={(e) => setSettings({...settings, representative: e.target.value})}
            placeholder="대표자 성함"
            style={{padding:'10px 15px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px', width:'200px'}}
          />
        </div>

        {/* 직인 이미지 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🔏 직인 이미지</label>
          <p style={styles.settingDesc}>견적서 서명란에 표시되는 직인 도장 이미지입니다. (권장: 100x100px, 투명 배경 PNG)</p>
          <div style={{display:'flex', gap:'15px', alignItems:'center', flexWrap:'wrap'}}>
            <div style={{width:'70px', height:'70px', borderRadius:'50%', border:'2px dashed #ddd', display:'flex', alignItems:'center', justifyContent:'center', backgroundColor:'#f8fafc', overflow:'hidden'}}>
              {settings.sealImage ? (
                <img src={settings.sealImage} alt="직인" style={{width:'100%', height:'100%', objectFit:'contain'}} />
              ) : (
                <span style={{fontSize:'28px'}}>🔏</span>
              )}
            </div>
            <label style={{padding:'10px 20px', backgroundColor:'#7c3aed', color:'white', borderRadius:'8px', cursor:'pointer', fontSize:'14px'}}>
              📁 직인 이미지 선택
              <input type="file" accept="image/*" style={{display:'none'}} onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  if (file.size > 500000) { Swal.fire('오류', '이미지 크기는 500KB 이하로 해주세요', 'error'); return; }
                  const reader = new FileReader();
                  reader.onloadend = () => setSettings({...settings, sealImage: reader.result});
                  reader.readAsDataURL(file);
                }
              }} />
            </label>
            {settings.sealImage && (
              <button onClick={() => setSettings({...settings, sealImage: ''})}
                style={{padding:'10px 15px', backgroundColor:'#ef4444', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'14px'}}>
                🗑️ 삭제
              </button>
            )}
          </div>
          <p style={{fontSize:'11px', color:'#999', marginTop:'8px'}}>※ 투명 배경 PNG 권장, 500KB 이하</p>
        </div>

        {/* 소독증명서 로고 (가로형) */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🧾 소독증명서 로고 (가로형)</label>
          <p style={styles.settingDesc}>소독증명서 하단과 워터마크에 사용되는 가로형 로고입니다. (권장: 가로 300px 이상, 투명 배경 PNG)</p>
          <div style={{display:'flex', gap:'15px', alignItems:'center', flexWrap:'wrap'}}>
            <div style={{width:'180px', height:'60px', borderRadius:'8px', border:'2px dashed #ddd', display:'flex', alignItems:'center', justifyContent:'center', backgroundColor:'#f8fafc', overflow:'hidden'}}>
              {settings.certLogo ? (
                <img src={settings.certLogo} alt="소독증명서 로고" style={{width:'100%', height:'100%', objectFit:'contain'}} />
              ) : (
                <span style={{fontSize:'12px', color:'#aaa'}}>가로형 로고</span>
              )}
            </div>
            <label style={{padding:'10px 20px', backgroundColor:'#059669', color:'white', borderRadius:'8px', cursor:'pointer', fontSize:'14px'}}>
              📁 로고 선택
              <input type="file" accept="image/*" style={{display:'none'}} onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  if (file.size > 1000000) { Swal.fire('오류', '이미지 크기는 1MB 이하로 해주세요', 'error'); return; }
                  const reader = new FileReader();
                  reader.onloadend = () => setSettings({...settings, certLogo: reader.result});
                  reader.readAsDataURL(file);
                }
              }} />
            </label>
            {settings.certLogo && (
              <button onClick={() => setSettings({...settings, certLogo: ''})}
                style={{padding:'10px 15px', backgroundColor:'#ef4444', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'14px'}}>
                🗑️ 삭제
              </button>
            )}
          </div>
          <p style={{fontSize:'11px', color:'#999', marginTop:'8px'}}>※ 투명 배경 PNG 권장, 1MB 이하. 증명서 하단 중앙 + 워터마크로 자동 적용됩니다.</p>
        </div>

        {/* 회사 연락처 (견적서용) */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>📞 회사 연락처</label>
          <p style={styles.settingDesc}>견적서에 표시될 회사 전화번호입니다.</p>
          <input
            type="text"
            value={settings.companyPhone || ''}
            onChange={(e) => setSettings({...settings, companyPhone: e.target.value})}
            placeholder="예: 02-000-0000"
            style={{padding:'10px 15px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px', width:'200px'}}
          />
        </div>

        {/* 회사 주소 (견적서용) */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>📍 회사 주소</label>
          <p style={styles.settingDesc}>견적서에 표시될 회사 주소입니다.</p>
          <input
            type="text"
            value={settings.companyAddress || ''}
            onChange={(e) => setSettings({...settings, companyAddress: e.target.value})}
            placeholder="회사 주소 입력"
            style={{padding:'10px 15px', borderRadius:'8px', border:'1px solid #ddd', fontSize:'14px', width:'100%', boxSizing:'border-box'}}
          />
        </div>

        {/* ── 작업 완료 설정 ── */}
        <div style={{...styles.settingItem, background:'#f0fdf4', borderRadius:12, padding:16, border:'1px solid #86efac'}}>
          <label style={{...styles.settingLabel, color:'#065f46'}}>✅ 작업 완료 설정</label>
          <p style={styles.settingDesc}>배정플랜에서 작업 완료 처리 시 동작 방식을 설정합니다.</p>

          {/* 소독증명서 팝업 토글 */}
          <div style={{background:'white', borderRadius:10, padding:'12px 14px', border:`1px solid ${(settings.showCertPopup ?? true) ? '#86efac' : '#e2e8f0'}`}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <div style={{fontWeight:'bold', fontSize:14}}>🧾 소독증명서 팝업 표시</div>
                <div style={{fontSize:12, color:'#6b7280', marginTop:3}}>
                  {(settings.showCertPopup ?? true)
                    ? 'ON: 완료 처리 후 "소독증명서 필요하신가요?" 팝업 표시'
                    : 'OFF: 팝업 없이 완료 처리만 (certTarget 고객은 항상 표시)'}
                </div>
              </div>
              {/* 토글 스위치 */}
              <div
                onClick={() => setSettings({...settings, showCertPopup: !(settings.showCertPopup ?? true)})}
                style={{
                  width:50, height:26, borderRadius:13, cursor:'pointer',
                  background: (settings.showCertPopup ?? true) ? '#10b981' : '#d1d5db',
                  position:'relative', flexShrink:0, transition:'background 0.2s',
                }}
              >
                <div style={{
                  position:'absolute', top:3,
                  left: (settings.showCertPopup ?? true) ? 26 : 3,
                  width:20, height:20, borderRadius:'50%', background:'white',
                  transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
            </div>
            {/* 상태 설명 */}
            <div style={{
              marginTop:10, padding:'8px 12px', borderRadius:8, fontSize:12,
              background: (settings.showCertPopup ?? true) ? '#f0fdf4' : '#fef9c3',
              color: (settings.showCertPopup ?? true) ? '#065f46' : '#92400e',
            }}>
              {(settings.showCertPopup ?? true)
                ? '✅ 완료 처리 후 소독증명서 발급 여부를 물어봅니다'
                : '⚡ 완료 처리만 하고 팝업 없이 넘어갑니다\n   (🧾 certTarget ON 고객은 설정에 관계없이 항상 발급 팝업이 표시됩니다)'}
            </div>
          </div>
        </div>

        {/* ── 견적서 PDF 여백 콘텐츠 설정 ── */}
        <div style={{...styles.settingItem, background:'#f0f9ff', borderRadius:12, padding:16, border:'1px solid #bae6fd'}}>
          <label style={{...styles.settingLabel, color:'#0369a1'}}>📄 견적서 PDF 여백 콘텐츠</label>
          <p style={styles.settingDesc}>전체페이지 출력 시 1페이지 하단 여백에 표시할 내용을 설정합니다. 토글로 ON/OFF 선택 가능합니다.</p>

          {/* 서비스 보증 */}
          {[
            { key:'guarantee', icon:'🛡️', label:'서비스 보증', placeholder:'재방문 1회 무상 보장\n작업 후 72시간 이내 재발생 시 무상 AS\n정기계약 고객 우선 출동 서비스' },
            { key:'intro',     icon:'🏆', label:'회사 소개',   placeholder:'설립연도, 주요 실적, 보유 자격증 등을 입력하세요.' },
            { key:'caution',   icon:'⚠️', label:'주의사항/협조사항', placeholder:'작업 당일 30분 전 환기 부탁드립니다\n식품·식기류는 덮어두시거나 치워주세요\n반려동물은 작업 중 다른 공간에 격리 부탁드립니다' },
            { key:'contact',   icon:'📞', label:'담당자 연락처', placeholder:'ON 시 담당자 이름/전화/이메일이 자동으로 표시됩니다.' },
          ].map(({ key, icon, label, placeholder }) => {
            const item = settings.quotePdfMargin?.[key] || { on: false, text: '' };
            const isContact = key === 'contact';
            return (
              <div key={key} style={{marginTop:14, background:'white', borderRadius:10, padding:'12px 14px', border:`1px solid ${item.on ? '#60a5fa' : '#e2e8f0'}`}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: item.on && !isContact ? 10 : 0}}>
                  <span style={{fontWeight:'bold', fontSize:14}}>{icon} {label}</span>
                  {/* 토글 스위치 */}
                  <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none'}}>
                    <div
                      onClick={() => {
                        const cur = settings.quotePdfMargin || {};
                        const prev = cur[key] || { on: false, text: '' };
                        setSettings({
                          ...settings,
                          quotePdfMargin: { ...cur, [key]: { ...prev, on: !prev.on } }
                        });
                      }}
                      style={{
                        width:44, height:24, borderRadius:12, cursor:'pointer', transition:'all 0.2s',
                        background: item.on ? '#3b82f6' : '#d1d5db',
                        position:'relative', flexShrink:0,
                      }}
                    >
                      <div style={{
                        position:'absolute', top:2, left: item.on ? 22 : 2,
                        width:20, height:20, borderRadius:'50%', background:'white',
                        transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </div>
                    <span style={{fontSize:13, color: item.on ? '#2563eb' : '#9ca3af', fontWeight:'bold'}}>
                      {item.on ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>
                {item.on && !isContact && (
                  <textarea
                    value={item.text || ''}
                    onChange={e => {
                      const cur = settings.quotePdfMargin || {};
                      const prev = cur[key] || { on: true, text: '' };
                      setSettings({ ...settings, quotePdfMargin: { ...cur, [key]: { ...prev, text: e.target.value } } });
                    }}
                    placeholder={placeholder}
                    rows={4}
                    style={{
                      width:'100%', padding:'10px', borderRadius:8, border:'1px solid #ddd',
                      fontSize:13, resize:'vertical', boxSizing:'border-box', marginTop:4,
                      fontFamily:'inherit', lineHeight:1.6,
                    }}
                  />
                )}
                {item.on && isContact && (
                  <div style={{fontSize:12, color:'#64748b', marginTop:6, padding:'8px 10px', background:'#f0f9ff', borderRadius:6}}>
                    💡 담당자 정보(이름·전화·이메일)와 회사 전화번호가 자동으로 표시됩니다.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Anthropic API 키 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🔑 Anthropic API 키</label>
          <p style={styles.settingDesc}>AI 기능(사진/텍스트 자동배정, 번호판 인식)에 사용됩니다.</p>
          <div style={{display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap'}}>
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.anthropicApiKey || ''}
              onChange={(e) => setSettings({...settings, anthropicApiKey: e.target.value})}
              placeholder="sk-ant-..."
              style={{
                padding: '10px 15px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '14px',
                width: '320px',
                fontFamily: 'monospace'
              }}
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              style={{padding:'10px 14px', borderRadius:'8px', border:'1px solid #ddd', background:'#f8fafc', cursor:'pointer', fontSize:'14px'}}
            >
              {showApiKey ? '🙈 숨기기' : '👁️ 보기'}
            </button>
          </div>
          {settings.anthropicApiKey && (
            <p style={{fontSize:'12px', color:'#10b981', marginTop:'6px'}}>✅ API 키 등록됨</p>
          )}
        </div>

        {/* AI 사진/텍스트 자동배정 ON/OFF */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>📷 AI 사진/텍스트 자동배정</label>
          <p style={styles.settingDesc}>배정플랜에서 사진이나 텍스트로 AI 자동배정 버튼을 표시합니다.</p>
          <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
            <button
              onClick={() => setSettings({...settings, aiAssignEnabled: !settings.aiAssignEnabled})}
              style={{
                padding: '8px 20px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: settings.aiAssignEnabled !== false ? '#0ea5e9' : '#d1d5db',
                color: settings.aiAssignEnabled !== false ? 'white' : '#6b7280',
                fontWeight: 'bold'
              }}
            >
              {settings.aiAssignEnabled !== false ? '✅ 사용중' : '❌ 사용안함'}
            </button>
            <span style={{fontSize:'12px', color:'#666'}}>
              {settings.aiAssignEnabled !== false ? '배정플랜에 AI 자동배정 버튼 표시됨' : '버튼이 숨겨집니다'}
            </span>
          </div>
        </div>

        {/* 고객앱 평가 탭 ON/OFF */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>⭐ 고객앱 평가 탭</label>
          <p style={styles.settingDesc}>고객 앱 하단 탭에 서비스 평가(별점) 탭을 표시합니다.</p>
          <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
            <button
              onClick={() => setSettings({...settings, reviewTabEnabled: settings.reviewTabEnabled === false ? true : false})}
              style={{
                padding: '8px 20px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: settings.reviewTabEnabled !== false ? '#f59e0b' : '#d1d5db',
                color: settings.reviewTabEnabled !== false ? 'white' : '#6b7280',
                fontWeight: 'bold'
              }}
            >
              {settings.reviewTabEnabled !== false ? '✅ 표시중' : '❌ 숨김'}
            </button>
            <span style={{fontSize:'12px', color:'#666'}}>
              {settings.reviewTabEnabled !== false ? '고객앱에 평가 탭이 표시됩니다' : '평가 탭이 숨겨집니다'}
            </span>
          </div>
        </div>

        {/* 야근인정제도 ON/OFF */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🌙 야근인정제도</label>
          <p style={styles.settingDesc}>야근 인정 기준시간 체크 여부를 설정합니다.</p>
          <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
            <button 
              onClick={() => setSettings({...settings, overtimeEnabled: !settings.overtimeEnabled})}
              style={{
                padding: '8px 20px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: settings.overtimeEnabled !== false ? '#7c3aed' : '#d1d5db',
                color: settings.overtimeEnabled !== false ? 'white' : '#6b7280',
                fontWeight: 'bold'
              }}
            >
              {settings.overtimeEnabled !== false ? '✅ 사용중' : '❌ 사용안함'}
            </button>
            <span style={{fontSize:'12px', color:'#666'}}>
              {settings.overtimeEnabled !== false ? '출근 시간 기준으로 야근 인정 여부 결정' : '모든 야근 자동 인정'}
            </span>
          </div>
        </div>

        {/* 야근 기준시간 (30분 단위) */}
        {settings.overtimeEnabled !== false && (
          <div style={styles.settingItem}>
            <label style={styles.settingLabel}>⏰ 야근 인정 기준시간</label>
            <p style={styles.settingDesc}>이 시간 전에 출근해야 야근이 인정됩니다.</p>
            <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
              <select 
                value={settings.overtimeHour ?? 10} 
                onChange={(e) => setSettings({...settings, overtimeHour: parseInt(e.target.value)})}
                style={styles.settingSelect}
              >
                {[6, 7, 8, 9, 10, 11, 12].map(h => (
                  <option key={h} value={h}>오전 {h}시</option>
                ))}
              </select>
              <select 
                value={settings.overtimeMinute ?? 0} 
                onChange={(e) => setSettings({...settings, overtimeMinute: parseInt(e.target.value)})}
                style={styles.settingSelect}
              >
                <option value={0}>00분</option>
                <option value={30}>30분</option>
              </select>
            </div>
          </div>
        )}

        {/* 금액 증감 단위 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>💰 금액 증감 단위</label>
          <p style={styles.settingDesc}>금액 입력 시 화살표 클릭당 증감되는 금액입니다.</p>
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            {[1000, 5000, 10000].map(step => (
              <label key={step} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '8px 15px',
                background: settings.priceStep === step ? '#3b82f6' : '#f1f5f9',
                color: settings.priceStep === step ? 'white' : '#374151',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: settings.priceStep === step ? 'bold' : 'normal'
              }}>
                <input 
                  type="radio" 
                  name="priceStep" 
                  value={step}
                  checked={settings.priceStep === step}
                  onChange={() => setSettings({...settings, priceStep: step})}
                  style={{display: 'none'}}
                />
                {step.toLocaleString()}원
              </label>
            ))}
          </div>
        </div>

        <button onClick={handleSaveSettings} style={styles.saveBtn}>💾 설정 저장</button>
      </div>

      {/* 사용약제 관리 */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>🧪 사용약제 관리</h3>
          <button onClick={handleAddPesticide} style={styles.addBtn}>+ 추가</button>
        </div>
        <p style={styles.settingDesc}>
          배정플랜에서 작업 완료 처리 시 사용하는 약제 목록입니다. 약제명과 단위를 등록하세요.
        </p>
        {pesticideTypes.length === 0 ? (
          <div style={{
            textAlign:'center', padding:'20px', color:'#9ca3af',
            background:'#f9fafb', borderRadius:'8px', fontSize:'13px'
          }}>
            등록된 약제가 없습니다.<br />
            <span style={{fontSize:'11px'}}>+ 추가 버튼으로 약제를 등록하세요.</span>
          </div>
        ) : (
          <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
            {pesticideTypes.map((pest, idx) => (
              <div key={pest.id} style={{
                display:'flex', alignItems:'center', gap:'10px',
                padding:'10px 12px', background:'#f8fafc',
                borderRadius:'8px', cursor:'pointer'
              }} onClick={() => handleEditPesticide(pest)}>
                <span style={{
                  width:'22px', height:'22px', display:'flex', alignItems:'center',
                  justifyContent:'center', background:'#e0f2fe', borderRadius:'50%',
                  fontSize:'11px', fontWeight:'bold', color:'#0369a1', flexShrink:0
                }}>{idx + 1}</span>
                <span style={{flex:1, fontSize:'13px', fontWeight:'bold'}}>{pest.name}</span>
                <span style={{
                  fontSize:'11px', color:'#6366f1', background:'#ede9fe',
                  padding:'2px 8px', borderRadius:'10px', fontWeight:'bold'
                }}>{pest.unit}</span>
                <span style={{fontSize:'11px', color:'#9ca3af'}}>✏️</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 데이터 백업 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>💾 데이터 백업</h3>
        <p style={styles.settingDesc}>엑셀 파일로 데이터를 다운로드합니다.</p>
        <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
          <button onClick={() => handleBackup('customers')} style={styles.backupBtn}>📥 고객 데이터 백업</button>
          <button onClick={() => handleBackup('staff')} style={styles.backupBtn}>📥 직원 데이터 백업</button>
          <button onClick={() => handleBackup('events')} style={styles.backupBtn}>📥 배정 데이터 백업</button>
          <button onClick={() => handleBackup('all')} style={{...styles.backupBtn, backgroundColor:'#059669'}}>📥 전체 백업</button>
        </div>
      </div>

      {/* 데이터 관리 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>🗑️ 데이터 관리</h3>
        <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
          <button onClick={handleNormalizeCode} style={styles.normalizeBtn}>🔧 고객코드 정리</button>
          <button onClick={handleMigrateStaffId} style={{...styles.normalizeBtn, backgroundColor:'#8b5cf6'}}>🔄 직원ID 통합 정리</button>
          <button onClick={handleCleanDuplicateEvents} style={{...styles.normalizeBtn, backgroundColor:'#f59e0b'}}>🧹 중복 이벤트 정리</button>
          <button onClick={handleResetData} style={styles.resetBtn}>⚠️ 데이터 초기화</button>
        </div>
      </div>

      {/* 색상 범례 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>📊 색상 범례</h3>
        <div style={styles.legendGrid}>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#3b82f6'}}></span>🔵 정기</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#6366f1'}}></span>🟣 부정기</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#f97316'}}></span>🟠 특별</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#dc2626'}}></span>🔴 클레임</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#f59e0b'}}></span>🟡 수금</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#ef4444'}}></span>💰 미수</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#059669'}}></span>🟢 완료</div>
          <div style={styles.legendRow}><span style={{...styles.legendColor, backgroundColor:'#7e22ce'}}></span>🟣 야근</div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  loading: { textAlign:'center', padding:'50px', color:'#666' },
  section: { backgroundColor:'white', borderRadius:'10px', padding:'15px', marginBottom:'15px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' },
  sectionHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px' },
  sectionTitle: { margin:0, fontSize:'15px', color:'#374151' },
  addBtn: { padding:'8px 15px', backgroundColor:'#22c55e', color:'white', border:'none', borderRadius:'6px', fontWeight:'bold', cursor:'pointer', fontSize:'12px' },
  staffList: { display:'flex', flexDirection:'column', gap:'10px' },
  staffCard: { padding:'12px', backgroundColor:'#f8fafc', borderRadius:'8px', cursor:'pointer' },
  staffName: { fontWeight:'bold', fontSize:'14px', display:'flex', alignItems:'center', gap:'8px' },
  roleBadge: { fontSize:'10px', color:'white', padding:'2px 8px', borderRadius:'10px' },
  permBadge: { fontSize:'12px' },
  staffInfo: { fontSize:'11px', color:'#666', marginTop:'3px' },
  permList: { display:'flex', flexDirection:'column', gap:'8px' },
  permItem: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', backgroundColor:'#f8fafc', borderRadius:'8px' },
  permName: { fontWeight:'bold', fontSize:'13px' },
  permToggle: { padding:'6px 12px', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'bold', cursor:'pointer' },
  permNote: { fontSize:'11px', color:'#666', marginTop:'10px', padding:'8px', backgroundColor:'#f0f9ff', borderRadius:'6px' },
  settingItem: { marginBottom:'20px' },
  settingLabel: { fontWeight:'bold', fontSize:'13px', display:'block', marginBottom:'5px' },
  settingDesc: { fontSize:'11px', color:'#666', marginBottom:'8px' },
  settingSelect: { width:'100%', padding:'10px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'13px' },
  saveBtn: { width:'100%', padding:'12px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer' },
  normalizeBtn: { width:'100%', padding:'12px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer' },
  backupBtn: { width:'100%', padding:'12px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer' },
  resetBtn: { width:'100%', padding:'12px', backgroundColor:'#ef4444', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer' },
  legendGrid: { display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'8px' },
  legendRow: { display:'flex', alignItems:'center', gap:'8px', fontSize:'12px' },
  legendColor: { width:'16px', height:'16px', borderRadius:'4px' }
};

// ── 담당자 전화번호 편집기 ──────────────────────────────────
function MyPhoneEditor({ currentUser }) {
  const [phone, setPhone] = React.useState(currentUser?.phone || '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    setPhone(currentUser?.phone || '');
  }, [currentUser?.phone]);

  const handleSave = async () => {
    if (!currentUser?.id) {
      Swal.fire('오류', '로그인 정보를 찾을 수 없습니다.', 'error');
      return;
    }
    setSaving(true);
    try {
      // setDoc with merge: 문서가 없어도 생성, 있으면 업데이트
      await setDoc(doc(db, 'staff', currentUser.id), {
        phone,
        name: currentUser.name || '',
        email: currentUser.email || '',
        role: currentUser.role || '',
        visibleId: currentUser.visibleId || '',
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      Swal.fire('오류', '저장 실패: ' + e.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="tel"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        placeholder="예: 010-0000-0000"
        style={{
          padding: '10px 14px', borderRadius: '8px',
          border: '1px solid #ddd', fontSize: '14px', width: '200px'
        }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: '10px 20px', background: saved ? '#10b981' : '#3b82f6',
          color: 'white', border: 'none', borderRadius: '8px',
          cursor: 'pointer', fontSize: '14px', fontWeight: 'bold',
          transition: 'background 0.3s'
        }}
      >
        {saving ? '저장 중...' : saved ? '✅ 저장됨' : '저장'}
      </button>
      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
        견적서 PDF 담당자란에 표시됩니다.
      </span>
    </div>
  );
}

export default SettingPage;
