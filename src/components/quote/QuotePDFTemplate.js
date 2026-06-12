import React, { useRef, useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { formatPrice, priceToKorean, SERVICE_ITEMS, BUSINESS_TYPES } from './quoteConstants';
import { shareOrDownloadPdf } from '../../utils/certPdfSender';
import { notifyQuoteSent } from '../../utils/notifyCustomer';

function QuotePDFTemplate({ quoteCustomer, quote, allQuotes, settings, currentUser, onBack }) {
  const page1Ref  = useRef(); // 전체페이지: 표지+서비스+계획표+여백
  const page2Ref  = useRef(); // 전체페이지: 견적서
  const quoteOnly = useRef(); // 견적서만 출력 시
  const [showAllPages, setShowAllPages] = useState(false);
  const [companySettings, setCompanySettings] = useState(settings || {});

  useEffect(() => {
    getDocs(collection(db, 'settings')).then(snap => {
      if (snap.docs.length > 0) setCompanySettings(snap.docs[0].data());
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today   = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;
  const ds      = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;

  const getServiceLabel = (type) => SERVICE_ITEMS.find(s => s.value === type)?.label || type;
  const getBusinessLabel = (type) => {
    const b = BUSINESS_TYPES.find(b => b.value === type);
    return b ? `${b.icon} ${b.label}` : type || '-';
  };

  // 견적서 라벨 (A/B/C)
  const quoteLabel = (() => {
    if (!allQuotes || allQuotes.length < 2) return '';
    const idx = allQuotes.findIndex(q => q.id === quote.id);
    return idx >= 0 ? String.fromCharCode(65 + idx) : '';
  })();

  // 기간 총계 계산
  const im = quote.hasInitial ? (quote.initialMonths || 2) : 0;
  const hasSpecificPeriod = quote.periodType === 'specific' && (quote.periodSpecific||[]).length > 0;
  const workMonthCount = hasSpecificPeriod ? quote.periodSpecific.length : 12;
  const initMonths     = hasSpecificPeriod ? Math.min(im, workMonthCount) : im;
  const regularMonths  = workMonthCount - initMonths;
  const annualTotal    = initMonths * (quote.initialTotal||0) + regularMonths * (quote.monthlyTotal||0);
  const periodLabel    = hasSpecificPeriod
    ? `${[...quote.periodSpecific].sort((a,b)=>a-b).join('·')}월 / ${workMonthCount}개월`
    : '연간 12개월';

  // 여백 설정 (Firestore settings에서 불러옴)
  const marg = companySettings.quotePdfMargin || {};

  // ── PDF 생성 공통 함수 (ref 배열 → 각 페이지별 렌더링 후 합치기) ──────
  const buildPdf = async (refs, fileName) => {
    Swal.fire({ title: 'PDF 생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF       = (await import('jspdf')).default;
      const pdf         = new jsPDF('p', 'mm', 'a4');
      const PW          = pdf.internal.pageSize.getWidth();  // 210
      const PH          = pdf.internal.pageSize.getHeight(); // 297

      for (let i = 0; i < refs.length; i++) {
        const el = refs[i].current;
        if (!el) continue;
        const canvas  = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');
        const imgH    = (canvas.height * PW) / canvas.width; // mm 환산 높이

        if (i > 0) pdf.addPage();

        if (imgH <= PH) {
          // 한 페이지에 들어가면 수직 중앙이 아니라 상단부터
          pdf.addImage(imgData, 'PNG', 0, 0, PW, imgH);
        } else {
          // 넘치면 여러 페이지로 분할
          let left = imgH, pos = 0;
          pdf.addImage(imgData, 'PNG', 0, pos, PW, imgH);
          left -= PH;
          while (left > 0) {
            pos = left - imgH;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, pos, PW, imgH);
            left -= PH;
          }
        }
      }
      return { pdf, fileName };
    } catch (e) {
      Swal.fire('오류', 'PDF 생성 실패: ' + e.message, 'error');
      return null;
    }
  };

  const handleDownloadPDF = async () => {
    const refs     = showAllPages ? [page1Ref, page2Ref] : [quoteOnly];
    const fileName = `견적서${quoteLabel ? `(${quoteLabel})` : ''}_${quoteCustomer.custName}_${ds}.pdf`;
    const result   = await buildPdf(refs, fileName);
    if (!result) return;
    result.pdf.save(result.fileName);
    Swal.fire({ icon: 'success', title: 'PDF 저장 완료', timer: 1500, showConfirmButton: false });
  };

  const handleShare = async () => {
    const refs     = showAllPages ? [page1Ref, page2Ref] : [quoteOnly];
    const fileName = `견적서${quoteLabel ? `(${quoteLabel})` : ''}_${quoteCustomer.custName}_${ds}.pdf`;
    const result   = await buildPdf(refs, fileName);
    if (!result) return;
    Swal.close();
    const blob = result.pdf.output('blob');
    await shareOrDownloadPdf(blob, fileName);
  };

  const handleEmail = async () => {
    const email = quoteCustomer.email || '';
    const { value } = await Swal.fire({
      title: '📧 이메일로 견적서 발송',
      html: `
        <div style="text-align:left;padding:0 10px;">
          <div style="margin-bottom:10px;">
            <label style="font-size:13px;color:#666;">받는 이메일</label>
            <input id="email-to" class="swal2-input" value="${email}" placeholder="example@email.com" style="margin:4px 0;">
          </div>
          <div>
            <label style="font-size:13px;color:#666;">메시지 (선택)</label>
            <textarea id="email-msg" class="swal2-textarea" style="margin:4px 0;height:80px;">${quoteCustomer.custName}님, 안녕하세요.\n${companySettings.companyName||'화이트라인'}입니다.\n요청하신 견적서를 보내드립니다.</textarea>
          </div>
        </div>
      `,
      showCancelButton: true, confirmButtonText: '발송', cancelButtonText: '취소',
      preConfirm: () => ({ to: document.getElementById('email-to').value, message: document.getElementById('email-msg').value })
    });
    if (!value) return;
    if (!value.to) { Swal.fire('오류', '이메일을 입력하세요', 'error'); return; }
    Swal.fire({ title: '이메일 발송 중...', html: `<div style="font-size:13px;color:#666;">PDF를 먼저 다운로드 후 이메일에 첨부해주세요.<br><br>수신자: <b>${value.to}</b></div>`, icon: 'info', confirmButtonText: 'PDF 다운로드' }).then(() => handleDownloadPDF());
  };

  const handleCopyLink = async () => {
    const link = `${window.location.origin}/quote-view/${quote.id}`;
    navigator.clipboard.writeText(link);
    try {
      if (quote.status === 'draft' || !quote.status) {
        await updateDoc(doc(db, 'quotes', quote.id), { status: 'sent', sentAt: new Date().toISOString() });
      }
    } catch (e) { console.warn('발송 상태 변경 실패:', e); }
    notifyQuoteSent(
      { ...quote, customerCode: quoteCustomer?.customerCode || quoteCustomer?.code || '' },
      quoteCustomer?.customerId || null,
    ).catch(() => {});
    Swal.fire({ icon: 'success', title: '🔗 고객 링크 복사 완료',
      html: `<div style="font-size:12px;color:#666;word-break:break-all;margin-bottom:8px;">${link}</div><div style="font-size:11px;color:#94a3b8;">이 링크를 고객에게 전달하세요.</div>`,
      confirmButtonText: '확인' });
  };

  const handleCopyCompareLink = async () => {
    const link = `${window.location.origin}/quote-compare/${quoteCustomer.id}`;
    navigator.clipboard.writeText(link);
    try {
      if (allQuotes && allQuotes.length > 0) {
        await Promise.all(allQuotes.filter(q => !q.status || q.status === 'draft')
          .map(q => updateDoc(doc(db, 'quotes', q.id), { status: 'sent', sentAt: new Date().toISOString() })));
      }
    } catch (e) { console.warn('비교링크 발송 상태 변경 실패:', e); }
    Swal.fire({ icon:'success', title:'📊 비교링크 복사 완료',
      html:`<div style="font-size:12px;color:#666;">고객이 A/B/C 안을 나란히 비교할 수 있습니다.</div>`, timer:2500, showConfirmButton:false });
  };

  // ── 월별 금액표 계산 ─────────────────────────────────────────────────
  const buildDetail = () => {
    const baseVisits = quote.visitPerMonth || 1;
    const svcUnit    = (quote.services||[]).reduce((s,x)=>s+(parseFloat(x.pricePerUnit)||0),0);
    const zoneBase   = (quote.zoneServices||[]).filter(z=>z.include).reduce((s,z)=>s+(parseFloat(z.totalPrice)||0),0);
    const trapEnabled = quote.insectTrap?.enabled;
    const trapUnit    = (parseFloat(quote.insectTrap?.unitPrice)||0)*(quote.insectTrap?.count||1);
    const trapGrid    = quote.planGrid?.insectTrap || Array(12).fill(true);
    const mVisits     = quote.monthlyVisits || Array(12).fill(null);
    const mPriceChg   = quote.monthlyVisitPriceChange || Array(12).fill(false);
    const workSet     = hasSpecificPeriod ? new Set(quote.periodSpecific) : null;
    const detail = Array.from({length:12},(_,i)=>{
      const isWork = !workSet || workSet.has(i+1);
      if (!isWork) return { month:i+1, visits:0, svc:0, trap:0, total:0, noWork:true };
      const v   = mVisits[i]!==null ? mVisits[i] : baseVisits;
      const svc = mPriceChg[i] ? svcUnit*v+zoneBase : svcUnit*baseVisits+zoneBase;
      const trp = trapEnabled && trapGrid[i] ? trapUnit : 0;
      return { month:i+1, visits:v, svc, trap:trp, total:svc+trp, noWork:false };
    });
    return { detail, trapEnabled, annualSvc: detail.reduce((s,m)=>s+m.svc,0), annualTrap: detail.reduce((s,m)=>s+m.trap,0) };
  };

  // ── 헤더 컴포넌트 (로고+회사명) ─────────────────────────────────────
  const CompanyHeader = () => (
    <div style={S.companyHeader}>
      {companySettings.companyLogo && companySettings.companyLogo.startsWith('data:image') ? (
        <img src={companySettings.companyLogo} alt="로고" style={S.headerLogo} />
      ) : (
        <div style={{ fontSize:28 }}>📋</div>
      )}
      <div>
        <div style={S.headerCompanyName}>{companySettings.companyName||'화이트라인'}</div>
        {companySettings.companyAddress && <div style={S.headerSub}>{companySettings.companyAddress}</div>}
        {companySettings.companyPhone   && <div style={S.headerSub}>Tel: {companySettings.companyPhone}</div>}
      </div>
    </div>
  );

  // ── 견적서 본문 (page2 / quoteOnly 공용) ─────────────────────────────
  const QuoteBody = ({ showHeader }) => {
    const { detail, trapEnabled, annualSvc, annualTrap } = buildDetail();
    const annualAll = annualSvc + annualTrap;
    return (
      <div style={S.quoteBody}>
        {/* 헤더: 견적서만 출력이거나 전체 2페이지일 때 */}
        {showHeader && (
          <div style={S.quoteTopHeader}>
            <CompanyHeader />
            <div style={S.quoteTitleBlock}>
              <div style={S.quoteDocTitle}>
                견 적 서
                {quoteLabel && <span style={S.quoteLabelBadge}>({quoteLabel})</span>}
              </div>
              <div style={S.quoteDate}>{dateStr}</div>
            </div>
          </div>
        )}
        {/* 전체페이지 2페이지일 때 구분선 */}
        {!showHeader && (
          <div style={S.page2Divider}>
            <span>견 적 서{quoteLabel ? ` (${quoteLabel})` : ''}</span>
            <span style={{fontSize:12,color:'#94a3b8'}}>{dateStr}</span>
          </div>
        )}

        {/* 고객 정보 */}
        <table style={S.infoTable}>
          <tbody>
            <tr>
              <td style={S.infoLabel}>시 설 명</td>
              <td style={S.infoVal}>{quoteCustomer.custName}</td>
              <td style={S.infoLabel}>담 당 자</td>
              <td style={S.infoVal}>{currentUser?.name||'-'}</td>
            </tr>
            <tr>
              <td style={S.infoLabel}>주 소</td>
              <td style={S.infoVal} colSpan={3}>{quoteCustomer.address||'-'}</td>
            </tr>
            <tr>
              <td style={S.infoLabel}>면 적</td>
              <td style={S.infoVal}>{quoteCustomer.area ? `${quoteCustomer.area}평` : '-'}</td>
              <td style={S.infoLabel}>업 종</td>
              <td style={S.infoVal}>{getBusinessLabel(quoteCustomer.businessType)}</td>
            </tr>
            {quoteCustomer.unitCount && (
              <tr>
                <td style={S.infoLabel}>호실/세대</td>
                <td style={S.infoVal} colSpan={3}>{quoteCustomer.unitCount}개</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 서비스 항목 */}
        <div style={S.tableTitle}>📅 정기 서비스 견적 (월 {quote.visitPerMonth}회 기준)</div>
        <table style={S.quoteTable}>
          <thead>
            <tr style={{background:'#1e3a5f',color:'white'}}>
              <th style={S.qth}>작업내용</th><th style={S.qth}>구획/수량</th>
              <th style={S.qth}>단가</th><th style={S.qth}>금액</th><th style={S.qth}>비고</th>
            </tr>
          </thead>
          <tbody>
            {(quote.services||[]).map((sv,i)=>{
              const info = SERVICE_ITEMS.find(x=>x.value===sv.serviceType);
              return (
                <tr key={i} style={{background:i%2?'#f8fafc':'white'}}>
                  <td style={S.qtd}>{info?.icon} {getServiceLabel(sv.serviceType)}</td>
                  <td style={S.qtdC}>{sv.unitCount ? `${sv.unitCount}호실` : (quoteCustomer.area ? `${quoteCustomer.area}평` : '-')}</td>
                  <td style={S.qtdR}>{formatPrice(sv.pricePerUnit)}</td>
                  <td style={{...S.qtdR,fontWeight:'bold'}}>{formatPrice(sv.totalPrice)}</td>
                  <td style={{...S.qtd,fontSize:11,color:'#64748b'}}>{sv.note||''}</td>
                </tr>
              );
            })}
            <tr style={{background:'#1e3a5f',color:'white'}}>
              <td style={{...S.qtd,fontWeight:'bold'}} colSpan={3}>월 합계</td>
              <td style={{...S.qtdR,fontWeight:'bold',fontSize:16}} colSpan={2}>{formatPrice(quote.monthlyTotal)}</td>
            </tr>
          </tbody>
        </table>
        <div style={S.totalKorean}>합계금: {priceToKorean(quote.monthlyTotal)} / 월 {quote.visitPerMonth}회</div>

        {/* 초기비용 */}
        {quote.hasInitial && (
          <>
            <div style={{...S.tableTitle,color:'#d97706',marginTop:14}}>
              🚀 초기 서비스 (처음 {quote.initialMonths}개월, 월 {quote.initialVisitsPerMonth}회)
            </div>
            <table style={S.quoteTable}>
              <thead><tr style={{background:'#92400e',color:'white'}}>
                <th style={S.qth}>항목</th><th style={S.qth}>내용</th><th style={S.qth}>금액</th>
              </tr></thead>
              <tbody>
                <tr>
                  <td style={S.qtd}>초기 집중방제</td>
                  <td style={S.qtd}>월 {quote.initialVisitsPerMonth}회 × {quote.initialMonths}개월</td>
                  <td style={{...S.qtdR,fontWeight:'bold'}}>{formatPrice(quote.initialTotal)}/월</td>
                </tr>
                <tr style={{background:'#fef3c7'}}>
                  <td style={{...S.qtd,fontWeight:'bold',color:'#92400e'}} colSpan={2}>초기 기간 합계</td>
                  <td style={{...S.qtdR,fontWeight:'bold',color:'#d97706',fontSize:15}}>{formatPrice(quote.initialTotal)}/월</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* 월별 금액표 */}
        {quote.showMonthlyTable !== false && (
          <div style={{marginTop:12,marginBottom:8}}>
            <div style={S.tableTitle}>📊 월별 금액표</div>
            <div style={{overflowX:'auto'}}>
              <table style={{...S.quoteTable,fontSize:10}}>
                <thead>
                  <tr style={{background:'#1e3a5f',color:'white'}}>
                    <th style={{...S.qth,textAlign:'left',padding:'5px 6px',minWidth:55}}>구분</th>
                    {detail.map(m=><th key={m.month} style={{...S.qth,padding:'5px 2px',width:38,opacity:m.noWork?0.4:1}}>{m.month}월</th>)}
                    <th style={{...S.qth,background:'#0f2340',padding:'5px 4px',minWidth:50}}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{...S.qtd,fontWeight:'bold',fontSize:10}}>작업횟수</td>
                    {detail.map(m=><td key={m.month} style={{...S.qtdC,fontSize:10,color:m.noWork?'#d1d5db':'#374151',background:m.noWork?'#f9fafb':'transparent'}}>{m.noWork?'-':`${m.visits}회`}</td>)}
                    <td style={{...S.qtdC,fontWeight:'bold',background:'#f8fafc',fontSize:10}}>{detail.reduce((s,m)=>s+m.visits,0)}회</td>
                  </tr>
                  <tr style={{background:'#f0fdf4'}}>
                    <td style={{...S.qtd,fontWeight:'bold',color:'#166534',fontSize:10}}>방제비용</td>
                    {detail.map(m=><td key={m.month} style={{...S.qtdR,fontSize:10,color:m.noWork?'#d1d5db':'#166534',background:m.noWork?'#f9fafb':'transparent'}}>{m.noWork?'-':m.svc>0?(m.svc/10000).toFixed(1)+'만':'-'}</td>)}
                    <td style={{...S.qtdR,fontWeight:'bold',color:'#166534',background:'#f0fdf4',fontSize:10}}>{(annualSvc/10000).toFixed(0)}만원</td>
                  </tr>
                  {trapEnabled && (
                    <tr style={{background:'#fef3c7'}}>
                      <td style={{...S.qtd,fontWeight:'bold',color:'#92400e',fontSize:10}}>🪰 포충기</td>
                      {detail.map(m=><td key={m.month} style={{...S.qtdR,fontSize:10,color:m.noWork?'#d1d5db':'#d97706',background:m.noWork?'#f9fafb':'transparent'}}>{m.noWork?'-':m.trap>0?(m.trap/10000).toFixed(1)+'만':'-'}</td>)}
                      <td style={{...S.qtdR,fontWeight:'bold',color:'#d97706',background:'#fef3c7',fontSize:10}}>{(annualTrap/10000).toFixed(0)}만원</td>
                    </tr>
                  )}
                  <tr style={{background:'#1e3a5f'}}>
                    <td style={{...S.qtd,fontWeight:'bold',color:'white',fontSize:10}}>월 합계</td>
                    {detail.map(m=><td key={m.month} style={{...S.qtdR,color:m.noWork?'#64748b':'#bbf7d0',fontWeight:'bold',fontSize:10}}>{m.noWork?'-':m.total>0?(m.total/10000).toFixed(1)+'만':'-'}</td>)}
                    <td style={{...S.qtdR,fontWeight:'bold',color:'#fbbf24',background:'#0f2340',fontSize:11}}>{(annualAll/10000).toFixed(0)}만원</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 총합계금 */}
        <div style={S.totalBox}>
          <div style={S.totalBoxTitle}>💰 총 합계금</div>
          {quote.hasInitial && initMonths > 0 && (
            <div style={S.totalRow}>
              <span>🚀 초기 1~{initMonths}개월</span>
              <span style={{fontWeight:'bold'}}>{formatPrice(quote.initialTotal)}/월 × {initMonths}개월 = {formatPrice((quote.initialTotal||0)*initMonths)}</span>
            </div>
          )}
          <div style={S.totalRow}>
            <span>📅 정기 {quote.hasInitial&&initMonths>0?`${initMonths+1}개월`:'1개월'}~</span>
            <span style={{fontWeight:'bold'}}>{formatPrice(quote.monthlyTotal)}/월 × {regularMonths}개월 = {formatPrice((quote.monthlyTotal||0)*regularMonths)}</span>
          </div>
          <div style={S.totalFinal}>
            <span style={{color:'white',fontWeight:'bold',fontSize:13}}>📆 기간 총계</span>
            <span style={{color:'#fbbf24',fontWeight:'bold',fontSize:20}}>{formatPrice(annualTotal)}</span>
          </div>
          <div style={{textAlign:'right',fontSize:11,color:'#94a3b8',marginTop:2}}>
            {priceToKorean(annualTotal)} ({periodLabel})
          </div>
        </div>

        {/* 안내 사항 */}
        <div style={S.noticeBox}>
          <div style={S.noticeTitle}>★ 안내 사항</div>
          <div style={S.noticeItem}>• 월 {quote.visitPerMonth}회 정기 작업 기준 견적입니다.</div>
          {quote.hasInitial && <div style={S.noticeItem}>• 초기 {quote.initialMonths}개월은 집중방제 기간으로 {formatPrice(quote.initialTotal)}/월이 적용됩니다.</div>}
          <div style={S.noticeItem}>• 사용 약제는 환경부 허가 제품만 사용합니다.</div>
          <div style={S.noticeItem}>• 작업 후 작업일지 및 사진 보고서를 제출합니다.</div>
          {quote.memo && <div style={S.noticeItem}>• {quote.memo}</div>}
        </div>

        {/* 현장 사진 */}
        {quote.photos?.length > 0 && (
          <div style={{marginTop:14}}>
            <div style={S.tableTitle}>📸 현장 사진</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {quote.photos.map((p,i)=>(
                <img key={i} src={p} alt={`현장${i+1}`} style={{width:120,height:90,objectFit:'cover',borderRadius:4,border:'1px solid #e2e8f0'}} />
              ))}
            </div>
          </div>
        )}

        {/* 서명란 */}
        <div style={S.signRow}>
          <div style={S.signBox}>
            <div style={S.signLabel}>공 급 자</div>
            <div style={{fontSize:14,fontWeight:'bold',color:'#1e3a5f'}}>{companySettings.companyName||'화이트라인'}</div>
            {companySettings.representative && <div style={{fontSize:13,color:'#374151',marginTop:4}}>대표: {companySettings.representative}</div>}
            {companySettings.sealImage
              ? <img src={companySettings.sealImage} alt="직인" style={{width:50,height:50,objectFit:'contain',marginTop:6}} />
              : <div style={{width:50,height:50,border:'1px solid #e2e8f0',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',margin:'6px auto 0',color:'#94a3b8',fontSize:14}}>(인)</div>}
          </div>
          <div style={S.signBox}>
            <div style={S.signLabel}>담 당 자</div>
            <div style={{fontSize:13,color:'#374151',marginTop:4}}>{currentUser?.name||'-'}</div>
            {currentUser?.phone && <div style={{fontSize:11,color:'#666',marginTop:4}}>{currentUser.phone}</div>}
          </div>
        </div>
      </div>
    );
  };

  // ── 여백 콘텐츠 렌더링 ───────────────────────────────────────────────
  const MarginContent = () => (
    <div style={S.marginSection}>
      {/* 서비스 보증 */}
      {marg.guarantee?.on && (
        <div style={S.margCard('#ecfdf5','#059669','#d1fae5')}>
          <div style={S.margTitle}>🛡️ 서비스 보증</div>
          {(marg.guarantee.text||'').split('\n').filter(Boolean).map((line,i)=>(
            <div key={i} style={S.margItem}>✓ {line}</div>
          ))}
        </div>
      )}
      {/* 회사 소개 */}
      {marg.intro?.on && (
        <div style={S.margCard('#eff6ff','#1e40af','#dbeafe')}>
          <div style={S.margTitle}>🏆 회사 소개</div>
          <div style={{...S.margItem,whiteSpace:'pre-wrap'}}>{marg.intro.text||''}</div>
        </div>
      )}
      {/* 주의사항 */}
      {marg.caution?.on && (
        <div style={S.margCard('#fffbeb','#92400e','#fde68a')}>
          <div style={S.margTitle}>⚠️ 주의사항 / 협조사항</div>
          {(marg.caution.text||'').split('\n').filter(Boolean).map((line,i)=>(
            <div key={i} style={S.margItem}>• {line}</div>
          ))}
        </div>
      )}
      {/* 담당자 연락처 */}
      {marg.contact?.on && (
        <div style={S.margCard('#f5f3ff','#6d28d9','#ede9fe')}>
          <div style={S.margTitle}>📞 담당자 연락처</div>
          <div style={{display:'flex',gap:20,flexWrap:'wrap',marginTop:8}}>
            {currentUser?.name && <div style={S.contactItem}><span style={S.contactLabel}>담당자</span><span style={S.contactVal}>{currentUser.name}</span></div>}
            {currentUser?.phone && <div style={S.contactItem}><span style={S.contactLabel}>전화</span><span style={S.contactVal}>{currentUser.phone}</span></div>}
            {currentUser?.email && <div style={S.contactItem}><span style={S.contactLabel}>이메일</span><span style={S.contactVal}>{currentUser.email}</span></div>}
            {companySettings.companyPhone && <div style={S.contactItem}><span style={S.contactLabel}>회사</span><span style={S.contactVal}>{companySettings.companyPhone}</span></div>}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={styles.container}>
      {/* 상단 툴바 */}
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← 뒤로</button>
        <div style={styles.toolbarTitle}>PDF 미리보기</div>
        <div style={{width:60}} />
      </div>

      {/* 페이지 선택 */}
      <div style={styles.pageSelect}>
        <button style={{...styles.pagBtn,...(!showAllPages?styles.pagBtnActive:{})}} onClick={()=>setShowAllPages(false)}>견적서만</button>
        <button style={{...styles.pagBtn,...(showAllPages?styles.pagBtnActive:{})}} onClick={()=>setShowAllPages(true)}>전체 페이지</button>
      </div>

      {/* 공유 버튼 */}
      <div style={styles.shareRow}>
        <button onClick={handleDownloadPDF} style={styles.shareBtn('#1e40af')}>📥 PDF 저장</button>
        <button onClick={handleEmail}       style={styles.shareBtn('#0ea5e9')}>📧 이메일</button>
        <button onClick={handleShare}       style={styles.shareBtn('#f59e0b')}>💬 카카오/문자</button>
        <button onClick={handleCopyLink}    style={styles.shareBtn('#10b981')}>🔗 링크복사</button>
        <button onClick={handleCopyCompareLink} style={styles.shareBtn('#8b5cf6')}>📊 비교링크</button>
      </div>

      {/* ── 미리보기 영역 ── */}
      <div style={styles.previewWrap}>

        {showAllPages ? (
          <>
            {/* 1페이지: 표지 + 서비스 + 계획표 + 여백 */}
            <div style={{marginBottom:8,fontSize:11,color:'#94a3b8',textAlign:'center'}}>— 1페이지 —</div>
            <div ref={page1Ref} style={styles.pdfPage}>
              {/* 표지 */}
              <div style={S.coverPage}>
                <div style={S.coverTop}>
                  {companySettings.companyLogo && companySettings.companyLogo.startsWith('data:image')
                    ? <img src={companySettings.companyLogo} alt="로고" style={S.coverLogo} />
                    : <div style={{fontSize:40}}>📋</div>}
                  <div style={S.coverCompanyName}>{companySettings.companyName||'화이트라인'}</div>
                </div>
                <div style={S.coverTitle}>해충방제 견적서</div>
                <div style={S.coverCust}>{quoteCustomer.custName} 귀중</div>
                <div style={S.coverDate}>{dateStr}</div>
              </div>

              {/* 방제 서비스 내용 */}
              {(() => {
                const sc = quote.serviceContent || {};
                const PEST_LABELS = { cockroach:'바퀴벌레', ant:'개미', fly:'파리', fruitfly:'초파리', bedbug:'빈대', cigarette:'권연벌레', silverfish:'좀벌레', dustlouse:'먼지다듬이', centipede:'그리마', mosquito:'모기', other:'기타해충' };
                const selectedPests = Object.entries(sc.pests||{}).filter(([,v])=>v).map(([k])=>PEST_LABELS[k]).join(', ')||'해충 미선택';
                const rows = [];
                if (sc.showGeneral!==false) {
                  const acts = ['발생 억제 및 통합 해충 관리','해충 모니터링 트랩 설치/점검'];
                  if (sc.includeReport!==false) acts.push('모니터링 보고서 제출');
                  rows.push({ svc:'일반방제', pests:selectedPests, act:acts.join(', ') });
                }
                if (sc.showRodent) {
                  const acts = ['유입경로 조사','밀도 제어'];
                  if (sc.includeRodentBox!==false) acts.push('구서함 설치/관리');
                  rows.push({ svc:'구서방제', pests:'쥐', act:acts.join(', ') });
                }
                if (sc.showDisinfection) rows.push({ svc:'살균소독', pests:'위해균종', act:'계약 구역 내 표면살균 진행' });
                if (!rows.length) return null;
                return (
                  <div style={S.pageSection}>
                    <div style={S.pageSectionTitle}>1. 방제 서비스 내용</div>
                    <table style={S.svcTable}>
                      <thead><tr style={{background:'#1e40af',color:'white'}}>
                        <th style={S.sth}>서비스 항목</th><th style={S.sth}>대상 해충</th><th style={S.sth}>주요 활동</th>
                      </tr></thead>
                      <tbody>{rows.map((r,i)=>(
                        <tr key={i} style={{background:i%2?'#f8fafc':'white'}}>
                          <td style={S.std}>{r.svc}</td><td style={S.std}>{r.pests}</td><td style={S.std}>{r.act}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                );
              })()}

              {/* 월별 작업 계획표 */}
              {(() => {
                const DEFAULT_ROWS = [
                  {key:'bait',label:'보행해충 베이트/트랩'},{key:'outdoor',label:'외곽 잔류분무'},
                  {key:'indoor',label:'내부 잔류분무'},{key:'rodentbox',label:'구서함 점검/트랩교체'},
                  {key:'rodentout',label:'외곽 구서작업'},{key:'disinfect',label:'살균작업(협의)'},
                ];
                const planRows  = quote.planRows || DEFAULT_ROWS.map(r=>({...r,visible:true}));
                const planGrid  = quote.planGrid || {};
                const sc        = quote.serviceContent || {};
                const visRows   = planRows.filter(r=>r.visible!==false).filter(row=>{
                  if ((row.key==='rodentbox'||row.key==='rodentout')&&!sc.showRodent) return false;
                  if (row.key==='disinfect'&&!sc.showDisinfection) return false;
                  return true;
                });
                return (
                  <div style={S.pageSection}>
                    <div style={S.pageSectionTitle}>2. 월별 작업 계획표</div>
                    <table style={S.planTable}>
                      <thead><tr style={{background:'#1e40af',color:'white'}}>
                        <th style={S.planTh}>작업항목</th>
                        {['1','2','3','4','5','6','7','8','9','10','11','12'].map(m=>(
                          <th key={m} style={S.planThSm}>{m}월</th>
                        ))}
                      </tr></thead>
                      <tbody>{visRows.map((row,i)=>{
                        const checks = planGrid[row.key] || Array(12).fill(true);
                        return (
                          <tr key={row.key} style={{background:i%2?'#f8fafc':'white'}}>
                            <td style={S.planTd}>{row.label}</td>
                            {checks.map((checked,m)=>(
                              <td key={m} style={{...S.planTdSm,color:checked?'#10b981':'#e2e8f0',fontWeight:'bold'}}>
                                {checked?'ⓥ':'－'}
                              </td>
                            ))}
                          </tr>
                        );
                      })}</tbody>
                    </table>
                    <div style={S.planNote}>※ 실제 작업일은 고객사와 협의 후 시행</div>
                  </div>
                );
              })()}

              {/* 여백 콘텐츠 */}
              <MarginContent />
            </div>

            {/* 2페이지: 견적서 */}
            <div style={{marginBottom:8,marginTop:16,fontSize:11,color:'#94a3b8',textAlign:'center'}}>— 2페이지 —</div>
            <div ref={page2Ref} style={styles.pdfPage}>
              <QuoteBody showHeader={true} />
            </div>
          </>
        ) : (
          /* 견적서만 */
          <div ref={quoteOnly} style={styles.pdfPage}>
            <QuoteBody showHeader={true} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 스타일 ──────────────────────────────────────────────────────────────
const S = {
  // 표지
  coverPage: { textAlign:'center', padding:'50px 20px 30px', borderBottom:'3px solid #1e3a5f', marginBottom:24 },
  coverTop: { display:'flex', justifyContent:'center', alignItems:'center', gap:14, marginBottom:36 },
  coverLogo: { width:54, height:54, objectFit:'cover', borderRadius:10 },
  coverCompanyName: { fontSize:24, fontWeight:'bold', color:'#1e3a5f' },
  coverTitle: { fontSize:34, fontWeight:'bold', color:'#1e3a5f', marginBottom:18, letterSpacing:10 },
  coverCust: { fontSize:20, color:'#374151', marginBottom:36 },
  coverDate: { fontSize:14, color:'#94a3b8' },
  // 섹션 (1페이지)
  pageSection: { marginBottom:24, paddingBottom:18, borderBottom:'1px solid #e2e8f0' },
  pageSectionTitle: { fontSize:17, fontWeight:'bold', color:'#1e3a5f', marginBottom:10, borderLeft:'4px solid #1e3a5f', paddingLeft:10 },
  svcTable: { width:'100%', borderCollapse:'collapse', fontSize:13 },
  sth: { padding:'9px 10px', textAlign:'left', fontWeight:'bold', border:'1px solid #e2e8f0' },
  std: { padding:'8px 10px', border:'1px solid #e2e8f0', verticalAlign:'top', lineHeight:1.6, fontSize:13 },
  planTable: { width:'100%', borderCollapse:'collapse', fontSize:13 },
  planTh: { padding:'8px 10px', textAlign:'left', border:'1px solid rgba(255,255,255,0.3)' },
  planThSm: { padding:'8px 4px', textAlign:'center', border:'1px solid rgba(255,255,255,0.3)', width:32 },
  planTd: { padding:'7px 10px', border:'1px solid #e2e8f0', fontSize:13 },
  planTdSm: { padding:'7px 4px', textAlign:'center', border:'1px solid #e2e8f0', fontSize:15 },
  planNote: { fontSize:11, color:'#94a3b8', marginTop:6 },
  // 여백 콘텐츠
  marginSection: { marginTop:20, display:'flex', flexDirection:'column', gap:12 },
  margCard: (bg, color, border) => ({ background:bg, border:`1px solid ${border}`, borderRadius:10, padding:'12px 16px' }),
  margTitle: { fontWeight:'bold', fontSize:13, color:'#1e293b', marginBottom:8 },
  margItem: { fontSize:12, color:'#374151', marginBottom:3, lineHeight:1.6 },
  contactItem: { display:'flex', flexDirection:'column', gap:2 },
  contactLabel: { fontSize:10, color:'#94a3b8', fontWeight:'bold' },
  contactVal: { fontSize:13, color:'#1e293b', fontWeight:'bold' },
  // 견적서 본문
  quoteBody: { fontFamily:'Malgun Gothic, Apple SD Gothic Neo, sans-serif' },
  companyHeader: { display:'flex', gap:10, alignItems:'center', marginBottom:4 },
  headerLogo: { width:44, height:44, objectFit:'cover', borderRadius:8 },
  headerCompanyName: { fontSize:17, fontWeight:'bold', color:'#1e3a5f' },
  headerSub: { fontSize:11, color:'#64748b', marginTop:2 },
  quoteTopHeader: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, paddingBottom:12, borderBottom:'2px solid #1e3a5f' },
  quoteTitleBlock: { textAlign:'right' },
  quoteDocTitle: { fontSize:24, fontWeight:'bold', color:'#1e3a5f', letterSpacing:5 },
  quoteLabelBadge: { fontSize:14, fontWeight:700, color:'#1e3a5f', marginLeft:6, letterSpacing:0 },
  quoteDate: { fontSize:12, color:'#64748b', marginTop:4 },
  page2Divider: { display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'2px solid #1e3a5f', paddingBottom:8, marginBottom:14, fontSize:18, fontWeight:'bold', color:'#1e3a5f', letterSpacing:3 },
  infoTable: { width:'100%', borderCollapse:'collapse', marginBottom:14, fontSize:13 },
  infoLabel: { padding:'7px 10px', background:'#1e3a5f', color:'white', fontWeight:'bold', border:'1px solid #1e3a5f', width:80, textAlign:'center' },
  infoVal: { padding:'7px 12px', border:'1px solid #e2e8f0' },
  tableTitle: { fontSize:13, fontWeight:'bold', color:'#1e3a5f', marginBottom:6, marginTop:4 },
  quoteTable: { width:'100%', borderCollapse:'collapse', fontSize:12, marginBottom:6 },
  qth: { padding:8, textAlign:'center', fontWeight:'bold', border:'1px solid rgba(255,255,255,0.3)' },
  qtd: { padding:'7px 8px', border:'1px solid #e2e8f0', verticalAlign:'middle' },
  qtdC: { padding:'7px 8px', border:'1px solid #e2e8f0', textAlign:'center' },
  qtdR: { padding:'7px 8px', border:'1px solid #e2e8f0', textAlign:'right' },
  totalKorean: { textAlign:'right', fontSize:13, fontWeight:'bold', color:'#1e3a5f', marginBottom:8 },
  totalBox: { background:'#1e3a5f', borderRadius:8, padding:'12px 14px', marginTop:12, marginBottom:8 },
  totalBoxTitle: { color:'white', fontWeight:'bold', fontSize:13, marginBottom:8, borderBottom:'1px solid rgba(255,255,255,0.2)', paddingBottom:6 },
  totalRow: { display:'flex', justifyContent:'space-between', fontSize:12, color:'#bbf7d0', marginBottom:4 },
  totalFinal: { borderTop:'1px solid rgba(255,255,255,0.25)', paddingTop:8, marginTop:6, display:'flex', justifyContent:'space-between', alignItems:'center' },
  noticeBox: { background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:6, padding:'10px 12px', marginTop:12 },
  noticeTitle: { fontWeight:'bold', color:'#1e3a5f', fontSize:12, marginBottom:6 },
  noticeItem: { fontSize:11, color:'#374151', marginBottom:3, lineHeight:1.5 },
  signRow: { display:'flex', gap:20, marginTop:20, justifyContent:'flex-end' },
  signBox: { border:'1px solid #e2e8f0', borderRadius:6, padding:'12px 20px', textAlign:'center', minWidth:140 },
  signLabel: { fontSize:11, color:'#94a3b8', marginBottom:6 },
};

const styles = {
  container: { paddingBottom:30 },
  toolbar: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, paddingBottom:12, borderBottom:'1px solid #e2e8f0' },
  backBtn: { background:'none', border:'none', cursor:'pointer', fontSize:14, color:'#3b82f6', fontWeight:'bold', padding:'4px 8px' },
  toolbarTitle: { fontSize:16, fontWeight:'bold', color:'#1e3a5f' },
  pageSelect: { display:'flex', gap:8, marginBottom:10 },
  pagBtn: { flex:1, padding:9, border:'1px solid #ddd', borderRadius:8, background:'#f8fafc', cursor:'pointer', fontSize:13, color:'#666' },
  pagBtnActive: { background:'#1e40af', color:'white', border:'1px solid #1e40af', fontWeight:'bold' },
  shareRow: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6, marginBottom:14 },
  shareBtn: (bg) => ({ padding:'11px 4px', background:bg, color:'white', border:'none', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:'bold', whiteSpace:'nowrap', textAlign:'center' }),
  previewWrap: { border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden', background:'#f1f5f9', padding:8 },
  pdfPage: { background:'white', padding:'24px 28px', maxWidth:794, margin:'0 auto', fontFamily:'Malgun Gothic, Apple SD Gothic Neo, sans-serif' },
};

export default QuotePDFTemplate;
