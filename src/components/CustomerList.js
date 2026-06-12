import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';
import ServiceReportPage from './ServiceReportPage';
import { showCertSendPopup } from '../utils/certPdfSender';
import { useAppContext } from '../context/AppContext';
import CustomerStatusTab, { CustomerStatusSummary } from './CustomerStatusTab';
import PestMonitoringPage from './pest/PestMonitoringPage';
import { addScheduleEvent } from './scheduler/schedulerFirestore';
import CustomerTimeline from './CustomerTimeline';

// ── 결제방법 상수 ─────────────────────────────────────────────
const PAYMENT_METHODS = [
  { value: '',               label: '-',             group: 'none' },
  { value: '자동이체(통장)', label: '자동이체(통장)', group: 'auto' },
  { value: '자동이체(카드)', label: '자동이체(카드)', group: 'auto' },
  { value: '현금',           label: '현금',           group: 'manual' },
  { value: '송금',           label: '송금',           group: 'manual' },
  { value: '현장카드',       label: '현장카드',        group: 'manual' },
  { value: '기타',           label: '기타',           group: 'manual' },
];
const AUTO_METHODS = ['자동이체(통장)', '자동이체(카드)'];

function CustomerList({ currentUser, staffList, onNavigateToQuote }) {
  const { settings } = useAppContext();
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('active'); // 기본: 정상
  const [sortBy, setSortBy] = useState('code-asc'); // 기본: 코드↑
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20); // 한 페이지에 20명
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'payment' (수금관리)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [paymentViewMode, setPaymentViewMode] = useState('card'); // 'card' | 'month'
  const [selectedPayMonth, setSelectedPayMonth] = useState(new Date().getMonth() + 1);
  const [dashOpen, setDashOpen] = useState(false);
  const [dashDetail, setDashDetail] = useState(null); // 대시보드 상세 필터
  const [importLoading, setImportLoading] = useState(false); // 엑셀 업로드 중
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // AppContext에서 settings 가져오기 (Firestore 중복 fetch 방지)
  const priceStep = settings.priceStep || 1000;
  const equipmentList = settings.equipmentList || [];
  const apiKey = settings.anthropicApiKey || '';
  // [ADD] SweetAlert2 인라인 스크립트에서 API 키 접근용 window 변수
  React.useEffect(() => { window._wlAnthropicKey = apiKey; }, [apiKey]);
  const [statusModalCustomer, setStatusModalCustomer] = React.useState(null);
  const [appointmentCustomer, setAppointmentCustomer] = React.useState(null);
  const [timelineCustomer, setTimelineCustomer] = React.useState(null);
  const [statsOpen, setStatsOpen] = React.useState(false); // 통계 접기/펼치기
  const [profitCustomer, setProfitCustomer] = React.useState(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // 배정플랜에서 현황탭 바로 열기용 전역 함수
  useEffect(() => {
    window.__openCustomerStatus = (customerId) => {
      const cust = customers.find(c => c.id === customerId || c.code === customerId);
      if (cust) setStatusModalCustomer(cust);
    };
    return () => { delete window.__openCustomerStatus; };
  }, [customers]);

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

  const parsePrice = (val) => {
    if (!val) return 0;
    return Number(String(val).replace(/[,원\s]/g, '')) || 0;
  };

  const parseContractStatus = (contractPeriod) => {
    if (!contractPeriod) return '정상';
    try {
      const parts = contractPeriod.split('-');
      if (parts.length < 2) return '정상';
      const endDateStr = parts[parts.length - 1].trim();
      const dateParts = endDateStr.split('.');
      if (dateParts.length < 3) return '정상';
      const year = parseInt(dateParts[0]);
      const month = parseInt(dateParts[1]) - 1;
      const day = parseInt(dateParts[2]);
      const endDate = new Date(year, month, day);
      if (endDate < new Date()) return '해약';
      return '정상';
    } catch (e) {
      return '정상';
    }
  };

  // 컬럼명 정규화 (공백, 특수문자 제거)
  const normalizeHeader = (str) => {
    if (!str) return '';
    return String(str).replace(/[\s\n\r\t·．.]/g, '').toLowerCase();
  };

  // 컬럼 인덱스 찾기 (유연한 매핑)
  const findColumnIndex = (headers, excludeKeywords = [], ...keywords) => {
    for (let i = 0; i < headers.length; i++) {
      const normalized = normalizeHeader(headers[i]);
      
      // 제외할 키워드가 포함되어 있으면 건너뛰기
      let shouldExclude = false;
      for (const exclude of excludeKeywords) {
        if (normalized.includes(normalizeHeader(exclude))) {
          shouldExclude = true;
          break;
        }
      }
      if (shouldExclude) continue;
      
      for (const keyword of keywords) {
        if (normalized.includes(normalizeHeader(keyword))) {
          return i;
        }
      }
    }
    return -1;
  };

  const handleExcelUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const result = await Swal.fire({
      title: '엑셀 업로드',
      text: '고객 데이터를 업로드하시겠습니까?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: '업로드',
      cancelButtonText: '취소'
    });

    if (!result.isConfirmed) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        let successCount = 0;
        let skipCount = 0;

        // 헤더 행 찾기
        let headerRow = 0;
        let headers = [];
        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const row = jsonData[i];
          if (row && row.some(cell => {
            const n = normalizeHeader(cell);
            return n.includes('고객코드') || n.includes('고객명') || n.includes('거래처');
          })) {
            headerRow = i;
            headers = row;
            break;
          }
        }

        // 컬럼 인덱스 매핑 (유연하게)
        // findColumnIndex(headers, 제외키워드[], ...검색키워드)
        const colIdx = {
          code: findColumnIndex(headers, [], '고객코드', '코드', '거래처코드'),
          name: findColumnIndex(headers, [], '고객명', '거래처명', '상호'),
          contract: findColumnIndex(headers, [], '계약기간', '계약'),
          payment: findColumnIndex(headers, [], '수금방법', '수금', '결제'),
          phone: findColumnIndex(headers, [], '연락처', '전화', '핸드폰', 'TEL'),
          area: findColumnIndex(headers, [], '평수', '면적'),
          serviceType: findColumnIndex(headers, [], '서비스종류', '서비스', '품목'),
          price: findColumnIndex(headers, [], '방제대금', '대금', '금액', '단가'),
          winterPrice: findColumnIndex(headers, [], '동절기', '겨울'),
          serviceMonth: findColumnIndex(headers, [], '서비스월', '작업월'),
          ceo: findColumnIndex(headers, [], '대표자명', '대표자', '대표'),
          bizNum: findColumnIndex(headers, [], '사업자번호', '사업자'),
          email: findColumnIndex(headers, [], '메일', '이메일', 'email', '메일주소', '이메일주소'),
          address: findColumnIndex(headers, ['메일', '이메일'], '주소', '주 소', 'address'),  // 이메일주소 제외!
          zipCode: findColumnIndex(headers, [], '우편번호', '우편'),
          memo: findColumnIndex(headers, [], '비고', '메모', '참고')
        };

        console.log('📋 컬럼 매핑:', colIdx);

        let i = headerRow + 1;
        while (i < jsonData.length) {
          const row = jsonData[i];
          if (!row || row.length < 2) { skipCount++; i++; continue; }

          const code = colIdx.code >= 0 ? row[colIdx.code] : row[0];
          const name = colIdx.name >= 0 ? row[colIdx.name] : row[1];

          if (!name || String(name).trim() === '' || 
              String(name).includes('고객명') || 
              String(name).includes('매출월')) {
            skipCount++; i++; continue;
          }

          let services = [];
          const mainServiceType = String(colIdx.serviceType >= 0 ? (row[colIdx.serviceType] || '') : (row[6] || '')).replace(/\n/g, '/');
          const mainPrice = parsePrice(colIdx.price >= 0 ? row[colIdx.price] : row[7]);
          const mainServiceMonth = String(colIdx.serviceMonth >= 0 ? (row[colIdx.serviceMonth] || '') : (row[9] || ''));
          
          if (mainServiceType || mainPrice > 0) {
            services.push({ type: mainServiceType || '일반', price: mainPrice, months: mainServiceMonth });
          }

          let nextIdx = i + 1;
          while (nextIdx < jsonData.length) {
            const nextRow = jsonData[nextIdx];
            const nextName = colIdx.name >= 0 ? nextRow?.[colIdx.name] : nextRow?.[1];
            const nextServiceType = colIdx.serviceType >= 0 ? nextRow?.[colIdx.serviceType] : nextRow?.[6];
            const nextPrice = colIdx.price >= 0 ? nextRow?.[colIdx.price] : nextRow?.[7];
            
            if (nextRow && !nextName && (nextServiceType || nextPrice)) {
              const extraServiceType = String(nextServiceType || '');
              const extraPrice = parsePrice(nextPrice);
              const extraMonths = String(colIdx.serviceMonth >= 0 ? (nextRow[colIdx.serviceMonth] || '') : (nextRow[9] || ''));
              if (extraServiceType || extraPrice > 0) {
                services.push({ type: extraServiceType || '추가', price: extraPrice, months: extraMonths });
              }
              nextIdx++;
            } else {
              break;
            }
          }

          const contractPeriod = String(colIdx.contract >= 0 ? (row[colIdx.contract] || '') : (row[2] || ''));
          const status = parseContractStatus(contractPeriod);

          const customerData = {
            code: String(code || ''),
            name: String(name).trim(),
            contractPeriod: contractPeriod,
            paymentMethod: String(colIdx.payment >= 0 ? (row[colIdx.payment] || '') : (row[3] || '')),
            phone: String(colIdx.phone >= 0 ? (row[colIdx.phone] || '') : (row[4] || '')).replace(/\n/g, ' / '),
            area: String(colIdx.area >= 0 ? (row[colIdx.area] || '') : (row[5] || '')),
            services: services,
            winterPrice: parsePrice(colIdx.winterPrice >= 0 ? row[colIdx.winterPrice] : row[8]),
            ceoName: String(colIdx.ceo >= 0 ? (row[colIdx.ceo] || '') : (row[10] || '')),
            businessNumber: String(colIdx.bizNum >= 0 ? (row[colIdx.bizNum] || '') : (row[11] || '')),
            email: String(colIdx.email >= 0 ? (row[colIdx.email] || '') : (row[12] || '')),
            address: String(colIdx.address >= 0 ? (row[colIdx.address] || '') : (row[13] || '')),
            zipCode: String(colIdx.zipCode >= 0 ? (row[colIdx.zipCode] || '') : (row[14] || '')),
            memo: String(colIdx.memo >= 0 ? (row[colIdx.memo] || '') : (row[15] || '')),
            status: status,
            custStatus: status,
            workMonths: [1,2,3,4,5,6,7,8,9,10,11,12],
            tags: [],
            staffId: '',
            staffName: '',
            unpaid: 0,
            claim: '',
            coWorkers: [],
            specialWork: null,
            routeSale: { enabled: false },
            createdAt: new Date().toISOString().split('T')[0]
          };

          try {
            await addDoc(collection(db, 'customers'), customerData);
            successCount++;
          } catch (err) {
            console.error('저장 오류:', err);
          }

          i = nextIdx;
        }

        Swal.fire('완료', `${successCount}명 등록!\n(${skipCount}개 건너뜀)`, 'success');
        fetchData();
        e.target.value = '';
      } catch (error) {
        console.error('엑셀 오류:', error);
        Swal.fire('오류', '엑셀 파일 처리 중 오류 발생', 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  const exportToExcel = () => {
    const exportData = customers.map(c => ({
      '고객코드': c.code,
      '고객명': c.name,
      '연락처': c.phone,
      '주소': c.address,
      '금액': getTotalPrice(c),
      '담당자': c.staffName,
      '상태': c.custStatus || c.status
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '고객목록');
    XLSX.writeFile(wb, `고객목록_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDetail = async (customer) => {
    // 기존 coWorker(단일)를 coWorkers(배열)로 변환 (호환성)
    let coWorkersArray = customer.coWorkers || [];
    if (coWorkersArray.length === 0 && customer.coWorker && customer.coWorker.enabled && customer.coWorker.staffName) {
      coWorkersArray = [{ staffName: customer.coWorker.staffName, price: customer.coWorker.price || 0 }];
    }
    
    const staffOptions = staffList.map(s => 
      `<option value="${s.name}" ${customer.staffName === s.name ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    // 루트세일 영업직원 옵션
    const routeSaleOptions = staffList.map(s => 
      `<option value="${s.name}" ${customer.routeSale?.staffName === s.name ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    // 해약된 고객인지 확인 (먼저 정의)
    const isCancelled = customer.custStatus === '해약';
    // 직원도 수정 불가 (조회만)
    const isReadOnly = isCancelled || currentUser.role !== 'master';
    const readonlyAttr = isReadOnly ? 'readonly disabled' : '';
    const disabledStyle = isReadOnly ? 'background:#f1f5f9;color:#64748b;' : '';

    // 작업월 데이터 변환 (기존 배열 → 새 객체 구조)
    let workMonthsData = customer.workMonthsData || {};
    
    // 기존 배열 형식이면 변환
    if (Array.isArray(customer.workMonths)) {
      customer.workMonths.forEach(m => {
        if (!workMonthsData[m]) {
          workMonthsData[m] = { enabled: true, count: 1, prices: [0] };
        }
      });
      // 나머지 월은 비활성화
      for (let i = 1; i <= 12; i++) {
        if (!workMonthsData[i]) {
          workMonthsData[i] = { enabled: customer.workMonths.includes(i), count: 1, prices: [0] };
        }
      }
    } else {
      // 기본값: 모든 월 활성화, 1회, 기본금액
      for (let i = 1; i <= 12; i++) {
        if (!workMonthsData[i]) {
          workMonthsData[i] = { enabled: true, count: 1, prices: [0] };
        }
      }
    }

    // 동절기 설정 (기본값 true)
    const winterEnabled = customer.winterEnabled !== false;
    const winterPrice = customer.winterPrice || 0;
    const basePrice = getTotalPrice(customer);

    // 작업월 탭 HTML 생성
    const winterMonths = [1, 2, 3, 12];
    let workMonthsHtml = '';
    for (let m = 1; m <= 12; m++) {
      const monthData = workMonthsData[m] || { enabled: true, count: 1, prices: [0], charged: [true] };
      const isWinter = winterMonths.includes(m);
      
      // 회차별 금액부과 토글 + 금액 입력 칸
      let pricesHtml = '';
      const count = monthData.count || 1;
      const chargedArr = monthData.charged || [];
      for (let c = 0; c < count; c++) {
        const price = (monthData.prices && monthData.prices[c]) || 0;
        const isCharged = chargedArr[c] !== false; // 기본값 true
        pricesHtml += `
          <div style="display:flex;align-items:center;gap:4px;background:${isCharged ? '#f0fdf4' : '#f8fafc'};padding:4px 8px;border-radius:8px;border:2px solid ${isCharged ? '#22c55e' : '#d1d5db'};min-height:36px;" id="price-box-${m}-${c}">
            <button type="button"
              class="charge-toggle-btn"
              data-month="${m}" data-idx="${c}"
              data-charged="${isCharged ? '1' : '0'}"
              ${isReadOnly ? 'disabled' : `onclick="window.toggleCharge('${m}','${c}')"`}
              style="padding:2px 7px;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;white-space:nowrap;background:${isCharged ? '#22c55e' : '#e5e7eb'};color:${isCharged ? '#fff' : '#9ca3af'};">
              ${isCharged ? '💰청구' : '🚫무료'}
            </button>
            <input type="number" class="month-price-input" data-month="${m}" data-idx="${c}" value="${price}" placeholder="0" step="${priceStep}" style="width:90px;padding:5px;font-size:12px;border:none;background:transparent;" ${isReadOnly ? 'disabled' : ''}>
            <input type="hidden" class="month-charged-check" data-month="${m}" data-idx="${c}" value="${isCharged ? '1' : '0'}">
          </div>`;
      }

      workMonthsHtml += `
        <div class="work-month-row" data-month="${m}" style="display:flex;align-items:center;gap:8px;padding:10px;margin-bottom:6px;background:${isWinter ? '#e0f2fe' : '#f8fafc'};border-radius:8px;border-left:4px solid ${isWinter ? '#0ea5e9' : '#94a3b8'};flex-wrap:wrap;">
          <label style="display:flex;align-items:center;min-width:80px;cursor:pointer;padding:6px 8px;background:${monthData.enabled ? '#22c55e' : '#e5e7eb'};border-radius:6px;transition:all 0.2s;">
            <input type="checkbox" class="work-month-check" data-month="${m}" ${monthData.enabled ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} style="width:18px;height:18px;margin-right:6px;accent-color:#22c55e;" onchange="this.parentElement.style.background=this.checked?'#22c55e':'#e5e7eb';this.parentElement.querySelector('span').style.color=this.checked?'white':'#374151';">
            <span style="font-size:13px;font-weight:bold;color:${monthData.enabled ? 'white' : '#374151'};">${m}월${isWinter ? '❄️' : ''}</span>
          </label>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:11px;color:#666;">횟수</span>
            <input type="number" class="month-count-input" data-month="${m}" value="${count}" min="1" max="20" style="width:44px;"padding:6px;font-size:12px;border:1px solid #ddd;border-radius:6px;" ${isReadOnly ? 'disabled' : ''} onchange="window.updateMonthPrices(${m}, this.value)">
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex:1;flex-wrap:wrap;">
            <span style="font-size:11px;color:#22c55e;font-weight:bold;">💰</span>
            <div class="month-prices-container" data-month="${m}" style="display:flex;flex-wrap:wrap;gap:4px;">
              ${pricesHtml}
            </div>
          </div>
        </div>
      `;
    }

    // 태그 체크박스
    let currentTags = customer.tags;
    if (!Array.isArray(currentTags)) {
      currentTags = [];
    }
    const tagOptions = ['클레임', '신규작업', '고객상담', '추가작업'];
    let tagHtml = tagOptions.map(t => 
      `<label style="margin-right:10px;"><input type="checkbox" class="tag-check" value="${t}" ${currentTags.includes(t) ? 'checked' : ''}> ${t}</label>`
    ).join('');

    // 서비스 내역
    let servicesHtml = '';
    const serviceCount = customer.services ? customer.services.length : 1;
    if (customer.services && customer.services.length > 0) {
      servicesHtml = customer.services.map((s, idx) => `
        <div style="display:flex;gap:5px;margin-bottom:5px;">
          <input id="swal-svc-type-${idx}" class="swal2-input" value="${s.type || ''}" placeholder="서비스종류" style="flex:2;margin:0;font-size:12px;padding:6px;">
          <input id="swal-svc-price-${idx}" class="swal2-input" type="number" value="${s.price || 0}" placeholder="금액" style="flex:1;margin:0;font-size:12px;padding:6px;">
          <input id="swal-svc-months-${idx}" class="swal2-input" value="${s.months || ''}" placeholder="적용월" style="flex:1;margin:0;font-size:12px;padding:6px;">
        </div>
      `).join('');
    } else {
      servicesHtml = `
        <div style="display:flex;gap:5px;margin-bottom:5px;">
          <input id="swal-svc-type-0" class="swal2-input" value="" placeholder="서비스종류" style="flex:2;margin:0;font-size:12px;padding:6px;">
          <input id="swal-svc-price-0" class="swal2-input" type="number" value="${customer.price || 0}" placeholder="금액" style="flex:1;margin:0;font-size:12px;padding:6px;">
          <input id="swal-svc-months-0" class="swal2-input" value="" placeholder="적용월" style="flex:1;margin:0;font-size:12px;padding:6px;">
        </div>
      `;
    }

    // 설치장비 데이터 준비
    const equipment = customer.equipment || {};
    const equipmentEnabled = equipment.enabled || false;
    const equipmentName = equipment.equipmentName || '';
    const equipmentCount = equipment.count || 1;
    const equipmentPricePerUnit = equipment.pricePerUnit || 0;
    const equipmentMonths = equipment.months || [1,2,3,4,5,6,7,8,9,10,11,12];
    
    // 장비 옵션 HTML
    const equipmentOptions = equipmentList.map(eq => 
      `<option value="${eq.id}" data-name="${eq.name}" data-price="${eq.defaultPrice}" ${equipment.equipmentId === eq.id ? 'selected' : ''}>${eq.name}</option>`
    ).join('');

    // 설치장비 월별 체크 HTML
    const equipmentMonthsHtml = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => `
      <label style="display:inline-flex;align-items:center;width:48px;margin:2px;padding:4px 6px;background:${equipmentMonths.includes(m) ? '#3b82f6' : '#e5e7eb'};color:${equipmentMonths.includes(m) ? 'white' : '#374151'};border-radius:4px;font-size:10px;cursor:pointer;">
        <input type="checkbox" class="eq-month-check" value="${m}" ${equipmentMonths.includes(m) ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} style="display:none;"
          onchange="this.parentElement.style.background=this.checked?'#3b82f6':'#e5e7eb';this.parentElement.style.color=this.checked?'white':'#374151';window.updateEquipmentTotal();">
        ${m}월
      </label>
    `).join('');

    // 상태 버튼 (관리자만)
    let statusBtns = '';
    if (currentUser.role === 'master') {
      if (customer.custStatus === '해약') {
        statusBtns = `<button onclick="window.openRecontract('${customer.id}')" style="width:100%;padding:10px;background:#22c55e;color:white;border:none;margin-top:5px;border-radius:5px;">🔄 재계약</button>`;
      } else if (customer.custStatus !== '삭제') {
        statusBtns = `<button onclick="window.openCancel('${customer.id}')" style="width:100%;padding:10px;background:#ef4444;color:white;border:none;margin-top:5px;border-radius:5px;">🚫 해약</button>`;
      }
      if (customer.custStatus !== '삭제') {
        statusBtns += `<button onclick="window.softDelete('${customer.id}')" style="width:100%;padding:10px;background:#64748b;color:white;border:none;margin-top:5px;border-radius:5px;">🗑️ 삭제</button>`;
      }
    }

    // ===== 1회성 담당 데이터 준비 =====
    const onetimeStaff = customer.onetimeStaff || {};
    const staffSelectOpts = staffList.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    
    // 현재 등록된 1회성 담당 목록 HTML
    const buildOnetimeListHtml = (data) => {
      const entries = Object.entries(data).sort((a,b) => a[0].localeCompare(b[0]));
      if (entries.length === 0) return '<div style="color:#9ca3af;font-size:12px;padding:6px 0;">등록된 1회성 담당이 없습니다.</div>';
      return entries.map(([ym, name]) => {
        const [y, m] = ym.split('-');
        return `<div id="onetime-item-${ym}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#f0fdf4;border-radius:6px;margin-bottom:4px;border:1px solid #bbf7d0;">
          <span style="font-size:13px;"><b>${y}년 ${parseInt(m)}월</b> → <span style="color:#059669;font-weight:bold;">${name}</span></span>
          ${!isReadOnly ? `<button type="button" onclick="window.removeOnetimeStaff('${ym}')" style="background:#ef4444;color:white;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">✕</button>` : ''}
        </div>`;
      }).join('');
    };
    window.__onetimeStaffData = { ...onetimeStaff }; // 팝업 내에서 수정용 전역 임시 저장

    const { value: formValues, isDenied } = await Swal.fire({
      title: `${customer.name} ${isCancelled ? '(해약)' : ''}`,
      html: `
        ${isCancelled ? '<div style="background:#fee2e2;color:#dc2626;padding:8px;border-radius:6px;margin-bottom:10px;font-size:12px;">🔒 해약된 고객은 수정할 수 없습니다. 재계약 시 새 코드가 발급됩니다.</div>' : ''}
        ${!isCancelled && currentUser.role !== 'master' ? '<div style="background:#dbeafe;color:#1d4ed8;padding:8px;border-radius:6px;margin-bottom:10px;font-size:12px;">👁️ 조회만 가능합니다. 수정은 관리자에게 문의하세요.</div>' : ''}
        <div style="text-align:left;max-height:450px;overflow-y:auto;font-size:13px;">
          <!-- 탭 버튼 -->
          <div style="display:flex;gap:4px;margin-bottom:10px;border-bottom:2px solid #e5e7eb;padding-bottom:10px;">
            <button type="button" class="tab-btn active" onclick="window.switchTab('basic', this)" style="flex:1;padding:7px 4px;border:none;border-radius:6px;cursor:pointer;font-size:10px;background:#3b82f6;color:white;">📋기본</button>
            <button type="button" class="tab-btn" onclick="window.switchTab('workmonth', this)" style="flex:1;padding:7px 4px;border:none;border-radius:6px;cursor:pointer;font-size:10px;background:#e5e7eb;">📅작업</button>
            <button type="button" class="tab-btn" onclick="window.switchTab('contract', this)" style="flex:1;padding:7px 4px;border:none;border-radius:6px;cursor:pointer;font-size:10px;background:#e5e7eb;">📑계약</button>
            <button type="button" class="tab-btn" onclick="window.switchTab('business', this)" style="flex:1;padding:7px 4px;border:none;border-radius:6px;cursor:pointer;font-size:10px;background:#e5e7eb;">🏢사업자</button>
            <button type="button" class="tab-btn" onclick="window.switchTab('extra', this)" style="flex:1;padding:7px 4px;border:none;border-radius:6px;cursor:pointer;font-size:10px;background:#e5e7eb;">⚙️기타</button>
            <button type="button" class="tab-btn" onclick="window.switchTab('status', this)" style="flex:1;padding:7px 4px;border:none;border-radius:6px;cursor:pointer;font-size:10px;background:#e5e7eb;">🔍현황</button>
          </div>

          <!-- 기본정보 탭 -->
          <div id="tab-basic" class="tab-content">
            <div style="display:flex;gap:10px;margin-bottom:8px;">
              <div style="flex:1;"><label style="font-size:11px;color:#666;">고객코드 🔒</label>
                <input id="swal-code" class="swal2-input" value="${customer.code || ''}" readonly style="margin:3px 0;font-size:13px;background:#f1f5f9;color:#64748b;"></div>
              <div style="flex:2;"><label style="font-size:11px;color:#666;">고객명</label>
                <input id="swal-name" class="swal2-input" value="${customer.name || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
            </div>
            <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">연락처</label>
              <input id="swal-phone" class="swal2-input" value="${customer.phone || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
            <div style="display:flex;gap:10px;margin-bottom:8px;">
              <div style="flex:3;"><label style="font-size:11px;color:#666;">주소</label>
                <input id="swal-address" class="swal2-input" value="${customer.address || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
              <div style="flex:1;"><label style="font-size:11px;color:#666;">우편번호</label>
                <input id="swal-zipcode" class="swal2-input" value="${customer.zipCode || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
            </div>
            
            <div style="display:flex;gap:10px;margin-bottom:8px;">
              <div style="flex:1;"><label style="font-size:11px;color:#666;">기본 담당자</label>
                <select id="swal-staff" class="swal2-select" ${isReadOnly ? 'disabled' : ''} style="width:100%;padding:8px;margin:3px 0;font-size:13px;${disabledStyle}">
                  <option value="">-- 선택 --</option>${staffOptions}</select></div>
              <div style="flex:1;"><label style="font-size:11px;color:#666;">상태</label>
                <input class="swal2-input" value="${customer.custStatus || '정상'}" readonly style="margin:3px 0;font-size:13px;background:#f1f5f9;"></div>
            </div>

            <!-- 1회성 담당 섹션 -->
            ${!isReadOnly ? `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:10px;">
              <div style="font-size:12px;font-weight:bold;color:#1e40af;margin-bottom:8px;">🔁 1회성 담당 설정</div>
              <div style="font-size:11px;color:#6b7280;margin-bottom:8px;">특정 월만 다른 직원이 담당할 때 사용. 해당 월이 지나면 기본 담당자로 자동 복귀됩니다.</div>
              <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
                <input type="month" id="onetime-month-input" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                <select id="onetime-staff-select" style="flex:1;padding:7px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                  <option value="">직원 선택</option>${staffSelectOpts}
                </select>
                <button type="button" id="onetime-add-btn" style="padding:7px 12px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;font-weight:bold;">+ 추가</button>
              </div>
              <div id="onetime-list-container">${buildOnetimeListHtml(onetimeStaff)}</div>
            </div>
            ` : `
            ${Object.keys(onetimeStaff).length > 0 ? `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;margin-bottom:10px;">
              <div style="font-size:12px;font-weight:bold;color:#1e40af;margin-bottom:8px;">🔁 1회성 담당</div>
              <div id="onetime-list-container">${buildOnetimeListHtml(onetimeStaff)}</div>
            </div>` : ''}
            `}

            <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">🏷️ 태그</label>
              <div style="margin-top:5px;font-size:12px;">${tagHtml}</div>
            </div>
          </div>

          <!-- 작업월 탭 (새로 추가) -->
          <div id="tab-workmonth" class="tab-content" style="display:none;">
            <!-- 동절기 설정 -->
            <div style="background:#e0f2fe;padding:14px;border-radius:10px;margin-bottom:14px;border:1px solid #7dd3fc;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <label style="font-size:13px;color:#0369a1;font-weight:bold;">❄️ 동절기 적용 (1,2,3,12월)</label>
                <label class="mobile-toggle" style="position:relative;display:inline-block;width:50px;height:28px;">
                  <input type="checkbox" id="swal-winter-toggle" ${winterEnabled ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} style="opacity:0;width:0;height:0;" onchange="this.nextElementSibling.style.backgroundColor=this.checked?'#0ea5e9':'#ccc'">
                  <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${winterEnabled ? '#0ea5e9' : '#ccc'};transition:.3s;border-radius:28px;"></span>
                </label>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#666;">동절기 금액:</span>
                <input type="number" id="swal-winter-price" value="${winterPrice}" step="${priceStep}" ${isReadOnly ? 'disabled' : ''} style="width:110px;padding:8px;font-size:14px;border:1px solid #7dd3fc;border-radius:6px;">
                <span style="font-size:12px;color:#666;">원</span>
                <span style="font-size:11px;color:#0369a1;margin-left:auto;">기본: ${basePrice.toLocaleString()}원</span>
              </div>
              <p style="font-size:11px;color:#666;margin:10px 0 0;">※ 동절기 적용 시 1,2,3,12월은 동절기 금액 적용</p>
            </div>
            
            <!-- 일괄 설정 -->
            <div style="background:#fef3c7;padding:12px;border-radius:10px;margin-bottom:14px;border:1px solid #fcd34d;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#92400e;font-weight:bold;">⚡ 일괄:</span>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-size:11px;color:#666;">횟수</span>
                  <input type="number" id="swal-bulk-count" value="1" min="1" max="20" ${isReadOnly ? 'disabled' : ''} style="width:50px;padding:6px;font-size:13px;border:1px solid #fcd34d;border-radius:6px;">
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span style="font-size:11px;color:#666;">금액</span>
                  <input type="number" id="swal-bulk-price" value="0" step="${priceStep}" ${isReadOnly ? 'disabled' : ''} style="width:80px;padding:6px;font-size:13px;border:1px solid #fcd34d;border-radius:6px;" placeholder="0">
                </div>
                <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#22c55e;padding:6px;">
                  <input type="checkbox" id="swal-bulk-charged" checked ${isReadOnly ? 'disabled' : ''} style="width:20px;height:20px;">
                  💰부과
                </label>
              </div>
              <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                <button type="button" onclick="window.applyBulkSettings()" ${isReadOnly ? 'disabled' : ''} style="padding:8px 14px;background:#f59e0b;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;min-height:36px;">전체적용</button>
                <button type="button" onclick="window.toggleAllMonths(true)" ${isReadOnly ? 'disabled' : ''} style="padding:8px 12px;background:#22c55e;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;min-height:36px;">월 전체ON</button>
                <button type="button" onclick="window.toggleAllMonths(false)" ${isReadOnly ? 'disabled' : ''} style="padding:8px 12px;background:#64748b;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;min-height:36px;">월 전체OFF</button>
              </div>
              <p style="font-size:10px;color:#92400e;margin:8px 0 0;">💰체크=청구 / 체크해제=무료 | 증감: ${priceStep.toLocaleString()}원</p>
            </div>
            
            <!-- 금액 나누기 설정 -->
            <div style="background:#e0f2fe;padding:12px;border-radius:10px;margin-bottom:14px;border:1px solid #7dd3fc;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <label style="font-size:13px;color:#0369a1;font-weight:bold;">➗ 금액 나누기</label>
                  <p style="font-size:10px;color:#0369a1;margin:4px 0 0;">ON: 월 금액 ÷ 횟수 | OFF: 횟수당 금액</p>
                </div>
                <label style="position:relative;display:inline-block;width:50px;height:28px;">
                  <input type="checkbox" id="swal-split-price" ${customer.splitPrice ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} style="opacity:0;width:0;height:0;">
                  <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.splitPrice ? '#3b82f6' : '#ccc'};transition:.3s;border-radius:28px;"></span>
                  <span style="position:absolute;content:'';height:20px;width:20px;left:4px;bottom:4px;background-color:white;transition:.3s;border-radius:50%;${customer.splitPrice ? 'transform:translateX(22px);' : ''}"></span>
                </label>
              </div>
              <div style="margin-top:8px;padding:8px;background:#fff;border-radius:6px;font-size:11px;color:#666;">
                <div id="split-price-preview">
                  ${customer.splitPrice 
                    ? '예: 50,000원 ÷ 2회 = <b>25,000원</b>/회' 
                    : '예: 50,000원 × 2회 = <b>100,000원</b>/월'}
                </div>
              </div>
            </div>
            
            <!-- 월별 작업 설정 -->
            <div style="background:#f8fafc;padding:12px;border-radius:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <label style="font-size:13px;color:#374151;font-weight:bold;">📅 월별 작업 & 💰금액부과</label>
                <span style="font-size:10px;color:#666;">✓=청구</span>
              </div>
              <div style="max-height:280px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
                ${workMonthsHtml}
              </div>
            </div>
          </div>

          <!-- 계약정보 탭 -->
          <div id="tab-contract" class="tab-content" style="display:none;">
            <div style="display:flex;gap:10px;margin-bottom:8px;">
              <div style="flex:1;"><label style="font-size:11px;color:#666;">계약기간</label>
                <input id="swal-contract" class="swal2-input" value="${customer.contractPeriod || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
              <div style="flex:1;"><label style="font-size:11px;color:#666;">수금방법</label>
                ${isReadOnly
                  ? `<input class="swal2-input" value="${customer.paymentMethod || ''}" readonly style="margin:3px 0;font-size:13px;${disabledStyle}">`
                  : `<select id="swal-payment" style="width:100%;padding:7px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin:3px 0;" onchange="
                      const v=this.value;
                      const pd=document.getElementById('swal-payment-day-wrap');
                      if(pd){ pd.style.display=(v==='자동이체(통장)'||v==='자동이체(카드)') ? 'block':'none'; }
                    ">
                    <option value="">-</option>
                    <option value="자동이체(통장)" ${customer.paymentMethod==='자동이체(통장)'?'selected':''}>자동이체(통장)</option>
                    <option value="자동이체(카드)" ${customer.paymentMethod==='자동이체(카드)'?'selected':''}>자동이체(카드)</option>
                    <option value="현금" ${customer.paymentMethod==='현금'?'selected':''}>현금</option>
                    <option value="송금" ${customer.paymentMethod==='송금'?'selected':''}>송금</option>
                    <option value="현장카드" ${customer.paymentMethod==='현장카드'?'selected':''}>현장카드</option>
                    <option value="기타" ${customer.paymentMethod==='기타'?'selected':''}>기타</option>
                  </select>`
                }
                <div id="swal-payment-day-wrap" style="display:${(customer.paymentMethod==='자동이체(통장)'||customer.paymentMethod==='자동이체(카드)')&&!isReadOnly?'block':'none'};margin-top:4px;">
                  <label style="font-size:10px;color:#6b7280;">이체일</label>
                  <div style="display:flex;align-items:center;gap:4px;">
                    <input id="swal-payment-day" type="number" min="1" max="31"
                      value="${customer.paymentDay || ''}"
                      placeholder="예) 25"
                      style="width:70px;padding:5px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
                    <span style="font-size:12px;color:#6b7280;">일</span>
                  </div>
                </div>
              </div>
            </div>
            <div style="margin-bottom:8px;">
              <label style="font-size:11px;color:#666;">평수</label>
              <input id="swal-area" class="swal2-input" value="${customer.area || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}">
            </div>
            
            <div style="margin-bottom:8px;background:#f8f9fa;padding:10px;border-radius:8px;">
              <label style="font-size:11px;color:#666;font-weight:bold;">💰 서비스 내역</label>
              <div id="services-container">${servicesHtml}</div>
            </div>
            
            <!-- 설치장비 -->
            <div style="margin-bottom:8px;background:#ecfdf5;padding:10px;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <label style="font-size:12px;color:#059669;font-weight:bold;">🔧 설치장비</label>
                ${!isReadOnly ? `<label class="toggle-switch" style="position:relative;display:inline-block;width:44px;height:24px;">
                  <input type="checkbox" id="swal-equipment-toggle" ${equipmentEnabled ? 'checked' : ''} onchange="
                    document.getElementById('equipment-detail').style.display = this.checked ? 'block' : 'none';
                    this.nextElementSibling.style.backgroundColor = this.checked ? '#10b981' : '#ccc';
                    window.updateEquipmentTotal();
                  " style="opacity:0;width:0;height:0;">
                  <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${equipmentEnabled ? '#10b981' : '#ccc'};transition:.3s;border-radius:24px;"></span>
                </label>` : `<span style="font-size:11px;color:#666;">${equipmentEnabled ? '활성' : '비활성'}</span>`}
              </div>
              <div id="equipment-detail" style="display:${equipmentEnabled ? 'block' : 'none'};">
                <div style="display:flex;gap:5px;margin-bottom:8px;">
                  <div style="flex:2;">
                    <label style="font-size:10px;color:#666;">장비</label>
                    <select id="swal-equipment-name" ${isReadOnly ? 'disabled' : ''} onchange="window.onEquipmentSelect(this)" style="width:100%;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;${disabledStyle}">
                      <option value="">-- 선택 --</option>
                      ${equipmentOptions}
                      <option value="custom" ${equipmentName && !equipmentList.find(e => e.id === equipment.equipmentId) ? 'selected' : ''}>직접입력</option>
                    </select>
                    <input id="swal-equipment-custom-name" type="text" placeholder="장비명 직접입력" value="${equipmentName && !equipmentList.find(e => e.id === equipment.equipmentId) ? equipmentName : ''}" 
                      style="display:${equipmentName && !equipmentList.find(e => e.id === equipment.equipmentId) ? 'block' : 'none'};width:100%;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;margin-top:4px;box-sizing:border-box;" ${isReadOnly ? 'readonly' : ''}>
                  </div>
                  <div style="flex:1;">
                    <label style="font-size:10px;color:#666;">대수</label>
                    <input id="swal-equipment-count" type="number" value="${equipmentCount}" min="1" ${isReadOnly ? 'readonly' : ''} onchange="window.updateEquipmentTotal()" style="width:100%;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;${disabledStyle}">
                  </div>
                  <div style="flex:1;">
                    <label style="font-size:10px;color:#666;">대당금액</label>
                    <input id="swal-equipment-price" type="number" value="${equipmentPricePerUnit}" ${isReadOnly ? 'readonly' : ''} onchange="window.updateEquipmentTotal()" style="width:100%;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;${disabledStyle}">
                  </div>
                </div>
                <div style="background:#d1fae5;padding:8px;border-radius:4px;margin-bottom:8px;">
                  <span style="font-size:11px;color:#065f46;">장비 총액: </span>
                  <span id="equipment-total" style="font-weight:bold;color:#059669;">${(equipmentCount * equipmentPricePerUnit).toLocaleString()}원</span>
                  <span style="font-size:10px;color:#666;"> (${equipmentCount}대 × ${equipmentPricePerUnit.toLocaleString()}원)</span>
                </div>
                <div>
                  <label style="font-size:10px;color:#666;">📅 비용발생 월</label>
                  <div style="margin-top:4px;">${equipmentMonthsHtml}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 사업자정보 탭 -->
          <div id="tab-business" class="tab-content" style="display:none;">
            <div style="margin-bottom:8px;">
              <label style="font-size:11px;color:#666;">업체구분 (서비스리포트 폼 결정)</label>
              <select id="swal-biztype" class="swal2-input" ${isReadOnly ? 'disabled' : ''} style="width:100%;margin:3px 0;font-size:13px;padding:8px;${disabledStyle}">
                <option value="small" ${(customer.bizType || 'small') === 'small' ? 'selected' : ''}>소규모 (서비스확인서)</option>
                <option value="industrial" ${customer.bizType === 'industrial' ? 'selected' : ''}>산업체 (서비스리포트)</option>
              </select>
            </div>
            <!-- 소독증명서 출력 대상 토글 -->
            <div style="margin-bottom:12px;padding:10px 12px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;">
              <!-- 기본 소독증명서 -->
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:13px;font-weight:bold;color:#065f46;">🧾 소독증명서 출력 대상</div>
                  <div style="font-size:11px;color:#6b7280;margin-top:2px;">ON 시 배정플랜 완료 처리 시 약제 기입이 필수입니다</div>
                </div>
                ${!isReadOnly ? `<label class="toggle-switch" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;">
                  <input type="checkbox" id="swal-cert-target" ${customer.certTarget ? 'checked' : ''} onchange="
                    this.nextElementSibling.style.backgroundColor = this.checked ? '#10b981' : '#ccc';
                    document.getElementById('cert-sub-options').style.display = this.checked ? 'block' : 'none';
                  " style="opacity:0;width:0;height:0;">
                  <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.certTarget ? '#10b981' : '#ccc'};transition:.3s;border-radius:24px;"></span>
                </label>` : `<span style="font-size:12px;font-weight:bold;color:${customer.certTarget ? '#10b981' : '#9ca3af'}">${customer.certTarget ? 'ON' : 'OFF'}</span>`}
              </div>

              <!-- 증명서용 고객명 (certName) -->
              <div style="margin-top:10px;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <span style="font-size:12px;font-weight:bold;color:#92400e;">✏️ 증명서용 고객명</span>
                  <span style="font-size:10px;color:#b45309;">비우면 고객명 그대로 사용</span>
                </div>
                <input id="swal-cert-name" class="swal2-input"
                  value="${customer.certName || ''}"
                  placeholder="${customer.name} (예: 가연푸드)"
                  ${isReadOnly ? 'readonly' : ''}
                  style="margin:2px 0;font-size:12px;${disabledStyle}">
                <div style="font-size:10px;color:#78350f;margin-top:3px;">
                  💡 앱 고객명과 증명서 인쇄 이름을 다르게 할 때 사용 (차량증명서 제외)
                </div>
              </div>

              <!-- 추가 옵션 (certTarget ON일 때만 표시) -->
              <div id="cert-sub-options" style="display:${customer.certTarget ? 'block' : 'none'};margin-top:10px;padding-top:10px;border-top:1px solid #bbf7d0;">

                <!-- 추가 증명서 토글 -->
                <div style="margin-bottom:10px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div>
                      <div style="font-size:12px;font-weight:bold;color:#166534;">➕ 추가 증명서 발급</div>
                      <div style="font-size:10px;color:#6b7280;">동일 고객의 추가 업장 증명서 (예: 납품창고)</div>
                    </div>
                    ${!isReadOnly ? `<label style="position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;">
                      <input type="checkbox" id="swal-cert-extra-enabled" ${customer.certExtra?.enabled ? 'checked' : ''} onchange="
                        this.nextElementSibling.style.backgroundColor = this.checked ? '#10b981' : '#ccc';
                        document.getElementById('cert-extra-name-wrap').style.display = this.checked ? 'block' : 'none';
                      " style="opacity:0;width:0;height:0;">
                      <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.certExtra?.enabled ? '#10b981' : '#ccc'};transition:.3s;border-radius:22px;"></span>
                    </label>` : `<span style="font-size:11px;color:${customer.certExtra?.enabled ? '#10b981' : '#9ca3af'}">${customer.certExtra?.enabled ? 'ON' : 'OFF'}</span>`}
                  </div>
                  <div id="cert-extra-name-wrap" style="display:${customer.certExtra?.enabled ? 'block' : 'none'};">
                    <label style="font-size:10px;color:#666;">추가 업장명</label>
                    <input id="swal-cert-extra-name" class="swal2-input" value="${customer.certExtra?.name || ''}"
                      placeholder="예: 납품창고, 2공장" ${isReadOnly ? 'readonly' : ''}
                      style="margin:3px 0;font-size:12px;${disabledStyle}">
                    <div style="font-size:10px;color:#6b7280;">표시 예) ${customer.name} <b>(${customer.certExtra?.name || '추가업장명'})</b></div>
                  </div>
                </div>

                <!-- 차량 소독증명서 토글 -->
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div>
                      <div style="font-size:12px;font-weight:bold;color:#166534;">🚗 차량 소독증명서 발급</div>
                      <div style="font-size:10px;color:#6b7280;">차량번호가 업장명으로 들어가는 별도 증명서</div>
                    </div>
                    ${!isReadOnly ? `<label style="position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;">
                      <input type="checkbox" id="swal-cert-vehicle-enabled" ${customer.certVehicle?.enabled ? 'checked' : ''} onchange="
                        this.nextElementSibling.style.backgroundColor = this.checked ? '#10b981' : '#ccc';
                        document.getElementById('cert-vehicle-wrap').style.display = this.checked ? 'block' : 'none';
                      " style="opacity:0;width:0;height:0;">
                      <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.certVehicle?.enabled ? '#10b981' : '#ccc'};transition:.3s;border-radius:22px;"></span>
                    </label>` : `<span style="font-size:11px;color:${customer.certVehicle?.enabled ? '#10b981' : '#9ca3af'}">${customer.certVehicle?.enabled ? 'ON' : 'OFF'}</span>`}
                  </div>
                  <div id="cert-vehicle-wrap" style="display:${customer.certVehicle?.enabled ? 'block' : 'none'};">
                    <label style="font-size:10px;color:#666;">차량번호 (쉼표로 여러 대 입력 가능)</label>
                    <div style="display:flex;gap:6px;align-items:flex-start;">
                      <input id="swal-cert-vehicle-plates" class="swal2-input" value="${customer.certVehicle?.plates || ''}"
                        placeholder="예: 12가3456, 34나5678" ${isReadOnly ? 'readonly' : ''}
                        style="margin:3px 0;font-size:12px;flex:1;${disabledStyle}">
                      ${!isReadOnly ? `<label id="swal-vehicle-ai-btn" title="사진으로 차량번호 자동 인식" style="
                        display:inline-flex;align-items:center;gap:3px;padding:7px 10px;
                        background:#6366f1;color:white;border-radius:8px;cursor:pointer;
                        font-size:11px;font-weight:bold;white-space:nowrap;flex-shrink:0;margin-top:3px;">
                        📷 AI인식
                        <input type="file" accept="image/*" multiple style="display:none;"
                          onchange="(async function(inp_el,e){
                            const files=Array.from(e.target.files||[]);
                            if(!files.length)return;
                            const btn=document.getElementById('swal-vehicle-ai-btn');
                            const inp=document.getElementById('swal-cert-vehicle-plates');
                            btn.style.opacity='0.6';
                            const origHtml=btn.innerHTML;
                            btn.firstChild.nodeValue='🔍 인식중...';
                            const apiKey=window._wlAnthropicKey||'';
                            if(!apiKey){alert('설정에서 Anthropic API 키를 먼저 등록해주세요.');btn.style.opacity='1';btn.firstChild.nodeValue='📷 AI인식';return;}
                            const allPlates=[];
                            for(const file of files){
                              try{
                                const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(file);});
                                const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','anthropic-dangerous-direct-browser-access':'true','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:500,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:file.type,data:b64}},{type:'text',text:'이 이미지에서 한국 차량 번호판을 모두 찾아주세요. 한국 번호판 형식: 12가3456, 경기93고4567. 번호판만 쉼표로 구분해서 나열. 없으면 없음. 다른 설명 없이 번호판만 출력.'}]}]})});
                                const data=await resp.json();
                                const text=data.content?.find(c=>c.type==='text')?.text?.trim()||'';
                                if(text&&text!=='없음')text.split(',').map(p=>p.trim()).filter(Boolean).forEach(p=>allPlates.push(p));
                              }catch(err){console.warn('인식오류',err);}
                            }
                            btn.style.opacity='1';
                            btn.firstChild.nodeValue='📷 AI인식';
                            e.target.value='';
                            if(allPlates.length===0){alert('번호판을 감지하지 못했습니다. 직접 입력해주세요.');return;}
                            const existing=inp.value.split(',').map(p=>p.trim()).filter(Boolean);
                            const merged=[...new Set([...existing,...allPlates])];
                            inp.value=merged.join(', ');
                            alert('✅ '+allPlates.length+'개 번호판 인식됨: '+allPlates.join(', '));
                          })(this,event)">
                      </label>` : ''}
                    </div>
                    <!-- 한장으로 출력 토글 -->
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:6px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;">
                      <div>
                        <div style="font-size:11px;font-weight:bold;color:#0369a1;">📄 한장으로 출력</div>
                        <div style="font-size:10px;color:#6b7280;">ON: 발급 팝업에 한장출력 토글 표시</div>
                      </div>
                      ${!isReadOnly ? `<label style="position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;">
                        <input type="checkbox" id="swal-cert-vehicle-singlepage" ${customer.certVehicle?.singlePage ? 'checked' : ''} onchange="
                          this.nextElementSibling.style.backgroundColor = this.checked ? '#0ea5e9' : '#ccc';
                        " style="opacity:0;width:0;height:0;">
                        <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.certVehicle?.singlePage ? '#0ea5e9' : '#ccc'};transition:.3s;border-radius:22px;"></span>
                      </label>` : `<span style="font-size:11px;color:${customer.certVehicle?.singlePage ? '#0ea5e9' : '#9ca3af'}">${customer.certVehicle?.singlePage ? 'ON' : 'OFF'}</span>`}
                    </div>
                  </div>
                </div>

              </div>
            </div>
            <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">대표자명</label>
              <input id="swal-ceo" class="swal2-input" value="${customer.ceoName || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">사업자번호</label>
              <input id="swal-biznum" class="swal2-input" value="${customer.businessNumber || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
            <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">이메일</label>
              <input id="swal-email" class="swal2-input" value="${customer.email || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
          </div>

          <!-- 기타 탭 (공동작업, 루트세일, 특별작업, 미수금 등) -->
          <div id="tab-extra" class="tab-content" style="display:none;">
            <div style="display:flex;gap:10px;margin-bottom:8px;">
              <div style="flex:1;"><label style="font-size:11px;color:#666;">💰 미수금</label>
                <input id="swal-unpaid" class="swal2-input" type="number" value="${customer.unpaid || 0}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
              <div style="flex:1;"><label style="font-size:11px;color:#666;">클레임/AS</label>
                <input id="swal-claim" class="swal2-input" value="${customer.claim || ''}" ${readonlyAttr} style="margin:3px 0;font-size:13px;${disabledStyle}"></div>
            </div>

            <!-- 공동작업자 -->
            <div style="margin-bottom:8px;background:#e0f2fe;padding:10px;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <label style="font-size:12px;color:#0369a1;font-weight:bold;">👥 공동작업자</label>
                ${!isReadOnly ? '<button type="button" onclick="window.addCoWorker()" style="padding:4px 10px;background:#3b82f6;color:white;border:none;border-radius:4px;font-size:11px;">+ 추가</button>' : ''}
              </div>
              <div id="coworkers-list">
                ${coWorkersArray.length > 0 ? coWorkersArray.map((cw, idx) => `
                  <div class="coworker-item" style="display:flex;gap:5px;margin-bottom:5px;align-items:center;">
                    <select class="coworker-staff" ${isReadOnly ? 'disabled' : ''} style="flex:2;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;${disabledStyle}">
                      <option value="">-- 선택 --</option>${staffList.filter(s => s.name !== customer.staffName).map(s => `<option value="${s.name}" ${cw.staffName === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>
                    <input class="coworker-price" type="number" value="${cw.price || 0}" ${readonlyAttr} placeholder="금액" style="flex:1;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;${disabledStyle}">
                    ${!isReadOnly ? '<button type="button" onclick="this.parentElement.remove()" style="padding:4px 8px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:11px;">✕</button>' : ''}
                  </div>
                `).join('') : '<div style="font-size:11px;color:#666;">등록된 공동작업자 없음</div>'}
              </div>
            </div>
            
            <!-- 루트세일 -->
            <div style="margin-bottom:8px;background:#fef3c7;padding:10px;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <label style="font-size:12px;color:#92400e;font-weight:bold;">🎯 루트세일 (새고객영업)</label>
                ${!isReadOnly ? `<label class="toggle-switch" style="position:relative;display:inline-block;width:44px;height:24px;">
                  <input type="checkbox" id="swal-routesale-toggle" ${customer.routeSale?.enabled ? 'checked' : ''} onchange="
                    document.getElementById('routesale-detail').style.display = this.checked ? 'block' : 'none';
                    this.nextElementSibling.style.backgroundColor = this.checked ? '#f59e0b' : '#ccc';
                  " style="opacity:0;width:0;height:0;">
                  <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.routeSale?.enabled ? '#f59e0b' : '#ccc'};transition:.3s;border-radius:24px;"></span>
                </label>` : `<span style="font-size:11px;color:#666;">${customer.routeSale?.enabled ? '활성' : '비활성'}</span>`}
              </div>
              <div id="routesale-detail" style="display:${customer.routeSale?.enabled ? 'block' : 'none'};">
                <select id="swal-routesale-staff" class="swal2-select" ${isReadOnly ? 'disabled' : ''} style="width:100%;padding:8px;font-size:12px;${disabledStyle}">
                  <option value="">-- 영업직원 선택 --</option>${routeSaleOptions}
                </select>
                <p style="font-size:10px;color:#666;margin:5px 0 0;">※ 인센티브: 2개월완료 시 20%, 1년유지 후 추가 10%</p>
              </div>
            </div>
            
            <!-- 특별작업 -->
            <div style="margin-bottom:8px;background:#f3e8ff;padding:10px;border-radius:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <label style="font-size:12px;color:#7c3aed;font-weight:bold;">🌟 특별작업</label>
                ${!isReadOnly ? `<label class="toggle-switch" style="position:relative;display:inline-block;width:44px;height:24px;">
                  <input type="checkbox" id="swal-special-toggle" ${customer.specialWork ? 'checked' : ''} onchange="
                    document.getElementById('special-detail').style.display = this.checked ? 'block' : 'none';
                    this.nextElementSibling.style.backgroundColor = this.checked ? '#7c3aed' : '#ccc';
                  " style="opacity:0;width:0;height:0;">
                  <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.specialWork ? '#7c3aed' : '#ccc'};transition:.3s;border-radius:24px;"></span>
                </label>` : `<span style="font-size:11px;color:#666;">${customer.specialWork ? '활성' : '비활성'}</span>`}
              </div>
              <div id="special-detail" style="display:${customer.specialWork ? 'block' : 'none'};">
                <div style="margin-bottom:8px;">
                  <label style="font-size:10px;color:#666;">종류</label>
                  <select id="swal-special-type" class="swal2-select" ${isReadOnly ? 'disabled' : ''} style="width:100%;padding:8px;font-size:12px;${disabledStyle}">
                    <option value="추가작업" ${customer.specialWork?.type === '추가작업' ? 'selected' : ''}>추가작업</option>
                    <option value="고객클레임" ${customer.specialWork?.type === '고객클레임' ? 'selected' : ''}>고객클레임</option>
                    <option value="상담업무" ${customer.specialWork?.type === '상담업무' ? 'selected' : ''}>상담업무</option>
                    <option value="수금활동" ${customer.specialWork?.type === '수금활동' ? 'selected' : ''}>수금활동</option>
                  </select>
                </div>
                <div style="margin-bottom:8px;">
                  <label style="font-size:10px;color:#666;">담당자</label>
                  <select id="swal-special-staff" class="swal2-select" ${isReadOnly ? 'disabled' : ''} style="width:100%;padding:8px;font-size:12px;${disabledStyle}">
                    <option value="">-- 담당자 선택 --</option>${staffList.map(s => `<option value="${s.name}" ${customer.specialWork?.staffName === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
                  </select>
                </div>
                <div style="display:flex;gap:10px;margin-bottom:8px;">
                  <div style="flex:1;">
                    <label style="font-size:10px;color:#666;">작업 횟수</label>
                    <input id="swal-special-count" class="swal2-input" type="number" value="${customer.specialWork?.totalCount || 1}" ${readonlyAttr} min="1" style="margin:3px 0;font-size:12px;padding:6px;${disabledStyle}">
                  </div>
                  <div style="flex:1;">
                    <label style="font-size:10px;color:#666;">💰 금액</label>
                    <input id="swal-special-price" class="swal2-input" type="number" value="${customer.specialWork?.price || 0}" ${readonlyAttr} step="5000" min="0" style="margin:3px 0;font-size:12px;padding:6px;${disabledStyle}">
                  </div>
                </div>
                <div style="margin-bottom:8px;">
                  <label style="font-size:10px;color:#666;">📅 작업월 (선택 안하면 매월)</label>
                  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-top:5px;">
                    ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `
                      <div class="special-month-check ${(customer.specialWork?.workMonths || []).includes(m) ? 'checked' : ''}" 
                           data-val="${m}" 
                           ${!isReadOnly ? `onclick="this.classList.toggle('checked'); this.style.backgroundColor=this.classList.contains('checked')?'#7c3aed':'#f1f5f9'; this.style.color=this.classList.contains('checked')?'white':'#374151';"` : ''}
                           style="padding:5px;text-align:center;background:${(customer.specialWork?.workMonths || []).includes(m) ? '#7c3aed' : '#f1f5f9'};color:${(customer.specialWork?.workMonths || []).includes(m) ? 'white' : '#374151'};border-radius:4px;${!isReadOnly ? 'cursor:pointer;' : ''}font-size:11px;">
                        ${m}월
                      </div>
                    `).join('')}
                  </div>
                </div>
                <div style="font-size:10px;color:#666;">완료: ${customer.specialWork?.completedCount || 0} / 총: ${customer.specialWork?.totalCount || 0}회</div>
              </div>
            </div>
            
            <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">📝 메모</label>
              <textarea id="swal-memo" class="swal2-textarea" ${isCancelled ? 'readonly disabled' : ''} style="margin:3px 0;font-size:13px;height:60px;${disabledStyle}">${customer.memo || ''}</textarea></div>
            
            ${statusBtns}
          </div>

          <!-- 구역 설정 탭 -->
          <div id="tab-zone" class="tab-content" style="display:none;">
            <div style="background:#f0fdf4;padding:12px;border-radius:10px;margin-bottom:12px;border:1px solid #86efac;">
              <div style="font-size:13px;font-weight:bold;color:#166534;margin-bottom:8px;">📋 작업 리포트 구역 설정</div>
              <div style="font-size:11px;color:#666;">구역을 설정하면 완료 전 작업 리포트를 작성해야 합니다.</div>
            </div>
            
            <!-- 업종 템플릿 선택 -->
            <div style="margin-bottom:12px;">
              <label style="font-size:11px;color:#666;">🏢 업종 템플릿</label>
              <select id="swal-zone-template" ${isReadOnly ? 'disabled' : ''} onchange="window.applyZoneTemplate(this.value)" style="width:100%;padding:10px;margin:5px 0;font-size:13px;border:1px solid #ddd;border-radius:6px;">
                <option value="">-- 선택 (리포트 사용 안함) --</option>
                <option value="small_restaurant" ${customer.zoneTemplate === 'small_restaurant' ? 'selected' : ''}>🍽️ 소규모 (일반식당/카페)</option>
                <option value="building" ${customer.zoneTemplate === 'building' ? 'selected' : ''}>🏢 빌딩 (오피스/상가)</option>
                <option value="foodcourt" ${customer.zoneTemplate === 'foodcourt' ? 'selected' : ''}>🍔 푸드코트</option>
                <option value="hospital" ${customer.zoneTemplate === 'hospital' ? 'selected' : ''}>🏥 병원</option>
                <option value="mall" ${customer.zoneTemplate === 'mall' ? 'selected' : ''}>🛒 백화점/쇼핑몰</option>
                <option value="factory" ${customer.zoneTemplate === 'factory' ? 'selected' : ''}>🏭 일반공장</option>
                <option value="food_factory" ${customer.zoneTemplate === 'food_factory' ? 'selected' : ''}>🏭 식품공장</option>
                <option value="custom" ${customer.zoneTemplate === 'custom' ? 'selected' : ''}>✏️ 직접설정</option>
              </select>
            </div>
            
            <!-- 구역 목록 -->
            <div id="zone-list-container" style="max-height:250px;overflow-y:auto;">
              ${(customer.zones || []).map((z, idx) => {
                const subZonesHtml = (z.subZones || []).map((sz, szIdx) => `
                  <div class="subzone-item" data-zone="${idx}" data-subzone="${szIdx}" style="display:flex;align-items:center;gap:6px;padding:6px 8px;margin:4px 0 4px 20px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;">
                    <span style="color:#9ca3af;font-size:11px;">└</span>
                    <input type="text" class="subzone-name" value="${sz.name || ''}" placeholder="하위구역명" ${isReadOnly ? 'readonly' : ''} style="flex:1;padding:5px;font-size:12px;border:1px solid #ddd;border-radius:4px;">
                    ${!isReadOnly ? `<button type="button" onclick="window.removeSubZone(${idx},${szIdx})" style="padding:3px 6px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:10px;">✕</button>` : ''}
                  </div>
                `).join('');
                
                return `
                <div class="zone-item" data-idx="${idx}" style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;overflow:hidden;">
                  <div style="display:flex;align-items:center;gap:8px;padding:10px;background:#f1f5f9;">
                    <input type="checkbox" class="zone-enabled" ${z.enabled !== false ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} style="width:20px;height:20px;">
                    <input type="text" class="zone-name" value="${z.name || ''}" placeholder="구역명" ${isReadOnly ? 'readonly' : ''} style="flex:1;padding:8px;font-size:14px;font-weight:bold;border:1px solid #ddd;border-radius:4px;">
                    ${!isReadOnly ? `<button type="button" onclick="window.removeZone(${idx})" style="padding:6px 10px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:12px;">✕</button>` : ''}
                  </div>
                  <div class="subzones-container" data-zone="${idx}" style="padding:8px;">
                    ${subZonesHtml}
                    ${!isReadOnly ? `<button type="button" onclick="window.addSubZone(${idx})" style="width:100%;padding:8px;margin-top:4px;background:#e0f2fe;color:#0369a1;border:1px dashed #7dd3fc;border-radius:6px;font-size:11px;cursor:pointer;">+ 하위구역 추가</button>` : ''}
                  </div>
                </div>
              `}).join('') || '<div style="text-align:center;color:#999;padding:20px;">업종을 선택하면 기본 구역이 설정됩니다</div>'}
            </div>
            
            ${!isReadOnly ? `
              <button type="button" onclick="window.addZone()" style="width:100%;padding:10px;margin-top:10px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:13px;">+ 구역 추가</button>
            ` : ''}
          </div>
        </div>
      `,
      showCancelButton: !isCancelled && currentUser.role === 'master',
      showDenyButton: !isCancelled && currentUser.role === 'master',
      confirmButtonText: (isCancelled || currentUser.role !== 'master') ? '닫기' : '저장',
      denyButtonText: '삭제',
      cancelButtonText: '취소',
      showConfirmButton: true,
      denyButtonColor: '#ef4444',
      width: '95%',
      didOpen: () => {
        // 금액 증감 단위 저장
        window.currentPriceStep = priceStep;

        // ===== 1회성 담당 이벤트 핸들러 =====
        const onetimeAddBtn = document.getElementById('onetime-add-btn');
        if (onetimeAddBtn) {
          onetimeAddBtn.addEventListener('click', () => {
            const ym = document.getElementById('onetime-month-input').value; // "2025-05"
            const staffName = document.getElementById('onetime-staff-select').value;
            if (!ym) { alert('연월을 선택해주세요.'); return; }
            if (!staffName) { alert('직원을 선택해주세요.'); return; }
            // 중복 체크
            if (window.__onetimeStaffData[ym]) {
              if (!window.confirm(`${ym.replace('-', '년 ')}월은 이미 ${window.__onetimeStaffData[ym]}으로 등록되어 있습니다. 덮어쓸까요?`)) return;
            }
            window.__onetimeStaffData[ym] = staffName;
            // 목록 갱신
            const container = document.getElementById('onetime-list-container');
            if (container) {
              const entries = Object.entries(window.__onetimeStaffData).sort((a,b)=>a[0].localeCompare(b[0]));
              container.innerHTML = entries.length === 0
                ? '<div style="color:#9ca3af;font-size:12px;padding:6px 0;">등록된 1회성 담당이 없습니다.</div>'
                : entries.map(([k,v]) => {
                    const [y,m] = k.split('-');
                    return `<div id="onetime-item-${k}" style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#f0fdf4;border-radius:6px;margin-bottom:4px;border:1px solid #bbf7d0;">
                      <span style="font-size:13px;"><b>${y}년 ${parseInt(m)}월</b> → <span style="color:#059669;font-weight:bold;">${v}</span></span>
                      <button type="button" onclick="window.removeOnetimeStaff('${k}')" style="background:#ef4444;color:white;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">✕</button>
                    </div>`;
                  }).join('');
            }
          });
        }

        // 1회성 담당 삭제 핸들러
        window.removeOnetimeStaff = (ym) => {
          delete window.__onetimeStaffData[ym];
          const item = document.getElementById('onetime-item-' + ym);
          if (item) item.remove();
          const container = document.getElementById('onetime-list-container');
          if (container && Object.keys(window.__onetimeStaffData).length === 0) {
            container.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:6px 0;">등록된 1회성 담당이 없습니다.</div>';
          }
        };
        
        // 금액 나누기 토글 이벤트 핸들러
        const splitPriceToggle = document.getElementById('swal-split-price');
        const splitPreview = document.getElementById('split-price-preview');
        if (splitPriceToggle && splitPreview) {
          splitPriceToggle.addEventListener('change', () => {
            // 토글 스타일 업데이트
            const bgSpan = splitPriceToggle.nextElementSibling;
            const knobSpan = bgSpan?.nextElementSibling;
            if (bgSpan) bgSpan.style.backgroundColor = splitPriceToggle.checked ? '#3b82f6' : '#ccc';
            if (knobSpan) knobSpan.style.transform = splitPriceToggle.checked ? 'translateX(22px)' : 'translateX(0)';
            
            // 미리보기 텍스트 업데이트
            if (splitPriceToggle.checked) {
              splitPreview.innerHTML = '예: 50,000원 ÷ 2회 = <b>25,000원</b>/회';
            } else {
              splitPreview.innerHTML = '예: 50,000원 × 2회 = <b>100,000원</b>/월';
            }
          });
        }
        
        // 현황 탭 - React 컴포넌트를 Swal 내부 div에 렌더
        window.__renderStatusTab = (customerId) => {
          const container = document.getElementById('tab-status');
          if (!container) return;
          // ReactDOM은 전역에서 접근 불가 → Swal 닫고 별도 모달로 열기
          container.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;">현황 탭을 클릭하면 별도 창이 열립니다.<br><button id="open-status-btn" style="margin-top:12px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">🔍 고객현황 열기</button></div>';
          document.getElementById('open-status-btn')?.addEventListener('click', () => {
            Swal.close();
            setTimeout(() => { if (window.__openCustomerStatus) window.__openCustomerStatus(customerId); }, 100);
          });
        };

        // 탭 전환 함수
        window.switchTab = (tabName, btn) => {
          document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
          document.querySelectorAll('.tab-btn').forEach(el => {
            el.style.background = '#e5e7eb';
            el.style.color = '#374151';
          });
          document.getElementById('tab-' + tabName).style.display = 'block';
          if (btn) {
            btn.style.background = '#3b82f6';
            btn.style.color = 'white';
          }
        };

        // 업종별 구역 템플릿 (하위구역 포함)
        window.zoneTemplates = {
          small_restaurant: [
            { name: '외곽', subZones: [{ name: '주차장' }, { name: '입구' }, { name: '외부' }] },
            { name: '홀', subZones: [{ name: '객석' }, { name: '카운터' }] },
            { name: '주방', subZones: [{ name: '조리대' }, { name: '싱크대' }, { name: '냉장고' }, { name: '배수구' }] },
            { name: '창고', subZones: [{ name: '식자재' }, { name: '소모품' }] },
            { name: '화장실', subZones: [] }
          ],
          building: [
            { name: '외곽', subZones: [{ name: '주차장' }, { name: '하역장' }] },
            { name: '로비', subZones: [{ name: '1층' }, { name: '엘리베이터홀' }] },
            { name: '지하주차장', subZones: [{ name: 'B1' }, { name: 'B2' }] },
            { name: '사무실', subZones: [] },
            { name: '화장실', subZones: [] },
            { name: '기계실', subZones: [{ name: '옥상' }, { name: '지하' }] }
          ],
          foodcourt: [
            { name: '외곽', subZones: [{ name: '입구' }, { name: '주차장' }] },
            { name: '공용홀', subZones: [{ name: '객석' }, { name: '통로' }] },
            { name: '매장1', subZones: [] },
            { name: '매장2', subZones: [] },
            { name: '매장3', subZones: [] },
            { name: '공용창고', subZones: [] },
            { name: '화장실', subZones: [] }
          ],
          hospital: [
            { name: '외곽', subZones: [{ name: '입구' }, { name: '주차장' }] },
            { name: '로비', subZones: [{ name: '접수' }, { name: '대기실' }] },
            { name: '병동', subZones: [{ name: '입원실' }, { name: '복도' }] },
            { name: '외래', subZones: [{ name: '진료실' }] },
            { name: '수술실', subZones: [] },
            { name: '급식실', subZones: [{ name: '조리실' }, { name: '식당' }] },
            { name: '창고', subZones: [{ name: '의료용품' }, { name: '일반' }] },
            { name: '폐기물실', subZones: [] }
          ],
          mall: [
            { name: '외곽', subZones: [{ name: '입구' }, { name: '하역장' }] },
            { name: '1층', subZones: [{ name: '매장' }, { name: '통로' }] },
            { name: '2층', subZones: [{ name: '매장' }, { name: '통로' }] },
            { name: '3층', subZones: [{ name: '매장' }, { name: '통로' }] },
            { name: '푸드코트', subZones: [{ name: '객석' }, { name: '매장' }] },
            { name: '지하주차장', subZones: [] },
            { name: '창고', subZones: [] },
            { name: '기계실', subZones: [] }
          ],
          factory: [
            { name: '외곽', subZones: [{ name: '입구' }, { name: '주차장' }, { name: '하역장' }] },
            { name: '생산동', subZones: [{ name: '생산라인' }] },
            { name: '사무동', subZones: [{ name: '사무실' }] },
            { name: '창고', subZones: [{ name: '원자재' }, { name: '완제품' }] },
            { name: '식당', subZones: [] },
            { name: '탈의실', subZones: [{ name: '샤워실' }] }
          ],
          food_factory: [
            { name: '외곽', subZones: [{ name: '입구' }, { name: '주차장' }] },
            { name: '원료입고', subZones: [{ name: '하역장' }, { name: '검수실' }] },
            { name: '전처리실', subZones: [{ name: '세척' }, { name: '절단' }] },
            { name: '생산라인', subZones: [{ name: '가공' }, { name: '조리' }] },
            { name: '포장실', subZones: [] },
            { name: '완제품창고', subZones: [{ name: '냉장' }, { name: '냉동' }] },
            { name: '출하장', subZones: [] },
            { name: '식당', subZones: [] },
            { name: '탈의실', subZones: [] }
          ],
          custom: []
        };

        // 현재 구역 데이터 (깊은 복사)
        window.currentZones = JSON.parse(JSON.stringify(customer.zones || []));

        // 구역 목록 렌더링 (하위구역 포함)
        window.renderZoneList = () => {
          const container = document.getElementById('zone-list-container');
          if (!container) return;
          
          if (window.currentZones.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">업종을 선택하면 기본 구역이 설정됩니다</div>';
            return;
          }
          
          container.innerHTML = window.currentZones.map((z, idx) => {
            // 하위구역 목록 생성
            const subZonesHtml = (z.subZones || []).map((sz, szIdx) => 
              '<div class="subzone-item" data-zone="' + idx + '" data-subzone="' + szIdx + '" style="display:flex;align-items:center;gap:6px;padding:6px 8px;margin:4px 0 4px 20px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;">' +
                '<span style="color:#9ca3af;font-size:11px;">└</span>' +
                '<input type="text" class="subzone-name" value="' + (sz.name || '') + '" placeholder="하위구역명" style="flex:1;padding:5px;font-size:12px;border:1px solid #ddd;border-radius:4px;">' +
                '<button type="button" onclick="window.removeSubZone(' + idx + ',' + szIdx + ')" style="padding:3px 6px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:10px;">✕</button>' +
              '</div>'
            ).join('');
            
            return '<div class="zone-item" data-idx="' + idx + '" style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;overflow:hidden;">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:10px;background:#f1f5f9;">' +
                '<input type="checkbox" class="zone-enabled" ' + (z.enabled !== false ? 'checked' : '') + ' style="width:20px;height:20px;">' +
                '<input type="text" class="zone-name" value="' + (z.name || '') + '" placeholder="구역명" style="flex:1;padding:8px;font-size:14px;font-weight:bold;border:1px solid #ddd;border-radius:4px;">' +
                '<button type="button" onclick="window.removeZone(' + idx + ')" style="padding:6px 10px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:12px;">✕</button>' +
              '</div>' +
              '<div class="subzones-container" data-zone="' + idx + '" style="padding:8px;">' +
                subZonesHtml +
                '<button type="button" onclick="window.addSubZone(' + idx + ')" style="width:100%;padding:8px;margin-top:4px;background:#e0f2fe;color:#0369a1;border:1px dashed #7dd3fc;border-radius:6px;font-size:11px;cursor:pointer;">+ 하위구역 추가</button>' +
              '</div>' +
            '</div>';
          }).join('');
        };

        // 업종 템플릿 적용
        window.applyZoneTemplate = (templateKey) => {
          if (!templateKey) {
            window.currentZones = [];
          } else {
            const template = window.zoneTemplates[templateKey] || [];
            window.currentZones = template.map(z => ({ 
              name: z.name, 
              enabled: true, 
              subZones: (z.subZones || []).map(sz => ({ name: sz.name, enabled: true }))
            }));
          }
          window.renderZoneList();
        };

        // 구역 추가
        window.addZone = () => {
          window.currentZones.push({ name: '', enabled: true, subZones: [] });
          window.renderZoneList();
          
          // 직접설정으로 변경
          const templateSelect = document.getElementById('swal-zone-template');
          if (templateSelect && templateSelect.value !== 'custom') {
            templateSelect.value = 'custom';
          }
        };

        // 구역 삭제
        window.removeZone = (idx) => {
          window.currentZones.splice(idx, 1);
          window.renderZoneList();
        };

        // 하위구역 추가
        window.addSubZone = (zoneIdx) => {
          if (!window.currentZones[zoneIdx].subZones) {
            window.currentZones[zoneIdx].subZones = [];
          }
          window.currentZones[zoneIdx].subZones.push({ name: '', enabled: true });
          window.renderZoneList();
        };

        // 하위구역 삭제
        window.removeSubZone = (zoneIdx, subZoneIdx) => {
          window.currentZones[zoneIdx].subZones.splice(subZoneIdx, 1);
          window.renderZoneList();
        };

        // 구역 데이터 수집 (하위구역 포함)
        window.getZonesData = () => {
          const zones = [];
          document.querySelectorAll('.zone-item').forEach((item, idx) => {
            const subZones = [];
            item.querySelectorAll('.subzone-item').forEach((subItem) => {
              const subName = subItem.querySelector('.subzone-name')?.value || '';
              if (subName.trim()) {
                subZones.push({ name: subName, enabled: true });
              }
            });
            
            const zoneName = item.querySelector('.zone-name')?.value || '';
            if (zoneName.trim()) {
              zones.push({
                name: zoneName,
                enabled: item.querySelector('.zone-enabled')?.checked !== false,
                subZones: subZones
              });
            }
          });
          return zones;
        };

        // 작업월 스타일 + 토글 스타일
        const style = document.createElement('style');
        style.textContent = `
          .month-check{padding:8px;text-align:center;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:12px;}
          .month-check.checked{background:#3b82f6;color:white;}
          .toggle-switch input:checked + span{background-color:#3b82f6!important;}
          .toggle-switch span:before{position:absolute;content:"";height:18px;width:18px;left:3px;bottom:3px;background-color:white;transition:.3s;border-radius:50%;}
          .toggle-switch input:checked + span:before{transform:translateX(20px);}
        `;
        document.head.appendChild(style);
        
        // 💰청구/🚫무료 토글 — onclick 방식 (SweetAlert2 내부 호환)
        window.toggleCharge = (month, idx) => {
          const btn = document.querySelector('.charge-toggle-btn[data-month="' + month + '"][data-idx="' + idx + '"]');
          if (!btn) return;
          const wasCharged = btn.getAttribute('data-charged') === '1';
          const nowCharged = !wasCharged;

          btn.setAttribute('data-charged', nowCharged ? '1' : '0');
          btn.textContent      = nowCharged ? '💰청구' : '🚫무료';
          btn.style.background = nowCharged ? '#22c55e' : '#e5e7eb';
          btn.style.color      = nowCharged ? '#fff'    : '#9ca3af';

          const box = document.getElementById('price-box-' + month + '-' + idx);
          if (box) {
            box.style.borderColor = nowCharged ? '#22c55e' : '#d1d5db';
            box.style.background  = nowCharged ? '#f0fdf4' : '#f8fafc';
          }

          const hidden = document.querySelector('.month-charged-check[data-month="' + month + '"][data-idx="' + idx + '"]');
          if (hidden) hidden.value = nowCharged ? '1' : '0';
        };

        // 월별 횟수 변경 시 금액 입력칸 업데이트
        window.updateMonthPrices = (month, count, defaultPrice = 0, defaultCharged = true) => {
          const container = document.querySelector('.month-prices-container[data-month="' + month + '"]');
          if (!container) return;
          
          const stepVal = window.currentPriceStep || 1000;
          
          // 기존 값 수집
          const existingPrices = [];
          const existingCharged = [];
          container.querySelectorAll('.month-price-input').forEach(inp => {
            existingPrices.push(inp.value || 0);
          });
          container.querySelectorAll('.month-charged-check').forEach(cb => {
            existingCharged.push(cb.value === '1');
          });
          
          // 새로운 입력칸 생성 (토글 버튼 + 금액) - 모바일 친화적
          let html = '';
          for (let c = 0; c < parseInt(count); c++) {
            const price = defaultPrice > 0 ? defaultPrice : (existingPrices[c] || 0);
            const isCharged = existingCharged[c] !== undefined ? existingCharged[c] : defaultCharged;
            html += '<div style="display:flex;align-items:center;gap:4px;background:' + (isCharged ? '#f0fdf4' : '#f8fafc') + ';padding:4px 8px;border-radius:8px;border:2px solid ' + (isCharged ? '#22c55e' : '#d1d5db') + ';min-height:36px;" id="price-box-' + month + '-' + c + '">' +
              '<button type="button" class="charge-toggle-btn" onclick="window.toggleCharge(\'' + month + '\',\'' + c + '\')" data-month="' + month + '" data-idx="' + c + '" data-charged="' + (isCharged ? '1' : '0') + '" style="padding:2px 7px;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;white-space:nowrap;background:' + (isCharged ? '#22c55e' : '#e5e7eb') + ';color:' + (isCharged ? '#fff' : '#9ca3af') + ';">' + (isCharged ? '💰청구' : '🚫무료') + '</button>' +
              '<input type="number" class="month-price-input" data-month="' + month + '" data-idx="' + c + '" value="' + price + '" step="' + stepVal + '" placeholder="0" style="width:90px;padding:5px;font-size:12px;border:none;background:transparent;">' +
              '<input type="hidden" class="month-charged-check" data-month="' + month + '" data-idx="' + c + '" value="' + (isCharged ? '1' : '0') + '">' +
              '</div>';
          }
          container.innerHTML = html;
        };
        
        // 일괄 설정 적용
        window.applyBulkSettings = () => {
          const bulkCount = parseInt(document.getElementById('swal-bulk-count').value) || 1;
          const bulkPrice = parseInt(document.getElementById('swal-bulk-price').value) || 0;
          const bulkCharged = document.getElementById('swal-bulk-charged').checked;
          
          // 1~12월 모두 적용
          for (let m = 1; m <= 12; m++) {
            // 횟수 변경
            const countInput = document.querySelector('.month-count-input[data-month="' + m + '"]');
            if (countInput) {
              countInput.value = bulkCount;
            }
            
            // 금액칸 업데이트 (금액부과 체크 상태도 전달)
            window.updateMonthPricesWithCharged(m, bulkCount, bulkPrice, bulkCharged);
          }
        };
        
        // 금액칸 업데이트 (금액부과 상태 포함) - 모바일 친화적
        window.updateMonthPricesWithCharged = (month, count, defaultPrice, defaultCharged) => {
          const container = document.querySelector('.month-prices-container[data-month="' + month + '"]');
          if (!container) return;
          
          const stepVal = window.currentPriceStep || 1000;
          
          let html = '';
          for (let c = 0; c < parseInt(count); c++) {
            html += '<div style="display:flex;align-items:center;gap:4px;background:' + (defaultCharged ? '#f0fdf4' : '#f8fafc') + ';padding:4px 8px;border-radius:8px;border:2px solid ' + (defaultCharged ? '#22c55e' : '#d1d5db') + ';min-height:36px;" id="price-box-' + month + '-' + c + '">' +
              '<button type="button" class="charge-toggle-btn" onclick="window.toggleCharge(\'' + month + '\',\'' + c + '\')" data-month="' + month + '" data-idx="' + c + '" data-charged="' + (defaultCharged ? '1' : '0') + '" style="padding:2px 7px;border:none;border-radius:5px;cursor:pointer;font-size:11px;font-weight:bold;white-space:nowrap;background:' + (defaultCharged ? '#22c55e' : '#e5e7eb') + ';color:' + (defaultCharged ? '#fff' : '#9ca3af') + ';">' + (defaultCharged ? '💰청구' : '🚫무료') + '</button>' +
              '<input type="number" class="month-price-input" data-month="' + month + '" data-idx="' + c + '" value="' + defaultPrice + '" step="' + stepVal + '" placeholder="0" style="width:90px;padding:5px;font-size:12px;border:none;background:transparent;">' +
              '<input type="hidden" class="month-charged-check" data-month="' + month + '" data-idx="' + c + '" value="' + (defaultCharged ? '1' : '0') + '">' +
              '</div>';
          }
          container.innerHTML = html;
        };
        
        // 전체 월 ON/OFF
        window.toggleAllMonths = (on) => {
          document.querySelectorAll('.work-month-check').forEach(cb => {
            cb.checked = on;
            // 스타일도 함께 업데이트
            const parent = cb.parentElement;
            if (parent) {
              parent.style.background = on ? '#22c55e' : '#e5e7eb';
              const span = parent.querySelector('span');
              if (span) span.style.color = on ? 'white' : '#374151';
            }
          });
        };
        
        // 직원 목록 옵션 HTML (담당자 제외)
        const staffOptionsHtml = staffList.filter(s => s.name !== customer.staffName).map(s => '<option value="' + s.name + '">' + s.name + '</option>').join('');
        
        // 공동작업자 추가 함수
        window.addCoWorker = () => {
          const list = document.getElementById('coworkers-list');
          const newItem = document.createElement('div');
          newItem.className = 'coworker-item';
          newItem.style.cssText = 'display:flex;gap:5px;margin-bottom:5px;align-items:center;';
          newItem.innerHTML = 
            '<select class="coworker-staff" style="flex:2;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;">' +
            '<option value="">-- 선택 --</option>' + staffOptionsHtml +
            '</select>' +
            '<input class="coworker-price" type="number" value="0" placeholder="금액" style="flex:1;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;">' +
            '<button type="button" onclick="this.parentElement.remove()" style="padding:4px 8px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:11px;">✕</button>';
          list.appendChild(newItem);
        };
        
        // 특별작업 공동작업자 추가 함수
        window.addSpecialCoWorker = () => {
          const list = document.getElementById('special-coworkers-list');
          const newItem = document.createElement('div');
          newItem.className = 'special-coworker-item';
          newItem.style.cssText = 'display:flex;gap:5px;margin-bottom:5px;align-items:center;';
          newItem.innerHTML = 
            '<select class="special-coworker-staff" style="flex:2;padding:5px;font-size:11px;border:1px solid #ddd;border-radius:4px;">' +
            '<option value="">-- 선택 --</option>' + staffOptionsHtml +
            '</select>' +
            '<input class="special-coworker-price" type="number" value="0" placeholder="금액" style="flex:1;padding:5px;font-size:11px;border:1px solid #ddd;border-radius:4px;">' +
            '<button type="button" onclick="this.parentElement.remove()" style="padding:3px 6px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:10px;">✕</button>';
          list.appendChild(newItem);
        };
        
        // 설치장비 선택 시 기본 금액 자동 입력
        window.onEquipmentSelect = (select) => {
          const customInput = document.getElementById('swal-equipment-custom-name');
          const priceInput = document.getElementById('swal-equipment-price');
          
          if (select.value === 'custom') {
            customInput.style.display = 'block';
            customInput.value = '';
            priceInput.value = 0;
          } else if (select.value) {
            customInput.style.display = 'none';
            const selectedOption = select.options[select.selectedIndex];
            const defaultPrice = selectedOption.dataset.price || 0;
            priceInput.value = defaultPrice;
          } else {
            customInput.style.display = 'none';
            priceInput.value = 0;
          }
          window.updateEquipmentTotal();
        };
        
        // 설치장비 총액 업데이트
        window.updateEquipmentTotal = () => {
          const enabled = document.getElementById('swal-equipment-toggle')?.checked;
          const count = parseInt(document.getElementById('swal-equipment-count')?.value) || 0;
          const price = parseInt(document.getElementById('swal-equipment-price')?.value) || 0;
          const total = enabled ? count * price : 0;
          
          const totalEl = document.getElementById('equipment-total');
          if (totalEl) {
            totalEl.innerHTML = total.toLocaleString() + '원';
            totalEl.nextElementSibling.innerHTML = ' (' + count + '대 × ' + price.toLocaleString() + '원)';
          }
        };
      },
      preConfirm: () => {
        // 해약 고객 또는 직원은 저장하지 않음 (닫기만)
        if (isCancelled || currentUser.role !== 'master') {
          return null;
        }
        
        // 서비스 수집
        const services = [];
        for (let idx = 0; idx < serviceCount; idx++) {
          const typeEl = document.getElementById('swal-svc-type-' + idx);
          const priceEl = document.getElementById('swal-svc-price-' + idx);
          const monthsEl = document.getElementById('swal-svc-months-' + idx);
          if (typeEl && priceEl) {
            services.push({
              type: typeEl.value,
              price: Number(priceEl.value) || 0,
              months: monthsEl ? monthsEl.value : ''
            });
          }
        }
        
        // 설치장비 데이터 수집
        const equipmentToggle = document.getElementById('swal-equipment-toggle');
        const equipmentEnabled = equipmentToggle ? equipmentToggle.checked : false;
        const equipmentSelect = document.getElementById('swal-equipment-name');
        const equipmentCustomName = document.getElementById('swal-equipment-custom-name');
        const equipmentCount = parseInt(document.getElementById('swal-equipment-count')?.value) || 1;
        const equipmentPricePerUnit = parseInt(document.getElementById('swal-equipment-price')?.value) || 0;
        
        // 장비명 결정
        let equipmentId = '';
        let equipmentName = '';
        if (equipmentSelect?.value === 'custom') {
          equipmentName = equipmentCustomName?.value || '';
        } else if (equipmentSelect?.value) {
          equipmentId = equipmentSelect.value;
          equipmentName = equipmentSelect.options[equipmentSelect.selectedIndex]?.dataset?.name || '';
        }
        
        // 설치장비 비용발생 월 수집
        const equipmentMonths = [];
        document.querySelectorAll('.eq-month-check:checked').forEach(cb => {
          equipmentMonths.push(parseInt(cb.value));
        });
        
        const equipment = {
          enabled: equipmentEnabled,
          equipmentId: equipmentId,
          equipmentName: equipmentName,
          count: equipmentCount,
          pricePerUnit: equipmentPricePerUnit,
          months: equipmentMonths.length > 0 ? equipmentMonths : [1,2,3,4,5,6,7,8,9,10,11,12]
        };
        
        // 동절기 데이터 수집
        const winterToggle = document.getElementById('swal-winter-toggle');
        const winterEnabled = winterToggle ? winterToggle.checked : true;
        const winterPrice = Number(document.getElementById('swal-winter-price')?.value) || 0;
        
        // 금액 나누기 설정 수집
        const splitPriceToggle = document.getElementById('swal-split-price');
        const splitPrice = splitPriceToggle ? splitPriceToggle.checked : false;
        
        // 작업월 데이터 수집 (새 구조)
        const workMonthsData = {};
        const selectedMonths = []; // 하위호환용 배열
        
        for (let m = 1; m <= 12; m++) {
          const checkEl = document.querySelector('.work-month-check[data-month="' + m + '"]');
          const countEl = document.querySelector('.month-count-input[data-month="' + m + '"]');
          const priceInputs = document.querySelectorAll('.month-price-input[data-month="' + m + '"]');
          const chargedInputs = document.querySelectorAll('.month-charged-check[data-month="' + m + '"]');
          
          const enabled = checkEl ? checkEl.checked : true;
          const count = countEl ? parseInt(countEl.value) || 1 : 1;
          const prices = [];
          const charged = [];
          
          priceInputs.forEach(inp => {
            prices.push(Number(inp.value) || 0);
          });
          
          chargedInputs.forEach(cb => {
            // hidden input이면 value로, checkbox면 checked로 읽기 (하위 호환)
            charged.push(cb.type === 'hidden' ? cb.value === '1' : cb.checked);
          });
          
          // 배열이 횟수보다 적으면 기본값으로 채움
          while (prices.length < count) {
            prices.push(0);
          }
          while (charged.length < count) {
            charged.push(true);
          }
          
          workMonthsData[m] = { enabled, count, prices, charged };
          
          // 하위호환용 배열
          if (enabled) {
            selectedMonths.push(m);
          }
        }
        
        // 태그 수집
        const selectedTags = [];
        document.querySelectorAll('.tag-check:checked').forEach(el => {
          selectedTags.push(el.value);
        });

        // 공동작업자 데이터 수집 (다중)
        const coWorkersData = [];
        document.querySelectorAll('.coworker-item').forEach(item => {
          const staffEl = item.querySelector('.coworker-staff');
          const priceEl = item.querySelector('.coworker-price');
          if (staffEl && priceEl) {
            const staffName = staffEl.value;
            const price = Number(priceEl.value) || 0;
            if (staffName) {
              coWorkersData.push({ staffName, price });
            }
          }
        });
        
        // 루트세일 데이터 수집
        const routeSaleToggle = document.getElementById('swal-routesale-toggle');
        const routeSaleEnabled = routeSaleToggle ? routeSaleToggle.checked : false;
        const existingRouteSale = customer.routeSale || {};
        const routeSaleData = routeSaleEnabled ? {
          enabled: true,
          staffName: document.getElementById('swal-routesale-staff')?.value || '',
          registeredAt: existingRouteSale.registeredAt || new Date().toISOString().split('T')[0],
          firstIncentivePaid: existingRouteSale.firstIncentivePaid || false,
          secondIncentivePaid: existingRouteSale.secondIncentivePaid || false,
          completedMonths: existingRouteSale.completedMonths || 0,
          incentiveHistory: existingRouteSale.incentiveHistory || []
        } : { enabled: false };

        // 특별작업 데이터 수집
        const specialToggle = document.getElementById('swal-special-toggle');
        const specialEnabled = specialToggle ? specialToggle.checked : false;
        const existingSpecial = customer.specialWork || {};
        
        // 특별작업 작업월 수집
        const specialWorkMonths = [];
        document.querySelectorAll('.special-month-check.checked').forEach(el => {
          specialWorkMonths.push(parseInt(el.getAttribute('data-val')));
        });
        
        // 특별작업 담당자 결정 (선택 안 하면 고객 담당자)
        let specialStaffName = document.getElementById('swal-special-staff')?.value || '';
        const customerStaffName = document.getElementById('swal-staff')?.value || '';
        
        if (specialEnabled) {
          if (!specialStaffName) {
            if (customerStaffName) {
              specialStaffName = customerStaffName;
            } else {
              Swal.showValidationMessage('특별작업 담당자를 선택하거나, 고객 담당자를 먼저 지정해주세요');
              return false;
            }
          }
        }
        
        const specialWorkData = specialEnabled ? {
          type: document.getElementById('swal-special-type')?.value || '추가작업',
          staffName: specialStaffName,
          totalCount: Number(document.getElementById('swal-special-count')?.value) || 1,
          completedCount: existingSpecial.completedCount || 0,
          price: Number(document.getElementById('swal-special-price')?.value) || 0,
          workMonths: specialWorkMonths.length > 0 ? specialWorkMonths : [1,2,3,4,5,6,7,8,9,10,11,12]
        } : null;

        return {
          // code는 수정 불가 (저장하지 않음)
          name: document.getElementById('swal-name').value,
          phone: document.getElementById('swal-phone').value,
          address: document.getElementById('swal-address').value,
          zipCode: document.getElementById('swal-zipcode')?.value || '',
          contractPeriod: document.getElementById('swal-contract')?.value || '',
          paymentMethod: document.getElementById('swal-payment')?.value || '',
          paymentDay: (() => {
            const v = document.getElementById('swal-payment-day')?.value;
            const pm = document.getElementById('swal-payment')?.value;
            if ((pm === '자동이체(통장)' || pm === '자동이체(카드)') && v) {
              return Number(v);
            }
            return null;
          })(),
          area: document.getElementById('swal-area')?.value || '',
          ceoName: document.getElementById('swal-ceo')?.value || '',
          businessNumber: document.getElementById('swal-biznum')?.value || '',
          bizType: document.getElementById('swal-biztype')?.value || 'small',
          certTarget: document.getElementById('swal-cert-target')?.checked || false,
          certName: document.getElementById('swal-cert-name')?.value?.trim() || '',
          certExtra: {
            enabled: document.getElementById('swal-cert-extra-enabled')?.checked || false,
            name: document.getElementById('swal-cert-extra-name')?.value || '',
          },
          certVehicle: {
            enabled: document.getElementById('swal-cert-vehicle-enabled')?.checked || false,
            plates: document.getElementById('swal-cert-vehicle-plates')?.value || '',
            singlePage: document.getElementById('swal-cert-vehicle-singlepage')?.checked || false,
          },
          email: document.getElementById('swal-email')?.value || '',
          services: services,
          // 설치장비
          equipment: equipment,
          // 동절기 설정
          winterEnabled: winterEnabled,
          winterPrice: winterPrice,
          // 금액 나누기 설정
          splitPrice: splitPrice,
          // 작업월 (새 구조 + 하위호환)
          workMonths: selectedMonths.length > 0 ? selectedMonths : [1,2,3,4,5,6,7,8,9,10,11,12],
          workMonthsData: workMonthsData,
          tags: selectedTags,
          staffName: document.getElementById('swal-staff').value,
          onetimeStaff: { ...(window.__onetimeStaffData || {}) }, // 1회성 담당
          // custStatus는 별도 해약/재계약 버튼으로만 변경 가능
          unpaid: Number(document.getElementById('swal-unpaid').value) || 0,
          claim: document.getElementById('swal-claim').value,
          memo: document.getElementById('swal-memo').value,
          coWorkers: coWorkersData,
          routeSale: routeSaleData,
          specialWork: specialWorkData,
          // 구역 설정 (작업 리포트용)
          zoneTemplate: document.getElementById('swal-zone-template')?.value || '',
          zones: window.getZonesData ? window.getZonesData() : []
        };
      }
    });

    if (isDenied) {
      const confirmDelete = await Swal.fire({
        title: '정말 삭제할까요?',
        text: `${customer.name}을(를) 삭제합니다`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소',
        confirmButtonColor: '#ef4444'
      });

      if (confirmDelete.isConfirmed) {
        try {
          await deleteDoc(doc(db, 'customers', customer.id));
          Swal.fire('완료', '삭제되었습니다!', 'success');
          fetchData();
        } catch (error) {
          Swal.fire('오류', '삭제 실패!', 'error');
        }
      }
      return;
    }

    if (formValues) {
      // 해약 고객은 저장하지 않음 (조회만 가능)
      if (isCancelled) {
        return;
      }
      
      try {
        // 특별작업 토글이 꺼졌는지 확인 (기존에 있었는데 null로 바뀜)
        if (customer.specialWork && formValues.specialWork === null) {
          // 확인 메시지
          const confirmDelete = await Swal.fire({
            title: '⚠️ 특별작업 삭제',
            html: '배정플랜에 있는 특별작업 이벤트도<br><b>모두 삭제</b>됩니다. 진행할까요?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소',
            confirmButtonColor: '#ef4444'
          });
          
          if (!confirmDelete.isConfirmed) {
            return; // 취소하면 저장 안 함
          }
          
          // events에서 해당 고객의 특별작업 이벤트 삭제
          const eventsSnap = await getDocs(collection(db, 'events'));
          const specialEvents = eventsSnap.docs.filter(d => {
            const data = d.data();
            return data.customerCode === customer.id && data.workType === 'special';
          });
          
          // 담당자 이벤트와 공동작업자 이벤트 모두 삭제
          for (const eventDoc of specialEvents) {
            // 이 이벤트의 공동작업자 이벤트도 삭제
            const coWorkEvents = eventsSnap.docs.filter(d => d.data().parentEventId === eventDoc.id);
            for (const coWorkDoc of coWorkEvents) {
              await deleteDoc(doc(db, 'events', coWorkDoc.id));
            }
            // 담당자 이벤트 삭제
            await deleteDoc(doc(db, 'events', eventDoc.id));
          }
        }
        
        await updateDoc(doc(db, 'customers', customer.id), formValues);
        
        // 미완료 events의 금액 회차별 재계산 + 이름/담당자 동기화
        try {
          // customerCode는 customer.id로 통일 (CalendarPage, AssignmentPage와 일치)
          const eventsQuery = query(
            collection(db, 'events'),
            where('customerCode', '==', customer.id),
            where('status', '==', '배정')
          );
          // code 기반으로 저장된 이전 데이터도 함께 조회
          const eventsQueryByCode = query(
            collection(db, 'events'),
            where('customerCode', '==', customer.code),
            where('status', '==', '배정')
          );
          const [eventsSnap, eventsSnapByCode] = await Promise.all([
            getDocs(eventsQuery),
            customer.code !== customer.id ? getDocs(eventsQueryByCode) : Promise.resolve({ docs: [] })
          ]);
          const allEventDocs = [...eventsSnap.docs, ...eventsSnapByCode.docs];
          const staffMember = staffList.find(s => s.name === formValues.staffName);

          // 기본 서비스 금액
          const baseServicePrice = (formValues.services || []).reduce((sum, svc) => sum + (svc.price || 0), 0);
          const winterMonths = [1, 2, 3, 12];

          for (const eventDoc of allEventDocs) {
            const eventData = eventDoc.data();
            if (eventData.workType !== 'regular' && eventData.workType) continue; // 특별/추가업무 제외
            if (eventData.isCoWork) continue; // 공동작업자 이벤트 제외

            const updatePayload = {
              title: formValues.name // 이름 동기화
            };

            // 담당자 변경 동기화
            if (staffMember) {
              updatePayload.staffId   = staffMember.visibleId;
              updatePayload.staffName = staffMember.name;
            }

            // 회차별 금액 재계산
            const eventDate = eventData.date || '';
            const eventMonth = eventDate ? new Date(eventDate).getMonth() + 1 : null;
            const workRound  = eventData.workRound ?? 0; // 0부터 시작
            const wmd = formValues.workMonthsData || {};
            const monthData = eventMonth ? (wmd[eventMonth] || wmd[String(eventMonth)]) : null;

            if (monthData) {
              const chargedArr = monthData.charged || [];
              const pricesArr  = monthData.prices  || [];
              const totalCnt   = monthData.count   || 1;
              const isCharged  = chargedArr[workRound] !== false;
              const priceOverride = pricesArr[workRound] || 0;
              const isWinter   = winterMonths.includes(eventMonth);
              const winterPrice = (formValues.winterEnabled !== false) ? (formValues.winterPrice || baseServicePrice) : baseServicePrice;

              let newPrice;
              if (!isCharged) {
                newPrice = 0; // 무료
              } else if (priceOverride > 0) {
                newPrice = formValues.splitPrice ? Math.round(priceOverride / totalCnt) : priceOverride;
              } else {
                const base = isWinter ? winterPrice : baseServicePrice;
                newPrice = formValues.splitPrice ? Math.round(base / totalCnt) : base;
              }

              // 공동작업비 차감
              const coWorkersArray = formValues.coWorkers || [];
              const totalCoWork = coWorkersArray.reduce((s, cw) => s + (cw.price || 0), 0);
              newPrice = Math.max(0, newPrice - totalCoWork);

              updatePayload.price      = newPrice;
              updatePayload.isCharged  = isCharged;
              updatePayload.workRound  = workRound;
              updatePayload.totalCount = totalCnt;
            }

            await updateDoc(doc(db, 'events', eventDoc.id), updatePayload);
          }
        } catch (e) {
          console.log('Events 업데이트 중 오류:', e);
        }
        
        // ========== 배정플랜 자동 생성 ==========
        // 담당자가 있고, 월별 체크된 달에 대해 자동 생성
        if (formValues.staffName && formValues.workMonthsData) {
          try {
            const staffMember = staffList.find(s => s.name === formValues.staffName);
            if (staffMember) {
              const currentYear = new Date().getFullYear();
              const currentMonth = new Date().getMonth() + 1;
              const winterMonths = [1, 2, 3, 12];
              
              // 기본 서비스 금액 계산
              const baseServicePrice = (formValues.services || []).reduce((sum, svc) => sum + (svc.price || 0), 0);
              const winterPrice = formValues.winterEnabled !== false ? (formValues.winterPrice || baseServicePrice) : baseServicePrice;
              
              // 현재 월부터 12월까지 체크된 달에 배정 생성
              for (let m = currentMonth; m <= 12; m++) {
                const monthData = formValues.workMonthsData[m];
                
                // 월이 체크되어 있으면 (enabled = true)
                if (monthData && monthData.enabled) {
                  const count = monthData.count || 1;
                  const isWinter = winterMonths.includes(m);
                  
                  // 이미 해당 월에 배정이 있는지 확인
                  const existingQuery = query(
                    collection(db, 'events'),
                    where('customerCode', '==', customer.id), // customer.id 통일
                    where('staffId', '==', staffMember.visibleId),
                    where('workType', '==', 'regular')
                  );
                  const existingSnap = await getDocs(existingQuery);
                  const existingInMonth = existingSnap.docs.filter(d => {
                    const data = d.data();
                    if (!data.date) return false;
                    const eventDate = new Date(data.date);
                    return eventDate.getFullYear() === currentYear && eventDate.getMonth() + 1 === m;
                  });
                  
                  // 기존 배정 수보다 설정된 횟수가 많으면 추가
                  const needToCreate = count - existingInMonth.length;
                  
                  if (needToCreate > 0) {
                    for (let c = 0; c < needToCreate; c++) {
                      // 금액 결정: 입력값이 0이면 자동금액 적용
                      const inputPrice = (monthData.prices && monthData.prices[existingInMonth.length + c]) || 0;
                      const finalPrice = inputPrice > 0 ? inputPrice : (isWinter ? winterPrice : baseServicePrice);
                      
                      // 미배정 상태로 생성 (날짜 없이)
                      await addDoc(collection(db, 'events'), {
                        customerCode: customer.id, // customer.id 통일 (CalendarPage와 일치)
                        customerId: customer.id,
                        title: customer.name,
                        staffId: staffMember.visibleId,
                        staffName: staffMember.name,
                        price: finalPrice,
                        status: '대기',  // 날짜 미지정 상태
                        workType: 'regular',
                        targetMonth: m,
                        targetYear: currentYear,
                        workIndex: existingInMonth.length + c + 1,  // 몇 회차인지
                        createdAt: new Date().toISOString(),
                        address: customer.address || '',
                        phone: customer.phone || ''
                      });
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.log('배정플랜 자동 생성 오류:', e);
          }
        }
        // ========== 배정플랜 자동 생성 끝 ==========
        
        Swal.fire('완료', '저장되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '저장 실패!', 'error');
      }
    }
  };

  // 해약 처리
  window.openCancel = async (customerId) => {
    Swal.close();
    const { value: reason, isConfirmed } = await Swal.fire({
      title: '🚫 해약 처리',
      html: `<textarea id="swal-cancel-reason" class="swal2-textarea" placeholder="해약 사유 (필수)" style="height:80px;"></textarea>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '해약',
      confirmButtonColor: '#ef4444',
      cancelButtonText: '취소',
      preConfirm: () => {
        const reason = document.getElementById('swal-cancel-reason').value;
        if (!reason) {
          Swal.showValidationMessage('사유를 입력하세요');
          return false;
        }
        return reason;
      }
    });

    if (isConfirmed) {
      try {
        await updateDoc(doc(db, 'customers', customerId), {
          custStatus: '해약',
          cancelReason: reason,
          cancelDate: new Date().toISOString().split('T')[0]
        });
        Swal.fire('완료', '해약 처리되었습니다', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '처리 실패', 'error');
      }
    }
  };

  // 재계약 (새 코드로 복사 생성)
  window.openRecontract = async (customerId) => {
    Swal.close();
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;

    // 새 코드 생성 (기존 최대 코드 + 1)
    const allCodes = customers.map(c => parseInt(String(c.code || '0').replace(/\D/g, '')) || 0);
    const maxCode = Math.max(...allCodes, 0);
    const newCode = String(maxCode + 1);

    let staffOpts = '<option value="">담당자 선택 (필수)</option>';
    staffList.forEach(s => { staffOpts += `<option value="${s.name}" ${customer.staffName === s.name ? 'selected' : ''}>${s.name}</option>`; });
    const today = new Date().toISOString().split('T')[0];

    const { value: formValues, isConfirmed } = await Swal.fire({
      title: '🔄 재계약',
      html: `
        <div style="text-align:left;padding:10px;background:#dcfce7;border-radius:8px;margin-bottom:15px;">
          <div style="font-size:12px;color:#16a34a;margin-bottom:5px;">✅ 새 코드로 고객이 복사됩니다</div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;background:#fee2e2;padding:8px;border-radius:6px;">
              <div style="font-size:10px;color:#dc2626;">기존 (해약 유지)</div>
              <div style="font-weight:bold;">${customer.code}</div>
            </div>
            <div style="flex:1;background:#dcfce7;padding:8px;border-radius:6px;">
              <div style="font-size:10px;color:#16a34a;">새 코드</div>
              <div style="font-weight:bold;">${newCode}</div>
            </div>
          </div>
        </div>
        <div style="text-align:left;padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:15px;">
          <div><b>${customer.name}</b></div>
          <div style="font-size:12px;color:#666;">📍 ${customer.address || '-'}</div>
          <div style="font-size:12px;color:#666;">📞 ${customer.phone || '-'}</div>
        </div>
        <div style="text-align:left;margin-bottom:5px;font-weight:bold;">📅 재계약 날짜</div>
        <input id="swal-recontract-date" type="date" class="swal2-input" value="${today}">
        <div style="text-align:left;margin-bottom:5px;margin-top:10px;font-weight:bold;">👤 담당자</div>
        <select id="swal-recontract-staff" class="swal2-input">${staffOpts}</select>
      `,
      showCancelButton: true,
      confirmButtonText: '재계약 (새 고객 생성)',
      confirmButtonColor: '#22c55e',
      cancelButtonText: '취소',
      preConfirm: () => {
        const staff = document.getElementById('swal-recontract-staff').value;
        if (!staff) {
          Swal.showValidationMessage('담당자를 선택하세요');
          return false;
        }
        return {
          date: document.getElementById('swal-recontract-date').value,
          staff: staff
        };
      }
    });

    if (isConfirmed) {
      try {
        // 새 고객 데이터 생성 (기존 정보 복사)
        const newCustomerData = {
          code: newCode,
          name: customer.name,
          phone: customer.phone || '',
          address: customer.address || '',
          zipCode: customer.zipCode || '',
          contractPeriod: '', // 새 계약기간은 비움
          paymentMethod: customer.paymentMethod || '',
          paymentDay: customer.paymentDay || null,
          area: customer.area || '',
          winterPrice: customer.winterPrice || 0,
          ceoName: customer.ceoName || '',
          businessNumber: customer.businessNumber || '',
          email: customer.email || '',
          services: customer.services || [],
          workMonths: customer.workMonths || [1,2,3,4,5,6,7,8,9,10,11,12],
          tags: [],
          staffName: formValues.staff,
          custStatus: '정상',
          unpaid: 0, // 미수금 초기화
          claim: '',
          memo: `재계약 (${formValues.date}) - 기존코드: ${customer.code}`,
          coWorkers: customer.coWorkers || [],
          specialWork: null, // 특별작업 초기화
          routeSale: { enabled: false },
          createdAt: formValues.date,
          recontractFrom: customer.code // 기존 코드 참조
        };

        await addDoc(collection(db, 'customers'), newCustomerData);
        
        Swal.fire({
          title: '완료',
          html: `<div>재계약 처리되었습니다!</div>
                 <div style="margin-top:10px;padding:10px;background:#dcfce7;border-radius:8px;">
                   <div style="font-size:12px;">새 고객코드: <b>${newCode}</b></div>
                   <div style="font-size:11px;color:#666;">기존 해약 고객(${customer.code})은 그대로 유지됩니다</div>
                 </div>`,
          icon: 'success'
        });
        fetchData();
      } catch (error) {
        Swal.fire('오류', '처리 실패', 'error');
      }
    }
  };

  // Soft Delete
  window.softDelete = async (customerId) => {
    Swal.close();
    const result = await Swal.fire({
      title: '🗑️ 고객 삭제',
      html: `<div style="padding:10px;background:#fef3c7;border-radius:8px;text-align:left;">
        <div>• 고객 목록에서 사라집니다</div>
        <div>• "삭제된 고객" 필터에서 확인 가능</div>
      </div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#64748b',
      confirmButtonText: '삭제',
      cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
      try {
        await updateDoc(doc(db, 'customers', customerId), {
          custStatus: '삭제',
          deleteDate: new Date().toISOString().split('T')[0]
        });
        Swal.fire('완료', '삭제됨 (삭제된 고객에서 확인 가능)', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패', 'error');
      }
    }
  };

  const handleDeleteAll = async () => {
    const result = await Swal.fire({
      title: '⚠️ 전체 삭제',
      text: '모든 고객을 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '전체 삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444'
    });

    if (result.isConfirmed) {
      try {
        const snapshot = await getDocs(collection(db, 'customers'));
        for (const docItem of snapshot.docs) {
          await deleteDoc(doc(db, 'customers', docItem.id));
        }
        Swal.fire('완료', '모두 삭제되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '삭제 실패!', 'error');
      }
    }
  };

  // ── 사진 분석으로 고객정보 추출 (Claude AI) ────────────────
  const analyzeCustomerImage = async (file) => {
    if (!apiKey) {
      await Swal.fire('API 키 없음', '설정에서 Anthropic API 키를 먼저 등록해주세요.', 'warning');
      return null;
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1];
        const mimeType = file.type || 'image/jpeg';
        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 1000,
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: mimeType, data: base64 }
                  },
                  {
                    type: 'text',
                    text: `이 사진(사업자등록증 또는 명함)에서 아래 정보를 추출해서 JSON만 반환해주세요. 없는 항목은 빈 문자열로.
{
  "name": "상호명 또는 회사명",
  "phone": "대표 전화번호1",
  "phone2": "전화번호2 (있으면)",
  "fax": "팩스번호 (있으면)",
  "email": "이메일 (있으면)",
  "address": "주소 (도로명 또는 지번)",
  "ceoName": "대표자 성명",
  "contactPerson": "담당자 직책+이름 (명함이 대표자가 아닐 때, 예: 팀장 홍길동)",
  "bizNo": "사업자등록번호 (있으면)",
  "memo": "기타 참고할 정보"
}
JSON만 반환하고 다른 텍스트는 절대 포함하지 마세요.`
                  }
                ]
              }]
            })
          });
          const data = await response.json();
          const text = data.content?.find(b => b.type === 'text')?.text || '{}';
          const clean = text.replace(/```json|```/g, '').trim();
          resolve(JSON.parse(clean));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ── 고객 등록 폼 열기 ────────────────────────────────────
  const openAddForm = async (prefill = {}) => {
    const allCodes = customers.map(c => parseInt(String(c.code || '0').replace(/\D/g, '')) || 0);
    const maxCode = Math.max(...allCodes, 0);
    const newCode = String(maxCode + 1);
    const staffOptions = staffList.map(s => `<option value="${s.name}">${s.name}</option>`).join('');

    const v = (field) => prefill[field] || '';

    const { value: formValues } = await Swal.fire({
      title: '고객 등록',
      html: `
        <div style="background:#dcfce7;padding:10px;border-radius:8px;margin-bottom:12px;">
          <span style="font-size:12px;color:#16a34a;">새 고객코드: <b>${newCode}</b></span>
        </div>
        <input id="swal-name"    class="swal2-input" placeholder="고객명 (필수)" value="${v('name')}">
        <input id="swal-phone"   class="swal2-input" placeholder="전화번호1" value="${v('phone')}">
        <input id="swal-phone2"  class="swal2-input" placeholder="전화번호2 (있으면)" value="${v('phone2')}">
        <input id="swal-fax"     class="swal2-input" placeholder="팩스번호 (있으면)" value="${v('fax')}">
        <input id="swal-email"   class="swal2-input" type="email" placeholder="이메일 (있으면)" value="${v('email')}">
        <input id="swal-address" class="swal2-input" placeholder="주소" value="${v('address')}">
        <input id="swal-ceo"     class="swal2-input" placeholder="대표자명" value="${v('ceoName')}">
        <input id="swal-contact" class="swal2-input" placeholder="담당자 직책+이름 (예: 팀장 홍길동)" value="${v('contactPerson')}">
        <input id="swal-price"   class="swal2-input" type="number" placeholder="계약금액">
        <select id="swal-staff"  class="swal2-select" style="width:100%;padding:10px;margin-top:6px;">
          <option value="">-- 담당자 선택 --</option>${staffOptions}
        </select>
        <div style="margin-top:12px;padding:12px;background:#fef9c3;border-radius:8px;border:1px solid #fde68a;">
          <label style="font-size:12px;font-weight:bold;color:#92400e;display:block;margin-bottom:6px;">
            📅 작업개시일 <span style="font-weight:normal;color:#6b7280;">(선택 · 이 날짜 이전 달은 대기목록에 안 나옴)</span>
          </label>
          <input type="date" id="swal-workstart" style="width:100%;padding:8px;border:1px solid #fde68a;border-radius:6px;font-size:13px;box-sizing:border-box;">
        </div>
        <div style="margin-top:10px;padding:12px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;font-weight:bold;color:#1e40af;">
            <input type="checkbox" id="swal-isnew" style="width:18px;height:18px;cursor:pointer;accent-color:#3b82f6;">
            🆕 신규 계약 고객
          </label>
          <div id="swal-sales-wrap" style="display:none;margin-top:10px;">
            <select id="swal-sales-staff" class="swal2-select" style="width:100%;padding:10px;">
              <option value="">-- 영업한 직원 선택 --</option>${staffOptions}
            </select>
          </div>
        </div>
        ${prefill.bizNo ? `<div style="margin-top:10px;padding:8px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b;">사업자번호: <b>${prefill.bizNo}</b></div>` : ''}
        ${prefill.memo ? `<div style="margin-top:6px;padding:8px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#64748b;">기타: ${prefill.memo}</div>` : ''}
      `,
      width: Math.min(window.innerWidth * 0.95, 480),
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      didOpen: () => {
        document.getElementById('swal-isnew').addEventListener('change', (e) => {
          document.getElementById('swal-sales-wrap').style.display = e.target.checked ? 'block' : 'none';
        });
      },
      preConfirm: () => {
        const name = document.getElementById('swal-name').value.trim();
        if (!name) { Swal.showValidationMessage('고객명을 입력하세요'); return false; }
        const isNew = document.getElementById('swal-isnew').checked;
        const salesStaffName = isNew ? document.getElementById('swal-sales-staff').value : '';
        if (isNew && !salesStaffName) { Swal.showValidationMessage('신규 계약 시 영업한 직원을 선택해주세요'); return false; }
        const bizMemo = prefill.bizNo ? `사업자번호: ${prefill.bizNo}` : '';
        const extraMemo = prefill.memo || '';
        const memoFinal = [bizMemo, extraMemo].filter(Boolean).join(' / ');
        return {
          name,
          phone:    document.getElementById('swal-phone').value.trim(),
          phone2:   document.getElementById('swal-phone2').value.trim(),
          fax:      document.getElementById('swal-fax').value.trim(),
          email:    document.getElementById('swal-email').value.trim(),
          address:  document.getElementById('swal-address').value.trim(),
          ceoName:  document.getElementById('swal-ceo').value.trim(),
          contactPerson: document.getElementById('swal-contact').value.trim(),
          price:    Number(document.getElementById('swal-price').value) || 0,
          staffName: document.getElementById('swal-staff').value,
          isNew, salesStaffName,
          workStartDate: document.getElementById('swal-workstart').value || null,
          memo: memoFinal,
        };
      }
    });

    if (formValues) {
      try {
        await addDoc(collection(db, 'customers'), {
          ...formValues,
          code: newCode,
          services: [{ type: '일반', price: formValues.price, months: '매월' }],
          workMonths: [1,2,3,4,5,6,7,8,9,10,11,12],
          tags: [],
          custStatus: '정상',
          unpaid: 0,
          claim: '',
          coWorkers: [],
          specialWork: null,
          routeSale: { enabled: false },
          createdAt: new Date().toISOString().split('T')[0],
          workStartDate: formValues.workStartDate || null,
        });
        const startMsg = formValues.workStartDate ? `\n📅 작업개시일: ${formValues.workStartDate}` : '';
        Swal.fire('완료', `고객코드 ${newCode}로 등록되었습니다!${formValues.isNew ? '\n🆕 신규 고객으로 등록되었습니다.' : ''}${startMsg}`, 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '등록 실패!', 'error');
      }
    }
  };

  const handleAdd = async () => {
    // 등록 방식 선택
    const { value: method } = await Swal.fire({
      title: '고객 등록',
      html: `
        <div style="display:flex;flex-direction:column;gap:12px;padding:8px 0;">
          <button id="btn-manual" type="button" style="padding:16px;background:#3b82f6;color:white;border:none;border-radius:12px;cursor:pointer;font-size:15px;font-weight:bold;">
            ✏️ 직접 입력
            <div style="font-size:12px;font-weight:normal;opacity:0.85;margin-top:4px;">정보를 직접 입력해서 등록</div>
          </button>
          <button id="btn-photo" type="button" style="padding:16px;background:#8b5cf6;color:white;border:none;border-radius:12px;cursor:pointer;font-size:15px;font-weight:bold;">
            📸 사진으로 등록
            <div style="font-size:12px;font-weight:normal;opacity:0.85;margin-top:4px;">사업자등록증 · 명함 사진으로 자동 입력</div>
          </button>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true,
      width: Math.min(window.innerWidth * 0.95, 380),
      didOpen: () => {
        document.getElementById('btn-manual').addEventListener('click', () => Swal.close({ value: 'manual' }));
        document.getElementById('btn-photo').addEventListener('click', () => Swal.close({ value: 'photo' }));
      },
    });

    if (!method) return;

    if (method === 'manual') {
      await openAddForm();
      return;
    }

    // 📸 사진 등록 플로우
    const { value: file } = await Swal.fire({
      title: '📸 사진 업로드',
      html: `
        <div style="text-align:center;padding:8px 0;">
          <div style="font-size:13px;color:#6b7280;margin-bottom:16px;">
            사업자등록증 또는 명함 사진을 올려주세요.<br>
            <span style="color:#8b5cf6;font-weight:bold;">AI가 정보를 자동으로 읽어드립니다!</span>
          </div>
          <label style="display:inline-block;padding:14px 24px;background:#8b5cf6;color:white;border-radius:10px;cursor:pointer;font-weight:bold;font-size:14px;">
            📁 사진 선택
            <input type="file" id="photo-input" accept="image/*" capture="environment" style="display:none;">
          </label>
          <div id="photo-preview" style="margin-top:14px;"></div>
          <div id="photo-name" style="margin-top:8px;font-size:12px;color:#64748b;"></div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '분석 시작',
      cancelButtonText: '취소',
      confirmButtonColor: '#8b5cf6',
      width: Math.min(window.innerWidth * 0.95, 400),
      didOpen: () => {
        const input = document.getElementById('photo-input');
        input.addEventListener('change', (e) => {
          const f = e.target.files[0];
          if (!f) return;
          document.getElementById('photo-name').textContent = f.name;
          const url = URL.createObjectURL(f);
          document.getElementById('photo-preview').innerHTML =
            `<img src="${url}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;border:2px solid #e9d5ff;">`;
        });
      },
      preConfirm: () => {
        const f = document.getElementById('photo-input').files[0];
        if (!f) { Swal.showValidationMessage('사진을 선택해주세요'); return false; }
        return f;
      }
    });

    if (!file) return;

    // 분석 중 로딩
    Swal.fire({
      title: '🔍 분석 중...',
      html: '<div style="color:#6b7280;font-size:13px;">AI가 사진에서 정보를 읽고 있어요.<br>잠시만 기다려주세요!</div>',
      allowOutsideClick: false,
      showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const extracted = await analyzeCustomerImage(file);
      Swal.close();

      if (!extracted || Object.keys(extracted).length === 0) {
        await Swal.fire('분석 실패', '사진에서 정보를 읽지 못했어요. 직접 입력해주세요.', 'warning');
        await openAddForm();
        return;
      }

      // 추출된 항목 미리보기
      const previewItems = [
        extracted.name        && `상호: <b>${extracted.name}</b>`,
        extracted.phone       && `전화1: ${extracted.phone}`,
        extracted.phone2      && `전화2: ${extracted.phone2}`,
        extracted.fax         && `팩스: ${extracted.fax}`,
        extracted.email       && `이메일: ${extracted.email}`,
        extracted.address     && `주소: ${extracted.address}`,
        extracted.ceoName     && `대표자: ${extracted.ceoName}`,
        extracted.contactPerson && `담당자: ${extracted.contactPerson}`,
        extracted.bizNo       && `사업자번호: ${extracted.bizNo}`,
      ].filter(Boolean).join('<br>');

      const { isConfirmed } = await Swal.fire({
        title: '✅ 분석 완료!',
        html: `
          <div style="text-align:left;padding:10px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.8;">
            ${previewItems || '추출된 정보가 없습니다.'}
          </div>
          <div style="margin-top:10px;font-size:12px;color:#6b7280;">정보를 확인하고 등록 폼으로 이동합니다.</div>
        `,
        showCancelButton: true,
        confirmButtonText: '폼으로 이동',
        cancelButtonText: '다시 찍기',
        confirmButtonColor: '#8b5cf6',
      });

      if (!isConfirmed) {
        handleAdd(); // 다시 시작
        return;
      }

      await openAddForm(extracted);
    } catch (err) {
      Swal.close();
      console.error('이미지 분석 오류:', err);
      await Swal.fire('오류', 'AI 분석에 실패했어요. 직접 입력해주세요.', 'error');
      await openAddForm();
    }
  };

  const getTotalPrice = (c) => {
    if (c.services && c.services.length > 0) {
      return c.services.reduce((sum, s) => sum + (s.price || 0), 0);
    }
    return c.price || 0;
  };

  // 정기/부정기 판단 함수
  const getCustomerType = (c) => {
    const workMonthsData = c.workMonthsData || {};
    const enabledMonths = [];
    
    for (let m = 1; m <= 12; m++) {
      if (workMonthsData[m]?.enabled !== false) {
        enabledMonths.push(m);
      }
    }
    
    // 12개월 모두 활성화면 정기, 아니면 부정기
    if (enabledMonths.length === 12) {
      return { type: '정기', months: null };
    } else if (enabledMonths.length > 0) {
      return { type: '부정기', months: enabledMonths };
    }
    return { type: '정기', months: null }; // 데이터 없으면 정기로 간주
  };

  // 설치장비 정보 가져오기
  const getEquipmentInfo = (c) => {
    const eq = c.equipment;
    if (!eq || !eq.enabled) return null;
    
    const count = eq.count || 1;
    const pricePerUnit = eq.pricePerUnit || 0;
    const totalPrice = count * pricePerUnit;
    
    return {
      name: eq.equipmentName || '설치장비',
      count,
      pricePerUnit,
      totalPrice
    };
  };

  // 설치장비 포함 총 금액
  const getTotalPriceWithEquipment = (c) => {
    const basePrice = getTotalPrice(c);
    const eqInfo = getEquipmentInfo(c);
    return basePrice + (eqInfo ? eqInfo.totalPrice : 0);
  };

  // 직원 권한 확인 (수금관리에서도 사용하므로 먼저 정의)
  const isMaster = currentUser?.role === 'master';
  const myName = currentUser?.name;

  // ========== 수금관리 함수 ==========
  // 월별 금액 가져오기 (동절기 반영)
  const getMonthlyPrice = (customer, month) => {
    const basePrice = getTotalPrice(customer);
    const winterMonths = [1, 2, 3, 12];
    const isWinter = winterMonths.includes(month);
    
    // 동절기 가격 적용
    if (isWinter && customer.winterEnabled !== false && customer.winterPrice) {
      return customer.winterPrice;
    }
    return basePrice;
  };

  // 수금 상태 토글
  const togglePaymentStatus = async (customerId, month, currentStatus) => {
    try {
      const customer = customers.find(c => c.id === customerId);
      if (!customer) return;

      const payments = customer.payments || {};
      const yearPayments = payments[selectedYear] || {};
      const monthPayment = yearPayments[month] || { paid: true, note: '' };
      
      // 토글
      const newPaid = !monthPayment.paid;
      
      const updatedYearPayments = {
        ...yearPayments,
        [month]: { ...monthPayment, paid: newPaid }
      };
      
      const updatedPayments = {
        ...payments,
        [selectedYear]: updatedYearPayments
      };

      // 미수금 계산 (해당 연도의 미수 합계)
      let totalUnpaid = 0;
      Object.keys(updatedYearPayments).forEach(m => {
        if (!updatedYearPayments[m].paid) {
          totalUnpaid += getMonthlyPrice(customer, parseInt(m));
        }
      });

      await updateDoc(doc(db, 'customers', customerId), {
        payments: updatedPayments,
        unpaid: totalUnpaid
      });

      // 로컬 상태 업데이트
      setCustomers(prev => prev.map(c => 
        c.id === customerId 
          ? { ...c, payments: updatedPayments, unpaid: totalUnpaid }
          : c
      ));

      const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1000 });
      toast.fire({ icon: newPaid ? 'success' : 'warning', title: newPaid ? '완납 처리' : '미수 처리' });
    } catch (error) {
      console.error('수금 상태 변경 오류:', error);
      Swal.fire('오류', '저장 실패', 'error');
    }
  };

  // 결제방법 수정
  const updatePaymentMethod = async (customerId, method) => {
    try {
      await updateDoc(doc(db, 'customers', customerId), { paymentMethod: method });
      setCustomers(prev => prev.map(c => 
        c.id === customerId ? { ...c, paymentMethod: method } : c
      ));
    } catch (error) {
      console.error('결제방법 수정 오류:', error);
    }
  };

  // 비고 수정
  // eslint-disable-next-line no-unused-vars
  const updatePaymentNote = async (customerId, month, note) => {
    try {
      const customer = customers.find(c => c.id === customerId);
      if (!customer) return;

      const payments = customer.payments || {};
      const yearPayments = payments[selectedYear] || {};
      const monthPayment = yearPayments[month] || { paid: true, note: '' };
      
      const updatedYearPayments = {
        ...yearPayments,
        [month]: { ...monthPayment, note }
      };
      
      const updatedPayments = {
        ...payments,
        [selectedYear]: updatedYearPayments
      };

      await updateDoc(doc(db, 'customers', customerId), { payments: updatedPayments });
      setCustomers(prev => prev.map(c => 
        c.id === customerId ? { ...c, payments: updatedPayments } : c
      ));
    } catch (error) {
      console.error('비고 수정 오류:', error);
    }
  };

  // 수금관리용 필터링 (정상 고객만)
  const paymentCustomers = useMemo(() => customers.filter(c => {
    if (c.custStatus === '해약' || c.custStatus === '삭제') return false;
    if (!isMaster && c.staffName !== myName) return false;
    
    // 검색어 필터 (이름, 코드, 전화번호, 주소, 담당자)
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchSearch =
        (c.name || '').toLowerCase().includes(term) ||
        (c.custName || '').toLowerCase().includes(term) ||
        (c.code || '').includes(searchTerm) ||
        (c.phone || '').includes(searchTerm) ||
        (c.address || '').toLowerCase().includes(term) ||
        (c.staffName || '').toLowerCase().includes(term);
      if (!matchSearch) return false;
    }
    return true;
  }).sort((a, b) => {
    const codeA = parseInt(String(a.code || '0').replace(/\D/g, '')) || 0;
    const codeB = parseInt(String(b.code || '0').replace(/\D/g, '')) || 0;
    return codeA - codeB;
  }), [customers, isMaster, myName, searchTerm]);

  // ── 수금 대시보드 통계 ──────────────────────────────────────
  const paymentDashStats = React.useMemo(() => {
    const active = customers.filter(c => c.custStatus === '정상');
    const total  = active.length;

    // ── 자동이체 판별 (기존값 포함) ─────────────────────────
    const isAutoMethod = (m) => {
      if (!m) return false;
      const lower = m.toLowerCase();
      return lower.includes('자동') || lower.includes('auto');
    };
    const autoCount = active.filter(c => isAutoMethod(c.paymentMethod)).length;
    const autoRate  = total > 0 ? Math.round(autoCount / total * 100) : 0;

    // ── 미수금 ──────────────────────────────────────────────
    const unpaidCustomers = active.filter(c => (c.unpaid || 0) > 0);
    const totalUnpaid     = unpaidCustomers.reduce((s, c) => s + (c.unpaid || 0), 0);

    // ── 미수금 기간별 분류 ───────────────────────────────────
    const now = new Date();
    const curYear  = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const getUnpaidMonths = (c) => {
      const payments = c.payments?.[curYear] || {};
      let months = 0;
      for (let m = curMonth; m >= 1; m--) {
        const wmd = c.workMonthsData || {};
        if (wmd[m]?.enabled === false) continue;
        if (payments[m]?.paid === false) months++;
        else break;
      }
      return months;
    };
    const unpaid1m  = unpaidCustomers.filter(c => getUnpaidMonths(c) <= 1);
    const unpaid2_3 = unpaidCustomers.filter(c => { const m = getUnpaidMonths(c); return m >= 2 && m <= 3; });
    const unpaid3p  = unpaidCustomers.filter(c => getUnpaidMonths(c) > 3);

    // ── 수금율 (이번달 기준) ─────────────────────────────────
    const curMonthActive = active.filter(c => {
      const wmd = c.workMonthsData || {};
      return wmd[curMonth]?.enabled !== false;
    });
    const curMonthPaid = curMonthActive.filter(c =>
      c.payments?.[curYear]?.[curMonth]?.paid !== false
    );
    const collectionRate = curMonthActive.length > 0
      ? Math.round(curMonthPaid.length / curMonthActive.length * 100) : 0;

    // ── 월별 수금율 추이 (최근 6개월) ──────────────────────
    const monthlyRates = [];
    for (let i = 5; i >= 0; i--) {
      let y = curYear, m = curMonth - i;
      if (m <= 0) { m += 12; y -= 1; }
      const monthActive = active.filter(c => (c.workMonthsData||{})[m]?.enabled !== false);
      const monthPaid   = monthActive.filter(c => c.payments?.[y]?.[m]?.paid !== false);
      const rate = monthActive.length > 0 ? Math.round(monthPaid.length / monthActive.length * 100) : 0;
      monthlyRates.push({ month: m, year: y, rate, paid: monthPaid.length, total: monthActive.length });
    }

    // ── 결제방법별 (실제 DB값 그대로) ───────────────────────
    const methodMap = {};
    active.forEach(c => {
      const key = c.paymentMethod?.trim() || '미등록';
      if (!methodMap[key]) methodMap[key] = [];
      methodMap[key].push(c);
    });
    // 많은 순서로 정렬
    const byMethod = Object.entries(methodMap)
      .sort((a, b) => b[1].length - a[1].length)
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

    // ── 담당자별 수금현황 ────────────────────────────────────
    const byStaff = {};
    active.forEach(c => {
      const name = c.staffName || '미배정';
      if (!byStaff[name]) byStaff[name] = { total:0, unpaid:0, unpaidAmt:0, customers:[] };
      byStaff[name].total++;
      byStaff[name].customers.push(c);
      if ((c.unpaid||0) > 0) {
        byStaff[name].unpaid++;
        byStaff[name].unpaidAmt += (c.unpaid||0);
      }
    });

    return {
      total, autoCount, autoRate, collectionRate,
      unpaidCustomers, totalUnpaid,
      unpaid1m, unpaid2_3, unpaid3p,
      monthlyRates, byMethod, byStaff,
    };
  }, [customers]);

  // ── 나이스/신한 엑셀 업로드로 납부 일괄 처리 ──────────────
  const importPaymentExcel = async (file) => {
    if (!file) return;
    setImportLoading(true);
    try {
      const data = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'binary' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            res(XLSX.utils.sheet_to_json(ws, { header: 1 }));
          } catch(err) { rej(err); }
        };
        reader.onerror = rej;
        reader.readAsBinaryString(file);
      });

      if (data.length < 2) {
        Swal.fire('오류', '데이터가 없습니다.', 'error');
        return;
      }

      // 고객명 컬럼 자동 감지
      const headers = data[0].map(h => String(h || '').trim());
      const nameIdx = headers.findIndex(h => h.includes('고객') || h.includes('업체') || h.includes('이름') || h.includes('상호'));
      const amtIdx  = headers.findIndex(h => h.includes('금액') || h.includes('입금') || h.includes('amount'));

      if (nameIdx < 0) {
        Swal.fire('오류', `고객명 컬럼을 찾을 수 없어요.\n헤더에 '고객명', '업체명', '상호' 중 하나가 있어야 해요.`, 'error');
        return;
      }

      const rows = data.slice(1).filter(r => r[nameIdx]);
      const matched = [], unmatched = [];

      rows.forEach(row => {
        const name = String(row[nameIdx] || '').trim();
        const cust = customers.find(c =>
          c.custStatus === '정상' && (
            (c.name || '').includes(name) || name.includes(c.name || '') ||
            (c.custName || '').includes(name)
          )
        );
        if (cust) matched.push({ customer: cust, name, row });
        else unmatched.push(name);
      });

      // 확인 팝업
      const curMonth = new Date().getMonth() + 1;
      const { isConfirmed } = await Swal.fire({
        title: '📊 엑셀 업로드 결과',
        html: `<div style="text-align:left;padding:0 10px;font-size:13px;">
          <div style="background:#f0fdf4;padding:10px;border-radius:8px;margin-bottom:8px;">
            ✅ 매칭 성공: <b>${matched.length}건</b>
          </div>
          ${unmatched.length > 0 ? `<div style="background:#fef2f2;padding:10px;border-radius:8px;margin-bottom:8px;">
            ❌ 매칭 실패: <b>${unmatched.length}건</b><br>
            <span style="font-size:11px;color:#666;">${unmatched.slice(0,5).join(', ')}${unmatched.length>5?'...':''}</span>
          </div>` : ''}
          <div style="margin-top:8px;color:#666;">
            <b>${selectedYear}년 ${curMonth}월</b> 납부완료로 처리합니다.
          </div>
        </div>`,
        showCancelButton: true,
        confirmButtonText: `${matched.length}건 납부처리`,
        cancelButtonText: '취소',
        confirmButtonColor: '#059669',
      });

      if (!isConfirmed) return;

      // 일괄 납부처리
      let done = 0;
      for (const { customer } of matched) {
        try {
          const payments = customer.payments || {};
          const yearPay = payments[selectedYear] || {};
          const updated = {
            ...payments,
            [selectedYear]: { ...yearPay, [curMonth]: { paid: true, paidAt: new Date().toISOString() } }
          };
          await updateDoc(doc(db, 'customers', customer.id), { payments: updated });
          done++;
        } catch(e) { console.warn('납부처리 오류:', e); }
      }

      setCustomers(prev => prev.map(c => {
        const m = matched.find(x => x.customer.id === c.id);
        if (!m) return c;
        const payments = c.payments || {};
        return {
          ...c,
          payments: {
            ...payments,
            [selectedYear]: { ...(payments[selectedYear]||{}), [curMonth]: { paid: true, paidAt: new Date().toISOString() } }
          }
        };
      }));

      Swal.fire({ icon: 'success', title: '완료!', text: `${done}건 납부처리 완료`, timer: 2000, showConfirmButton: false });
    } catch(e) {
      Swal.fire('오류', '파일 처리 실패: ' + e.message, 'error');
    }
    setImportLoading(false);
  };

  // 수금관리 엑셀 내보내기
  const exportPaymentExcel = () => {
    const data = paymentCustomers.map(c => {
      const row = {
        '고객코드': c.code || '',
        '결제방법': c.paymentMethod || '',
        '이체일': (AUTO_METHODS.includes(c.paymentMethod) && c.paymentDay) ? `${c.paymentDay}일` : '',
        '고객명': c.name || ''
      };
      
      for (let m = 1; m <= 12; m++) {
        const price = getMonthlyPrice(c, m);
        const payments = c.payments?.[selectedYear]?.[m];
        const isPaid = payments?.paid !== false;
        row[`${m}월`] = isPaid ? price : `미수 ${price}`;
      }
      
      row['비고'] = '';
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${selectedYear}년 수금관리`);
    XLSX.writeFile(wb, `수금관리_${selectedYear}.xlsx`);
  };
  // ========== 수금관리 함수 끝 ==========

  const filteredCustomers = useMemo(() => customers.filter(c => {
    // 직원은 본인 담당만 볼 수 있음
    if (!isMaster && c.staffName !== myName) return false;
    
    // 직원은 해약 고객 볼 수 없음
    if (!isMaster && c.custStatus === '해약') return false;

    const term = searchTerm.toLowerCase();
    const matchSearch =
      (c.name || '').toLowerCase().includes(term) ||
      (c.custName || '').toLowerCase().includes(term) ||
      (c.phone || '').includes(searchTerm) ||
      (c.code || '').includes(searchTerm) ||
      (c.address || '').toLowerCase().includes(term) ||
      (c.staffName || '').toLowerCase().includes(term) ||
      (c.memo || '').toLowerCase().includes(term);
    
    if (!matchSearch) return false;

    if (filter === 'deleted') return isMaster && c.custStatus === '삭제'; // 삭제됨은 관리자만
    if (c.custStatus === '삭제') return false;
    if (filter === 'active') return c.custStatus !== '해약';
    if (filter === 'cancelled') return isMaster && c.custStatus === '해약'; // 해약은 관리자만
    if (filter === 'unpaid') return c.unpaid > 0;
    if (filter.startsWith('staff_')) return c.staffName === filter.replace('staff_', '');
    return true;
  }), [customers, isMaster, myName, searchTerm, filter]);

  // 정렬 (sortBy 기반)
  const sortedCustomers = useMemo(() => {
    const sorted = [...filteredCustomers];
    if (sortBy === 'recent') {
      sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'code-asc') {
      sorted.sort((a, b) => {
        const codeA = parseInt(String(a.code || '0').replace(/\D/g, '')) || 0;
        const codeB = parseInt(String(b.code || '0').replace(/\D/g, '')) || 0;
        return codeA - codeB;
      });
    } else if (sortBy === 'code-desc') {
      sorted.sort((a, b) => {
        const codeA = parseInt(String(a.code || '0').replace(/\D/g, '')) || 0;
        const codeB = parseInt(String(b.code || '0').replace(/\D/g, '')) || 0;
        return codeB - codeA;
      });
    }
    return sorted;
  }, [filteredCustomers, sortBy]);

  // 페이지네이션 계산
  const totalPages = useMemo(() => Math.ceil(sortedCustomers.length / pageSize), [sortedCustomers.length, pageSize]);
  const paginatedCustomers = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedCustomers.slice(startIndex, startIndex + pageSize);
  }, [sortedCustomers, currentPage, pageSize]);

  // 필터/검색 변경 시 페이지 1로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filter, sortBy]);

  // 컴포넌트 언마운트 시 window.* 전역 함수 정리 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      delete window.openCancel;
      delete window.openRecontract;
      delete window.softDelete;
      delete window.removeOnetimeStaff;
      delete window.switchTab;
      delete window.renderZoneList;
      delete window.applyZoneTemplate;
      delete window.addZone;
      delete window.removeZone;
      delete window.addSubZone;
      delete window.removeSubZone;
      delete window.getZonesData;
      delete window.toggleCharge;
      delete window.updateMonthPrices;
      delete window.applyBulkSettings;
      delete window.updateMonthPricesWithCharged;
      delete window.toggleAllMonths;
      delete window.addCoWorker;
      delete window.addSpecialCoWorker;
      delete window.onEquipmentSelect;
      delete window.updateEquipmentTotal;
      delete window.__onetimeStaffData;
    };
  }, []);

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 이력 타임라인 모달 */}
      {timelineCustomer && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:4500,display:'flex',alignItems:'flex-end',justifyContent:'center' }}
          onClick={e => { if(e.target===e.currentTarget) setTimelineCustomer(null); }}>
          <div style={{ background:'white',borderRadius:'20px 20px 0 0',width:'100%',maxWidth:480,maxHeight:'85vh',overflowY:'auto',padding:'20px 16px 40px' }}>
            <div style={{ width:40,height:4,background:'#d1d5db',borderRadius:2,margin:'0 auto 16px' }} />
            <div style={{ fontSize:16,fontWeight:'bold',color:'#1e293b',marginBottom:4 }}>
              📋 고객 이력 타임라인
            </div>
            <div style={{ fontSize:13,color:'#3b82f6',fontWeight:'bold',marginBottom:16,background:'#eff6ff',padding:'8px 12px',borderRadius:8 }}>
              {timelineCustomer.name} ({timelineCustomer.code})
            </div>
            <CustomerTimeline customer={timelineCustomer} />
            <button onClick={() => setTimelineCustomer(null)}
              style={{ width:'100%',padding:12,background:'#f1f5f9',color:'#64748b',border:'none',borderRadius:10,fontSize:14,cursor:'pointer',marginTop:16 }}>
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 수익성 분석 모달 */}
      {profitCustomer && (
        <ProfitabilityModal
          customer={profitCustomer}
          currentUser={currentUser}
          onClose={() => setProfitCustomer(null)}
        />
      )}

      {/* 약속 잡기 모달 */}
      {appointmentCustomer && (
        <AppointmentModal
          customer={appointmentCustomer}
          currentUser={currentUser}
          staffList={staffList}
          onClose={() => setAppointmentCustomer(null)}
        />
      )}

      {/* 고객현황 모달 */}
      {statusModalCustomer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 4000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setStatusModalCustomer(null); }}>
          <div style={{ background: 'white', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', padding: '20px 16px 40px' }}>
            <div style={{ width: 40, height: 4, background: '#d1d5db', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 'bold', color: '#1e293b', marginBottom: 4 }}>
              🔍 고객현황 - {statusModalCustomer.name || statusModalCustomer.custName}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
              코드: {statusModalCustomer.code}
            </div>
            <CustomerStatusTab
              customer={statusModalCustomer}
              currentUser={currentUser}
              isReadOnly={currentUser?.role === 'staff'}
              onSaved={(newStatus) => {
                setCustomers(prev => prev.map(c =>
                  c.id === statusModalCustomer.id
                    ? { ...c, customerStatus: newStatus }
                    : c
                ));
                setStatusModalCustomer(prev => prev ? { ...prev, customerStatus: newStatus } : null);
              }}
            />
            <button
              onClick={() => setStatusModalCustomer(null)}
              style={{ width: '100%', padding: 12, background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 10, fontSize: 14, cursor: 'pointer', marginTop: 8 }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 탭 버튼 */}
      <div style={{...styles.tabRow, gap: isMobile ? '6px' : '10px'}}>
        <button 
          onClick={() => setViewMode('list')} 
          style={{
            ...styles.tabBtn,
            backgroundColor: viewMode === 'list' ? '#3b82f6' : '#e5e7eb',
            color: viewMode === 'list' ? 'white' : '#374151',
            fontSize: isMobile ? 12 : 14, padding: isMobile ? '10px 6px' : '12px'
          }}
        >
          {isMobile ? '📋 목록' : '📋 고객목록'}
        </button>
        <button 
          onClick={() => setViewMode('payment')} 
          style={{
            ...styles.tabBtn,
            backgroundColor: viewMode === 'payment' ? '#3b82f6' : '#e5e7eb',
            color: viewMode === 'payment' ? 'white' : '#374151',
            fontSize: isMobile ? 12 : 14, padding: isMobile ? '10px 6px' : '12px'
          }}
        >
          {isMobile ? '💰 수금' : '💰 수금관리'}
        </button>
        <button
          onClick={() => setViewMode('report')}
          style={{
            ...styles.tabBtn,
            backgroundColor: viewMode === 'report' ? '#1d4ed8' : '#e5e7eb',
            color: viewMode === 'report' ? 'white' : '#374151',
            fontSize: 13,
          }}
        >
          🖨️ 서비스리포트
        </button>
        <button
          onClick={() => setViewMode('pest')}
          style={{
            ...styles.tabBtn,
            backgroundColor: viewMode === 'pest' ? '#7c3aed' : '#e5e7eb',
            color: viewMode === 'pest' ? 'white' : '#374151',
            fontSize: 13,
          }}
        >
          🪳 구획관리
        </button>
      </div>

      {/* 구획관리 모드 */}
      {viewMode === 'pest' ? (
        <PestMonitoringPage currentUser={currentUser} />
      ) : viewMode === 'report' ? (
        <ServiceReportPage
          customers={customers}
          staffList={staffList}
          currentUser={currentUser}
        />
      ) : viewMode === 'payment' ? (
        <PaymentView
          customers={customers}
          paymentCustomers={paymentCustomers}
          paymentDashStats={paymentDashStats}
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          selectedPayMonth={selectedPayMonth}
          setSelectedPayMonth={setSelectedPayMonth}
          paymentViewMode={paymentViewMode}
          setPaymentViewMode={setPaymentViewMode}
          dashOpen={dashOpen}
          setDashOpen={setDashOpen}
          dashDetail={dashDetail}
          setDashDetail={setDashDetail}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          isMaster={isMaster}
          isMobile={isMobile}
          getMonthlyPrice={getMonthlyPrice}
          togglePaymentStatus={togglePaymentStatus}
          updatePaymentMethod={updatePaymentMethod}
          exportPaymentExcel={exportPaymentExcel}
          importPaymentExcel={importPaymentExcel}
          importLoading={importLoading}
          setCustomers={setCustomers}
        />
      ) : (
        /* 기존 고객목록 모드 */
        <>
          <div style={{...styles.toolbar, flexWrap: isMobile ? 'wrap' : 'nowrap'}}>
            <input
              type="text"
              placeholder="🔍 검색"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{...styles.searchInput, minWidth: isMobile ? '100%' : 'auto'}}
            />
            <div style={{display:'flex', gap:'6px', width: isMobile ? '100%' : 'auto'}}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{...styles.filterSelect, flex: isMobile ? 1 : 'none'}}>
              <option value="all">전체</option>
              <option value="active">🟢 정상</option>
              {isMaster && <option value="cancelled">🔴 해약</option>}
              <option value="unpaid">💰 미수</option>
              {isMaster && <option value="deleted">🗑️ 삭제됨</option>}
              {isMaster && (
                <optgroup label="담당자별">
                  {staffList.map(s => (
                    <option key={s.id} value={`staff_${s.name}`}>👤 {s.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{...styles.sortSelect, flex: isMobile ? 1 : 'none'}}>
              <option value="default">정렬</option>
              <option value="code-asc">🔢 코드↑</option>
              <option value="code-desc">🔢 코드↓</option>
              <option value="name">🔤 가나다</option>
              <option value="recent">🆕 최근</option>
            </select>
            </div>
          </div>

          <div style={{...styles.buttonRow, flexWrap:'wrap'}}>
            {currentUser.role === 'master' && (
              <>
                <label style={{...styles.uploadLabel, flex: isMobile ? '1' : 'none'}}>
                  {isMobile ? '📂' : '📂 엑셀'}
                  <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} style={{display:'none'}} />
                </label>
                <button onClick={exportToExcel} style={{...styles.exportBtn, flex: isMobile ? '1' : 'none'}}>{isMobile ? '📥' : '📥 내보내기'}</button>
                <button onClick={handleAdd} style={{...styles.addButton, flex: isMobile ? '2' : '1', minWidth: isMobile ? '0' : 'auto'}}>+ 등록</button>
                <button onClick={handleDeleteAll} style={styles.deleteAllBtn}>🗑️</button>
              </>
            )}
          </div>

          {/* 상단 카운트 - 접기/펼치기 */}
          <div style={{ marginBottom: 10 }}>
            <button
              onClick={() => setStatsOpen(v => !v)}
              style={{
                width: '100%', padding: '7px 12px',
                background: statsOpen ? '#f1f5f9' : '#f8fafc',
                border: '1px solid #e2e8f0', borderRadius: 8,
                cursor: 'pointer', fontSize: 12, color: '#64748b',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span>
                {isMaster
                  ? `전체 ${customers.filter(c=>c.custStatus!=='삭제').length}명 · 정상 ${customers.filter(c=>c.custStatus!=='해약'&&c.custStatus!=='삭제').length}명 · 해약 ${customers.filter(c=>c.custStatus==='해약').length}명`
                  : `내 담당 ${customers.filter(c=>c.staffName===myName&&c.custStatus!=='삭제'&&c.custStatus!=='해약').length}명`
                }
              </span>
              <span style={{ fontSize: 10 }}>{statsOpen ? '▲' : '▼'}</span>
            </button>

            {statsOpen && (
              <div style={{ ...styles.statsRow, marginTop: 6 }}>
                {isMaster ? (
                  <>
                    <div style={styles.statBox}>
                      <span style={styles.statValue}>{customers.filter(c => c.custStatus !== '삭제').length}</span>
                      <span style={styles.statLabel}>전체</span>
                    </div>
                    <div style={styles.statBox}>
                      <span style={{...styles.statValue, color:'#22c55e'}}>
                        {customers.filter(c => c.custStatus !== '해약' && c.custStatus !== '삭제').length}
                      </span>
                      <span style={styles.statLabel}>정상</span>
                    </div>
                    <div style={styles.statBox}>
                      <span style={{...styles.statValue, color:'#ef4444'}}>
                        {customers.filter(c => c.custStatus === '해약').length}
                      </span>
                      <span style={styles.statLabel}>해약</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={styles.statBox}>
                      <span style={styles.statValue}>
                        {customers.filter(c => c.staffName === myName && c.custStatus !== '삭제' && c.custStatus !== '해약').length}
                      </span>
                      <span style={styles.statLabel}>내 담당</span>
                    </div>
                    <div style={styles.statBox}>
                      <span style={{...styles.statValue, color:'#22c55e'}}>
                        {customers.filter(c => c.staffName === myName && c.custStatus !== '해약' && c.custStatus !== '삭제').length}
                      </span>
                      <span style={styles.statLabel}>정상</span>
                    </div>
                    <div style={styles.statBox}>
                      <span style={{...styles.statValue, color:'#f59e0b'}}>
                        {customers.filter(c => c.staffName === myName && c.custStatus !== '해약' && c.custStatus !== '삭제' && c.unpaid > 0).length}
                      </span>
                      <span style={styles.statLabel}>미수</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

      <div style={styles.count}>
        검색결과 {sortedCustomers.length}명 
        {totalPages > 1 && <span style={{marginLeft:'10px', color:'#3b82f6'}}>({currentPage}/{totalPages} 페이지)</span>}
      </div>

      <div style={styles.list}>
        {paginatedCustomers.length === 0 ? (
          <div style={styles.empty}>등록된 고객이 없습니다</div>
        ) : (
          paginatedCustomers.map(customer => (
            <div key={customer.id} style={styles.card} onClick={() => handleDetail(customer)}>
              <div style={styles.cardHeader}>
                <div>
                  <span style={styles.code}>{customer.code}</span>
                  <span style={styles.name}>{customer.name}</span>
                  {customer.bizType === 'industrial' && (
                    <span style={{ marginLeft: 5, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 'bold', background: '#eeedfe', color: '#3c3489' }}>산업체</span>
                  )}
                  {customer.unpaid > 0 && <span style={styles.unpaidBadge}>💰{customer.unpaid.toLocaleString()}</span>}
                </div>
                <span style={{
                  ...styles.status,
                  backgroundColor: customer.custStatus === '해약' ? '#fee2e2' : customer.custStatus === '삭제' ? '#e5e7eb' : '#dcfce7',
                  color: customer.custStatus === '해약' ? '#dc2626' : customer.custStatus === '삭제' ? '#64748b' : '#16a34a'
                }}>
                  {customer.custStatus || '정상'}
                </span>
              </div>
              <div style={styles.info}>📞 {customer.phone || '-'}</div>
              <div style={styles.info}>📍 {customer.address || '-'}</div>
              
              {/* 정기/부정기 표시 */}
              {(() => {
                const typeInfo = getCustomerType(customer);
                if (typeInfo.type === '부정기') {
                  return (
                    <div style={styles.irregularBadge}>
                      📅 부정기({typeInfo.months.join(',')})
                    </div>
                  );
                }
                return null;
              })()}
              
              {customer.services && customer.services.length > 0 ? (
                <div style={styles.servicesBox}>
                  {customer.services.map((s, idx) => (
                    <div key={idx} style={styles.serviceRow}>
                      <span style={styles.serviceType}>{s.type || '일반'}</span>
                      <span style={styles.servicePrice}>{(s.price || 0).toLocaleString()}원</span>
                      {s.months && <span style={styles.serviceMonths}>({s.months})</span>}
                    </div>
                  ))}
                  <div style={styles.totalRow}>합계: <strong>{getTotalPrice(customer).toLocaleString()}원</strong></div>
                </div>
              ) : (
                <div style={styles.info}>💰 {getTotalPrice(customer).toLocaleString()}원</div>
              )}
              
              {/* 설치장비 정보 표시 */}
              {(() => {
                const eqInfo = getEquipmentInfo(customer);
                if (eqInfo) {
                  return (
                    <div style={styles.equipmentBox}>
                      <div style={styles.equipmentRow}>
                        <span>🔧 {eqInfo.name}</span>
                        <span style={styles.equipmentDetail}>
                          {eqInfo.count}대 × {eqInfo.pricePerUnit.toLocaleString()}원 = <strong>{eqInfo.totalPrice.toLocaleString()}원</strong>
                        </span>
                      </div>
                      <div style={styles.equipmentTotal}>
                        월 총액: <strong style={{color:'#059669'}}>{getTotalPriceWithEquipment(customer).toLocaleString()}원</strong>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* 태그 */}
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
              
              {/* 소독증명서 발급 대상 표시 — 클릭하면 발급 팝업 */}
              {customer.certTarget && (
                <div
                  style={{...styles.certTargetBadge, cursor:'pointer'}}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const { loadCustomerPesticides } = await import('./pesticideUtils');
                    const pd = await loadCustomerPesticides(String(customer.id));
                    await showCertSendPopup({
                      customer,
                      workDate: customer.lastWorkDate || new Date().toISOString().split('T')[0],
                      pesticides: pd?.pesticides || [],
                    });
                  }}
                  title="클릭하여 소독증명서 발급"
                >
                  🧾 소독증명서 발급
                </div>
              )}

              {customer.staffName && (
                <div style={styles.staffBadge}>👤 {customer.staffName}</div>
              )}
              
              {/* 마지막 작업일 표시 */}
              {customer.lastWorkDate && (
                <div style={styles.lastWorkBadge}>🕐 최근작업: {customer.lastWorkDate}</div>
              )}
              
              {/* 공동작업자 표시 (신규 coWorkers 배열 + 기존 coWorker 호환) */}
              {(customer.coWorkers && customer.coWorkers.length > 0) ? (
                <div style={styles.coWorkersBadge}>
                  👥 {customer.coWorkers.map(cw => cw.staffName).join(', ')}
                </div>
              ) : (customer.coWorker && customer.coWorker.enabled && customer.coWorker.staffName) ? (
                <div style={styles.coWorkersBadge}>
                  👥 {customer.coWorker.staffName}
                </div>
              ) : null}
              
              {/* 특별작업 표시 */}
              {customer.specialWork && customer.specialWork.staffName && (
                <div style={styles.specialBadge}>
                  🌟 {customer.specialWork.type}: {customer.specialWork.staffName}
                  {customer.specialWork.coWorkers && customer.specialWork.coWorkers.length > 0 && 
                    ` (+${customer.specialWork.coWorkers.length}명)`
                  }
                </div>
              )}

              {/* 약속 잡기 버튼 (정상 고객) */}
              {customer.custStatus !== '해약' && customer.custStatus !== '삭제' && (
                <div style={{marginTop:'8px'}} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setAppointmentCustomer(customer)}
                    style={{
                      width: '100%', padding: '7px', background: '#f0fdf4',
                      color: '#059669', border: '1px solid #bbf7d0', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 'bold'
                    }}
                  >
                    🗓️ 약속 잡기
                  </button>
                </div>
              )}

              {/* 이력 타임라인 버튼 */}
              {customer.custStatus !== '삭제' && (
                <div style={{marginTop:'4px'}} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setTimelineCustomer(customer)}
                    style={{ width:'100%',padding:'7px',background:'#f5f3ff',color:'#7c3aed',border:'1px solid #ddd6fe',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:'bold' }}
                  >
                    📋 이력 보기
                  </button>
                </div>
              )}

              {/* 수익성 분석 버튼 */}
              {customer.custStatus !== '삭제' && isMaster && (
                <div style={{marginTop:'4px'}} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setProfitCustomer(customer)}
                    style={{ width:'100%',padding:'7px',background:'#fef9c3',color:'#a16207',border:'1px solid #fef08a',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:'bold' }}
                  >
                    📈 수익성 분석
                  </button>
                </div>
              )}

              {/* 미수금 스케쥴 등록 버튼 */}
              {customer.unpaid > 0 && customer.custStatus !== '해약' && (
                <div style={{marginTop:'4px'}} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={async () => {
                      const today = new Date().toISOString().split('T')[0];
                      const { value: date } = await Swal.fire({
                        title: '💰 수금 일정 등록',
                        html: `<div style="text-align:left;padding:10px;">
                          <p><b>${customer.name}</b></p>
                          <p style="color:#ef4444;font-weight:bold;">미수금: ${(customer.unpaid||0).toLocaleString()}원</p>
                          <div style="margin-top:12px;">
                            <label style="font-size:12px;color:#6b7280;">수금 예정일</label>
                            <input id="unpaid-date" type="date" value="${today}"
                              style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;margin-top:4px;font-size:14px;">
                          </div>
                        </div>`,
                        showCancelButton: true,
                        confirmButtonText: '등록',
                        cancelButtonText: '취소',
                        confirmButtonColor: '#ef4444',
                        preConfirm: () => document.getElementById('unpaid-date').value,
                      });
                      if (!date) return;
                      try {
                        await addScheduleEvent({
                          type: 'other',
                          title: `💰 수금: ${customer.name} (${(customer.unpaid||0).toLocaleString()}원)`,
                          date,
                          startTime: '09:00',
                          endTime: '09:30',
                          allDay: false,
                          alarm: 60,
                          repeat: 'none',
                          memo: `미수금 ${(customer.unpaid||0).toLocaleString()}원 수금 예정`,
                          linkedCustomerId: customer.id,
                          sharedWith: [],
                        }, currentUser?.visibleId || currentUser?.id, currentUser?.name);
                        Swal.fire({ toast: true, position: 'top', icon: 'success', title: '수금 일정이 스케쥴러에 등록됐어요!', timer: 2000, showConfirmButton: false });
                      } catch(e) {
                        Swal.fire('오류', '등록 실패: ' + e.message, 'error');
                      }
                    }}
                    style={{
                      width: '100%', padding: '7px', background: '#fef2f2',
                      color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 'bold'
                    }}
                  >
                    💰 수금일정 등록 ({(customer.unpaid||0).toLocaleString()}원)
                  </button>
                </div>
              )}

              {/* 해약고객 전용: 견적서 작성 버튼 */}
              {customer.custStatus === '해약' && (
                <div style={{marginTop:'10px'}} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      // 견적 탭으로 이동 (props 콜백 사용)
                      if (onNavigateToQuote) onNavigateToQuote('quote');
                    }}
                    style={{
                      width: '100%', padding: '8px', background: '#eff6ff',
                      color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '13px', fontWeight: 'bold'
                    }}
                  >
                    📄 재견적서 작성
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 페이지네이션 버튼 */}
      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button 
            onClick={() => setCurrentPage(1)} 
            disabled={currentPage === 1}
            style={{...styles.pageBtn, opacity: currentPage === 1 ? 0.5 : 1}}
          >
            ⏮️
          </button>
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
            disabled={currentPage === 1}
            style={{...styles.pageBtn, opacity: currentPage === 1 ? 0.5 : 1}}
          >
            ◀️ 이전
          </button>
          <span style={styles.pageInfo}>{currentPage} / {totalPages}</span>
          <button 
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
            disabled={currentPage === totalPages}
            style={{...styles.pageBtn, opacity: currentPage === totalPages ? 0.5 : 1}}
          >
            다음 ▶️
          </button>
          <button 
            onClick={() => setCurrentPage(totalPages)} 
            disabled={currentPage === totalPages}
            style={{...styles.pageBtn, opacity: currentPage === totalPages ? 0.5 : 1}}
          >
            ⏭️
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}

const styles = {
  toolbar: { display:'flex', gap:'8px', marginBottom:'10px', alignItems:'center' },
  searchInput: { flex:1, padding:'10px 12px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px', minWidth:0 },
  filterSelect: { padding:'10px 6px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'13px', maxWidth:'120px', minWidth:'70px' },
  sortSelect: { padding:'10px 6px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'13px', maxWidth:'100px', minWidth:'70px', backgroundColor:'#f8fafc' },
  buttonRow: { display:'flex', gap:'8px', marginBottom:'12px', alignItems:'center' },
  uploadLabel: { padding:'10px 12px', backgroundColor:'#6366f1', color:'white', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px', textAlign:'center', whiteSpace:'nowrap' },
  exportBtn: { padding:'10px 12px', backgroundColor:'#0ea5e9', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap' },
  addButton: { flex:1, padding:'10px', backgroundColor:'#22c55e', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'14px' },
  deleteAllBtn: { padding:'10px 12px', backgroundColor:'#ef4444', color:'white', border:'none', borderRadius:'8px', cursor:'pointer' },
  statsRow: { display:'flex', gap:'8px', marginBottom:'12px' },
  statBox: { flex:1, backgroundColor:'white', padding:'10px 6px', borderRadius:'8px', textAlign:'center', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' },
  statValue: { display:'block', fontSize:'16px', fontWeight:'bold', color:'#2563eb' },
  statLabel: { fontSize:'10px', color:'#666' },
  count: { fontSize:'13px', color:'#666', marginBottom:'8px' },
  list: { display:'flex', flexDirection:'column', gap:'10px' },
  card: { backgroundColor:'white', padding:'14px', borderRadius:'10px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)', cursor:'pointer', WebkitTapHighlightColor:'rgba(59,130,246,0.1)' },
  cardHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' },
  code: { fontSize:'11px', color:'#666', marginRight:'8px', backgroundColor:'#f0f0f0', padding:'2px 6px', borderRadius:'4px' },
  name: { fontSize:'15px', fontWeight:'bold' },
  unpaidBadge: { marginLeft:'5px', fontSize:'11px', color:'#dc2626' },
  status: { padding:'3px 8px', borderRadius:'4px', fontSize:'11px' },
  info: { fontSize:'12px', color:'#666', marginBottom:'2px' },
  servicesBox: { backgroundColor:'#f8f9fa', padding:'8px', borderRadius:'6px', marginTop:'5px', marginBottom:'5px' },
  serviceRow: { display:'flex', alignItems:'center', gap:'8px', marginBottom:'2px', fontSize:'11px' },
  serviceType: { color:'#374151', minWidth:'70px' },
  servicePrice: { color:'#2563eb', fontWeight:'bold' },
  serviceMonths: { color:'#f59e0b', fontSize:'10px' },
  totalRow: { borderTop:'1px solid #e5e7eb', marginTop:'5px', paddingTop:'5px', fontSize:'12px', color:'#374151' },
  tagsRow: { display:'flex', gap:'5px', marginTop:'5px', flexWrap:'wrap' },
  tag: { padding:'2px 8px', borderRadius:'10px', fontSize:'10px' },
  certTargetBadge: { marginTop:'8px', marginRight:'5px', padding:'4px 10px', backgroundColor:'#dcfce7', color:'#166534', borderRadius:'5px', fontSize:'11px', display:'inline-block', border:'1px solid #86efac', fontWeight:'bold' },
  staffBadge: { marginTop:'8px', padding:'5px 10px', backgroundColor:'#dbeafe', color:'#2563eb', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  lastWorkBadge: { marginTop:'5px', marginLeft:'5px', padding:'5px 10px', backgroundColor:'#e0e7ff', color:'#4f46e5', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  coWorkersBadge: { marginTop:'5px', padding:'5px 10px', backgroundColor:'#e0f2fe', color:'#0369a1', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  specialBadge: { marginTop:'5px', padding:'5px 10px', backgroundColor:'#f3e8ff', color:'#7c3aed', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  irregularBadge: { marginTop:'5px', marginBottom:'5px', padding:'5px 10px', backgroundColor:'#fef3c7', color:'#d97706', borderRadius:'5px', fontSize:'11px', display:'inline-block', fontWeight:'bold' },
  equipmentBox: { backgroundColor:'#ecfdf5', padding:'8px', borderRadius:'6px', marginTop:'5px', marginBottom:'5px', border:'1px solid #a7f3d0' },
  equipmentRow: { display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'11px', color:'#059669' },
  equipmentDetail: { fontSize:'10px', color:'#047857' },
  equipmentTotal: { marginTop:'4px', paddingTop:'4px', borderTop:'1px dashed #a7f3d0', fontSize:'11px', color:'#374151', textAlign:'right' },
  loading: { textAlign:'center', padding:'50px', color:'#666' },
  empty: { textAlign:'center', padding:'50px', color:'#999' },
  moreText: { textAlign:'center', padding:'15px', color:'#666', fontSize:'12px' },
  pagination: { display:'flex', justifyContent:'center', alignItems:'center', gap:'10px', marginTop:'20px', marginBottom:'20px' },
  pageBtn: { padding:'8px 15px', border:'1px solid #ddd', borderRadius:'8px', backgroundColor:'white', cursor:'pointer', fontSize:'13px' },
  pageInfo: { padding:'8px 15px', backgroundColor:'#3b82f6', color:'white', borderRadius:'8px', fontWeight:'bold', fontSize:'14px' },
  // 수금관리 스타일
  tabRow: { display:'flex', gap:'8px', marginBottom:'12px' },
  tabBtn: { flex:1, padding:'11px 6px', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px', whiteSpace:'nowrap' },
  paymentHeader: { display:'flex', gap:'8px', marginBottom:'12px', alignItems:'center', flexWrap:'wrap' },
  yearSelect: { padding:'10px 12px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px', fontWeight:'bold' },
  paymentTableWrapper: { overflowX:'auto', backgroundColor:'white', borderRadius:'10px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)', WebkitOverflowScrolling:'touch' },
  paymentTable: { width:'100%', borderCollapse:'collapse', fontSize:'12px' },
  th: { padding:'10px 8px', backgroundColor:'#f1f5f9', borderBottom:'2px solid #e2e8f0', textAlign:'center', fontWeight:'bold', whiteSpace:'nowrap' },
  td: { padding:'8px 6px', borderBottom:'1px solid #e2e8f0', textAlign:'center', whiteSpace:'nowrap' },
  paymentMethodSelect: { padding:'4px', border:'1px solid #ddd', borderRadius:'4px', fontSize:'10px', width:'60px' },
  noteInput: { padding:'4px', border:'1px solid #ddd', borderRadius:'4px', fontSize:'11px', width:'80px' },
  paymentSummary: { marginTop:'15px', padding:'12px', backgroundColor:'#f8fafc', borderRadius:'8px', fontSize:'13px', fontWeight:'bold' }
};

// ─────────────────────────────────────────────────────
// 수금 뷰 — PC: 기존 테이블, 모바일: 카드+월선택형
// ─────────────────────────────────────────────────────
function PaymentView({
  customers, paymentCustomers, paymentDashStats,
  selectedYear, setSelectedYear, selectedPayMonth, setSelectedPayMonth,
  paymentViewMode, setPaymentViewMode,
  dashOpen, setDashOpen, dashDetail, setDashDetail,
  searchTerm, setSearchTerm, isMaster, isMobile,
  getMonthlyPrice, togglePaymentStatus, updatePaymentMethod,
  exportPaymentExcel, importPaymentExcel, importLoading, setCustomers,
}) {
  const fileRef = React.useRef(null);
  const curMonth = new Date().getMonth() + 1;

  // ── 결제방법 팝업 (모바일용) ──
  const handlePayTagClick = async (customerId, currentMethod) => {
    const opts = PAYMENT_METHODS.map(m =>
      `<option value="${m.value}" ${m.value===currentMethod?'selected':''}>${m.label||'-'}</option>`
    ).join('');
    const { value } = await Swal.fire({
      title: '결제방법 변경',
      html: `<select id="pay-sel" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;">${opts}</select>`,
      showCancelButton:true, confirmButtonText:'저장', cancelButtonText:'취소',
      preConfirm: () => document.getElementById('pay-sel')?.value,
    });
    if (value !== undefined) await updatePaymentMethod(customerId, value);
  };

  const {
    autoRate, collectionRate,
    unpaidCustomers, totalUnpaid,
    unpaid1m, unpaid2_3, unpaid3p,
    monthlyRates, byMethod, byStaff,
  } = paymentDashStats;
  // 결제방법 색상 매핑 (실제 DB값 기반)
  const getMethodColor = (key) => {
    if (!key || key === '미등록') return '#ef4444';
    const k = key.toLowerCase();
    if (k.includes('자동')) return '#059669';
    if (k.includes('카드')) return '#3b82f6';
    if (k.includes('현금') || k.includes('현카')) return '#f59e0b';
    if (k.includes('송금')) return '#8b5cf6';
    return '#64748b';
  };

  // ── 공통 헤더 ──
  const Header = () => (
    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12, alignItems:'center' }}>
      <input placeholder="🔍 검색" value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
        style={{ flex:1, minWidth:120, padding: isMobile?'7px 10px':'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize: isMobile?12:14 }} />
      <select value={selectedYear} onChange={e=>setSelectedYear(parseInt(e.target.value))}
        style={{ padding: isMobile?'7px 10px':'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize: isMobile?12:14, fontWeight:'bold' }}>
        {[2024,2025,2026,2027,2028].map(y=><option key={y} value={y}>{y}년</option>)}
      </select>
      <button onClick={exportPaymentExcel}
        style={{ padding: isMobile?'7px 10px':'10px 14px', background:'#059669', color:'white', border:'none', borderRadius:8, fontSize: isMobile?11:13, fontWeight:'bold', cursor:'pointer' }}>
        📥 {isMobile?'':'엑셀 '}내보내기
      </button>
      {isMaster && (
        <>
          <button onClick={()=>fileRef.current?.click()} disabled={importLoading}
            style={{ padding: isMobile?'7px 10px':'10px 14px', background: importLoading?'#94a3b8':'#3b82f6', color:'white', border:'none', borderRadius:8, fontSize: isMobile?11:13, fontWeight:'bold', cursor:'pointer' }}>
            📤 {importLoading?'처리중...':(isMobile?'업로드':'나이스/신한 업로드')}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
            onChange={e=>{ importPaymentExcel(e.target.files[0]); e.target.value=''; }} />
        </>
      )}
    </div>
  );

  // ── 수금 대시보드 (공통) ──
  // ── 미납 고객 문자 발송 ──────────────────────────────────
  const handleSendSMS = async () => {
    const withPhone    = unpaidCustomers.filter(c => c.phone);
    const withoutPhone = unpaidCustomers.filter(c => !c.phone);
    if (unpaidCustomers.length === 0) {
      Swal.fire('알림', '미납 고객이 없습니다.', 'info'); return;
    }
    const checkboxes = unpaidCustomers.map(c =>
      `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;cursor:pointer;">
        <input type="checkbox" value="${c.id}" ${c.phone?'checked':''} style="width:16px;height:16px;">
        <span style="flex:1;">${c.name}</span>
        ${c.phone
          ? `<span style="color:#3b82f6;font-size:11px;">${c.phone}</span>`
          : `<span style="color:#ef4444;font-size:11px;">번호없음</span>`
        }
        <span style="color:#ef4444;font-size:11px;font-weight:bold;">${(c.unpaid||0).toLocaleString()}원</span>
      </label>`
    ).join('');

    const { isConfirmed } = await Swal.fire({
      title: '📱 미납 고객 알림',
      html: `<div style="text-align:left;">
        ${withoutPhone.length>0?`<div style="background:#fef2f2;padding:8px 10px;border-radius:8px;margin-bottom:8px;font-size:12px;color:#ef4444;">⚠️ 전화번호 없음: ${withoutPhone.map(c=>c.name).join(', ')}</div>`:''}
        <div style="max-height:280px;overflow-y:auto;">${checkboxes}</div>
        <div style="margin-top:10px;background:#eff6ff;padding:8px 10px;border-radius:8px;font-size:12px;color:#1e40af;">
          📝 발송 메시지: 안녕하세요. 미수금 정리를 부탁드립니다. - 화이트라인
        </div>
      </div>`,
      showCancelButton: true,
      confirmButtonText: '✅ 선택 고객 문자 발송',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      preConfirm: () => {
        const checked = [...document.querySelectorAll('input[type=checkbox]:checked')].map(el => el.value);
        return checked;
      },
    });
    if (!isConfirmed) return;
    const { value: ids } = await Swal.getPopupCompletely?.() || { value: [] };
    const selected = unpaidCustomers.filter(c => c.phone &&
      document.querySelector(`input[value="${c.id}"]:checked`));
    if (selected.length === 0) { Swal.fire('알림','선택된 고객이 없습니다.','info'); return; }
    const phones  = selected.map(c => c.phone.replace(/[^0-9]/g,'')).join(',');
    const msg     = `안녕하세요. ${selectedYear}년 미수금 정리를 부탁드립니다. - 화이트라인`;
    window.open(`sms:${phones}?body=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── 결제방법 표준화 도우미 ─────────────────────────────────
  const handleStandardize = async () => {
    // 자동 매핑 규칙
    const rules = [
      { pattern: /자동|auto/i,   standard: '자동이체(통장)' },
      { pattern: /카드/i,        standard: '자동이체(카드)' },
      { pattern: /현카|현장카드/i,standard: '현장카드' },
      { pattern: /현금/i,        standard: '현금' },
      { pattern: /송금/i,        standard: '송금' },
    ];
    const toConvert = [];
    customers.filter(c=>c.custStatus==='정상').forEach(c => {
      const m = c.paymentMethod?.trim();
      if (!m) return;
      const alreadyStandard = PAYMENT_METHODS.map(p=>p.value).includes(m);
      if (alreadyStandard) return;
      const rule = rules.find(r => r.pattern.test(m));
      if (rule) toConvert.push({ customer: c, from: m, to: rule.standard });
    });
    if (toConvert.length === 0) {
      Swal.fire('완료', '모든 결제방법이 이미 표준화되어 있어요!', 'success'); return;
    }
    // 그룹별로 보여주기
    const groups = {};
    toConvert.forEach(({ from, to }) => {
      const k = `${from} → ${to}`;
      groups[k] = (groups[k]||0) + 1;
    });
    const groupHtml = Object.entries(groups).map(([k,cnt])=>
      `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
        <span>${k}</span><span style="font-weight:bold;color:#1e40af;">${cnt}개</span>
      </div>`
    ).join('');
    const { isConfirmed } = await Swal.fire({
      title: '🔧 결제방법 표준화',
      html: `<div style="text-align:left;">
        <p style="font-size:12px;color:#6b7280;margin-bottom:10px;">아래 변환을 진행합니다:</p>
        <div style="max-height:250px;overflow-y:auto;">${groupHtml}</div>
        <p style="font-size:11px;color:#f59e0b;margin-top:10px;">⚠️ 총 ${toConvert.length}개 고객의 결제방법이 변경됩니다.</p>
      </div>`,
      showCancelButton: true,
      confirmButtonText: `${toConvert.length}개 일괄 변환`,
      cancelButtonText: '취소',
      confirmButtonColor: '#059669',
    });
    if (!isConfirmed) return;
    Swal.fire({ title:'변환 중...', allowOutsideClick:false, didOpen:()=>Swal.showLoading() });
    let done = 0;
    for (const { customer, to } of toConvert) {
      try {
        await updatePaymentMethod(customer.id, to);
        done++;
      } catch(e) { console.warn(e); }
    }
    Swal.fire({ icon:'success', title:'완료!', text:`${done}개 변환 완료`, timer:2000, showConfirmButton:false });
  };

  // ── Dashboard 컴포넌트 ────────────────────────────────────
  const Dashboard = () => {
    const [staffOpen, setStaffOpen] = React.useState(false);
    const fs = isMobile ? { lbl:9, num:16, body:12 } : { lbl:11, num:22, body:13 };

    return (
      <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, marginBottom:12, overflow:'hidden' }}>
        {/* 헤더 */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding: isMobile?'10px 14px':'14px 18px', cursor:'pointer', background:'#f8fafc' }}
          onClick={()=>{ setDashOpen(v=>!v); setDashDetail(null); }}>
          <span style={{ fontSize: isMobile?13:15, fontWeight:'bold', color:'#1e293b' }}>💰 수금 대시보드</span>
          <span style={{ fontSize:12, color:'#3b82f6', fontWeight:'bold' }}>{dashOpen?'▲ 접기':'▼ 펼치기'}</span>
        </div>

        {/* ── 요약 4칸 ── */}
        <div style={{ display:'flex', borderTop:'1px solid #f1f5f9' }}>
          {[
            { label:'미수고객',   val:`${unpaidCustomers.length}명`,                    color:'#ef4444' },
            { label:'총미수금',   val:`${(totalUnpaid/10000).toFixed(0)}만원`,          color:'#ef4444' },
            { label:'자동이체율', val:`${autoRate}%`,                                    color:'#059669' },
            { label:'수금율',     val:`${collectionRate}%`,                              color:'#3b82f6' },
          ].map((item, i) => (
            <div key={item.label} style={{ flex:1, textAlign:'center', padding: isMobile?'8px 2px':'12px 4px', borderRight: i<3?'1px solid #e5e7eb':'none' }}>
              <div style={{ fontSize:fs.lbl, color:'#94a3b8', marginBottom:3 }}>{item.label}</div>
              <div style={{ fontSize:fs.num, fontWeight:'bold', color:item.color }}>{item.val}</div>
            </div>
          ))}
        </div>

        {/* ── 펼친 상세 ── */}
        {dashOpen && (
          <div style={{ padding: isMobile?'10px 14px':'14px 18px' }}>

            {/* ① 결제방법별 (실제 DB값) */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:fs.body, fontWeight:'bold', color:'#374151', marginBottom:6 }}>💳 결제방법별 현황</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {Object.entries(byMethod).map(([key, list]) => {
                  const color = getMethodColor(key);
                  const isActive = dashDetail === `method_${key}`;
                  return (
                    <div key={key}
                      style={{ background: isActive?color+'22':'#f8fafc', border:`1px solid ${isActive?color:'#e2e8f0'}`, borderRadius:8, padding:'7px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}
                      onClick={()=>setDashDetail(isActive?null:`method_${key}`)}>
                      <span style={{ fontSize:fs.body, color:'#374151', fontWeight:'500' }}>{key}</span>
                      <span style={{ fontSize: isMobile?15:18, fontWeight:'bold', color }}>{list.length}</span>
                    </div>
                  );
                })}
              </div>
              {dashDetail?.startsWith('method_') && (
                <CustomerDetailList
                  title={`${dashDetail.replace('method_','')} 고객`}
                  customers={byMethod[dashDetail.replace('method_','')] || []}
                  fs={fs}
                />
              )}
            </div>

            {/* ② 미수금 기간별 */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:fs.body, fontWeight:'bold', color:'#374151', marginBottom:6 }}>📅 미수금 기간별</div>
              <div style={{ display:'flex', gap:6 }}>
                {[
                  { key:'unpaid_1m',  label:'1개월',   list:unpaid1m,  color:'#f59e0b' },
                  { key:'unpaid_23',  label:'2~3개월', list:unpaid2_3, color:'#ef4444' },
                  { key:'unpaid_3p',  label:'3개월+',  list:unpaid3p,  color:'#dc2626' },
                ].map(({ key, label, list, color }) => {
                  const isActive = dashDetail === key;
                  return (
                    <div key={key}
                      style={{ flex:1, background: isActive?color+'22':'#f8fafc', border:`1px solid ${isActive?color:'#e2e8f0'}`, borderRadius:8, padding:'8px', cursor:'pointer', textAlign:'center' }}
                      onClick={()=>setDashDetail(isActive?null:key)}>
                      <div style={{ fontSize:fs.lbl+1, color:'#6b7280', marginBottom:3 }}>{label}</div>
                      <div style={{ fontSize:fs.num, fontWeight:'bold', color }}>{list.length}명</div>
                      <div style={{ fontSize:fs.lbl, color:'#94a3b8' }}>
                        {(list.reduce((s,c)=>s+(c.unpaid||0),0)/10000).toFixed(0)}만원
                      </div>
                    </div>
                  );
                })}
              </div>
              {dashDetail === 'unpaid_1m'  && <CustomerDetailList title="1개월 미수 고객"   customers={unpaid1m}  showUnpaid fs={fs} />}
              {dashDetail === 'unpaid_23'  && <CustomerDetailList title="2~3개월 미수 고객" customers={unpaid2_3} showUnpaid fs={fs} />}
              {dashDetail === 'unpaid_3p'  && <CustomerDetailList title="3개월+ 미수 고객"  customers={unpaid3p}  showUnpaid fs={fs} />}
            </div>

            {/* ③ 수금율 추이 */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:fs.body, fontWeight:'bold', color:'#374151', marginBottom:8 }}>📈 최근 6개월 수금율</div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:60 }}>
                {monthlyRates.map(({ month, rate }, i) => {
                  const isLast = i === monthlyRates.length - 1;
                  return (
                    <div key={month} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                      <div style={{ fontSize: isMobile?9:10, fontWeight:'bold', color: isLast?'#1e40af':'#374151' }}>{rate}%</div>
                      <div style={{ width:'100%', background: isLast?'#3b82f6':rate>=90?'#10b981':rate>=70?'#f59e0b':'#ef4444', borderRadius:'3px 3px 0 0', height:`${Math.max(rate*0.44,4)}px`, transition:'height 0.3s' }} />
                      <div style={{ fontSize: isMobile?8:9, color:'#94a3b8' }}>{month}월</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ④ 담당자별 수금현황 */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <span style={{ fontSize:fs.body, fontWeight:'bold', color:'#374151' }}>👤 담당자별 수금현황</span>
                <button onClick={()=>setStaffOpen(v=>!v)}
                  style={{ fontSize:11, color:'#3b82f6', background:'none', border:'none', cursor:'pointer' }}>
                  {staffOpen?'▲':'▼'}
                </button>
              </div>
              {staffOpen && (
                <div style={{ background:'#f8fafc', borderRadius:8, overflow:'hidden' }}>
                  {Object.entries(byStaff).sort((a,b)=>b[1].unpaidAmt-a[1].unpaidAmt).map(([name, s]) => (
                    <div key={name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', borderBottom:'1px solid #e2e8f0', fontSize:fs.body }}>
                      <span style={{ fontWeight:'bold', color:'#374151' }}>👤 {name}</span>
                      <div style={{ display:'flex', gap:12, fontSize: isMobile?11:12 }}>
                        <span style={{ color:'#6b7280' }}>담당 {s.total}명</span>
                        {s.unpaid > 0 && <span style={{ color:'#ef4444', fontWeight:'bold' }}>미수 {s.unpaid}명 ({(s.unpaidAmt/10000).toFixed(0)}만원)</span>}
                        {s.unpaid === 0 && <span style={{ color:'#059669' }}>✅ 미수없음</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ⑤ 액션 버튼들 */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <button onClick={handleSendSMS}
                style={{ flex:1, minWidth:120, padding:'9px 12px', background:'#eff6ff', color:'#1e40af', border:'1px solid #bfdbfe', borderRadius:8, fontSize: isMobile?12:13, fontWeight:'bold', cursor:'pointer' }}>
                📱 미납 고객 알림
              </button>
              {isMaster && (
                <button onClick={handleStandardize}
                  style={{ flex:1, minWidth:120, padding:'9px 12px', background:'#f0fdf4', color:'#059669', border:'1px solid #bbf7d0', borderRadius:8, fontSize: isMobile?12:13, fontWeight:'bold', cursor:'pointer' }}>
                  🔧 결제방법 표준화
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════
  // PC 뷰: 기존 테이블 방식 (개선)
  // ════════════════════════════════════════
  if (!isMobile) {
    return (
      <div>
        <Header />
        <Dashboard />
        {/* PC 테이블 */}
        <div style={{ overflowX:'auto', background:'white', borderRadius:12, boxShadow:'0 2px 8px rgba(0,0,0,0.08)', WebkitOverflowScrolling:'touch' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
            <thead>
              <tr>
                <th style={{ padding:'12px 10px', background:'#f1f5f9', borderBottom:'2px solid #e2e8f0', textAlign:'center', fontWeight:'bold', whiteSpace:'nowrap', position:'sticky', left:0, zIndex:3, minWidth:70 }}>코드</th>
                <th style={{ padding:'12px 10px', background:'#f1f5f9', borderBottom:'2px solid #e2e8f0', textAlign:'center', fontWeight:'bold', whiteSpace:'nowrap', position:'sticky', left:70, zIndex:3, minWidth:120 }}>결제방법</th>
                <th style={{ padding:'12px 10px', background:'#f1f5f9', borderBottom:'2px solid #e2e8f0', textAlign:'center', fontWeight:'bold', whiteSpace:'nowrap', position:'sticky', left:190, zIndex:3, minWidth:140 }}>고객명</th>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>(
                  <th key={m} style={{ padding:'12px 10px', background: m===curMonth?'#dbeafe':'#f1f5f9', borderBottom:'2px solid #e2e8f0', textAlign:'center', fontWeight:'bold', minWidth:90, color: m===curMonth?'#1e40af':'inherit' }}>{m}월</th>
                ))}
                <th style={{ padding:'12px 10px', background:'#f1f5f9', borderBottom:'2px solid #e2e8f0', textAlign:'center', fontWeight:'bold', minWidth:120 }}>비고</th>
              </tr>
            </thead>
            <tbody>
              {paymentCustomers.map((customer, idx) => {
                const payments = customer.payments?.[selectedYear] || {};
                const hasUnpaid = (customer.unpaid||0) > 0;
                return (
                  <tr key={customer.id} style={{ background: idx%2===0?'white':'#fafafa' }}>
                    <td style={{ padding:'10px', position:'sticky', left:0, background: idx%2===0?'white':'#fafafa', fontWeight:'bold', fontSize:12, color:'#6b7280', borderBottom:'1px solid #e2e8f0' }}>
                      {customer.code}
                    </td>
                    <td style={{ padding:'10px', position:'sticky', left:70, background: idx%2===0?'white':'#fafafa', borderBottom:'1px solid #e2e8f0' }}>
                      <select value={customer.paymentMethod||''} onChange={e=>updatePaymentMethod(customer.id, e.target.value)}
                        style={{ padding:'6px 8px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:12, width:'100%', cursor:'pointer' }}>
                        {PAYMENT_METHODS.map(m=><option key={m.value} value={m.value}>{m.label||'-'}</option>)}
                      </select>
                      {AUTO_METHODS.includes(customer.paymentMethod) && (
                        <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:4 }}>
                          <input
                            type="number" min="1" max="31"
                            value={customer.paymentDay || ''}
                            placeholder="이체일"
                            onChange={e => {
                              const v = e.target.value ? Number(e.target.value) : null;
                              setCustomers(prev => prev.map(c => c.id === customer.id ? { ...c, paymentDay: v } : c));
                            }}
                            onBlur={async e => {
                              const v = e.target.value ? Number(e.target.value) : null;
                              try { await updateDoc(doc(db, 'customers', customer.id), { paymentDay: v }); }
                              catch(err) { console.error(err); }
                            }}
                            style={{ width:52, padding:'3px 6px', border:'1px solid #d1d5db', borderRadius:5, fontSize:11 }}
                          />
                          <span style={{ fontSize:11, color:'#6b7280' }}>일</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding:'10px', position:'sticky', left:190, background: idx%2===0?'white':'#fafafa', fontWeight:'bold', fontSize:14, borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>
                      {customer.name}
                      {hasUnpaid && <span style={{ marginLeft:6, fontSize:11, color:'#ef4444', fontWeight:'normal' }}>미수 {(customer.unpaid||0).toLocaleString()}원</span>}
                    </td>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>{
                      const wmd = customer.workMonthsData || {};
                      const isActive = wmd[m]?.enabled !== false;
                      if (!isActive) return (
                        <td key={m} style={{ padding:'10px', background:'#f3f4f6', color:'#9ca3af', textAlign:'center', borderBottom:'1px solid #e2e8f0', fontSize:13 }}>-</td>
                      );
                      const isPaid = (payments[m]?.paid !== false);
                      const price = getMonthlyPrice(customer, m);
                      const isCur = m === curMonth;
                      return (
                        <td key={m} onClick={()=>togglePaymentStatus(customer.id, m, isPaid)}
                          style={{ padding:'10px', background: isPaid?(isCur?'#f0fdf4':'#f8fffe'):'#fef2f2', cursor:'pointer', textAlign:'center', borderBottom:'1px solid #e2e8f0', transition:'background 0.1s' }}>
                          <div style={{ color: isPaid?'#16a34a':'#dc2626', fontWeight:'bold', fontSize:13 }}>
                            {!isPaid && '🔴 '}{price.toLocaleString()}
                          </div>
                          {isCur && <div style={{ fontSize:9, color:'#94a3b8', marginTop:1 }}>이번달</div>}
                        </td>
                      );
                    })}
                    <td style={{ padding:'10px', borderBottom:'1px solid #e2e8f0' }}>
                      <input type="text" value={customer.paymentNote||''} placeholder="메모"
                        onChange={e=>setCustomers(prev=>prev.map(c=>c.id===customer.id?{...c,paymentNote:e.target.value}:c))}
                        onBlur={async e=>{
                          try { const { updateDoc: ud, doc: d } = await import('firebase/firestore');
                            const { db: fdb } = await import('../firebase');
                            await ud(d(fdb,'customers',customer.id),{paymentNote:e.target.value});
                          } catch(err) { console.error(err); }
                        }}
                        style={{ padding:'6px 8px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:12, width:100 }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* PC 요약 */}
        <div style={{ marginTop:12, padding:'12px 16px', background:'white', borderRadius:10, fontSize:14, fontWeight:'bold', display:'flex', gap:20, flexWrap:'wrap' }}>
          <span>총 <b style={{color:'#1e40af'}}>{paymentCustomers.length}</b>개 업체</span>
          <span style={{color:'#dc2626'}}>미수금: <b>{paymentCustomers.reduce((s,c)=>s+(c.unpaid||0),0).toLocaleString()}</b>원</span>
          <span style={{color:'#059669'}}>자동이체: <b>{paymentCustomers.filter(c=>AUTO_METHODS.includes(c.paymentMethod)).length}</b>개</span>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════
  // 모바일 뷰: 카드형 + 월선택형
  // ════════════════════════════════════════
  const payTagStyle = (method) => ({
    fontSize:10, padding:'2px 8px', borderRadius:12, cursor:'pointer',
    background: AUTO_METHODS.includes(method)?'#f0fdf4':'#eff6ff',
    color: AUTO_METHODS.includes(method)?'#059669':'#1e40af',
    border:`0.5px solid ${AUTO_METHODS.includes(method)?'#bbf7d0':'#bfdbfe'}`,
    fontWeight:'bold',
  });

  return (
    <div style={{ paddingBottom:20 }}>
      <Header />
      <Dashboard />

      {/* A/B 탭 */}
      <div style={{ display:'flex', gap:6, marginBottom:10 }}>
        <button style={{ flex:1, padding:'8px 0', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:'bold', background:paymentViewMode==='card'?'#1e40af':'#f1f5f9', color:paymentViewMode==='card'?'white':'#64748b' }}
          onClick={()=>setPaymentViewMode('card')}>📋 카드형</button>
        <button style={{ flex:1, padding:'8px 0', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:'bold', background:paymentViewMode==='month'?'#1e40af':'#f1f5f9', color:paymentViewMode==='month'?'white':'#64748b' }}
          onClick={()=>setPaymentViewMode('month')}>📅 월선택형</button>
      </div>

      {/* A안: 카드형 */}
      {paymentViewMode==='card' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {paymentCustomers.map(c=>{
            const hasUnpaid=(c.unpaid||0)>0;
            const payments=c.payments?.[selectedYear]||{};
            return (
              <div key={c.id} style={{ background:'white', borderRadius:10, padding:'10px 12px', border:`1px solid ${hasUnpaid?'#fecaca':'#e2e8f0'}`, borderLeft:`3px solid ${hasUnpaid?'#ef4444':'#e2e8f0'}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                  <div>
                    <span style={{ fontSize:13, fontWeight:'bold', color:'#1e293b' }}>{c.name}</span>
                    <span style={{ fontSize:10, color:'#94a3b8', marginLeft:6 }}>{c.code}</span>
                    {hasUnpaid && <span style={{ marginLeft:6, fontSize:10, color:'#ef4444', fontWeight:'bold' }}>미수 {(c.unpaid||0).toLocaleString()}원</span>}
                  </div>
                  <span style={payTagStyle(c.paymentMethod)} onClick={()=>handlePayTagClick(c.id,c.paymentMethod)}>
                    {c.paymentMethod||'미등록'}{AUTO_METHODS.includes(c.paymentMethod) && c.paymentDay ? ` ${c.paymentDay}일` : ''} ✏️
                  </span>
                </div>
                <div style={{ display:'flex', gap:3, overflowX:'auto', paddingBottom:2 }}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>{
                    const wmd=c.workMonthsData||{};
                    const active=wmd[m]?.enabled!==false;
                    if (!active) return (
                      <div key={m} style={{ flexShrink:0, width:28, textAlign:'center' }}>
                        <div style={{ fontSize:8, color:'#94a3b8' }}>{m}월</div>
                        <div style={{ fontSize:11, color:'#d1d5db' }}>-</div>
                      </div>
                    );
                    const isPaid=(payments[m]?.paid!==false);
                    const isCur=m===curMonth;
                    return (
                      <div key={m} style={{ flexShrink:0, width:28, textAlign:'center', cursor:'pointer' }}
                        onClick={()=>togglePaymentStatus(c.id,m,isPaid)}>
                        <div style={{ fontSize:8, color: isCur?'#3b82f6':'#94a3b8' }}>{m}월</div>
                        <div style={{ fontSize:11, fontWeight:'bold', color: isCur?'#3b82f6':isPaid?'#059669':'#ef4444' }}>{isPaid?'✓':'✗'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* B안: 월선택형 */}
      {paymentViewMode==='month' && (
        <div>
          <div style={{ display:'flex', gap:4, marginBottom:10, overflowX:'auto', paddingBottom:2 }}>
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>(
              <button key={m} style={{ flexShrink:0, padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:'bold', border:'none', cursor:'pointer', background:selectedPayMonth===m?'#1e40af':'#f1f5f9', color:selectedPayMonth===m?'white':'#64748b' }}
                onClick={()=>setSelectedPayMonth(m)}>{m}월</button>
            ))}
          </div>
          <div style={{ fontSize:11, color:'#6b7280', marginBottom:8 }}>{selectedYear}년 {selectedPayMonth}월 · {paymentCustomers.length}명</div>
          {paymentCustomers.map(c=>{
            const wmd=c.workMonthsData||{};
            if (wmd[selectedPayMonth]?.enabled===false) return null;
            const isPaid=(c.payments?.[selectedYear]?.[selectedPayMonth]?.paid!==false);
            const price=getMonthlyPrice(c,selectedPayMonth);
            return (
              <div key={c.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #f1f5f9' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:'bold', color:'#1e293b' }}>
                    {c.name}<span style={{ fontSize:10, color:'#94a3b8', marginLeft:4 }}>{c.code}</span>
                  </div>
                  <div style={{ display:'flex', gap:4, marginTop:2, alignItems:'center' }}>
                    <span style={payTagStyle(c.paymentMethod)} onClick={()=>handlePayTagClick(c.id,c.paymentMethod)}>
                      {c.paymentMethod||'미등록'}{AUTO_METHODS.includes(c.paymentMethod) && c.paymentDay ? ` ${c.paymentDay}일` : ''} ✏️
                    </span>
                    <span style={{ fontSize:10, color:'#6b7280' }}>{price.toLocaleString()}원</span>
                  </div>
                </div>
                <button onClick={()=>togglePaymentStatus(c.id,selectedPayMonth,isPaid)}
                  style={{ padding:'6px 14px', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:'bold', background:isPaid?'#f0fdf4':'#fef2f2', color:isPaid?'#059669':'#ef4444' }}>
                  {isPaid?'✓ 납부':'✗ 미납'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────
// 대시보드 고객 리스트 (공통)
// ─────────────────────────────────────────────────────
function CustomerDetailList({ title, customers, showUnpaid, fs }) {
  const f = fs || { lbl:11, num:18, body:13 };
  if (!customers.length) return null;
  return (
    <div style={{ marginTop:8, maxHeight:220, overflowY:'auto', background:'#f8fafc', borderRadius:8, padding:'8px 12px' }}>
      <div style={{ fontSize:f.body, fontWeight:'bold', color:'#374151', marginBottom:6 }}>
        {title} ({customers.length}명)
      </div>
      {customers.map(c => (
        <div key={c.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #e2e8f0', fontSize:f.body }}>
          <div>
            <span style={{ fontWeight:'500' }}>{c.name}</span>
            <span style={{ fontSize:f.lbl, color:'#94a3b8', marginLeft:6 }}>{c.code}</span>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {c.staffName && <span style={{ fontSize:f.lbl, color:'#6b7280' }}>{c.staffName}</span>}
            {showUnpaid && c.unpaid > 0 && (
              <span style={{ fontSize:f.lbl+1, color:'#ef4444', fontWeight:'bold' }}>
                {(c.unpaid||0).toLocaleString()}원
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 수익성 분석 모달
// ─────────────────────────────────────────────────────
function ProfitabilityModal({ customer, currentUser, onClose }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [period, setPeriod] = React.useState('6'); // 최근 N개월

  React.useEffect(() => { loadData(); }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const fromDate = new Date(now);
      fromDate.setMonth(fromDate.getMonth() - parseInt(period));
      const fromStr = fromDate.toISOString().split('T')[0];

      const { getDocs: gd, collection: col, query: q, where: w } = await import('firebase/firestore');
      const { db: fdb } = await import('../firebase');

      const custCode = customer.code || customer.id;
      const [evSnap, certSnap, schSnap] = await Promise.all([
        gd(q(col(fdb,'events'), w('customerCode','==',custCode))),
        gd(q(col(fdb,'certLogs'), w('customerId','==',customer.id))),
        gd(q(col(fdb,'scheduleEvents'), w('linkedCustomerId','==',customer.id))),
      ]);

      const events = evSnap.docs.map(d=>d.data()).filter(e => (e.date||'') >= fromStr);
      const done   = events.filter(e => e.status==='완료'||e.status==='야근');
      const noWork = events.filter(e => e.status==='미작업');
      const claims = schSnap.docs.map(d=>d.data()).filter(e => e.type==='claim' && (e.date||'')>=fromStr);

      // 월별 실적
      const monthMap = {};
      done.forEach(e => {
        const ym = (e.date||'').substring(0,7);
        if (!monthMap[ym]) monthMap[ym] = { done:0, revenue:0 };
        monthMap[ym].done++;
        monthMap[ym].revenue += Number(e.price)||0;
      });
      const monthlyData = Object.entries(monthMap).sort((a,b)=>a[0].localeCompare(b[0]));

      // 월 평균 매출
      const totalRevenue = done.reduce((s,e)=>s+(Number(e.price)||0),0);
      const avgMonthly   = monthlyData.length > 0 ? Math.round(totalRevenue / monthlyData.length) : 0;

      // 연간 예상 매출
      const monthlyFee = customer.services?.reduce((s,sv)=>s+(sv.price||0),0) || customer.price || 0;
      const yearlyEst  = monthlyFee * 12;

      setData({
        totalWork:   events.length,
        doneCount:   done.length,
        noWorkCount: noWork.length,
        claimCount:  claims.length,
        certCount:   certSnap.docs.length,
        completionRate: events.length > 0 ? Math.round(done.length/events.length*100) : 0,
        totalRevenue,
        avgMonthly,
        yearlyEst,
        monthlyData,
        monthlyFee,
        unpaid: customer.unpaid || 0,
      });
    } catch(e) {
      console.error('수익성 분석 오류:', e);
    }
    setLoading(false);
  };

  const S = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:4500,display:'flex',alignItems:'flex-end',justifyContent:'center' },
    sheet:   { background:'white',borderRadius:'20px 20px 0 0',width:'100%',maxWidth:480,maxHeight:'88vh',overflowY:'auto',padding:'20px 16px 40px' },
    card:    (color,bg) => ({ background:bg,borderRadius:10,padding:'12px 14px',borderLeft:`3px solid ${color}`,marginBottom:8 }),
    num:     (color) => ({ fontSize:22,fontWeight:'bold',color }),
    label:   { fontSize:11,color:'#6b7280',marginTop:2 },
    bar:     (pct,color) => ({ height:8,borderRadius:4,background:'#e5e7eb',overflow:'hidden',marginTop:6,position:'relative' }),
    barFill: (pct,color) => ({ height:'100%',width:`${Math.min(pct,100)}%`,background:color,borderRadius:4,transition:'width 0.5s' }),
    closeBtn:{ width:'100%',padding:12,background:'#f1f5f9',color:'#64748b',border:'none',borderRadius:10,fontSize:14,cursor:'pointer',marginTop:16 },
  };

  return (
    <div style={S.overlay} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={S.sheet}>
        <div style={{width:40,height:4,background:'#d1d5db',borderRadius:2,margin:'0 auto 16px'}} />
        <div style={{fontSize:16,fontWeight:'bold',color:'#1e293b',marginBottom:4}}>📈 수익성 분석</div>
        <div style={{fontSize:13,color:'#a16207',fontWeight:'bold',marginBottom:12,background:'#fef9c3',padding:'8px 12px',borderRadius:8}}>
          {customer.name} ({customer.code}) | 월 {(data?.monthlyFee||0).toLocaleString()}원
        </div>

        {/* 기간 선택 */}
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          {['3','6','12'].map(m=>(
            <button key={m}
              onClick={()=>setPeriod(m)}
              style={{flex:1,padding:'7px 0',border:'none',borderRadius:8,background:period===m?'#f59e0b':'#f1f5f9',color:period===m?'white':'#64748b',fontWeight:'bold',fontSize:13,cursor:'pointer'}}>
              최근 {m}개월
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{textAlign:'center',padding:'30px',color:'#94a3b8'}}>분석 중...</div>
        ) : data ? (
          <>
            {/* 핵심 지표 */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
              <div style={S.card('#3b82f6','#eff6ff')}>
                <div style={S.num('#3b82f6')}>{data.doneCount}건</div>
                <div style={S.label}>완료 작업</div>
              </div>
              <div style={S.card('#059669','#f0fdf4')}>
                <div style={S.num('#059669')}>{data.completionRate}%</div>
                <div style={S.label}>완료율</div>
                <div style={S.bar(data.completionRate,'#059669')}>
                  <div style={S.barFill(data.completionRate,'#059669')} />
                </div>
              </div>
              <div style={S.card('#8b5cf6','#faf5ff')}>
                <div style={S.num('#8b5cf6')}>{(data.avgMonthly||0).toLocaleString()}원</div>
                <div style={S.label}>월 평균 매출</div>
              </div>
              <div style={S.card('#f59e0b','#fef9c3')}>
                <div style={S.num('#f59e0b')}>{(data.yearlyEst||0).toLocaleString()}원</div>
                <div style={S.label}>연간 예상 매출</div>
              </div>
            </div>

            {/* 클레임/미수금 */}
            {(data.claimCount > 0 || data.unpaid > 0) && (
              <div style={{background:'#fee2e2',borderRadius:10,padding:'10px 14px',marginBottom:12}}>
                <div style={{fontWeight:'bold',color:'#dc2626',marginBottom:6,fontSize:13}}>⚠️ 주의 항목</div>
                {data.claimCount > 0 && <div style={{fontSize:12,color:'#991b1b',marginBottom:4}}>🔧 클레임 {data.claimCount}건 (최근 {period}개월)</div>}
                {data.unpaid > 0 && <div style={{fontSize:12,color:'#991b1b'}}>💰 미수금 {data.unpaid.toLocaleString()}원</div>}
              </div>
            )}

            {/* 월별 매출 */}
            {data.monthlyData.length > 0 && (
              <div style={{background:'#f8fafc',borderRadius:10,padding:'10px 14px',marginBottom:12}}>
                <div style={{fontWeight:'bold',color:'#374151',marginBottom:8,fontSize:13}}>📊 월별 매출</div>
                {data.monthlyData.map(([ym, d]) => {
                  const pct = data.avgMonthly > 0 ? Math.round(d.revenue/data.avgMonthly*100) : 0;
                  return (
                    <div key={ym} style={{marginBottom:6}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:2}}>
                        <span style={{color:'#6b7280'}}>{ym}</span>
                        <span style={{fontWeight:'bold',color:'#1e293b'}}>{d.revenue.toLocaleString()}원 ({d.done}건)</span>
                      </div>
                      <div style={{height:6,background:'#e5e7eb',borderRadius:3}}>
                        <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:'#3b82f6',borderRadius:3}} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}

        <button style={S.closeBtn} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 약속 잡기 모달 (고객카드에서 바로 스케쥴 등록)
// ─────────────────────────────────────────────────────
function AppointmentModal({ customer, currentUser, staffList, onClose }) {
  const EVENT_TYPE_OPTIONS = [
    { value: 'quote',   icon: '📋', label: '견적' },
    { value: 'claim',   icon: '🔧', label: '클레임' },
    { value: 'consult', icon: '💬', label: '상담' },
    { value: 'other',   icon: '📌', label: '기타' },
  ];

  const [form, setForm] = React.useState({
    type:      'consult',
    date:      new Date().toISOString().split('T')[0],
    startTime: '10:00',
    endTime:   '11:00',
    memo:      '',
    alarm:     30,
    sharedWith: [],
  });
  const [saving, setSaving] = React.useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.date) { Swal.fire('오류', '날짜를 선택해주세요.', 'warning'); return; }
    setSaving(true);
    try {
      const typeInfo = EVENT_TYPE_OPTIONS.find(t => t.value === form.type) || EVENT_TYPE_OPTIONS[0];
      await addScheduleEvent({
        ...form,
        title: `${typeInfo.icon} ${typeInfo.label}: ${customer.name || customer.custName}`,
        allDay: false,
        repeat: 'none',
        repeatEndDate: '',
        linkedCustomerId: customer.id,
        linkedCustomerName: customer.name || customer.custName,
      }, currentUser?.visibleId || currentUser?.id, currentUser?.name);

      onClose();
      Swal.fire({ toast: true, position: 'top', icon: 'success', title: '📅 스케쥴에 등록됐어요!', timer: 2000, showConfirmButton: false });
    } catch(e) {
      Swal.fire('오류', '저장 실패: ' + e.message, 'error');
    }
    setSaving(false);
  };

  const S = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:4500,display:'flex',alignItems:'flex-end',justifyContent:'center' },
    sheet:   { background:'white',borderRadius:'20px 20px 0 0',width:'100%',maxWidth:480,padding:'20px 16px 40px',maxHeight:'85vh',overflowY:'auto' },
    label:   { fontSize:12,color:'#6b7280',marginBottom:4,display:'block' },
    input:   { width:'100%',padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:8,fontSize:14,boxSizing:'border-box' },
    row:     { display:'flex',gap:8,marginBottom:12 },
    typeBtn: (active,color) => ({ flex:1,padding:'8px 4px',border:`2px solid ${active?color:'#e2e8f0'}`,borderRadius:8,background:active?color:'white',color:active?'white':'#374151',cursor:'pointer',fontSize:12,fontWeight:'bold',textAlign:'center' }),
    saveBtn: { width:'100%',padding:14,background:'#3b82f6',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:'bold',cursor:'pointer',marginTop:8 },
  };

  return (
    <div style={S.overlay} onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div style={S.sheet}>
        <div style={{ width:40,height:4,background:'#d1d5db',borderRadius:2,margin:'0 auto 16px' }} />
        <div style={{ fontSize:16,fontWeight:'bold',color:'#1e293b',marginBottom:4 }}>
          🗓️ 약속 잡기
        </div>
        <div style={{ fontSize:13,color:'#3b82f6',fontWeight:'bold',marginBottom:16,background:'#eff6ff',padding:'8px 12px',borderRadius:8 }}>
          👤 {customer.name || customer.custName} ({customer.code})
          {customer.phone && <span style={{marginLeft:8,color:'#6b7280',fontSize:12}}>{customer.phone}</span>}
        </div>

        {/* 유형 */}
        <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginBottom:12 }}>
          {EVENT_TYPE_OPTIONS.map(t => (
            <button key={t.value}
              style={S.typeBtn(form.type===t.value,'#3b82f6')}
              onClick={() => set('type',t.value)}>
              {t.icon}<br/>{t.label}
            </button>
          ))}
        </div>

        {/* 날짜/시간 */}
        <div style={S.row}>
          <div style={{ flex:1 }}>
            <span style={S.label}>날짜</span>
            <input type="date" style={S.input} value={form.date} onChange={e => set('date',e.target.value)} />
          </div>
        </div>
        <div style={S.row}>
          <div style={{ flex:1 }}>
            <span style={S.label}>시작</span>
            <input type="time" style={S.input} value={form.startTime} onChange={e => set('startTime',e.target.value)} />
          </div>
          <div style={{ flex:1 }}>
            <span style={S.label}>종료</span>
            <input type="time" style={S.input} value={form.endTime} onChange={e => set('endTime',e.target.value)} />
          </div>
        </div>

        {/* 알림 */}
        <div style={{ marginBottom:12 }}>
          <span style={S.label}>🔔 알림</span>
          <select style={S.input} value={form.alarm} onChange={e => set('alarm',Number(e.target.value))}>
            <option value={0}>알림 없음</option>
            <option value={10}>10분 전</option>
            <option value={30}>30분 전</option>
            <option value={60}>1시간 전</option>
          </select>
        </div>

        {/* 메모 */}
        <div style={{ marginBottom:16 }}>
          <span style={S.label}>📝 메모</span>
          <textarea style={{ ...S.input,resize:'vertical',minHeight:60 }}
            placeholder="메모 (선택)" value={form.memo}
            onChange={e => set('memo',e.target.value)} />
        </div>

        <button style={S.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : '✅ 스케쥴 등록'}
        </button>
        <button style={{ ...S.saveBtn,background:'#f1f5f9',color:'#64748b',marginTop:6 }} onClick={onClose}>취소</button>
      </div>
    </div>
  );
}

export default CustomerList;
