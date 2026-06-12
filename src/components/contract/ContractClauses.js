import React, { useState } from 'react';
import { CLAUSE_KEYS, CLAUSE_META, DEFAULT_CLAUSES } from './contractConstants';
import Swal from 'sweetalert2';

function ContractClauses({ clauses, notices, includeNotices, onChange, onNoticesChange, onIncludeNoticesChange, onBack }) {
  const [editingKey, setEditingKey] = useState(null);
  const [editText, setEditText]     = useState('');

  const toggleClause = (key) => {
    onChange({ ...clauses, [key]: { ...clauses[key], enabled: !clauses[key]?.enabled } });
  };

  const startEdit = (key) => {
    setEditingKey(key);
    setEditText(clauses[key]?.content || DEFAULT_CLAUSES[key] || '');
  };

  const saveEdit = () => {
    const isChanged = editText.trim() !== (DEFAULT_CLAUSES[editingKey] || '').trim();
    onChange({
      ...clauses,
      [editingKey]: { ...clauses[editingKey], content: editText, customized: isChanged }
    });
    setEditingKey(null);
  };

  const restoreDefault = async (key) => {
    const r = await Swal.fire({
      title: '원본 복구',
      text: '이 조항을 기본 내용으로 복구하시겠습니까?',
      icon: 'question', showCancelButton: true,
      confirmButtonText: '복구', cancelButtonText: '취소',
    });
    if (!r.isConfirmed) return;
    onChange({
      ...clauses,
      [key]: { ...clauses[key], content: DEFAULT_CLAUSES[key] || '', customized: false }
    });
    if (editingKey === key) {
      setEditText(DEFAULT_CLAUSES[key] || '');
    }
  };

  const enabledCount = CLAUSE_KEYS.filter(k => clauses[k]?.enabled).length;

  return (
    <div style={cls.container}>
      <div style={cls.header}>
        <button onClick={onBack} style={cls.backBtn}>← 뒤로</button>
        <h2 style={cls.title}>📄 조항 설정</h2>
        <div style={{ fontSize: '13px', color: '#64748b' }}>{enabledCount}개 활성</div>
      </div>

      <div style={cls.notice}>
        💡 조항을 켜고 끌 수 있으며, 내용을 직접 편집할 수 있습니다. ✏️ 표시는 원본에서 수정된 조항입니다.
      </div>

      {/* 조항 목록 */}
      {CLAUSE_KEYS.map(key => {
        const meta = CLAUSE_META[key];
        const clause = clauses[key] || { enabled: false, content: DEFAULT_CLAUSES[key] || '', customized: false };
        const isEnabled = clause.enabled;
        const isCustomized = clause.customized;
        const isEditing = editingKey === key;

        return (
          <div key={key} style={{ ...cls.clauseCard, opacity: isEnabled ? 1 : 0.65, border: `1.5px solid ${isEnabled ? (isCustomized ? '#fde68a' : '#86efac') : '#e2e8f0'}` }}>
            <div style={cls.clauseHeader}>
              {/* 토글 버튼 */}
              <button onClick={() => toggleClause(key)}
                style={{ ...cls.toggleBtn, background: isEnabled ? (isCustomized ? '#f59e0b' : '#10b981') : '#e2e8f0', color: isEnabled ? 'white' : '#94a3b8' }}>
                {isEnabled ? 'ON' : 'OFF'}
              </button>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: isEnabled ? '#1e293b' : '#94a3b8' }}>
                  {meta.label}
                  {isCustomized && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#f59e0b' }}>✏️ 수정됨</span>}
                </div>
              </div>

              {/* 액션 버튼 */}
              {isEnabled && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  {isCustomized && (
                    <button onClick={() => restoreDefault(key)} title="원본 복구"
                      style={cls.actionBtn('#94a3b8')}>🔄</button>
                  )}
                  <button onClick={() => isEditing ? saveEdit() : startEdit(key)}
                    style={cls.actionBtn(isEditing ? '#10b981' : '#3b82f6')}>
                    {isEditing ? '✅ 저장' : '✏️ 편집'}
                  </button>
                </div>
              )}
            </div>

            {/* 조항 내용 미리보기 / 편집 */}
            {isEnabled && (
              isEditing ? (
                <div style={{ marginTop: '10px' }}>
                  <textarea value={editText} onChange={e => setEditText(e.target.value)}
                    style={cls.editArea} rows={8}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                    <button onClick={saveEdit} style={cls.saveEditBtn}>✅ 저장</button>
                    <button onClick={() => restoreDefault(key)} style={cls.restoreBtn}>🔄 원본 복구</button>
                    <button onClick={() => setEditingKey(null)} style={cls.cancelEditBtn}>취소</button>
                  </div>
                </div>
              ) : (
                <div style={cls.clausePreview}>
                  {(clause.content || DEFAULT_CLAUSES[key] || '').split('\n').slice(0, 3).map((line, i) => (
                    <div key={i} style={{ fontSize: '12px', color: '#374151', lineHeight: '1.6' }}>{line}</div>
                  ))}
                  {(clause.content || DEFAULT_CLAUSES[key] || '').split('\n').length > 3 && (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>... (더 있음)</div>
                  )}
                </div>
              )
            )}
          </div>
        );
      })}

      {/* 유의사항 섹션 */}
      <div style={{ ...cls.clauseCard, border: `1.5px solid ${includeNotices ? '#86efac' : '#e2e8f0'}` }}>
        <div style={cls.clauseHeader}>
          <button onClick={() => onIncludeNoticesChange(!includeNotices)}
            style={{ ...cls.toggleBtn, background: includeNotices ? '#10b981' : '#e2e8f0', color: includeNotices ? 'white' : '#94a3b8' }}>
            {includeNotices ? 'ON' : 'OFF'}
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: includeNotices ? '#1e293b' : '#94a3b8' }}>
              ★ 유의사항
            </div>
          </div>
        </div>
        {includeNotices && (
          <div style={{ marginTop: '10px' }}>
            {notices.map((notice, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '12px', color: '#1e3a5f', marginTop: '2px' }}>{i + 1}.</span>
                <input value={notice} onChange={e => {
                  const next = [...notices]; next[i] = e.target.value; onNoticesChange(next);
                }} style={{ ...cls.noticeInput, flex: 1 }} />
                <button onClick={() => {
                  const next = notices.filter((_, j) => j !== i); onNoticesChange(next);
                }} style={{ background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={() => onNoticesChange([...notices, ''])}
              style={{ padding: '6px 14px', background: '#eff6ff', color: '#3b82f6', border: '1px dashed #bfdbfe', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginTop: '4px' }}>
              + 유의사항 추가
            </button>
          </div>
        )}
      </div>

      <button onClick={onBack} style={cls.doneBtn}>✅ 조항 설정 완료</button>
    </div>
  );
}

const cls = {
  container: { paddingBottom: '20px' },
  header: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', padding: '4px 8px' },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', margin: 0, flex: 1 },
  notice: { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#1e40af', marginBottom: '12px', lineHeight: '1.5' },
  clauseCard: { background: 'white', borderRadius: '10px', padding: '12px 14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  clauseHeader: { display: 'flex', alignItems: 'center', gap: '10px' },
  toggleBtn: { padding: '4px 12px', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', flexShrink: 0 },
  actionBtn: (color) => ({ padding: '4px 8px', background: 'none', border: `1px solid ${color}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color, flexShrink: 0 }),
  clausePreview: { marginTop: '8px', padding: '8px 10px', background: '#f8fafc', borderRadius: '6px', borderLeft: '3px solid #e2e8f0' },
  editArea: { width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' },
  saveEditBtn: { padding: '7px 14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  restoreBtn: { padding: '7px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  cancelEditBtn: { padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  noticeInput: { padding: '7px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' },
  doneBtn: { width: '100%', padding: '14px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold', marginTop: '10px' },
};

export default ContractClauses;
