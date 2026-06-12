import React, { useState, useRef } from 'react';
import Swal from 'sweetalert2';
import { BUSINESS_TYPES, UNIT_BASED_TYPES, BUSINESS_ZONES } from './quoteConstants';

function QuoteCustomerForm({ customer, currentUser, staffList, apiKey = '', onSave, onBack }) {
  const isEdit = !!customer?.id;
  const [form, setForm] = useState({
    custName: customer?.custName || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    address: customer?.address || '',
    businessType: customer?.businessType || '',
    area: customer?.area || '',
    unitCount: customer?.unitCount || '',
    floors: customer?.floors || '',
    staffName: customer?.staffName || currentUser?.name || '',
    memo: customer?.memo || '',
    zones: customer?.zones || [],
    ...(isEdit ? { id: customer.id } : {}),
  });
  const [errors, setErrors] = useState({});
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoInputRef = useRef(null);

  // ── 사진 분석으로 고객정보 추출 (Claude AI) ─────────────
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
                  { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
                  { type: 'text', text: `이 사진(사업자등록증 또는 명함)에서 아래 정보를 추출해서 JSON만 반환해주세요. 없는 항목은 빈 문자열로.
{
  "custName": "상호명 또는 회사명",
  "phone": "대표 전화번호",
  "phone2": "전화번호2 (있으면)",
  "fax": "팩스번호 (있으면)",
  "email": "이메일 (있으면)",
  "address": "주소 (도로명 또는 지번)",
  "ceoName": "대표자 성명",
  "contactPerson": "담당자 직책+이름 (명함이 대표자가 아닐 때, 예: 팀장 홍길동)",
  "bizNo": "사업자등록번호 (있으면)",
  "memo": "기타 참고할 정보"
}
JSON만 반환하고 다른 텍스트는 절대 포함하지 마세요.` }
                ]
              }]
            })
          });
          const data = await response.json();
          const text = data.content?.find(b => b.type === 'text')?.text || '{}';
          resolve(JSON.parse(text.replace(/```json|```/g, '').trim()));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoLoading(true);

    // 분석 중 Swal
    Swal.fire({
      title: '🔍 분석 중...',
      html: '<div style="color:#6b7280;font-size:13px;">AI가 사진에서 정보를 읽고 있어요.<br>잠시만 기다려주세요!</div>',
      allowOutsideClick: false, showConfirmButton: false,
      didOpen: () => Swal.showLoading(),
    });

    try {
      const extracted = await analyzeCustomerImage(file);
      Swal.close();

      if (!extracted || !extracted.custName) {
        await Swal.fire('분석 실패', '사진에서 정보를 읽지 못했어요. 직접 입력해주세요.', 'warning');
        setPhotoLoading(false);
        return;
      }

      // 추출된 항목 미리보기
      const previewItems = [
        extracted.custName      && `상호: <b>${extracted.custName}</b>`,
        extracted.phone         && `전화1: ${extracted.phone}`,
        extracted.phone2        && `전화2: ${extracted.phone2}`,
        extracted.fax           && `팩스: ${extracted.fax}`,
        extracted.email         && `이메일: ${extracted.email}`,
        extracted.address       && `주소: ${extracted.address}`,
        extracted.ceoName       && `대표자: ${extracted.ceoName}`,
        extracted.contactPerson && `담당자: ${extracted.contactPerson}`,
        extracted.bizNo         && `사업자번호: ${extracted.bizNo}`,
      ].filter(Boolean).join('<br>');

      const { isConfirmed } = await Swal.fire({
        title: '✅ 분석 완료!',
        html: `<div style="text-align:left;padding:10px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.8;">${previewItems}</div>
               <div style="margin-top:10px;font-size:12px;color:#6b7280;">폼에 자동으로 입력됩니다.</div>`,
        showCancelButton: true,
        confirmButtonText: '폼에 적용',
        cancelButtonText: '취소',
        confirmButtonColor: '#8b5cf6',
      });

      if (isConfirmed) {
        // 폼에 자동입력
        const bizMemo = extracted.bizNo ? `사업자번호: ${extracted.bizNo}` : '';
        const extraMemo = extracted.memo || '';
        const ceoMemo = extracted.ceoName ? `대표자: ${extracted.ceoName}` : '';
        const contactMemo = extracted.contactPerson ? `담당자: ${extracted.contactPerson}` : '';
        const phone2Memo = extracted.phone2 ? `전화2: ${extracted.phone2}` : '';
        const faxMemo = extracted.fax ? `팩스: ${extracted.fax}` : '';
        const memoFinal = [bizMemo, ceoMemo, contactMemo, phone2Memo, faxMemo, extraMemo].filter(Boolean).join(' / ');

        setForm(f => ({
          ...f,
          custName: extracted.custName || f.custName,
          phone:    extracted.phone    || f.phone,
          email:    extracted.email    || f.email,
          address:  extracted.address  || f.address,
          memo:     memoFinal          || f.memo,
        }));

        Swal.fire({
          icon: 'success', title: '입력 완료!',
          text: '나머지 정보를 확인하고 저장해주세요.',
          timer: 1800, showConfirmButton: false,
        });
      }
    } catch (err) {
      Swal.close();
      console.error('이미지 분석 오류:', err);
      await Swal.fire('오류', 'AI 분석에 실패했어요. 직접 입력해주세요.', 'error');
    }
    setPhotoLoading(false);
    // input 초기화 (같은 파일 재선택 가능하도록)
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: '' }));
  };

  const handleBusinessTypeChange = (type) => {
    const presets = (BUSINESS_ZONES[type] || []).map(z => ({
      key: z.key,
      label: z.label,
      icon: z.icon,
      countable: z.countable,
      count: z.defaultCount,
      include: z.defaultCount > 0,
      unitPrice: 0,
    }));
    setForm(f => ({ ...f, businessType: type, zones: presets }));
    if (errors.businessType) setErrors(e => ({ ...e, businessType: '' }));
  };

  const updateZone = (i, key, val) => {
    const zones = [...form.zones];
    zones[i] = { ...zones[i], [key]: val };
    setForm(f => ({ ...f, zones }));
  };

  const addCustomZone = () => {
    setForm(f => ({
      ...f,
      zones: [...f.zones, { key: `custom_${Date.now()}`, label: '', icon: '📍', countable: true, count: 1, include: true, unitPrice: 0 }]
    }));
  };

  const removeZone = (i) => {
    const zones = [...form.zones];
    zones.splice(i, 1);
    setForm(f => ({ ...f, zones }));
  };

  const validate = () => {
    const e = {};
    if (!form.custName.trim()) e.custName = '고객명을 입력하세요';
    if (!form.businessType) e.businessType = '업종을 선택하세요';
    return e;
  };

  const handleSubmit = () => {
    const e = validate();
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }
    onSave(form);
  };

  const needsUnits = UNIT_BASED_TYPES.includes(form.businessType);

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn}>← 뒤로</button>
        <h2 style={styles.title}>{isEdit ? '견적고객 수정' : '견적고객 등록'}</h2>
        <label style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '7px 10px', background: photoLoading ? '#a78bfa' : '#8b5cf6',
          color: 'white', borderRadius: '8px', cursor: photoLoading ? 'not-allowed' : 'pointer',
          fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap',
        }} title="사업자등록증 또는 명함 사진으로 자동 입력">
          {photoLoading ? '⏳' : '📸'} {photoLoading ? '분석중...' : '사진'}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoUpload}
            disabled={photoLoading}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <div style={styles.notice}>
        💡 견적고객은 <b>임시 고객</b>입니다. 계약이 확정되면 "계약전환" 버튼으로 정식 고객코드가 발급됩니다.
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>👤 기본 정보</div>

        <Field label="고객명 *" error={errors.custName}>
          <input
            style={{ ...styles.input, ...(errors.custName ? styles.inputError : {}) }}
            placeholder="고객명 또는 업체명"
            value={form.custName}
            onChange={e => set('custName', e.target.value)}
          />
        </Field>

        <Field label="연락처">
          <input
            style={styles.input}
            placeholder="010-0000-0000"
            value={form.phone}
            onChange={e => set('phone', e.target.value)}
          />
        </Field>

        <Field label="이메일">
          <input
            style={styles.input}
            type="email"
            placeholder="example@email.com"
            value={form.email}
            onChange={e => set('email', e.target.value)}
          />
        </Field>

        <Field label="주소">
          <input
            style={styles.input}
            placeholder="시설 주소"
            value={form.address}
            onChange={e => set('address', e.target.value)}
          />
        </Field>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>🏢 시설 정보</div>

        <Field label="업종 *" error={errors.businessType}>
          <div style={styles.businessGrid}>
            {BUSINESS_TYPES.map(b => (
              <button
                key={b.value}
                type="button"
                onClick={() => handleBusinessTypeChange(b.value)}
                style={{
                  ...styles.businessBtn,
                  ...(form.businessType === b.value ? styles.businessBtnActive : {})
                }}
              >
                <span style={{ fontSize: '18px' }}>{b.icon}</span>
                <span style={{ fontSize: '11px', marginTop: '2px' }}>{b.label}</span>
              </button>
            ))}
          </div>
          {errors.businessType && <div style={styles.errorMsg}>{errors.businessType}</div>}
        </Field>

        <Field label="면적 (평수)">
          <div style={styles.row}>
            <input
              style={{ ...styles.input, flex: 1 }}
              type="number"
              placeholder="예: 50"
              value={form.area}
              onChange={e => set('area', e.target.value)}
            />
            <span style={styles.unit}>평</span>
          </div>
        </Field>

        {needsUnits && (
          <Field label="호실/세대 수">
            <div style={styles.row}>
              <input
                style={{ ...styles.input, flex: 1 }}
                type="number"
                placeholder="예: 20"
                value={form.unitCount}
                onChange={e => set('unitCount', e.target.value)}
              />
              <span style={styles.unit}>
                {form.businessType === 'hotel' ? '호실' : '세대'}
              </span>
            </div>
          </Field>
        )}

        <Field label="층수 / 규모">
          <input
            style={styles.input}
            placeholder="예: 지상 5층, 지하 1층"
            value={form.floors}
            onChange={e => set('floors', e.target.value)}
          />
        </Field>
      </div>

      {/* 구획 설정 */}
      {form.businessType && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>📍 작업 구획 설정</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
            업종에 맞는 기본 구획이 설정되었습니다. 포함할 구획을 선택하고 개수를 입력하세요.
          </div>

          {form.zones.length === 0 && (
            <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '16px' }}>
              구획을 추가해주세요.
            </div>
          )}

          {form.zones.map((zone, i) => (
            <div key={zone.key} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 12px', marginBottom: '6px', borderRadius: '8px',
              background: zone.include ? '#f0fdf4' : '#f8fafc',
              border: `1.5px solid ${zone.include ? '#86efac' : '#e2e8f0'}`,
            }}>
              {/* 포함 토글 */}
              <button
                type="button"
                onClick={() => updateZone(i, 'include', !zone.include)}
                style={{
                  width: '28px', height: '28px', borderRadius: '50%', border: 'none',
                  background: zone.include ? '#10b981' : '#e2e8f0',
                  color: 'white', cursor: 'pointer', fontSize: '14px', flexShrink: 0,
                }}
              >{zone.include ? '✓' : ''}</button>

              <span style={{ fontSize: '16px', flexShrink: 0 }}>{zone.icon}</span>

              {/* 구획명 (custom은 수정 가능) */}
              {zone.key.startsWith('custom_') ? (
                <input
                  style={{ ...styles.input, flex: 1, padding: '6px 8px', fontSize: '13px' }}
                  value={zone.label}
                  onChange={e => updateZone(i, 'label', e.target.value)}
                  placeholder="구획명 입력"
                />
              ) : (
                <span style={{ flex: 1, fontSize: '13px', fontWeight: zone.include ? 'bold' : 'normal', color: zone.include ? '#166534' : '#94a3b8' }}>
                  {zone.label}
                </span>
              )}

              {/* 개수 입력 (countable인 경우) */}
              {zone.countable && zone.include && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button type="button" onClick={() => updateZone(i, 'count', Math.max(0, (zone.count || 0) - 1))}
                    style={styles.miniBtn}>−</button>
                  <span style={{ minWidth: '32px', textAlign: 'center', fontSize: '13px', fontWeight: 'bold' }}>
                    {zone.count || 0}
                  </span>
                  <button type="button" onClick={() => updateZone(i, 'count', (zone.count || 0) + 1)}
                    style={styles.miniBtn}>+</button>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>개</span>
                </div>
              )}

              <button type="button" onClick={() => removeZone(i)}
                style={{ background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}>
                ✕
              </button>
            </div>
          ))}

          <button type="button" onClick={addCustomZone} style={{
            width: '100%', padding: '10px', border: '1.5px dashed #94a3b8',
            borderRadius: '8px', background: 'transparent', color: '#64748b',
            cursor: 'pointer', fontSize: '13px', marginTop: '4px',
          }}>
            + 구획 직접 추가
          </button>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>👤 담당 정보</div>

        <Field label="담당자">
          <select
            style={styles.input}
            value={form.staffName}
            onChange={e => set('staffName', e.target.value)}
          >
            <option value="">담당자 선택</option>
            {staffList.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </Field>

        <Field label="메모">
          <textarea
            style={{ ...styles.input, height: '80px', resize: 'vertical' }}
            placeholder="특이사항, 요청사항 등"
            value={form.memo}
            onChange={e => set('memo', e.target.value)}
          />
        </Field>
      </div>

      <div style={styles.footer}>
        <button onClick={onBack} style={styles.cancelBtn}>취소</button>
        <button onClick={handleSubmit} style={styles.saveBtn}>
          {isEdit ? '✏️ 수정 저장' : '✅ 등록'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#374151', display: 'block', marginBottom: '5px' }}>
        {label}
      </label>
      {children}
      {error && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '3px' }}>{error}</div>}
    </div>
  );
}

