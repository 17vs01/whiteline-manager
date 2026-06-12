import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { useAppContext } from '../../context/AppContext';
import {
  CONTRACT_TYPES, CLAUSE_KEYS, CLAUSE_META,
  getDefaultClauses, DEFAULT_NOTICES, PAYMENT_METHODS,
} from './contractConstants';
import ContractClauses from './ContractClauses';
import ContractPDFTemplate from './ContractPDFTemplate';
import ContractTemplates from './ContractTemplates';

const emptyContract = (type = 'basic') => ({
  contractType: type,
  custName: '', phone: '', address: '', businessType: '',
  representativeName: '', businessNumber: '',
  contractStart: '', contractEnd: '',
  contractDuration: '1년',
  serviceScope: '',
  visitPerMonth: 1,
  monthlyFee: 0,
  initialFee: 0,
  trapCount: 0,
  trapMonthlyFee: 0,
  trapUnitPrice: 0,       // 포충기 기기 구입금액
  trapWinterExempt: false,// 동절기 면제 여부
  paymentMethod: '송금',
  paymentDay: '말일',
  staffName: '',
  representativeStaff: '김현숙',
  clauses: getDefaultClauses(type),
  notices: [...DEFAULT_NOTICES],
  status: 'draft',
  includeNotices: true,
});

