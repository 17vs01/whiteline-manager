// =============================================
// certPdfSender.js — 소독증명서 PDF 생성 & 발송
// 감염병의 예방 및 관리에 관한 법률 시행규칙 [별지 제28호서식]
// =============================================

import Swal from 'sweetalert2';
import { collection, addDoc, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

// ── EmailJS 설정 ───────────────────────────────────────────────
const EMAILJS_CONFIG = {
  SERVICE_ID:  '',
  TEMPLATE_ID: '',
  PUBLIC_KEY:  '',
};

// ── 기본 회사 정보 (Firestore settings로 덮어씀) ───────────────
const DEFAULT_COMPANY = {
  name:    '화이트라인',
  address: '경기도 광주시 초월읍 무들로82, 2층',
  ceo:     '김   현   숙',
  logo:    '',
  seal:    '',
};

/** Firestore settings에서 회사 정보 로드 */
export async function loadCompanySettings() {
  try {
    const snap = await getDocs(collection(db, 'settings'));
    if (snap.docs.length > 0) {
      const d = snap.docs[0].data();
      return {
        name:     d.companyName    || DEFAULT_COMPANY.name,
        address:  d.companyAddress || DEFAULT_COMPANY.address,
        ceo:      d.companyCeo     || DEFAULT_COMPANY.ceo,
        logo:     d.companyLogo    || '',
        seal:     d.sealImage      || '',
        certLogo: d.certLogo       || '',
      };
    }
  } catch (e) {
    console.warn('settings 로드 오류:', e);
  }
  return { ...DEFAULT_COMPANY };
}

/** 날짜 → "2026년  05월  05일" */
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}년  ${m}월  ${dd}일`;
}
function todayFmt() {
  return fmtDate(new Date().toISOString().split('T')[0]);
}

/**
 * 필증 번호 자동 생성: 제 YYMM-고객코드 호
 * 예) workDate=2026-05-05, customerCode=123  →  "2605-123"
 */
export function makeCertNo(workDate, customerCode) {
  const d = workDate ? new Date(workDate) : new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const code = String(customerCode || '').replace(/\D/g, '') || '0000';
  return `${yy}${mm}-${code}`;
}

/**
 * 약제 배열 → 3열 그리드 HTML
 */
function buildPestGrid(pesticides) {
  if (!pesticides || pesticides.length === 0) return '<span style="color:#aaa;">　</span>';
  return `
    <div style="
      display:grid;
      grid-template-columns:repeat(3,1fr);
      gap:2mm 3mm;
      padding:1mm 0;
    ">
      ${pesticides.map(p => {
        const name   = p.name   || '';
        const amount = p.amount != null && p.amount !== 0 && p.amount !== '0'
          ? String(p.amount) : '';
        const unit   = amount ? (p.unit || '') : '';
        return `
          <div style="
            background:#f8f8f8;
            border:1px solid #ddd;
            border-radius:2px;
            padding:1.5mm 2.5mm;
            font-size:8.5pt;
            line-height:1.45;
          ">
            <div style="font-weight:bold;color:#111;">${name}</div>
            ${amount ? `<div style="color:#555;font-size:8pt;">${amount}${unit}</div>` : ''}
          </div>`;
      }).join('')}
    </div>`;
}

/**
 * 소독증명서 HTML 생성
 */
export function buildCertHTML(data) {
  const {
    certNo       = '',
    custName     = '',
    custArea     = '',
    custAddr     = '',
    custCeoName  = '',
    workDate     = '',
    periodEnd    = '',   // 종료일 (없으면 공란)
    disinfType   = '방역소독',
    pesticides   = [],
    issueDate    = '',
    company      = DEFAULT_COMPANY,
  } = data;

  const periodStr    = workDate ? fmtDate(workDate) : '';
  const periodEndStr = periodEnd ? fmtDate(periodEnd) : '';
  const issueDateStr = issueDate || todayFmt();

  // 첫 번째 칸(라벨) 통일 너비 — 모든 표에서 동일하게
  const LABEL_W = '22mm';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Malgun Gothic', '맑은 고딕', '나눔고딕', serif;
    background: white;
    width: 210mm;
    min-height: 297mm;
    padding: 14mm 18mm;
    font-size: 10pt;
    color: #111;
  }
  .law-header {
    font-size: 8pt;
    color: #444;
    margin-bottom: 5mm;
  }
  .cert-no {
    font-size: 9pt;
    margin-bottom: 2mm;
  }
  .cert-title {
    text-align: center;
    font-size: 22pt;
    font-weight: bold;
    letter-spacing: 12px;
    margin: 3mm 0 5mm 0;
    padding: 4mm 0;
    border-top: 2px solid #111;
    border-bottom: 2px solid #111;
  }
  /* ─ 표 공통 ─ */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 3mm;
  }
  td {
    border: 1px solid #555;
    padding: 2.5mm 3.5mm;
    vertical-align: middle;
    font-size: 9.5pt;
    line-height: 1.55;
  }
  /* 첫 번째 라벨 칸 — 모든 표 통일 */
  .label-cell {
    background: #f5f5f5;
    font-weight: bold;
    text-align: center;
    white-space: nowrap;
    width: ${LABEL_W};
    font-size: 9pt;
  }
  .sublabel-cell {
    background: #fafafa;
    font-size: 8.5pt;
    text-align: center;
    white-space: nowrap;
    width: 28mm;
  }
  .data-cell  { font-size: 9.5pt; }
  .area-cell  { width: 25mm; text-align: center; font-size: 9pt; }
  .confirm-cell { text-align: center; width: 30mm; font-size: 8.5pt; }
  /* ─ 소독기간 ─ */
  .period-label {
    background: #f5f5f5;
    font-weight: bold;
    text-align: center;
    white-space: nowrap;
    width: ${LABEL_W};    /* ← 대상시설/소독내용 첫칸과 동일 */
    font-size: 9pt;
    border: 1px solid #555;
    padding: 2.5mm 3.5mm;
    vertical-align: middle;
  }
  /* ─ 법조문 ─ */
  .law-text {
    margin: 4mm 0;
    font-size: 9pt;
    line-height: 1.8;
    padding: 3mm 0;
    border-top: 1px solid #888;
    border-bottom: 1px solid #888;
  }
  .issue-date {
    text-align: center;
    font-size: 11pt;
    margin: 4mm 0 6mm 0;
    letter-spacing: 3px;
  }
  /* ─ 소독실시자 박스 ─ */
  .issuer-box {
    width: 100%;
    border: 1px solid #555;
    border-collapse: collapse;
  }
  .issuer-header {
    background: #f0f0f0;
    font-weight: bold;
    text-align: center;
    padding: 2.5mm;
    font-size: 9pt;
    border-bottom: 1px solid #aaa;
  }
  .issuer-table {
    width: 100%;
    border-collapse: collapse;
  }
  .issuer-table td {
    border: none;
    border-top: 1px solid #ddd;
    padding: 2.5mm 3.5mm;
    vertical-align: middle;
    font-size: 9.5pt;
  }
  .issuer-table tr:first-child td { border-top: none; }
  .issuer-th {
    background: transparent;
    font-weight: bold;
    text-align: center;
    width: ${LABEL_W};    /* ← 상단 표 첫칸과 동일 너비 */
    border-right: 1px solid #ddd !important;
    font-size: 9pt;
    white-space: nowrap;
  }
  /* 대표자 행 구분선을 셀 전체 높이로 채우기 */
  .issuer-table tr {
    height: 100%;
  }
  .seal-img {
    width: 18mm;
    height: 18mm;
    object-fit: contain;
    vertical-align: middle;
    margin-left: 3mm;
  }
  .seal-placeholder {
    display: inline-block;
    width: 18mm;
    height: 18mm;
    border: 1px dashed #ccc;
    border-radius: 50%;
    text-align: center;
    line-height: 18mm;
    font-size: 8pt;
    color: #bbb;
    vertical-align: middle;
    margin-left: 3mm;
  }
  /* 워터마크 */
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    opacity: 0.07;
    pointer-events: none;
    z-index: 0;
    max-width: 160mm;
  }
</style>
</head>
<body>
  <!-- 워터마크 -->
  ${company.certLogo ? `<img src="${company.certLogo}" class="watermark" alt="">` : ''}

  <div class="law-header">■ 감염병의 예방 및 관리에 관한 법률 시행규칙 [별지 제28호서식]</div>

  <div class="cert-no">제&nbsp;&nbsp;${certNo || '　　　　　'}&nbsp;&nbsp;호</div>

  <div class="cert-title">소 독 증 명 서</div>

  <!-- 대상시설 -->
  <table>
    <colgroup>
      <col style="width:${LABEL_W}">
      <col style="width:28mm">
      <col>
      <col style="width:28mm">
      <col style="width:22mm">
    </colgroup>
    <tbody>
      <tr>
        <td class="label-cell" rowspan="2">대&nbsp;상<br>시&nbsp;설</td>
        <td class="sublabel-cell">상&nbsp;&nbsp;호(명칭)</td>
        <td class="data-cell" style="font-size:${
          custName.length > 30 ? '8pt' :
          custName.length > 20 ? '9pt' :
          custName.length > 12 ? '10pt' : '11pt'
        };word-break:break-all;">${custName}</td>
        <td class="sublabel-cell">실시 면적(용적)</td>
        <td class="area-cell">${custArea ? custArea + '&nbsp;㎡' : ''}</td>
      </tr>
      <tr>
        <td class="sublabel-cell">소&nbsp;&nbsp;재&nbsp;&nbsp;지</td>
        <td class="data-cell" colspan="3">${custAddr}</td>
      </tr>
      <tr>
        <td class="label-cell" rowspan="2">관리(운영)자<br>확&nbsp;&nbsp;&nbsp;인</td>
        <td class="sublabel-cell">직&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;위</td>
        <td class="data-cell" colspan="3">대표</td>
      </tr>
      <tr>
        <td class="sublabel-cell">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td class="data-cell">${custCeoName}</td>
        <td colspan="2" class="confirm-cell">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(인)</td>
      </tr>
    </tbody>
  </table>

  <!-- 소독기간 — 시작일 ~ 종료일(공란 또는 입력값) 한 셀로 -->
  <table>
    <colgroup>
      <col style="width:${LABEL_W}">
      <col>
    </colgroup>
    <tbody>
      <tr>
        <td class="label-cell">소&nbsp;독&nbsp;기&nbsp;간</td>
        <td style="padding:2.5mm 3.5mm;">
          ${periodStr}&nbsp;&nbsp;~&nbsp;&nbsp;${periodEndStr}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 소독내용 (약제 3열 그리드) -->
  <table>
    <colgroup>
      <col style="width:${LABEL_W}">
      <col style="width:28mm">
      <col>
    </colgroup>
    <tbody>
      <tr>
        <td class="label-cell" rowspan="2">소&nbsp;독<br>내&nbsp;용</td>
        <td class="sublabel-cell">종&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;류</td>
        <td class="data-cell">${disinfType}</td>
      </tr>
      <tr>
        <td class="sublabel-cell">약품사용내용</td>
        <td class="data-cell">${buildPestGrid(pesticides)}</td>
      </tr>
    </tbody>
  </table>

  <!-- 법조문 -->
  <div class="law-text">
    &nbsp;&nbsp;「감염병의 예방 및 관리에 관한 법률」 제54조제1항 및 같은 법 시행규칙 제40조제2항에 따라
    위와 같이 소독을 실시하였음을 증명합니다.
  </div>

  <!-- 발행일 -->
  <div class="issue-date">${issueDateStr}</div>

  <!-- 소독실시자 -->
  <div class="issuer-box">
    <div class="issuer-header">소독실시자</div>
    <table class="issuer-table">
      <colgroup>
        <col style="width:${LABEL_W}">
        <col>
      </colgroup>
      <tbody>
        <tr>
          <td class="issuer-th">상호(명칭)</td>
          <td>${company.name}</td>
        </tr>
        <tr>
          <td class="issuer-th">소&nbsp;재&nbsp;지</td>
          <td>${company.address}</td>
        </tr>
        <tr>
          <td class="issuer-th">대&nbsp;표&nbsp;자</td>
          <td>${company.ceo}&nbsp;&nbsp;${company.seal
            ? `<img src="${company.seal}" alt="직인" class="seal-img">`
            : `<span class="seal-placeholder">직인</span>`}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 하단 가로 로고 -->
  ${company.certLogo ? `
  <div style="text-align:center; margin-top:6mm;">
    <img src="${company.certLogo}" alt="로고" style="max-height:14mm; max-width:80mm; object-fit:contain; opacity:0.85;">
  </div>` : ''}

</body>
</html>`;
}

