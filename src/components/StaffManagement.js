import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db, firebaseConfig } from '../firebase';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import Swal from 'sweetalert2';

function StaffManagement({ currentUser, staffList, onStaffUpdate }) {
  const [activeTab, setActiveTab] = useState('stats'); // stats | manage | dashboard
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

  useEffect(() => {
    fetchStaffData();
  }, []);

  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStatsData();
    } else if (activeTab === 'dashboard') {
      fetchDashboardData();
    }
  }, [selectedStaff, selectedMonth, activeTab]);

  // 복사 함수
  const handleCopyStats = () => {
    const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff);
    const name = currentStaffMember?.name || selectedStaff;
    
    let text = `📊 ${name} 실적 (${selectedMonth.replace('-', '년 ')}월)\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📌 배정: ${stats.totalCount || 0}건\n`;
    text += `✅ 완료: ${stats.completedCount || 0}건 (${stats.completionRate || 0}%)\n`;
    text += `🌙 야근: ${stats.validOvertimeCount || 0}회\n`;
    text += `👥 공동작업: ${stats.coWorkCount || 0}건 / ${(stats.coWorkRevenue || 0).toLocaleString()}원\n`;
    text += `🎯 루트세일: ${stats.routeSaleCount || 0}건\n`;
    text += `💰 인센티브: ${(stats.incentiveTotal || 0).toLocaleString()}원\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `💵 월 총금액: ${(stats.monthTotal || 0).toLocaleString()}원\n`;
    text += `   (본인 ${(stats.completedRevenue || 0).toLocaleString()}원 + 공동 ${(stats.coWorkRevenue || 0).toLocaleString()}원)`;

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
            본인 ${(stats.completedRevenue || 0).toLocaleString()}원 + 공동 ${(stats.coWorkRevenue || 0).toLocaleString()}원
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
    try {
      const snap = await getDocs(collection(db, 'staff'));
      const staffData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStaff(staffData);
    } catch (error) {
      console.error('직원 데이터 조회 오류:', error);
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
      const allEvents = eventSnap.docs.map(doc => doc.data());

      const custSnap = await getDocs(collection(db, 'customers'));
      const customers = custSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 현재 직원 정보
      const currentStaffMember = staffList.find(s => s.visibleId === selectedStaff);
      const staffName = currentStaffMember?.name || '';

      // 선택한 직원의 해당 월 이벤트
      const staffEvents = allEvents.filter(e => {
        if (!e.staffId || !e.date) return false;
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

      staffEvents.forEach(e => {
        const customer = customers.find(c => c.id === e.customerCode);
        const specialPrice = (e.workType === 'special' && customer?.specialWork?.price) || 0;
        const price = (e.price || 0) + specialPrice;

        totalRevenue += price;

        if (['완료', '야근'].includes(e.status)) {
          completedRevenue += price;
          completedCount++;
        }

        if (e.status === '야근') {
          overtimeCount++;
          if (e.validOvertime) validOvertimeCount++;
        }
      });

      // 공동작업 통계 (이 직원이 공동작업자로 등록된 고객)
      const coWorkCustomers = customers.filter(c => 
        c.coWorker?.enabled && c.coWorker?.staffName === staffName
      );
      
      // 공동작업 완료 건수 (해당 월에 완료된 것)
      let coWorkCount = 0;
      let coWorkRevenue = 0;
      const coWorkList = [];
      
      coWorkCustomers.forEach(c => {
        const completedEvents = allEvents.filter(e => {
          if (e.customerCode !== c.id) return false;
          if (!['완료', '야근'].includes(e.status)) return false;
          const d = new Date(e.date);
          return d.getFullYear() === year && d.getMonth() + 1 === month;
        });
        
        if (completedEvents.length > 0) {
          coWorkCount += completedEvents.length;
          const price = c.coWorker?.price || 0;
          coWorkRevenue += price * completedEvents.length;
          coWorkList.push({
            name: c.name,
            price: price,
            count: completedEvents.length,
            completedAt: completedEvents[0].date
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

      setStats({
        totalRevenue,
        completedRevenue,
        totalCount,
        completedCount,
        overtimeCount,
        validOvertimeCount,
        completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
        // 공동작업
        coWorkCount,
        coWorkRevenue,
        coWorkList,
        // 루트세일
        routeSaleCount,
        routeSaleRevenue,
        routeSaleList,
        // 인센티브
        incentiveTotal,
        incentiveList,
        // 월 총금액 (본인 + 공동작업)
        monthTotal: completedRevenue + coWorkRevenue
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
          👤 실적
        </button>
        {isMaster && (
          <button 
            onClick={() => setActiveTab('dashboard')} 
            style={{...styles.tab, ...(activeTab === 'dashboard' ? styles.activeTab : {})}}
          >
            📊 현황
          </button>
        )}
        {isMaster && (
          <button 
            onClick={() => setActiveTab('manage')} 
            style={{...styles.tab, ...(activeTab === 'manage' ? styles.activeTab : {})}}
          >
            ⚙️ 관리
          </button>
        )}
      </div>

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

          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
            <div style={styles.staffTitle}>👤 {currentStaffMember.name} - {selectedMonth.replace('-', '년 ')}월</div>
            <div style={{display:'flex', gap:'8px'}}>
              <button onClick={() => handleCopyStats()} style={styles.copyBtn}>📋 복사</button>
              <button onClick={() => handlePrintStats()} style={styles.printBtn}>🖨️ 프린트</button>
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
                <div style={styles.statCard}>
                  <div style={styles.statLabel}>야근</div>
                  <div style={{...styles.statValue, color:'#7e22ce'}}>{stats.validOvertimeCount || 0}회</div>
                  <div style={styles.statSubValue}>총 {stats.overtimeCount || 0}회</div>
                </div>
              </div>

              {/* 공동작업 섹션 */}
              <div style={{...styles.section, backgroundColor:'#e0f2fe'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <h3 style={{...styles.sectionTitle, color:'#0369a1', margin:0}}>👥 공동작업</h3>
                  <div style={{fontWeight:'bold', color:'#0369a1'}}>
                    {stats.coWorkCount || 0}건 / {(stats.coWorkRevenue || 0).toLocaleString()}원
                  </div>
                </div>
                {stats.coWorkList && stats.coWorkList.length > 0 && (
                  <div style={{marginTop:'10px'}}>
                    {stats.coWorkList.map((cw, idx) => (
                      <div key={idx} style={{display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid #bae6fd', fontSize:'12px'}}>
                        <span>{cw.name}</span>
                        <span>{cw.price.toLocaleString()}원 × {cw.count}건</span>
                      </div>
                    ))}
                  </div>
                )}
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
                  본인 {(stats.completedRevenue || 0).toLocaleString()}원 + 공동 {(stats.coWorkRevenue || 0).toLocaleString()}원
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
    </div>
  );
}

const styles = {
  tabs: { display:'flex', gap:'5px', marginBottom:'15px' },
  tab: { flex:1, padding:'12px', border:'none', borderRadius:'8px', backgroundColor:'#e5e7eb', fontSize:'14px', fontWeight:'bold', cursor:'pointer' },
  activeTab: { backgroundColor:'#3b82f6', color:'white' },
  
  loading: { textAlign:'center', padding:'50px', color:'#666' },
  staffSelector: { display:'flex', gap:'8px', flexWrap:'wrap', marginBottom:'15px' },
  staffBtn: { padding:'10px 15px', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px' },
  monthSelector: { marginBottom:'15px' },
  monthInput: { width:'100%', padding:'12px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px', boxSizing:'border-box' },
  staffTitle: { fontSize:'18px', fontWeight:'bold', marginBottom:'15px', color:'#374151' },
  
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
  
  copyBtn: { padding:'8px 12px', backgroundColor:'#6366f1', color:'white', border:'none', borderRadius:'6px', fontSize:'12px', fontWeight:'bold', cursor:'pointer' },
  printBtn: { padding:'8px 12px', backgroundColor:'#059669', color:'white', border:'none', borderRadius:'6px', fontSize:'12px', fontWeight:'bold', cursor:'pointer' }
};

export default StaffManagement;
