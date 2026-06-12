// =============================================
// ShortTermCustomerTab.js — 단기고객 관리
// 영업탭 서브탭으로 위치
// 기능: 등록/조회/회차관리/수금/정기전환
// =============================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';

// ── 분류 목록 ──────────────────────────────
const CATEGORIES = [
  { key: 'home',      icon: '🏠', label: '가정집' },
  { key: 'small',     icon: '🏪', label: '소규모' },
  { key: 'large',     icon: '🏢', label: '대규모' },
  { key: 'store',     icon: '🛒', label: '상가' },
  { key: 'restaurant',icon: '🍽️', label: '음식점' },
  { key: 'warehouse', icon: '📦', label: '창고·물류' },
  { key: 'etc',       icon: '📋', label: '기타' },
];

// ── 상태 목록 ──────────────────────────────
const STATUS_LIST = [
  { key: 'all',       label: '전체' },
  { key: 'active',    label: '진행중' },
  { key: 'completed', label: '완료' },
  { key: 'converted', label: '정기전환' },
];

// ── 상태 스타일 ────────────────────────────
const STATUS_STYLE = {
  active:    { bg: '#fef9c3', color: '#854d0e', label: '진행중',   icon: '🟡' },
  completed: { bg: '#dcfce7', color: '#166534', label: '완료',     icon: '✅' },
  converted: { bg: '#dbeafe', color: '#1e40af', label: '정기전환', icon: '🔄' },
};

const getCatInfo = (key) => CATEGORIES.find(c => c.key === key) || CATEGORIES[6];

