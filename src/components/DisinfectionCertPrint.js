// =============================================
// DisinfectionCertPrint.js — 소독증명서 출력 (서비스리포트 탭)
// certPdfSender.js의 HTML 테이블 양식으로 통일
// =============================================
import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { loadCustomerPesticides } from './pesticideUtils';
import {
  buildCertHTML,
  loadCompanySettings,
  makeCertNo,
  printCertPdf,
} from '../utils/certPdfSender';

// ── 날짜 포맷 ──────────────────────────────────────────────────
function fmtDate(d = '') {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${y}년  ${m}월  ${dd}일`;
}

// ── Firestore events에서 해당 월 완료 데이터 로드 ──────────────
async function buildRows(customers, yearMonth) {
  const [year, month] = yearMonth.split('-');
  const s = `${year}-${month}-01`;
  const e = `${year}-${month}-31`;

  const snap = await getDocs(collection(db, 'events'));
  const done = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(ev => {
      const dt = ev.date || ev.start || '';
      return dt >= s && dt <= e && ['완료', '야근'].includes(ev.status) && !ev.isCoWork;
    });

  // customerCode → 최신 작업일 매핑 (id와 code 양방향)
  const dateMap = {};
  done.forEach(ev => {
    const code = String(ev.customerCode || ev.extendedProps?.customerCode || '');
    const dt   = ev.date || ev.start || '';
    if (code && (!dateMap[code] || dt > dateMap[code])) dateMap[code] = dt;
  });

  // certTarget=true & 해당 월 완료 이력 있는 고객만
  const certCustomers = customers.filter(c => {
    if (!c.certTarget) return false;
    return dateMap[String(c.id)] || dateMap[String(c.code)];
  });

  // 약제 병렬 로드
  const pestMap = {};
  await Promise.all(certCustomers.map(async c => {
    const key = dateMap[String(c.id)] ? String(c.id) : String(c.code);
    const p = await loadCustomerPesticides(key);
    pestMap[c.id] = p?.pesticides || [];
  }));

  return certCustomers.map(c => {
    const key = dateMap[String(c.id)] ? String(c.id) : String(c.code);
    const dt  = dateMap[key];
    return {
      _serviceDate: dt,
      certNo:       makeCertNo(dt, c.code || c.id),
      custName:     c.name        || '',
      custArea:     c.area        || '',
      custAddr:     c.address     || '',
      custCeoName:  c.ceoName     || c.contactName || '',
      workDate:     dt,
      periodEnd:    '',
      disinfType:   '방역소독',
      pesticides:   pestMap[c.id] || [],
      issueDate:    fmtDate(new Date().toISOString().split('T')[0]),
      _customer:    c,
    };
  });
}

// ────────────────────────────────────────────────────────────────
function DisinfectionCertPrint({ customers, yearMonth, onClose }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [prevIdx, setPrevIdx] = useState(0);
  const [printing, setPrinting] = useState(false);

  // 데이터 + 회사정보 로드
  useEffect(() => {
    (async () => {
      try {
        const [data, co] = await Promise.all([
          buildRows(customers, yearMonth),
          loadCompanySettings(),
        ]);
        setRows(data);
        setCompany(co);
      } catch (e) {
        console.error('소독증명서 데이터 로드 오류:', e);
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 단일 인쇄
  const handlePrintOne = async (row) => {
    if (!company) return;
    setPrinting(true);
    try {
      await printCertPdf({ ...row, company });
    } finally {
      setPrinting(false);
    }
  };

  // 전체 인쇄 — 새 탭에 모든 페이지 합쳐서 출력
  const handlePrintAll = async () => {
    if (!rows.length || !company) return;
    setPrinting(true);
    try {
      // 각 페이지 HTML에서 <body> 내용만 추출해서 하나의 창으로 합침
      const pages = rows.map(row => {
        const html = buildCertHTML({ ...row, company });
        // <body>...</body> 사이 내용만 추출
        const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return match ? match[1] : '';
      });

      // 첫 번째 페이지에서 <style> 추출
      const firstHtml = buildCertHTML({ ...rows[0], company });
      const styleMatch = firstHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      const style = styleMatch ? styleMatch[1] : '';

      // 페이지 구분 CSS + 전체 합치기
      const pageBreakStyle = `
        .page-wrap { page-break-after: always; }
        .page-wrap:last-child { page-break-after: auto; }
      `;

      const combinedHTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>${style}${pageBreakStyle}</style>
</head>
<body>
${pages.map(p => `<div class="page-wrap">${p}</div>`).join('\n')}
</body>
</html>`;

      const win = window.open('', '_blank', 'width=900,height=700');
      win.document.write(combinedHTML);
      win.document.close();
      win.onafterprint = () => win.close();
      setTimeout(() => { win.focus(); win.print(); }, 700);
    } finally {
      setPrinting(false);
    }
  };

  // 미리보기 iframe용 HTML
  const previewHTML = rows.length && company
    ? buildCertHTML({ ...rows[prevIdx], company })
    : '';

  // ── 스타일 ───────────────────────────────────────────────────
  const S = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', overflowY: 'auto', padding: '12px 8px',
    },
    box: {
      width: '100%', maxWidth: 920, borderRadius: 10,
      overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      background: '#fff',
    },
    hdr: {
      background: '#1e3a8a', color: '#fff', padding: '10px 14px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
    th: {
      background: '#f1f5f9', padding: '7px 10px', fontSize: 11,
      fontWeight: 'bold', color: '#475569', borderBottom: '1px solid #e2e8f0',
      textAlign: 'left',
    },
    td: {
      padding: '6px 10px', fontSize: 12,
      borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle',
    },
    btn: (bg, disabled = false) => ({
      padding: '7px 16px', background: disabled ? '#9ca3af' : bg,
      color: '#fff', border: 'none', borderRadius: 7,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: 'bold', fontSize: 13,
    }),
    smallBtn: (bg) => ({
      padding: '4px 12px', background: bg, color: '#fff',
      border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11,
    }),
  };

  return (
    <div style={S.overlay}>
      <div style={S.box}>

        {/* 헤더 */}
        <div style={S.hdr}>
          <b style={{ fontSize: 15 }}>
            🧾 소독증명서 출력 {!loading && `(${rows.length}건)`}
          </b>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handlePrintAll}
              disabled={!rows.length || printing}
              style={S.btn('#10b981', !rows.length || printing)}
            >
              🖨️ 전체 인쇄 ({rows.length}건)
            </button>
            <button onClick={onClose} style={S.btn('#ef4444')}>
              ✕ 닫기
            </button>
          </div>
        </div>

        {/* 안내 */}
        {company && (
          <div style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '8px 14px', fontSize: 12, color: '#166534' }}>
            ✅ 업체 정보 자동 로드됨 — <b>{company.name}</b> · 대표: <b>{company.ceo}</b>
            &nbsp;&nbsp;<span style={{ color: '#6b7280', fontSize: 11 }}>(설정 페이지에서 변경 가능)</span>
          </div>
        )}

        {/* 목록 */}
        <div style={{ background: '#fff', padding: '14px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 14 }}>
              ⏳ 데이터 불러오는 중...
            </div>
          ) : rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 20px', background: '#f9fafb', borderRadius: 8, color: '#9ca3af', fontSize: 13 }}>
              📭 {yearMonth.replace('-', '년 ')}월에 완료된 소독증명서 대상 작업이 없습니다.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#374151', marginBottom: 8 }}>
                📋 출력 목록&nbsp;
                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 'normal' }}>
                  (행 클릭 = 미리보기 · 🖨️ = 개별 인쇄)
                </span>
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead>
                    <tr>
                      {['#', '고객 상호', '면적', '소독일', '약제', '인쇄'].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        style={{ cursor: 'pointer', background: prevIdx === i ? '#eff6ff' : '#fff' }}
                        onClick={() => setPrevIdx(i)}
                      >
                        <td style={S.td}>{i + 1}</td>
                        <td style={{ ...S.td, fontWeight: 'bold' }}>{row.custName}</td>
                        <td style={S.td}>{row.custArea || '-'}</td>
                        <td style={S.td}>{row._serviceDate || '-'}</td>
                        <td style={{ ...S.td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6b7280' }}>
                          {row.pesticides.length > 0
                            ? row.pesticides.map(p => p.name).join(', ')
                            : <span style={{ color: '#d1d5db' }}>없음</span>}
                        </td>
                        <td style={S.td}>
                          <button
                            onClick={e => { e.stopPropagation(); handlePrintOne(row); }}
                            disabled={printing}
                            style={S.smallBtn(printing ? '#9ca3af' : '#3b82f6')}
                          >
                            🖨️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 미리보기 */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: '#f1f5f9', padding: '7px 12px', borderRadius: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 'bold', color: '#374151' }}>
                    👁️ 미리보기 ({prevIdx + 1}/{rows.length}) — {rows[prevIdx]?.custName}
                  </span>
                  <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                    <button
                      disabled={prevIdx === 0}
                      onClick={() => setPrevIdx(p => p - 1)}
                      style={{ ...S.smallBtn(prevIdx === 0 ? '#e5e7eb' : '#3b82f6'), color: prevIdx === 0 ? '#9ca3af' : '#fff' }}
                    >◀</button>
                    <button
                      disabled={prevIdx === rows.length - 1}
                      onClick={() => setPrevIdx(p => p + 1)}
                      style={{ ...S.smallBtn(prevIdx === rows.length - 1 ? '#e5e7eb' : '#3b82f6'), color: prevIdx === rows.length - 1 ? '#9ca3af' : '#fff' }}
                    >▶</button>
                  </div>
                </div>
                <iframe
                  title="미리보기"
                  srcDoc={previewHTML}
                  style={{ width: '100%', height: 500, border: '1px solid #e2e8f0', borderRadius: 8 }}
                />
              </div>
            </>
          )}
        </div>

        {/* 하단 안내 */}
        <div style={{ background: '#fffbeb', borderTop: '1px solid #fcd34d', padding: '7px 14px', fontSize: 11, color: '#92400e' }}>
          💡 로고·직인·워터마크는 설정 페이지에서 등록한 이미지가 자동 적용됩니다.
        </div>
      </div>
    </div>
  );
}

export default DisinfectionCertPrint;
