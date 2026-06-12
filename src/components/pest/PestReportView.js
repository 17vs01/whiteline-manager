// =============================================
// 보고서 뷰 — 섹션 선택 + 표/그래프 + 인쇄
// =============================================
import React, { useState, useEffect, useCallback } from 'react';
import {
  getAreas, getAllTraps,
  getMonthlyRecord, listMonthlyRecords,
  getMonthlyRecords, saveMonthlyRecord,
} from './pestFirestore';
import {
  AREA_TYPES, TRAP_TYPES, TRAP_CATEGORY, TRAFFIC_SCORE, SCORE_ITEMS,
  PEST_TYPES, UV_INSECTS, FLY_INSECTS, BAIT_PESTS,
  getAreaTypeInfo, getTrapTypeInfo, getPestListByTrapType, getPestLabel,
  formatYearMonth, getRelativeMonth, getComparisonMonths, sumTotalCatches,
  scoreToKey, avgToGrade,
} from './pestConstants';

const S = {
  card:    { background: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  row:     { display: 'flex', alignItems: 'center', gap: 8 },
  btn:     (c='#3b82f6') => ({ padding: '8px 16px', background: c, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' }),
  btnSm:   (c='#3b82f6') => ({ padding: '5px 10px', background: c, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }),
  input:   { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, width: '100%', boxSizing: 'border-box' },
  section: { fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginBottom: 10 },
  badge:   (c, bg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 'bold', color: c, background: bg || c + '22' }),
  th:      { padding: '6px 10px', background: '#f1f5f9', fontWeight: 'bold', fontSize: 12, textAlign: 'center', border: '1px solid #e2e8f0' },
  td:      { padding: '6px 10px', fontSize: 12, textAlign: 'center', border: '1px solid #e2e8f0' },
};

// ─────────────────────────────────────────
// SVG 막대 그래프
// ─────────────────────────────────────────
function BarChart({ data, colorFn, title, unit = '마리' }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 560, H = 180, PAD_L = 10, PAD_R = 10, PAD_T = 24, PAD_B = 32;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const n = data.length;
  const barW = Math.min(60, (chartW / n) * 0.6);
  const gap   = (chartW / n);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {/* 가로 기준선 */}
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B}
        stroke="#e2e8f0" strokeWidth="1" />
      {/* 막대 */}
      {data.map((d, i) => {
        const bh  = max === 0 ? 0 : (d.value / max) * chartH;
        const bx  = PAD_L + gap * i + (gap - barW) / 2;
        const by  = PAD_T + chartH - bh;
        const col = colorFn ? colorFn(d, i) : '#3b82f6';
        return (
          <g key={i}>
            {bh > 0 && <rect x={bx} y={by} width={barW} height={bh} fill={col} rx="4" opacity="0.85" />}
            {/* 값 라벨 */}
            <text x={bx + barW / 2} y={bh > 0 ? by - 4 : H - PAD_B - 6}
              textAnchor="middle" fontSize="11" fill="#374151">{d.value}</text>
            {/* x 라벨 */}
            <text x={bx + barW / 2} y={H - PAD_B + 16}
              textAnchor="middle" fontSize="11" fill="#6b7280">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────
// 섹션 설정 토글
// ─────────────────────────────────────────
const SECTION_CONFIG = [
  { key: 'clientInfo',        label: '고객사 기본 정보',      hasChart: false },
  { key: 'areaResults',       label: '구역별 신호등 결과',    hasChart: false },
  { key: 'monitoringTraps',   label: '모니터링트랩 포획 현황', hasChart: false },
  { key: 'uvTraps',           label: 'UV포충등 포획 현황',    hasChart: false },
  { key: 'baitStations',      label: '베이트/쥐먹이상자 현황', hasChart: false },
  { key: 'threeMonthTrend',   label: '최근 3개월 비교',       hasChart: true  },
  { key: 'yearOverYear',      label: '작년 동월 비교',        hasChart: true  },
  { key: 'annualFlow',        label: '연간 해충 흐름',        hasChart: true  },
  { key: 'pesticideUse',      label: '약제 사용 현황',        hasChart: false },
  { key: 'conclusion',        label: '종합 의견',             hasChart: false },
];

function SectionToggle({ config, onChange }) {
  return (
    <div style={S.card}>
      <div style={{ ...S.section, marginBottom: 12 }}>📋 보고서 구성 설정</div>
      {SECTION_CONFIG.map(sec => (
        <div key={sec.key} style={{ ...S.row, marginBottom: 10, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
          <label style={{ flex: 1, ...S.row, cursor: 'pointer', gap: 8 }}>
            <input type="checkbox"
              checked={config.sections?.[sec.key] !== false}
              onChange={e => onChange('section', sec.key, e.target.checked)}
              style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13 }}>{sec.label}</span>
          </label>
          {sec.hasChart && config.sections?.[sec.key] !== false && (
            <div style={{ display: 'flex', gap: 4 }}>
              {['chart', 'table'].map(ct => {
                const active = (config.chartTypes?.[sec.key] || 'chart') === ct;
                return (
                  <button key={ct} onClick={() => onChange('chartType', sec.key, ct)}
                    style={{
                      padding: '3px 8px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
                      border: `1.5px solid ${active ? '#3b82f6' : '#d1d5db'}`,
                      background: active ? '#eff6ff' : '#fff',
                      color: active ? '#3b82f6' : '#6b7280', fontWeight: active ? 'bold' : 'normal',
                    }}>
                    {ct === 'chart' ? '📊 그래프' : '📋 표'}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// 보고서 본문
// ─────────────────────────────────────────
function ReportBody({ client, areas, traps, record, compRecords, yearMonth, config }) {
  if (!record) return <div style={{ textAlign: 'center', color: '#9ca3af', padding: 30 }}>데이터 없음</div>;

  const sec    = config?.sections || {};
  const ctypes = config?.chartTypes || {};
  const isChart = (key) => (ctypes[key] || 'chart') === 'chart';

  const locationAreas = areas.filter(a => a.level === 'location').length > 0
    ? areas.filter(a => a.level === 'location')
    : areas;

  // 구역별 종합 신호등
  const areaGrade = (areaId) => {
    const scores = record.areaScores?.[areaId] || {};
    const vals = SCORE_ITEMS.map(s => TRAFFIC_SCORE[scores[s.key] || 'green'].value);
    return scoreToKey(Math.max(...vals));
  };

  // 트랩별 포획 합계
  const trapTotal = (trap) => {
    const tc = record.trapCatches?.[trap.id] || {};
    if (TRAP_CATEGORY.bait.includes(trap.type)) return tc.consumed ? 1 : 0;
    if (TRAP_CATEGORY.uv.includes(trap.type))
      return Object.values(tc.uvCatches || {}).reduce((s, v) => s + (v || 0), 0);
    return Object.values(tc.catches || {}).reduce((s, v) => s + (v || 0), 0);
  };

  // 전체 포획수
  const totalThisMonth = sumTotalCatches(record);

  // 최근 3개월 데이터
  const m1 = getRelativeMonth(yearMonth, -2);
  const m2 = getRelativeMonth(yearMonth, -1);
  const m3 = yearMonth;
  const threeMonthData = [
    { label: formatYearMonth(m1).replace('년 ', '.'), value: sumTotalCatches(compRecords[m1]) },
    { label: formatYearMonth(m2).replace('년 ', '.'), value: sumTotalCatches(compRecords[m2]) },
    { label: formatYearMonth(m3).replace('년 ', '.') + ' (현재)', value: totalThisMonth, highlight: true },
  ];

  // 작년 동월
  const lastYearYM = getRelativeMonth(yearMonth, -12);
  const lastYearVal = sumTotalCatches(compRecords[lastYearYM]);

  // 연간 흐름 (올해 1월~현재월)
  const [y, m] = yearMonth.split('-').map(Number);
  const annualData = Array.from({ length: m }, (_, i) => {
    const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
    return { label: `${i + 1}월`, value: sumTotalCatches(compRecords[ym]) };
  });

  // UV 포충기 총합 (날벌레별)
  const uvTotals = {};
  traps.filter(t => TRAP_CATEGORY.uv.includes(t.type)).forEach(trap => {
    const tc = record.trapCatches?.[trap.id] || {};
    Object.entries(tc.uvCatches || {}).forEach(([k, v]) => {
      uvTotals[k] = (uvTotals[k] || 0) + (v || 0);
    });
  });

  const reportDate = new Date().toLocaleDateString('ko-KR');
  const inspDate   = record.year ? `${record.year}년 ${record.month}월` : formatYearMonth(yearMonth);

  return (
    <div id="pest-report-body" style={{ fontFamily: 'sans-serif', background: '#fff' }}>
      {/* ①  기본 정보 */}
      {sec.clientInfo !== false && (
        <div style={{ borderBottom: '2px solid #1e40af', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 'bold', color: '#1e293b', marginBottom: 4 }}>
                🪳 {client.name}
              </div>
              <div style={{ color: '#6b7280', fontSize: 13 }}>방역 점검 보고서 · {inspDate}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
              <div>발행일: {reportDate}</div>
              <div>점검자: {record.inspectorName}</div>
              <div>업체: {record.companyName}</div>
            </div>
          </div>
          {/* 종합 현황 배지 */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            {['green', 'yellow', 'red'].map(k => {
              const cnt = locationAreas.filter(a => areaGrade(a.id) === k).length;
              const info = TRAFFIC_SCORE[k];
              return (
                <div key={k} style={{ ...S.badge(info.color, info.bg), padding: '5px 14px', fontSize: 13 }}>
                  {info.emoji} {info.label} {cnt}구역
                </div>
              );
            })}
            <div style={{ ...S.badge('#374151', '#f1f5f9'), padding: '5px 14px', fontSize: 13 }}>
              총 포획 {totalThisMonth}마리
            </div>
          </div>
        </div>
      )}

      {/* ② 구역별 신호등 결과 */}
      {sec.areaResults !== false && locationAreas.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #3b82f6', paddingLeft: 10, marginBottom: 12 }}>
            📍 구역별 점검 결과
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={S.th}>구역명</th>
                {SCORE_ITEMS.map(s => <th key={s.key} style={S.th}>{s.label}</th>)}
                <th style={S.th}>종합</th>
                <th style={S.th}>포획 합계</th>
                <th style={S.th}>메모</th>
              </tr>
            </thead>
            <tbody>
              {locationAreas.map(area => {
                const scores = record.areaScores?.[area.id] || {};
                const grade  = areaGrade(area.id);
                const gradeInfo = TRAFFIC_SCORE[grade];
                const areaTraps = traps.filter(t => t.areaId === area.id);
                const areaTotal = areaTraps.reduce((s, t) => s + trapTotal(t), 0);
                return (
                  <tr key={area.id} style={{ background: grade === 'red' ? '#fff5f5' : grade === 'yellow' ? '#fffbeb' : '#fff' }}>
                    <td style={{ ...S.td, fontWeight: 'bold', textAlign: 'left' }}>
                      {getAreaTypeInfo(area.type).icon} {area.name}
                    </td>
                    {SCORE_ITEMS.map(s => {
                      const k = scores[s.key] || 'green';
                      const info = TRAFFIC_SCORE[k];
                      return <td key={s.key} style={{ ...S.td, color: info.color, fontWeight: 'bold' }}>{info.emoji}</td>;
                    })}
                    <td style={{ ...S.td, color: gradeInfo.color, fontWeight: 'bold' }}>{gradeInfo.emoji} {gradeInfo.label}</td>
                    <td style={{ ...S.td, fontWeight: areaTotal > 0 ? 'bold' : 'normal', color: areaTotal > 0 ? '#ef4444' : '#6b7280' }}>
                      {areaTotal}마리
                    </td>
                    <td style={{ ...S.td, textAlign: 'left', color: '#6b7280' }}>{scores.memo || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ③ 모니터링트랩 현황 */}
      {sec.monitoringTraps !== false && (() => {
        const mTraps = traps.filter(t => TRAP_CATEGORY.monitoring.includes(t.type));
        if (mTraps.length === 0) return null;
        // 해충별 집계
        const pestSums = {};
        mTraps.forEach(trap => {
          const catches = record.trapCatches?.[trap.id]?.catches || {};
          PEST_TYPES.forEach(p => {
            pestSums[p.value] = (pestSums[p.value] || 0) + (catches[p.value] || 0);
          });
        });
        const total = Object.values(pestSums).reduce((s, v) => s + v, 0);
        return (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #10b981', paddingLeft: 10, marginBottom: 12 }}>
              📋 모니터링트랩 포획 현황 (총 {total}마리)
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={S.th}>트랩번호</th>
                  <th style={S.th}>위치 구역</th>
                  {PEST_TYPES.map(p => <th key={p.value} style={S.th}>{p.icon}{p.label}</th>)}
                  <th style={S.th}>합계</th>
                </tr>
              </thead>
              <tbody>
                {mTraps.map(trap => {
                  const catches = record.trapCatches?.[trap.id]?.catches || {};
                  const tot = Object.values(catches).reduce((s, v) => s + (v || 0), 0);
                  const areaName = areas.find(a => a.id === trap.areaId)?.name || '-';
                  return (
                    <tr key={trap.id} style={{ background: tot > 0 ? '#fff5f5' : '#fff' }}>
                      <td style={{ ...S.td, fontWeight: 'bold' }}>{trap.number}</td>
                      <td style={S.td}>{areaName}</td>
                      {PEST_TYPES.map(p => (
                        <td key={p.value} style={{ ...S.td, color: catches[p.value] > 0 ? '#ef4444' : '#9ca3af', fontWeight: catches[p.value] > 0 ? 'bold' : 'normal' }}>
                          {catches[p.value] || 0}
                        </td>
                      ))}
                      <td style={{ ...S.td, fontWeight: 'bold', color: tot > 0 ? '#ef4444' : '#6b7280' }}>{tot}</td>
                    </tr>
                  );
                })}
                {/* 합계 행 */}
                <tr style={{ background: '#f1f5f9', fontWeight: 'bold' }}>
                  <td style={S.th} colSpan={2}>합계</td>
                  {PEST_TYPES.map(p => <td key={p.value} style={{ ...S.td, fontWeight: 'bold' }}>{pestSums[p.value] || 0}</td>)}
                  <td style={{ ...S.td, fontWeight: 'bold', color: total > 0 ? '#ef4444' : '#6b7280' }}>{total}</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })()}

      {/* ④ UV포충등 현황 */}
      {sec.uvTraps !== false && (() => {
        const uvTraps = traps.filter(t => TRAP_CATEGORY.uv.includes(t.type));
        if (uvTraps.length === 0) return null;
        const uvTotal = Object.values(uvTotals).reduce((s, v) => s + v, 0);
        const insects = traps.find(t => t.type === 'flyRibbon') ? FLY_INSECTS : UV_INSECTS;

        return (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #f59e0b', paddingLeft: 10, marginBottom: 12 }}>
              💡 UV포충등 포획 현황 (총 {uvTotal}마리)
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={S.th}>트랩번호</th>
                  <th style={S.th}>위치</th>
                  {UV_INSECTS.map(p => <th key={p.value} style={S.th}>{p.label}</th>)}
                  <th style={S.th}>합계</th>
                </tr>
              </thead>
              <tbody>
                {uvTraps.map(trap => {
                  const uv = record.trapCatches?.[trap.id]?.uvCatches || {};
                  const tot = Object.values(uv).reduce((s, v) => s + (v || 0), 0);
                  const areaName = areas.find(a => a.id === trap.areaId)?.name || '-';
                  return (
                    <tr key={trap.id} style={{ background: tot > 0 ? '#fffbeb' : '#fff' }}>
                      <td style={{ ...S.td, fontWeight: 'bold' }}>{trap.number}</td>
                      <td style={S.td}>{areaName}</td>
                      {UV_INSECTS.map(p => (
                        <td key={p.value} style={{ ...S.td, color: (uv[p.value] || 0) > 0 ? '#d97706' : '#9ca3af', fontWeight: (uv[p.value] || 0) > 0 ? 'bold' : 'normal' }}>
                          {uv[p.value] || 0}
                        </td>
                      ))}
                      <td style={{ ...S.td, fontWeight: 'bold' }}>{tot}</td>
                    </tr>
                  );
                })}
                {/* 날벌레별 합계 */}
                <tr style={{ background: '#fef9c3', fontWeight: 'bold' }}>
                  <td style={S.th} colSpan={2}>합계</td>
                  {UV_INSECTS.map(p => <td key={p.value} style={{ ...S.td, fontWeight: 'bold' }}>{uvTotals[p.value] || 0}</td>)}
                  <td style={{ ...S.td, fontWeight: 'bold', color: uvTotal > 0 ? '#d97706' : '#6b7280' }}>{uvTotal}</td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })()}

      {/* ⑤ 베이트/쥐먹이상자 */}
      {sec.baitStations !== false && (() => {
        const bTraps = traps.filter(t => TRAP_CATEGORY.bait.includes(t.type));
        if (bTraps.length === 0) return null;
        const consumed = bTraps.filter(t => record.trapCatches?.[t.id]?.consumed);
        return (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #8b5cf6', paddingLeft: 10, marginBottom: 12 }}>
              🧲 베이트/쥐먹이상자 현황 ({bTraps.length}개 설치)
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr><th style={S.th}>번호</th><th style={S.th}>종류</th><th style={S.th}>위치</th><th style={S.th}>소모여부</th><th style={S.th}>메모</th></tr>
              </thead>
              <tbody>
                {bTraps.map(trap => {
                  const tc = record.trapCatches?.[trap.id] || {};
                  const areaName = areas.find(a => a.id === trap.areaId)?.name || '-';
                  const ti = getTrapTypeInfo(trap.type);
                  return (
                    <tr key={trap.id} style={{ background: tc.consumed ? '#faf5ff' : '#fff' }}>
                      <td style={{ ...S.td, fontWeight: 'bold' }}>{trap.number}</td>
                      <td style={S.td}>{ti.icon} {ti.label}</td>
                      <td style={S.td}>{areaName}</td>
                      <td style={{ ...S.td, color: tc.consumed ? '#7c3aed' : '#22c55e', fontWeight: 'bold' }}>
                        {tc.consumed ? '✅ 소모됨 (교체필요)' : '정상'}
                      </td>
                      <td style={{ ...S.td, color: '#6b7280' }}>{tc.memo || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {consumed.length > 0 && (
              <div style={{ marginTop: 8, padding: '6px 12px', background: '#faf5ff', borderRadius: 6, fontSize: 12, color: '#7c3aed' }}>
                ⚠️ 소모된 베이트 {consumed.length}개 교체가 필요합니다
              </div>
            )}
          </section>
        );
      })()}

      {/* ⑥ 최근 3개월 비교 */}
      {sec.threeMonthTrend !== false && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #06b6d4', paddingLeft: 10, marginBottom: 12 }}>
            📈 최근 3개월 포획 추이
          </h2>
          {isChart('threeMonthTrend') ? (
            <BarChart
              data={threeMonthData}
              colorFn={(d) => d.highlight ? '#ef4444' : '#3b82f6'}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                {threeMonthData.map(d => <th key={d.label} style={S.th}>{d.label}</th>)}
                <th style={S.th}>증감</th>
              </tr></thead>
              <tbody><tr>
                {threeMonthData.map((d, i) => (
                  <td key={i} style={{ ...S.td, fontWeight: d.highlight ? 'bold' : 'normal', color: d.highlight ? '#ef4444' : '#374151' }}>{d.value}마리</td>
                ))}
                <td style={S.td}>
                  {(() => {
                    const diff = threeMonthData[2].value - threeMonthData[1].value;
                    return diff === 0 ? '→ 동일'
                      : diff > 0 ? <span style={{ color: '#ef4444' }}>▲ {diff}</span>
                      : <span style={{ color: '#22c55e' }}>▼ {Math.abs(diff)}</span>;
                  })()}
                </td>
              </tr></tbody>
            </table>
          )}
        </section>
      )}

      {/* ⑦ 작년 동월 비교 */}
      {sec.yearOverYear !== false && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #f97316', paddingLeft: 10, marginBottom: 12 }}>
            🔁 작년 동월 비교 ({formatYearMonth(lastYearYM)} vs {formatYearMonth(yearMonth)})
          </h2>
          {isChart('yearOverYear') ? (
            <BarChart
              data={[
                { label: formatYearMonth(lastYearYM), value: lastYearVal },
                { label: formatYearMonth(yearMonth) + ' (현재)', value: totalThisMonth, highlight: true },
              ]}
              colorFn={(d, i) => i === 0 ? '#94a3b8' : '#ef4444'}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr><th style={S.th}>항목</th><th style={S.th}>{formatYearMonth(lastYearYM)}</th><th style={S.th}>{formatYearMonth(yearMonth)}</th><th style={S.th}>증감</th></tr></thead>
              <tbody>
                <tr>
                  <td style={{ ...S.td, fontWeight: 'bold' }}>총 포획수</td>
                  <td style={S.td}>{lastYearVal}마리</td>
                  <td style={{ ...S.td, fontWeight: 'bold', color: '#ef4444' }}>{totalThisMonth}마리</td>
                  <td style={S.td}>
                    {(() => {
                      const diff = totalThisMonth - lastYearVal;
                      return diff === 0 ? '→ 동일'
                        : diff > 0 ? <span style={{ color: '#ef4444' }}>▲ {diff}</span>
                        : <span style={{ color: '#22c55e' }}>▼ {Math.abs(diff)}</span>;
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          {compRecords[lastYearYM] == null && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>※ 작년 데이터 없음</div>
          )}
        </section>
      )}

      {/* ⑧ 연간 해충 흐름 */}
      {sec.annualFlow !== false && annualData.length > 1 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #84cc16', paddingLeft: 10, marginBottom: 12 }}>
            🌿 {y}년 연간 해충 흐름
          </h2>
          {isChart('annualFlow') ? (
            <BarChart
              data={annualData}
              colorFn={(d, i) => i === annualData.length - 1 ? '#ef4444' : '#3b82f6'}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>{annualData.map(d => <th key={d.label} style={S.th}>{d.label}</th>)}</tr></thead>
              <tbody><tr>{annualData.map((d, i) => (
                <td key={i} style={{ ...S.td, fontWeight: i === annualData.length - 1 ? 'bold' : 'normal', color: i === annualData.length - 1 ? '#ef4444' : '#374151' }}>{d.value}</td>
              ))}</tr></tbody>
            </table>
          )}
        </section>
      )}

      {/* ⑨ 약제 사용 */}
      {sec.pesticideUse !== false && (record.pesticideUsed || []).length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #6b7280', paddingLeft: 10, marginBottom: 12 }}>
            💊 약제 사용 현황
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th style={S.th}>약제명</th><th style={S.th}>사용량</th><th style={S.th}>사용 구역</th></tr></thead>
            <tbody>
              {record.pesticideUsed.map((p, i) => (
                <tr key={i}><td style={S.td}>{p.name}</td><td style={S.td}>{p.amount}{p.unit || 'ml'}</td><td style={S.td}>{p.area || '-'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ⑩ 종합 의견 */}
      {sec.conclusion !== false && (record.overallComment || record.specialNotes) && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 'bold', borderLeft: '4px solid #1e40af', paddingLeft: 10, marginBottom: 12 }}>
            💬 종합 의견
          </h2>
          {record.overallComment && <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 8 }}>{record.overallComment}</p>}
          {record.specialNotes   && <p style={{ fontSize: 12, color: '#6b7280' }}>특이사항: {record.specialNotes}</p>}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 40 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ borderTop: '1px solid #374151', paddingTop: 4, fontSize: 12, color: '#374151', width: 100 }}>점검자 서명</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{record.inspectorName}</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 메인: 보고서 뷰
// ─────────────────────────────────────────
function PestReportView({ client, currentUser }) {
  const now = new Date();
  const defaultYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [yearMonth,    setYearMonth]    = useState(defaultYM);
  const [areas,        setAreas]        = useState([]);
  const [traps,        setTraps]        = useState([]);
  const [record,       setRecord]       = useState(null);
  const [compRecords,  setCompRecords]  = useState({});
  const [loading,      setLoading]      = useState(true);
  const [config,       setConfig]       = useState(null);
  const [showPreview,  setShowPreview]  = useState(false);
  const [monthList,    setMonthList]    = useState([]);

  const load = useCallback(async (ym) => {
    setLoading(true);
    setShowPreview(false);
    const [areasData, trapsData, monthlyList] = await Promise.all([
      getAreas(client.id),
      getAllTraps(client.id),
      listMonthlyRecords(client.id),
    ]);
    setAreas(areasData);
    setTraps(trapsData);
    setMonthList(monthlyList);

    const rec = await getMonthlyRecord(client.id, ym);
    setRecord(rec);

    const cfg = rec?.reportConfig || {
      sections: Object.fromEntries(SECTION_CONFIG.map(s => [s.key, true])),
      chartTypes: { threeMonthTrend: 'chart', yearOverYear: 'chart', annualFlow: 'chart' },
    };
    setConfig(cfg);

    // 비교 월 데이터
    const compYMs = getComparisonMonths(ym);
    const compData = await getMonthlyRecords(client.id, compYMs);
    setCompRecords(compData);

    setLoading(false);
  }, [client.id]);

  useEffect(() => { load(yearMonth); }, [yearMonth, load]);

  const handleConfigChange = async (type, key, val) => {
    setConfig(prev => {
      const next = { ...prev };
      if (type === 'section')   next.sections   = { ...(prev.sections   || {}), [key]: val };
      if (type === 'chartType') next.chartTypes  = { ...(prev.chartTypes || {}), [key]: val };
      return next;
    });
    // 설정 저장
    if (record) {
      const next = type === 'section'
        ? { ...config, sections:  { ...config.sections,  [key]: val } }
        : { ...config, chartTypes: { ...config.chartTypes, [key]: val } };
      await saveMonthlyRecord(client.id, yearMonth, { reportConfig: next });
    }
  };

  const handlePrint = () => {
    const body = document.getElementById('pest-report-body');
    if (!body) return;
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>방역 점검 보고서 - ${client.name}</title>
      <style>body{font-family:sans-serif;padding:20mm;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #e2e8f0;padding:6px 10px;font-size:11px;} @media print{button{display:none}}</style>
      </head><body>${body.innerHTML}<script>window.print();<\/script></body></html>
    `);
    w.document.close();
  };

  // 월 선택 목록 (데이터 있는 월 우선, 없어도 최근 24개월 표시)
  const monthOptions = [];
  const existingYMs = new Set(monthList.map(r => r.yearMonth));
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthOptions.push({ value: ym, label: formatYearMonth(ym) + (existingYMs.has(ym) ? ' ✅' : '') });
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>불러오는 중...</div>;

  return (
    <div>
      {/* 월 선택 + 버튼 */}
      <div style={{ ...S.card, ...S.row, flexWrap: 'wrap' }}>
        <select style={{ ...S.input, width: 'auto', flex: 1 }}
          value={yearMonth} onChange={e => setYearMonth(e.target.value)}>
          {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button style={S.btn(showPreview ? '#6b7280' : '#3b82f6')}
          onClick={() => setShowPreview(p => !p)}>
          {showPreview ? '⚙️ 설정으로' : '👁️ 미리보기'}
        </button>
        {showPreview && (
          <button style={S.btn('#1e40af')} onClick={handlePrint}>🖨️ 인쇄/PDF</button>
        )}
      </div>

      {!record && (
        <div style={{ ...S.card, textAlign: 'center', color: '#9ca3af', padding: 30 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <div>{formatYearMonth(yearMonth)} 데이터가 없습니다</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>월별 점검 탭에서 데이터를 입력하세요</div>
        </div>
      )}

      {record && !showPreview && config && (
        <SectionToggle config={config} onChange={handleConfigChange} />
      )}

      {record && showPreview && config && (
        <div style={{ ...S.card, padding: 24 }}>
          <ReportBody
            client={client} areas={areas} traps={traps}
            record={record} compRecords={compRecords}
            yearMonth={yearMonth} config={config}
          />
        </div>
      )}
    </div>
  );
}

export default PestReportView;