/**
 * PDF Blob 생성
 */
export async function generateCertPdfBlob(certData) {
  const [{ jsPDF }, html2canvas] = await Promise.all([
    import('jspdf'),
    import('html2canvas').then(m => m.default),
  ]);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:794px;height:1123px;border:none;';
  document.body.appendChild(iframe);

  try {
    iframe.contentDocument.open();
    iframe.contentDocument.write(buildCertHTML(certData));
    iframe.contentDocument.close();

    await new Promise(resolve => setTimeout(resolve, 700));

    const canvas = await html2canvas(iframe.contentDocument.body, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      width: 794,
      height: 1123,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
    return pdf.output('blob');
  } finally {
    document.body.removeChild(iframe);
  }
}

/**
 * 인쇄 미리보기
 */
export async function printCertPdf(certData) {
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(buildCertHTML(certData));
  win.document.close();
  win.onafterprint = () => win.close();
  setTimeout(() => { win.focus(); win.print(); }, 700);
}

/** EmailJS 발송 */
async function sendViaEmailJS({ toEmail, toName, subject, message, pdfBase64, certNo }) {
  const { SERVICE_ID, TEMPLATE_ID, PUBLIC_KEY } = EMAILJS_CONFIG;
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) return false;
  if (!window.emailjs) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    window.emailjs.init(PUBLIC_KEY);
  }
  await window.emailjs.send(SERVICE_ID, TEMPLATE_ID, {
    to_email: toEmail, to_name: toName, subject, message,
    cert_no: certNo || '', pdf_data: pdfBase64 || '',
  });
  return true;
}

