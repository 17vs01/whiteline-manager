// =============================================
// 스케쥴러 이벤트 등록/수정 폼
// =============================================
import React, { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import {
  EVENT_TYPES, HOLIDAY_REASONS, SALES_CONTACT_METHODS,
  ALARM_OPTIONS, REPEAT_OPTIONS, emptyScheduleEvent,
} from './schedulerConstants';

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 3000, display: 'flex', alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheet: {
    background: 'white', borderRadius: '20px 20px 0 0',
    padding: '20px 16px 40px', width: '100%', maxWidth: 480,
    maxHeight: '90vh', overflowY: 'auto',
  },
  handle: {
    width: 40, height: 4, background: '#d1d5db',
    borderRadius: 2, margin: '0 auto 16px',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginBottom: 16 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none',
  },
  row: { display: 'flex', gap: 8, marginBottom: 12 },
  col: { flex: 1 },
  typeGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 },
  typeBtn: (active, color) => ({
    padding: '8px 4px', border: `2px solid ${active ? color : '#e2e8f0'}`,
    borderRadius: 8, background: active ? color : 'white',
    color: active ? 'white' : '#374151', cursor: 'pointer',
    fontSize: 12, fontWeight: 'bold', textAlign: 'center',
  }),
  saveBtn: {
    width: '100%', padding: 14, background: '#3b82f6', color: 'white',
    border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 'bold',
    cursor: 'pointer', marginTop: 8,
  },
  deleteBtn: {
    width: '100%', padding: 12, background: '#fee2e2', color: '#ef4444',
    border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 'bold',
    cursor: 'pointer', marginTop: 6,
  },
  section: {
    background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#374151', marginBottom: 10 },
  checkbox: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' },
  tag: (active) => ({
    padding: '4px 10px', borderRadius: 20, fontSize: 12,
    border: `1px solid ${active ? '#3b82f6' : '#e2e8f0'}`,
    background: active ? '#eff6ff' : 'white',
    color: active ? '#1e40af' : '#6b7280',
    cursor: 'pointer', whiteSpace: 'nowrap',
  }),
  tagRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 },
};

