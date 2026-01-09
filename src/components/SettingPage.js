import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, firebaseConfig } from '../firebase';
import Swal from 'sweetalert2';

function SettingPage({ currentUser, staffList, onStaffUpdate }) {
  const [staff, setStaff] = useState([]);
  const [settings, setSettings] = useState({
    fallbackOption: 'waiting',
    overtimeHour: 10
  });
  const [settingsDocId, setSettingsDocId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const staffSnap = await getDocs(collection(db, 'staff'));
      setStaff(staffSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      const settingsSnap = await getDocs(collection(db, 'settings'));
      if (settingsSnap.docs.length > 0) {
        setSettings(settingsSnap.docs[0].data());
        setSettingsDocId(settingsSnap.docs[0].id);
      }
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

  // 활동 로그 기록
  const logActivity = async (action, target, details = '') => {
    try {
      await addDoc(collection(db, 'activityLogs'), {
        action,
        target,
        details,
        performedBy: currentUser?.name || '',
        performedById: currentUser?.visibleId || '',
        performedByRole: currentUser?.role || '',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('로그 기록 실패:', error);
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

  // 활동 기록 보기
  const handleViewActivityLog = async () => {
    try {
      const snap = await getDocs(collection(db, 'activityLogs'));
      const allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (allLogs.length === 0) {
        Swal.fire('활동 기록', '기록이 없습니다.', 'info');
        return;
      }

      // 고유 직원 목록 추출
      const uniqueStaff = [...new Set(allLogs.map(l => l.performedBy))].filter(Boolean);

      // 필터 팝업 표시
      const showFilteredLogs = (logs, filterInfo = '전체') => {
        let html = `
          <div style="margin-bottom:15px; display:flex; gap:8px; flex-wrap:wrap;">
            <select id="log-staff" style="padding:8px; border:1px solid #ddd; border-radius:6px; flex:1; min-width:100px;">
              <option value="">👤 전체 직원</option>
              ${uniqueStaff.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <input type="date" id="log-date" style="padding:8px; border:1px solid #ddd; border-radius:6px; flex:1; min-width:120px;">
            <button id="log-search-btn" style="padding:8px 15px; background:#3b82f6; color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">🔍 검색</button>
            <button id="log-reset-btn" style="padding:8px 15px; background:#6b7280; color:white; border:none; border-radius:6px; cursor:pointer;">↩️ 초기화</button>
          </div>
          <div style="font-size:11px; color:#666; margin-bottom:10px;">📊 ${filterInfo} (${logs.length}건)</div>
        `;

        html += '<div style="max-height:350px; overflow-y:auto; text-align:left; border:1px solid #eee; border-radius:8px;">';
        
        if (logs.length === 0) {
          html += '<div style="padding:20px; text-align:center; color:#666;">검색 결과가 없습니다.</div>';
        } else {
          logs.slice(0, 100).forEach(log => {
            const date = new Date(log.timestamp);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            const roleColor = log.performedByRole === 'master' ? '#dc2626' : 
                              log.performedByRole === 'master1' ? '#7c3aed' : '#0891b2';
            html += `
              <div style="padding:12px; border-bottom:1px solid #f3f4f6; font-size:12px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                  <span style="font-weight:bold; color:#1f2937;">${log.action}</span>
                  <span style="color:#6b7280; font-size:11px;">${dateStr}</span>
                </div>
                <div style="color:#374151;">📌 ${log.target}</div>
                ${log.details ? `<div style="color:#6b7280; font-size:11px; margin-top:2px;">→ ${log.details}</div>` : ''}
                <div style="margin-top:6px;">
                  <span style="background:${roleColor}; color:white; padding:3px 8px; border-radius:4px; font-size:10px;">
                    ${log.performedBy}
                  </span>
                </div>
              </div>
            `;
          });
        }
        html += '</div>';

        Swal.fire({
          title: '📋 활동 기록',
          html,
          width: '500px',
          showCloseButton: true,
          showConfirmButton: false,
          didOpen: () => {
            // 검색 버튼 클릭
            document.getElementById('log-search-btn').onclick = () => {
              const staffFilter = document.getElementById('log-staff').value;
              const dateFilter = document.getElementById('log-date').value;
              
              let filtered = allLogs;
              let filterDesc = [];
              
              if (staffFilter) {
                filtered = filtered.filter(l => l.performedBy === staffFilter);
                filterDesc.push(staffFilter);
              }
              
              if (dateFilter) {
                filtered = filtered.filter(l => {
                  const logDate = new Date(l.timestamp);
                  const filterDate = new Date(dateFilter);
                  return logDate.getFullYear() === filterDate.getFullYear() &&
                         logDate.getMonth() === filterDate.getMonth() &&
                         logDate.getDate() === filterDate.getDate();
                });
                filterDesc.push(dateFilter);
              }
              
              const info = filterDesc.length > 0 ? filterDesc.join(' / ') : '전체';
              showFilteredLogs(filtered, info);
            };
            
            // 초기화 버튼 클릭
            document.getElementById('log-reset-btn').onclick = () => {
              showFilteredLogs(allLogs, '전체');
            };
          }
        });
      };

      showFilteredLogs(allLogs, '전체');
      
    } catch (error) {
      console.error('로그 로드 실패:', error);
      Swal.fire('오류', '기록 로드 실패', 'error');
    }
  };

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
        await logActivity('직원삭제', s.name, `역할: ${s.role}`);
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
      
      if (changes.length > 0) {
        await logActivity('직원정보수정', s.name, changes.join(', '));
      }
      
      fetchData();
      if (onStaffUpdate) onStaffUpdate();
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
      Swal.fire('완료', '설정 저장됨', 'success');
    } catch (error) {
      Swal.fire('오류', '저장 실패', 'error');
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
                  {s.specialWorkPermission && <span style={styles.permBadge}>🌟</span>}
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

      {/* 특별작업 권한 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>🌟 특별작업 권한</h3>
        <p style={styles.settingDesc}>선택된 직원은 고객클레임, 상담, 추가작업을 등록할 수 있습니다.</p>
        <div style={styles.permList}>
          {staff.filter(s => s.role === 'staff').map(s => (
            <div key={s.id} style={styles.permItem}>
              <span style={styles.permName}>{s.name}</span>
              <button 
                onClick={async () => {
                  await updateDoc(doc(db, 'staff', s.id), { 
                    specialWorkPermission: !s.specialWorkPermission 
                  });
                  fetchData();
                  if (onStaffUpdate) onStaffUpdate();
                }}
                style={{
                  ...styles.permToggle,
                  backgroundColor: s.specialWorkPermission ? '#22c55e' : '#e5e7eb',
                  color: s.specialWorkPermission ? 'white' : '#666'
                }}
              >
                {s.specialWorkPermission ? '✅ 권한있음' : '❌ 권한없음'}
              </button>
            </div>
          ))}
          {staff.filter(s => s.role === 'staff').length === 0 && (
            <div style={{color:'#666', fontSize:'12px', textAlign:'center', padding:'10px'}}>
              일반 직원이 없습니다.
            </div>
          )}
        </div>
        <div style={styles.permNote}>
          ※ 관리자/팀장/부팀장은 기본적으로 권한이 있습니다.
        </div>
      </div>

      {/* 시스템 설정 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>⚙️ 시스템 설정</h3>
        
        {/* 야근 기준시간 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>🌙 야근 인정 기준시간</label>
          <p style={styles.settingDesc}>이 시간 전에 출근해야 야근이 인정됩니다.</p>
          <select 
            value={settings.overtimeHour || 10} 
            onChange={(e) => setSettings({...settings, overtimeHour: parseInt(e.target.value)})}
            style={styles.settingSelect}
          >
            {[7, 8, 9, 10, 11, 12].map(h => (
              <option key={h} value={h}>오전 {h}시</option>
            ))}
          </select>
        </div>

        {/* 배정탈락 설정 */}
        <div style={styles.settingItem}>
          <label style={styles.settingLabel}>📅 배정탈락 고객 처리</label>
          <p style={styles.settingDesc}>플랜 복사 시 해당 주/요일이 없는 경우</p>
          <select 
            value={settings.fallbackOption} 
            onChange={(e) => setSettings({...settings, fallbackOption: e.target.value})}
            style={styles.settingSelect}
          >
            <option value="waiting">대기목록으로</option>
            <option value="firstDay">해당 월 1일에 배정</option>
          </select>
        </div>

        <button onClick={handleSaveSettings} style={styles.saveBtn}>💾 설정 저장</button>
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

      {/* 활동 기록 (원조 관리자만) */}
      {isOriginalMaster && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>📋 활동 기록</h3>
          <p style={styles.settingDesc}>2번째 관리자, 팀장, 부팀장의 관리 활동 기록</p>
          <button onClick={handleViewActivityLog} style={styles.logBtn}>📋 기록 보기</button>
        </div>
      )}
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
  legendColor: { width:'16px', height:'16px', borderRadius:'4px' },
  logBtn: { width:'100%', padding:'12px', backgroundColor:'#6366f1', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer' }
};

export default SettingPage;
