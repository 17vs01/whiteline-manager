// =============================================
// 고객현황 탭 컴포넌트
// 고객카드 내 현황 탭 + 배정플랜 모달에서도 사용
// =============================================
import React, { useState } from 'react';
import Swal from 'sweetalert2';
import { saveCustomerStatus } from './scheduler/schedulerFirestore';
import {
  PREFERRED_TIME_OPTIONS, MAIN_PEST_ISSUES, SEVERITY_LEVELS,
  ACCESS_METHODS, CUSTOMER_TRAITS, emptyCustomerStatus,
} from './scheduler/schedulerConstants';

const S = {
  section: {
    background: '#f8fafc', borderRadius: 10, padding: '12px 14px',
    marginBottom: 10, border: '1px solid #e2e8f0',
  },
  sectionTitle: {
    fontSize: 13, fontWeight: 'bold', color: '#374151', marginBottom: 10,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  label: { fontSize: 11, color: '#6b7280', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none',
    background: 'white',
  },
  tagRow: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  tag: (active, color) => ({
    padding: '4px 10px', borderRadius: 20, fontSize: 12,
    border: `1px solid ${active ? (color || '#3b82f6') : '#e2e8f0'}`,
    background: active ? ((color || '#3b82f6') + '22') : 'white',
    color: active ? (color || '#1e40af') : '#6b7280',
    cursor: 'pointer', whiteSpace: 'nowrap',
  }),
  row: { display: 'flex', gap: 8 },
  col: { flex: 1 },
  saveBtn: {
    width: '100%', padding: 12, background: '#3b82f6', color: 'white',
    border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 'bold',
    cursor: 'pointer', marginTop: 8,
  },
  badge: (color, bg) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 12, fontSize: 11,
    fontWeight: 'bold', color, background: bg,
  }),
};

