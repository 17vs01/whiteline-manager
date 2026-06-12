import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db, firebaseConfig } from '../firebase';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import { useAppContext } from '../context/AppContext';

function StaffManagement({ currentUser, staffList, onStaffUpdate }) {
  const [activeTab, setActiveTab] = useState('stats'); // stats | manage | dashboard | settings | sales
  const [salesModalStaff, setSalesModalStaff] = useState(null); // 신규영업 모달용
  const [selectedStaff, setSelectedStaff] = useState(currentUser?.visibleId || currentUser?.id);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [stats, setStats] = useState({});
  const [attendance, setAttendance] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const { settings, fetchSettings: refreshAppSettings } = useAppContext();
  const equipmentList = settings.equipmentList || []; // AppContext에서 가져옴

  useEffect(() => {
    fetchStaffData();
  }, []);

  // staffList prop 변경 시 로컬 staff state 동기화
  useEffect(() => {
    if (staffList && staffList.length > 0) {
      setStaff(staffList);
    }
  }, [staffList]);

  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStatsData();
    } else if (activeTab === 'dashboard') {
      fetchDashboardData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStaff, selectedMonth, activeTab]);

  // 장비 목록 저장
  const saveEquipmentList = async (newList) => {
    try {
      const settingsSnap = await getDocs(collection(db, 'settings'));
      if (settingsSnap.docs.length > 0) {
        await updateDoc(doc(db, 'settings', settingsSnap.docs[0].id), {
          equipmentList: newList
        });
      } else {
        await addDoc(collection(db, 'settings'), {
          equipmentList: newList
        });
      }
      await refreshAppSettings(); // AppContext 즉시 갱신
    } catch (error) {
      console.error('장비 저장 오류:', error);
      Swal.fire('오류', '저장 실패', 'error');
    }
  };

  // 장비 추가
  const handleAddEquipment = async () => {
    const { value: formValues } = await Swal.fire({
      title: '🔧 장비 추가',
      html: `
        <div style="text-align:left;">
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">장비명</label>
            <input id="eq-name" class="swal2-input" placeholder="예: 포충기" style="margin:5px 0;">
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">기본 대당금액 (원)</label>
            <input id="eq-price" type="number" class="swal2-input" placeholder="10000" style="margin:5px 0;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '추가',
      cancelButtonText: '취소',
      confirmButtonColor: '#10b981',
      preConfirm: () => {
        const name = document.getElementById('eq-name').value.trim();
        const price = parseInt(document.getElementById('eq-price').value) || 0;
        if (!name) {
          Swal.showValidationMessage('장비명을 입력하세요');
          return false;
        }
        return { name, price };
      }
    });

    if (formValues) {
      const newEquipment = {
        id: `eq_${Date.now()}`,
        name: formValues.name,
        defaultPrice: formValues.price
      };
      const newList = [...equipmentList, newEquipment];
      await saveEquipmentList(newList);
      Swal.fire({ icon: 'success', title: '장비 추가됨', timer: 1500, showConfirmButton: false });
    }
  };

  // 장비 수정
  const handleEditEquipment = async (eq) => {
    const { value: formValues } = await Swal.fire({
      title: '✏️ 장비 수정',
      html: `
        <div style="text-align:left;">
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">장비명</label>
            <input id="eq-name" class="swal2-input" value="${eq.name}" style="margin:5px 0;">
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">기본 대당금액 (원)</label>
            <input id="eq-price" type="number" class="swal2-input" value="${eq.defaultPrice || 0}" style="margin:5px 0;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '저장',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      preConfirm: () => {
        const name = document.getElementById('eq-name').value.trim();
        const price = parseInt(document.getElementById('eq-price').value) || 0;
        if (!name) {
          Swal.showValidationMessage('장비명을 입력하세요');
          return false;
        }
        return { name, price };
      }
    });

    if (formValues) {
      const newList = equipmentList.map(e => 
        e.id === eq.id ? { ...e, name: formValues.name, defaultPrice: formValues.price } : e
      );
      await saveEquipmentList(newList);
      Swal.fire({ icon: 'success', title: '수정 완료', timer: 1500, showConfirmButton: false });
    }
  };

  // 장비 삭제
  const handleDeleteEquipment = async (eq) => {
    const result = await Swal.fire({
      title: '장비 삭제',
      text: `"${eq.name}"을(를) 삭제하시겠습니까?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });

    if (result.isConfirmed) {
      const newList = equipmentList.filter(e => e.id !== eq.id);
      await saveEquipmentList(newList);
      Swal.fire({ icon: 'success', title: '삭제 완료', timer: 1500, showConfirmButton: false });
    }
  };

  // 야근 수동 추가
  const addManualOvertime = async () => {
    const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff);
    const staffName = currentStaffMember?.name || '';
    
    // 시간 옵션 생성 (30분 단위)
    const timeOptions = [];
    for (let h = 17; h <= 23; h++) {
      timeOptions.push(`${String(h).padStart(2, '0')}:00`);
      timeOptions.push(`${String(h).padStart(2, '0')}:30`);
    }
    timeOptions.push('00:00', '00:30', '01:00', '01:30', '02:00');
    
    const { value: formValues } = await Swal.fire({
      title: '🌙 야근 추가',
      html: `
        <div style="text-align:left;">
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">업장명 *</label>
            <input id="ot-customer" class="swal2-input" placeholder="업장명 입력" style="margin:5px 0;width:100%;box-sizing:border-box;">
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">날짜 *</label>
            <input id="ot-date" type="date" class="swal2-input" value="${selectedMonth}-01" style="margin:5px 0;width:100%;box-sizing:border-box;">
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">시작시간</label>
            <select id="ot-start" class="swal2-input" style="margin:5px 0;width:100%;box-sizing:border-box;">
              <option value="">선택</option>
              ${timeOptions.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:12px;color:#666;">종료시간</label>
            <select id="ot-end" class="swal2-input" style="margin:5px 0;width:100%;box-sizing:border-box;">
              <option value="">선택</option>
              ${timeOptions.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '추가',
      cancelButtonText: '취소',
      confirmButtonColor: '#7e22ce',
      preConfirm: () => {
        const customer = document.getElementById('ot-customer').value.trim();
        const date = document.getElementById('ot-date').value;
        const startTime = document.getElementById('ot-start').value;
        const endTime = document.getElementById('ot-end').value;
        
        if (!customer) {
          Swal.showValidationMessage('업장명을 입력하세요');
          return false;
        }
        if (!date) {
          Swal.showValidationMessage('날짜를 선택하세요');
          return false;
        }
        
        let hours = 0;
        if (startTime && endTime) {
          let startMin = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
          let endMin = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
          if (endMin < startMin) endMin += 24 * 60;
          hours = (endMin - startMin) / 60;
        }
        
        return { customer, date, startTime, endTime, hours };
      }
    });
    
    if (formValues) {
      try {
        await addDoc(collection(db, 'overtimeRecords'), {
          staffId: selectedStaff,
          staffName: staffName,
          customerName: formValues.customer,
          date: formValues.date,
          startTime: formValues.startTime,
          endTime: formValues.endTime,
          hours: formValues.hours,
          yearMonth: formValues.date.substring(0, 7),
          isManual: true,
          createdAt: new Date().toISOString()
        });
        
        Swal.fire({ icon: 'success', title: '야근 추가됨', timer: 1500, showConfirmButton: false });
        fetchStatsData();
      } catch (error) {
        console.error('야근 추가 오류:', error);
        Swal.fire('오류', '저장 실패', 'error');
      }
    }
  };

  // 수동 야근 삭제
  const deleteManualOvertime = async (recordId) => {
    const result = await Swal.fire({
      title: '야근 삭제',
      text: '이 야근 기록을 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });
    
    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'overtimeRecords', recordId));
        Swal.fire({ icon: 'success', title: '삭제됨', timer: 1500, showConfirmButton: false });
        fetchStatsData();
      } catch (error) {
        console.error('야근 삭제 오류:', error);
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  // 야근 상세 팝업
  const showOvertimeDetail = async () => {
    const overtimeList = stats.overtimeList || [];
    
    // 시간 옵션 생성 (30분 단위)
    const timeOptions = [];
    for (let h = 17; h <= 23; h++) {
      timeOptions.push(`${String(h).padStart(2, '0')}:00`);
      timeOptions.push(`${String(h).padStart(2, '0')}:30`);
    }
    timeOptions.push('00:00', '00:30', '01:00', '01:30', '02:00');
    
    const listHtml = overtimeList.length === 0 
      ? '<div style="color:#999;text-align:center;padding:20px;">야근 기록이 없습니다</div>'
      : overtimeList.map((o, idx) => `
        <div style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:8px;border-left:4px solid ${o.isManual ? '#f59e0b' : '#7e22ce'};">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:bold;">
              ${o.name}
              ${o.isManual ? '<span style="font-size:10px;color:#f59e0b;margin-left:5px;">[수동]</span>' : ''}
            </span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;color:#666;">${o.date}</span>
              ${o.isManual ? `<button onclick="window.deleteManualOT('${o.id}')" style="background:#ef4444;color:white;border:none;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;">삭제</button>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <select id="ot-start-${idx}" data-event-id="${o.id}" data-is-manual="${o.isManual || false}" style="padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
              <option value="">시작</option>
              ${timeOptions.map(t => `<option value="${t}" ${o.startTime === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <span>~</span>
            <select id="ot-end-${idx}" data-event-id="${o.id}" data-is-manual="${o.isManual || false}" style="padding:6px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
              <option value="">종료</option>
              ${timeOptions.map(t => `<option value="${t}" ${o.endTime === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <span style="font-size:12px;color:#7e22ce;font-weight:bold;" id="ot-hours-${idx}">${o.hours ? o.hours + '시간' : ''}</span>
          </div>
        </div>
      `).join('');
    
    // 전역 함수로 삭제 기능 노출
    window.deleteManualOT = (recordId) => {
      Swal.close();
      deleteManualOvertime(recordId);
    };
    
    const result = await Swal.fire({
      title: '🌙 야근 상세',
      html: `
        <div style="text-align:left;max-height:400px;overflow-y:auto;">
          <div style="background:#f3e8ff;padding:10px;border-radius:8px;margin-bottom:15px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <span style="font-size:14px;">야근 업장: <b>${overtimeList.length}개</b></span>
              <span style="margin-left:15px;font-size:14px;">총: <b>${stats.totalOvertimeHours || 0}시간</b></span>
            </div>
            <button id="add-overtime-btn" style="background:#7e22ce;color:white;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;">+ 추가</button>
          </div>
          ${listHtml}
        </div>
      `,
      showCancelButton: overtimeList.length > 0,
      confirmButtonText: overtimeList.length > 0 ? '저장' : '확인',
      cancelButtonText: '취소',
      confirmButtonColor: '#7e22ce',
      width: '420px',
      didOpen: () => {
        // 야근 추가 버튼
        document.getElementById('add-overtime-btn')?.addEventListener('click', () => {
          Swal.close();
          addManualOvertime();
        });
        
        // 시간 변경 이벤트
        overtimeList.forEach((o, idx) => {
          const startEl = document.getElementById(`ot-start-${idx}`);
          const endEl = document.getElementById(`ot-end-${idx}`);
          const hoursEl = document.getElementById(`ot-hours-${idx}`);
          
          const calcHours = () => {
            const start = startEl.value;
            const end = endEl.value;
            if (start && end) {
              let startMin = parseInt(start.split(':')[0]) * 60 + parseInt(start.split(':')[1]);
              let endMin = parseInt(end.split(':')[0]) * 60 + parseInt(end.split(':')[1]);
              if (endMin < startMin) endMin += 24 * 60; // 자정 넘긴 경우
              const hours = (endMin - startMin) / 60;
              hoursEl.textContent = hours.toFixed(1) + '시간';
            }
          };
          
          startEl?.addEventListener('change', calcHours);
          endEl?.addEventListener('change', calcHours);
        });
      }
    });
    
    if (result.isConfirmed && overtimeList.length > 0) {
      // 저장
      for (let idx = 0; idx < overtimeList.length; idx++) {
        const o = overtimeList[idx];
        const startTime = document.getElementById(`ot-start-${idx}`)?.value || '';
        const endTime = document.getElementById(`ot-end-${idx}`)?.value || '';
        const isManual = document.getElementById(`ot-start-${idx}`)?.dataset.isManual === 'true';
        
        let hours = 0;
        if (startTime && endTime) {
          let startMin = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
          let endMin = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
          if (endMin < startMin) endMin += 24 * 60;
          hours = (endMin - startMin) / 60;
        }
        
        // 수동 추가 야근은 overtimeRecords에, 아니면 events에 저장
        if (isManual) {
          await updateDoc(doc(db, 'overtimeRecords', o.id), {
            startTime,
            endTime,
            hours
          });
        } else {
          await updateDoc(doc(db, 'events', o.id), {
            overtimeStartTime: startTime,
            overtimeEndTime: endTime,
            overtimeHours: hours
          });
        }
      }
      
      Swal.fire({ icon: 'success', title: '저장 완료', timer: 1500, showConfirmButton: false });
      fetchStatsData();
    }
  };

  // 미작업 상세 팝업
  const showNoWorkDetail = () => {
    const noWorkList = stats.noWorkList || [];
    
    const listHtml = noWorkList.length === 0
      ? '<div style="color:#999;text-align:center;padding:20px;">미작업 기록이 없습니다</div>'
      : noWorkList.map(n => `
        <div style="background:#f3f4f6;padding:12px;border-radius:8px;margin-bottom:8px;border-left:4px solid #6b7280;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:bold;">${n.name}</span>
            <span style="font-size:12px;color:#666;">${n.date}</span>
          </div>
          <div style="margin-top:6px;font-size:12px;color:#666;">
            📝 ${n.reason}
            ${n.isCarryOver ? '<span style="color:#f59e0b;margin-left:8px;">🔄 이월</span>' : ''}
          </div>
        </div>
      `).join('');
    
    Swal.fire({
      title: '⛔ 미작업 상세',
      html: `
        <div style="text-align:left;max-height:400px;overflow-y:auto;">
          <div style="background:#f3f4f6;padding:10px;border-radius:8px;margin-bottom:15px;text-align:center;">
            <span style="font-size:14px;">미작업 업장: <b>${noWorkList.length}개</b></span>
          </div>
          ${listHtml}
        </div>
      `,
      confirmButtonText: '확인',
      confirmButtonColor: '#6b7280',
      width: '400px'
    });
  };

  // 클레임 상세 팝업
  const showClaimDetail = () => {
    const claimList = stats.claimList || [];
    
    const listHtml = claimList.length === 0
      ? '<div style="color:#999;text-align:center;padding:20px;">클레임 방문 기록이 없습니다</div>'
      : claimList.map(c => `
        <div style="background:#fef2f2;padding:12px;border-radius:8px;margin-bottom:8px;border-left:4px solid #dc2626;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:bold;">${c.name}</span>
            <span style="font-size:12px;color:#666;">${c.date}</span>
          </div>
          ${c.note ? `<div style="margin-top:6px;font-size:12px;color:#666;">📝 ${c.note}</div>` : ''}
        </div>
      `).join('');
    
    Swal.fire({
      title: '⚠️ 클레임 방문',
      html: `
        <div style="text-align:left;max-height:400px;overflow-y:auto;">
          <div style="background:#fee2e2;padding:10px;border-radius:8px;margin-bottom:15px;text-align:center;">
            <span style="font-size:14px;">클레임 방문: <b>${claimList.length}건</b></span>
          </div>
          ${listHtml}
        </div>
      `,
      confirmButtonText: '확인',
      confirmButtonColor: '#dc2626',
      width: '400px'
    });
  };

  // 공동작업 상세 팝업
  const showCoWorkDetail = () => {
    const coWorkList = stats.coWorkList || [];
    
    const listHtml = coWorkList.length === 0
      ? '<div style="color:#999;text-align:center;padding:20px;">공동작업 기록이 없습니다</div>'
      : coWorkList.map(c => `
        <div style="background:#e0f2fe;padding:12px;border-radius:8px;margin-bottom:8px;border-left:4px solid #0369a1;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:bold;">${c.name}</span>
            <span style="font-size:12px;color:#0369a1;font-weight:bold;">${c.price.toLocaleString()}원 × ${c.count}건</span>
          </div>
        </div>
      `).join('');
    
    Swal.fire({
      title: '👥 공동작업 상세',
      html: `
        <div style="text-align:left;max-height:400px;overflow-y:auto;">
          <div style="background:#e0f2fe;padding:10px;border-radius:8px;margin-bottom:15px;text-align:center;">
            <span style="font-size:14px;">공동작업: <b>${stats.coWorkCount || 0}건</b></span>
            <span style="margin-left:15px;font-size:14px;">합계: <b>${(stats.coWorkRevenue || 0).toLocaleString()}원</b></span>
          </div>
          ${listHtml}
        </div>
      `,
      confirmButtonText: '확인',
      confirmButtonColor: '#0369a1',
      width: '400px'
    });
  };

  // 복사 함수
  const handleCopyStats = () => {
    const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff);
    const name = currentStaffMember?.name || selectedStaff;
    
    let text = `📊 ${name} 실적 (${selectedMonth.replace('-', '년 ')}월)\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📌 배정: ${stats.totalCount || 0}건\n`;
    text += `✅ 완료: ${stats.completedCount || 0}건 (${stats.completionRate || 0}%)\n`;
    text += `🌙 야근: ${stats.overtimeCount || 0}회 / ${stats.totalOvertimeHours || 0}시간\n`;
    text += `👥 공동작업: ${stats.coWorkCount || 0}건 / ${(stats.coWorkRevenue || 0).toLocaleString()}원\n`;
    text += `🌟 특별작업: ${stats.specialWorkCount || 0}건 / ${(stats.specialWorkRevenue || 0).toLocaleString()}원\n`;
    text += `📝 추가업무: ${stats.extraWorkCount || 0}건\n`;
    text += `🎯 루트세일: ${stats.routeSaleCount || 0}건\n`;
    text += `💰 인센티브: ${(stats.incentiveTotal || 0).toLocaleString()}원\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💵 월 총금액: ${(stats.monthTotal || 0).toLocaleString()}원\n`;
    text += `   (본인 ${(stats.completedRevenue || 0).toLocaleString()}원 + 공동 ${(stats.coWorkRevenue || 0).toLocaleString()}원 + 특별 ${(stats.specialWorkRevenue || 0).toLocaleString()}원)`;
    
    // 미작업 리스트 추가
    const noWorkList = stats.noWorkList || [];
    if (noWorkList.length > 0) {
      text += `\n\n⛔ 미작업 (${noWorkList.length}건)\n`;
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      noWorkList.forEach(n => {
        const dateStr = n.date ? n.date.substring(5).replace('-', '/') : '';
        const carryOver = n.isCarryOver ? ' [이월]' : '';
        text += `• ${n.name} (${dateStr})${carryOver}\n`;
        if (n.reason && n.reason !== '사유 없음') {
          text += `  └ ${n.reason}\n`;
        }
      });
    }

    navigator.clipboard.writeText(text).then(() => {
      Swal.fire({
        icon: 'success',
        title: '복사 완료!',
        text: '카카오톡에 붙여넣기 하세요',
        timer: 1500,
        showConfirmButton: false
      });
    }).catch(() => {
      Swal.fire('오류', '복사 실패', 'error');
    });
  };

  // 프린트 함수
  const handlePrintStats = () => {
    const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff);
    const name = currentStaffMember?.name || selectedStaff;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
      <head>
        <title>직원 실적 - ${name}</title>
        <style>
          body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; }
          h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
          .section h2 { margin: 0 0 10px; font-size: 16px; color: #333; }
          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
          .stat-box { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px; }
          .stat-label { font-size: 12px; color: #666; }
          .stat-value { font-size: 24px; font-weight: bold; margin: 5px 0; }
          .total { text-align: center; background: #1e40af; color: white; padding: 20px; border-radius: 8px; margin-top: 20px; }
          .total-value { font-size: 28px; font-weight: bold; }
          .list-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head>
      <body>
        <h1>📊 ${name} 실적 보고서</h1>
        <p style="text-align:center; color:#666;">${selectedMonth.replace('-', '년 ')}월</p>
        
        <div class="grid">
          <div class="stat-box">
            <div class="stat-label">총 배정</div>
            <div class="stat-value">${stats.totalCount || 0}건</div>
            <div style="font-size:12px;color:#666;">${(stats.totalRevenue || 0).toLocaleString()}원</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">완료</div>
            <div class="stat-value" style="color:#059669;">${stats.completedCount || 0}건</div>
            <div style="font-size:12px;color:#666;">${(stats.completedRevenue || 0).toLocaleString()}원</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">완료율</div>
            <div class="stat-value" style="color:#3b82f6;">${stats.completionRate || 0}%</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">야근</div>
            <div class="stat-value" style="color:#7e22ce;">${stats.validOvertimeCount || 0}회</div>
          </div>
        </div>

        <div class="section" style="background:#e0f2fe;">
          <h2 style="color:#0369a1;">👥 공동작업</h2>
          <div style="font-size:18px;font-weight:bold;color:#0369a1;">
            ${stats.coWorkCount || 0}건 / ${(stats.coWorkRevenue || 0).toLocaleString()}원
          </div>
          ${(stats.coWorkList || []).map(cw => `
            <div class="list-item">
              <span>${cw.name}</span>
              <span>${cw.price.toLocaleString()}원 × ${cw.count}건</span>
            </div>
          `).join('')}
        </div>

        <div class="section" style="background:#fef3c7;">
          <h2 style="color:#92400e;">🎯 루트세일</h2>
          <div style="font-size:18px;font-weight:bold;color:#92400e;">
            ${stats.routeSaleCount || 0}건
          </div>
          ${(stats.routeSaleList || []).map(rs => `
            <div class="list-item">
              <span>${rs.name} (${rs.completedMonths}개월)</span>
              <span>${rs.price.toLocaleString()}원/월 - ${rs.status}</span>
            </div>
          `).join('')}
        </div>

        <div class="section" style="background:#f3e8ff;">
          <h2 style="color:#7c3aed;">🌟 특별작업</h2>
          <div style="font-size:18px;font-weight:bold;color:#7c3aed;">
            ${stats.specialWorkCount || 0}건 / ${(stats.specialWorkRevenue || 0).toLocaleString()}원
          </div>
          ${(stats.specialWorkList || []).map(sw => `
            <div class="list-item">
              <span>${sw.name} (${sw.type})</span>
              <span>${sw.completedThisMonth || 0}건 - ${(sw.revenueThisMonth || 0).toLocaleString()}원</span>
            </div>
          `).join('')}
        </div>

        <div class="section" style="background:#dcfce7;">
          <h2 style="color:#166534;">💰 인센티브</h2>
          <div style="font-size:18px;font-weight:bold;color:#166534;">
            ${(stats.incentiveTotal || 0).toLocaleString()}원
          </div>
          ${(stats.incentiveList || []).map(inc => `
            <div class="list-item">
              <span>${inc.customerName} (${inc.type})</span>
              <span style="color:#166534;font-weight:bold;">+${inc.amount.toLocaleString()}원</span>
            </div>
          `).join('')}
        </div>

        <div class="total">
          <div style="font-size:14px;">💵 월 총금액</div>
          <div class="total-value">${(stats.monthTotal || 0).toLocaleString()}원</div>
          <div style="font-size:12px;opacity:0.8;">
            본인 ${(stats.completedRevenue || 0).toLocaleString()}원 + 공동 ${(stats.coWorkRevenue || 0).toLocaleString()}원 + 특별 ${(stats.specialWorkRevenue || 0).toLocaleString()}원
          </div>
        </div>

        <p style="text-align:center;margin-top:30px;color:#999;font-size:11px;">
          출력일: ${new Date().toLocaleDateString()}
        </p>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // 직원 목록 조회
  const fetchStaffData = async () => {
    // staffList prop에서 직접 사용 (Firestore 중복 fetch 방지)
    // 강제 갱신이 필요한 경우 onStaffUpdate 콜백 호출
    if (staffList && staffList.length > 0) {
      setStaff(staffList);
    } else {
      try {
        const snap = await getDocs(collection(db, 'staff'));
        setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('직원 데이터 조회 오류:', error);
      }
    }
  };

  // 대시보드 데이터 조회
  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      
      const eventSnap = await getDocs(collection(db, 'events'));
      const allEvents = eventSnap.docs.map(doc => doc.data());
      
      const custSnap = await getDocs(collection(db, 'customers'));
      const customers = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 해당 월 이벤트 필터링
      const monthEvents = allEvents.filter(e => {
        if (!e.date) return false;
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
      
      // 전체 통계
      let totalRevenue = 0;
      let completedRevenue = 0;
      let totalCount = monthEvents.length;
      let completedCount = 0;
      let unpaidTotal = 0;
      
      monthEvents.forEach(e => {
        const price = e.price || 0;
        totalRevenue += price;
        if (['완료', '야근'].includes(e.status)) {
          completedRevenue += price;
          completedCount++;
        }
      });
      
      // 미수금 계산
      customers.forEach(c => {
        if (c.unpaidMonths) {
          for (let m = 1; m <= 12; m++) {
            if (c.unpaidMonths[m]?.checked && !c.unpaidMonths[m]?.completed) {
              unpaidTotal += c.unpaidMonths[m].amount || 0;
            }
          }
        }
      });
      
      // 직원별 실적
      const staffStats = {};
      staffList.forEach(s => {
        staffStats[s.visibleId] = {
          name: s.name,
          total: 0,
          completed: 0,
          revenue: 0,
          completedRevenue: 0
        };
      });
      
      monthEvents.forEach(e => {
        const sid = e.staffId;
        if (staffStats[sid]) {
          staffStats[sid].total++;
          staffStats[sid].revenue += e.price || 0;
          if (['완료', '야근'].includes(e.status)) {
            staffStats[sid].completed++;
            staffStats[sid].completedRevenue += e.price || 0;
          }
        }
      });
      
      // 고객 상태별 통계
      const activeCustomers = customers.filter(c => c.custStatus !== '해약').length;
      const cancelledCustomers = customers.filter(c => c.custStatus === '해약').length;
      const regularCustomers = customers.filter(c => c.custStatus === '정기' || !c.custStatus).length;
      
      // 일별 완료 추이 (최근 14일)
      const dailyStats = [];
      for (let i = 13; i >= 0; i--) {
        const date = new Date(year, month - 1, new Date().getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayEvents = monthEvents.filter(e => e.date === dateStr);
        const dayCompleted = dayEvents.filter(e => ['완료', '야근'].includes(e.status)).length;
        dailyStats.push({
          date: `${date.getMonth() + 1}/${date.getDate()}`,
          total: dayEvents.length,
          completed: dayCompleted
        });
      }
      
      setDashboardData({
        totalRevenue,
        completedRevenue,
        totalCount,
        completedCount,
        completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
        unpaidTotal,
        staffStats: Object.values(staffStats).sort((a, b) => b.completedRevenue - a.completedRevenue),
        activeCustomers,
        cancelledCustomers,
        regularCustomers,
        dailyStats
      });
      
      setLoading(false);
    } catch (error) {
      console.error('대시보드 데이터 조회 오류:', error);
      setLoading(false);
    }
  };

  // 실적 데이터 조회
  const fetchStatsData = async () => {
    setLoading(true);
    try {
      const [year, month] = selectedMonth.split('-').map(Number);

      const eventSnap = await getDocs(collection(db, 'events'));
      // doc.data()에 id 필드가 있을 수 있으므로, document ID를 마지막에 넣어 덮어씌움
      const allEvents = eventSnap.docs.map(doc => ({ ...doc.data(), id: doc.id }));

      const custSnap = await getDocs(collection(db, 'customers'));
      const customers = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 현재 직원 정보
      const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff);
      const staffName = currentStaffMember?.name || '';

      // 선택한 직원의 해당 월 이벤트 (공동작업 이벤트 제외 - coWorkRevenue에서 별도 계산)
      const staffEvents = allEvents.filter(e => {
        if (!e.staffId || !e.date) return false;
        // 공동작업 이벤트는 제외 (이중 계산 방지)
        if (e.isCoWork) return false;
        const matchStaff = e.staffId === selectedStaff || e.staffVisibleId === selectedStaff;
        if (!matchStaff) return false;
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });

      let totalRevenue = 0;
      let completedRevenue = 0;
      let totalCount = staffEvents.length;
      let completedCount = 0;
      let overtimeCount = 0;
      let validOvertimeCount = 0;
      let noWorkCount = 0; // 미작업 건수
      
      // 야근 리스트
      const overtimeList = [];
      // 미작업 리스트
      const noWorkList = [];
      // 클레임 리스트
      const claimList = [];

      staffEvents.forEach(e => {
        const customer = customers.find(c => c.id === e.customerCode);
        // 특별작업은 별도로 계산하므로 여기서 제외 (중복 방지)
        const isSpecialWorkEvent = e.workType === 'special';
        const price = e.price || 0;

        // 특별작업이 아닌 것만 totalRevenue에 포함
        if (!isSpecialWorkEvent) {
          totalRevenue += price;
        }

        if (['완료', '야근'].includes(e.status)) {
          // 특별작업이 아닌 것만 completedRevenue에 포함
          if (!isSpecialWorkEvent) {
            completedRevenue += price;
          }
          completedCount++;
          
          // 클레임 태그가 있는 완료 건
          if (customer?.tags?.includes('클레임')) {
            claimList.push({
              name: customer.name || e.title,
              date: e.date,
              note: e.completedNote || '',
              customerCode: e.customerCode
            });
          }
        }

        if (e.status === '야근') {
          overtimeCount++;
          if (e.validOvertime) validOvertimeCount++;
          
          // 야근 리스트에 추가
          overtimeList.push({
            id: e.id,
            name: customer?.name || e.title,
            date: e.date,
            startTime: e.overtimeStartTime || '',
            endTime: e.overtimeEndTime || '',
            hours: e.overtimeHours || 0,
            customerCode: e.customerCode
          });
        }
        
        if (e.status === '미작업') {
          noWorkCount++;
          // 미작업 리스트에 추가
          noWorkList.push({
            name: customer?.name || e.title,
            date: e.date,
            reason: e.noWorkReason || '사유 없음',
            isCarryOver: e.isCarryOver || false,
            customerCode: e.customerCode
          });
        }
      });

      // 수동 추가된 야근 기록 조회
      const overtimeRecordsSnap = await getDocs(collection(db, 'overtimeRecords'));
      const manualOvertimes = overtimeRecordsSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(r => {
          if (r.staffId !== selectedStaff) return false;
          return r.yearMonth === selectedMonth;
        });
      
      // 수동 야근을 리스트에 추가
      manualOvertimes.forEach(r => {
        overtimeCount++;
        overtimeList.push({
          id: r.id,
          name: r.customerName,
          date: r.date,
          startTime: r.startTime || '',
          endTime: r.endTime || '',
          hours: r.hours || 0,
          isManual: true
        });
      });
      
      // 날짜순 정렬
      overtimeList.sort((a, b) => new Date(a.date) - new Date(b.date));

      // 공동작업 통계 (이 직원이 공동작업자로 등록된 고객)
      // coWorkers 배열 (신규) + coWorker 단일 (기존) 모두 확인
      const coWorkCustomers = [];
      
      customers.forEach(c => {
        // 신규: coWorkers 배열에서 찾기
        if (c.coWorkers && Array.isArray(c.coWorkers)) {
          const matchedCoWorker = c.coWorkers.find(cw => cw.staffName === staffName);
          if (matchedCoWorker) {
            coWorkCustomers.push({ ...c, matchedCoWorkerPrice: matchedCoWorker.price || 0 });
            return;
          }
        }
        // 기존: coWorker 단일에서 찾기
        if (c.coWorker && c.coWorker.staffName === staffName) {
          coWorkCustomers.push({ ...c, matchedCoWorkerPrice: c.coWorker.price || 0 });
        }
      });
      
      // 공동작업 완료 건수 (해당 월에 완료된 것)
      let coWorkCount = 0;
      let coWorkRevenue = 0;
      const coWorkList = [];
      
      coWorkCustomers.forEach(c => {
        // 메인 담당자의 일반 작업 이벤트만 카운트
        // - isCoWork=true인 공동작업자 이벤트 제외
        // - workType='special' 특별작업 제외 (특별작업 통계에서 별도 계산)
        // - workType='folder' 폴더 제외 (폴더는 별도 처리)
        const completedEvents = allEvents.filter(e => {
          if (e.customerCode !== c.id) return false;
          if (e.isCoWork) return false;
          if (e.workType === 'special') return false;  // 특별작업 제외!
          if (e.workType === 'folder') return false;   // 폴더 제외!
          if (!['완료', '야근'].includes(e.status)) return false;
          const d = new Date(e.date);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        });
        
        // matchedCoWorkerPrice 사용 (배열/단일 모두 호환)
        const price = c.matchedCoWorkerPrice || c.coWorker?.price || 0;
        
        if (completedEvents.length > 0) {
          coWorkCount += completedEvents.length;
          coWorkRevenue += price * completedEvents.length;
          coWorkList.push({
            name: c.name,
            price: price,
            count: completedEvents.length,
            completedAt: completedEvents[0].date
          });
          
          // 일반 고객 공동작업 야근도 야근 카운트에 추가
          completedEvents.forEach(ev => {
            if (ev.status === '야근') {
              overtimeCount++;
              overtimeList.push({
                id: ev.id + '_cowork',
                name: c.name + ' (공동)',
                date: ev.date,
                startTime: '',
                endTime: '',
                hours: 0,
                isCoWork: true
              });
            }
          });
        }
      });

      // 폴더 공동작업 (이벤트에서 직접 조회)
      // 폴더는 고객카드가 아닌 folders 컬렉션에 coWorkers가 저장됨
      const folderCoWorkEvents = allEvents.filter(e => {
        if (!e.isCoWork) return false;
        if (e.workType !== 'folder') return false;
        if (e.staffId !== selectedStaff && e.staffName !== staffName) return false;
        if (!['완료', '야근'].includes(e.status)) return false;
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
      
      
      folderCoWorkEvents.forEach(e => {
        const price = e.coWorkPrice || e.price || 0;
        coWorkCount += 1;
        coWorkRevenue += price;
        coWorkList.push({
          name: e.folderName || e.title?.replace(' (공동)', '') || '폴더',
          price: price,
          count: 1,
          completedAt: e.date,
          isFolder: true
        });
        
        // 폴더 공동작업 야근도 야근 카운트에 추가
        if (e.status === '야근') {
          overtimeCount++;
          overtimeList.push({
            id: e.id,
            name: (e.folderName || e.title?.replace(' (공동)', '') || '폴더') + ' (공동)',
            date: e.date,
            startTime: e.overtimeStartTime || '',
            endTime: e.overtimeEndTime || '',
            hours: e.overtimeHours || 0,
            isCoWork: true
          });
        }
      });

      // 루트세일 통계 (이 직원이 영업해온 고객)
      const routeSaleCustomers = customers.filter(c => 
        c.routeSale?.enabled && c.routeSale?.staffName === staffName
      );
      
      let routeSaleCount = routeSaleCustomers.length;
      let routeSaleRevenue = 0;
      let incentiveTotal = 0;
      const routeSaleList = [];
      const incentiveList = [];

      routeSaleCustomers.forEach(c => {
        const price = c.services?.reduce((sum, s) => sum + (s.price || 0), 0) || c.price || 0;
        routeSaleRevenue += price;

        // 완료된 작업 개월수 계산
        const completedEvents = allEvents.filter(e => 
          e.customerCode === c.id && ['완료', '야근'].includes(e.status)
        );
        const completedMonths = new Set(completedEvents.map(e => e.date?.substring(0, 7))).size;

        let status = '진행중';
        let incentive1 = 0;
        let incentive2 = 0;

        // 1차 인센티브 (2개월 완료 시 20%)
        if (completedMonths >= 2 && !c.routeSale?.firstIncentivePaid) {
          incentive1 = Math.round(price * 2 * 0.2);
          status = '1차 지급대기';
        } else if (c.routeSale?.firstIncentivePaid) {
          incentive1 = Math.round(price * 2 * 0.2);
          status = '1차 완료';
        }

        // 2차 인센티브 (1년 유지 + 다음 1개월 완료 시 10%)
        const registeredDate = new Date(c.routeSale?.registeredAt || c.createdAt);
        const oneYearLater = new Date(registeredDate);
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
        
        if (completedMonths >= 13 && c.routeSale?.firstIncentivePaid && !c.routeSale?.secondIncentivePaid) {
          incentive2 = Math.round(price * 0.1);
          status = '2차 지급대기';
        } else if (c.routeSale?.secondIncentivePaid) {
          incentive2 = Math.round(price * 0.1);
          status = '2차 완료';
        }

        // 해당 월에 인센티브 발생 여부 체크
        const thisMonthStr = `${year}-${String(month).padStart(2, '0')}`;
        if (c.routeSale?.incentiveHistory) {
          c.routeSale.incentiveHistory.forEach(ih => {
            if (ih.paidMonth === thisMonthStr) {
              incentiveTotal += ih.amount;
              incentiveList.push({
                customerName: c.name,
                type: ih.type,
                amount: ih.amount,
                paidMonth: ih.paidMonth
              });
            }
          });
        }

        routeSaleList.push({
          name: c.name,
          price: price,
          completedMonths: completedMonths,
          status: status,
          incentive1: c.routeSale?.firstIncentivePaid ? incentive1 : 0,
          incentive2: c.routeSale?.secondIncentivePaid ? incentive2 : 0,
          registeredAt: c.routeSale?.registeredAt
        });
      });

      // 특별작업 통계 (이 직원이 특별작업 담당자로 등록된 고객)
      const specialWorkCustomers = customers.filter(c => 
        c.specialWork?.staffName === staffName
      );
      
      let specialWorkCount = 0;
      let specialWorkRevenue = 0;
      const specialWorkList = [];
      
      specialWorkCustomers.forEach(c => {
        const specialWork = c.specialWork;
        if (!specialWork) return;
        
        // 해당 월이 작업월인지 확인
        const workMonths = specialWork.workMonths || [1,2,3,4,5,6,7,8,9,10,11,12];
        if (!workMonths.includes(month)) return;
        
        // 해당 월에 완료된 특별작업 이벤트 찾기
        const completedSpecialEvents = allEvents.filter(e => {
          if (e.customerCode !== c.id) return false;
          if (e.workType !== 'special') return false;
          if (!['완료', '야근'].includes(e.status)) return false;
          const d = new Date(e.date);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        });
        
        const completedThisMonth = completedSpecialEvents.length;
        const pricePerWork = specialWork.price || 0;
        const revenueThisMonth = completedThisMonth * pricePerWork;
        
        if (completedThisMonth > 0 || workMonths.includes(month)) {
          specialWorkCount += completedThisMonth;
          specialWorkRevenue += revenueThisMonth;
          specialWorkList.push({
            name: c.name,
            type: specialWork.type || '특별작업',
            totalCount: specialWork.totalCount || 0,
            completedCount: specialWork.completedCount || 0,
            completedThisMonth: completedThisMonth,
            price: pricePerWork,
            revenueThisMonth: revenueThisMonth
          });
        }
      });
      
      // 특별작업 공동작업 통계 (events에서 직접 찾기 - 공동작업자로 배정된 특별작업)
      const specialCoWorkEvents = allEvents.filter(e => 
        e.workType === 'special' && 
        e.isCoWork === true && 
        e.staffName === staffName &&
        ['완료', '야근'].includes(e.status) &&
        new Date(e.date).getFullYear() === year &&
        new Date(e.date).getMonth() + 1 === month
      );
      
      specialCoWorkEvents.forEach(e => {
        coWorkCount += 1;
        const price = e.price || e.coWorkPrice || 0;
        coWorkRevenue += price;
        
        // 같은 고객의 이벤트가 이미 목록에 있는지 확인
        const existingItem = coWorkList.find(cw => cw.name === `🌟 ${e.title}` && cw.isSpecial);
        if (existingItem) {
          existingItem.count += 1;
          existingItem.price += price;
        } else {
          coWorkList.push({
            name: `🌟 ${e.title}`,
            price: price,
            count: 1,
            completedAt: e.date,
            isSpecial: true
          });
        }
      });

      // 추가업무 통계 (extraWork 컬렉션에서)
      const extraWorkSnap = await getDocs(query(
        collection(db, 'extraWork'),
        where('staffId', '==', selectedStaff),
        where('month', '==', `${year}-${String(month).padStart(2, '0')}`)
      ));
      
      let extraWorkCount = 0;
      const extraWorkByCategory = { '상담': 0, '영업': 0, '수금': 0, '클레임': 0, '기타': 0 };
      const extraWorkList = [];
      
      extraWorkSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.status === '완료') {
          extraWorkCount++;
          const category = data.category || '기타';
          extraWorkByCategory[category] = (extraWorkByCategory[category] || 0) + 1;
          extraWorkList.push({
            title: data.title,
            category: data.category,
            completedAt: data.completedAt,
            completedNote: data.completedNote
          });
        }
      });

      setStats({
        totalRevenue,
        completedRevenue,
        totalCount,
        completedCount,
        overtimeCount,
        validOvertimeCount,
        noWorkCount, // 미작업 건수
        completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
        // 야근 상세
        overtimeList,
        totalOvertimeHours: overtimeList.reduce((sum, o) => sum + (o.hours || 0), 0),
        // 미작업 상세
        noWorkList,
        // 클레임 상세
        claimCount: claimList.length,
        claimList,
        // 공동작업
        coWorkCount,
        coWorkRevenue,
        coWorkList,
        // 루트세일
        routeSaleCount,
        routeSaleRevenue,
        routeSaleList,
        // 특별작업
        specialWorkCount,
        specialWorkRevenue,
        specialWorkList,
        // 추가업무
        extraWorkCount,
        extraWorkByCategory,
        extraWorkList,
        // 인센티브
        incentiveTotal,
        incentiveList,
        // 월 총금액 (본인 + 공동작업 + 특별작업)
        monthTotal: completedRevenue + coWorkRevenue + specialWorkRevenue
      });

      // 근태 데이터
      const attSnap = await getDocs(query(
        collection(db, 'attendance'),
        where('staffId', '==', selectedStaff)
      ));
      
      const attData = attSnap.docs.map(doc => doc.data())
        .filter(a => {
          const d = new Date(a.date);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      const groupedAtt = {};
      attData.forEach(a => {
        if (!groupedAtt[a.date]) groupedAtt[a.date] = {};
        groupedAtt[a.date][a.type] = a;
      });

      setAttendance(Object.entries(groupedAtt).map(([date, data]) => ({
        date,
        clockIn: data.clockIn,
        clockOut: data.clockOut
      })));

      setLoading(false);
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  // 직원 등록
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
          <input id="swal-phone" class="swal2-input" placeholder="전화번호" style="margin:5px auto;">
          <input id="swal-address" class="swal2-input" placeholder="주소" style="margin:5px auto;">
          <input id="swal-email" class="swal2-input" type="email" placeholder="이메일" style="margin:5px auto;">
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#666; font-size:12px;">선택 입력</div>
          
          <select id="swal-position" class="swal2-input" style="margin:5px auto;">
            <option value="">직급 선택</option>
            <option value="사원">사원</option>
            <option value="주임">주임</option>
            <option value="대리">대리</option>
            <option value="과장">과장</option>
            <option value="차장">차장</option>
            <option value="부장">부장</option>
          </select>
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
            <option value="master">관리자</option>
          </select>
          
          <div style="margin-top:15px; padding:10px; background:#f0f9ff; border-radius:8px; font-size:11px; color:#0369a1;">
            💡 비밀번호: 영문, 숫자, 특수문자(!@#$%^&*) 조합 8자 이상
          </div>
        </div>
      `,
      width: '400px',
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
        
        if (!id || !pw || !name || !phone || !address || !email) {
          Swal.showValidationMessage('필수 항목을 모두 입력하세요');
          return false;
        }
        
        if (!/^[a-zA-Z0-9]+$/.test(id)) {
          Swal.showValidationMessage('아이디는 영문/숫자만 가능합니다');
          return false;
        }
        
        if (pw.length < 8) {
          Swal.showValidationMessage('비밀번호는 8자 이상이어야 합니다');
          return false;
        }
        if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[!@#$%^&*]/.test(pw)) {
          Swal.showValidationMessage('비밀번호는 영문, 숫자, 특수문자(!@#$%^&*)를 포함해야 합니다');
          return false;
        }
        
        if (pw !== pw2) {
          Swal.showValidationMessage('비밀번호가 일치하지 않습니다');
          return false;
        }
        
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
          position: document.getElementById('swal-position').value,
          birthDate: document.getElementById('swal-birth').value,
          birthType: document.getElementById('swal-birthType').value,
          role: document.getElementById('swal-role').value
        };
      }
    });

    if (!value) return;

    // 중복 ID 체크
    const existingStaff = staff.find(s => s.visibleId === value.visibleId);
    if (existingStaff) {
      Swal.fire('오류', '이미 존재하는 ID입니다.', 'error');
      return;
    }

    Swal.fire({
      title: '등록 중...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    try {
      const loginEmail = `${value.visibleId}@test.com`;
      
      // Secondary App으로 계정 생성
      const existingApps = getApps();
      const secondaryAppExists = existingApps.find(app => app.name === 'Secondary');
      if (secondaryAppExists) {
        await deleteApp(secondaryAppExists);
      }
      
      const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
      const secondaryAuth = getAuth(secondaryApp);
      
      await createUserWithEmailAndPassword(secondaryAuth, loginEmail, value.pw);
      await deleteApp(secondaryApp);
      
      // Firestore에 저장
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
            <p><b>권한:</b> ${value.role === 'master' ? '관리자' : '직원'}</p>
          </div>
        `
      });
      
      fetchStaffData();
      if (onStaffUpdate) onStaffUpdate();
      
    } catch (error) {
      console.error('직원 등록 오류:', error);
      let errorMsg = '등록 실패';
      if (error.code === 'auth/email-already-in-use') {
        errorMsg = '이미 사용 중인 ID입니다.';
      }
      Swal.fire('오류', errorMsg, 'error');
    }
  };

  // 직원 정보 수정
  const handleEditStaff = async (staffMember) => {
    const { value } = await Swal.fire({
      title: '✏️ 직원 정보 수정',
      html: `
        <div style="text-align:left; padding:0 10px; max-height:400px; overflow-y:auto;">
          <div style="background:#f8fafc; padding:10px; border-radius:8px; margin-bottom:10px;">
            <div style="font-size:11px; color:#666;">🔒 아이디: <b>${staffMember.visibleId}</b></div>
          </div>
          
          <input id="swal-name" class="swal2-input" value="${staffMember.name || ''}" placeholder="성함" style="margin:5px auto;">
          <input id="swal-phone" class="swal2-input" value="${staffMember.phone || ''}" placeholder="전화번호" style="margin:5px auto;">
          <input id="swal-address" class="swal2-input" value="${staffMember.address || ''}" placeholder="주소" style="margin:5px auto;">
          <input id="swal-email" class="swal2-input" value="${staffMember.email || ''}" placeholder="이메일" style="margin:5px auto;">
          
          <select id="swal-position" class="swal2-input" style="margin:5px auto;">
            <option value="">직급 선택</option>
            <option value="사원" ${staffMember.position === '사원' ? 'selected' : ''}>사원</option>
            <option value="주임" ${staffMember.position === '주임' ? 'selected' : ''}>주임</option>
            <option value="대리" ${staffMember.position === '대리' ? 'selected' : ''}>대리</option>
            <option value="과장" ${staffMember.position === '과장' ? 'selected' : ''}>과장</option>
            <option value="차장" ${staffMember.position === '차장' ? 'selected' : ''}>차장</option>
            <option value="부장" ${staffMember.position === '부장' ? 'selected' : ''}>부장</option>
          </select>
          
          <div style="display:flex; gap:8px; align-items:center; margin:5px 15px;">
            <input id="swal-birth" type="date" class="swal2-input" value="${staffMember.birthDate || ''}" style="flex:1; margin:0;">
            <select id="swal-birthType" class="swal2-input" style="width:80px; margin:0;">
              <option value="solar" ${staffMember.birthType === 'solar' ? 'selected' : ''}>양력</option>
              <option value="lunar" ${staffMember.birthType === 'lunar' ? 'selected' : ''}>음력</option>
            </select>
          </div>
          
          <div style="font-weight:bold; margin:15px 0 5px; color:#374151; font-size:12px;">🔐 권한</div>
          <select id="swal-role" class="swal2-input" style="margin:5px auto;">
            <option value="staff" ${staffMember.role === 'staff' ? 'selected' : ''}>직원</option>
            <option value="master" ${staffMember.role === 'master' ? 'selected' : ''}>관리자</option>
          </select>
        </div>
      `,
      width: '400px',
      showCancelButton: true,
      confirmButtonText: '저장',
      cancelButtonText: '취소',
      preConfirm: () => {
        const name = document.getElementById('swal-name').value.trim();
        if (!name) {
          Swal.showValidationMessage('성함을 입력하세요');
          return false;
        }
        return {
          name,
          phone: document.getElementById('swal-phone').value.trim(),
          address: document.getElementById('swal-address').value.trim(),
          email: document.getElementById('swal-email').value.trim(),
          position: document.getElementById('swal-position').value,
          birthDate: document.getElementById('swal-birth').value,
          birthType: document.getElementById('swal-birthType').value,
          role: document.getElementById('swal-role').value
        };
      }
    });

    if (value) {
      try {
        await updateDoc(doc(db, 'staff', staffMember.id), value);
        Swal.fire('완료', '직원 정보가 수정되었습니다.', 'success');
        fetchStaffData();
        if (onStaffUpdate) onStaffUpdate();
      } catch (error) {
        console.error('수정 오류:', error);
        Swal.fire('오류', '수정 실패', 'error');
      }
    }
  };

  // 비밀번호 초기화
  const handleResetPassword = async (staffMember) => {
    const { value } = await Swal.fire({
      title: '🔐 비밀번호 초기화',
      html: `
        <div style="text-align:left; padding:10px;">
          <p><b>${staffMember.name}</b> (${staffMember.visibleId})</p>
          <div style="margin-top:15px;">
            <input id="swal-newpw" class="swal2-input" type="password" placeholder="새 비밀번호" style="margin:5px auto;">
            <input id="swal-newpw2" class="swal2-input" type="password" placeholder="새 비밀번호 확인" style="margin:5px auto;">
          </div>
          <div style="margin-top:10px; padding:10px; background:#fef3c7; border-radius:8px; font-size:11px; color:#92400e;">
            ⚠️ 영문, 숫자, 특수문자(!@#$%^&*) 조합 8자 이상
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '변경',
      cancelButtonText: '취소',
      preConfirm: () => {
        const newPw = document.getElementById('swal-newpw').value;
        const newPw2 = document.getElementById('swal-newpw2').value;
        
        if (newPw.length < 8) {
          Swal.showValidationMessage('비밀번호는 8자 이상이어야 합니다');
          return false;
        }
        if (!/[a-zA-Z]/.test(newPw) || !/[0-9]/.test(newPw) || !/[!@#$%^&*]/.test(newPw)) {
          Swal.showValidationMessage('영문, 숫자, 특수문자(!@#$%^&*)를 포함해야 합니다');
          return false;
        }
        if (newPw !== newPw2) {
          Swal.showValidationMessage('비밀번호가 일치하지 않습니다');
          return false;
        }
        return newPw;
      }
    });

    if (value) {
      try {
        // Firestore에 임시 비밀번호 저장 (직원에게 전달용)
        await updateDoc(doc(db, 'staff', staffMember.id), {
          tempPassword: value,
          passwordResetAt: new Date().toISOString()
        });
        
        Swal.fire({
          icon: 'info',
          title: '비밀번호 안내',
          html: `
            <div style="text-align:left; padding:10px;">
              <p>새 비밀번호: <b>${value}</b></p>
              <div style="margin-top:10px; padding:10px; background:#fef3c7; border-radius:8px; font-size:11px; color:#92400e;">
                ⚠️ Firebase Auth 비밀번호는 직원이 직접 변경해야 합니다.<br><br>
                방법: 로그인 화면에서 "비밀번호 찾기" 이용
              </div>
            </div>
          `
        });
        
      } catch (error) {
        console.error('비밀번호 변경 오류:', error);
        Swal.fire('오류', '비밀번호 변경 실패', 'error');
      }
    }
  };

  // 직원 삭제
  const handleDeleteStaff = async (staffMember) => {
    // 자기 자신 삭제 방지
    if (staffMember.visibleId === currentUser?.visibleId) {
      Swal.fire('오류', '자기 자신은 삭제할 수 없습니다.', 'error');
      return;
    }

    const result = await Swal.fire({
      title: '⚠️ 직원 삭제',
      html: `
        <div style="text-align:left; padding:10px;">
          <p><b>${staffMember.name}</b> (${staffMember.visibleId})</p>
          <p style="color:#dc2626; font-size:12px; margin-top:10px;">
            삭제된 직원은 로그인할 수 없습니다.<br>
            기존 배정 기록은 유지됩니다.
          </p>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#dc2626'
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'staff', staffMember.id));
        Swal.fire('완료', '직원이 삭제되었습니다.', 'success');
        fetchStaffData();
        if (onStaffUpdate) onStaffUpdate();
      } catch (error) {
        console.error('삭제 오류:', error);
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  // ── 월말 정산 PDF (전 직원 한번에) ──────────────────────────
  const handleMonthlySettlement = async () => {
    const { isConfirmed, value: options } = await Swal.fire({
      title: '📊 월말 정산 보고서',
      html: `
        <div style="text-align:left;padding:0 10px;">
          <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">선택한 항목이 포함된 정산 보고서를 생성합니다.</p>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="opt-work" checked> 작업 실적 (완료/야근/미작업)
          </label>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="opt-revenue" checked> 매출 내역
          </label>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="opt-ot"> 야근 기록
          </label>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="opt-holiday"> 휴무 기록
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="opt-unpaid"> 미수금 현황
          </label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '📄 PDF 생성',
      cancelButtonText: '취소',
      confirmButtonColor: '#1e40af',
      preConfirm: () => ({
        work:    document.getElementById('opt-work')?.checked,
        revenue: document.getElementById('opt-revenue')?.checked,
        ot:      document.getElementById('opt-ot')?.checked,
        holiday: document.getElementById('opt-holiday')?.checked,
        unpaid:  document.getElementById('opt-unpaid')?.checked,
      }),
    });
    if (!isConfirmed) return;

    Swal.fire({ title: '생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
      const [yr, mo] = selectedMonth.split('-').map(Number);
      const monthLabel = `${yr}년 ${mo}월`;

      // 전 직원 데이터 수집
      const [evSnap, custSnap, schSnap] = await Promise.all([
        getDocs(query(collection(db, 'events'), where('date', '>=', `${selectedMonth}-01`), where('date', '<=', `${selectedMonth}-31`))),
        getDocs(collection(db, 'customers')),
        options.holiday ? getDocs(query(collection(db, 'scheduleEvents'), where('type','==','holiday'), where('date','>=',`${selectedMonth}-01`), where('date','<=',`${selectedMonth}-31`))) : Promise.resolve({ docs: [] }),
      ]);

      const allEvents   = evSnap.docs.map(d => d.data());
      const allCustomers= custSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const holidays    = schSnap.docs.map(d => d.data());

      // 직원별 정산 계산
      const settlementByStaff = {};
      staff.forEach(s => {
        const name = s.name;
        const myEvents = allEvents.filter(e => e.staffName === name && !e.isCoWork);
        const done  = myEvents.filter(e => e.status === '완료' || e.status === '야근');
        const night = myEvents.filter(e => e.status === '야근');
        const noWork= myEvents.filter(e => e.status === '미작업');
        const revenue = done.reduce((sum, e) => sum + (Number(e.price) || 0), 0);
        const myHolidays = holidays.filter(h => h.staffId === s.visibleId || h.staffName === name);

        // 미수금
        const unpaidCustomers = options.unpaid
          ? allCustomers.filter(c => c.staffName === name && c.unpaid > 0)
          : [];
        const totalUnpaid = unpaidCustomers.reduce((s, c) => s + (c.unpaid || 0), 0);

        settlementByStaff[name] = {
          totalCount: myEvents.length,
          doneCount:  done.length,
          nightCount: night.length,
          noWorkCount: noWork.length,
          revenue,
          holidays:   myHolidays,
          unpaid:     totalUnpaid,
          unpaidList: unpaidCustomers,
        };
      });

      // HTML 생성
      const staffRows = staff.map(s => {
        const d = settlementByStaff[s.name] || {};
        return `
          <div style="margin-bottom:20px;padding:16px;border:1px solid #e2e8f0;border-radius:10px;page-break-inside:avoid;">
            <h3 style="margin:0 0 12px;color:#1e40af;border-bottom:2px solid #3b82f6;padding-bottom:6px;">
              👤 ${s.name} ${s.position ? `(${s.position})` : ''}
            </h3>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;">
              ${options.work ? `
                <div style="text-align:center;background:#f0fdf4;padding:10px;border-radius:8px;">
                  <div style="font-size:11px;color:#666;">배정</div>
                  <div style="font-size:20px;font-weight:bold;color:#059669;">${d.totalCount||0}</div>
                </div>
                <div style="text-align:center;background:#eff6ff;padding:10px;border-radius:8px;">
                  <div style="font-size:11px;color:#666;">완료</div>
                  <div style="font-size:20px;font-weight:bold;color:#3b82f6;">${d.doneCount||0}</div>
                </div>
                <div style="text-align:center;background:#faf5ff;padding:10px;border-radius:8px;">
                  <div style="font-size:11px;color:#666;">야근</div>
                  <div style="font-size:20px;font-weight:bold;color:#7c3aed;">${d.nightCount||0}</div>
                </div>
                <div style="text-align:center;background:#f1f5f9;padding:10px;border-radius:8px;">
                  <div style="font-size:11px;color:#666;">미작업</div>
                  <div style="font-size:20px;font-weight:bold;color:#64748b;">${d.noWorkCount||0}</div>
                </div>
              ` : ''}
            </div>
            ${options.revenue ? `
              <div style="background:#1e40af;color:white;padding:12px 16px;border-radius:8px;margin-bottom:10px;">
                <span style="font-size:13px;">💰 월 매출</span>
                <span style="font-size:20px;font-weight:bold;margin-left:12px;">${(d.revenue||0).toLocaleString()}원</span>
              </div>
            ` : ''}
            ${options.holiday && d.holidays?.length > 0 ? `
              <div style="background:#fef3c7;padding:10px;border-radius:8px;margin-bottom:10px;">
                <div style="font-weight:bold;color:#92400e;margin-bottom:6px;">🏖️ 휴무 (${d.holidays.length}일)</div>
                ${d.holidays.map(h => `<div style="font-size:12px;color:#78350f;">${h.date} - ${h.holiday?.reason || h.title || '휴무'}</div>`).join('')}
              </div>
            ` : ''}
            ${options.unpaid && d.unpaid > 0 ? `
              <div style="background:#fee2e2;padding:10px;border-radius:8px;">
                <div style="font-weight:bold;color:#dc2626;margin-bottom:6px;">💸 미수금: ${d.unpaid.toLocaleString()}원</div>
                ${d.unpaidList.slice(0,5).map(c => `<div style="font-size:12px;color:#991b1b;">${c.name}: ${(c.unpaid||0).toLocaleString()}원</div>`).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      const html = `<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>${monthLabel} 월말 정산 보고서</title>
        <style>
          body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          h1 { text-align: center; color: #1e293b; margin-bottom: 4px; }
          h2 { text-align: center; color: #64748b; font-size: 14px; font-weight: normal; margin-bottom: 24px; }
          @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        </style>
      </head><body>
        <h1>📊 월말 정산 보고서</h1>
        <h2>${monthLabel} | 직원 ${staff.length}명</h2>
        ${staffRows}
        <div style="text-align:center;color:#94a3b8;font-size:11px;margin-top:20px;">
          생성일: ${new Date().toLocaleString('ko-KR')}
        </div>
      </body></html>`;

      const win = window.open('', '_blank', 'width=800,height=600');
      win.document.write(html);
      win.document.close();
      win.onload = () => win.print();
      Swal.close();
    } catch (e) {
      Swal.fire('오류', '정산 보고서 생성 실패: ' + e.message, 'error');
    }
  };

  // ── 엑셀 리포트 자동화 ────────────────────────────────────
  const handleExcelReport = async () => {
    const { value: reportType } = await Swal.fire({
      title: '📊 엑셀 리포트',
      html: `
        <div style="text-align:left;padding:0 10px;">
          <p style="font-size:13px;color:#6b7280;margin-bottom:12px;">내보낼 리포트를 선택하세요.</p>
          <div id="rtype" style="display:flex;flex-direction:column;gap:8px;">
            <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;">
              <input type="radio" name="rtype" value="monthly" checked> 📅 월별 직원 실적
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;">
              <input type="radio" name="rtype" value="customers"> 👥 고객별 작업 현황
            </label>
            <label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;">
              <input type="radio" name="rtype" value="unpaid"> 💰 미수금 현황
            </label>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '📥 다운로드',
      cancelButtonText: '취소',
      confirmButtonColor: '#059669',
      preConfirm: () => document.querySelector('input[name="rtype"]:checked')?.value || 'monthly',
    });
    if (!reportType) return;

    Swal.fire({ title: '생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
      const wb = XLSX.utils.book_new();

      if (reportType === 'monthly') {
        // 월별 직원 실적
        const evSnap = await getDocs(query(collection(db, 'events'),
          where('date', '>=', `${selectedMonth}-01`), where('date', '<=', `${selectedMonth}-31`)));
        const allEvents = evSnap.docs.map(d => d.data());

        const rows = staff.map(s => {
          const myEvs = allEvents.filter(e => e.staffName === s.name && !e.isCoWork);
          const done  = myEvs.filter(e => e.status==='완료'||e.status==='야근').length;
          const night = myEvs.filter(e => e.status==='야근').length;
          const noWork= myEvs.filter(e => e.status==='미작업').length;
          const rev   = myEvs.filter(e => e.status==='완료'||e.status==='야근').reduce((s,e)=>s+(Number(e.price)||0),0);
          const rate  = myEvs.length > 0 ? Math.round(done/myEvs.length*100) : 0;
          return {
            '직원명': s.name, '직급': s.position || '',
            '총배정': myEvs.length, '완료': done, '야근': night, '미작업': noWork,
            '완료율(%)': rate, '매출(원)': rev,
          };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, `${selectedMonth} 실적`);

      } else if (reportType === 'customers') {
        // 고객별 작업 현황
        const [custSnap, evSnap] = await Promise.all([
          getDocs(collection(db, 'customers')),
          getDocs(query(collection(db, 'events'),
            where('date', '>=', `${selectedMonth}-01`), where('date', '<=', `${selectedMonth}-31`))),
        ]);
        const allCusts = custSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.custStatus === '정상');
        const allEvents = evSnap.docs.map(d => d.data());

        const rows = allCusts.map(c => {
          const myEvs  = allEvents.filter(e => e.customerCode === c.code || e.customerCode === c.id);
          const done   = myEvs.filter(e => e.status==='완료'||e.status==='야근');
          const status = done.length > 0 ? '완료' : myEvs.length > 0 ? '배정' : '미배정';
          return {
            '고객코드': c.code, '고객명': c.name, '담당자': c.staffName || '',
            '월금액(원)': c.services?.reduce((s,sv)=>s+(sv.price||0),0) || c.price || 0,
            '미수금(원)': c.unpaid || 0,
            '이번달 작업': done.length > 0 ? done[0].date : '-',
            '상태': status,
          };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, `${selectedMonth} 고객현황`);

      } else if (reportType === 'unpaid') {
        // 미수금 현황
        const custSnap = await getDocs(collection(db, 'customers'));
        const rows = custSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(c => c.unpaid > 0 && c.custStatus !== '삭제')
          .sort((a,b) => (b.unpaid||0) - (a.unpaid||0))
          .map(c => ({
            '고객코드': c.code, '고객명': c.name,
            '상태': c.custStatus, '담당자': c.staffName || '',
            '연락처': c.phone || '',
            '미수금(원)': c.unpaid || 0,
            '납부방법': c.paymentMethod || '',
          }));
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, '미수금 현황');
      }

      XLSX.writeFile(wb, `화이트라인_${reportType}_${selectedMonth}.xlsx`);
      Swal.close();
      Swal.fire({ toast:true, position:'top', icon:'success', title:'엑셀 다운로드 완료!', timer:2000, showConfirmButton:false });
    } catch(e) {
      Swal.fire('오류', '엑셀 생성 실패: ' + e.message, 'error');
    }
  };


  const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff) || { name: currentUser?.name };
  const isMaster = currentUser?.role === 'master';

  return (
    <div>
      {/* 탭 */}
      <div style={styles.tabs}>
        <button 
          onClick={() => setActiveTab('stats')} 
          style={{...styles.tab, ...(activeTab === 'stats' ? styles.activeTab : {})}}
        >
          실적
        </button>
        {isMaster && (
          <button 
            onClick={() => setActiveTab('dashboard')} 
            style={{...styles.tab, ...(activeTab === 'dashboard' ? styles.activeTab : {})}}
          >
            현황
          </button>
        )}
        {isMaster && (
          <button 
            onClick={() => setActiveTab('manage')} 
            style={{...styles.tab, ...(activeTab === 'manage' ? styles.activeTab : {})}}
          >
            직원
          </button>
        )}
        {isMaster && (
          <button 
            onClick={() => setActiveTab('settings')} 
            style={{...styles.tab, ...(activeTab === 'settings' ? styles.activeTab : {})}}
          >
            설정
          </button>
        )}
        {isMaster && (
          <button
            onClick={() => setActiveTab('sales')}
            style={{...styles.tab, ...(activeTab === 'sales' ? {...styles.activeTab, backgroundColor:'#10b981'} : {})}}
          >
            신규영업
          </button>
        )}
      </div>

      {/* 신규영업 탭 */}
      {activeTab === 'sales' && isMaster && (
        <SalesTab
          staffList={staffList}
          salesModalStaff={salesModalStaff}
          setSalesModalStaff={setSalesModalStaff}
        />
      )}

      {/* 실적 탭 */}
      {activeTab === 'stats' && (
        <>
          {isMaster && (
            <div style={styles.staffSelector}>
              {staffList.map(s => (
                <button 
                  key={s.id} 
                  onClick={() => setSelectedStaff(s.visibleId)}
                  style={{
                    ...styles.staffBtn,
                    backgroundColor: selectedStaff === s.visibleId ? '#3b82f6' : '#e5e7eb',
                    color: selectedStaff === s.visibleId ? 'white' : '#374151'
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <div style={styles.monthSelector}>
            <input 
              type="month" 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={styles.monthInput}
            />
          </div>

          <div style={{marginBottom:'12px'}}>
            <div style={{display:'flex', alignItems:'center', gap:'6px', marginBottom:'6px'}}>
              <div style={styles.staffTitle}>👤 {currentStaffMember.name} - {selectedMonth.replace('-', '년 ')}월</div>
            </div>
            <div style={{display:'flex', gap:'6px', flexWrap:'nowrap', overflowX:'auto'}}>
              <button onClick={() => handleCopyStats()} style={styles.copyBtn}>📋 복사</button>
              <button onClick={() => handlePrintStats()} style={styles.printBtn}>🖨️ 프린트</button>
              {['master','master1','master2'].includes(currentUser?.role) && (
                <>
                  <button onClick={handleMonthlySettlement}
                    style={{ padding:'6px 8px', backgroundColor:'#1e40af', color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'bold', cursor:'pointer', whiteSpace:'nowrap' }}>
                    📊 월말정산
                  </button>
                  <button onClick={handleExcelReport}
                    style={{ padding:'6px 8px', backgroundColor:'#059669', color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'bold', cursor:'pointer', whiteSpace:'nowrap' }}>
                    📥 엑셀
                  </button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div style={styles.loading}>로딩중...</div>
          ) : (
            <div id="stats-content">
              <div style={styles.statsGrid}>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>총 배정</div>
                  <div style={styles.statValue}>{stats.totalCount || 0}건</div>
                  <div style={styles.statSubValue}>{(stats.totalRevenue || 0).toLocaleString()}원</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>완료</div>
                  <div style={{...styles.statValue, color:'#059669'}}>{stats.completedCount || 0}건</div>
                  <div style={styles.statSubValue}>{(stats.completedRevenue || 0).toLocaleString()}원</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>완료율</div>
                  <div style={{...styles.statValue, color:'#3b82f6'}}>{stats.completionRate || 0}%</div>
                </div>
                <div style={{...styles.statCard, cursor:'pointer'}} onClick={showOvertimeDetail}>
                  <div style={styles.statLabel}>🌙 야근</div>
                  <div style={{...styles.statValue, color:'#7e22ce'}}>{stats.overtimeCount || 0}회</div>
                  <div style={styles.statSubValue}>
                    {(stats.overtimeList?.length || 0)}개 업장 / {stats.totalOvertimeHours || 0}시간
                  </div>
                </div>
              </div>

              {/* 클레임 + 미작업 섹션 */}
              <div style={{display:'flex', gap:'10px', marginBottom:'10px'}}>
                {/* 클레임 */}
                <div 
                  style={{...styles.section, flex:1, backgroundColor:'#fef2f2', cursor:'pointer', marginBottom:0}} 
                  onClick={showClaimDetail}
                >
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <h3 style={{...styles.sectionTitle, color:'#dc2626', margin:0}}>⚠️ 클레임</h3>
                    <div style={{fontWeight:'bold', color:'#dc2626'}}>
                      {stats.claimCount || 0}건
                    </div>
                  </div>
                </div>

                {/* 미작업 */}
                <div 
                  style={{...styles.section, flex:1, backgroundColor:'#f3f4f6', cursor:'pointer', marginBottom:0}} 
                  onClick={showNoWorkDetail}
                >
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <h3 style={{...styles.sectionTitle, color:'#6b7280', margin:0}}>⛔ 미작업</h3>
                    <div style={{fontWeight:'bold', color:'#6b7280'}}>
                      {stats.noWorkCount || 0}건
                    </div>
                  </div>
                </div>
              </div>

              {/* 공동작업 섹션 */}
              <div style={{...styles.section, backgroundColor:'#e0f2fe', cursor:'pointer'}} onClick={showCoWorkDetail}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <h3 style={{...styles.sectionTitle, color:'#0369a1', margin:0}}>👥 공동작업</h3>
                  <div style={{fontWeight:'bold', color:'#0369a1'}}>
                    {stats.coWorkCount || 0}건 / {(stats.coWorkRevenue || 0).toLocaleString()}원
                  </div>
                </div>
              </div>

              {/* 루트세일 섹션 */}
              <div style={{...styles.section, backgroundColor:'#fef3c7'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <h3 style={{...styles.sectionTitle, color:'#92400e', margin:0}}>🎯 루트세일</h3>
                  <div style={{fontWeight:'bold', color:'#92400e'}}>
                    {stats.routeSaleCount || 0}건
                  </div>
                </div>
                {stats.routeSaleList && stats.routeSaleList.length > 0 && (
                  <div style={{marginTop:'10px'}}>
                    {stats.routeSaleList.map((rs, idx) => (
                      <div key={idx} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #fde68a', fontSize:'12px'}}>
                        <div>
                          <div style={{fontWeight:'bold'}}>{rs.name}</div>
                          <div style={{color:'#666', fontSize:'11px'}}>{rs.completedMonths}개월 완료</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div>{rs.price.toLocaleString()}원/월</div>
                          <div style={{
                            fontSize:'10px', 
                            padding:'2px 6px', 
                            borderRadius:'10px',
                            backgroundColor: rs.status.includes('완료') ? '#dcfce7' : rs.status.includes('대기') ? '#fee2e2' : '#f3f4f6',
                            color: rs.status.includes('완료') ? '#166534' : rs.status.includes('대기') ? '#dc2626' : '#666'
                          }}>{rs.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 특별작업 섹션 */}
              <div style={{...styles.section, backgroundColor:'#f3e8ff'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <h3 style={{...styles.sectionTitle, color:'#7c3aed', margin:0}}>🌟 특별작업</h3>
                  <div style={{fontWeight:'bold', color:'#7c3aed'}}>
                    {stats.specialWorkCount || 0}건 / {(stats.specialWorkRevenue || 0).toLocaleString()}원
                  </div>
                </div>
                {stats.specialWorkList && stats.specialWorkList.length > 0 && (
                  <div style={{marginTop:'10px'}}>
                    {stats.specialWorkList.map((sw, idx) => (
                      <div key={idx} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #e9d5ff', fontSize:'12px'}}>
                        <div>
                          <div style={{fontWeight:'bold'}}>{sw.name}</div>
                          <div style={{color:'#666', fontSize:'11px'}}>{sw.type} | {sw.completedCount || 0}/{sw.totalCount || 0}회</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div>이번달 {sw.completedThisMonth || 0}건</div>
                          <div style={{color:'#7c3aed', fontWeight:'bold'}}>{(sw.revenueThisMonth || 0).toLocaleString()}원</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 추가업무 섹션 */}
              <div style={{...styles.section, backgroundColor:'#fff7ed'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <h3 style={{...styles.sectionTitle, color:'#ea580c', margin:0}}>📝 추가업무</h3>
                  <div style={{fontWeight:'bold', color:'#ea580c'}}>
                    {stats.extraWorkCount || 0}건
                  </div>
                </div>
                {stats.extraWorkCount > 0 && stats.extraWorkByCategory && (
                  <div style={{marginTop:'10px'}}>
                    <div style={{display:'flex', flexWrap:'wrap', gap:'8px', marginBottom:'10px'}}>
                      {Object.entries(stats.extraWorkByCategory).filter(([_, count]) => count > 0).map(([cat, count]) => (
                        <span key={cat} style={{
                          padding:'4px 10px',
                          backgroundColor:'#fed7aa',
                          borderRadius:'12px',
                          fontSize:'11px',
                          color:'#9a3412'
                        }}>
                          {cat === '상담' ? '📞' : cat === '영업' ? '💼' : cat === '수금' ? '💰' : cat === '클레임' ? '⚠️' : '📋'} {cat} {count}건
                        </span>
                      ))}
                    </div>
                    {stats.extraWorkList && stats.extraWorkList.map((ew, idx) => (
                      <div key={idx} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #fed7aa', fontSize:'12px'}}>
                        <div>
                          <span style={{fontWeight:'bold'}}>{ew.title}</span>
                          <span style={{marginLeft:'6px', color:'#ea580c', fontSize:'10px'}}>[{ew.category}]</span>
                        </div>
                        <div style={{fontSize:'10px', color:'#666'}}>
                          {ew.completedAt ? new Date(ew.completedAt).toLocaleDateString() : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 인센티브 섹션 */}
              <div style={{...styles.section, backgroundColor:'#dcfce7'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <h3 style={{...styles.sectionTitle, color:'#166534', margin:0}}>💰 인센티브</h3>
                  <div style={{fontWeight:'bold', color:'#166534', fontSize:'18px'}}>
                    {(stats.incentiveTotal || 0).toLocaleString()}원
                  </div>
                </div>
                {stats.incentiveList && stats.incentiveList.length > 0 && (
                  <div style={{marginTop:'10px'}}>
                    {stats.incentiveList.map((inc, idx) => (
                      <div key={idx} style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #bbf7d0', fontSize:'12px'}}>
                        <span>{inc.customerName} ({inc.type})</span>
                        <span style={{color:'#166534', fontWeight:'bold'}}>+{inc.amount.toLocaleString()}원</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 월 총금액 */}
              <div style={{...styles.section, backgroundColor:'#1e40af', color:'white', textAlign:'center'}}>
                <div style={{fontSize:'12px', marginBottom:'5px'}}>💵 월 총금액</div>
                <div style={{fontSize:'24px', fontWeight:'bold'}}>
                  {(stats.monthTotal || 0).toLocaleString()}원
                </div>
                <div style={{fontSize:'11px', opacity:0.8, marginTop:'5px'}}>
                  본인 {(stats.completedRevenue || 0).toLocaleString()}원 + 공동 {(stats.coWorkRevenue || 0).toLocaleString()}원 + 특별 {(stats.specialWorkRevenue || 0).toLocaleString()}원
                </div>
              </div>

              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>📅 근태 기록</h3>
                {attendance.length === 0 ? (
                  <div style={styles.empty}>근태 기록 없음</div>
                ) : (
                  <div style={styles.attList}>
                    {attendance.map(a => (
                      <div key={a.date} style={styles.attCard}>
                        <div style={styles.attDate}>{a.date}</div>
                        <div style={styles.attTimes}>
                          <div style={styles.attTime}>
                            <span style={styles.attLabel}>출근</span>
                            <span style={{
                              ...styles.attValue,
                              color: a.clockIn?.isValidOvertime ? '#059669' : '#dc2626'
                            }}>
                              {formatTime(a.clockIn?.time)}
                              {a.clockIn?.isValidOvertime ? ' ✅' : a.clockIn ? ' ⚠️' : ''}
                            </span>
                          </div>
                          <div style={styles.attTime}>
                            <span style={styles.attLabel}>퇴근</span>
                            <span style={styles.attValue}>{formatTime(a.clockOut?.time)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={styles.legend}>
                <span>✅ 정상출근 (야근인정)</span>
                <span>⚠️ 지각 (야근불인정)</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* 대시보드 탭 */}
      {activeTab === 'dashboard' && isMaster && (
        <>
          <div style={styles.monthSelector}>
            <input 
              type="month" 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={styles.monthInput}
            />
          </div>

          {loading ? (
            <div style={styles.loading}>로딩중...</div>
          ) : dashboardData && (
            <>
              {/* 전체 요약 */}
              <div style={styles.dashSection}>
                <h3 style={styles.dashTitle}>📊 {selectedMonth.replace('-', '년 ')}월 현황</h3>
                <div style={styles.statsGrid}>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>총 배정</div>
                    <div style={styles.statValue}>{dashboardData.totalCount}건</div>
                    <div style={styles.statSubValue}>{dashboardData.totalRevenue.toLocaleString()}원</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>완료</div>
                    <div style={{...styles.statValue, color:'#059669'}}>{dashboardData.completedCount}건</div>
                    <div style={styles.statSubValue}>{dashboardData.completedRevenue.toLocaleString()}원</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>완료율</div>
                    <div style={{...styles.statValue, color:'#3b82f6'}}>{dashboardData.completionRate}%</div>
                    <div style={{...styles.completionBar}}>
                      <div style={{...styles.completionFill, width: `${dashboardData.completionRate}%`}}></div>
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>미수금</div>
                    <div style={{...styles.statValue, color:'#ef4444'}}>{dashboardData.unpaidTotal.toLocaleString()}원</div>
                  </div>
                </div>
              </div>

              {/* 고객 현황 */}
              <div style={styles.dashSection}>
                <h3 style={styles.dashTitle}>👥 고객 현황</h3>
                <div style={styles.customerStats}>
                  <div style={styles.custStatItem}>
                    <span style={styles.custStatLabel}>🔵 정기</span>
                    <span style={styles.custStatValue}>{dashboardData.regularCustomers}개</span>
                  </div>
                  <div style={styles.custStatItem}>
                    <span style={styles.custStatLabel}>✅ 활성</span>
                    <span style={styles.custStatValue}>{dashboardData.activeCustomers}개</span>
                  </div>
                  <div style={styles.custStatItem}>
                    <span style={styles.custStatLabel}>🔴 해약</span>
                    <span style={styles.custStatValue}>{dashboardData.cancelledCustomers}개</span>
                  </div>
                </div>
              </div>

              {/* 직원별 실적 */}
              <div style={styles.dashSection}>
                <h3 style={styles.dashTitle}>👤 직원별 실적</h3>
                <div style={styles.staffRankList}>
                  {dashboardData.staffStats.map((s, idx) => (
                    <div key={idx} style={styles.staffRankItem}>
                      <div style={styles.staffRankInfo}>
                        <span style={styles.staffRankNum}>{idx + 1}</span>
                        <span style={styles.staffRankName}>{s.name}</span>
                      </div>
                      <div style={styles.staffRankStats}>
                        <span style={styles.staffRankCount}>{s.completed}/{s.total}건</span>
                        <span style={styles.staffRankRevenue}>{s.completedRevenue.toLocaleString()}원</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 일별 추이 (간단 바 차트) */}
              <div style={styles.dashSection}>
                <h3 style={styles.dashTitle}>📈 일별 완료 추이</h3>
                <div style={styles.chartContainer}>
                  {dashboardData.dailyStats.map((d, idx) => (
                    <div key={idx} style={styles.chartBar}>
                      <div style={styles.chartBarInner}>
                        <div style={{
                          ...styles.chartBarFill,
                          height: `${Math.min(d.completed * 10, 100)}%`
                        }}></div>
                      </div>
                      <span style={styles.chartLabel}>{d.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* 관리 탭 */}
      {activeTab === 'manage' && isMaster && (
        <>
          <button onClick={handleAddStaff} style={styles.addBtn}>
            ➕ 직원 등록
          </button>

          <div style={styles.staffList}>
            {staff.map(s => (
              <div key={s.id} style={styles.staffCard}>
                <div style={styles.staffInfo}>
                  <div style={styles.staffName}>
                    {s.name}
                    <span style={{
                      ...styles.roleBadge,
                      backgroundColor: s.role === 'master' ? '#dbeafe' : '#f3f4f6',
                      color: s.role === 'master' ? '#1d4ed8' : '#374151'
                    }}>
                      {s.role === 'master' ? '관리자' : '직원'}
                    </span>
                  </div>
                  <div style={styles.staffMeta}>
                    <span>🆔 {s.visibleId}</span>
                    {s.position && <span> | {s.position}</span>}
                  </div>
                  <div style={styles.staffMeta}>📧 {s.email || '-'}</div>
                  <div style={styles.staffMeta}>📞 {s.phone || '-'}</div>
                </div>
                <div style={styles.staffActions}>
                  <button onClick={() => handleEditStaff(s)} style={styles.actionBtn}>✏️ 수정</button>
                  <button onClick={() => handleResetPassword(s)} style={{...styles.actionBtn, backgroundColor:'#f59e0b'}}>🔐 비번</button>
                  <button onClick={() => handleDeleteStaff(s)} style={{...styles.actionBtn, backgroundColor:'#ef4444'}}>🗑️ 삭제</button>
                </div>
              </div>
            ))}
          </div>

          {staff.length === 0 && (
            <div style={styles.empty}>등록된 직원이 없습니다.</div>
          )}
        </>
      )}

      {/* 설정 탭 */}
      {activeTab === 'settings' && isMaster && (
        <>
          {/* 설치장비 관리 */}
          <div style={{ background: '#ecfdf5', padding: '15px', borderRadius: '12px', marginBottom: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, color: '#059669', fontSize: '16px' }}>🔧 설치장비 관리</h3>
              <button 
                onClick={handleAddEquipment} 
                style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                ➕ 장비 추가
              </button>
            </div>
            
            {equipmentList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#666' }}>
                등록된 장비가 없습니다. 장비를 추가해주세요.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {equipmentList.map(eq => (
                  <div key={eq.id} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    background: 'white', 
                    padding: '12px 15px', 
                    borderRadius: '8px',
                    border: '1px solid #d1fae5'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#065f46' }}>{eq.name}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        기본 대당금액: {(eq.defaultPrice || 0).toLocaleString()}원
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => handleEditEquipment(eq)} 
                        style={{ padding: '6px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                      >
                        ✏️ 수정
                      </button>
                      <button 
                        onClick={() => handleDeleteEquipment(eq)} 
                        style={{ padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                      >
                        🗑️ 삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  tabs: { display:'flex', gap:'4px', marginBottom:'12px', overflowX:'auto', WebkitOverflowScrolling:'touch', paddingBottom:'2px' },
  tab: { flexShrink:0, padding:'8px 12px', border:'none', borderRadius:'8px', backgroundColor:'#e5e7eb', fontSize:'12px', fontWeight:'bold', cursor:'pointer', whiteSpace:'nowrap' },
  activeTab: { backgroundColor:'#3b82f6', color:'white' },
  
  loading: { textAlign:'center', padding:'50px', color:'#666' },
  staffSelector: { display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'15px' },
  staffBtn: { padding:'10px 15px', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px' },
  monthSelector: { marginBottom:'15px' },
  monthInput: { width:'100%', padding:'12px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px', boxSizing:'border-box' },
  staffTitle: { fontSize:'14px', fontWeight:'bold', color:'#374151', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flex:1, minWidth:0 },
  
  statsGrid: { display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'10px', marginBottom:'20px' },
  statCard: { backgroundColor:'white', padding:'15px', borderRadius:'10px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)', textAlign:'center' },
  statLabel: { fontSize:'11px', color:'#666', marginBottom:'5px' },
  statValue: { fontSize:'20px', fontWeight:'bold', color:'#374151' },
  statSubValue: { fontSize:'11px', color:'#9ca3af', marginTop:'3px' },
  
  section: { backgroundColor:'white', borderRadius:'10px', padding:'15px', marginBottom:'15px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' },
  sectionTitle: { margin:'0 0 15px', fontSize:'15px', color:'#374151' },
  empty: { textAlign:'center', padding:'30px', color:'#9ca3af' },
  
  attList: { display:'flex', flexDirection:'column', gap:'10px' },
  attCard: { padding:'12px', backgroundColor:'#f8fafc', borderRadius:'8px' },
  attDate: { fontWeight:'bold', marginBottom:'8px', color:'#374151' },
  attTimes: { display:'flex', gap:'20px' },
  attTime: { display:'flex', flexDirection:'column' },
  attLabel: { fontSize:'10px', color:'#666' },
  attValue: { fontSize:'14px', fontWeight:'bold', color:'#374151' },
  legend: { display:'flex', gap:'15px', fontSize:'11px', color:'#666', justifyContent:'center', marginTop:'10px' },
  
  addBtn: { width:'100%', padding:'15px', backgroundColor:'#22c55e', color:'white', border:'none', borderRadius:'10px', fontSize:'16px', fontWeight:'bold', cursor:'pointer', marginBottom:'15px' },
  
  staffList: { display:'flex', flexDirection:'column', gap:'10px' },
  staffCard: { backgroundColor:'white', padding:'15px', borderRadius:'10px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' },
  staffInfo: { marginBottom:'10px' },
  staffName: { fontSize:'16px', fontWeight:'bold', marginBottom:'5px', display:'flex', alignItems:'center', gap:'8px' },
  roleBadge: { fontSize:'10px', padding:'3px 8px', borderRadius:'10px', fontWeight:'bold' },
  staffMeta: { fontSize:'12px', color:'#666', marginBottom:'3px' },
  staffActions: { display:'flex', gap:'8px', flexWrap:'wrap' },
  actionBtn: { padding:'8px 12px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'bold', cursor:'pointer' },
  
  // 대시보드 스타일
  dashSection: { backgroundColor:'white', borderRadius:'10px', padding:'15px', marginBottom:'15px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' },
  dashTitle: { margin:'0 0 15px', fontSize:'15px', color:'#374151', fontWeight:'bold' },
  completionBar: { height:'6px', backgroundColor:'#e5e7eb', borderRadius:'3px', marginTop:'5px' },
  completionFill: { height:'100%', backgroundColor:'#3b82f6', borderRadius:'3px', transition:'width 0.3s' },
  
  customerStats: { display:'flex', justifyContent:'space-around', padding:'10px 0' },
  custStatItem: { display:'flex', flexDirection:'column', alignItems:'center', gap:'5px' },
  custStatLabel: { fontSize:'12px', color:'#666' },
  custStatValue: { fontSize:'18px', fontWeight:'bold', color:'#374151' },
  
  staffRankList: { display:'flex', flexDirection:'column', gap:'8px' },
  staffRankItem: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 12px', backgroundColor:'#f8fafc', borderRadius:'8px' },
  staffRankInfo: { display:'flex', alignItems:'center', gap:'10px' },
  staffRankNum: { width:'24px', height:'24px', borderRadius:'50%', backgroundColor:'#3b82f6', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:'bold' },
  staffRankName: { fontWeight:'bold', fontSize:'14px' },
  staffRankStats: { display:'flex', flexDirection:'column', alignItems:'flex-end' },
  staffRankCount: { fontSize:'12px', color:'#666' },
  staffRankRevenue: { fontSize:'14px', fontWeight:'bold', color:'#059669' },
  
  chartContainer: { display:'flex', justifyContent:'space-between', alignItems:'flex-end', height:'100px', padding:'10px 0' },
  chartBar: { display:'flex', flexDirection:'column', alignItems:'center', flex:1 },
  chartBarInner: { width:'16px', height:'80px', backgroundColor:'#e5e7eb', borderRadius:'4px', display:'flex', alignItems:'flex-end' },
  chartBarFill: { width:'100%', backgroundColor:'#3b82f6', borderRadius:'4px', transition:'height 0.3s' },
  chartLabel: { fontSize:'9px', color:'#666', marginTop:'4px' },
  
  copyBtn: { padding:'6px 8px', backgroundColor:'#6366f1', color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'bold', cursor:'pointer', whiteSpace:'nowrap' },
  printBtn: { padding:'6px 8px', backgroundColor:'#059669', color:'white', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:'bold', cursor:'pointer', whiteSpace:'nowrap' }
};

// 신규영업 탭 - 별도 컴포넌트 (Hook 규칙 준수)
function SalesTab({ staffList, salesModalStaff, setSalesModalStaff }) {
  const [salesCustomers, setSalesCustomers] = useState([]);
  const [salesLoading, setSalesLoading] = useState(true);

  useEffect(() => {
    const fetchSales = async () => {
      setSalesLoading(true);
      try {
        const snap = await getDocs(collection(db, 'customers'));
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSalesCustomers(all.filter(c => c.isNew === true));
      } catch(e) { console.error('신규영업 로드 오류:', e); }
      setSalesLoading(false);
    };
    fetchSales();
  }, []);

  const handleCopy = (staffName, list) => {
    const now = new Date();
    const monthStr = `${now.getFullYear()}년 ${now.getMonth()+1}월`;
    const getPrice = (c) => c.services ? c.services.reduce((s,sv)=>s+(sv.price||0),0) : (c.price||0);
    const lines = [
      `[신규영업 실적] ${staffName} - ${monthStr}`,
      `총 ${list.length}건`,
      '─────────────────',
      ...list.map((c,i) => `${i+1}. ${c.name||c.custName}  |  ${getPrice(c).toLocaleString()}원  |  ${c.createdAt||'-'}`),
      '─────────────────',
      `합계: ${list.reduce((s,c)=>s+getPrice(c),0).toLocaleString()}원`
    ].join('\n');
    navigator.clipboard.writeText(lines).then(() => {
      Swal.fire({ icon:'success', title:'복사 완료!', timer:1200, showConfirmButton:false });
    });
  };


  const handlePrint = (staffName, list) => {
    const now = new Date();
    const monthStr = `${now.getFullYear()}년 ${now.getMonth()+1}월`;
    const getPrice = (c) => c.services ? c.services.reduce((s,sv)=>s+(sv.price||0),0) : (c.price||0);
    const total = list.reduce((s,c)=>s+getPrice(c),0);
    const rows = list.map((c,i)=>`
      <tr>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${i+1}</td>
        <td style="padding:8px;border:1px solid #ddd;">${c.name||c.custName}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${getPrice(c).toLocaleString()}원</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${c.createdAt||'-'}</td>
      </tr>`).join('');
    const win = window.open('','_blank','width=700,height=600');
    win.document.write(`<!DOCTYPE html><html><head>
      <title>신규영업 실적 - ${staffName}</title>
      <style>body{font-family:sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;}th{background:#1e40af;color:white;padding:10px;border:1px solid #ddd;}</style>
    </head><body>
      <h2 style="color:#1e40af;">🆕 신규영업 실적</h2>
      <p style="color:#666;">${staffName} | ${monthStr} | 총 ${list.length}건</p>
      <table>
        <thead><tr><th>번호</th><th>고객명</th><th>계약금액</th><th>등록일</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="2" style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">합계</td>
          <td style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right;">${total.toLocaleString()}원</td>
          <td style="padding:8px;border:1px solid #ddd;"></td>
        </tr></tfoot>
      </table>
      <script>window.onload=()=>window.print();</script>
    </body></html>`);
    win.document.close();
  };

  if (salesLoading) return <div style={{textAlign:'center',padding:'40px',color:'#666'}}>로딩 중...</div>;

  const getPrice = (c) => c.services ? c.services.reduce((s,sv)=>s+(sv.price||0),0) : (c.price||0);

  // 직원별 그룹핑
  const grouped = {};
  staffList.forEach(s => { grouped[s.name] = []; });
  salesCustomers.forEach(c => {
    const sn = c.salesStaffName || '미지정';
    if (!grouped[sn]) grouped[sn] = [];
    grouped[sn].push(c);
  });

  const entries = Object.entries(grouped).filter(([,list])=>list.length>0).sort((a,b)=>b[1].length-a[1].length);

  return (
    <div>
      <div style={{background:'#f0fdf4',padding:'14px',borderRadius:'12px',marginBottom:'16px',border:'1px solid #bbf7d0'}}>
        <div style={{fontSize:'15px',fontWeight:'bold',color:'#065f46',marginBottom:'4px'}}>🆕 신규영업 실적</div>
        <div style={{fontSize:'12px',color:'#6b7280'}}>고객등록 시 "신규 계약 고객" 체크된 건만 집계됩니다.</div>
      </div>
      {entries.length === 0 ? (
        <div style={{textAlign:'center',padding:'50px',color:'#9ca3af',fontSize:'14px'}}>
          <div style={{fontSize:'40px',marginBottom:'12px'}}>📋</div>
          신규영업 실적이 없습니다.<br/>
          <span style={{fontSize:'12px'}}>고객 등록 시 "신규 계약 고객"을 체크하면 여기에 표시됩니다.</span>
        </div>
      ) : (
        entries.map(([staffName, list]) => {
          const total = list.reduce((s,c)=>s+getPrice(c),0);
          const isExpanded = salesModalStaff === staffName;
          return (
            <div key={staffName} style={{background:'white',borderRadius:'12px',marginBottom:'10px',boxShadow:'0 2px 8px rgba(0,0,0,0.08)',overflow:'hidden'}}>
              <div
                onClick={() => setSalesModalStaff(isExpanded ? null : staffName)}
                style={{padding:'14px 16px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',borderLeft:'4px solid #10b981'}}
              >
                <div>
                  <span style={{fontSize:'15px',fontWeight:'bold',color:'#065f46'}}>{staffName}</span>
                  <span style={{marginLeft:'10px',background:'#d1fae5',color:'#065f46',fontSize:'12px',fontWeight:'bold',padding:'2px 8px',borderRadius:'20px'}}>{list.length}건</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{fontSize:'14px',fontWeight:'bold',color:'#059669'}}>{total.toLocaleString()}원</span>
                  <span style={{color:'#9ca3af',fontSize:'18px'}}>{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>
              {isExpanded && (
                <div style={{borderTop:'1px solid #f1f5f9',padding:'12px 16px'}}>
                  <div style={{display:'flex',gap:'8px',marginBottom:'12px'}}>
                    <button onClick={()=>handleCopy(staffName,list)} style={{padding:'8px 16px',background:'#3b82f6',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'bold'}}>📋 복사</button>
                    <button onClick={()=>handlePrint(staffName,list)} style={{padding:'8px 16px',background:'#8b5cf6',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'bold'}}>🖨️ 프린트</button>
                  </div>
                  {list.map((c,i) => (
                    <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #f1f5f9',fontSize:'13px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                        <span style={{color:'#9ca3af',minWidth:'20px'}}>{i+1}.</span>
                        <span style={{fontWeight:'bold',color:'#1e293b'}}>{c.name||c.custName}</span>
                        {c.address && <span style={{color:'#6b7280',fontSize:'11px'}}>📍 {c.address}</span>}
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
                        <span style={{color:'#059669',fontWeight:'bold'}}>{getPrice(c).toLocaleString()}원</span>
                        <span style={{color:'#9ca3af',fontSize:'11px'}}>{c.createdAt||''}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{textAlign:'right',marginTop:'8px',fontSize:'13px',fontWeight:'bold',color:'#065f46'}}>
                    합계: {total.toLocaleString()}원
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export default StaffManagement;
