import React, { useState, useEffect, useRef, useCallback } from 'react';
import { collection, getDocs, doc, getDoc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { CLAUSE_KEYS, CLAUSE_META, DEFAULT_CLAUSES } from './contractConstants';

function ContractPublicView({ contractId }) {
  const [contract, setContract]   = useState(null);
  const [settings, setSettings]   = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [step, setStep]           = useState('view');   // 'view' | 'sign' | 'done'
  const [signerName, setSignerName] = useState('');
  const [agreed, setAgreed]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const canvasRef                 = useRef(null);
  const isDrawing                 = useRef(false);
  const lastPos                   = useRef({ x: 0, y: 0 });
  const [hasSignature, setHasSignature] = useState(false);
  const printRef                  = useRef();

  useEffect(() => { fetchData(); }, [contractId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const cDoc = await getDoc(doc(db, 'contracts', contractId));
      if (!cDoc.exists()) { setError('계약서를 찾을 수 없습니다.'); setLoading(false); return; }
      const cData = { id: cDoc.id, ...cDoc.data() };
      if (cData.status === 'cancelled') { setError('이미 해지된 계약서입니다.'); setLoading(false); return; }
      setContract(cData);
      if (cData.signedAt) setStep('done');

      const sSnap = await getDocs(collection(db, 'settings'));
      if (sSnap.docs.length > 0) setSettings(sSnap.docs[0].data());

      // 열람 기록
      if (!cData.viewedAt && cData.status === 'sent') {
        try {
          await updateDoc(doc(db, 'contracts', contractId), {
            viewedAt: new Date().toISOString(),
          });
        } catch (e) { console.error('계약서 열람 기록 오류:', e); }
      }
    } catch (e) { setError('데이터 로드 중 오류가 발생했습니다.'); }
    setLoading(false);
  };

  // ── 서명 캔버스 ──────────────────────────────────────────
  const initCanvas = useCallback((canvas) => {
    if (!canvas) return;
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getPos(e, canvasRef.current);
  };
  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasSignature(true);
  };
  const endDraw = () => { isDrawing.current = false; };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  // 서명 완료
  const handleSign = async () => {
    if (!signerName.trim()) { alert('서명자 이름을 입력해주세요.'); return; }
    if (!agreed) { alert('계약 내용에 동의해주세요.'); return; }
    if (!hasSignature) { alert('서명을 해주세요.'); return; }
    setSaving(true);
    try {
      const signatureData = canvasRef.current.toDataURL('image/png');
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'contracts', contractId), {
        status: 'signed',
        signedAt: now,
        signerName: signerName.trim(),
        signatureData,
        signedAgreed: true,
      });
      // 담당자 알림
      await addDoc(collection(db, 'notifications'), {
        type: 'contractSigned',
        contractId,
        custName: contract.custName || '고객',
        message: `🎉 ${contract.custName || '고객'}님이 계약서에 서명했습니다!`,
        createdAt: now,
        read: false,
      });
      setContract(c => ({ ...c, status: 'signed', signedAt: now, signerName, signatureData }));
      setStep('done');
    } catch (e) { alert('서명 저장 실패: ' + e.message); }
    setSaving(false);
  };

  const handlePrint = () => window.print();

  const formatPrice = (p) => p ? p.toLocaleString() + '원' : '0원';
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;

  const enabledClauses = contract ? CLAUSE_KEYS
    .filter(k => contract.clauses?.[k]?.enabled)
    .map((k, i) => ({
      key: k,
      number: i + 1,
      label: CLAUSE_META[k]?.label || k,
      content: (contract.clauses[k]?.content || DEFAULT_CLAUSES[k] || '')
        .replace('{{contractDuration}}', contract.contractDuration || '1년'),
    })) : [];

  if (loading) return (
    <div style={pv.loading}>
      <div style={pv.spinner} />
      <div style={{ color: '#64748b', marginTop: '16px' }}>계약서를 불러오는 중...</div>
    </div>
  );

  if (error) return (
    <div style={pv.loading}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>😢</div>
      <div style={{ color: '#ef4444', fontWeight: 'bold' }}>{error}</div>
    </div>
  );

  if (!contract) return null;
  const c = contract;
  const contractDateStr = c.contractStart ? `${c.contractStart} ~ ${c.contractEnd || '별도 협의'}` : dateStr;

  return (
    <div style={pv.page}>
      {/* 툴바 */}
      <div style={pv.toolbar} className="no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} />}
          <span style={{ fontWeight: 'bold', color: '#1e3a5f' }}>{settings.companyName || '화이트라인'}</span>
        </div>
        <button onClick={handlePrint} style={pv.printBtn}>🖨️ 인쇄</button>
      </div>

      {/* 서명완료 배너 */}
      {step === 'done' && (
        <div style={pv.signedBanner} className="no-print">
          ✅ 계약서 서명이 완료되었습니다! ({c.signedAt?.split('T')[0]})
          <br /><span style={{ fontSize: '12px' }}>서명자: {c.signerName}</span>
        </div>
      )}

      {/* 계약서 본문 */}
      <div ref={printRef} style={pv.doc}>
        {/* 헤더 */}
        <div style={pv.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px' }} />}
            <div>
              <div style={{ fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f' }}>{settings.companyName || '화이트라인'}</div>
              {settings.companyAddress && <div style={{ fontSize: '11px', color: '#64748b' }}>{settings.companyAddress}</div>}
              {settings.companyPhone && <div style={{ fontSize: '11px', color: '#64748b' }}>Tel: {settings.companyPhone}</div>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e3a5f', letterSpacing: '4px' }}>계 약 서</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>작성일: {dateStr}</div>
          </div>
        </div>

        {/* 계약 개요 */}
        <table style={pv.table}>
          <tbody>
            <tr>
              <td style={pv.tl}>업 장 명</td><td style={pv.tv}><b>{c.custName}</b></td>
              <td style={pv.tl}>연 락 처</td><td style={pv.tv}>{c.phone}</td>
            </tr>
            <tr>
              <td style={pv.tl}>담 당 자</td><td style={pv.tv}>{c.staffName}</td>
              <td style={pv.tl}>사업자번호</td><td style={pv.tv}>{c.businessNumber}</td>
            </tr>
            <tr>
              <td style={pv.tl}>주 소</td><td style={pv.tv} colSpan={3}>{c.address}</td>
            </tr>
            <tr>
              <td style={pv.tl}>서비스 구획</td><td style={pv.tv} colSpan={3}>{c.serviceScope || '전체'}</td>
            </tr>
            <tr>
              <td style={pv.tl}>방제 횟수</td><td style={pv.tv}>월 {c.visitPerMonth}회</td>
              <td style={pv.tl}>계약 기간</td><td style={pv.tv}>{contractDateStr}</td>
            </tr>
            <tr>
              <td style={pv.tl}>결제 방법</td><td style={pv.tv} colSpan={3}>{c.paymentMethod} · {c.paymentDay}</td>
            </tr>
          </tbody>
        </table>

        {/* 비용 표 */}
        <table style={{ ...pv.table, marginBottom: '10px' }}>
          <thead>
            <tr style={{ background: '#1e3a5f', color: 'white' }}>
              <th style={pv.th}>구 분</th><th style={pv.th}>기간/수량</th>
              <th style={pv.th}>금 액</th><th style={pv.th}>비 고</th>
            </tr>
          </thead>
          <tbody>
            {c.initialFee > 0 && (
              <tr><td style={pv.td}>초 기</td><td style={pv.tdc}>-</td>
                <td style={{ ...pv.tdr, fontWeight: 'bold' }}>{formatPrice(c.initialFee)}</td><td style={pv.td}>*면세</td></tr>
            )}
            <tr>
              <td style={pv.td}>정 기</td><td style={pv.tdc}>매월 {c.visitPerMonth}회</td>
              <td style={{ ...pv.tdr, fontWeight: 'bold', color: '#1e3a5f' }}>{formatPrice(c.monthlyFee)}</td><td style={pv.td}></td>
            </tr>
            {c.trapCount > 0 && (
              <tr style={{ background: '#fef3c7' }}>
                <td style={pv.td}>포 충 기</td><td style={pv.tdc}>{c.trapCount}대</td>
                <td style={{ ...pv.tdr, fontWeight: 'bold', color: '#d97706' }}>{formatPrice(c.trapMonthlyFee * c.trapCount)}/월</td>
                <td style={{ ...pv.td, fontSize: '10px', color: '#92400e' }}>{c.trapWinterExempt ? '동절기(12~3월) 면제' : ''}</td>
              </tr>
            )}
            <tr style={{ background: '#f0f9ff' }}>
              <td style={{ ...pv.td, fontWeight: 'bold' }} colSpan={2}>월 합 계</td>
              <td style={{ ...pv.tdr, fontWeight: 'bold', fontSize: '15px', color: '#1e3a5f' }}>
                {formatPrice((c.monthlyFee||0) + (c.trapCount > 0 ? (c.trapMonthlyFee||0) * c.trapCount : 0))}
              </td>
              <td style={pv.td}></td>
            </tr>
          </tbody>
        </table>

        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '14px', fontStyle: 'italic' }}>
          ※ 위 계약기간 1개월 전까지 특별한 사유가 없는 한 동일한 조건으로 자동 연장됩니다.
        </div>

        <div style={pv.divider} />
        <div style={pv.clauseTitle}>기 본 계 약 내 용</div>

        {enabledClauses.map(cl => (
          <div key={cl.key} style={pv.clauseBlock}>
            <div style={pv.clauseLabel}>{cl.label.replace(/제\d+조 /, `제${cl.number}조 `)}</div>
            <div style={{ paddingLeft: '12px' }}>
              {cl.content.split('\n').map((line, i) => (
                <div key={i} style={{ lineHeight: '1.8', fontSize: '12px', color: '#1e293b' }}>{line}</div>
              ))}
            </div>
          </div>
        ))}

        {/* 유의사항 */}
        {c.includeNotices !== false && c.notices?.length > 0 && (
          <div style={pv.noticeBox}>
            <div style={{ fontWeight: 'bold', color: '#1e3a5f', fontSize: '13px', marginBottom: '8px' }}>★ 유의사항</div>
            {c.notices.map((notice, i) => notice && (
              <div key={i} style={{ fontSize: '12px', color: '#374151', marginBottom: '4px', lineHeight: '1.6' }}>
                {i + 1}. {notice}
              </div>
            ))}
          </div>
        )}

        {/* 서명란 */}
        <div style={pv.signSection}>
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#374151', marginBottom: '16px' }}>
            본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하여 서명·날인하고 각 1통씩 보관합니다.
          </div>
          <div style={{ textAlign: 'center', fontSize: '13px', color: '#374151', marginBottom: '16px' }}>
            {c.contractStart || dateStr}
          </div>
          <div style={pv.signRow}>
            {/* 고객 서명 */}
            <div style={pv.signBox}>
              <div style={pv.signRole}>도 급 인 (갑)</div>
              {c.address && <div style={pv.signDetail}>주 소: {c.address}</div>}
              {c.businessNumber && <div style={pv.signDetail}>사업자: {c.businessNumber}</div>}
              <div style={pv.signDetail}>상 호: {c.custName}</div>
              {c.representativeName && <div style={pv.signDetail}>대 표: {c.representativeName}</div>}
              <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {step === 'done' && c.signatureData ? (
                  <div style={{ textAlign: 'center' }}>
                    <img src={c.signatureData} alt="서명" style={{ height: '60px', maxWidth: '160px', objectFit: 'contain' }} />
                    <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>✅ {c.signerName} ({c.signedAt?.split('T')[0]})</div>
                  </div>
                ) : (
                  <div style={{ height: '60px', border: '1px dashed #e2e8f0', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '12px' }}>
                    서명 대기 중
                  </div>
                )}
              </div>
            </div>

            {/* 화이트라인 서명 */}
            <div style={pv.signBox}>
              <div style={pv.signRole}>수 급 인 (을)</div>
              {settings.companyAddress && <div style={pv.signDetail}>주 소: {settings.companyAddress}</div>}
              <div style={pv.signDetail}>상 호: {settings.companyName || '화이트라인'}</div>
              <div style={pv.signDetail}>대 표: {c.representativeStaff || '김현숙'}</div>
              <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0', textAlign: 'center', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px' }}>대표이사</span>
                {settings.sealImage ? (
                  <img src={settings.sealImage} alt="직인" style={{ width: '60px', height: '60px', objectFit: 'contain' }} />
                ) : (
                  <div style={{ width: '60px', height: '60px', border: '1px solid #e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '12px' }}>(인)</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 서명 액션 패널 */}
      {step === 'view' && c.status !== 'cancelled' && c.status !== 'draft' && (
        <div style={pv.signPanel} className="no-print">
          <div style={pv.signPanelTitle}>✍️ 계약서 서명</div>
          <div style={{ fontSize: '13px', color: '#374151', marginBottom: '16px', lineHeight: '1.6' }}>
            위 계약서의 내용을 충분히 검토하셨나요?<br />
            동의하시면 아래에 서명해 주세요.
          </div>
          <button onClick={() => setStep('sign')}
            style={{ width: '100%', padding: '14px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' }}>
            ✍️ 서명하기
          </button>
        </div>
      )}

      {step === 'sign' && (
        <div style={pv.signPanel} className="no-print">
          <div style={pv.signPanelTitle}>✍️ 서명</div>

          {/* 서명자 이름 */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#374151', display: 'block', marginBottom: '6px' }}>
              서명자 이름 *
            </label>
            <input value={signerName} onChange={e => setSignerName(e.target.value)}
              placeholder="대표자 또는 담당자 성함" style={pv.nameInput} />
          </div>

          {/* 서명 캔버스 */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#374151' }}>서명 *</label>
              <button onClick={clearCanvas} style={pv.clearBtn}>지우기</button>
            </div>
            <canvas
              ref={initCanvas}
              width={560} height={160}
              style={pv.canvas}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
            />
            <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginTop: '4px' }}>
              위 영역에 손가락이나 마우스로 서명해 주세요
            </div>
          </div>

          {/* 동의 체크 */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer', marginBottom: '14px' }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#10b981', flexShrink: 0 }} />
            <div style={{ fontSize: '13px', color: '#166534', lineHeight: '1.6' }}>
              <b>위 계약서의 모든 내용을 충분히 읽고 이해하였으며, 이에 동의합니다.</b><br />
              <span style={{ fontSize: '11px' }}>본 전자서명은 자필 서명과 동일한 법적 효력을 가집니다.</span>
            </div>
          </label>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setStep('view')} style={pv.cancelSignBtn}>취소</button>
            <button onClick={handleSign} disabled={saving}
              style={{ ...pv.submitSignBtn, opacity: saving ? 0.7 : 1 }}>
              {saving ? '처리 중...' : '✅ 서명 완료'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ ...pv.signPanel, border: '2px solid #10b981', background: '#f0fdf4' }} className="no-print">
          <div style={{ textAlign: 'center', padding: '10px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>🎉</div>
            <div style={{ fontSize: '17px', fontWeight: 'bold', color: '#10b981', marginBottom: '6px' }}>계약서 서명 완료!</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '14px' }}>
              담당자 {c.staffName || settings.companyName}에게 서명 알림이 전달되었습니다.<br />
              계약서를 인쇄하시려면 아래 버튼을 눌러주세요.
            </div>
            <button onClick={handlePrint}
              style={{ padding: '12px 24px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
              🖨️ 계약서 인쇄/저장
            </button>
          </div>
        </div>
      )}

      <style>{`
        @media print { .no-print { display: none !important; } body { background: white; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const pv = {
  page: { maxWidth: '860px', margin: '0 auto', paddingBottom: '40px', fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif', background: '#f8fafc', minHeight: '100vh' },
  loading: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' },
  spinner: { width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTop: '4px solid #1e3a5f', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'white', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 100 },
  printBtn: { padding: '8px 14px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  signedBanner: { background: '#d1fae5', color: '#065f46', padding: '12px 20px', fontSize: '13px', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.6' },
  doc: { background: 'white', margin: '16px', padding: '28px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', paddingBottom: '14px', borderBottom: '2px solid #1e3a5f' },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: '8px', fontSize: '12px' },
  tl: { padding: '7px 10px', background: '#1e3a5f', color: 'white', fontWeight: 'bold', border: '1px solid #1e3a5f', width: '80px', textAlign: 'center', whiteSpace: 'nowrap' },
  tv: { padding: '7px 12px', border: '1px solid #e2e8f0' },
  th: { padding: '8px 10px', textAlign: 'center', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.2)' },
  td: { padding: '7px 10px', border: '1px solid #e2e8f0' },
  tdc: { padding: '7px 10px', textAlign: 'center', border: '1px solid #e2e8f0' },
  tdr: { padding: '7px 10px', textAlign: 'right', border: '1px solid #e2e8f0' },
  divider: { border: 'none', borderTop: '1px solid #e2e8f0', margin: '14px 0' },
  clauseTitle: { fontSize: '14px', fontWeight: 'bold', color: '#1e3a5f', textAlign: 'center', marginBottom: '12px', letterSpacing: '2px' },
  clauseBlock: { marginBottom: '12px' },
  clauseLabel: { fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '4px' },
  noticeBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px 14px', marginTop: '14px' },
  signSection: { marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' },
  signRow: { display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' },
  signBox: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 20px', flex: 1, minWidth: '200px', maxWidth: '300px' },
  signRole: { fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', textAlign: 'center', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #e2e8f0' },
  signDetail: { fontSize: '11px', color: '#374151', marginBottom: '4px' },
  // 서명 패널
  signPanel: { background: 'white', margin: '0 16px 16px', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #1e3a5f' },
  signPanelTitle: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' },
  nameInput: { width: '100%', padding: '11px 14px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' },
  canvas: { width: '100%', height: '160px', border: '2px solid #e2e8f0', borderRadius: '8px', background: '#fafafa', cursor: 'crosshair', touchAction: 'none' },
  clearBtn: { padding: '5px 12px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  cancelSignBtn: { flex: 1, padding: '13px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontSize: '15px' },
  submitSignBtn: { flex: 2, padding: '13px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' },
};

export default ContractPublicView;
