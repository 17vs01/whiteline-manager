// =============================================
// 월별 점검 입력 — 구획/트랩은 영구, 포획수만 매월 입력
// =============================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Swal from 'sweetalert2';
import {
  getAreas, getAllTraps,
  getMonthlyRecord, saveMonthlyRecord, initMonthlyRecord,
} from './pestFirestore';
import {
  AREA_TYPES, TRAP_TYPES, TRAP_CATEGORY, TRAFFIC_SCORE, SCORE_ITEMS,
  PEST_TYPES, UV_INSECTS, FLY_INSECTS, BAIT_PESTS,
  getAreaTypeInfo, getTrapTypeInfo, getPestListByTrapType,
  formatYearMonth, scoreToKey,
} from './pestConstants';

const S = {
  card:   { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  row:    { display: 'flex', alignItems: 'center', gap: 8 },
  btn:    (c='#3b82f6') => ({ padding: '8px 16px', background: c, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }),
  btnSm:  (c='#3b82f6') => ({ padding: '5px 10px', background: c, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }),
  input:  { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, width: '100%', boxSizing: 'border-box' },
  numInput: { padding: '5px 6px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 58, textAlign: 'center' },
  label:  { fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 2 },
  section:{ fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginBottom: 10 },
  badge:  (c, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 'bold', color: c, background: bg || c + '22' }),
};

// 신호등 선택기
function TrafficSelector({ value, onChange, label }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={S.label}>{label}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {['green', 'yellow', 'red'].map(k => {
          const info = TRAFFIC_SCORE[k];
          const active = value === k;
          return (
            <button key={k} onClick={() => onChange(k)} style={{
              flex: 1, padding: '5px 2px', border: `2px solid ${active ? info.color : '#e5e7eb'}`,
              borderRadius: 7, background: active ? info.bg : '#fff',
              cursor: 'pointer', fontSize: 12, fontWeight: active ? 'bold' : 'normal',
              color: active ? info.color : '#9ca3af',
            }}>
              {info.emoji} {info.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 트랩 포획수 입력 한 줄
function TrapCatchRow({ trap, catches, uvCatches, consumed, memo, onChange }) {
  const ti = getTrapTypeInfo(trap.type);
  const isBait = TRAP_CATEGORY.bait.includes(trap.type);
  const isUV   = TRAP_CATEGORY.uv.includes(trap.type);
  const pestList = getPestListByTrapType(trap.type);
  const [open, setOpen] = useState(false);

  const catchMap = catches   || {};
  const uvMap    = uvCatches || {};
  const total    = isBait ? (consumed ? 1 : 0)
    : isUV ? Object.values(uvMap).reduce((s, v) => s + (v || 0), 0)
    : Object.values(catchMap).reduce((s, v) => s + (v || 0), 0);

  return (
    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 8, marginBottom: 8 }}>
      {/* 헤더 */}
      <div style={{ ...S.row, cursor: 'pointer', marginBottom: open ? 8 : 0 }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 16 }}>{ti.icon}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 'bold', fontSize: 13 }}>{trap.number}</span>
          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>{ti.label}</span>
        </div>
        {total > 0
          ? <span style={S.badge('#ef4444')}>총 {total}{isBait ? '소모' : '마리'}</span>
          : <span style={S.badge('#6b7280', '#f1f5f9')}>0{isBait ? '' : '마리'}</span>}
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* 펼쳐진 입력 */}
      {open && (
        <div style={{ paddingLeft: 12 }}>
          {isBait ? (
            <label style={{ ...S.row, cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={!!consumed}
                onChange={e => onChange({ consumed: e.target.checked })} />
              <span>소모됨 (교체 필요)</span>
            </label>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6, marginBottom: 6 }}>
              {pestList.map(p => (
                <div key={p.value}>
                  <label style={S.label}>{p.icon} {p.label}</label>
                  <input
                    type="number" min="0" style={S.numInput}
                    value={isUV ? (uvMap[p.value] || 0) : (catchMap[p.value] || 0)}
                    onChange={e => {
                      const v = parseInt(e.target.value) || 0;
                      if (isUV) onChange({ uvCatches: { ...uvMap, [p.value]: v } });
                      else      onChange({ catches: { ...catchMap, [p.value]: v } });
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <label style={S.label}>메모</label>
            <input style={{ ...S.input, width: '100%' }} placeholder="특이사항" value={memo || ''}
              onChange={e => onChange({ memo: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

// 구역 하나의 입력 카드
function AreaEntryCard({ area, traps, areaScore, trapCatches, onScoreChange, onCatchChange }) {
  const [open, setOpen] = useState(false);
  const ti = getAreaTypeInfo(area.type);
  const scores = areaScore || {};

  // 이 구역의 신호등 최악값
  const vals = SCORE_ITEMS.map(s => TRAFFIC_SCORE[scores[s.key] || 'green'].value);
  const worstKey = scoreToKey(Math.max(...vals));
  const worstInfo = TRAFFIC_SCORE[worstKey];

  // 이 구역 트랩들의 총 포획수
  const areaTotal = traps.reduce((sum, t) => {
    const tc = trapCatches[t.id] || {};
    const isBait = TRAP_CATEGORY.bait.includes(t.type);
    const isUV = TRAP_CATEGORY.uv.includes(t.type);
    if (isBait) return sum + (tc.consumed ? 1 : 0);
    if (isUV) return sum + Object.values(tc.uvCatches || {}).reduce((s, v) => s + (v || 0), 0);
    return sum + Object.values(tc.catches || {}).reduce((s, v) => s + (v || 0), 0);
  }, 0);

  return (
    <div style={S.card}>
      {/* 헤더 */}
      <div style={{ ...S.row, cursor: 'pointer', marginBottom: open ? 12 : 0 }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 20 }}>{ti.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', fontSize: 14 }}>{area.name}</div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>트랩 {traps.length}개</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={S.badge(worstInfo.color, worstInfo.bg)}>{worstInfo.emoji} {worstInfo.label}</span>
          {areaTotal > 0 && <span style={S.badge('#ef4444')}>포획 {areaTotal}</span>}
        </div>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div>
          {/* 신호등 평가 */}
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <div style={{ ...S.section, fontSize: 12, marginBottom: 8 }}>📊 환경 평가</div>
            {SCORE_ITEMS.map(item => (
              <TrafficSelector key={item.key}
                label={item.label}
                value={scores[item.key] || 'green'}
                onChange={v => onScoreChange(area.id, item.key, v)} />
            ))}
            <div style={{ marginTop: 6 }}>
              <label style={S.label}>메모 / 즉시조치</label>
              <textarea
                style={{ ...S.input, height: 48, resize: 'none' }}
                placeholder="특이사항, 조치사항"
                value={scores.memo || ''}
                onChange={e => onScoreChange(area.id, 'memo', e.target.value)}
              />
            </div>
          </div>

          {/* 트랩별 포획수 */}
          {traps.length > 0 && (
            <div>
              <div style={{ ...S.section, fontSize: 12, marginBottom: 8 }}>📋 트랩별 포획 기록</div>
              {traps.map(trap => {
                const tc = trapCatches[trap.id] || {};
                return (
                  <TrapCatchRow key={trap.id} trap={trap}
                    catches={tc.catches} uvCatches={tc.uvCatches}
                    consumed={tc.consumed} memo={tc.memo}
                    onChange={(update) => onCatchChange(trap.id, update)} />
                );
              })}
            </div>
          )}
          {traps.length === 0 && (
            <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>
              등록된 트랩 없음 — 트랩 설치 탭에서 추가하세요
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 메인: 월별 점검 입력 뷰
// ─────────────────────────────────────────
function PestMonthlyEntry({ client, currentUser, onBack }) {
  const now = new Date();
  const defaultYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [yearMonth, setYearMonth] = useState(defaultYM);
  const [areas,     setAreas]     = useState([]);
  const [traps,     setTraps]     = useState([]); // 전체 트랩 (영구)
  const [record,    setRecord]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const autoSaveTimer = useRef(null);

  // 로컬 상태 (저장 전 편집 중)
  const [localRecord, setLocalRecord] = useState(null);

  const load = useCallback(async (ym) => {
    setLoading(true);
    const [areasData, trapsData] = await Promise.all([
      getAreas(client.id),
      getAllTraps(client.id),
    ]);
    setAreas(areasData);
    setTraps(trapsData);

    let rec = await getMonthlyRecord(client.id, ym);
    if (!rec) {
      rec = await initMonthlyRecord(client.id, ym,
        currentUser?.name || '', '화이트라인');
    }
    setRecord(rec);
    setLocalRecord(JSON.parse(JSON.stringify(rec))); // 딥카피
    setLoading(false);
  }, [client.id, currentUser]);

  useEffect(() => { load(yearMonth); }, [yearMonth, load]);

  // 자동저장 (3초 디바운스)
  const triggerAutoSave = useCallback((updated) => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await saveMonthlyRecord(client.id, yearMonth, {
        areaScores:  updated.areaScores,
        trapCatches: updated.trapCatches,
        inspectorName: updated.inspectorName,
        companyName:   updated.companyName,
        overallComment: updated.overallComment,
        specialNotes:   updated.specialNotes,
        pesticideUsed:  updated.pesticideUsed || [],
      });
    }, 3000);
  }, [client.id, yearMonth]);

  const updateLocal = (updater) => {
    setLocalRecord(prev => {
      const next = updater(prev);
      triggerAutoSave(next);
      return next;
    });
  };

  const handleScoreChange = (areaId, key, val) => {
    updateLocal(prev => ({
      ...prev,
      areaScores: {
        ...prev.areaScores,
        [areaId]: { ...(prev.areaScores?.[areaId] || {}), [key]: val },
      },
    }));
  };

  const handleCatchChange = (trapId, update) => {
    updateLocal(prev => ({
      ...prev,
      trapCatches: {
        ...prev.trapCatches,
        [trapId]: { ...(prev.trapCatches?.[trapId] || {}), ...update },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    clearTimeout(autoSaveTimer.current);
    try {
      await saveMonthlyRecord(client.id, yearMonth, {
        ...localRecord,
        isFinalized: false,
      });
      Swal.fire({ icon: 'success', title: '저장 완료', timer: 1200, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '저장 실패', 'error');
    }
    setSaving(false);
  };

  // 장소(location) 레벨 구획만 표시
  const locationAreas = areas.filter(a => a.level === 'location')
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  // 구획이 없으면 모든 구획 표시
  const displayAreas = locationAreas.length > 0 ? locationAreas
    : areas.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  // yearMonth 선택 — 최근 24개월
  const monthOptions = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthOptions.push({ value: ym, label: formatYearMonth(ym) });
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>불러오는 중...</div>;

  const lr = localRecord || {};

  return (
    <div>
      {/* 상단 — 월 선택 + 기본정보 */}
      <div style={S.card}>
        <div style={{ ...S.row, marginBottom: 12 }}>
          <select style={{ ...S.input, width: 'auto', flex: 1 }}
            value={yearMonth} onChange={e => setYearMonth(e.target.value)}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button style={S.btn(saving ? '#9ca3af' : '#22c55e')} onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '💾 저장'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={S.label}>점검자</label>
            <input style={S.input} placeholder="점검자 이름" value={lr.inspectorName || ''}
              onChange={e => updateLocal(p => ({ ...p, inspectorName: e.target.value }))} />
          </div>
          <div>
            <label style={S.label}>방역업체</label>
            <input style={S.input} placeholder="업체명" value={lr.companyName || ''}
              onChange={e => updateLocal(p => ({ ...p, companyName: e.target.value }))} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
          💡 입력 후 3초 뒤 자동저장 · 구획/트랩 구조는 변경되지 않고 이 달의 포획 데이터만 저장됩니다
        </div>
      </div>

      {/* 구역별 점검 */}
      <div style={{ fontSize: 13, fontWeight: 'bold', color: '#374151', marginBottom: 8 }}>
        📍 구역별 점검 ({displayAreas.length}개 구역)
      </div>

      {displayAreas.length === 0 ? (
        <div style={{ ...S.card, textAlign: 'center', color: '#9ca3af', padding: 30 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
          <div>구획 관리 탭에서 구획을 먼저 만드세요</div>
        </div>
      ) : displayAreas.map(area => {
        const areaTraps = traps.filter(t => t.areaId === area.id)
          .sort((a, b) => (a.number || '').localeCompare(b.number || ''));
        return (
          <AreaEntryCard key={area.id}
            area={area}
            traps={areaTraps}
            areaScore={lr.areaScores?.[area.id]}
            trapCatches={lr.trapCatches || {}}
            onScoreChange={handleScoreChange}
            onCatchChange={handleCatchChange}
          />
        );
      })}

      {/* 종합 의견 */}
      <div style={S.card}>
        <div style={{ ...S.section, marginBottom: 8 }}>💬 종합 의견</div>
        <textarea style={{ ...S.input, height: 70, resize: 'none', marginBottom: 8 }}
          placeholder="이번 달 종합 의견"
          value={lr.overallComment || ''}
          onChange={e => updateLocal(p => ({ ...p, overallComment: e.target.value }))} />
        <textarea style={{ ...S.input, height: 50, resize: 'none' }}
          placeholder="특이사항"
          value={lr.specialNotes || ''}
          onChange={e => updateLocal(p => ({ ...p, specialNotes: e.target.value }))} />
      </div>

      <button style={{ ...S.btn(), width: '100%', padding: 12, fontSize: 15 }}
        onClick={handleSave} disabled={saving}>
        {saving ? '저장 중...' : `💾 ${formatYearMonth(yearMonth)} 점검 데이터 저장`}
      </button>
    </div>
  );
}

export default PestMonthlyEntry;