/** Firestore 발송 기록 저장 */
async function saveCertLog({ customerId, customerName, workDate, sendMethod, toEmail, certNo, success }) {
  try {
    await addDoc(collection(db, 'certLogs'), {
      customerId, customerName, workDate,
      sendMethod, toEmail: toEmail || '',
      certNo: certNo || '', success,
      sentAt: new Date().toISOString(),
    });
  } catch (e) { console.warn('certLog 저장 오류:', e); }
}

/**
 * 스마트폰: Web Share API 공유시트 / PC: 다운로드
 * @returns {boolean} true = 공유시트 성공
 */
// ── ZIP 묶음 발급 ──────────────────────────────────────────
async function generateZipCerts(certTypes, { customer, pesticides, workDate, vehiclePlates }) {
  Swal.fire({ title: '📦 증명서 생성 중...', text: certTypes.length + '개 생성 중', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

  const today = (workDate || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const { showPesticidePopup } = await import('../components/pesticideUtils');

  // JSZip 동적 로드
  let JSZip;
  try {
    const mod = await import('jszip');
    JSZip = mod.default || mod;
  } catch (e) {
    Swal.close();
    Swal.fire('오류', 'JSZip 패키지가 필요합니다.\n터미널에서 npm install jszip 을 실행해주세요.', 'error');
    return;
  }

  const zip      = new JSZip();
  const company  = await loadCompanySettings();
  let   hasError = false;

  for (const type of certTypes) {
    try {
      let finalCustName   = customer.certName?.trim() || customer.name;
      let finalPesticides = pesticides;

      if (type === 'vehicle_all') {
        finalCustName = vehiclePlates.join(', ');
        Swal.close();
        const vPestResult = await showPesticidePopup(customer.id + '_vehicle_all', '차량(전체)', { required: false });
        if (vPestResult !== null) finalPesticides = vPestResult;
        Swal.fire({ title: '📦 증명서 생성 중...', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

      } else if (type.startsWith('vehicle_')) {
        const vIdx  = parseInt(type.split('_')[1]);
        const plate = vehiclePlates[vIdx] || '';
        finalCustName = plate;
        Swal.close();
        const vPestResult = await showPesticidePopup(customer.id + '_vehicle_' + vIdx, '차량(' + plate + ')', { required: false });
        if (vPestResult !== null) finalPesticides = vPestResult;
        Swal.fire({ title: '📦 증명서 생성 중...', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

      } else if (type === 'extra') {
        finalCustName = customer.certName?.trim()
          ? `${customer.certName.trim()} (${customer.certExtra?.name || ''})`
          : `${customer.name} (${customer.certExtra?.name || ''})`;
      }

      const yymm   = new Date().toISOString().slice(2,7).replace('-','');
      const certNo = yymm + '-' + (customer.code || customer.id || '').slice(0,4).toUpperCase();

      const certData = {
        certNo,
        custName:    finalCustName,
        custArea:    customer.area    || '',
        custAddr:    customer.address || '',
        custCeoName: customer.ceoName || '',
        workDate:    workDate || new Date().toISOString().split('T')[0],
        periodEnd:   '',
        pesticides:  finalPesticides || [],
        issueDate:   new Date().toISOString().split('T')[0],
        company,
      };

      const blob = await generateCertPdfBlob(certData);
      const arr  = await blob.arrayBuffer();

      let fileName = '';
      if (type === 'basic')            fileName = customer.name + '_기본_' + today + '.pdf';
      else if (type === 'extra')       fileName = customer.name + '_추가_' + today + '.pdf';
      else if (type === 'vehicle_all') fileName = customer.name + '_차량전체_' + today + '.pdf';
      else {
        const vIdx  = parseInt(type.split('_')[1]);
        const plate = vehiclePlates[vIdx] || ('차량' + (vIdx+1));
        fileName = customer.name + '_차량_' + plate + '_' + today + '.pdf';
      }

      zip.file(fileName, arr);
    } catch (e) {
      console.error('[ZIP] ' + type + ' 생성 오류:', e);
      hasError = true;
    }
  }

  Swal.close();

  try {
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipName = customer.name + '_소독증명서_' + today + '.zip';
    const url     = URL.createObjectURL(zipBlob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = zipName;
    a.click();
    URL.revokeObjectURL(url);

    Swal.fire({
      icon:  'success',
      title: '📦 ZIP 다운로드 완료',
      html:  '<div style="font-size:13px;color:#374151;"><b>' + zipName + '</b><br>' +
             '<span style="color:#64748b;font-size:12px;">' + certTypes.length + '개 증명서가 포함되어 있어요</span>' +
             (hasError ? '<br><span style="color:#ef4444;font-size:12px;">⚠️ 일부 증명서 생성에 실패했어요</span>' : '') +
             '</div>',
      confirmButtonText: '확인',
      confirmButtonColor: '#059669',
      timer: 4000,
    });
  } catch (e) {
    console.error('[ZIP] 압축 오류:', e);
    Swal.fire('오류', 'ZIP 파일 생성에 실패했습니다.', 'error');
  }
}

export async function shareOrDownloadPdf(blob, fileName) {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const canShare  = isMobile &&
                    typeof navigator.share === 'function' &&
                    typeof navigator.canShare === 'function';

  if (canShare) {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName.replace('.pdf', '') });
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);

  if (!isMobile) {
    Swal.fire({
      toast: true, position: 'top-end', icon: 'success',
      title: 'PDF 다운로드 완료',
      html: '<small style="color:#6b7280">카카오톡·문자 앱에서 파일 첨부로 전송하세요</small>',
      timer: 3000, showConfirmButton: false,
    });
  }
  return false;
}

/**
 * 메인: 소독증명서 발송 팝업
 *
 * @param {object} params.customer   - 고객 객체
 * @param {string} params.workDate   - 작업일 (YYYY-MM-DD)
 * @param {Array}  params.pesticides - [{name, amount, unit}]
 * @param {string} [params.certNo]   - 없으면 자동 생성
 * @param {object} [params.company]  - 없으면 Firestore settings에서 로드
 */
export async function showCertSendPopup({ customer, workDate, pesticides = [], certNo, company }) {
  // 필증번호 자동 생성
  const finalCertNo = certNo || makeCertNo(workDate, customer.code || customer.id);

  // 회사 정보 로드
  const finalCompany = company || await loadCompanySettings();

  // ── 증명서 종류 선택 (추가/차량 ON인 경우) ──────────────────
  const hasExtra   = !!(customer.certExtra?.enabled && customer.certExtra?.name);
  const hasVehicle = !!(customer.certVehicle?.enabled && customer.certVehicle?.plates);

  let certType = 'basic'; // 'basic' | 'extra' | 'vehicle_*'

  if (hasExtra || hasVehicle) {
    // 차량번호 파싱 (쉼표 구분)
    const vehiclePlates = hasVehicle
      ? customer.certVehicle.plates.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    // [UPDATED] 체크박스 선택 방식으로 변경
    const certTypes = await new Promise((resolve) => {
      let resolved = false;
      const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

      const hasSinglePage = hasVehicle && customer.certVehicle?.singlePage && vehiclePlates.length > 1;

      // 커스텀 토글 체크박스 (SweetAlert2 스타일 충돌 방지)
      const checkRow = (id, icon, label, sub, checked=true) =>
        `<div id="row-${id}" onclick="
          const el = document.getElementById('chk-${id}');
          el.dataset.checked = el.dataset.checked === '1' ? '0' : '1';
          const on = el.dataset.checked === '1';
          document.getElementById('row-${id}').style.borderColor = on ? '#059669' : '#e2e8f0';
          document.getElementById('row-${id}').style.background  = on ? '#f0fdf4' : 'white';
          el.style.background     = on ? '#059669' : '#e2e8f0';
          el.textContent          = on ? '✓' : '';
          // 전체선택 체크 상태 업데이트
          const all = document.querySelectorAll('[id^=chk-]:not(#chk-all)');
          const allOn = Array.from(all).every(c => c.dataset.checked === '1');
          const allBtn = document.getElementById('chk-all');
          if(allBtn){ allBtn.dataset.checked=allOn?'1':'0'; allBtn.style.background=allOn?'#374151':'#e2e8f0'; allBtn.textContent=allOn?'✓':''; }
        " style="display:flex;align-items:center;gap:10px;padding:10px 12px;
          border:1.5px solid ${checked ? '#059669' : '#e2e8f0'};border-radius:10px;margin-bottom:6px;cursor:pointer;
          background:${checked ? '#f0fdf4' : 'white'};">
          <div id="chk-${id}" data-checked="${checked ? '1' : '0'}"
            style="width:20px;height:20px;border-radius:5px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
            font-size:14px;font-weight:bold;color:white;
            background:${checked ? '#059669' : '#e2e8f0'};">${checked ? '✓' : ''}</div>
          <span style="font-size:18px;">${icon}</span>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:bold;color:#1e293b;">${label}</div>
            <div style="font-size:11px;color:#64748b;">${sub}</div>
          </div>
        </div>`;

      const rows = [
        checkRow('basic', '🏢', '기본 소독증명서',
          customer.certName?.trim()
            ? `<span style="color:#374151;">${customer.certName?.trim()}</span> <span style="font-size:10px;color:#6b7280;">(앱: ${customer.name})</span>`
            : customer.name),
        hasExtra ? checkRow('extra', '➕', '추가 소독증명서',
          `${customer.certName?.trim() || customer.name} (${customer.certExtra?.name || ''})`) : '',
        ...vehiclePlates.map((plate, i) => checkRow(`vehicle_${i}`, '🚗', '차량 소독증명서', `차량번호: ${plate}`)),
        hasSinglePage ? checkRow('vehicle_all', '📄', `차량 소독증명서 (한장)`, `전체 ${vehiclePlates.length}대 한장 출력`) : '',
      ].filter(Boolean).join('');

      Swal.fire({
        title: '📋 발급할 증명서 선택',
        html: `
          <div style="text-align:left;">
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 12px;margin-bottom:10px;">
              <div style="font-weight:bold;color:#166534;font-size:13px;">고객: ${customer.name}</div>
              <div style="color:#6b7280;font-size:11px;">발급할 증명서를 선택 후 발급하기를 눌러주세요</div>
            </div>
            <div onclick="
              const allBtn=document.getElementById('chk-all');
              const on = allBtn.dataset.checked !== '1';
              allBtn.dataset.checked = on ? '1' : '0';
              allBtn.style.background = on ? '#374151' : '#e2e8f0';
              allBtn.textContent = on ? '✓' : '';
              document.querySelectorAll('[id^=chk-]:not(#chk-all)').forEach(el=>{
                el.dataset.checked = on ? '1' : '0';
                el.style.background = on ? '#059669' : '#e2e8f0';
                el.textContent = on ? '✓' : '';
                const row=document.getElementById('row-'+el.id.replace('chk-',''));
                if(row){ row.style.borderColor=on?'#059669':'#e2e8f0'; row.style.background=on?'#f0fdf4':'white'; }
              });
            " style="display:flex;align-items:center;gap:8px;padding:8px 12px;
              background:#f8fafc;border-radius:8px;margin-bottom:8px;cursor:pointer;font-size:12px;font-weight:bold;color:#374151;border:1.5px solid #e2e8f0;">
              <div id="chk-all" data-checked="1"
                style="width:18px;height:18px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
                font-size:12px;font-weight:bold;color:white;background:#374151;">✓</div>
              전체 선택/해제
            </div>
            ${rows}
          </div>`,
        confirmButtonText: '📄 발급하기',
        confirmButtonColor: '#059669',
        showCancelButton: true,
        cancelButtonText: '취소',
        width: '92%',
        preConfirm: () => {
          const isOn = (id) => document.getElementById(id)?.dataset?.checked === '1';
          const selected = [];
          if (isOn('chk-basic'))       selected.push('basic');
          if (hasExtra && isOn('chk-extra')) selected.push('extra');
          vehiclePlates.forEach((_, i) => {
            if (isOn(`chk-vehicle_${i}`)) selected.push(`vehicle_${i}`);
          });
          if (hasSinglePage && isOn('chk-vehicle_all')) selected.push('vehicle_all');
          if (selected.length === 0) {
            Swal.showValidationMessage('최소 1개 이상 선택해주세요.');
            return false;
          }
          return selected;
        },
      }).then(result => {
        if (result.isConfirmed) done(result.value);
        else done([]);
      });
    });

    if (!certTypes || certTypes.length === 0) return;

    // 여러 개 선택 시 ZIP 발급
    if (certTypes.length > 1) {
      // ④ ZIP 포함 파일 미리보기
      const typeLabel = {
        basic: `🏢 기본 소독증명서 (${customer.certName?.trim() || customer.name})`,
        extra: `➕ 추가 소독증명서 (${customer.certName?.trim() || customer.name} / ${customer.certExtra?.name || ''})`,
        vehicle_all: `📄 차량 한장 출력`,
      };
      const fileList = certTypes.map(t => {
        if (t.startsWith('vehicle_') && t !== 'vehicle_all') {
          const idx = parseInt(t.split('_')[1]);
          const plate = vehiclePlates[idx] || `차량${idx+1}`;
          return `🚗 차량 소독증명서 (${plate})`;
        }
        return typeLabel[t] || t;
      });
      const { isConfirmed: zipConfirmed } = await Swal.fire({
        title: '📦 ZIP 묶음 발급',
        html: `
          <div style="text-align:left;font-size:13px;">
            <div style="color:#6b7280;margin-bottom:10px;">다음 파일들이 ZIP으로 묶여서 다운로드됩니다:</div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;">
              ${fileList.map(f => `<div style="padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">📄 ${f}</div>`).join('')}
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:8px;">총 ${fileList.length}개 파일</div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '📦 ZIP 다운로드',
        cancelButtonText: '취소',
        confirmButtonColor: '#059669',
      });
      if (!zipConfirmed) return;
      await generateZipCerts(certTypes, { customer, pesticides, workDate, vehiclePlates });
      return;
    }

    // 1개만 선택 → 기존 방식
    certType = certTypes[0];
  }

  // 차량 증명서면 별도 약제 입력
  let finalPesticides = pesticides;
  // certName: 증명서용 별도 고객명 (설정된 경우 우선 사용, 차량증명서는 번호판으로 덮어씀)
  let finalCustName   = customer.certName?.trim() || customer.name;
  let finalCustArea   = customer.area || '';

  if (certType === 'vehicle_all') {
    // [ADD] 한장 출력: 모든 차량번호를 업장명에 합침
    const allPlates = customer.certVehicle.plates.split(',').map(p => p.trim()).filter(Boolean);
    finalCustName = allPlates.join(', ');

    // 차량 전용 약제 팝업 (공통 약제 1번만)
    const { showPesticidePopup } = await import('../components/pesticideUtils');
    const vehicleKey = `${customer.id}_vehicle_all`;
    const vPestResult = await showPesticidePopup(vehicleKey, '차량(전체)', { required: false });
    if (vPestResult !== null) finalPesticides = vPestResult;

  } else if (certType.startsWith('vehicle_')) {
    const vIdx  = parseInt(certType.split('_')[1]);
    const plate = customer.certVehicle.plates.split(',').map(p => p.trim())[vIdx] || '';
    finalCustName = plate; // 업장명 → 차량번호

    // 차량 전용 약제 팝업
    const { showPesticidePopup } = await import('../components/pesticideUtils');
    const vehicleKey = `${customer.id}_vehicle_${vIdx}`;
    const vPestResult = await showPesticidePopup(vehicleKey, `차량(${plate})`, { required: false });
    if (vPestResult !== null) finalPesticides = vPestResult;

  } else if (certType === 'extra') {
    finalCustName = `${customer.certName?.trim() || customer.name} (${customer.certExtra?.name || ''})`;
  }

  // ── 실시면적 확인 — 없으면 팝업 입력 후 Firestore 저장 ──
  let custArea = customer.area || '';
  if (!custArea || custArea.trim() === '' || custArea.trim() === '-') {
    const { value: areaInput, isConfirmed: areaConfirmed } = await Swal.fire({
      title: '📐 실시 면적 입력',
      html: `
        <div style="text-align:left;font-size:13px;margin-bottom:12px;color:#374151;">
          <b>${customer.name}</b>의 실시 면적(㎡)이 등록되지 않았습니다.<br>
          <span style="font-size:12px;color:#6b7280;">소독증명서 발급에 필요합니다. 입력 후 고객정보에 자동 저장됩니다.</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="cert-area-input" type="number" min="0" step="1"
            placeholder="면적 입력"
            style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;">
          <span style="font-size:14px;color:#374151;font-weight:bold;">㎡</span>
        </div>`,
      showCancelButton: true,
      confirmButtonText: '저장 후 계속',
      cancelButtonText: '건너뛰기',
      confirmButtonColor: '#059669',
      preConfirm: () => {
        const val = document.getElementById('cert-area-input')?.value;
        if (!val || isNaN(val) || Number(val) <= 0) {
          Swal.showValidationMessage('올바른 면적을 입력하세요');
          return false;
        }
        return val;
      },
    });
    if (areaConfirmed && areaInput) {
      custArea = String(areaInput);
      try {
        await updateDoc(doc(db, 'customers', customer.id), { area: custArea });
        customer = { ...customer, area: custArea };
      } catch (e) {
        console.warn('면적 저장 오류:', e);
      }
    }
  }

  // ── 1단계: 종료일 입력 여부 확인 팝업 ─────────────────────
  const periodEndResult = await new Promise((resolve) => {
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    Swal.fire({
      title: '🧾 소독증명서 발급',
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:14px;">
            <div style="font-weight:bold;color:#166534;margin-bottom:4px;">📋 발급 정보</div>
            <div>고객: <b>${customer.certName?.trim() || customer.name}</b>${customer.certName?.trim() ? ` <span style="font-size:11px;color:#6b7280;">(앱: ${customer.name})</span>` : ''}</div>
            <div>작업일: <b>${fmtDate(workDate)}</b></div>
            <div>필증번호: <b>제 ${finalCertNo} 호</b></div>
          </div>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <input type="checkbox" id="cert-use-enddate"
                style="width:18px;height:18px;cursor:pointer;accent-color:#059669;">
              <label for="cert-use-enddate" style="font-weight:bold;color:#374151;cursor:pointer;">
                📅 소독기간 종료일 입력
              </label>
            </div>
            <div id="cert-enddate-wrap" style="display:none;margin-top:8px;">
              <input type="date" id="cert-enddate"
                value="${workDate || ''}"
                style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;">
              <div style="font-size:11px;color:#6b7280;margin-top:4px;">
                입력하지 않으면 종료일은 공란으로 인쇄됩니다
              </div>
            </div>
          </div>
        </div>`,
      showConfirmButton: true,
      confirmButtonText: '다음 →',
      confirmButtonColor: '#059669',
      showCancelButton: true,
      cancelButtonText: '취소',
      didOpen: () => {
        const cb   = document.getElementById('cert-use-enddate');
        const wrap = document.getElementById('cert-enddate-wrap');
        if (cb && wrap) {
          cb.addEventListener('change', () => {
            wrap.style.display = cb.checked ? 'block' : 'none';
          });
        }
      },
      preConfirm: () => {
        const cb  = document.getElementById('cert-use-enddate');
        const inp = document.getElementById('cert-enddate');
        if (cb && cb.checked && inp) {
          return inp.value || '__empty__';
        }
        return '__empty__'; // 종료일 없음 = 공란
      },
      // willClose 제거 — preConfirm + then으로만 처리
    }).then((result) => {
      if (result.isDismissed) {
        done('cancel');
      } else {
        // '__empty__' = 공란, 날짜문자열 = 입력값
        const val = result.value === '__empty__' ? null : (result.value || null);
        done(val);
      }
    });
  });

  if (periodEndResult === 'cancel') return;

  const certData = {
    certNo:      finalCertNo,
    custName:    finalCustName,
    custArea:    custArea,
    custAddr:    customer.address  || '',
    custCeoName: customer.ceoName  || '',
    workDate,
    periodEnd:   periodEndResult || '',
    disinfType:  '방역소독',
    pesticides:  finalPesticides,
    issueDate:   fmtDate(workDate) || todayFmt(),
    company:     finalCompany,
  };

  const hasEmail    = !!(customer.email && customer.email.trim());
  const emailjsReady = !!(EMAILJS_CONFIG.SERVICE_ID && EMAILJS_CONFIG.TEMPLATE_ID && EMAILJS_CONFIG.PUBLIC_KEY);

  // ── 팝업 (버튼 클릭 즉시 실행) ──────────────────────────────
  const action = await new Promise((resolve) => {
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    const btnStyle = (bg, disabled = false) =>
      `display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;` +
      `background:${disabled ? '#f1f5f9' : bg};color:${disabled ? '#9ca3af' : 'white'};` +
      `border:none;border-radius:10px;cursor:${disabled ? 'not-allowed' : 'pointer'};` +
      `font-size:13px;font-weight:bold;text-align:left;margin-bottom:8px;` +
      `opacity:${disabled ? '0.6' : '1'};`;

    Swal.fire({
      title: '🧾 소독증명서 발송',
      html: `
        <div style="text-align:left;font-size:13px;">
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
            <div style="font-weight:bold;color:#166534;margin-bottom:4px;">📋 발급 정보</div>
            <div>고객: <b>${customer.name}</b></div>
            <div>작업일: <b>${fmtDate(workDate)}</b></div>
            <div>소독기간: <b>${fmtDate(workDate)} ~ ${periodEndResult ? fmtDate(periodEndResult) : '(공란)'}</b></div>
            <div>필증번호: <b>제 ${finalCertNo} 호</b></div>
            <div>약제: ${pesticides.length > 0 ? pesticides.map(p=>`${p.name} ${p.amount||''}${p.unit||''}`).join(', ') : '미입력'}</div>
          </div>
          ${!hasEmail ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#92400e;">⚠️ 이메일 미등록 — 고객정보에서 등록하면 이메일 발송 가능</div>` : ''}
          <div style="font-weight:bold;color:#374151;margin-bottom:10px;">발송 방법 선택:</div>
          <button id="cert-btn-print" style="${btnStyle('#3b82f6')}">
            <span style="font-size:20px;">🖨️</span>
            <div><div>인쇄 (미리보기)</div><div style="font-size:11px;font-weight:normal;opacity:0.85;">새 탭에서 인쇄 미리보기를 엽니다</div></div>
          </button>
          <button id="cert-btn-email" style="${btnStyle('#10b981', !hasEmail)}" ${!hasEmail ? 'disabled' : ''}>
            <span style="font-size:20px;">📧</span>
            <div>
              <div>이메일 발송 ${hasEmail ? `<span style="font-size:11px;">(${customer.email})</span>` : '<span style="font-size:11px;">(미등록)</span>'}</div>
              <div style="font-size:11px;font-weight:normal;opacity:0.85;">${emailjsReady ? 'PDF를 이메일로 발송합니다' : 'EmailJS 미설정 — PDF 다운로드로 대체'}</div>
            </div>
          </button>
          <button id="cert-btn-kakao" style="${btnStyle('#f59e0b')}">
            <span style="font-size:20px;">💬</span>
            <div><div>카카오/문자 공유</div><div style="font-size:11px;font-weight:normal;opacity:0.85;">PDF 저장 후 카카오톡·문자로 전송</div></div>
          </button>
          <button id="cert-btn-skip" style="${btnStyle('#94a3b8')}">
            <span style="font-size:20px;">⏭️</span>
            <div><div>나중에 발송</div><div style="font-size:11px;font-weight:normal;opacity:0.85;">완료 처리만 하고 발송은 나중에</div></div>
          </button>
        </div>`,
      showConfirmButton: false,
      showCloseButton: true,
      width: '92%',
      didOpen: () => {
        ['print', 'email', 'kakao', 'skip'].forEach(key => {
          const btn = document.getElementById(`cert-btn-${key}`);
          if (btn) btn.addEventListener('click', () => { done(key); Swal.close(); });
        });
      },
      willClose: () => done('skip'),
    });
  });

  if (action === 'skip') return;

  // ── 인쇄 ───────────────────────────────────────────────────
  if (action === 'print') {
    await printCertPdf(certData);
    await saveCertLog({ customerId: customer.id, customerName: customer.name, workDate, sendMethod: 'print', certNo: finalCertNo, success: true });
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '인쇄 창을 열었습니다', timer: 1800, showConfirmButton: false });
    return;
  }

  // ── PDF 생성 (email / kakao 공통) ──────────────────────────
  Swal.fire({ title: '📄 PDF 생성 중...', text: '잠시만 기다려 주세요', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

  let pdfBlob = null;
  try {
    pdfBlob = await generateCertPdfBlob(certData);
  } catch (err) {
    console.error('PDF 생성 오류:', err);
    Swal.close();
    Swal.fire('오류', 'PDF 생성에 실패했습니다. 인쇄 방식을 이용해 주세요.', 'error');
    return;
  }
  Swal.close();

  // ── 이메일 ─────────────────────────────────────────────────
  if (action === 'email') {
    let emailSent = false;
    if (emailjsReady && hasEmail) {
      try {
        const reader = new FileReader();
        const base64 = await new Promise((res, rej) => {
          reader.onload = () => res(reader.result.split(',')[1]);
          reader.onerror = rej;
          reader.readAsDataURL(pdfBlob);
        });
        await sendViaEmailJS({
          toEmail: customer.email, toName: customer.name,
          subject: `[화이트라인] 소독증명서 발급 — ${customer.name}`,
          message: `안녕하세요, 화이트라인입니다.\n${fmtDate(workDate)} 소독 작업에 대한 증명서를 첨부해 드립니다.\n\n감사합니다.`,
          pdfBase64: base64, certNo: finalCertNo,
        });
        emailSent = true;
      } catch (err) { console.error('EmailJS 발송 오류:', err); }
    }

    if (emailSent) {
      await saveCertLog({ customerId: customer.id, customerName: customer.name, workDate, sendMethod: 'email', toEmail: customer.email, certNo: finalCertNo, success: true });
      Swal.fire({ icon: 'success', title: '이메일 발송 완료', text: `${customer.email} 로 발송되었습니다.`, confirmButtonColor: '#059669' });
    } else {
      // EmailJS 미설정: PDF 저장 → mailto로 메일앱 열기 (받는 사람 자동 입력)
      const fileName = `소독증명서_${customer.certName?.trim() || customer.name}_${workDate || 'today'}.pdf`;

      // 1) PDF 먼저 저장
      const url = URL.createObjectURL(pdfBlob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      await saveCertLog({ customerId: customer.id, customerName: customer.name, workDate, sendMethod: 'email_download', toEmail: customer.email || '', certNo: finalCertNo, success: false });

      // 2) 고객 이메일이 있으면 mailto로 메일앱 열기 (받는 사람 자동 입력)
      if (customer.email?.trim()) {
        const subject = encodeURIComponent(`[화이트라인] 소독증명서 — ${customer.certName?.trim() || customer.name}`);
        const body    = encodeURIComponent(
          `안녕하세요, 화이트라인입니다.\n${fmtDate(workDate)} 소독 작업에 대한 증명서를 보내드립니다.\n\n※ 첨부파일(${fileName})을 직접 첨부해 주세요.\n\n감사합니다.`
        );
        window.open(`mailto:${customer.email.trim()}?subject=${subject}&body=${body}`, '_blank');

        Swal.fire({
          icon: 'info',
          title: '📧 메일앱이 열렸어요',
          html: `
            <div style="text-align:left;font-size:13px;line-height:1.9;">
              <div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
                <div>받는 사람: <b>${customer.email}</b></div>
                <div>파일명: <b>${fileName}</b></div>
              </div>
              <div style="color:#374151;">
                1️⃣ PDF가 저장됐어요 (다운로드 폴더 확인)<br>
                2️⃣ 메일앱에서 <b>파일첨부</b>를 눌러<br>
                &nbsp;&nbsp;&nbsp;&nbsp;저장된 PDF를 첨부해 주세요<br>
                3️⃣ 발송!
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:8px;">
                💡 자동 첨부는 보안 정책상 브라우저에서 지원하지 않아요
              </div>
            </div>
          `,
          confirmButtonText: '확인',
          confirmButtonColor: '#059669',
        });
      } else {
        // 이메일 미등록
        Swal.fire({
          icon: 'info',
          title: 'PDF 저장 완료',
          html: `PDF가 저장됐어요.<br><small style="color:#6b7280">고객 정보에 이메일을 등록하면 메일앱이 자동으로 열려요.</small>`,
          confirmButtonColor: '#3b82f6',
        });
      }
    }
    return;
  }

  // ── 카카오/문자 ────────────────────────────────────────────
  if (action === 'kakao') {
    const fileName = `소독증명서_${customer.name}_${workDate || 'today'}.pdf`;
    const shared = await shareOrDownloadPdf(pdfBlob, fileName);
    await saveCertLog({ customerId: customer.id, customerName: customer.name, workDate, sendMethod: shared ? 'kakao_share' : 'kakao_download', certNo: finalCertNo, success: true });
  }
}