const styles = {
  container: { paddingBottom: '30px' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0'
  },
  backBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', padding: '4px 8px'
  },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', margin: 0 },
  notice: {
    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px',
    padding: '10px 14px', fontSize: '13px', color: '#1e40af', marginBottom: '16px', lineHeight: '1.5'
  },
  section: {
    background: 'white', borderRadius: '12px', padding: '16px',
    marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
  },
  sectionTitle: {
    fontSize: '14px', fontWeight: 'bold', color: '#374151',
    marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9'
  },
  input: {
    width: '100%', padding: '10px 12px', border: '1px solid #ddd',
    borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none'
  },
  inputError: { border: '1px solid #ef4444' },
  errorMsg: { color: '#ef4444', fontSize: '12px', marginTop: '3px' },
  row: { display: 'flex', alignItems: 'center', gap: '8px' },
  unit: { fontSize: '14px', color: '#666', whiteSpace: 'nowrap' },
  businessGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '4px'
  },
  businessBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '10px 6px', border: '1.5px solid #e2e8f0', borderRadius: '8px',
    background: '#f8fafc', cursor: 'pointer', gap: '2px', fontSize: '12px', color: '#374151'
  },
  businessBtnActive: {
    border: '1.5px solid #3b82f6', background: '#eff6ff', color: '#1e40af', fontWeight: 'bold'
  },
  footer: {
    display: 'flex', gap: '10px', marginTop: '20px'
  },
  miniBtn: {
    width: '24px', height: '24px', border: '1px solid #ddd', borderRadius: '4px',
    background: '#f8fafc', cursor: 'pointer', fontSize: '14px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0,
  },
  cancelBtn: {
    flex: 1, padding: '13px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontSize: '15px'
  },
  saveBtn: {
    flex: 2, padding: '13px', background: '#3b82f6', color: 'white',
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold'
  },
};

export default QuoteCustomerForm;