function ContractEditor({ contract, currentUser, onBack }) {
  const isEdit = !!contract?.id;
  const [form, setForm]           = useState(contract ? { ...emptyContract(contract.contractType), ...contract } : emptyContract());
  const [view, setView]           = useState('info'); // 'info' | 'clauses' | 'preview' | 'templates'
  const { settings } = useAppContext();
  const [saving, setSaving]       = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(!contract?.id && !contract?.custName); // 신규 시 바로 검색
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const photoInputRef = useRef(null);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // ── 고객 검색 ────────────────────────────────────────────
  const searchCustomers = async (term) => {
    if (!term.trim()) { setCustomerSearchResults([]); return; }
    setCustomerSearchLoading(true);
    try {
      const [custSnap, quoteSnap] = await Promise.all([
        getDocs(collection(db, 'customers')),
        getDocs(collection(db, 'quoteCustomers')),
      ]);
      const t = term.toLowerCase();
      const fromCust = custSnap.docs
        .map(d => ({ id: d.id, ...d.data(), _source: 'customer' }))
        .filter(c => c.custStatus === '정상' &&
          ((c.custName||c.name||'').toLowerCase().includes(t) ||
           (c.phone||'').includes(t) || (c.code||'').includes(t)));
      const fromQuoteCust = quoteSnap.docs
        .map(d => ({ id: d.id, ...d.data(), _source: 'quote' }))
        .filter(c => (c.custName||'').toLowerCase().includes(t) || (c.phone||'').includes(t));
      setCustomerSearchResults([...fromCust.slice(0,5), ...fromQuoteCust.slice(0,5)]);
    } catch(e) { console.error(e); }
    setCustomerSearchLoading(false);
  };

  const applyCustomer = (c) => {
    setForm(f => ({
      ...f,
      custName: c.custName || c.name || '',
      phone: c.phone || '',
      address: c.address || '',
      businessType: c.businessType || f.businessType,
      representativeName: c.representativeName || c.ceoName || '',
      businessNumber: c.businessNumber || c.bizNo || '',
      staffName: c.staffName || f.staffName,
      fromCustomerId: c._source === 'customer' ? c.id : f.fromCustomerId,
      fromQuoteCustomerId: c._source === 'quote' ? c.id : f.fromQuoteCustomerId,
    }));
    setShowCustomerSearch(false);
    setCustomerSearchTerm('');
    setCustomerSearchResults([]);
  };

  // ── 사진으로 고객정보 추출 ───────────────────────────────
  const analyzeCustomerImage = async (file) => {
    const apiKey = settings.anthropicApiKey || '';
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
              max_tokens: 800,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
                { type: 'text', text: `이 사진(사업자등록증 또는 명함)에서 아래 JSON만 반환해주세요. 없는 항목은 빈 문자열.
{"custName":"상호명","phone":"전화번호","address":"주소","representativeName":"대표자명","businessNumber":"사업자번호"}
JSON만, 다른 텍스트 없이.` }
              ]}]
            })
          });
          const data = await response.json();
          const text = data.content?.find(b => b.type === 'text')?.text || '{}';
          resolve(JSON.parse(text.replace(/```json|```/g, '').trim()));
        } catch(err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoForContract = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Swal.fire({ title: '🔍 분석 중...', html: '<div style="color:#6b7280;font-size:13px;">AI가 사진에서 정보를 읽고 있어요.<br>잠시만 기다려주세요!</div>', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });
    try {
      const extracted = await analyzeCustomerImage(file);
      Swal.close();
      if (!extracted) return; // API 키 없음 등으로 null 반환된 경우
      if (!extracted?.custName) { await Swal.fire('분석 실패', '정보를 읽지 못했어요. 직접 입력해주세요.', 'warning'); return; }
      const { isConfirmed } = await Swal.fire({
        title: '✅ 분석 완료!',
        html: `<div style="text-align:left;padding:8px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.8;">
          ${extracted.custName ? `상호: <b>${extracted.custName}</b><br>` : ''}
          ${extracted.phone ? `전화: ${extracted.phone}<br>` : ''}
          ${extracted.address ? `주소: ${extracted.address}<br>` : ''}
          ${extracted.representativeName ? `대표자: ${extracted.representativeName}<br>` : ''}
          ${extracted.businessNumber ? `사업자번호: ${extracted.businessNumber}` : ''}
        </div>`,
        showCancelButton: true, confirmButtonText: '적용', cancelButtonText: '취소', confirmButtonColor: '#8b5cf6',
      });
      if (isConfirmed) {
        setForm(f => ({
          ...f,
          custName: extracted.custName || f.custName,
          phone: extracted.phone || f.phone,
          address: extracted.address || f.address,
          representativeName: extracted.representativeName || f.representativeName,
          businessNumber: extracted.businessNumber || f.businessNumber,
        }));
        setShowCustomerSearch(false);
      }
    } catch(err) {
      Swal.close();
      await Swal.fire('오류', 'AI 분석 실패. 직접 입력해주세요.', 'error');
    }
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  // 계약 타입 변경 시 조항 재설정
  const handleTypeChange = (type) => {
    Swal.fire({
      title: '계약서 타입 변경',
      text: '조항 구성이 초기화됩니다. 계속하시겠습니까?',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: '변경', cancelButtonText: '취소',
    }).then(r => {
      if (r.isConfirmed) {
        setForm(f => ({ ...f, contractType: type, clauses: getDefaultClauses(type) }));
      }
    });
  };

  // 저장
  const handleSave = async (asDraft = true) => {
    if (!form.custName.trim()) { Swal.fire('알림', '고객명을 입력하세요', 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        updatedAt: new Date().toISOString(),
        status: asDraft ? 'draft' : form.status,
      };
      if (isEdit) {
        const { id, ...rest } = payload;
        await updateDoc(doc(db, 'contracts', contract.id), rest);
      } else {
        payload.createdAt = new Date().toISOString();
        payload.createdBy = currentUser?.name || '';
        await addDoc(collection(db, 'contracts'), payload);
      }
      Swal.fire({ icon: 'success', title: '저장 완료', timer: 1000, showConfirmButton: false });
      if (!isEdit) onBack();
    } catch (e) {
      Swal.fire('오류', '저장 실패: ' + e.message, 'error');
    }
    setSaving(false);
  };

  // 템플릿으로 저장
  const handleSaveAsTemplate = async () => {
    const { value: name } = await Swal.fire({
      title: '📋 템플릿으로 저장',
      input: 'text',
      inputPlaceholder: '예: 소규모 음식점 기본, 백화점 도급',
      inputValue: form.contractType === 'basic' ? '소규모 기본' : form.contractType === 'corporate' ? '대형 도급' : '관공서 기본',
      showCancelButton: true, confirmButtonText: '저장', cancelButtonText: '취소',
    });
    if (!name) return;
    try {
      const { custName, phone, address, contractStart, contractEnd, businessNumber,
        representativeName, createdAt, updatedAt, status, signedAt, ...templateData } = form;
      await addDoc(collection(db, 'contractTemplates'), {
        ...templateData,
        name: name.trim(),
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.name || '',
      });
      Swal.fire({ icon: 'success', title: `"${name}" 템플릿 저장 완료`, timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '템플릿 저장 실패', 'error');
    }
  };

  if (view === 'clauses') {
    return (
      <ContractClauses
        clauses={form.clauses}
        notices={form.notices}
        includeNotices={form.includeNotices}
        onChange={(clauses) => set('clauses', clauses)}
        onNoticesChange={(notices) => set('notices', notices)}
        onIncludeNoticesChange={(v) => set('includeNotices', v)}
        onBack={() => setView('info')}
      />
    );
  }

  if (view === 'preview') {
    return (
      <ContractPDFTemplate
        contract={form}
        settings={settings}
        onBack={() => setView('info')}
        onSave={() => handleSave(false)}
      />
    );
  }

  if (view === 'templates') {
    return (
      <ContractTemplates
        onClose={() => setView('info')}
        onSelect={(tpl) => {
          const { id, name, createdAt, createdBy, ...rest } = tpl;
          setForm(f => ({ ...f, ...rest, custName: f.custName, phone: f.phone, address: f.address }));
          setView('info');
          Swal.fire({ icon: 'success', title: `"${name}" 템플릿 적용됨`, timer: 1200, showConfirmButton: false });
        }}
      />
    );
  }

  // 포충기 위약금 계산 (미리보기용)
  // eslint-disable-next-line no-unused-vars
  const calcTrapPenalty = () => {
    if (!form.trapCount || form.trapCount <= 0) return 0;
    const remainingMonths = form.clauses?.trapPenalty?.enabled ? 12 : 0;
    const trapMonthly = (form.trapMonthlyFee || 0) * (form.trapCount || 0);
    const winterExempt = form.trapWinterExempt ? trapMonthly * 4 : 0;
    const deviceCost = (form.trapUnitPrice || 0) * (form.trapCount || 0);
    return trapMonthly * remainingMonths + winterExempt + deviceCost;
  };

  const enabledClauses = CLAUSE_KEYS.filter(k => form.clauses?.[k]?.enabled);

  return (
    <div style={es.container}>

      {/* 고객 검색/선택 패널 (신규 계약서일 때) */}
      {!isEdit && showCustomerSearch && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #3b82f6' }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e40af', marginBottom: '12px' }}>👤 고객정보 가져오기</div>

          {/* 검색 입력 */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <input
              value={customerSearchTerm}
              onChange={e => { setCustomerSearchTerm(e.target.value); searchCustomers(e.target.value); }}
              placeholder="고객명 / 전화번호 / 코드 검색"
              style={{ flex: 1, padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px' }}
            />
            <label style={{ padding: '10px 12px', background: '#8b5cf6', color: 'white', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
              📸 사진
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoForContract} style={{ display: 'none' }} />
            </label>
          </div>

          {/* 검색 결과 */}
          {customerSearchLoading && <div style={{ textAlign: 'center', padding: '10px', color: '#6b7280', fontSize: '13px' }}>검색 중...</div>}
          {customerSearchResults.length > 0 && (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              {customerSearchResults.map(c => (
                <div key={c.id} onClick={() => applyCustomer(c)}
                  style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}
                >
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{c.custName || c.name}</span>
                    {c.phone && <span style={{ color: '#6b7280', marginLeft: '8px', fontSize: '12px' }}>{c.phone}</span>}
                  </div>
                  <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '10px', background: c._source === 'customer' ? '#d1fae5' : '#eff6ff', color: c._source === 'customer' ? '#065f46' : '#1e40af', flexShrink: 0 }}>
                    {c._source === 'customer' ? '정식고객' : '견적고객'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 직접입력 버튼 */}
          <button onClick={() => setShowCustomerSearch(false)}
            style={{ marginTop: '10px', width: '100%', padding: '9px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
            ✏️ 직접 입력하기
          </button>
        </div>
      )}

      {/* 검색 패널 닫혀있을 때 고객 변경 버튼 */}
      {!isEdit && !showCustomerSearch && (
        <button onClick={() => setShowCustomerSearch(true)}
          style={{ width: '100%', padding: '8px', marginBottom: '10px', background: '#eff6ff', color: '#1e40af', border: '1px dashed #bfdbfe', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
          👤 다른 고객정보 가져오기
        </button>
      )}
      {/* 헤더 */}
      <div style={es.header}>
        <button onClick={onBack} style={es.backBtn}>← 뒤로</button>
        <h2 style={es.title}>{isEdit ? '계약서 편집' : '새 계약서 작성'}</h2>
        <button onClick={() => setView('templates')} style={es.tplBtn}>📋 템플릿</button>
      </div>

      {/* 탭 네비게이션 */}
      <div style={es.tabs}>
        {[['info','📝 기본정보'],['clauses','📄 조항설정'],['preview','👁️ 미리보기/PDF']].map(([v,l]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ ...es.tab, ...(view === v ? es.tabActive : {}) }}>{l}</button>
        ))}
      </div>

      {/* 기본 정보 탭 */}
      <div>
        {/* 계약서 타입 */}
        <div style={es.section}>
          <div style={es.sectionTitle}>📋 계약서 유형</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {CONTRACT_TYPES.map(t => (
              <button key={t.value} onClick={() => handleTypeChange(t.value)}
                style={{ ...es.typeBtn, ...(form.contractType === t.value ? es.typeBtnActive : {}) }}>
                <span style={{ fontSize: '20px' }}>{t.icon}</span>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{t.label}</div>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>{t.desc}</div>
                </div>
                {form.contractType === t.value && <span style={{ color: '#3b82f6' }}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 고객 정보 */}
        <div style={es.section}>
          <div style={es.sectionTitle}>👤 고객 정보</div>
          <Field label="고객명 / 업체명 *">
            <input style={es.input} value={form.custName} onChange={e => set('custName', e.target.value)} placeholder="고객명 또는 업체명" />
          </Field>
          <Field label="연락처">
            <input style={es.input} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="010-0000-0000" />
          </Field>
          <Field label="주소">
            <input style={es.input} value={form.address} onChange={e => set('address', e.target.value)} placeholder="사업장 주소" />
          </Field>
          <Field label="대표자명">
            <input style={es.input} value={form.representativeName} onChange={e => set('representativeName', e.target.value)} placeholder="고객측 대표자" />
          </Field>
          <Field label="사업자번호">
            <input style={es.input} value={form.businessNumber} onChange={e => set('businessNumber', e.target.value)} placeholder="000-00-00000" />
          </Field>
        </div>

        {/* 계약 조건 */}
        <div style={es.section}>
          <div style={es.sectionTitle}>📅 계약 조건</div>
          <div style={es.row2}>
            <Field label="계약 시작일">
              <input type="date" style={es.input} value={form.contractStart} onChange={e => set('contractStart', e.target.value)} />
            </Field>
            <Field label="계약 종료일">
              <input type="date" style={es.input} value={form.contractEnd} onChange={e => set('contractEnd', e.target.value)} />
            </Field>
          </div>
          <Field label="의무 계약기간">
            <select style={es.input} value={form.contractDuration} onChange={e => set('contractDuration', e.target.value)}>
              {['6개월','1년','2년','3년','별도협의'].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="월 작업횟수">
            <div style={es.stepperRow}>
              <button type="button" style={es.stepBtn} onClick={() => set('visitPerMonth', Math.max(1, form.visitPerMonth - 1))}>−</button>
              <span style={es.stepVal}>{form.visitPerMonth}회/월</span>
              <button type="button" style={es.stepBtn} onClick={() => set('visitPerMonth', form.visitPerMonth + 1)}>+</button>
            </div>
          </Field>
          <Field label="서비스 구획">
            <input style={es.input} value={form.serviceScope} onChange={e => set('serviceScope', e.target.value)} placeholder="예: 전체, B1 식음매장, 1~5층 매장" />
          </Field>
        </div>

        {/* 비용 */}
        <div style={es.section}>
          <div style={es.sectionTitle}>💰 방제 비용</div>
          <div style={es.row2}>
            <Field label="초기 비용">
              <div style={es.inputWrap}>
                <input type="number" style={es.input} value={form.initialFee || ''} onChange={e => set('initialFee', parseFloat(e.target.value)||0)} placeholder="0" step="1000" />
                <span style={es.unit}>원</span>
              </div>
            </Field>
            <Field label="정기 월 비용 *">
              <div style={es.inputWrap}>
                <input type="number" style={es.input} value={form.monthlyFee || ''} onChange={e => set('monthlyFee', parseFloat(e.target.value)||0)} placeholder="0" step="1000" />
                <span style={es.unit}>원</span>
              </div>
            </Field>
          </div>
          <Field label="결제 방법">
            <select style={es.input} value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="결제일">
            <input style={es.input} value={form.paymentDay} onChange={e => set('paymentDay', e.target.value)} placeholder="예: 말일, 매월 25일" />
          </Field>
        </div>

        {/* 포충기 설정 */}
        <div style={es.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={es.sectionTitle2}>🪰 포충기 설정</div>
            <button onClick={() => {
              const newVal = form.trapCount > 0 ? 0 : 1;
              set('trapCount', newVal);
              if (newVal === 0) set('trapMonthlyFee', 0);
            }} style={{ ...es.toggleBtn, background: form.trapCount > 0 ? '#f59e0b' : '#e2e8f0', color: form.trapCount > 0 ? 'white' : '#64748b' }}>
              {form.trapCount > 0 ? 'ON ✅' : 'OFF'}
            </button>
          </div>
          {form.trapCount > 0 && (
            <>
              <div style={es.row2}>
                <Field label="설치 대수">
                  <div style={es.stepperRow}>
                    <button type="button" style={es.stepBtn} onClick={() => set('trapCount', Math.max(1, form.trapCount - 1))}>−</button>
                    <span style={es.stepVal}>{form.trapCount}대</span>
                    <button type="button" style={es.stepBtn} onClick={() => set('trapCount', form.trapCount + 1)}>+</button>
                  </div>
                </Field>
                <Field label="대당 월 관리비">
                  <div style={es.inputWrap}>
                    <input type="number" style={es.input} value={form.trapMonthlyFee||''} onChange={e => set('trapMonthlyFee', parseFloat(e.target.value)||0)} placeholder="0" step="1000" />
                    <span style={es.unit}>원</span>
                  </div>
                </Field>
              </div>
              <Field label="기기 구입단가 (위약금 산정용)">
                <div style={es.inputWrap}>
                  <input type="number" style={es.input} value={form.trapUnitPrice||''} onChange={e => set('trapUnitPrice', parseFloat(e.target.value)||0)} placeholder="0" step="1000" />
                  <span style={es.unit}>원/대</span>
                </div>
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', cursor: 'pointer', marginTop: '8px' }}>
                <input type="checkbox" checked={form.trapWinterExempt} onChange={e => set('trapWinterExempt', e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#f59e0b' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#92400e' }}>❄️ 동절기(12월~3월) 비용 면제 업장</div>
                  <div style={{ fontSize: '11px', color: '#b45309' }}>체크 시 위약금에 면제 기간(4개월) 금액이 포함됩니다</div>
                </div>
              </label>

              {/* 포충기 위약금 미리보기 */}
              {form.clauses?.trapPenalty?.enabled && form.trapMonthlyFee > 0 && (
                <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 14px', marginTop: '8px', fontSize: '12px', color: '#92400e' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>🧮 포충기 위약금 산정 예시 (1년 이내 해지 시)</div>
                  <div>월 관리비: {(form.trapMonthlyFee * form.trapCount).toLocaleString()}원 × 12개월 = {(form.trapMonthlyFee * form.trapCount * 12).toLocaleString()}원</div>
                  {form.trapWinterExempt && <div>동절기 면제: {(form.trapMonthlyFee * form.trapCount * 4).toLocaleString()}원 (4개월)</div>}
                  <div>기기 구입금액: {(form.trapUnitPrice * form.trapCount).toLocaleString()}원 ({form.trapCount}대)</div>
                  <div style={{ fontWeight: 'bold', borderTop: '1px solid #fde68a', paddingTop: '4px', marginTop: '4px' }}>
                    최대 위약금: {(form.trapMonthlyFee * form.trapCount * 12 + (form.trapWinterExempt ? form.trapMonthlyFee * form.trapCount * 4 : 0) + form.trapUnitPrice * form.trapCount).toLocaleString()}원
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 담당자 */}
        <div style={es.section}>
          <div style={es.sectionTitle}>👤 담당자 정보</div>
          <Field label="담당자">
            <input style={es.input} value={form.staffName || currentUser?.name || ''} onChange={e => set('staffName', e.target.value)} placeholder="담당자명" />
          </Field>
          <Field label="회사 대표자">
            <input style={es.input} value={form.representativeStaff} onChange={e => set('representativeStaff', e.target.value)} placeholder="김현숙" />
          </Field>
        </div>

        {/* 조항 현황 요약 */}
        <div style={es.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={es.sectionTitle2}>📄 조항 설정 ({enabledClauses.length}개 활성)</div>
            <button onClick={() => setView('clauses')} style={es.clauseBtn}>조항 편집 →</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {CLAUSE_KEYS.map(key => {
              const meta = CLAUSE_META[key];
              const enabled = form.clauses?.[key]?.enabled;
              const customized = form.clauses?.[key]?.customized;
              return (
                <span key={key} style={{
                  padding: '3px 8px', borderRadius: '20px', fontSize: '11px',
                  background: enabled ? (customized ? '#fef3c7' : '#d1fae5') : '#f1f5f9',
                  color: enabled ? (customized ? '#92400e' : '#065f46') : '#94a3b8',
                  border: `1px solid ${enabled ? (customized ? '#fde68a' : '#86efac') : '#e2e8f0'}`,
                }}>
                  {enabled ? '✓' : '−'} {meta.label.replace(/제\d+조 /, '')}
                  {customized ? ' ✏️' : ''}
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
            🟢 활성 · 🟡 수정됨 · ⚪ 비활성
          </div>
        </div>

        {/* 저장 버튼 */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
          <button onClick={onBack} style={es.cancelBtn}>취소</button>
          <button onClick={handleSaveAsTemplate} style={es.tplSaveBtn}>📋 템플릿저장</button>
          <button onClick={() => handleSave(true)} disabled={saving} style={es.saveBtn}>
            {saving ? '저장 중...' : '💾 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#374151', display: 'block', marginBottom: '5px' }}>{label}</label>
      {children}
    </div>
  );
}

const es = {
  container: { paddingBottom: '30px' },
  header: { display: 'flex', alignItems: 'center', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', padding: '4px 8px' },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', margin: '0 0 0 8px', flex: 1 },
  tplBtn: { padding: '7px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' },
  tabs: { display: 'flex', gap: '6px', marginBottom: '14px', overflowX: 'auto' },
  tab: { flex: 1, padding: '10px 8px', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px', color: '#64748b', fontWeight: 'bold', whiteSpace: 'nowrap' },
  tabActive: { background: '#1e3a5f', color: 'white', border: '1px solid #1e3a5f' },
  section: { background: 'white', borderRadius: '12px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sectionTitle: { fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' },
  sectionTitle2: { fontSize: '14px', fontWeight: 'bold', color: '#374151' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  inputWrap: { display: 'flex', alignItems: 'center', gap: '6px' },
  unit: { fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' },
  stepperRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  stepBtn: { width: '32px', height: '32px', border: '1px solid #ddd', borderRadius: '8px', background: '#f8fafc', cursor: 'pointer', fontSize: '16px' },
  stepVal: { fontSize: '15px', fontWeight: 'bold', minWidth: '70px', textAlign: 'center', color: '#1e293b' },
  typeBtn: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', background: '#f8fafc', cursor: 'pointer', textAlign: 'left' },
  typeBtnActive: { border: '1.5px solid #1e3a5f', background: '#eff6ff' },
  toggleBtn: { padding: '6px 16px', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  clauseBtn: { padding: '7px 14px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  row: { display: 'flex', gap: '12px', alignItems: 'center' },
  cancelBtn: { flex: 1, padding: '13px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontSize: '15px' },
  tplSaveBtn: { flex: 1, padding: '13px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' },
  saveBtn: { flex: 2, padding: '13px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' },
};

export default ContractEditor;