export default function ShortTermCustomerTab({ currentUser, staffList }) {
  const [customers,   setCustomers]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filterCat,   setFilterCat]   = useState('all');
  const [filterStatus,setFilterStatus]= useState('all');
  const [search,      setSearch]      = useState('');
  const [expanded,    setExpanded]    = useState({});

  // ── 실시간 데이터 로드 ──────────────────
  useEffect(() => {
    const q = query(collection(db, 'shortTermCustomers'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => { console.error(err); setLoading(false); });
    return unsub;
  }, []);

  // ── 필터링 ─────────────────────────────
  const filtered = customers.filter(c => {
    if (filterCat    !== 'all' && c.category !== filterCat)       return false;
    if (filterStatus !== 'all' && c.status   !== filterStatus)    return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !c.name?.toLowerCase().includes(q) &&
        !c.phone?.includes(q) &&
        !c.address?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // ── 요약 통계 ──────────────────────────
  const stats = {
    active:    customers.filter(c => c.status === 'active').length,
    completed: customers.filter(c => c.status === 'completed').length,
    converted: customers.filter(c => c.status === 'converted').length,
    unpaid:    customers.filter(c => c.status !== 'converted' && !c.paymentDone).length,
  };
  const convRate = customers.length > 0
    ? Math.round(stats.converted / customers.length * 100) : 0;

  // ── 단기고객 등록 팝업 ──────────────────
  // ── Firestore 저장 ──────────────────────────────────────────────────
  // ⚠️ 다른 함수들이 내부에서 직접 호출하므로 반드시 가장 먼저 선언
  const saveNewCustomer = useCallback(async (formData) => {
    try {
      const sessionList = [{ date: formData.date1, status: 'pending', type: 'paid', memo: '' }];
      if (formData.sessions >= 2 && formData.date2) sessionList.push({ date: formData.date2, status: 'pending', type: 'paid', memo: '' });
      if (formData.sessions >= 3 && formData.date3) sessionList.push({ date: formData.date3, status: 'pending', type: 'paid', memo: '' });
      if (formData.sessions >= 4 && formData.date4) sessionList.push({ date: formData.date4, status: 'pending', type: 'paid', memo: '' });

      const docData = {
        category:    formData.category,
        name:        formData.name,
        phone:       formData.phone   || '',
        address:     formData.address || '',
        area:        formData.area    || '',
        price:       formData.price   || 0,
        pests:       formData.pests   || '',
        staffName:   formData.staffName || currentUser?.name || '',
        staffId:     currentUser?.id  || '',
        sessions:    sessionList,
        totalSessions: formData.sessions,
        paymentDone: formData.paymentDone || false,
        paymentDate: formData.paymentDone ? new Date().toISOString().split('T')[0] : null,
        memo:        formData.memo    || '',
        linkedCustomerId: formData.linkedCustomerId || null,
        status:      'active',
        createdAt:   new Date().toISOString(),
        convertedAt: null,
      };

      const ref = await addDoc(collection(db, 'shortTermCustomers'), docData);
      for (const sess of sessionList) {
        await addDoc(collection(db, 'events'), {
          customerCode: ref.id, customerName: formData.name,
          title: `🟡 ${formData.name}`, date: sess.date, start: sess.date,
          staffName: formData.staffName || currentUser?.name || '',
          price: formData.price || 0, status: '배정',
          isShortTerm: true, shortTermId: ref.id,
          createdAt: new Date().toISOString(),
        });
      }
      Swal.fire({ icon:'success', title:'✅ 등록 완료', timer:1500, showConfirmButton:false });
    } catch (e) {
      console.error(e);
      Swal.fire('오류', '등록에 실패했습니다.', 'error');
    }
  }, [currentUser]);

  // ── 등록 팝업 공통 HTML 빌더 ─────────────────────────────────────────
  const buildRegisterHtml = (prefill = {}, staffOptions, catOptions, today) => `
    <div style="text-align:left;font-size:13px;">
      ${prefill.name ? `<div style="background:#ede9fe;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#6d28d9;font-weight:bold;">📋 ${prefill.name} 정보 불러옴</div>` : ''}
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">분류 *</label>
        <select id="st-category" class="swal2-input" style="margin:4px 0;font-size:13px;">${catOptions}</select>
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">고객명 *</label>
        <input id="st-name" class="swal2-input" value="${prefill.name||''}" placeholder="고객명" style="margin:4px 0;font-size:13px;">
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">전화번호</label>
        <input id="st-phone" class="swal2-input" value="${prefill.phone||''}" placeholder="010-0000-0000" type="tel" style="margin:4px 0;font-size:13px;">
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">주소</label>
        <input id="st-address" class="swal2-input" value="${prefill.address||''}" placeholder="주소" style="margin:4px 0;font-size:13px;">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <div style="flex:1;">
          <label style="font-size:11px;color:#6b7280;font-weight:bold;">면적(㎡)</label>
          <input id="st-area" class="swal2-input" value="${prefill.area||''}" type="number" style="margin:4px 0;font-size:13px;">
        </div>
        <div style="flex:1;">
          <label style="font-size:11px;color:#6b7280;font-weight:bold;">단가(원)</label>
          <input id="st-price" class="swal2-input" value="${prefill.price||''}" type="number" style="margin:4px 0;font-size:13px;">
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">문제해충</label>
        <input id="st-pests" class="swal2-input" value="${prefill.pests||''}" placeholder="바퀴벌레, 쥐 등" style="margin:4px 0;font-size:13px;">
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">담당자</label>
        <select id="st-staff" class="swal2-input" style="margin:4px 0;font-size:13px;">${staffOptions}</select>
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">작업횟수</label>
        <select id="st-sessions" class="swal2-input" style="margin:4px 0;font-size:13px;"
          onchange="const v=parseInt(this.value);
            document.getElementById('st-session2-wrap').style.display=v>=2?'block':'none';
            document.getElementById('st-session3-wrap').style.display=v>=3?'block':'none';
            document.getElementById('st-session4-wrap').style.display=v>=4?'block':'none';">
          <option value="1">1회</option><option value="2">2회</option>
          <option value="3">3회</option><option value="4">4회</option>
        </select>
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">1회차 날짜</label>
        <input id="st-date1" class="swal2-input" type="date" value="${today}" style="margin:4px 0;font-size:13px;">
      </div>
      <div id="st-session2-wrap" style="display:none;margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">2회차 날짜</label>
        <input id="st-date2" class="swal2-input" type="date" style="margin:4px 0;font-size:13px;">
      </div>
      <div id="st-session3-wrap" style="display:none;margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">3회차 날짜</label>
        <input id="st-date3" class="swal2-input" type="date" style="margin:4px 0;font-size:13px;">
      </div>
      <div id="st-session4-wrap" style="display:none;margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">4회차 날짜</label>
        <input id="st-date4" class="swal2-input" type="date" style="margin:4px 0;font-size:13px;">
      </div>
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:#6b7280;font-weight:bold;">메모</label>
        <textarea id="st-memo" class="swal2-textarea" placeholder="메모" style="margin:4px 0;font-size:13px;height:60px;"></textarea>
      </div>
      <div style="padding:10px;background:#fef9c3;border-radius:8px;border:1px solid #fde68a;">
        <div style="font-size:12px;font-weight:bold;color:#92400e;margin-bottom:6px;">💰 수금</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="st-paid" style="width:18px;height:18px;">수금 완료
        </label>
      </div>
    </div>
  `;

  // ── preConfirm 공통 함수 ──────────────────────────────────────────────
  const preConfirmRegister = (linkedCustomerId = null) => () => {
    const name = document.getElementById('st-name')?.value?.trim();
    if (!name) { Swal.showValidationMessage('고객명을 입력해주세요.'); return false; }
    const sessions = parseInt(document.getElementById('st-sessions')?.value || '1');
    const date1 = document.getElementById('st-date1')?.value;
    const date2 = document.getElementById('st-date2')?.value;
    const date3 = document.getElementById('st-date3')?.value;
    const date4 = document.getElementById('st-date4')?.value;
    if (sessions >= 2 && !date2) { Swal.showValidationMessage('2회차 날짜를 입력해주세요.'); return false; }
    if (sessions >= 3 && !date3) { Swal.showValidationMessage('3회차 날짜를 입력해주세요.'); return false; }
    if (sessions >= 4 && !date4) { Swal.showValidationMessage('4회차 날짜를 입력해주세요.'); return false; }
    return {
      category: document.getElementById('st-category')?.value, name,
      phone:    document.getElementById('st-phone')?.value?.trim(),
      address:  document.getElementById('st-address')?.value?.trim(),
      area:     document.getElementById('st-area')?.value,
      price:    parseInt(document.getElementById('st-price')?.value || '0'),
      pests:    document.getElementById('st-pests')?.value?.trim(),
      staffName:document.getElementById('st-staff')?.value,
      sessions, date1,
      date2: sessions >= 2 ? date2 : null,
      date3: sessions >= 3 ? date3 : null,
      date4: sessions >= 4 ? date4 : null,
      memo:  document.getElementById('st-memo')?.value?.trim(),
      paymentDone: document.getElementById('st-paid')?.checked,
      linkedCustomerId,
    };
  };

  // ── 신규 등록 팝업 ───────────────────────────────────────────────────
  const openAddPopup = useCallback(async (prefillDate = null) => {
    const staffOptions = (staffList||[]).map(s=>`<option value="${s.name}" ${s.visibleId===currentUser?.id?'selected':''}>${s.name}</option>`).join('');
    const catOptions   = CATEGORIES.map(c=>`<option value="${c.key}">${c.icon} ${c.label}</option>`).join('');
    const today        = prefillDate || new Date().toISOString().split('T')[0];
    const { value: formData, isConfirmed } = await Swal.fire({
      title:'🟡 단기작업 등록', width:'95%',
      html: buildRegisterHtml({}, staffOptions, catOptions, today),
      showCancelButton:true, confirmButtonText:'등록', cancelButtonText:'취소',
      confirmButtonColor:'#f59e0b',
      preConfirm: preConfirmRegister(null),
    });
    if (!isConfirmed || !formData) return;
    await saveNewCustomer(formData);
  }, [currentUser, staffList, saveNewCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 기존고객 정보 미리채워서 등록 ───────────────────────────────────
  const openAddPopupWithPrefill = useCallback(async (prefill = {}) => {
    const staffOptions = (staffList||[]).map(s=>`<option value="${s.name}" ${s.visibleId===currentUser?.id?'selected':''}>${s.name}</option>`).join('');
    const catOptions   = CATEGORIES.map(c=>`<option value="${c.key}">${c.icon} ${c.label}</option>`).join('');
    const today        = new Date().toISOString().split('T')[0];
    const { value: formData, isConfirmed } = await Swal.fire({
      title:'🟡 단기작업 등록', width:'95%',
      html: buildRegisterHtml(prefill, staffOptions, catOptions, today),
      showCancelButton:true, confirmButtonText:'등록', cancelButtonText:'취소',
      confirmButtonColor:'#f59e0b',
      preConfirm: preConfirmRegister(prefill.id || null),
    });
    if (!isConfirmed || !formData) return;
    await saveNewCustomer(formData);
  }, [currentUser, staffList, saveNewCustomer]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 기존 정기고객 불러오기 ───────────────────────────────────────────
  const openLoadCustomerPopup = useCallback(async () => {
    let custList = [];
    try {
      const snap = await getDocs(query(collection(db, 'customers'), orderBy('name')));
      custList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { Swal.fire('오류', '고객 목록 로드 실패', 'error'); return; }
    if (!custList.length) { Swal.fire('알림', '등록된 정기고객이 없습니다.', 'info'); return; }

    // 항목 HTML 생성 헬퍼
    const makeItemHtml = (list) => list.length === 0
      ? '<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px;">검색 결과가 없어요</div>'
      : list.map(c =>
          `<div class="stci" data-id="${c.id}"
            style="padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;
              cursor:pointer;margin-bottom:6px;background:white;">
            <div class="stcn" style="font-weight:bold;font-size:13px;">${c.name}</div>
            ${c.address ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">📍 ${c.address}</div>` : ''}
            ${c.phone   ? `<div style="font-size:11px;color:#94a3b8;">📞 ${c.phone}</div>` : ''}
          </div>`
        ).join('');

    const { value, isConfirmed } = await Swal.fire({
      title: '📋 기존고객 불러오기',
      width: '92%',
      html: `
        <div style="text-align:left;">
          <input id="stci-search" placeholder="🔍 고객명, 전화번호, 주소 검색"
            style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;
              font-size:13px;box-sizing:border-box;margin-bottom:10px;outline:none;">
          <div id="stci-list" style="max-height:280px;overflow-y:auto;">
            ${makeItemHtml(custList)}
          </div>
          <input type="hidden" id="stci-val" value="">
          <div id="stci-name" style="margin-top:8px;padding:8px 12px;background:#f0fdf4;
            border-radius:8px;font-size:13px;font-weight:bold;color:#059669;min-height:18px;"></div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '불러오기',
      cancelButtonText: '취소',
      confirmButtonColor: '#6366f1',
      didOpen: () => {
        const listEl  = document.getElementById('stci-list');
        const valEl   = document.getElementById('stci-val');
        const nameEl  = document.getElementById('stci-name');
        const srchEl  = document.getElementById('stci-search');

        // 클릭 이벤트 위임
        listEl.addEventListener('click', e => {
          const item = e.target.closest('.stci');
          if (!item) return;
          listEl.querySelectorAll('.stci').forEach(el => {
            el.style.background = 'white';
            el.style.borderColor = '#e2e8f0';
          });
          item.style.background = '#ede9fe';
          item.style.borderColor = '#6366f1';
          valEl.value  = item.dataset.id;
          nameEl.textContent = item.querySelector('.stcn')?.textContent || '';
        });

        // 검색
        srchEl.addEventListener('input', () => {
          const q = srchEl.value.toLowerCase().trim();
          const filtered = q
            ? custList.filter(c =>
                (c.name||'').toLowerCase().includes(q) ||
                (c.phone||'').includes(q) ||
                (c.address||'').toLowerCase().includes(q))
            : custList;
          listEl.innerHTML = makeItemHtml(filtered);
        });

        setTimeout(() => srchEl.focus(), 100);
      },
      preConfirm: () => {
        const id = document.getElementById('stci-val')?.value;
        if (!id) { Swal.showValidationMessage('고객을 선택해주세요.'); return false; }
        return id;
      },
    });

    if (!isConfirmed || !value) return;
    const picked = custList.find(c => c.id === value);
    if (picked) await openAddPopupWithPrefill(picked);
  }, [openAddPopupWithPrefill]);

    // ── 회차 추가 팝업 ──────────────────────
  const openAddSession = async (customer) => {
    const { value, isConfirmed } = await Swal.fire({
      title: `📅 ${customer.name} — 회차 추가`,
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">날짜 *</label>
            <input id="add-date" class="swal2-input" type="date" value="${new Date().toISOString().split('T')[0]}" style="margin:4px 0;">
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">유형 *</label>
            <div style="display:flex;gap:8px;margin-top:6px;">
              <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;"
                onclick="
                  document.getElementById('add-type-paid').checked=true;
                  document.getElementById('add-price-wrap').style.display='block';
                  document.getElementById('add-reason-wrap').style.display='none';
                  this.style.borderColor='#f59e0b'; this.style.background='#fef9c3';
                  document.getElementById('add-type-free-label').style.borderColor='#e2e8f0';
                  document.getElementById('add-type-free-label').style.background='white';
                " id="add-type-paid-label"
                style="border-color:#f59e0b;background:#fef9c3;">
                <input type="radio" id="add-type-paid" name="add-type" value="paid" checked style="display:none;">
                💰 추가 유료
              </label>
              <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;"
                onclick="
                  document.getElementById('add-type-free').checked=true;
                  document.getElementById('add-price-wrap').style.display='none';
                  document.getElementById('add-reason-wrap').style.display='block';
                  this.style.borderColor='#10b981'; this.style.background='#dcfce7';
                  document.getElementById('add-type-paid-label').style.borderColor='#e2e8f0';
                  document.getElementById('add-type-paid-label').style.background='white';
                " id="add-type-free-label">
                <input type="radio" id="add-type-free" name="add-type" value="free" style="display:none;">
                🎁 추가 무료
              </label>
            </div>
          </div>
          <!-- 유료 금액 -->
          <div id="add-price-wrap" style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">금액(원)</label>
            <input id="add-price" class="swal2-input" type="number" placeholder="${customer.price || 0}" value="${customer.price || 0}" style="margin:4px 0;">
          </div>
          <!-- 무료 사유 -->
          <div id="add-reason-wrap" style="display:none;margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">무료 사유</label>
            <input id="add-reason" class="swal2-input" placeholder="AS, 불만처리 등" style="margin:4px 0;">
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">메모</label>
            <input id="add-memo" class="swal2-input" placeholder="메모" style="margin:4px 0;">
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '추가',
      cancelButtonText: '취소',
      confirmButtonColor: '#f59e0b',
      preConfirm: () => {
        const date = document.getElementById('add-date')?.value;
        if (!date) { Swal.showValidationMessage('날짜를 선택해주세요.'); return false; }
        const type  = document.getElementById('add-type-free')?.checked ? 'free' : 'paid';
        const price = type === 'paid' ? parseInt(document.getElementById('add-price')?.value || '0') : 0;
        return { date, type, price, reason: document.getElementById('add-reason')?.value, memo: document.getElementById('add-memo')?.value };
      },
    });
    if (!isConfirmed || !value) return;

    const newSession = { date: value.date, status: 'pending', type: value.type, price: value.price, reason: value.reason || '', memo: value.memo || '' };
    const updated    = [...(customer.sessions || []), newSession];
    await updateDoc(doc(db, 'shortTermCustomers', customer.id), {
      sessions:      updated,
      totalSessions: updated.length,
    });

    // 캘린더 이벤트도 추가
    await addDoc(collection(db, 'events'), {
      customerCode: customer.id,
      customerName: customer.name,
      title:        `🟡 ${customer.name}${value.type === 'free' ? ' (무료)' : ''}`,
      date:         value.date,
      start:        value.date,
      staffName:    customer.staffName || '',
      price:        value.price || 0,
      status:       '배정',
      isShortTerm:  true,
      shortTermId:  customer.id,
      createdAt:    new Date().toISOString(),
    });

    Swal.fire({ icon:'success', title:'✅ 회차 추가됨', timer:1200, showConfirmButton:false });
  };

  // ── 수금 완료 처리 ──────────────────────
  const togglePayment = async (customer) => {
    const newDone = !customer.paymentDone;
    const { isConfirmed } = await Swal.fire({
      title: newDone ? '💰 수금 완료 처리' : '↩️ 수금 취소',
      text:  newDone ? '수금이 완료됐나요?' : '수금 완료를 취소할까요?',
      showCancelButton: true,
      confirmButtonText: '확인',
      cancelButtonText:  '취소',
      confirmButtonColor: newDone ? '#059669' : '#f59e0b',
    });
    if (!isConfirmed) return;
    await updateDoc(doc(db, 'shortTermCustomers', customer.id), {
      paymentDone: newDone,
      paymentDate: newDone ? new Date().toISOString().split('T')[0] : null,
    });
  };

  // ── 정기전환 팝업 ───────────────────────
  const openConvertPopup = async (customer) => {
    const { isConfirmed } = await Swal.fire({
      title: '🔄 정기고객 전환',
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="padding:12px;background:#dbeafe;border-radius:8px;margin-bottom:12px;">
            <div style="font-weight:bold;color:#1e40af;">${customer.name}</div>
            <div style="color:#64748b;font-size:11px;margin-top:4px;">
              단기 작업이력 ${(customer.sessions||[]).length}회가 보존됩니다
            </div>
          </div>
          <div style="font-size:12px;color:#374151;line-height:1.8;">
            ✅ customers 컬렉션에 정식 등록됩니다<br>
            ✅ 단기 작업이력이 연결 보존됩니다<br>
            ✅ 이후 월별작업등록 등 정기고객 관리를 진행하세요
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '전환하기',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
    });
    if (!isConfirmed) return;

    try {
      // customers 컬렉션에 정식 등록
      const newCustomerRef = await addDoc(collection(db, 'customers'), {
        name:           customer.name,
        phone:          customer.phone    || '',
        address:        customer.address  || '',
        area:           customer.area     || '',
        price:          customer.price    || 0,
        staffName:      customer.staffName|| '',
        category:       customer.category || '',
        pests:          customer.pests    || '',
        shortTermId:    customer.id,      // 단기고객 이력 링크
        shortTermSessions: customer.sessions || [],
        createdAt:      new Date().toISOString(),
        type:           'regular',
      });

      // 단기고객 상태 전환 처리
      await updateDoc(doc(db, 'shortTermCustomers', customer.id), {
        status:      'converted',
        convertedAt: new Date().toISOString(),
        convertedCustomerId: newCustomerRef.id,
      });

      Swal.fire({
        icon: 'success',
        title: '🎉 정기전환 완료!',
        html: `<div style="font-size:13px;">${customer.name}님이 정기고객으로 등록됐어요.<br>고객 탭에서 상세 설정을 진행해주세요.</div>`,
        confirmButtonText: '확인',
        confirmButtonColor: '#3b82f6',
      });
    } catch (e) {
      console.error(e);
      Swal.fire('오류', '정기전환에 실패했습니다.', 'error');
    }
  };

  // ── 회차 완료 처리 ──────────────────────
  const toggleSessionDone = async (customer, sessionIdx) => {
    const sessions = [...(customer.sessions || [])];
    const current  = sessions[sessionIdx];
    const newStatus = current.status === 'done' ? 'pending' : 'done';
    const { isConfirmed } = await Swal.fire({
      title: newStatus === 'done' ? `✅ ${sessionIdx+1}회차 완료 처리` : `↩️ ${sessionIdx+1}회차 완료 취소`,
      text:  newStatus === 'done' ? '작업이 완료됐나요?' : '완료 상태를 취소할까요?',
      showCancelButton: true,
      confirmButtonText: '확인',
      cancelButtonText: '취소',
      confirmButtonColor: newStatus === 'done' ? '#059669' : '#f59e0b',
    });
    if (!isConfirmed) return;
    sessions[sessionIdx] = {
      ...current,
      status: newStatus,
      doneAt: newStatus === 'done' ? new Date().toISOString() : null,
    };
    // 모든 회차가 완료되면 전체 상태도 completed로
    const allDone   = sessions.every(s => s.status === 'done');
    const newCustStatus = allDone ? 'completed' : 'active';
    await updateDoc(doc(db, 'shortTermCustomers', customer.id), {
      sessions,
      status: newCustStatus,
    });
  };

  // ── 단기고객 수정 팝업 ──────────────────
  const openEditPopup = async (customer) => {
    const staffOptions = (staffList || [])
      .map(s => `<option value="${s.name}" ${s.name === customer.staffName ? 'selected' : ''}>${s.name}</option>`)
      .join('');
    const catOptions = CATEGORIES.map(c =>
      `<option value="${c.key}" ${c.key === customer.category ? 'selected' : ''}>${c.icon} ${c.label}</option>`
    ).join('');

    const { value: formData, isConfirmed } = await Swal.fire({
      title: '✏️ 단기고객 수정',
      width: '95%',
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">분류 *</label>
            <select id="edit-category" class="swal2-input" style="margin:4px 0;font-size:13px;">${catOptions}</select>
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">고객명 *</label>
            <input id="edit-name" class="swal2-input" value="${customer.name || ''}" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">전화번호</label>
            <input id="edit-phone" class="swal2-input" type="tel" value="${customer.phone || ''}" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">주소</label>
            <input id="edit-address" class="swal2-input" value="${customer.address || ''}" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <div style="flex:1;">
              <label style="font-size:11px;color:#6b7280;font-weight:bold;">면적(㎡)</label>
              <input id="edit-area" class="swal2-input" type="number" value="${customer.area || ''}" style="margin:4px 0;font-size:13px;">
            </div>
            <div style="flex:1;">
              <label style="font-size:11px;color:#6b7280;font-weight:bold;">단가(원)</label>
              <input id="edit-price" class="swal2-input" type="number" value="${customer.price || 0}" style="margin:4px 0;font-size:13px;">
            </div>
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">문제해충</label>
            <input id="edit-pests" class="swal2-input" value="${customer.pests || ''}" style="margin:4px 0;font-size:13px;">
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">담당자</label>
            <select id="edit-staff" class="swal2-input" style="margin:4px 0;font-size:13px;">${staffOptions}</select>
          </div>
          <div style="margin-bottom:10px;">
            <label style="font-size:11px;color:#6b7280;font-weight:bold;">메모</label>
            <textarea id="edit-memo" class="swal2-textarea" style="margin:4px 0;font-size:13px;height:60px;">${customer.memo || ''}</textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '저장',
      cancelButtonText: '취소',
      confirmButtonColor: '#3b82f6',
      preConfirm: () => {
        const name = document.getElementById('edit-name')?.value?.trim();
        if (!name) { Swal.showValidationMessage('고객명을 입력해주세요.'); return false; }
        return {
          category:  document.getElementById('edit-category')?.value,
          name,
          phone:     document.getElementById('edit-phone')?.value?.trim(),
          address:   document.getElementById('edit-address')?.value?.trim(),
          area:      document.getElementById('edit-area')?.value,
          price:     parseInt(document.getElementById('edit-price')?.value || '0'),
          pests:     document.getElementById('edit-pests')?.value?.trim(),
          staffName: document.getElementById('edit-staff')?.value,
          memo:      document.getElementById('edit-memo')?.value?.trim(),
        };
      },
    });
    if (!isConfirmed || !formData) return;
    try {
      await updateDoc(doc(db, 'shortTermCustomers', customer.id), {
        ...formData,
        updatedAt: new Date().toISOString(),
      });
      Swal.fire({ icon:'success', title:'✅ 수정 완료', timer:1200, showConfirmButton:false });
    } catch (e) {
      console.error(e);
      Swal.fire('오류', '수정에 실패했습니다.', 'error');
    }
  };

  // ── 삭제 ────────────────────────────────
  const deleteCustomer = async (customer) => {
    const { isConfirmed } = await Swal.fire({
      title: '삭제 확인',
      text:  `${customer.name}을(를) 삭제할까요?`,
      icon:  'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText:  '취소',
      confirmButtonColor: '#ef4444',
    });
    if (!isConfirmed) return;
    await deleteDoc(doc(db, 'shortTermCustomers', customer.id));
  };

  // ── 고객 카드 렌더링 ────────────────────
  const renderCard = (c) => {
    const catInfo    = getCatInfo(c.category);
    const statusInfo = STATUS_STYLE[c.status] || STATUS_STYLE.active;
    const isExpanded = expanded[c.id];
    const sessions   = c.sessions || [];
    const totalAmount = sessions.reduce((sum, s) => sum + (s.type === 'free' ? 0 : (s.price || c.price || 0)), 0);

    return (
      <div key={c.id} style={{
        background: 'white', borderRadius: 12,
        border: `1.5px solid ${c.status === 'converted' ? '#bfdbfe' : c.paymentDone ? '#bbf7d0' : '#fde68a'}`,
        marginBottom: 10, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        {/* 카드 헤더 */}
        <div
          style={{ padding: '12px 14px', cursor: 'pointer' }}
          onClick={() => setExpanded(p => ({ ...p, [c.id]: !p[c.id] }))}
        >
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                background: statusInfo.bg, color: statusInfo.color,
              }}>
                {statusInfo.icon} {statusInfo.label}
              </span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 20,
                background: '#f1f5f9', color: '#374151',
              }}>
                {catInfo.icon} {catInfo.label}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              {c.createdAt?.slice(0,10)}
            </span>
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{c.name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {c.phone && <span>📞 {c.phone}</span>}
                {c.staffName && <span style={{ marginLeft: 8 }}>👤 {c.staffName}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.paymentDone ? '#059669' : '#f59e0b' }}>
                {c.paymentDone ? '💰 수금완료' : '⏳ 미수금'}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {totalAmount.toLocaleString()}원
              </div>
            </div>
          </div>
          {/* 회차 미리보기 */}
          <div style={{ display:'flex', gap:4, marginTop:8, flexWrap:'wrap' }}>
            {sessions.map((s, i) => (
              <span key={i} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                background: s.status === 'done' ? '#dcfce7' : '#f1f5f9',
                color: s.status === 'done' ? '#166534' : '#374151',
                border: '1px solid ' + (s.status === 'done' ? '#bbf7d0' : '#e2e8f0'),
              }}>
                {i+1}회 {s.type === 'free' ? '🎁' : ''} {s.date}
                {s.status === 'done' ? ' ✅' : ''}
              </span>
            ))}
          </div>
        </div>

        {/* 펼쳐진 상세 */}
        {isExpanded && (
          <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 14px', background: '#fafafa' }}>
            {/* 상세 정보 */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10, fontSize:12, color:'#374151' }}>
              {c.address && <div>📍 {c.address}</div>}
              {c.area    && <div>📐 {c.area}㎡</div>}
              {c.price   && <div>💵 {Number(c.price).toLocaleString()}원</div>}
              {c.pests   && <div>🐛 {c.pests}</div>}
            </div>

            {/* 회차 목록 */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>📋 작업 회차</div>
              {sessions.map((s, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'8px 10px', background:'white', borderRadius:8, marginBottom:4,
                  border:'1px solid #e2e8f0',
                }}>
                  <div>
                    <span style={{ fontSize:12, fontWeight:700, color:'#1e293b' }}>{i+1}회차</span>
                    {s.type === 'free' && <span style={{ marginLeft:6, fontSize:10, color:'#059669', fontWeight:700 }}>🎁 무료</span>}
                    {s.type === 'paid' && s.price && s.price !== c.price && (
                      <span style={{ marginLeft:6, fontSize:10, color:'#f59e0b', fontWeight:700 }}>💰 {Number(s.price).toLocaleString()}원</span>
                    )}
                    <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{s.date}</div>
                    {s.memo && <div style={{ fontSize:11, color:'#94a3b8' }}>{s.memo}</div>}
                  </div>
                  {/* 회차 완료/취소 버튼 */}
                  {c.status !== 'converted' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSessionDone(c, i); }}
                      style={{
                        padding: '5px 10px', border:'none', borderRadius:8, cursor:'pointer',
                        fontSize:11, fontWeight:700,
                        background: s.status === 'done' ? '#f1f5f9' : '#dcfce7',
                        color:      s.status === 'done' ? '#64748b'  : '#166534',
                      }}
                    >
                      {s.status === 'done' ? '↩️ 취소' : '✅ 완료'}
                    </button>
                  ) : (
                    <span style={{ fontSize:18 }}>{s.status === 'done' ? '✅' : '⏳'}</span>
                  )}
                </div>
              ))}
            </div>

            {/* 메모 */}
            {c.memo && (
              <div style={{ fontSize:12, color:'#64748b', padding:'8px', background:'#f8fafc', borderRadius:6, marginBottom:10 }}>
                💬 {c.memo}
              </div>
            )}

            {/* 액션 버튼 */}
            {c.status !== 'converted' && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                <button onClick={() => openEditPopup(c)} style={btnStyle('#6366f1')}>
                  ✏️ 수정
                </button>
                <button onClick={() => openAddSession(c)} style={btnStyle('#f59e0b')}>
                  ➕ 회차추가
                </button>
                <button onClick={() => togglePayment(c)} style={btnStyle(c.paymentDone ? '#94a3b8' : '#059669')}>
                  {c.paymentDone ? '↩️ 수금취소' : '💰 수금완료'}
                </button>
                <button onClick={() => openConvertPopup(c)} style={btnStyle('#3b82f6')}>
                  🔄 정기전환
                </button>
                <button onClick={() => deleteCustomer(c)} style={btnStyle('#ef4444')}>
                  🗑️ 삭제
                </button>
              </div>
            )}
            {c.status === 'converted' && (
              <div style={{ fontSize:12, color:'#1e40af', fontWeight:600 }}>
                🔄 정기전환 완료 ({c.convertedAt?.slice(0,10)})
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── 렌더링 ─────────────────────────────
  return (
    <div style={{ padding:'12px 12px 80px' }}>

      {/* 요약 카드 */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:14 }}>
        {[
          { label:'진행중',   value:stats.active,    bg:'#fef9c3', color:'#854d0e' },
          { label:'완료',     value:stats.completed, bg:'#dcfce7', color:'#166534' },
          { label:'정기전환', value:stats.converted, bg:'#dbeafe', color:'#1e40af' },
          { label:'미수금',   value:stats.unpaid,    bg:'#fee2e2', color:'#991b1b' },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:'10px 8px', textAlign:'center' }}>
            <div style={{ fontSize:20, fontWeight:800, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:10, color:s.color, marginTop:2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 전환율 */}
      {customers.length > 0 && (
        <div style={{ fontSize:12, color:'#64748b', textAlign:'center', marginBottom:12 }}>
          📊 정기전환율 <b style={{ color:'#3b82f6' }}>{convRate}%</b>
          ({stats.converted}/{customers.length}명)
        </div>
      )}

      {/* 미수금 알림 */}
      {stats.unpaid > 0 && (
        <div style={{
          padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca',
          borderRadius:8, marginBottom:12, fontSize:13, color:'#991b1b', fontWeight:600,
        }}>
          ⚠️ 미수금 {stats.unpaid}건 — 수금 확인이 필요해요
        </div>
      )}

      {/* 등록 버튼 영역 */}
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <button
          onClick={() => openAddPopup()}
          style={{ flex:2, padding:'13px', background:'#f59e0b', color:'white', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' }}
        >
          🟡 + 단기작업 등록
        </button>
        <button
          onClick={openLoadCustomerPopup}
          style={{ flex:1, padding:'13px', background:'#6366f1', color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer' }}
        >
          📋 기존고객<br/>불러오기
        </button>
      </div>

      {/* 검색 */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍 고객명, 전화번호, 주소 검색"
        style={{
          width:'100%', padding:'10px 12px', border:'1px solid #e2e8f0',
          borderRadius:8, fontSize:13, marginBottom:10, boxSizing:'border-box',
        }}
      />

      {/* 분류 필터 */}
      <div style={{ display:'flex', gap:4, overflowX:'auto', paddingBottom:4, marginBottom:8 }}>
        <button
          onClick={() => setFilterCat('all')}
          style={filterChipStyle(filterCat === 'all')}
        >전체</button>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setFilterCat(c.key)} style={filterChipStyle(filterCat === c.key)}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {/* 상태 필터 */}
      <div style={{ display:'flex', gap:4, marginBottom:14 }}>
        {STATUS_LIST.map(s => (
          <button key={s.key} onClick={() => setFilterStatus(s.key)}
            style={{ ...filterChipStyle(filterStatus === s.key), flex:1 }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>⏳ 불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:40, color:'#94a3b8' }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🟡</div>
          <div>단기고객이 없어요</div>
          <div style={{ fontSize:12, marginTop:4 }}>위 버튼으로 등록해보세요!</div>
        </div>
      ) : (
        filtered.map(c => renderCard(c))
      )}
    </div>
  );
}

// ── 스타일 헬퍼 ────────────────────────────
const btnStyle = (bg) => ({
  padding: '7px 12px', background: bg, color: 'white',
  border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
});

const filterChipStyle = (active) => ({
  padding: '5px 10px', border: `1.5px solid ${active ? '#f59e0b' : '#e2e8f0'}`,
  borderRadius: 20, background: active ? '#fef9c3' : 'white',
  color: active ? '#92400e' : '#374151', fontSize: 12, fontWeight: active ? 700 : 400,
  cursor: 'pointer', whiteSpace: 'nowrap',
});