export default function CustomerStatusTab({
  customer,       // 고객 데이터 (customers 컬렉션)
  currentUser,
  isReadOnly,
  onSaved,        // 저장 후 콜백
}) {
  const initial = {
    ...emptyCustomerStatus(),
    ...(customer?.customerStatus || {}),
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const toggleArr = (key, val) => {
    setForm(f => {
      const arr = f[key] || [];
      return { ...f, [key]: arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val] };
    });
  };

  const addTag = () => {
    const t = newTag.trim();
    if (!t || form.tags?.includes(t)) return;
    set('tags', [...(form.tags || []), t]);
    setNewTag('');
  };

  const handleSave = async () => {
    if (!customer?.id) {
      Swal.fire('오류', '고객 정보를 찾을 수 없습니다.', 'error'); return;
    }
    setSaving(true);
    try {
      await saveCustomerStatus(customer.id, form, currentUser?.name || '');
      if (onSaved) onSaved(form);
      Swal.fire({ toast: true, position: 'top', icon: 'success', title: '현황 저장 완료', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '저장 실패: ' + e.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div style={{ fontSize: 13 }}>

      {/* 작업 선호 시간 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>⏰ 작업 선호 시간</div>
        <div style={S.tagRow}>
          {PREFERRED_TIME_OPTIONS.map(t => (
            <button key={t} style={S.tag(form.preferredTime === t)} disabled={isReadOnly}
              onClick={() => set('preferredTime', form.preferredTime === t ? '' : t)}>
              {t}
            </button>
          ))}
        </div>
        <input
          style={{ ...S.input, marginTop: 8 }}
          placeholder="구체적인 시간 (예: 오전 10시 이후)"
          value={form.preferredTimeDetail || ''}
          onChange={e => set('preferredTimeDetail', e.target.value)}
          disabled={isReadOnly}
        />
      </div>

      {/* 중점 문제 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>⚠️ 중점 문제</div>
        <div style={S.tagRow}>
          {MAIN_PEST_ISSUES.map(p => (
            <button key={p}
              style={S.tag((form.mainIssues || []).includes(p), '#ef4444')}
              disabled={isReadOnly}
              onClick={() => toggleArr('mainIssues', p)}>
              {p}
            </button>
          ))}
        </div>
        {(form.mainIssues || []).length > 0 && (
          <div style={{ marginTop: 8 }}>
            <span style={S.label}>심각도</span>
            <div style={S.tagRow}>
              {SEVERITY_LEVELS.map(s => (
                <button key={s.value}
                  style={S.tag(form.issueSeverity === s.value, s.color)}
                  disabled={isReadOnly}
                  onClick={() => set('issueSeverity', s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 출입 방법 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🔑 출입 방법</div>
        <div style={S.tagRow}>
          {ACCESS_METHODS.map(a => (
            <button key={a} style={S.tag(form.accessMethod === a)} disabled={isReadOnly}
              onClick={() => set('accessMethod', form.accessMethod === a ? '' : a)}>
              {a}
            </button>
          ))}
        </div>
        <input
          style={{ ...S.input, marginTop: 8 }}
          placeholder="출입 상세 (코드번호, 담당자 연락처 등)"
          value={form.accessDetail || ''}
          onChange={e => set('accessDetail', e.target.value)}
          disabled={isReadOnly}
        />
      </div>

      {/* 고객 성향 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>😊 고객 성향</div>
        <div style={S.tagRow}>
          {CUSTOMER_TRAITS.map(t => (
            <button key={t}
              style={S.tag((form.customerTrait || []).includes(t), '#8b5cf6')}
              disabled={isReadOnly}
              onClick={() => toggleArr('customerTrait', t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 현장 특이사항 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📝 현장 특이사항</div>
        <textarea
          style={{ ...S.input, resize: 'vertical', minHeight: 70 }}
          placeholder="현장 특이사항, 주의사항 등"
          value={form.siteNote || ''}
          onChange={e => set('siteNote', e.target.value)}
          disabled={isReadOnly}
        />
      </div>

      {/* 최근 컴플레인 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📢 최근 컴플레인</div>
        <div style={S.row}>
          <div style={S.col}>
            <span style={S.label}>날짜</span>
            <input type="date" style={S.input}
              value={form.lastComplainDate || ''}
              onChange={e => set('lastComplainDate', e.target.value)}
              disabled={isReadOnly}
            />
          </div>
        </div>
        <textarea
          style={{ ...S.input, resize: 'vertical', minHeight: 60, marginTop: 8 }}
          placeholder="컴플레인 내용"
          value={form.lastComplainNote || ''}
          onChange={e => set('lastComplainNote', e.target.value)}
          disabled={isReadOnly}
        />
      </div>

      {/* 태그 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🏷️ 태그</div>
        {!isReadOnly && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input
              style={{ ...S.input, flex: 1 }}
              placeholder="태그 입력 후 추가"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()}
            />
            <button
              style={{ padding: '8px 14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
              onClick={addTag}>추가</button>
          </div>
        )}
        <div style={S.tagRow}>
          {(form.tags || []).map(t => (
            <span key={t} style={{ ...S.badge('#1e40af','#eff6ff'), cursor: isReadOnly ? 'default' : 'pointer' }}
              onClick={() => !isReadOnly && set('tags', (form.tags || []).filter(x => x !== t))}>
              {t} {!isReadOnly && '×'}
            </span>
          ))}
        </div>
      </div>

      {/* 업데이트 정보 */}
      {form.updatedAt && (
        <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginBottom: 8 }}>
          최근 수정: {form.updatedAt.split('T')[0]} {form.updatedBy && `(${form.updatedBy})`}
        </div>
      )}

      {/* 저장 버튼 */}
      {!isReadOnly && (
        <button style={S.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : '💾 현황 저장'}
        </button>
      )}
    </div>
  );
}

// ── 배정플랜 고객카드 현황 요약 (인라인 표시용) ──
export function CustomerStatusSummary({ customerStatus }) {
  if (!customerStatus) return null;
  const {
    preferredTime, mainIssues, issueSeverity,
    accessMethod, customerTrait, lastComplainDate, siteNote,
  } = customerStatus;

  const severityInfo = SEVERITY_LEVELS.find(s => s.value === issueSeverity);

  const hasAny = preferredTime || (mainIssues?.length > 0) || accessMethod ||
                 (customerTrait?.length > 0) || lastComplainDate || siteNote;
  if (!hasAny) return null;

  return (
    <div style={{
      marginTop: 6, padding: '8px 10px', background: '#f0f9ff',
      borderRadius: 8, border: '1px solid #bae6fd', fontSize: 12,
    }}>
      <div style={{ fontWeight: 'bold', color: '#0369a1', marginBottom: 4, fontSize: 11 }}>
        📊 고객현황
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {preferredTime && (
          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>
            ⏰ {preferredTime}
          </span>
        )}
        {mainIssues?.map(i => (
          <span key={i} style={{ background: '#fee2e2', color: '#dc2626', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>
            ⚠️ {i}
          </span>
        ))}
        {severityInfo && mainIssues?.length > 0 && (
          <span style={{ background: severityInfo.color + '22', color: severityInfo.color, padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>
            {severityInfo.label}
          </span>
        )}
        {accessMethod && (
          <span style={{ background: '#f0fdf4', color: '#059669', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>
            🔑 {accessMethod}
          </span>
        )}
        {customerTrait?.slice(0, 2).map(t => (
          <span key={t} style={{ background: '#ede9fe', color: '#7c3aed', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>
            {t}
          </span>
        ))}
      </div>
      {siteNote && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>
          📝 {siteNote.slice(0, 50)}{siteNote.length > 50 ? '...' : ''}
        </div>
      )}
      {lastComplainDate && (
        <div style={{ marginTop: 3, fontSize: 11, color: '#ef4444' }}>
          📢 최근 컴플레인: {lastComplainDate}
        </div>
      )}
    </div>
  );
}
