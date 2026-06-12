import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatPrice, priceToKorean, SERVICE_ITEMS, BUSINESS_TYPES } from './quoteConstants';
import { shareOrDownloadPdf } from '../../utils/certPdfSender';

function QuotePublicView({ quoteId }) {
  const [quote, setQuote]               = useState(null);
  const [customer, setCustomer]         = useState(null);
  const [settings, setSettings]         = useState({});
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [localQuote, setLocalQuote]     = useState(null); // 고객 편집 상태
  const [customZones, setCustomZones]   = useState([]);   // 추가 요청 구획
  const [requestSent, setRequestSent]   = useState(false);
  const [refreshing, setRefreshing]     = useState(false);
  const [staffContact, setStaffContact] = useState(null);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [qnaList, setQnaList] = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCategory, setRejectCategory] = useState('');
  const [contractRequested, setContractRequested] = useState(false);
  const printRef                        = useRef();

  useEffect(() => { fetchData(); }, [quoteId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 모든 데이터를 먼저 수집한 다음 한꺼번에 상태 업데이트 (깜빡임 방지)
      const qDoc = await getDoc(doc(db, 'quotes', quoteId));
      if (!qDoc.exists()) {
        setError('견적서를 찾을 수 없습니다.');
        setLoading(false);
        return;
      }
      const qData = { id: qDoc.id, ...qDoc.data() };

      // 견적고객 로드
      let cData = null;
      if (qData.quoteCustomerId) {
        try {
          const cDoc = await getDoc(doc(db, 'quoteCustomers', qData.quoteCustomerId));
          if (cDoc.exists()) cData = { id: cDoc.id, ...cDoc.data() };
        } catch (e) { console.error('견적고객 정보 로드 오류:', e); }
      }

      // 설정 로드
      let sData = {};
      try {
        const sSnap = await getDocs(collection(db, 'settings'));
        if (sSnap.docs.length > 0) sData = sSnap.docs[0].data();
      } catch (e) { console.error('설정 로드 오류:', e); }

      // 담당자 전화번호 로드
      let scData = null;
      if (qData.createdBy) {
        try {
          const staffSnap = await getDocs(collection(db, 'staff'));
          const staffDoc = staffSnap.docs.find(d => d.data().name === qData.createdBy);
          if (staffDoc) {
            const sd = staffDoc.data();
            scData = {
              name: sd.name || qData.createdBy,
              phone: sd.phone || '',
              email: sd.email || '',
              custName: qData.custName || '',
            };
          }
        } catch (e) { console.error('담당자 정보 로드 오류:', e); }
      }

      // QnA 로드
      let qnaData = [];
      try {
        const qnaSnap = await getDocs(collection(db, 'quoteQnA'));
        qnaData = qnaSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(q => q.quoteId === quoteId)
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      } catch (e) { console.error('Q&A 로드 오류:', e); }

      // 모든 데이터 수집 완료 후 한번에 상태 업데이트
      setQuote(qData);
      setLocalQuote(JSON.parse(JSON.stringify(qData)));
      if (cData) setCustomer(cData);
      setSettings(sData);
      if (scData) setStaffContact(scData);
      setQnaList(qnaData);

      // 열람 확인 기록 (최초 1회)
      if (!qData.viewedAt) {
        try {
          await updateDoc(doc(db, 'quotes', quoteId), {
            viewedAt: new Date().toISOString(),
            status: qData.status === 'sent' ? 'viewed' : qData.status,
          });
        } catch (e) { console.error('견적 열람 기록 오류:', e); }
      }

    } catch (e) {
      setError('데이터 로드 중 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // 고객이 재견적 요청
  const handleReQuoteRequest = async () => {
    if (!quote) return;
    try {
      const custName = quote.custName || customer?.custName || '고객';
      const staffName = quote.createdBy || '';
      const now = new Date().toISOString();

      // 1. 견적서에 고객 수정사항 + 재견적 요청 저장
      await updateDoc(doc(db, 'quotes', quoteId), {
        customerEdits: localQuote,
        reQuoteRequest: {
          requestedAt: now,
          status: 'pending',
          customZones,
          message: '고객 요청: 구획 추가 및 견적 수정 요청',
        },
      });

      // 2. 앱 내 알림 저장 (담당자가 앱에서 확인)
      await addDoc(collection(db, 'notifications'), {
        type: 'reQuoteRequest',
        quoteId,
        custName,
        message: `${custName}님이 재견적을 요청했습니다.`,
        createdAt: now,
        read: false,
      });

      // 3. 담당자 연락처 조회 (staff 컬렉션에서 이름으로 검색)
      let staffPhone = '';
      let staffEmail = '';
      try {
        const staffSnap = await getDocs(collection(db, 'staff'));
        const staffDoc = staffSnap.docs.find(d => d.data().name === staffName);
        if (staffDoc) {
          staffPhone = staffDoc.data().phone || '';
          staffEmail = staffDoc.data().email || '';
        }
      } catch (e) { console.error('담당자 연락처 로드 오류:', e); }

      setRequestSent(true);
      setStaffContact({ phone: staffPhone, email: staffEmail, name: staffName, custName });
      setShowNotifyModal(true);

    } catch (e) {
      alert('요청 전송에 실패했습니다. 다시 시도해주세요.');
    }
  };

  // 알림 모달 닫기
  const handleCloseNotify = () => setShowNotifyModal(false);

  // 견적 승인
  const handleApprove = async () => {
    try {
      await updateDoc(doc(db, 'quotes', quoteId), {
        status: 'approved',
        approvedAt: new Date().toISOString(),
      });
      await addDoc(collection(db, 'notifications'), {
        type: 'quoteApproved',
        quoteId,
        custName: quote.custName || customer?.custName || '고객',
        message: `${quote.custName || '고객'}님이 견적을 승인했습니다!`,
        createdAt: new Date().toISOString(),
        read: false,
      });
      setQuote(q => ({ ...q, status: 'approved', approvedAt: new Date().toISOString() }));
      setShowApproveModal(false);
      alert('견적을 승인했습니다. 담당자가 연락드릴 예정입니다.');
    } catch (e) { alert('오류가 발생했습니다.'); }
  };

  // 견적 거절
  const handleReject = async () => {
    if (!rejectCategory) { alert('거절 사유를 선택해주세요.'); return; }
    const finalReason = rejectCategory === 'direct' ? rejectReason : 
      { price:'금액 문제', other:'타업체 계약', timing:'시기상조', review:'내부 검토 중', scope:'서비스 범위' }[rejectCategory];
    try {
      await updateDoc(doc(db, 'quotes', quoteId), {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        rejectedReason: finalReason,
        rejectedCategory: rejectCategory,
      });
      await addDoc(collection(db, 'notifications'), {
        type: 'quoteRejected',
        quoteId,
        custName: quote.custName || customer?.custName || '고객',
        message: `${quote.custName || '고객'}님이 견적을 거절했습니다. 사유: ${finalReason}`,
        createdAt: new Date().toISOString(),
        read: false,
      });
      setQuote(q => ({ ...q, status: 'rejected', rejectedReason: finalReason }));
      setShowRejectModal(false);
      alert('거절 의사를 전달했습니다. 담당자가 확인 후 연락드릴 수 있습니다.');
    } catch (e) { alert('오류가 발생했습니다.'); }
  };

  // 계약 전환 요청
  const handleContractRequest = async () => {
    try {
      await updateDoc(doc(db, 'quotes', quoteId), {
        status: 'contracted',
        contractRequestedAt: new Date().toISOString(),
      });
      await addDoc(collection(db, 'notifications'), {
        type: 'contractRequest',
        quoteId,
        custName: quote.custName || customer?.custName || '고객',
        message: `🎉 ${quote.custName || '고객'}님이 계약을 요청했습니다!`,
        createdAt: new Date().toISOString(),
        read: false,
      });
      setContractRequested(true);
      setQuote(q => ({ ...q, status: 'contracted' }));
    } catch (e) { alert('오류가 발생했습니다.'); }
  };

  // Q&A 질문 등록
  const handleSubmitQuestion = async () => {
    if (!newQuestion.trim()) return;
    try {
      const newDoc = await addDoc(collection(db, 'quoteQnA'), {
        quoteId,
        question: newQuestion.trim(),
        answer: null,
        createdAt: new Date().toISOString(),
        custName: quote.custName || customer?.custName || '고객',
      });
      await addDoc(collection(db, 'notifications'), {
        type: 'quoteQuestion',
        quoteId,
        custName: quote.custName || '고객',
        message: `${quote.custName || '고객'}님이 질문을 남겼습니다: "${newQuestion.trim()}"`,
        createdAt: new Date().toISOString(),
        read: false,
      });
      setQnaList(prev => [...prev, {
        id: newDoc.id, quoteId, question: newQuestion.trim(),
        answer: null, createdAt: new Date().toISOString(),
      }]);
      setNewQuestion('');
    } catch (e) { alert('질문 등록에 실패했습니다.'); }
  };

  // PDF 인쇄
  const handlePrint = () => { window.print(); };

  // PDF 다운로드 (스마트폰: 공유시트 / PC: 다운로드)
  const handleDownloadPDF = async () => {
    const Swal = (await import('sweetalert2')).default;
    Swal.fire({ title: 'PDF 생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData  = canvas.toDataURL('image/png');
      const pdf      = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = pdfHeight, position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= 297;
      while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= 297;
      }
      const custName = quote?.custName || '고객';
      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
      const fileName = `견적서_${custName}_${dateStr}.pdf`;
      const pdfBlob = pdf.output('blob');
      Swal.close();
      await shareOrDownloadPdf(pdfBlob, fileName);
    } catch (e) {
      Swal.fire('오류', 'PDF 생성 실패: ' + e.message, 'error');
    }
  };

  if (loading) return (
    <div style={ps.loadingWrap}>
      <div style={ps.spinner} />
      <div style={{ color: '#64748b', marginTop: '16px' }}>견적서를 불러오는 중...</div>
    </div>
  );

  if (error) return (
    <div style={ps.errorWrap}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>😢</div>
      <div style={{ color: '#ef4444', fontWeight: 'bold' }}>{error}</div>
    </div>
  );

  if (!quote || !localQuote) return null;

  const ls = quote.linkSettings || {};
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  const calcMonthly = (q) => {
    const svc = (q.services||[]).reduce((s,x)=>s+(parseFloat(x.totalPrice)||0),0);
    const zone = (q.zoneServices||[]).filter(z=>z.include).reduce((s,z)=>s+(parseFloat(z.totalPrice)||0),0);
    const trap = q.insectTrap?.enabled ? (parseFloat(q.insectTrap?.totalPrice)||0) : 0;
    return svc + zone + trap;
  };

  const monthly = calcMonthly(localQuote);
  const im = localQuote.hasInitial ? (localQuote.initialMonths || 2) : 0;
  // periodSpecific 반영 기간 총계
  const hasSpecificPeriod = localQuote.periodType === 'specific' && (localQuote.periodSpecific||[]).length > 0;
  const workMonthCount = hasSpecificPeriod ? localQuote.periodSpecific.length : 12;
  const initMonths     = hasSpecificPeriod ? Math.min(im, workMonthCount) : im;
  const regularMonths  = workMonthCount - initMonths;
  const annualTotal    = initMonths * (localQuote.initialTotal || 0) + regularMonths * monthly;
  const periodLabel    = hasSpecificPeriod
    ? `${[...localQuote.periodSpecific].sort((a,b)=>a-b).join('·')}월 / ${workMonthCount}개월`
    : '연간 12개월';

  const getServiceLabel = (type) => SERVICE_ITEMS.find(s => s.value === type)?.label || type;

  // 전화번호 포맷 (하이픈 추가)
  const formatPhone = (phone) => {
    if (!phone) return '';
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length === 11) return clean.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    if (clean.length === 10) return clean.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
    if (clean.startsWith('02') && clean.length === 9) return clean.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
    if (clean.startsWith('02') && clean.length === 10) return clean.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
    return phone;
  };

  // 알림 메시지 생성
  const makeNotifyMsg = () => {
    if (!staffContact) return '';
    const custName = staffContact.custName || '고객';
    const link = `${window.location.origin}/quote-view/${quoteId}`;
    return `[화이트라인 재견적 요청]\n${custName}님이 재견적을 요청했습니다.\n\n견적서 확인: ${link}`;
  };

  return (
    <div style={ps.page}>
      {/* 상단 툴바 */}
      <div style={ps.toolbar} className="no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />}
          <span style={{ fontWeight: 'bold', color: '#1e3a5f' }}>{settings.companyName || '화이트라인'}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleRefresh} style={ps.toolBtn('#64748b')} disabled={refreshing}>
            {refreshing ? '⏳' : '🔄'}
          </button>
          <button onClick={handleDownloadPDF} style={ps.toolBtn('#0ea5e9')}>📥 PDF</button>
          <button onClick={handlePrint} style={ps.toolBtn('#1e40af')}>🖨️ 인쇄</button>
        </div>
      </div>

      {/* 견적 수락 버튼 — 상단 고정 (미승인 상태일 때만) */}
      {quote?.status !== 'approved' && quote?.status !== 'rejected' && quote?.status !== 'contracted' && !contractRequested && (() => {
        const isExpired = quote?.validityDays && quote?.createdAt &&
          (new Date() - new Date(quote.createdAt)) / 86400000 > quote.validityDays;
        if (isExpired) return null;
        return (
          <div style={ps.acceptBanner} className="no-print">
            <div style={{ fontSize: '13px', color: '#065f46', fontWeight: 'bold' }}>
              이 견적서에 동의하시면 아래 버튼을 눌러주세요
            </div>
            <button
              onClick={() => setShowApproveModal(true)}
              style={ps.acceptBtn}
            >
              ✅ 견적 수락
            </button>
          </div>
        );
      })()}

      {/* 재견적 요청 완료 배너 */}
      {requestSent && (
        <div style={ps.successBanner} className="no-print">
          ✅ 재견적 요청이 담당자에게 전송되었습니다. 담당자가 견적을 수정한 후 이 페이지에서 확인하실 수 있습니다.
        </div>
      )}

      {/* 대기 중인 재견적 요청 배너 */}
      {quote.reQuoteRequest?.status === 'pending' && !requestSent && (
        <div style={{ ...ps.successBanner, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }} className="no-print">
          ⏳ 재견적 요청 검토 중입니다. 담당자가 완료하면 여기서 확인하실 수 있습니다.
        </div>
      )}

      {/* 견적서 본문 */}
      <div ref={printRef} style={ps.doc}>
        {/* 헤더 */}
        <div style={ps.docHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={{ width: '44px', height: '44px', borderRadius: '6px', objectFit: 'cover' }} />}
            <div>
              <div style={{ fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f' }}>{settings.companyName || '화이트라인'}</div>
              {settings.companyAddress && <div style={{ fontSize: '11px', color: '#64748b' }}>{settings.companyAddress}</div>}
              {settings.companyPhone && <div style={{ fontSize: '11px', color: '#64748b' }}>Tel: {formatPhone(settings.companyPhone)}</div>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#1e3a5f', letterSpacing: '4px' }}>견 적 서</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{dateStr}</div>
          </div>
        </div>

        {/* 고객 정보 */}
        <table style={ps.infoTable}>
          <tbody>
            <tr>
              <td style={ps.infoLabel}>시 설 명</td>
              <td style={ps.infoVal}>{quote.custName || customer?.custName}</td>
              <td style={ps.infoLabel}>담 당 자</td>
              <td style={ps.infoVal}>{quote.createdBy || '-'}</td>
            </tr>
            <tr>
              <td style={ps.infoLabel}>주 소</td>
              <td style={ps.infoVal} colSpan={3}>{customer?.address || '-'}</td>
            </tr>
            {(customer?.area || customer?.businessType) && (
              <tr>
                <td style={ps.infoLabel}>면 적</td>
                <td style={ps.infoVal}>{customer?.area ? `${customer.area}평` : '-'}</td>
                <td style={ps.infoLabel}>연 락 처</td>
                <td style={ps.infoVal}>{customer?.phone ? formatPhone(customer.phone) : '-'}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 1. 방제 서비스 내용 */}
        {(() => {
          const sc = quote.serviceContent || {};
          const PEST_LABELS = {
            cockroach:'바퀴벌레', ant:'개미', fly:'파리', fruitfly:'초파리',
            bedbug:'빈대', cigarette:'권연벌레', silverfish:'좀벌레',
            dustlouse:'먼지다듬이', centipede:'그리마', mosquito:'모기', other:'기타해충'
          };
          const selectedPests = Object.entries(sc.pests||{}).filter(([,v])=>v).map(([k])=>PEST_LABELS[k]).join(', ') || '';
          const rows = [];
          if (sc.showGeneral !== false) {
            const acts = ['발생 억제 및 통합 해충 관리','해충 모니터링 트랩 설치/점검'];
            if (sc.includeReport !== false) acts.push('모니터링 보고서 제출');
            rows.push({ svc:'일반방제', pests: selectedPests || '보행해충', act: acts.join(', ') });
          }
          if (sc.showRodent) {
            const acts = ['유입경로 조사','밀도 제어'];
            if (sc.includeRodentBox !== false) acts.push('구서함 설치/관리');
            rows.push({ svc:'구서방제', pests:'쥐', act: acts.join(', ') });
          }
          if (sc.showDisinfection) rows.push({ svc:'살균소독', pests:'위해균종', act:'계약 구역 내 표면살균 진행' });
          if (rows.length === 0) return null;
          return (
            <div style={{ marginBottom: '16px' }}>
              <div style={ps.sectionTitle}>1. 방제 서비스 내용</div>
              <table style={ps.quoteTable}>
                <thead>
                  <tr style={{ background:'#1e40af', color:'white' }}>
                    <th style={{ ...ps.qth, textAlign:'left', width:'100px' }}>서비스 항목</th>
                    <th style={{ ...ps.qth, textAlign:'left', width:'120px' }}>대상 해충</th>
                    <th style={{ ...ps.qth, textAlign:'left' }}>주요 활동</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r,i)=>(
                    <tr key={i} style={{ background: i%2?'#f8fafc':'white' }}>
                      <td style={ps.qtd}>{r.svc}</td>
                      <td style={ps.qtd}>{r.pests}</td>
                      <td style={ps.qtd}>{r.act}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* 2. 월별 작업 계획표 */}
        {(() => {
          const DEFAULT_ROWS = [
            { key:'bait', label:'보행해충 베이트/트랩' }, { key:'outdoor', label:'외곽 잔류분무' },
            { key:'indoor', label:'내부 잔류분무' }, { key:'rodentbox', label:'구서함 점검/트랩교체' },
            { key:'rodentout', label:'외곽 구서작업' }, { key:'disinfect', label:'살균작업(협의)' },
          ];
          const planRows = (quote.planRows || DEFAULT_ROWS.map(r=>({...r, visible:true}))).filter(r => r.visible !== false);
          const planGrid = quote.planGrid || {};
          const sc = quote.serviceContent || {};
          const visibleRows = planRows.filter(row => {
            if ((row.key==='rodentbox'||row.key==='rodentout') && !sc.showRodent) return false;
            if (row.key==='disinfect' && !sc.showDisinfection) return false;
            return true;
          });
          const trapGrid = planGrid.insectTrap || Array(12).fill(true);
          return (
            <div style={{ marginBottom: '16px' }}>
              <div style={ps.sectionTitle}>2. 월별 작업 계획표</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ ...ps.quoteTable, fontSize:'11px' }}>
                  <thead>
                    <tr style={{ background:'#1e40af', color:'white' }}>
                      <th style={{ ...ps.qth, textAlign:'left', minWidth:'110px' }}>작업항목</th>
                      {['1','2','3','4','5','6','7','8','9','10','11','12'].map(m=>(
                        <th key={m} style={{ ...ps.qth, width:'28px', padding:'5px 2px' }}>{m}월</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row,i)=>{
                      const checks = planGrid[row.key] || Array(12).fill(true);
                      return (
                        <tr key={row.key} style={{ background: i%2?'#f8fafc':'white' }}>
                          <td style={{ ...ps.qtd, fontSize:'11px' }}>{row.label}</td>
                          {checks.map((c,m)=>(
                            <td key={m} style={{ ...ps.qtdC, fontSize:'11px', color: c?'#10b981':'#e2e8f0', fontWeight:'bold' }}>{c?'ⓥ':'－'}</td>
                          ))}
                        </tr>
                      );
                    })}
                    {quote.insectTrap?.enabled && (
                      <tr style={{ background:'#fef3c7' }}>
                        <td style={{ ...ps.qtd, fontSize:'11px', color:'#92400e', fontWeight:'bold' }}>🪰 포충기 관리</td>
                        {trapGrid.map((c,m)=>(
                          <td key={m} style={{ ...ps.qtdC, fontSize:'11px', color: c?'#d97706':'#e2e8f0', fontWeight:'bold' }}>{c?'ⓥ':'－'}</td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'4px' }}>※ 실제 작업일은 고객사와 협의 후 시행</div>
            </div>
          );
        })()}


        {/* 정기 서비스 견적 표 */}
        <div style={ps.tableTitle}>📅 정기 서비스 견적 (월 {localQuote.visitPerMonth}회 기준)</div>
        <table style={ps.quoteTable}>
          <thead>
            <tr style={{ background: '#1e3a5f', color: 'white' }}>
              <th style={ps.qth}>작업내용</th>
              <th style={ps.qth}>구획/수량</th>
              <th style={ps.qth}>단가</th>
              <th style={ps.qth}>금액</th>
            </tr>
          </thead>
          <tbody>
            {(localQuote.services||[]).map((s,i) => (
              <tr key={i} style={{ background: i%2?'#f8fafc':'white' }}>
                <td style={ps.qtd}>{getServiceLabel(s.serviceType)}</td>
                <td style={ps.qtdC}>{s.unitCount ? `${s.unitCount}호실` : (customer?.area ? `${customer.area}평` : '-')}</td>
                <td style={ps.qtdR}>{formatPrice(s.pricePerUnit)}</td>
                <td style={{ ...ps.qtdR, fontWeight: 'bold' }}>{formatPrice(s.totalPrice)}</td>
              </tr>
            ))}

            {/* 구획별 항목 */}
            {(localQuote.zoneServices||[]).filter(z=>z.include).map((z,i) => (
              <tr key={`zone-${i}`} style={{ background: i%2===0?'#f8fafc':'white' }}>
                <td style={ps.qtd}>{z.zoneIcon} {z.zoneLabel}</td>
                <td style={ps.qtdC}>{z.count}개</td>
                <td style={ps.qtdR}>{formatPrice(z.unitPrice)}</td>
                <td style={{ ...ps.qtdR, fontWeight: 'bold' }}>{formatPrice(z.totalPrice)}</td>
              </tr>
            ))}

            {/* 포충기 */}
            {localQuote.insectTrap?.enabled && (
              <tr style={{ background: '#fef3c7' }}>
                <td style={ps.qtd}>
                  🪰 포충기 설치
                  {/* 고객이 포충기 끄기 허용 */}
                  {ls.allowTrapToggle && (
                    <button onClick={() => setLocalQuote(q => ({ ...q, insectTrap: { ...q.insectTrap, enabled: false }}))}
                      style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '4px', cursor: 'pointer' }} className="no-print">
                      제외
                    </button>
                  )}
                </td>
                <td style={ps.qtdC}>{localQuote.insectTrap.count}대<br/><span style={{fontSize:'10px',color:'#92400e'}}>{(localQuote.insectTrap.locations||[]).join(', ')}</span></td>
                <td style={ps.qtdR}>{formatPrice(localQuote.insectTrap.unitPrice)}</td>
                <td style={{ ...ps.qtdR, fontWeight: 'bold', color: '#d97706' }}>{formatPrice(localQuote.insectTrap.totalPrice)}</td>
              </tr>
            )}

            {/* 포충기 OFF 상태에서 추가 버튼 */}
            {!localQuote.insectTrap?.enabled && quote.insectTrap?.enabled && ls.allowTrapToggle && (
              <tr className="no-print">
                <td colSpan={4} style={{ padding: '8px', textAlign: 'center' }}>
                  <button onClick={() => setLocalQuote(q => ({ ...q, insectTrap: { ...q.insectTrap, ...quote.insectTrap, enabled: true }}))}
                    style={{ padding: '6px 16px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                    🪰 포충기 포함하기
                  </button>
                </td>
              </tr>
            )}

            <tr style={{ background: '#1e3a5f', color: 'white' }}>
              <td colSpan={3} style={{ ...ps.qtd, fontWeight: 'bold' }}>월 합계</td>
              <td style={{ ...ps.qtdR, fontWeight: 'bold', fontSize: '16px' }}>{formatPrice(monthly)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '8px' }}>
          합계금: {priceToKorean(monthly)} / 월 {localQuote.visitPerMonth}회
        </div>

        {/* 초기비용 */}
        {localQuote.hasInitial && (
          <>
            <div style={{ ...ps.tableTitle, color: '#d97706', marginTop: '12px' }}>
              🚀 초기 서비스 (처음 {localQuote.initialMonths}개월, 월 {localQuote.initialVisitsPerMonth}회)
            </div>
            <table style={ps.quoteTable}>
              <thead>
                <tr style={{ background: '#92400e', color: 'white' }}>
                  <th style={ps.qth}>항목</th>
                  <th style={ps.qth}>내용</th>
                  <th style={ps.qth}>금액</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: '#fef3c7' }}>
                  <td style={{ ...ps.qtd, fontWeight: 'bold', color: '#92400e' }} colSpan={2}>
                    초기 {localQuote.initialMonths}개월 월 합계
                  </td>
                  <td style={{ ...ps.qtdR, fontWeight: 'bold', color: '#d97706', fontSize: '15px' }}>
                    {formatPrice(localQuote.initialTotal)}/월
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* 월별 금액표 */}
        {quote.showMonthlyTable !== false && (() => {
          const baseVisits = localQuote.visitPerMonth || 1;
          const serviceUnitPrice = (localQuote.services||[]).reduce((s,x)=>s+(parseFloat(x.pricePerUnit)||0),0);
          const zoneBase = (localQuote.zoneServices||[]).filter(z=>z.include).reduce((s,z)=>s+(parseFloat(z.totalPrice)||0),0);
          const trapEnabled = localQuote.insectTrap?.enabled;
          const trapUnitPrice = (parseFloat(localQuote.insectTrap?.unitPrice)||0)*(localQuote.insectTrap?.count||1);
          const trapGrid = localQuote.planGrid?.insectTrap || Array(12).fill(true);
          const monthlyVisits = localQuote.monthlyVisits || Array(12).fill(null);
          const monthlyVisitPriceChange = localQuote.monthlyVisitPriceChange || Array(12).fill(false);
          const detail = Array.from({length:12},(_,i)=>{
            const isWorkMonth = !hasSpecificPeriod || (localQuote.periodSpecific||[]).includes(i+1);
            if (!isWorkMonth) return { month:i+1, visits:0, svc:0, trap:0, total:0, noWork:true };
            const visits = monthlyVisits[i]!==null ? monthlyVisits[i] : baseVisits;
            const svc = monthlyVisitPriceChange[i] ? serviceUnitPrice*visits+zoneBase : serviceUnitPrice*baseVisits+zoneBase;
            const trap = trapEnabled && trapGrid[i] ? trapUnitPrice : 0;
            return { month:i+1, visits, svc, trap, total:svc+trap, noWork:false };
          });
          const annualSvc = detail.reduce((s,m)=>s+m.svc,0);
          const annualTrap = detail.reduce((s,m)=>s+m.trap,0);
          const annualAll = annualSvc+annualTrap;
          return (
            <div style={{ marginBottom:'14px' }}>
              <div style={{ fontSize:'13px', fontWeight:'bold', color:'#1e3a5f', marginBottom:'6px' }}>📊 월별 금액표</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ ...ps.quoteTable, fontSize:'10px' }}>
                  <thead>
                    <tr style={{ background:'#1e3a5f', color:'white' }}>
                      <th style={{ ...ps.qth, textAlign:'left', padding:'5px 6px', minWidth:'55px' }}>구분</th>
                      {detail.map(m=><th key={m.month} style={{ ...ps.qth, padding:'5px 2px', width:'36px', opacity: m.noWork ? 0.4 : 1 }}>{m.month}월</th>)}
                      <th style={{ ...ps.qth, background:'#0f2340', padding:'5px 4px', minWidth:'50px' }}>합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ ...ps.qtd, fontWeight:'bold', fontSize:'10px' }}>작업횟수</td>
                      {detail.map(m=><td key={m.month} style={{ ...ps.qtdC, fontSize:'10px', color: m.noWork ? '#d1d5db' : (monthlyVisits||[])[m.month-1]!==null?'#1e40af':'#374151', fontWeight:(monthlyVisits||[])[m.month-1]!==null?'bold':'normal', background: m.noWork?'#f9fafb':'transparent' }}>{m.noWork ? '-' : `${m.visits}회`}</td>)}
                      <td style={{ ...ps.qtdC, fontWeight:'bold', background:'#f8fafc', fontSize:'10px' }}>{detail.reduce((s,m)=>s+m.visits,0)}회</td>
                    </tr>
                    <tr style={{ background:'#f0fdf4' }}>
                      <td style={{ ...ps.qtd, fontWeight:'bold', color:'#166534', fontSize:'10px' }}>방제비용</td>
                      {detail.map(m=><td key={m.month} style={{ ...ps.qtdR, fontSize:'10px', color: m.noWork?'#d1d5db':'#166534', background: m.noWork?'#f9fafb':'transparent' }}>{m.noWork ? '-' : m.svc>0?(m.svc/10000).toFixed(1)+'만':'-'}</td>)}
                      <td style={{ ...ps.qtdR, fontWeight:'bold', color:'#166634', background:'#f0fdf4', fontSize:'10px' }}>{(annualSvc/10000).toFixed(0)}만원</td>
                    </tr>
                    {trapEnabled && (
                      <tr style={{ background:'#fef3c7' }}>
                        <td style={{ ...ps.qtd, fontWeight:'bold', color:'#92400e', fontSize:'10px' }}>🪰 포충기</td>
                        {detail.map(m=><td key={m.month} style={{ ...ps.qtdR, fontSize:'10px', color: m.noWork?'#d1d5db':'#d97706', background: m.noWork?'#f9fafb':'transparent' }}>{m.noWork ? '-' : m.trap>0?(m.trap/10000).toFixed(1)+'만':'-'}</td>)}
                        <td style={{ ...ps.qtdR, fontWeight:'bold', color:'#d97706', background:'#fef3c7', fontSize:'10px' }}>{(annualTrap/10000).toFixed(0)}만원</td>
                      </tr>
                    )}
                    <tr style={{ background:'#1e3a5f' }}>
                      <td style={{ ...ps.qtd, fontWeight:'bold', color:'white', fontSize:'10px' }}>월 합계</td>
                      {detail.map(m=><td key={m.month} style={{ ...ps.qtdR, color:'#bbf7d0', fontWeight:'bold', fontSize:'10px' }}>{m.total>0?(m.total/10000).toFixed(1)+'만':'-'}</td>)}
                      <td style={{ ...ps.qtdR, fontWeight:'bold', color:'#fbbf24', background:'#0f2340', fontSize:'11px' }}>{(annualAll/10000).toFixed(0)}만원</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* 총합계금 */}
        <div style={ps.totalBox}>
          <div style={{ color: 'white', fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' }}>💰 총 합계금</div>
          {localQuote.hasInitial && initMonths > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#fde68a', marginBottom: '6px' }}>
              <span>🚀 초기 1~{initMonths}개월</span>
              <span style={{ fontWeight: 'bold' }}>{formatPrice(localQuote.initialTotal)}/월 × {initMonths}개월 = {formatPrice((localQuote.initialTotal||0)*initMonths)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#bbf7d0', marginBottom: '6px' }}>
            <span>📅 정기 {localQuote.hasInitial && initMonths > 0 ? `${initMonths+1}개월` : '1개월'}~</span>
            <span style={{ fontWeight: 'bold' }}>{formatPrice(monthly)}/월 × {regularMonths}개월 = {formatPrice(monthly*regularMonths)}</span>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.25)', paddingTop: '10px', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'white', fontWeight: 'bold' }}>📆 기간 총계</span>
            <span style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '22px' }}>{formatPrice(annualTotal)}</span>
          </div>
          <div style={{ textAlign: 'right', fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{priceToKorean(annualTotal)} ({periodLabel})</div>
        </div>

        {/* 안내 사항 */}
        <div style={ps.noticeBox}>
          <div style={{ fontWeight: 'bold', color: '#1e3a5f', fontSize: '12px', marginBottom: '6px' }}>★ 안내 사항</div>
          <div style={ps.noticeItem}>• 월 {localQuote.visitPerMonth}회 정기 작업 기준 견적입니다.</div>
          {localQuote.hasInitial && <div style={ps.noticeItem}>• 초기 {localQuote.initialMonths}개월은 집중방제 기간으로 {formatPrice(localQuote.initialTotal)}/월이 적용됩니다.</div>}
          <div style={ps.noticeItem}>• 사용 약제는 환경부 허가 제품만 사용합니다.</div>
          <div style={ps.noticeItem}>• 작업 후 작업일지 및 사진 보고서를 제출합니다.</div>
          {localQuote.memo && <div style={ps.noticeItem}>• {localQuote.memo}</div>}
        </div>

        {/* 서명란 */}
        <div style={ps.signRow}>
          <div style={ps.signBox}>
            <div style={ps.signLabel}>공 급 자</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#1e3a5f' }}>{settings.companyName || '화이트라인'}</div>
            {settings.representative && <div style={{ fontSize: '12px', color: '#374151', marginTop: '4px' }}>대표: {settings.representative}</div>}
            {settings.sealImage ? (
              <img src={settings.sealImage} alt="직인" style={{ width: '50px', height: '50px', objectFit: 'contain', marginTop: '6px' }} />
            ) : (
              <div style={{ width: '50px', height: '50px', border: '1px solid #e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px auto 0', color: '#94a3b8' }}>(인)</div>
            )}
          </div>
          <div style={ps.signBox}>
            <div style={ps.signLabel}>담 당 자</div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e3a5f' }}>{quote.createdBy || '-'}</div>
            {(staffContact?.phone || settings.companyPhone) && (
              <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                {formatPhone(staffContact?.phone || settings.companyPhone)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 승인/거절/계약 전환 액션 패널 */}
      {(() => {
        const isExpired = quote.validityDays && quote.createdAt &&
          (new Date() - new Date(quote.createdAt)) / 86400000 > quote.validityDays;
        const isApproved = quote.status === 'approved';
        const isRejected = quote.status === 'rejected';
        const isContracted = quote.status === 'contracted';

        if (contractRequested || isContracted) return (
          <div style={{ ...ps.editPanel, border: '2px solid #10b981' }} className="no-print">
            <div style={{ textAlign: 'center', padding: '10px' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#10b981' }}>계약 요청이 전달되었습니다!</div>
              <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>담당자가 확인 후 계약서를 준비해 연락드립니다.</div>
            </div>
          </div>
        );

        if (isExpired) return (
          <div style={{ ...ps.editPanel, border: '2px solid #ef4444', background: '#fef2f2' }} className="no-print">
            <div style={{ textAlign: 'center', color: '#ef4444', fontWeight: 'bold' }}>
              ⏰ 이 견적서의 유효기간이 만료되었습니다.<br />
              <span style={{ fontSize: '13px', fontWeight: 'normal' }}>새로운 견적을 요청하시려면 담당자에게 연락해주세요.</span>
            </div>
          </div>
        );

        return (
          <div style={{ ...ps.editPanel, border: '2px solid #e2e8f0' }} className="no-print">
            <div style={ps.editTitle}>이 견적서에 대한 의견을 알려주세요</div>

            {!isApproved && !isRejected && (
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <button onClick={() => setShowApproveModal(true)}
                  style={{ flex: 1, padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' }}>
                  ✅ 견적 승인
                </button>
                <button onClick={() => setShowRejectModal(true)}
                  style={{ flex: 1, padding: '14px', background: '#f8fafc', color: '#ef4444', border: '2px solid #ef4444', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' }}>
                  ❌ 거절
                </button>
              </div>
            )}

            {isApproved && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '8px', padding: '10px 14px', color: '#065f46', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>
                  ✅ 견적을 승인하셨습니다. 담당자가 연락드릴 예정입니다.
                </div>
                <button onClick={handleContractRequest}
                  style={{ width: '100%', padding: '14px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' }}>
                  🎉 이 견적으로 계약하겠습니다
                </button>
              </div>
            )}

            {isRejected && (
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 14px', color: '#991b1b', fontSize: '13px', marginBottom: '12px' }}>
                ❌ 거절하셨습니다. {quote.rejectedReason && `(사유: ${quote.rejectedReason})`}<br />
                <span style={{ fontSize: '12px' }}>담당자가 확인 후 재견적을 제안드릴 수 있습니다.</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Q&A 패널 */}
      <div style={{ ...ps.editPanel, border: '2px solid #e2e8f0', marginTop: '0' }} className="no-print">
        <div style={ps.editTitle}>💬 담당자에게 질문하기</div>
        {qnaList.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            {qnaList.map((qa, i) => (
              <div key={qa.id || i} style={{ marginBottom: '12px' }}>
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', color: '#0369a1', marginBottom: '4px' }}>
                    Q · {qa.createdAt?.split('T')[0]}
                  </div>
                  <div style={{ fontSize: '13px', color: '#0c4a6e' }}>{qa.question}</div>
                </div>
                {qa.answer ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px', marginTop: '6px', marginLeft: '16px' }}>
                    <div style={{ fontSize: '11px', color: '#166534', marginBottom: '4px' }}>A · {settings.companyName || '화이트라인'}</div>
                    <div style={{ fontSize: '13px', color: '#14532d' }}>{qa.answer}</div>
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', marginLeft: '16px' }}>답변 대기 중...</div>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitQuestion()}
            placeholder="궁금한 점을 입력하세요"
            style={{ flex: 1, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }}
          />
          <button onClick={handleSubmitQuestion}
            style={{ padding: '10px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
            전송
          </button>
        </div>
      </div>

      {/* 승인 확인 모달 */}
      {showApproveModal && (
        <div style={ps.modalOverlay} className="no-print">
          <div style={ps.modal}>
            <div style={ps.modalTitle}>✅ 견적 승인</div>
            <div style={{ fontSize: '14px', color: '#374151', marginBottom: '20px', lineHeight: '1.6' }}>
              이 견적서의 내용으로 진행하는 것에 동의하십니까?<br />
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>승인 후 담당자가 연락드립니다.</span>
            </div>
            <button onClick={handleApprove}
              style={{ width: '100%', padding: '13px', background: '#10b981', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>
              ✅ 승인합니다
            </button>
            <button onClick={() => setShowApproveModal(false)} style={ps.closeBtn}>취소</button>
          </div>
        </div>
      )}

      {/* 거절 사유 모달 */}
      {showRejectModal && (
        <div style={ps.modalOverlay} className="no-print">
          <div style={ps.modal}>
            <div style={ps.modalTitle}>❌ 거절 사유</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '14px' }}>거절 사유를 선택해주세요. (담당자에게 전달됩니다)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
              {[
                { value: 'price', label: '💰 금액이 예산을 초과합니다' },
                { value: 'other', label: '🏢 다른 업체와 계약했습니다' },
                { value: 'timing', label: '⏳ 현재 시기가 맞지 않습니다' },
                { value: 'review', label: '📋 내부 검토 후 다시 연락드리겠습니다' },
                { value: 'scope', label: '📐 원하는 서비스 범위와 다릅니다' },
                { value: 'direct', label: '✏️ 직접 입력' },
              ].map(r => (
                <button key={r.value} onClick={() => setRejectCategory(r.value)}
                  style={{ padding: '11px 14px', textAlign: 'left', border: rejectCategory === r.value ? '2px solid #ef4444' : '1px solid #e2e8f0',
                    borderRadius: '8px', background: rejectCategory === r.value ? '#fee2e2' : '#f8fafc',
                    cursor: 'pointer', fontSize: '13px', color: rejectCategory === r.value ? '#ef4444' : '#374151' }}>
                  {r.label}
                </button>
              ))}
            </div>
            {rejectCategory === 'direct' && (
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="거절 사유를 직접 입력해주세요"
                style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', height: '80px', resize: 'vertical', boxSizing: 'border-box', marginBottom: '10px' }}
              />
            )}
            <button onClick={handleReject}
              style={{ width: '100%', padding: '13px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold', marginBottom: '8px' }}>
              거절 전달하기
            </button>
            <button onClick={() => setShowRejectModal(false)} style={ps.closeBtn}>취소</button>
          </div>
        </div>
      )}

      {/* 고객 수정/요청 패널 (수정 허용 시) */}
      {(ls.allowEdit || ls.allowZoneAdjust || ls.allowZoneRequest) && !requestSent && (
        <div style={ps.editPanel} className="no-print">
          <div style={ps.editTitle}>✏️ 견적 조정 요청</div>

          {/* 구획 수량 조정 */}
          {ls.allowZoneAdjust && (localQuote.zoneServices||[]).filter(z=>z.include).length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={ps.editSubTitle}>📍 구획 수량 조정</div>
              {(localQuote.zoneServices||[]).filter(z=>z.include).map((z, i) => z.countable !== false && (
                <div key={z.zoneKey} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ flex: 1, fontSize: '13px' }}>{z.zoneIcon} {z.zoneLabel}</span>
                  <button onClick={() => setLocalQuote(q => { const zs=[...q.zoneServices]; const idx=zs.findIndex(x=>x.zoneKey===z.zoneKey); if(idx>=0){zs[idx]={...zs[idx],count:Math.max(0,(zs[idx].count||0)-1)};}return{...q,zoneServices:zs}; })} style={ps.adjBtn}>−</button>
                  <span style={{ minWidth: '30px', textAlign: 'center', fontWeight: 'bold' }}>{z.count}</span>
                  <button onClick={() => setLocalQuote(q => { const zs=[...q.zoneServices]; const idx=zs.findIndex(x=>x.zoneKey===z.zoneKey); if(idx>=0){zs[idx]={...zs[idx],count:(zs[idx].count||0)+1};}return{...q,zoneServices:zs}; })} style={ps.adjBtn}>+</button>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>개</span>
                </div>
              ))}
            </div>
          )}

          {/* 구획 추가 요청 */}
          {ls.allowZoneRequest && (
            <div style={{ marginBottom: '16px' }}>
              <div style={ps.editSubTitle}>➕ 추가 구획 요청</div>
              {customZones.map((z, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                  <span style={{ background: '#e0f2fe', padding: '4px 10px', borderRadius: '6px', fontSize: '13px' }}>
                    📍 {z.label} {z.count > 1 ? `${z.count}개` : ''}
                  </span>
                  <button onClick={() => setCustomZones(c => c.filter((_,j)=>j!==i))}
                    style={{ background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <input id="newZoneLabel" placeholder="추가할 구획명" style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
                <button onClick={() => {
                  const label = document.getElementById('newZoneLabel').value.trim();
                  if (!label) return;
                  setCustomZones(c => [...c, { label, count: 1 }]);
                  document.getElementById('newZoneLabel').value = '';
                }} style={{ padding: '8px 14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  + 추가
                </button>
              </div>
            </div>
          )}

          {/* 요청 전송 버튼 */}
          <button onClick={handleReQuoteRequest} style={{
            width: '100%', padding: '12px', background: '#1e40af', color: 'white',
            border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold',
          }}>
            📨 담당자에게 재견적 요청
          </button>
          <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginTop: '6px' }}>
            요청 후 담당자가 검토하여 견적을 수정합니다.
          </div>
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* 알림 전송 모달 */}
      {showNotifyModal && staffContact && (
        <div style={ps.modalOverlay} className="no-print">
          <div style={ps.modal}>
            <div style={ps.modalTitle}>📨 담당자에게 알림 보내기</div>
            <div style={{ fontSize: '13px', color: '#374151', marginBottom: '16px', lineHeight: '1.6' }}>
              재견적 요청이 저장되었습니다.<br />
              아래 방법으로 담당자 <b>{staffContact.name}</b>에게 알림을 보내세요.
            </div>

            {/* 알림 메시지 미리보기 */}
            <div style={ps.msgPreview}>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>전송될 메시지</div>
              <div style={{ fontSize: '12px', color: '#374151', whiteSpace: 'pre-line', lineHeight: '1.6' }}>
                {makeNotifyMsg()}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
              {/* 카카오톡 */}
              <button
                onClick={() => {
                  const msg = makeNotifyMsg();
                  navigator.clipboard.writeText(msg).then(() => {
                    // 카카오톡 앱 열기 시도 (모바일)
                    const kakaoLink = `kakaotalk://launch`;
                    window.location.href = kakaoLink;
                    // 앱이 없으면 복사 완료 안내
                    setTimeout(() => {
                      alert('메시지가 클립보드에 복사되었습니다.\n카카오톡을 열어 담당자에게 붙여넣기 해주세요.');
                    }, 1000);
                  });
                }}
                style={ps.kakaoBtn}
              >
                <span style={{ fontSize: '18px' }}>💬</span>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '14px' }}>카카오톡으로 알림</div>
                  <div style={{ fontSize: '11px', opacity: 0.8 }}>메시지 복사 후 카카오톡 실행</div>
                </div>
              </button>

              {/* 문자(SMS) */}
              {staffContact.phone ? (
                <a
                  href={`sms:${staffContact.phone}?body=${encodeURIComponent(makeNotifyMsg())}`}
                  style={ps.smsBtn}
                >
                  <span style={{ fontSize: '18px' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '14px' }}>문자(SMS)로 알림</div>
                    <div style={{ fontSize: '11px', opacity: 0.8 }}>{staffContact.phone}</div>
                  </div>
                </a>
              ) : (
                <div style={{ ...ps.smsBtn, opacity: 0.5, cursor: 'default' }}>
                  <span style={{ fontSize: '18px' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '14px' }}>문자(SMS)로 알림</div>
                    <div style={{ fontSize: '11px', opacity: 0.8 }}>담당자 전화번호 미등록</div>
                  </div>
                </div>
              )}

              {/* 메시지 복사만 */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(makeNotifyMsg());
                  alert('메시지가 복사되었습니다!');
                }}
                style={ps.copyBtn}
              >
                <span style={{ fontSize: '18px' }}>📋</span>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '14px' }}>메시지만 복사</div>
                  <div style={{ fontSize: '11px', opacity: 0.8 }}>원하는 앱에 직접 붙여넣기</div>
                </div>
              </button>
            </div>

            <button onClick={handleCloseNotify} style={ps.closeBtn}>
              나중에 알림 보내기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 스타일
const ps = {
  page: { maxWidth: '860px', margin: '0 auto', padding: '0 0 40px', fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif', background: '#f8fafc', minHeight: '100vh' },
  loadingWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' },
  spinner: { width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  errorWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'white', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 100 },
  toolBtn: bg => ({ padding: '8px 14px', background: bg, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }),
  acceptBanner: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: '#d1fae5', borderBottom: '2px solid #6ee7b7', position: 'sticky', top: '57px', zIndex: 99, gap: '12px' },
  acceptBtn: { flexShrink: 0, padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap' },
  successBanner: { background: '#d1fae5', color: '#166534', border: '1px solid #86efac', padding: '12px 20px', fontSize: '13px', fontWeight: 'bold', textAlign: 'center' },
  doc: { background: 'white', margin: '20px', padding: '28px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  docHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', paddingBottom: '14px', borderBottom: '2px solid #1e3a5f' },
  infoTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '13px' },
  infoLabel: { padding: '7px 10px', background: '#1e3a5f', color: 'white', fontWeight: 'bold', border: '1px solid #1e3a5f', width: '80px', textAlign: 'center' },
  infoVal: { padding: '7px 12px', border: '1px solid #e2e8f0' },
  tableTitle: { fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '6px' },
  quoteTable: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '6px' },
  qth: { padding: '8px', textAlign: 'center', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.3)' },
  qtd: { padding: '7px 8px', border: '1px solid #e2e8f0', verticalAlign: 'middle' },
  qtdC: { padding: '7px 8px', border: '1px solid #e2e8f0', textAlign: 'center' },
  qtdR: { padding: '7px 8px', border: '1px solid #e2e8f0', textAlign: 'right' },
  totalBox: { background: '#1e3a5f', borderRadius: '8px', padding: '14px 16px', margin: '14px 0 8px' },
  noticeBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', marginTop: '12px' },
  noticeItem: { fontSize: '11px', color: '#374151', marginBottom: '3px', lineHeight: '1.5' },
  signRow: { display: 'flex', gap: '20px', marginTop: '20px', justifyContent: 'flex-end' },
  signBox: { border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px 20px', textAlign: 'center', minWidth: '140px' },
  signLabel: { fontSize: '11px', color: '#94a3b8', marginBottom: '6px' },
  editPanel: { background: 'white', margin: '0 20px 20px', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #3b82f6' },
  editTitle: { fontSize: '16px', fontWeight: 'bold', color: '#1e40af', marginBottom: '14px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' },
  editSubTitle: { fontSize: '13px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' },
  sectionTitle: { fontSize:'14px', fontWeight:'bold', color:'#1e3a5f', marginBottom:'8px', paddingLeft:'10px', borderLeft:'4px solid #1e3a5f' },
  adjBtn: { width: '28px', height: '28px', border: '1px solid #ddd', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer', fontSize: '16px' },
  // 알림 모달
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'white', borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: '500px' },
  modalTitle: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' },
  msgPreview: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '4px' },
  kakaoBtn: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: '#FEE500', color: '#391B1B', border: 'none', borderRadius: '10px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  smsBtn: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', textDecoration: 'none', width: '100%', boxSizing: 'border-box' },
  copyBtn: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: '#64748b', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  closeBtn: { width: '100%', padding: '13px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', marginTop: '10px' },
};

export default QuotePublicView;
