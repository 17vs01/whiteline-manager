import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

function CustomerList({ currentUser, staffList }) {
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('default'); // 정렬 분리
  const [loading, setLoading] = useState(true);

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

        let headerRow = 0;
        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const row = jsonData[i];
          if (row && row.some(cell => String(cell).includes('고객코드') || String(cell).includes('고객명'))) {
            headerRow = i;
            break;
          }
        }

        let i = headerRow + 1;
        while (i < jsonData.length) {
          const row = jsonData[i];
          if (!row || row.length < 2) { skipCount++; i++; continue; }

          const code = row[0];
          const name = row[1];

          if (!name || String(name).trim() === '' || 
              String(name).includes('고객명') || 
              String(name).includes('매출월')) {
            skipCount++; i++; continue;
          }

          let services = [];
          const mainServiceType = String(row[6] || '').replace(/\n/g, '/');
          const mainPrice = parsePrice(row[7]);
          const mainServiceMonth = String(row[9] || '');
          
          if (mainServiceType || mainPrice > 0) {
            services.push({ type: mainServiceType || '일반', price: mainPrice, months: mainServiceMonth });
          }

          let nextIdx = i + 1;
          while (nextIdx < jsonData.length) {
            const nextRow = jsonData[nextIdx];
            if (nextRow && !nextRow[1] && (nextRow[6] || nextRow[7])) {
              const extraServiceType = String(nextRow[6] || '');
              const extraPrice = parsePrice(nextRow[7]);
              const extraMonths = String(nextRow[9] || '');
              if (extraServiceType || extraPrice > 0) {
                services.push({ type: extraServiceType || '추가', price: extraPrice, months: extraMonths });
              }
              nextIdx++;
            } else {
              break;
            }
          }

          const contractPeriod = String(row[2] || '');
          const status = parseContractStatus(contractPeriod);

          const customerData = {
            code: String(code || ''),
            name: String(name).trim(),
            contractPeriod: contractPeriod,
            paymentMethod: String(row[3] || ''),
            phone: String(row[4] || '').replace(/\n/g, ' / '),
            area: String(row[5] || ''),
            services: services,
            winterPrice: parsePrice(row[8]),
            ceoName: String(row[10] || ''),
            businessNumber: String(row[11] || ''),
            email: String(row[12] || ''),
            address: String(row[13] || ''),
            zipCode: String(row[14] || ''),
            memo: String(row[15] || ''),
            status: status,
            custStatus: status,
            workMonths: [1,2,3,4,5,6,7,8,9,10,11,12],
            tags: [],
            staffId: '',
            staffName: '',
            unpaid: 0,
            claim: '',
            // 공동작업자 (다중)
            coWorkers: [],
            // 특별작업
            specialWork: null,
            // 루트세일
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

    // 작업월 체크박스
    let currentMonths = customer.workMonths;
    if (!Array.isArray(currentMonths)) {
      currentMonths = [1,2,3,4,5,6,7,8,9,10,11,12];
    }
    let monthGridHtml = '';
    for (let i = 1; i <= 12; i++) {
      monthGridHtml += `<div class="month-check ${currentMonths.includes(i) ? 'checked' : ''}" onclick="this.classList.toggle('checked')" data-val="${i}">${i}월</div>`;
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

    // 상태 버튼
    let statusBtns = '';
    if (customer.custStatus === '해약') {
      statusBtns = `<button onclick="window.openRecontract('${customer.id}')" style="width:100%;padding:10px;background:#22c55e;color:white;border:none;margin-top:5px;border-radius:5px;">🔄 재계약</button>`;
    } else if (customer.custStatus !== '삭제') {
      statusBtns = `<button onclick="window.openCancel('${customer.id}')" style="width:100%;padding:10px;background:#ef4444;color:white;border:none;margin-top:5px;border-radius:5px;">🚫 해약</button>`;
    }
    if (customer.custStatus !== '삭제') {
      statusBtns += `<button onclick="window.softDelete('${customer.id}')" style="width:100%;padding:10px;background:#64748b;color:white;border:none;margin-top:5px;border-radius:5px;">🗑️ 삭제</button>`;
    }

    const { value: formValues, isDenied } = await Swal.fire({
      title: customer.name,
      html: `
        <div style="text-align:left;max-height:450px;overflow-y:auto;font-size:13px;">
          <div style="display:flex;gap:10px;margin-bottom:8px;">
            <div style="flex:1;"><label style="font-size:11px;color:#666;">고객코드</label>
              <input id="swal-code" class="swal2-input" value="${customer.code || ''}" style="margin:3px 0;font-size:13px;"></div>
            <div style="flex:2;"><label style="font-size:11px;color:#666;">고객명</label>
              <input id="swal-name" class="swal2-input" value="${customer.name || ''}" style="margin:3px 0;font-size:13px;"></div>
          </div>
          <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">연락처</label>
            <input id="swal-phone" class="swal2-input" value="${customer.phone || ''}" style="margin:3px 0;font-size:13px;"></div>
          <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">주소</label>
            <input id="swal-address" class="swal2-input" value="${customer.address || ''}" style="margin:3px 0;font-size:13px;"></div>
          
          <div style="margin-bottom:8px;background:#f8f9fa;padding:10px;border-radius:8px;">
            <label style="font-size:11px;color:#666;font-weight:bold;">💰 서비스 내역</label>
            <div id="services-container">${servicesHtml}</div>
          </div>
          
          <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">📅 작업월</label>
            <div class="month-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-top:5px;">${monthGridHtml}</div>
            <button type="button" onclick="document.querySelectorAll('.month-check').forEach(el=>el.classList.toggle('checked'))" style="width:100%;padding:5px;background:#ddd;border:none;border-radius:4px;margin-top:5px;font-size:11px;">전체 선택/해제</button>
          </div>
          
          <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">🏷️ 태그</label>
            <div style="margin-top:5px;font-size:12px;">${tagHtml}</div>
          </div>
          
          <div style="display:flex;gap:10px;margin-bottom:8px;">
            <div style="flex:1;"><label style="font-size:11px;color:#666;">담당자</label>
              <select id="swal-staff" class="swal2-select" style="width:100%;padding:8px;margin:3px 0;font-size:13px;">
                <option value="">-- 선택 --</option>${staffOptions}</select></div>
            <div style="flex:1;"><label style="font-size:11px;color:#666;">상태</label>
              <select id="swal-status" class="swal2-select" style="width:100%;padding:8px;margin:3px 0;font-size:13px;">
                <option value="정상" ${customer.custStatus === '정상' ? 'selected' : ''}>정상</option>
                <option value="해약" ${customer.custStatus === '해약' ? 'selected' : ''}>해약</option>
              </select></div>
          </div>
          
          <!-- 공동작업자 섹션 (다중선택) -->
          <div style="margin-bottom:8px;background:#e0f2fe;padding:10px;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <label style="font-size:12px;color:#0369a1;font-weight:bold;">👥 공동작업자</label>
              <button type="button" onclick="window.addCoWorker()" style="padding:4px 10px;background:#3b82f6;color:white;border:none;border-radius:4px;font-size:11px;">+ 추가</button>
            </div>
            <div id="coworkers-list">
              ${coWorkersArray.map((cw, idx) => `
                <div class="coworker-item" style="display:flex;gap:5px;margin-bottom:5px;align-items:center;">
                  <select class="coworker-staff" style="flex:2;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;">
                    <option value="">-- 선택 --</option>${staffList.map(s => `<option value="${s.name}" ${cw.staffName === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
                  </select>
                  <input class="coworker-price" type="number" value="${cw.price || 0}" placeholder="금액" style="flex:1;padding:6px;font-size:12px;border:1px solid #ddd;border-radius:4px;">
                  <button type="button" onclick="this.parentElement.remove()" style="padding:4px 8px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:11px;">✕</button>
                </div>
              `).join('')}
            </div>
            <p style="font-size:10px;color:#666;margin:5px 0 0;">※ 여러 명 추가 가능, 각각 금액 설정</p>
          </div>
          
          <!-- 루트세일 섹션 -->
          <div style="margin-bottom:8px;background:#fef3c7;padding:10px;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <label style="font-size:12px;color:#92400e;font-weight:bold;">🎯 루트세일 (새고객영업)</label>
              <label class="toggle-switch" style="position:relative;display:inline-block;width:44px;height:24px;">
                <input type="checkbox" id="swal-routesale-toggle" ${customer.routeSale?.enabled ? 'checked' : ''} onchange="
                  document.getElementById('routesale-detail').style.display = this.checked ? 'block' : 'none';
                  this.nextElementSibling.style.backgroundColor = this.checked ? '#f59e0b' : '#ccc';
                " style="opacity:0;width:0;height:0;">
                <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.routeSale?.enabled ? '#f59e0b' : '#ccc'};transition:.3s;border-radius:24px;"></span>
              </label>
            </div>
            <div id="routesale-detail" style="display:${customer.routeSale?.enabled ? 'block' : 'none'};">
              <select id="swal-routesale-staff" class="swal2-select" style="width:100%;padding:8px;font-size:12px;">
                <option value="">-- 영업직원 선택 --</option>${routeSaleOptions}
              </select>
              <p style="font-size:10px;color:#666;margin:5px 0 0;">※ 인센티브: 2개월완료 시 20%, 1년유지 후 추가 10%</p>
            </div>
          </div>
          
          <!-- 특별작업 섹션 -->
          <div style="margin-bottom:8px;background:#f3e8ff;padding:10px;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <label style="font-size:12px;color:#7c3aed;font-weight:bold;">🌟 특별작업</label>
              <label class="toggle-switch" style="position:relative;display:inline-block;width:44px;height:24px;">
                <input type="checkbox" id="swal-special-toggle" ${customer.specialWork ? 'checked' : ''} onchange="
                  document.getElementById('special-detail').style.display = this.checked ? 'block' : 'none';
                  this.nextElementSibling.style.backgroundColor = this.checked ? '#7c3aed' : '#ccc';
                " style="opacity:0;width:0;height:0;">
                <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:${customer.specialWork ? '#7c3aed' : '#ccc'};transition:.3s;border-radius:24px;"></span>
              </label>
            </div>
            <div id="special-detail" style="display:${customer.specialWork ? 'block' : 'none'};">
              <div style="margin-bottom:8px;">
                <label style="font-size:10px;color:#666;">종류</label>
                <select id="swal-special-type" class="swal2-select" style="width:100%;padding:8px;font-size:12px;">
                  <option value="추가작업" ${customer.specialWork?.type === '추가작업' ? 'selected' : ''}>추가작업</option>
                  <option value="고객클레임" ${customer.specialWork?.type === '고객클레임' ? 'selected' : ''}>고객클레임</option>
                  <option value="상담업무" ${customer.specialWork?.type === '상담업무' ? 'selected' : ''}>상담업무</option>
                  <option value="수금활동" ${customer.specialWork?.type === '수금활동' ? 'selected' : ''}>수금활동</option>
                </select>
              </div>
              <div style="margin-bottom:8px;">
                <label style="font-size:10px;color:#666;">담당자</label>
                <select id="swal-special-staff" class="swal2-select" style="width:100%;padding:8px;font-size:12px;">
                  <option value="">-- 담당자 선택 --</option>${staffList.map(s => `<option value="${s.name}" ${customer.specialWork?.staffName === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
                </select>
              </div>
              <div style="margin-bottom:8px;">
                <label style="font-size:10px;color:#666;">작업 횟수</label>
                <input id="swal-special-count" class="swal2-input" type="number" value="${customer.specialWork?.totalCount || 1}" min="1" style="margin:3px 0;font-size:12px;padding:6px;">
              </div>
              
              <!-- 특별작업 공동작업자 -->
              <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #c4b5fd;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <label style="font-size:10px;color:#666;">공동작업자</label>
                  <button type="button" onclick="window.addSpecialCoWorker()" style="padding:3px 8px;background:#7c3aed;color:white;border:none;border-radius:4px;font-size:10px;">+ 추가</button>
                </div>
                <div id="special-coworkers-list">
                  ${(customer.specialWork?.coWorkers || []).map((cw, idx) => `
                    <div class="special-coworker-item" style="display:flex;gap:5px;margin-bottom:5px;align-items:center;">
                      <select class="special-coworker-staff" style="flex:2;padding:5px;font-size:11px;border:1px solid #ddd;border-radius:4px;">
                        <option value="">-- 선택 --</option>${staffList.map(s => `<option value="${s.name}" ${cw.staffName === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
                      </select>
                      <input class="special-coworker-price" type="number" value="${cw.price || 0}" placeholder="금액" style="flex:1;padding:5px;font-size:11px;border:1px solid #ddd;border-radius:4px;">
                      <button type="button" onclick="this.parentElement.remove()" style="padding:3px 6px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:10px;">✕</button>
                    </div>
                  `).join('')}
                </div>
              </div>
              
              <div style="font-size:10px;color:#666;margin-top:8px;">
                완료: ${customer.specialWork?.completedCount || 0} / 총: ${customer.specialWork?.totalCount || 0}회
              </div>
            </div>
          </div>
          
          <div style="display:flex;gap:10px;margin-bottom:8px;">
            <div style="flex:1;"><label style="font-size:11px;color:#666;">미수금</label>
              <input id="swal-unpaid" class="swal2-input" type="number" value="${customer.unpaid || 0}" style="margin:3px 0;font-size:13px;"></div>
            <div style="flex:1;"><label style="font-size:11px;color:#666;">클레임/AS</label>
              <input id="swal-claim" class="swal2-input" value="${customer.claim || ''}" style="margin:3px 0;font-size:13px;"></div>
          </div>
          
          <div style="margin-bottom:8px;"><label style="font-size:11px;color:#666;">📝 메모</label>
            <textarea id="swal-memo" class="swal2-textarea" style="margin:3px 0;font-size:13px;height:60px;">${customer.memo || ''}</textarea></div>
          
          ${statusBtns}
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '저장',
      denyButtonText: '삭제',
      cancelButtonText: '닫기',
      denyButtonColor: '#ef4444',
      width: '95%',
      didOpen: () => {
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
        
        // 직원 목록 옵션 HTML
        const staffOptionsHtml = staffList.map(s => '<option value="' + s.name + '">' + s.name + '</option>').join('');
        
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
      },
      preConfirm: () => {
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
        
        // 작업월 수집
        const selectedMonths = [];
        document.querySelectorAll('.month-check.checked').forEach(el => {
          selectedMonths.push(parseInt(el.getAttribute('data-val')));
        });
        
        // 태그 수집
        const selectedTags = [];
        document.querySelectorAll('.tag-check:checked').forEach(el => {
          selectedTags.push(el.value);
        });

        // 공동작업자 데이터 수집 (다중)
        const coWorkersData = [];
        document.querySelectorAll('.coworker-item').forEach(item => {
          const staffName = item.querySelector('.coworker-staff').value;
          const price = Number(item.querySelector('.coworker-price').value) || 0;
          if (staffName) {
            coWorkersData.push({ staffName, price });
          }
        });
        
        // 루트세일 데이터 수집
        const routeSaleEnabled = document.getElementById('swal-routesale-toggle').checked;
        const existingRouteSale = customer.routeSale || {};
        const routeSaleData = routeSaleEnabled ? {
          enabled: true,
          staffName: document.getElementById('swal-routesale-staff').value,
          registeredAt: existingRouteSale.registeredAt || new Date().toISOString().split('T')[0],
          firstIncentivePaid: existingRouteSale.firstIncentivePaid || false,
          secondIncentivePaid: existingRouteSale.secondIncentivePaid || false,
          completedMonths: existingRouteSale.completedMonths || 0,
          incentiveHistory: existingRouteSale.incentiveHistory || []
        } : { enabled: false };

        // 특별작업 데이터 수집
        const specialEnabled = document.getElementById('swal-special-toggle').checked;
        const existingSpecial = customer.specialWork || {};
        
        // 특별작업 공동작업자 수집
        const specialCoWorkersData = [];
        document.querySelectorAll('.special-coworker-item').forEach(item => {
          const staffName = item.querySelector('.special-coworker-staff').value;
          const price = Number(item.querySelector('.special-coworker-price').value) || 0;
          if (staffName) {
            specialCoWorkersData.push({ staffName, price });
          }
        });
        
        const specialWorkData = specialEnabled ? {
          type: document.getElementById('swal-special-type').value,
          staffName: document.getElementById('swal-special-staff').value,
          totalCount: Number(document.getElementById('swal-special-count').value) || 1,
          completedCount: existingSpecial.completedCount || 0,
          coWorkers: specialCoWorkersData
        } : null;

        return {
          code: document.getElementById('swal-code').value,
          name: document.getElementById('swal-name').value,
          phone: document.getElementById('swal-phone').value,
          address: document.getElementById('swal-address').value,
          services: services,
          workMonths: selectedMonths.length > 0 ? selectedMonths : [1,2,3,4,5,6,7,8,9,10,11,12],
          tags: selectedTags,
          staffName: document.getElementById('swal-staff').value,
          custStatus: document.getElementById('swal-status').value,
          unpaid: Number(document.getElementById('swal-unpaid').value) || 0,
          claim: document.getElementById('swal-claim').value,
          memo: document.getElementById('swal-memo').value,
          coWorkers: coWorkersData,
          routeSale: routeSaleData,
          specialWork: specialWorkData
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
      try {
        await updateDoc(doc(db, 'customers', customer.id), formValues);
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

  // 재계약
  window.openRecontract = async (customerId) => {
    Swal.close();
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;

    let staffOpts = '<option value="">담당자 선택 (필수)</option>';
    staffList.forEach(s => { staffOpts += `<option value="${s.name}">${s.name}</option>`; });
    const today = new Date().toISOString().split('T')[0];

    const { value: formValues, isConfirmed } = await Swal.fire({
      title: '🔄 재계약',
      html: `
        <div style="text-align:left;padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:15px;">
          <div><b>${customer.name}</b></div>
          <div style="font-size:12px;color:#666;">📍 ${customer.address || '-'}</div>
        </div>
        <div style="text-align:left;margin-bottom:5px;font-weight:bold;">📅 재계약 날짜</div>
        <input id="swal-recontract-date" type="date" class="swal2-input" value="${today}">
        <div style="text-align:left;margin-bottom:5px;margin-top:10px;font-weight:bold;">👤 담당자</div>
        <select id="swal-recontract-staff" class="swal2-input">${staffOpts}</select>
      `,
      showCancelButton: true,
      confirmButtonText: '재계약',
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
        await updateDoc(doc(db, 'customers', customerId), {
          custStatus: '정상',
          staffName: formValues.staff,
          recontractDate: formValues.date
        });
        Swal.fire('완료', '재계약 처리되었습니다', 'success');
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

  const handleAdd = async () => {
    const staffOptions = staffList.map(s => `<option value="${s.name}">${s.name}</option>`).join('');

    const { value: formValues } = await Swal.fire({
      title: '고객 등록',
      html: `
        <input id="swal-name" class="swal2-input" placeholder="고객명 (필수)">
        <input id="swal-phone" class="swal2-input" placeholder="연락처">
        <input id="swal-address" class="swal2-input" placeholder="주소">
        <input id="swal-price" class="swal2-input" type="number" placeholder="금액">
        <select id="swal-staff" class="swal2-select" style="width:100%;padding:10px;margin-top:10px;">
          <option value="">-- 담당자 선택 --</option>${staffOptions}
        </select>
      `,
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      preConfirm: () => {
        const name = document.getElementById('swal-name').value;
        if (!name) {
          Swal.showValidationMessage('고객명을 입력하세요');
          return false;
        }
        return {
          name: name,
          phone: document.getElementById('swal-phone').value,
          address: document.getElementById('swal-address').value,
          price: Number(document.getElementById('swal-price').value) || 0,
          staffName: document.getElementById('swal-staff').value
        };
      }
    });

    if (formValues) {
      try {
        await addDoc(collection(db, 'customers'), {
          ...formValues,
          code: 'C' + Date.now(),
          services: [{ type: '일반', price: formValues.price, months: '매월' }],
          workMonths: [1,2,3,4,5,6,7,8,9,10,11,12],
          tags: [],
          custStatus: '정상',
          unpaid: 0,
          claim: '',
          memo: '',
          coWorkers: [],
          specialWork: null,
          routeSale: { enabled: false },
          createdAt: new Date().toISOString().split('T')[0]
        });
        Swal.fire('완료', '등록되었습니다!', 'success');
        fetchData();
      } catch (error) {
        Swal.fire('오류', '등록 실패!', 'error');
      }
    }
  };

  const getTotalPrice = (c) => {
    if (c.services && c.services.length > 0) {
      return c.services.reduce((sum, s) => sum + (s.price || 0), 0);
    }
    return c.price || 0;
  };

  const filteredCustomers = customers.filter(c => {
    const matchSearch = 
      (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone || '').includes(searchTerm) ||
      (c.code || '').includes(searchTerm) ||
      (c.address || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchSearch) return false;

    if (filter === 'deleted') return c.custStatus === '삭제';
    if (c.custStatus === '삭제') return false;
    if (filter === 'active') return c.custStatus !== '해약';
    if (filter === 'cancelled') return c.custStatus === '해약';
    if (filter === 'unpaid') return c.unpaid > 0;
    if (filter.startsWith('staff_')) return c.staffName === filter.replace('staff_', '');
    return true;
  });

  // 정렬 (sortBy 기반)
  let sortedCustomers = [...filteredCustomers];
  if (sortBy === 'recent') {
    sortedCustomers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sortBy === 'name') {
    sortedCustomers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (sortBy === 'code-asc') {
    // 고객코드 낮은순 (숫자로 변환 후 비교)
    sortedCustomers.sort((a, b) => {
      const codeA = parseInt(String(a.code || '0').replace(/\D/g, '')) || 0;
      const codeB = parseInt(String(b.code || '0').replace(/\D/g, '')) || 0;
      return codeA - codeB;
    });
  } else if (sortBy === 'code-desc') {
    // 고객코드 높은순 (숫자로 변환 후 비교)
    sortedCustomers.sort((a, b) => {
      const codeA = parseInt(String(a.code || '0').replace(/\D/g, '')) || 0;
      const codeB = parseInt(String(b.code || '0').replace(/\D/g, '')) || 0;
      return codeB - codeA;
    });
  }

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="🔍 검색 (이름, 주소, 전화)"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.filterSelect}>
          <option value="all">전체</option>
          <option value="active">🟢 정상</option>
          <option value="cancelled">🔴 해약</option>
          <option value="unpaid">💰 미수</option>
          <option value="deleted">🗑️ 삭제됨</option>
          <optgroup label="담당자별">
            {staffList.map(s => (
              <option key={s.id} value={`staff_${s.name}`}>👤 {s.name}</option>
            ))}
          </optgroup>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={styles.sortSelect}>
          <option value="default">정렬</option>
          <option value="code-asc">🔢 코드↑</option>
          <option value="code-desc">🔢 코드↓</option>
          <option value="name">🔤 가나다</option>
          <option value="recent">🆕 최근</option>
        </select>
      </div>

      <div style={styles.buttonRow}>
        <label style={styles.uploadLabel}>
          📂 엑셀
          <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} style={{display:'none'}} />
        </label>
        <button onClick={exportToExcel} style={styles.exportBtn}>📥 내보내기</button>
        <button onClick={handleAdd} style={styles.addButton}>+ 등록</button>
        {currentUser.role === 'master' && (
          <button onClick={handleDeleteAll} style={styles.deleteAllBtn}>🗑️</button>
        )}
      </div>

      <div style={styles.statsRow}>
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
      </div>

      <div style={styles.count}>검색결과 {sortedCustomers.length}명</div>

      <div style={styles.list}>
        {sortedCustomers.length === 0 ? (
          <div style={styles.empty}>등록된 고객이 없습니다</div>
        ) : (
          sortedCustomers.slice(0, 100).map(customer => (
            <div key={customer.id} style={styles.card} onClick={() => handleDetail(customer)}>
              <div style={styles.cardHeader}>
                <div>
                  <span style={styles.code}>{customer.code}</span>
                  <span style={styles.name}>{customer.name}</span>
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
              
              {customer.staffName && (
                <div style={styles.staffBadge}>👤 {customer.staffName}</div>
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
            </div>
          ))
        )}
        {sortedCustomers.length > 100 && (
          <div style={styles.moreText}>... 외 {sortedCustomers.length - 100}명</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  toolbar: { display:'flex', gap:'10px', marginBottom:'10px' },
  searchInput: { flex:1, padding:'10px 15px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px' },
  filterSelect: { padding:'10px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px', maxWidth:'120px' },
  sortSelect: { padding:'10px', border:'1px solid #ddd', borderRadius:'8px', fontSize:'14px', maxWidth:'100px', backgroundColor:'#f8fafc' },
  buttonRow: { display:'flex', gap:'10px', marginBottom:'15px' },
  uploadLabel: { padding:'10px 15px', backgroundColor:'#6366f1', color:'white', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px' },
  exportBtn: { padding:'10px 15px', backgroundColor:'#0ea5e9', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer', fontSize:'13px' },
  addButton: { flex:1, padding:'10px', backgroundColor:'#22c55e', color:'white', border:'none', borderRadius:'8px', fontWeight:'bold', cursor:'pointer' },
  deleteAllBtn: { padding:'10px 15px', backgroundColor:'#ef4444', color:'white', border:'none', borderRadius:'8px', cursor:'pointer' },
  statsRow: { display:'flex', gap:'10px', marginBottom:'15px' },
  statBox: { flex:1, backgroundColor:'white', padding:'12px', borderRadius:'8px', textAlign:'center', boxShadow:'0 2px 5px rgba(0,0,0,0.1)' },
  statValue: { display:'block', fontSize:'18px', fontWeight:'bold', color:'#2563eb' },
  statLabel: { fontSize:'11px', color:'#666' },
  count: { fontSize:'13px', color:'#666', marginBottom:'10px' },
  list: { display:'flex', flexDirection:'column', gap:'10px' },
  card: { backgroundColor:'white', padding:'15px', borderRadius:'10px', boxShadow:'0 2px 5px rgba(0,0,0,0.1)', cursor:'pointer' },
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
  staffBadge: { marginTop:'8px', padding:'5px 10px', backgroundColor:'#dbeafe', color:'#2563eb', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  coWorkersBadge: { marginTop:'5px', padding:'5px 10px', backgroundColor:'#e0f2fe', color:'#0369a1', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  specialBadge: { marginTop:'5px', padding:'5px 10px', backgroundColor:'#f3e8ff', color:'#7c3aed', borderRadius:'5px', fontSize:'11px', display:'inline-block' },
  loading: { textAlign:'center', padding:'50px', color:'#666' },
  empty: { textAlign:'center', padding:'50px', color:'#999' },
  moreText: { textAlign:'center', padding:'15px', color:'#666', fontSize:'12px' }
};

export default CustomerList;
