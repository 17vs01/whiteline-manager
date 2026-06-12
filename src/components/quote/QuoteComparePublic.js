import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatPrice, priceToKorean, SERVICE_ITEMS, BUSINESS_TYPES } from './quoteConstants';

// URL: /quote-compare/QUOTECUSTOMER_ID
function QuoteComparePublic({ customerId }) {
  const [quotes, setQuotes]         = useState([]);
  const [customer, setCustomer]     = useState(null);
  const [settings, setSettings]     = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [selected, setSelected]     = useState(null);
  const [confirmed, setConfirmed]   = useState(false);
  // 상세 모달
  const [detailQuote, setDetailQuote] = useState(null);
  // PDF 다운로드 ref (상세 모달 내부 렌더링 대상)
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => { fetchData(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    setLoading(true);
    try {
      const cDoc = await getDoc(doc(db, 'quoteCustomers', customerId));
      if (!cDoc.exists()) { setError('비교 견적서를 찾을 수 없습니다.'); setLoading(false); return; }
      const cData = { id: cDoc.id, ...cDoc.data() };
      setCustomer(cData);

      const qSnap = await getDocs(collection(db, 'quotes'));
      const qList = qSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(q => q.quoteCustomerId === customerId && q.status !== 'draft')
        .sort((a, b) => (a.label || a.title || '').localeCompare(b.label || b.title || ''));
      setQuotes(qList);

      const sSnap = await getDocs(collection(db, 'settings'));
      if (sSnap.docs.length > 0) setSettings(sSnap.docs[0].data());

      for (const q of qList) {
        if (!q.viewedAt) {
          try {
            await updateDoc(doc(db, 'quotes', q.id), {
              viewedAt: new Date().toISOString(),
              status: q.status === 'sent' ? 'viewed' : q.status,
            });
          } catch (e) { console.error('견적 열람 기록 오류:', e); }
        }
      }
    } catch (e) { setError('데이터 로드 중 오류가 발생했습니다.'); }
    setLoading(false);
  };

  // ── 안 선택 확인창 ────────────────────────────────────────────────────
  const handleSelectConfirm = async (quote) => {
    const hasSpecificPeriod = quote.periodType === 'specific' && (quote.periodSpecific||[]).length > 0;
    const workMonthCount    = hasSpecificPeriod ? quote.periodSpecific.length : 12;
    const im                = quote.hasInitial ? (quote.initialMonths || 2) : 0;
    const initM             = hasSpecificPeriod ? Math.min(im, workMonthCount) : im;
    const regularM          = workMonthCount - initM;
    const total             = initM * (quote.initialTotal||0) + regularM * (quote.monthlyTotal||0);
    const periodStr         = hasSpecificPeriod
      ? `${[...quote.periodSpecific].sort((a,b)=>a-b).join('·')}월 (${workMonthCount}개월)`
      : '연간 12개월';
    const staffPhone        = settings.companyPhone || '';
    const staffName         = quote.createdBy || settings.companyCeo || '담당자';

    // 확인 다이얼로그
    const result = await import('sweetalert2').then(m => m.default.fire({
      title: `✅ ${quote.label || quote.title}으로 결정하시겠습니까?`,
      html: `
        <div style="text-align:left;font-size:14px;line-height:1.9;padding:4px 0;">
          <div style="background:#f0fdf4;border-radius:8px;padding:10px 14px;margin-bottom:12px;">
            <div>📅 <b>월 ${formatPrice(quote.monthlyTotal)}</b> · ${periodStr}</div>
            <div>💰 기간 총계 <b style="color:#059669;">${formatPrice(total)}</b></div>
          </div>
          <div style="font-size:13px;color:#374151;">
            궁금한 점은 결정 전에 담당자에게 먼저 문의해 주세요.<br>
            <b>${staffName}</b>${staffPhone ? ` · 📞 <b>${formatPhone(staffPhone)}</b>` : ''}
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '결정하기',
      cancelButtonText: '취소',
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#6b7280',
    }));

    if (!result.isConfirmed) return;
    await doSelect(quote);
  };

  const doSelect = async (quote) => {
    setSelected(quote.id);
    try {
      await updateDoc(doc(db, 'quotes', quote.id), {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        selectedFromCompare: true,
      });
      await addDoc(collection(db, 'notifications'), {
        type: 'quoteApproved',
        quoteId: quote.id,
        custName: customer?.custName || '고객',
        customerName: customer?.custName || '고객',
        message: `${customer?.custName || '고객'}님이 비교 견적에서 "${quote.label || quote.title}"을 선택했습니다!`,
        createdAt: new Date().toISOString(),
        read: false,
      });
      setConfirmed(true);
      setDetailQuote(null);
    } catch (e) { alert('선택 처리 중 오류가 발생했습니다.'); }
  };

  // ── PDF 다운로드 (단일) ───────────────────────────────────────────────
  const downloadPdf = async (quote, labelOverride) => {
    setPdfLoading(true);
    const Swal = (await import('sweetalert2')).default;
    Swal.fire({ title: 'PDF 생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF       = (await import('jspdf')).default;

      // 숨겨진 div에 렌더링
      const target = document.getElementById(`pdf-render-${quote.id}`);
      if (!target) throw new Error('렌더링 대상 없음');

      const canvas  = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF('p', 'mm', 'a4');
      const pw      = pdf.internal.pageSize.getWidth();
      const ph      = (canvas.height * pw) / canvas.width;
      let left      = ph, pos = 0;
      pdf.addImage(imgData, 'PNG', 0, pos, pw, ph);
      left -= 297;
      while (left > 0) {
        pos = left - ph; pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, pos, pw, ph);
        left -= 297;
      }
      const today = new Date();
      const ds    = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
      const label = labelOverride || quote.label || quote.title || 'A';
      pdf.save(`견적서(${label})_${customer?.custName || ''}_${ds}.pdf`);
      Swal.fire({ icon: 'success', title: 'PDF 저장 완료', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', 'PDF 생성 실패: ' + e.message, 'error');
    }
    setPdfLoading(false);
  };

  // ── PDF 전체 다운로드 (ZIP) ───────────────────────────────────────────
  const downloadAllPdf = async () => {
    setPdfLoading(true);
    const Swal = (await import('sweetalert2')).default;
    Swal.fire({ title: `PDF ${quotes.length}개 생성 중...`, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF       = (await import('jspdf')).default;
      const JSZip       = (await import('jszip')).default;

      const today = new Date();
      const ds    = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
      const zip   = new JSZip();

      for (const q of quotes) {
        const target = document.getElementById(`pdf-render-${q.id}`);
        if (!target) continue;
        const canvas  = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');
        const pdf     = new jsPDF('p', 'mm', 'a4');
        const pw      = pdf.internal.pageSize.getWidth();
        const ph      = (canvas.height * pw) / canvas.width;
        let left = ph, pos = 0;
        pdf.addImage(imgData, 'PNG', 0, pos, pw, ph);
        left -= 297;
        while (left > 0) {
          pos = left - ph; pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, pos, pw, ph);
          left -= 297;
        }
        const label = q.label || q.title || 'A';
        zip.file(`견적서(${label})_${customer?.custName || ''}_${ds}.pdf`, pdf.output('blob'));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `견적서_전체_${customer?.custName || ''}_${ds}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      Swal.fire({ icon: 'success', title: '전체 PDF 저장 완료', timer: 1800, showConfirmButton: false });
    } catch (e) {
      const Swal2 = (await import('sweetalert2')).default;
      Swal2.fire('오류', '전체 PDF 생성 실패: ' + e.message, 'error');
    }
    setPdfLoading(false);
  };

  // ── 헬퍼 ─────────────────────────────────────────────────────────────
  const getServiceLabel = (type) => SERVICE_ITEMS.find(s => s.value === type)?.label || type;
  const getBusinessLabel = (type) => {
    const b = (BUSINESS_TYPES||[]).find(b => b.value === type);
    return b ? `${b.icon} ${b.label}` : type || '-';
  };
  const today   = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  const formatPhone = (phone) => {
    if (!phone) return '';
    const c = phone.replace(/[^0-9]/g, '');
    if (c.length === 11) return c.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    if (c.length === 10) return c.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    return phone;
  };

  // 기간 총계 계산 공통 함수
  const calcAnnualTotal = (q) => {
    const im = q.hasInitial ? (q.initialMonths || 2) : 0;
    if (q.periodType === 'specific' && (q.periodSpecific||[]).length > 0) {
      const wc = q.periodSpecific.length;
      const im2 = Math.min(im, wc);
      return im2 * (q.initialTotal||0) + (wc - im2) * (q.monthlyTotal||0);
    }
    return im * (q.initialTotal||0) + (12 - im) * (q.monthlyTotal||0);
  };

  const getWorkMonthsLabel = (q) => {
    if (q.periodType === 'specific' && (q.periodSpecific||[]).length > 0) {
      const s = [...q.periodSpecific].sort((a,b)=>a-b);
      return `${s[0]}~${s[s.length-1]}월 (${s.length}개월)`;
    }
    return '연중 (12개월)';
  };

  // ── 개별 견적서 렌더링 (PDF용 + 상세 모달용 공통) ─────────────────────
  const renderQuoteBody = (q, forPdf = false) => {
    const im = q.hasInitial ? (q.initialMonths||2) : 0;
    const hasSpecificPeriod = q.periodType === 'specific' && (q.periodSpecific||[]).length > 0;
    const workMonthCount = hasSpecificPeriod ? q.periodSpecific.length : 12;
    const initM  = hasSpecificPeriod ? Math.min(im, workMonthCount) : im;
    const regularM = workMonthCount - initM;
    const total  = initM * (q.initialTotal||0) + regularM * (q.monthlyTotal||0);
    const periodLabel = hasSpecificPeriod
      ? `${[...q.periodSpecific].sort((a,b)=>a-b).join('·')}월 / ${workMonthCount}개월`
      : '연간 12개월';

    // 월별 금액표 계산
    const baseVisits  = q.visitPerMonth || 1;
    const svcUnit     = (q.services||[]).reduce((s,x)=>s+(parseFloat(x.pricePerUnit)||0),0);
    const zoneBase    = (q.zoneServices||[]).filter(z=>z.include).reduce((s,z)=>s+(parseFloat(z.totalPrice)||0),0);
    const trapEnabled = q.insectTrap?.enabled;
    const trapUnit    = (parseFloat(q.insectTrap?.unitPrice)||0)*(q.insectTrap?.count||1);
    const trapGrid    = q.planGrid?.insectTrap || Array(12).fill(true);
    const mVisits     = q.monthlyVisits || Array(12).fill(null);
    const mPriceChg   = q.monthlyVisitPriceChange || Array(12).fill(false);
    const workMonthSet = hasSpecificPeriod ? new Set(q.periodSpecific) : null;

    const detail = Array.from({length:12},(_,i)=>{
      const isWork = !workMonthSet || workMonthSet.has(i+1);
      if (!isWork) return { month:i+1, visits:0, svc:0, trap:0, total:0, noWork:true };
      const v   = mVisits[i]!==null ? mVisits[i] : baseVisits;
      const svc = mPriceChg[i] ? svcUnit*v+zoneBase : svcUnit*baseVisits+zoneBase;
      const trp = trapEnabled && trapGrid[i] ? trapUnit : 0;
      return { month:i+1, visits:v, svc, trap:trp, total:svc+trp, noWork:false };
    });
    const annualSvc  = detail.reduce((s,m)=>s+m.svc,0);
    const annualTrap = detail.reduce((s,m)=>s+m.trap,0);
    const annualAll  = annualSvc+annualTrap;

    const s = forPdf ? pdfS : modalS;

    return (
      <div style={s.body}>
        {/* 헤더 */}
        <div style={s.docHeader}>
          <div style={s.docCompany}>
            {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={s.logo} />}
            <div>
              <div style={s.companyName}>{settings.companyName||'화이트라인'}</div>
              {settings.companyAddress && <div style={s.companyAddr}>{settings.companyAddress}</div>}
            </div>
          </div>
          <div style={s.docTitle}>
            <div style={s.titleMain}>견 적 서</div>
            <div style={s.titleSub}>({q.label||q.title||'A안'})</div>
            <div style={s.titleDate}>{dateStr}</div>
          </div>
        </div>

        {/* 고객 정보 */}
        <table style={s.infoTable}>
          <tbody>
            <tr>
              <td style={s.infoLabel}>시 설 명</td>
              <td style={s.infoValue}>{customer?.custName}</td>
              <td style={s.infoLabel}>담 당 자</td>
              <td style={s.infoValue}>{q.createdBy||''}</td>
            </tr>
            <tr>
              <td style={s.infoLabel}>주 소</td>
              <td style={{...s.infoValue, colspan:3}}>{customer?.address||''}</td>
              <td style={s.infoLabel}></td><td style={s.infoValue}></td>
            </tr>
            <tr>
              <td style={s.infoLabel}>면 적</td>
              <td style={s.infoValue}>{customer?.area||''}</td>
              <td style={s.infoLabel}>업 종</td>
              <td style={s.infoValue}>{getBusinessLabel(customer?.businessType)}</td>
            </tr>
          </tbody>
        </table>

        {/* 서비스 항목 */}
        <div style={s.sectionTitle}>📅 정기 서비스 견적 (월 {q.visitPerMonth||1}회 기준)</div>
        <table style={s.table}>
          <thead>
            <tr style={s.thead}>
              <th style={s.th}>작업내용</th>
              <th style={{...s.th, width:80}}>구획/수량</th>
              <th style={{...s.th, width:70}}>단가</th>
              <th style={{...s.th, width:80}}>금액</th>
              <th style={s.th}>비고</th>
            </tr>
          </thead>
          <tbody>
            {(q.services||[]).map((svc,i)=>(
              <tr key={i} style={i%2===0?{}:{background:'#f8fafc'}}>
                <td style={s.td}>{getServiceLabel(svc.serviceType)}</td>
                <td style={{...s.tdC}}>{svc.quantity||''}{svc.unit||''}</td>
                <td style={{...s.tdR}}>{formatPrice(svc.pricePerUnit||0)}</td>
                <td style={{...s.tdR, fontWeight:'bold'}}>{formatPrice(svc.totalPrice||0)}</td>
                <td style={s.td}>{svc.memo||''}</td>
              </tr>
            ))}
            <tr style={s.totalRow}>
              <td colSpan={3} style={{...s.td, fontWeight:'bold', color:'white'}}>월 합계</td>
              <td colSpan={2} style={{...s.tdR, fontWeight:'bold', color:'white', fontSize:15}}>
                {formatPrice(q.monthlyTotal||0)}
              </td>
            </tr>
          </tbody>
        </table>
        <div style={s.wonKorean}>
          합계금: {priceToKorean(q.monthlyTotal||0)} / 월 {q.visitPerMonth||1}회
        </div>

        {/* 작업 월 지정 배지 */}
        {hasSpecificPeriod && (
          <div style={s.periodBadge}>
            📆 작업 월: {[...q.periodSpecific].sort((a,b)=>a-b).join('월, ')}월 ({workMonthCount}개월)
          </div>
        )}

        {/* 월별 금액표 */}
        {q.showMonthlyTable !== false && (
          <div style={{marginTop:12}}>
            <div style={s.sectionTitle}>📊 월별 금액표</div>
            <div style={{overflowX:'auto'}}>
              <table style={{...s.table, fontSize:10}}>
                <thead>
                  <tr style={s.thead}>
                    <th style={{...s.th, textAlign:'left', minWidth:50}}>구분</th>
                    {detail.map(m=><th key={m.month} style={{...s.th, width:30, opacity:m.noWork?0.4:1}}>{m.month}월</th>)}
                    <th style={{...s.th, background:'#0f2340', minWidth:45}}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{...s.td, fontWeight:'bold'}}>작업횟수</td>
                    {detail.map(m=><td key={m.month} style={{...s.tdC, color:m.noWork?'#d1d5db':'#374151', background:m.noWork?'#f9fafb':'transparent'}}>{m.noWork?'-':`${m.visits}회`}</td>)}
                    <td style={{...s.tdC, fontWeight:'bold', background:'#f8fafc'}}>{detail.reduce((s,m)=>s+m.visits,0)}회</td>
                  </tr>
                  <tr style={{background:'#f0fdf4'}}>
                    <td style={{...s.td, fontWeight:'bold', color:'#166534'}}>방제비용</td>
                    {detail.map(m=><td key={m.month} style={{...s.tdR, color:m.noWork?'#d1d5db':'#166534', background:m.noWork?'#f9fafb':'transparent'}}>{m.noWork?'-':m.svc>0?(m.svc/10000).toFixed(1)+'만':'-'}</td>)}
                    <td style={{...s.tdR, fontWeight:'bold', color:'#166534', background:'#f0fdf4'}}>{(annualSvc/10000).toFixed(0)}만원</td>
                  </tr>
                  {trapEnabled && (
                    <tr style={{background:'#fef3c7'}}>
                      <td style={{...s.td, fontWeight:'bold', color:'#92400e'}}>🪰 포충기</td>
                      {detail.map(m=><td key={m.month} style={{...s.tdR, color:m.noWork?'#d1d5db':'#d97706', background:m.noWork?'#f9fafb':'transparent'}}>{m.noWork?'-':m.trap>0?(m.trap/10000).toFixed(1)+'만':'-'}</td>)}
                      <td style={{...s.tdR, fontWeight:'bold', color:'#d97706', background:'#fef3c7'}}>{(annualTrap/10000).toFixed(0)}만원</td>
                    </tr>
                  )}
                  <tr style={{background:'#1e3a5f'}}>
                    <td style={{...s.td, fontWeight:'bold', color:'white'}}>월 합계</td>
                    {detail.map(m=><td key={m.month} style={{...s.tdR, color:m.noWork?'#64748b':'#bbf7d0', fontWeight:'bold'}}>{m.noWork?'-':m.total>0?(m.total/10000).toFixed(1)+'만':'-'}</td>)}
                    <td style={{...s.tdR, fontWeight:'bold', color:'#fbbf24', background:'#0f2340'}}>{(annualAll/10000).toFixed(0)}만원</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 총합계금 */}
        <div style={s.totalBox}>
          <div style={s.totalTitle}>💰 총 합계금</div>
          {q.hasInitial && initM > 0 && (
            <div style={s.totalRow2}>
              <span>🚀 초기 1~{initM}개월</span>
              <span>{formatPrice(q.initialTotal)}/월 × {initM}개월 = {formatPrice((q.initialTotal||0)*initM)}</span>
            </div>
          )}
          <div style={s.totalRow2}>
            <span>📅 정기 방제 ({regularM}개월)</span>
            <span>{formatPrice(q.monthlyTotal||0)}/월 × {regularM}개월 = {formatPrice((q.monthlyTotal||0)*regularM)}</span>
          </div>
          <div style={s.totalFinal}>
            <span>📆 기간 총계</span>
            <span style={s.totalAmount}>{formatPrice(total)}</span>
          </div>
          <div style={s.totalKorean}>{priceToKorean(total)} ({periodLabel})</div>
        </div>

        {/* 안내 사항 */}
        <div style={s.noticeBox}>
          <div style={s.noticeTitle}>★ 안내 사항</div>
          <div style={s.noticeItem}>• 월 {q.visitPerMonth||1}회 정기 작업 기준 견적입니다.</div>
          {q.hasInitial && <div style={s.noticeItem}>• 초기 {q.initialMonths}개월은 집중방제 기간입니다.</div>}
          <div style={s.noticeItem}>• 사용 약제는 환경부 허가 제품만 사용합니다.</div>
          <div style={s.noticeItem}>• 작업 후 작업일지 및 사진 보고서를 제출합니다.</div>
        </div>

        {/* 서명란 */}
        <div style={s.signRow}>
          <div style={s.signBox}><div style={s.signLabel}>공 급 자</div></div>
          <div style={s.signBox}><div style={s.signLabel}>담 당 자</div></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div style={cs.loadingWrap}>
      <div style={cs.spinner}/><div style={{color:'#64748b',marginTop:16}}>비교 견적서를 불러오는 중...</div>
    </div>
  );
  if (error) return <div style={cs.errorWrap}><div style={{fontSize:48}}>😢</div><div style={{color:'#ef4444',fontWeight:'bold'}}>{error}</div></div>;

  return (
    <div style={cs.page}>
      {/* 툴바 */}
      <div style={cs.toolbar} className="no-print">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={{width:32,height:32,borderRadius:6,objectFit:'cover'}}/>}
          <span style={{fontWeight:'bold',color:'#1e3a5f'}}>{settings.companyName||'화이트라인'}</span>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {/* 전체 PDF 다운로드 */}
          {quotes.length > 1 && (
            <button onClick={downloadAllPdf} disabled={pdfLoading}
              style={{...cs.toolBtn, background:'#6366f1'}}>
              📦 전체 PDF
            </button>
          )}
          <button onClick={() => window.print()} style={cs.toolBtn}>🖨️ 인쇄</button>
        </div>
      </div>

      {/* 헤더 */}
      <div style={cs.header}>
        <div style={{fontSize:22,fontWeight:'bold',color:'#1e3a5f',letterSpacing:2}}>견 적 비 교 서</div>
        <div style={{fontSize:13,color:'#64748b',marginTop:4}}>{customer?.custName} · {dateStr}</div>
        <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}>카드를 탭하면 상세 견적서를 볼 수 있어요</div>
      </div>

      {confirmed && (
        <div style={cs.confirmBanner} className="no-print">
          🎉 선택하신 견적이 담당자에게 전달되었습니다! 담당자가 연락드릴 예정입니다.
        </div>
      )}

      {quotes.length === 0 ? (
        <div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>비교할 견적서가 없습니다.</div>
      ) : (
        <div style={cs.doc}>
          {/* 비교 요약 카드 */}
          <div style={{overflowX:'auto',marginBottom:20}}>
            <div style={{display:'flex',gap:12,minWidth:`${quotes.length*220}px`}}>
              {quotes.map((q) => {
                const annualTotal = calcAnnualTotal(q);
                const isSelected  = selected === q.id;
                return (
                  <div key={q.id} style={{...cs.compareCard, ...(isSelected?cs.compareCardSelected:{})}}>
                    {/* 카드 클릭 → 상세 모달 */}
                    <div onClick={() => setDetailQuote(q)} style={{cursor:'pointer', flex:1}}>
                      <div style={cs.cardLabel}>{q.label||q.title||'A안'}</div>
                      <div style={cs.cardMonthly}>{formatPrice(q.monthlyTotal)}</div>
                      <div style={cs.cardMonthlyLabel}>월 {q.visitPerMonth}회 기준</div>
                      {q.hasInitial && (
                        <div style={cs.cardInitial}>초기 {q.initialMonths}개월 {formatPrice(q.initialTotal)}/월</div>
                      )}
                      {q.periodType === 'specific' && (q.periodSpecific||[]).length > 0 && (
                        <div style={{fontSize:11,color:'#6366f1',textAlign:'center',background:'#ede9fe',borderRadius:6,padding:'3px 8px',fontWeight:'bold'}}>
                          📆 {getWorkMonthsLabel(q)}
                        </div>
                      )}
                      <div style={cs.cardAnnual}>총 {formatPrice(annualTotal)}</div>
                      <div style={cs.cardServices}>
                        {(q.services||[]).map((svc,i)=>(
                          <div key={i} style={cs.serviceItem}>✓ {getServiceLabel(svc.serviceType)}</div>
                        ))}
                        {q.insectTrap?.enabled && (
                          <div style={{...cs.serviceItem,color:'#d97706'}}>🪰 포충기 {q.insectTrap.count}대</div>
                        )}
                      </div>
                      <div style={{fontSize:11,color:'#94a3b8',textAlign:'center',marginTop:4}}>탭하여 상세보기 👆</div>
                    </div>

                    {/* 액션 버튼 영역 */}
                    <div style={{display:'flex',gap:6,marginTop:8}}>
                      {/* PDF 다운로드 */}
                      <button onClick={() => downloadPdf(q, q.label||q.title)}
                        disabled={pdfLoading}
                        style={{flex:1,padding:'7px 0',background:'#f1f5f9',color:'#374151',border:'1px solid #e2e8f0',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:'bold'}}>
                        📄 PDF
                      </button>
                      {/* 이 안으로 진행 */}
                      {!confirmed && (
                        <button onClick={() => handleSelectConfirm(q)}
                          style={{flex:2,...cs.selectBtn,...(isSelected?cs.selectBtnActive:{})}}>
                          {isSelected ? '✅ 선택됨' : '이 안으로 진행'}
                        </button>
                      )}
                    </div>
                    {isSelected && (
                      <div style={{fontSize:12,color:'#10b981',textAlign:'center',marginTop:6,fontWeight:'bold'}}>
                        담당자에게 전달되었습니다
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 상세 비교 표 */}
          <div style={cs.detailTitle}>📊 항목별 상세 비교</div>
          <div style={{overflowX:'auto'}}>
            <table style={cs.table}>
              <thead>
                <tr style={{background:'#1e3a5f',color:'white'}}>
                  <th style={cs.th}>비교 항목</th>
                  {quotes.map(q=><th key={q.id} style={cs.th}>{q.label||q.title}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={cs.td}>월 작업횟수</td>
                  {quotes.map(q=><td key={q.id} style={cs.tdC}>{q.visitPerMonth}회</td>)}
                </tr>
                <tr>
                  <td style={cs.td}>작업 월</td>
                  {quotes.map(q=>(
                    <td key={q.id} style={{...cs.tdC,color:q.periodType==='specific'?'#6366f1':'#374151',fontWeight:q.periodType==='specific'?'bold':'normal'}}>
                      {q.periodType==='specific'&&(q.periodSpecific||[]).length>0
                        ? `${[...q.periodSpecific].sort((a,b)=>a-b).join('·')}월 (${q.periodSpecific.length}개월)`
                        : '연중 12개월'}
                    </td>
                  ))}
                </tr>
                <tr style={{background:'#f0fdf4'}}>
                  <td style={{...cs.td,fontWeight:'bold'}}>정기 월 비용</td>
                  {quotes.map(q=>(
                    <td key={q.id} style={{...cs.tdC,fontWeight:'bold',color:'#10b981',fontSize:15}}>
                      {formatPrice(q.monthlyTotal)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={cs.td}>초기비용 여부</td>
                  {quotes.map(q=><td key={q.id} style={cs.tdC}>{q.hasInitial?`있음 (${q.initialMonths}개월)`:'없음'}</td>)}
                </tr>
                {quotes.some(q=>q.hasInitial) && (
                  <tr style={{background:'#fef3c7'}}>
                    <td style={cs.td}>초기 월 비용</td>
                    {quotes.map(q=>(
                      <td key={q.id} style={{...cs.tdC,color:'#d97706',fontWeight:'bold'}}>
                        {q.hasInitial?formatPrice(q.initialTotal)+'/월':'-'}
                      </td>
                    ))}
                  </tr>
                )}
                {quotes.some(q=>q.insectTrap?.enabled) && (
                  <tr>
                    <td style={cs.td}>🪰 포충기</td>
                    {quotes.map(q=>(
                      <td key={q.id} style={{...cs.tdC,color:'#d97706'}}>
                        {q.insectTrap?.enabled?`${q.insectTrap.count}대 포함`:'미포함'}
                      </td>
                    ))}
                  </tr>
                )}
                <tr style={{background:'#1e3a5f'}}>
                  <td style={{...cs.td,fontWeight:'bold',color:'white'}}>기간 총계</td>
                  {quotes.map(q=>{
                    const total = calcAnnualTotal(q);
                    const wc = q.periodType==='specific'&&(q.periodSpecific||[]).length>0 ? q.periodSpecific.length : 12;
                    return (
                      <td key={q.id} style={{...cs.tdC,fontWeight:'bold',color:'#fbbf24',fontSize:15}}>
                        {formatPrice(total)}
                        <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>
                          {formatPrice(q.monthlyTotal)} × {wc}개월
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* 안내 */}
          <div style={cs.noticeBox}>
            <div style={{fontWeight:'bold',color:'#1e3a5f',fontSize:12,marginBottom:6}}>★ 안내 사항</div>
            <div style={cs.noticeItem}>• 위 견적은 담당자 {quotes[0]?.createdBy}가 작성한 {dateStr} 기준 견적입니다.</div>
            <div style={cs.noticeItem}>• 원하시는 안 선택 시 담당자에게 즉시 알림이 전달됩니다.</div>
            <div style={cs.noticeItem}>• 견적 문의: {formatPhone(settings.companyPhone)}</div>
          </div>
        </div>
      )}

      {/* ── PDF 렌더링용 숨김 div (각 견적서마다 1개) ── */}
      <div style={{position:'fixed', left:'-9999px', top:0, width:794, background:'white'}}>
        {quotes.map(q=>(
          <div key={q.id} id={`pdf-render-${q.id}`} style={{width:794,padding:'20px 28px',background:'white',fontFamily:'Malgun Gothic, Apple SD Gothic Neo, sans-serif'}}>
            {renderQuoteBody(q, true)}
          </div>
        ))}
      </div>

      {/* ── 상세 모달 (슬라이드업) ── */}
      {detailQuote && (
        <div style={cs.modalOverlay} onClick={()=>setDetailQuote(null)}>
          <div style={cs.modalSheet} onClick={e=>e.stopPropagation()}>
            {/* 모달 헤더 */}
            <div style={cs.modalHeader}>
              <div style={{fontWeight:'bold',fontSize:16,color:'#1e3a5f'}}>
                📋 {detailQuote.label||detailQuote.title} 상세 견적서
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>downloadPdf(detailQuote, detailQuote.label||detailQuote.title)}
                  disabled={pdfLoading}
                  style={{padding:'6px 12px',background:'#3b82f6',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:'bold'}}>
                  📄 PDF 저장
                </button>
                <button onClick={()=>setDetailQuote(null)}
                  style={{padding:'6px 12px',background:'#f1f5f9',color:'#374151',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:'bold'}}>
                  ✕ 닫기
                </button>
              </div>
            </div>
            {/* 모달 본문 */}
            <div style={cs.modalBody}>
              {renderQuoteBody(detailQuote, false)}
            </div>
            {/* 모달 하단 버튼 */}
            {!confirmed && (
              <div style={cs.modalFooter}>
                <button onClick={()=>setDetailQuote(null)}
                  style={{flex:1,padding:14,background:'#f1f5f9',color:'#374151',border:'none',borderRadius:10,cursor:'pointer',fontSize:14,fontWeight:'bold'}}>
                  닫기
                </button>
                <button onClick={()=>handleSelectConfirm(detailQuote)}
                  style={{flex:2,padding:14,background:'#10b981',color:'white',border:'none',borderRadius:10,cursor:'pointer',fontSize:14,fontWeight:'bold'}}>
                  ✅ 이 안으로 진행
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @media print { .no-print { display: none !important; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── 공통 스타일 ────────────────────────────────────────────────────────
const cs = {
  page: { maxWidth:900, margin:'0 auto', padding:'0 0 40px', fontFamily:'Malgun Gothic, Apple SD Gothic Neo, sans-serif', background:'#f8fafc', minHeight:'100vh' },
  loadingWrap: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', color:'#64748b' },
  spinner: { width:40, height:40, border:'4px solid #e2e8f0', borderTop:'4px solid #3b82f6', borderRadius:'50%', animation:'spin 1s linear infinite' },
  errorWrap: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:12 },
  toolbar: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', background:'white', borderBottom:'1px solid #e2e8f0', position:'sticky', top:0, zIndex:100 },
  toolBtn: { padding:'8px 14px', background:'#1e40af', color:'white', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:'bold' },
  header: { textAlign:'center', padding:'20px 20px 14px', background:'white', borderBottom:'1px solid #e2e8f0' },
  confirmBanner: { background:'#d1fae5', color:'#065f46', padding:'12px 20px', fontSize:13, fontWeight:'bold', textAlign:'center', borderBottom:'1px solid #86efac' },
  doc: { padding:20 },
  compareCard: { flex:'0 0 200px', background:'white', borderRadius:12, padding:16, boxShadow:'0 1px 4px rgba(0,0,0,0.08)', border:'2px solid #e2e8f0', display:'flex', flexDirection:'column', gap:6 },
  compareCardSelected: { border:'2px solid #10b981', background:'#f0fdf4' },
  cardLabel: { fontSize:18, fontWeight:'bold', color:'#1e3a5f', textAlign:'center' },
  cardMonthly: { fontSize:24, fontWeight:'bold', color:'#10b981', textAlign:'center' },
  cardMonthlyLabel: { fontSize:11, color:'#64748b', textAlign:'center' },
  cardInitial: { fontSize:12, color:'#d97706', textAlign:'center', background:'#fef3c7', borderRadius:6, padding:'4px 8px' },
  cardAnnual: { fontSize:13, color:'#1e3a5f', textAlign:'center', fontWeight:'bold' },
  cardServices: { borderTop:'1px solid #f1f5f9', paddingTop:8, display:'flex', flexDirection:'column', gap:4, flex:1 },
  serviceItem: { fontSize:12, color:'#374151' },
  selectBtn: { padding:'8px 0', background:'#f1f5f9', color:'#374151', border:'1px solid #e2e8f0', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:'bold', width:'100%' },
  selectBtnActive: { background:'#10b981', color:'white', border:'1px solid #10b981' },
  detailTitle: { fontSize:14, fontWeight:'bold', color:'#1e3a5f', marginBottom:8, marginTop:4 },
  table: { width:'100%', borderCollapse:'collapse', fontSize:13, marginBottom:14 },
  th: { padding:10, textAlign:'center', fontWeight:'bold', border:'1px solid rgba(255,255,255,0.2)' },
  td: { padding:'9px 12px', border:'1px solid #e2e8f0', color:'#374151' },
  tdC: { padding:'9px 12px', textAlign:'center', border:'1px solid #e2e8f0', color:'#374151' },
  noticeBox: { background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'12px 14px' },
  noticeItem: { fontSize:11, color:'#374151', marginBottom:3, lineHeight:1.5 },
  // 모달
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'flex-end' },
  modalSheet: { width:'100%', maxWidth:860, margin:'0 auto', background:'white', borderRadius:'16px 16px 0 0', maxHeight:'92vh', display:'flex', flexDirection:'column', animation:'slideUp 0.3s ease-out' },
  modalHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 20px', borderBottom:'1px solid #e2e8f0', flexShrink:0 },
  modalBody: { overflowY:'auto', flex:1, padding:'0 4px' },
  modalFooter: { display:'flex', gap:10, padding:16, borderTop:'1px solid #e2e8f0', flexShrink:0 },
};

// ── PDF용 스타일 (촘촘하게) ─────────────────────────────────────────────
const pdfS = {
  body: { fontFamily:'Malgun Gothic, Apple SD Gothic Neo, sans-serif', fontSize:12, color:'#1e293b' },
  docHeader: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12, paddingBottom:10, borderBottom:'2px solid #1e3a5f' },
  docCompany: { display:'flex', gap:8, alignItems:'center' },
  logo: { width:36, height:36, borderRadius:6, objectFit:'cover' },
  companyName: { fontWeight:'bold', fontSize:15, color:'#1e3a5f' },
  companyAddr: { fontSize:10, color:'#64748b', marginTop:2 },
  docTitle: { textAlign:'right' },
  titleMain: { fontSize:20, fontWeight:'bold', letterSpacing:3, color:'#1e3a5f' },
  titleSub: { fontSize:13, color:'#64748b' },
  titleDate: { fontSize:11, color:'#94a3b8', marginTop:2 },
  infoTable: { width:'100%', borderCollapse:'collapse', marginBottom:12, fontSize:12 },
  infoLabel: { background:'#1e3a5f', color:'white', fontWeight:'bold', padding:'6px 10px', border:'1px solid #2d4a6f', width:70, textAlign:'center' },
  infoValue: { padding:'6px 10px', border:'1px solid #e2e8f0', color:'#374151' },
  sectionTitle: { fontWeight:'bold', fontSize:12, color:'#1e3a5f', margin:'10px 0 6px', borderLeft:'3px solid #3b82f6', paddingLeft:8 },
  table: { width:'100%', borderCollapse:'collapse', marginBottom:8 },
  thead: { background:'#1e3a5f', color:'white' },
  th: { padding:'6px 8px', textAlign:'center', fontWeight:'bold', border:'1px solid rgba(255,255,255,0.2)', fontSize:11 },
  td: { padding:'5px 8px', border:'1px solid #e2e8f0', color:'#374151', fontSize:11 },
  tdC: { padding:'5px 4px', border:'1px solid #e2e8f0', textAlign:'center', fontSize:10 },
  tdR: { padding:'5px 4px', border:'1px solid #e2e8f0', textAlign:'right', fontSize:10 },
  totalRow: { background:'#1e3a5f' },
  wonKorean: { textAlign:'right', fontSize:11, color:'#64748b', marginBottom:4 },
  periodBadge: { display:'inline-block', background:'#ede9fe', color:'#6366f1', fontWeight:'bold', fontSize:11, padding:'4px 10px', borderRadius:6, marginBottom:8 },
  totalBox: { background:'#1e3a5f', borderRadius:8, padding:'10px 14px', marginTop:10, marginBottom:8 },
  totalTitle: { color:'white', fontWeight:'bold', fontSize:12, marginBottom:6, borderBottom:'1px solid rgba(255,255,255,0.2)', paddingBottom:4 },
  totalRow2: { display:'flex', justifyContent:'space-between', fontSize:11, color:'#bbf7d0', marginBottom:3 },
  totalFinal: { display:'flex', justifyContent:'space-between', alignItems:'center', borderTop:'1px solid rgba(255,255,255,0.25)', paddingTop:6, marginTop:4 },
  totalAmount: { color:'#fbbf24', fontWeight:'bold', fontSize:16 },
  totalKorean: { textAlign:'right', fontSize:9, color:'#94a3b8', marginTop:2 },
  noticeBox: { background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:6, padding:'8px 12px', marginTop:8 },
  noticeTitle: { fontWeight:'bold', color:'#1e3a5f', fontSize:11, marginBottom:4 },
  noticeItem: { fontSize:10, color:'#374151', marginBottom:2, lineHeight:1.4 },
  signRow: { display:'flex', gap:20, marginTop:12 },
  signBox: { flex:1, border:'1px solid #e2e8f0', borderRadius:6, height:50, display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:6 },
  signLabel: { fontSize:11, color:'#94a3b8' },
};

// ── 모달용 스타일 (여유롭게) ────────────────────────────────────────────
const modalS = {
  ...pdfS,
  body: { fontFamily:'Malgun Gothic, Apple SD Gothic Neo, sans-serif', fontSize:14, color:'#1e293b', padding:'16px 20px' },
  th: { padding:'8px 10px', textAlign:'center', fontWeight:'bold', border:'1px solid rgba(255,255,255,0.2)', fontSize:12 },
  td: { padding:'8px 12px', border:'1px solid #e2e8f0', color:'#374151', fontSize:13 },
  tdC: { padding:'7px 6px', border:'1px solid #e2e8f0', textAlign:'center', fontSize:12 },
  tdR: { padding:'7px 6px', border:'1px solid #e2e8f0', textAlign:'right', fontSize:12 },
  totalTitle: { color:'white', fontWeight:'bold', fontSize:14, marginBottom:8, borderBottom:'1px solid rgba(255,255,255,0.2)', paddingBottom:6 },
  totalRow2: { display:'flex', justifyContent:'space-between', fontSize:13, color:'#bbf7d0', marginBottom:4 },
  totalAmount: { color:'#fbbf24', fontWeight:'bold', fontSize:20 },
  totalKorean: { textAlign:'right', fontSize:11, color:'#94a3b8', marginTop:2 },
  sectionTitle: { fontWeight:'bold', fontSize:13, color:'#1e3a5f', margin:'12px 0 8px', borderLeft:'3px solid #3b82f6', paddingLeft:8 },
  noticeItem: { fontSize:12, color:'#374151', marginBottom:3, lineHeight:1.6 },
};

export default QuoteComparePublic;