export default function SchedulerEventForm({
  event,           // 기존 이벤트 (수정 시)
  defaultDate,     // 기본 날짜
  staffList,       // 공유 직원 목록
  currentUser,
  onSave,
  onDelete,
  onClose,
}) {
  const isEdit = !!event?.id;
  const [form, setForm] = useState(
    event ? { ...emptyScheduleEvent(event.date), ...event }
           : emptyScheduleEvent(defaultDate || new Date().toISOString().split('T')[0])
  );
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setSales = (key, val) => setForm(f => ({ ...f, sales: { ...(f.sales || {}), [key]: val } }));
  const setHoliday = (key, val) => setForm(f => ({ ...f, holiday: { ...(f.holiday || {}), [key]: val } }));

  const typeInfo = EVENT_TYPES[form.type] || EVENT_TYPES.other;

  const handleSave = async () => {
    if (!form.title && form.type !== 'holiday') {
      Swal.fire('입력 오류', '제목을 입력해주세요.', 'warning'); return;
    }
    if (!form.date) {
      Swal.fire('입력 오류', '날짜를 선택해주세요.', 'warning'); return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const hasRepeat = form.repeatGroupId && !form.isRepeatChild;
    let deleteAll = false;
    if (hasRepeat) {
      const r = await Swal.fire({
        title: '반복 일정 삭제',
        text: '이 일정만 삭제할까요, 반복 전체를 삭제할까요?',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '이 일정만',
        denyButtonText: '전체 삭제',
        cancelButtonText: '취소',
      });
      if (r.isDismissed) return;
      deleteAll = r.isDenied;
    } else {
      const r = await Swal.fire({ title: '삭제', text: '이 일정을 삭제할까요?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: '삭제', cancelButtonText: '취소' });
      if (!r.isConfirmed) return;
    }
    await onDelete(form.id, deleteAll ? form.repeatGroupId : null);
  };

  // 공유 직원 토글
  const toggleShared = (visibleId) => {
    const list = form.sharedWith || [];
    if (list.includes(visibleId)) {
      set('sharedWith', list.filter(id => id !== visibleId));
    } else {
      set('sharedWith', [...list, visibleId]);
    }
  };

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.sheet}>
        <div style={S.handle} />
        <div style={S.title}>{isEdit ? '✏️ 일정 수정' : '📅 새 일정'}</div>

        {/* 유형 선택 */}
        <div style={{ marginBottom: 12 }}>
          <span style={S.label}>유형</span>
          <div style={S.typeGrid}>
            {Object.entries(EVENT_TYPES).map(([key, info]) => (
              <button
                key={key}
                style={S.typeBtn(form.type === key, info.color)}
                onClick={() => set('type', key)}
              >
                {info.icon} {info.label}
              </button>
            ))}
          </div>
        </div>

        {/* 제목 (휴무 제외) */}
        {form.type !== 'holiday' && (
          <div style={{ marginBottom: 12 }}>
            <span style={S.label}>제목 *</span>
            <input
              style={S.input}
              placeholder={`${typeInfo.icon} ${typeInfo.label} 제목`}
              value={form.title}
              onChange={e => set('title', e.target.value)}
            />
          </div>
        )}

        {/* 날짜/시간 */}
        {form.type === 'holiday' ? (
          <div style={S.section}>
            <div style={S.sectionTitle}>🏖️ 휴무 기간</div>
            <div style={S.row}>
              <div style={S.col}>
                <span style={S.label}>시작일</span>
                <input type="date" style={S.input} value={form.holiday?.startDate || form.date}
                  onChange={e => { setHoliday('startDate', e.target.value); set('date', e.target.value); }} />
              </div>
              <div style={S.col}>
                <span style={S.label}>종료일</span>
                <input type="date" style={S.input} value={form.holiday?.endDate || form.date}
                  onChange={e => setHoliday('endDate', e.target.value)} />
              </div>
            </div>
            <span style={S.label}>사유</span>
            <select style={{ ...S.input, marginBottom: 8 }}
              value={form.holiday?.reason || ''}
              onChange={e => setHoliday('reason', e.target.value)}>
              <option value="">사유 선택</option>
              {HOLIDAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {form.holiday?.reason === '직접입력' && (
              <input style={S.input} placeholder="사유 직접 입력"
                value={form.holiday?.reasonDirect || ''}
                onChange={e => setHoliday('reasonDirect', e.target.value)} />
            )}
          </div>
        ) : (
          <div style={S.row}>
            <div style={S.col}>
              <span style={S.label}>날짜 *</span>
              <input type="date" style={S.input} value={form.date}
                onChange={e => set('date', e.target.value)} />
            </div>
            <div style={{ width: 80 }}>
              <span style={S.label}>&nbsp;</span>
              <label style={{ ...S.checkbox, marginTop: 10 }}>
                <input type="checkbox" checked={form.allDay}
                  onChange={e => set('allDay', e.target.checked)} />
                종일
              </label>
            </div>
          </div>
        )}

        {!form.allDay && form.type !== 'holiday' && (
          <div style={S.row}>
            <div style={S.col}>
              <span style={S.label}>시작</span>
              <input type="time" style={S.input} value={form.startTime}
                onChange={e => set('startTime', e.target.value)} />
            </div>
            <div style={S.col}>
              <span style={S.label}>종료</span>
              <input type="time" style={S.input} value={form.endTime}
                onChange={e => set('endTime', e.target.value)} />
            </div>
          </div>
        )}

        {/* 영업 전용 필드 */}
        {form.type === 'sales' && (
          <div style={S.section}>
            <div style={S.sectionTitle}>🏪 영업 정보</div>
            <div style={{ marginBottom: 8 }}>
              <span style={S.label}>업장명</span>
              <input style={S.input} placeholder="업장명" value={form.sales?.bizName || ''}
                onChange={e => setSales('bizName', e.target.value)} />
            </div>
            <div style={S.row}>
              <div style={S.col}>
                <span style={S.label}>평수</span>
                <input style={S.input} placeholder="평수" type="number" value={form.sales?.area || ''}
                  onChange={e => setSales('area', e.target.value)} />
              </div>
              <div style={S.col}>
                <span style={S.label}>연락 방법</span>
                <select style={S.input} value={form.sales?.contactMethod || '전화'}
                  onChange={e => setSales('contactMethod', e.target.value)}>
                  {SALES_CONTACT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div style={S.row}>
              <div style={S.col}>
                <span style={S.label}>초기금액</span>
                <input style={S.input} placeholder="0" type="number" value={form.sales?.initialFee || ''}
                  onChange={e => setSales('initialFee', Number(e.target.value))} />
              </div>
              <div style={S.col}>
                <span style={S.label}>정기금액</span>
                <input style={S.input} placeholder="0" type="number" value={form.sales?.monthlyFee || ''}
                  onChange={e => setSales('monthlyFee', Number(e.target.value))} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <span style={S.label}>재방문 일시</span>
              <input type="date" style={S.input} value={form.sales?.nextVisitDate || ''}
                onChange={e => setSales('nextVisitDate', e.target.value)} />
            </div>
            <div>
              <span style={S.label}>담당자 / 메모</span>
              <input style={{ ...S.input, marginBottom: 6 }} placeholder="담당자명" value={form.sales?.contactPerson || ''}
                onChange={e => setSales('contactPerson', e.target.value)} />
              <textarea style={{ ...S.input, resize: 'vertical', minHeight: 60 }}
                placeholder="메모" value={form.sales?.memo || ''}
                onChange={e => setSales('memo', e.target.value)} />
            </div>
          </div>
        )}

        {/* 알림 & 반복 */}
        <div style={S.row}>
          <div style={S.col}>
            <span style={S.label}>🔔 알림</span>
            <select style={S.input} value={form.alarm} onChange={e => set('alarm', Number(e.target.value))}>
              {ALARM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={S.col}>
            <span style={S.label}>🔄 반복</span>
            <select style={S.input} value={form.repeat} onChange={e => set('repeat', e.target.value)}>
              {REPEAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {form.repeat !== 'none' && (
          <div style={{ marginBottom: 12 }}>
            <span style={S.label}>반복 종료일</span>
            <input type="date" style={S.input} value={form.repeatEndDate}
              onChange={e => set('repeatEndDate', e.target.value)} />
          </div>
        )}

        {/* 팀 공유 */}
        {staffList && staffList.length > 1 && (
          <div style={S.section}>
            <div style={S.sectionTitle}>👥 팀 공유</div>
            <div style={S.tagRow}>
              <button style={S.tag((form.sharedWith || []).length === staffList.filter(s => s.visibleId !== currentUser?.id).length)}
                onClick={() => {
                  const others = staffList.filter(s => s.visibleId !== currentUser?.id).map(s => s.visibleId);
                  const allSelected = others.every(id => (form.sharedWith || []).includes(id));
                  set('sharedWith', allSelected ? [] : others);
                }}>
                전체 선택
              </button>
              {staffList.filter(s => s.visibleId !== currentUser?.id && s.visibleId).map(s => (
                <button key={s.visibleId} style={S.tag((form.sharedWith || []).includes(s.visibleId))}
                  onClick={() => toggleShared(s.visibleId)}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 메모 */}
        <div style={{ marginBottom: 16 }}>
          <span style={S.label}>📝 메모</span>
          <textarea style={{ ...S.input, resize: 'vertical', minHeight: 70 }}
            placeholder="메모 (선택)" value={form.memo}
            onChange={e => set('memo', e.target.value)} />
        </div>

        <button style={S.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : (isEdit ? '✅ 수정 완료' : '✅ 저장')}
        </button>
        {isEdit && (
          <button style={S.deleteBtn} onClick={handleDelete}>🗑️ 삭제</button>
        )}
        <button
          style={{ ...S.deleteBtn, background: '#f1f5f9', color: '#64748b', marginTop: 6 }}
          onClick={onClose}
        >
          취소
        </button>
      </div>
    </div>
  );
}
