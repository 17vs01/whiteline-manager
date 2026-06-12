import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, doc, updateDoc,
  query, orderBy,
} from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';

const STATUS_INFO = {
  submitted: { label:'접수됨',    color:'#f59e0b', bg:'#fffbeb' },
  confirmed: { label:'확인 완료', color:'#2563eb', bg:'#eff6ff' },
  completed: { label:'등록 완료', color:'#059669', bg:'#f0fdf4' },
  cancelled: { label:'취소됨',    color:'#dc2626', bg:'#fef2f2' },
};

export default function AutoDebitPanel({ currentUser, onClose, onNavigateToShortTerm }) {
  const [debits,        setDebits]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [selected,      setSelected]      = useState(null);
  const [filter,        setFilter]        = useState('submitted');
  const [memo,          setMemo]          = useState('');
  const [saving,        setSaving]        = useState(false);
  const [stUnpaid,      setStUnpaid]      = useState({ count:0, total:0 }); // 단기고객 미수금

  const isMaster = ['master','master1','master2'].includes(currentUser?.role);

  // 단기고객 미수금 실시간 구독
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'shortTermCustomers'), orderBy('createdAt', 'desc')),
      snap => {
        const unpaid = snap.docs
          .map(d => d.data())
          .filter(c => c.status !== 'converted' && !c.paymentDone);
        const total = unpaid.reduce((sum, c) => sum + (c.price || 0), 0);
        setStUnpaid({ count: unpaid.length, total });
      },
      err => console.error('단기고객 미수금 오류:', err)
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'autoDebits'), orderBy('createdAt', 'desc')),
      snap => {
        setDebits(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      err => console.error('자동이체 목록 오류:', err)
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (selected) setMemo(selected.managerMemo || '');
  }, [selected]);

  // ── 상태 변경 ──────────────────────────────────
  const handleStatusChange = async (debitId, newStatus) => {
    if (!isMaster) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'autoDebits', debitId), {
        status:    newStatus,
        updatedAt: new Date().toISOString(),
        [`${newStatus}At`]: new Date().toISOString(),
        confirmedBy: currentUser.name || currentUser.email || '',
      });
      setSelected(prev => prev ? { ...prev, status: newStatus } : prev);
      Swal.fire({ toast:true, position:'top-end', icon:'success', title:'상태가 변경됐어요', timer:1500, showConfirmButton:false });
    } catch (e) {
      console.error(e);
      Swal.fire('오류', '상태 변경에 실패했어요.', 'error');
    }
    setSaving(false);
  };

  // ── 메모 저장 ──────────────────────────────────
  const handleSaveMemo = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'autoDebits', selected.id), {
        managerMemo: memo,
        updatedAt:   new Date().toISOString(),
      });
      setSelected(prev => prev ? { ...prev, managerMemo: memo } : prev);
      Swal.fire({ toast:true, position:'top-end', icon:'success', title:'메모 저장 완료', timer:1500, showConfirmButton:false });
    } catch (e) {
      Swal.fire('오류', '저장에 실패했어요.', 'error');
    }
    setSaving(false);
  };

  // ── PDF 출력 ───────────────────────────────────
  const handlePrint = useCallback((debit) => {
    const html = buildAutoDebitHTML(debit);
    const win  = window.open('', '_blank', 'width=900,height=700');
    win.document.write(html);
    win.document.close();
    win.onafterprint = () => win.close();
    setTimeout(() => { win.focus(); win.print(); }, 700);
  }, []);

  const filteredDebits = filter === 'all'
    ? debits
    : debits.filter(d => d.status === filter);

  const pendingCount = debits.filter(d => d.status === 'submitted').length;

  // ── 목록 화면 ──────────────────────────────────
  if (!selected) {
    return (
      <div style={S.panel}>
        {/* 헤더 */}
        <div style={S.header}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:18 }}>🏦</span>
            <span style={{ fontSize:16, fontWeight:700, color:'white' }}>자동이체 신청서</span>
            {pendingCount > 0 && (
              <span style={S.badge}>{pendingCount}</span>
            )}
          </div>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* 단기고객 미수금 요약 카드 */}
        {stUnpaid.count > 0 && (
          <div
            onClick={() => onNavigateToShortTerm && onNavigateToShortTerm()}
            style={{
              margin: '10px 12px 0', padding: '10px 14px',
              background: '#fef9c3', border: '1px solid #fde68a',
              borderRadius: 10, cursor: onNavigateToShortTerm ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>
                ⚠️ 단기고객 미수금 {stUnpaid.count}건
              </div>
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                총 {stUnpaid.total.toLocaleString()}원 미수금 확인 필요
              </div>
            </div>
            {onNavigateToShortTerm && (
              <span style={{ fontSize: 12, color: '#92400e', fontWeight: 700 }}>→ 단기고객 탭</span>
            )}
          </div>
        )}

        {/* 필터 탭 */}
        <div style={S.filterRow}>
          {[
            { key:'submitted', label:'접수됨' },
            { key:'confirmed', label:'확인완료' },
            { key:'completed', label:'등록완료' },
            { key:'all',       label:'전체' },
          ].map(f => (
            <button
              key={f.key}
              style={{ ...S.filterBtn, ...(filter === f.key ? S.filterBtnActive : {}) }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' && debits.filter(d => d.status === f.key).length > 0 && (
                <span style={{ marginLeft:4, fontSize:11, opacity:0.8 }}>
                  ({debits.filter(d => d.status === f.key).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 목록 */}
        <div style={S.list}>
          {loading ? (
            <div style={S.empty}><div style={{ fontSize:24 }}>⏳</div><div>불러오는 중...</div></div>
          ) : filteredDebits.length === 0 ? (
            <div style={S.empty}><div style={{ fontSize:32 }}>📭</div><div>신청서가 없어요</div></div>
          ) : (
            filteredDebits.map(d => {
              const si = STATUS_INFO[d.status] || STATUS_INFO.submitted;
              return (
                <div key={d.id} style={S.card} onClick={() => setSelected(d)}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:'#1e293b' }}>
                        {d.customerName}
                      </span>
                      <span style={{ fontSize:11, color:'#94a3b8' }}>({d.customerCode})</span>
                    </div>
                    <div style={{ fontSize:12, color:'#64748b' }}>
                      {d.payType === 'account' ? `🏦 ${d.bankName} · ${d.accountHolder}` : `💳 ${d.cardCompany} · ${d.cardHolder}`}
                    </div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                      매월 {d.debitDay}일 · {Number(d.amount||0).toLocaleString()}원
                      &nbsp;·&nbsp; {d.appliedDateStr || d.createdAt?.slice(0,10)}
                    </div>
                  </div>
                  <span style={{ ...S.statusBadge, background:si.bg, color:si.color }}>{si.label}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ── 상세 화면 ──────────────────────────────────
  const si = STATUS_INFO[selected.status] || STATUS_INFO.submitted;
  return (
    <div style={S.panel}>
      {/* 헤더 */}
      <div style={S.header}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button style={S.backIconBtn} onClick={() => setSelected(null)}>←</button>
          <span style={{ fontSize:15, fontWeight:700, color:'white' }}>
            {selected.customerName} 신청서
          </span>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button style={S.printBtn} onClick={() => handlePrint(selected)}>🖨️ 출력</button>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      <div style={S.detail}>
        {/* 상태 + 변경 */}
        <DetailCard title="처리 상태">
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ ...S.statusBadge, background:si.bg, color:si.color, fontSize:13, padding:'5px 12px' }}>
              {si.label}
            </span>
            {isMaster && (
              <>
                {selected.status === 'submitted' && (
                  <button style={S.actionBtn('#2563eb')} onClick={() => handleStatusChange(selected.id, 'confirmed')} disabled={saving}>
                    ✅ 확인 완료
                  </button>
                )}
                {selected.status === 'confirmed' && (
                  <button style={S.actionBtn('#059669')} onClick={() => handleStatusChange(selected.id, 'completed')} disabled={saving}>
                    🎉 등록 완료
                  </button>
                )}
                {selected.status !== 'cancelled' && (
                  <button style={S.actionBtn('#dc2626')} onClick={() => handleStatusChange(selected.id, 'cancelled')} disabled={saving}>
                    ✕ 취소
                  </button>
                )}
              </>
            )}
          </div>
        </DetailCard>

        {/* 결제 수단 */}
        <DetailCard title={selected.payType === 'account' ? '🏦 계좌 정보' : '💳 카드 정보'}>
          {selected.payType === 'account' ? (
            <>
              <DetailRow label="은행"      value={selected.bankName} />
              <DetailRow label="예금주"    value={selected.accountHolder} />
              <DetailRow label="계좌번호"  value={selected.accountNumber} />
              <DetailRow label="주민번호"  value={`${selected.ownerIdFront || ''} - *******`} />
            </>
          ) : (
            <>
              <DetailRow label="카드사"   value={selected.cardCompany} />
              <DetailRow label="카드주"   value={selected.cardHolder} />
              <DetailRow label="카드번호" value={selected.cardNumber} />
              <DetailRow label="유효기간" value={`${selected.cardExpireMonth}/${selected.cardExpireYear}`} />
              <DetailRow label="주민번호" value={`${selected.cardOwnerIdFront || ''} - *******`} />
            </>
          )}
          {selected.businessNo && <DetailRow label="사업자번호" value={selected.businessNo} />}
        </DetailCard>

        {/* 출금 조건 */}
        <DetailCard title="💰 출금 조건">
          <DetailRow label="금액"     value={`${Number(selected.amount||0).toLocaleString()}원`} />
          <DetailRow label="출금일"   value={`매월 ${selected.debitDay}일`} />
          <DetailRow label="이체시작" value={`${selected.debitStartYear}년 ${selected.debitStartMonth}월`} />
          <DetailRow label="이체사유" value={selected.reason} />
        </DetailCard>

        {/* 신청인 정보 */}
        <DetailCard title="👤 신청인 정보">
          <DetailRow label="성명"   value={selected.applicantName} />
          <DetailRow label="휴대폰" value={selected.mobile} />
          <DetailRow label="주소"   value={selected.address} />
          {selected.email && <DetailRow label="이메일" value={selected.email} />}
          <DetailRow label="신청일" value={selected.appliedDateStr} />
          {selected.ownerDiff && (
            <div style={{ marginTop:6, padding:'6px 8px', background:'#fffbeb', borderRadius:6, fontSize:12, color:'#92400e' }}>
              ⚠️ 신청인과 예금주/카드주가 다름
            </div>
          )}
        </DetailCard>

        {/* 동의 현황 */}
        <DetailCard title="✅ 동의 현황">
          <AgreeBadge label="이용약관" ok={selected.agreeTerms} />
          <AgreeBadge label="개인정보" ok={selected.agreePrivacy} />
          <AgreeBadge label="SMS 동의" ok={selected.agreeSms} />
        </DetailCard>

        {/* 서명 */}
        {selected.signatureData && (
          <DetailCard title="✍️ 서명">
            <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>신청인 서명</div>
            <img src={selected.signatureData} alt="서명"
              style={{ width:'100%', maxWidth:280, border:'1px solid #e2e8f0', borderRadius:8, background:'white' }} />
            {selected.ownerDiff && selected.ownerSignatureData && (
              <>
                <div style={{ fontSize:12, color:'#64748b', marginTop:10, marginBottom:4 }}>예금주/카드주 서명</div>
                <img src={selected.ownerSignatureData} alt="예금주서명"
                  style={{ width:'100%', maxWidth:280, border:'1px solid #e2e8f0', borderRadius:8, background:'white' }} />
              </>
            )}
          </DetailCard>
        )}

        {/* 담당자 메모 */}
        {isMaster && (
          <DetailCard title="📝 담당자 메모">
            <textarea
              style={{ width:'100%', minHeight:80, padding:'8px 10px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:13, resize:'vertical', boxSizing:'border-box', fontFamily:'inherit' }}
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="내부 메모를 입력하세요..."
            />
            <button
              style={{ marginTop:8, padding:'8px 18px', background:'#2563eb', color:'white', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer', opacity: saving ? 0.7 : 1 }}
              onClick={handleSaveMemo}
              disabled={saving}
            >
              저장
            </button>
          </DetailCard>
        )}
      </div>
    </div>
  );
}

// ── 서브 컴포넌트 ──────────────────────────────
function DetailCard({ title, children }) {
  return (
    <div style={{ background:'white', borderRadius:10, padding:'12px 14px', marginBottom:10, boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize:13, fontWeight:700, color:'#1e293b', marginBottom:8 }}>{title}</div>
      {children}
    </div>
  );
}
function DetailRow({ label, value }) {
  return (
    <div style={{ display:'flex', gap:8, paddingBottom:5, marginBottom:5, borderBottom:'1px solid #f8fafc' }}>
      <div style={{ width:68, fontSize:12, color:'#94a3b8', flexShrink:0 }}>{label}</div>
      <div style={{ flex:1, fontSize:13, color:'#1e293b', wordBreak:'break-all' }}>{value || '-'}</div>
    </div>
  );
}
function AgreeBadge({ label, ok }) {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, marginRight:8, marginBottom:4, padding:'3px 10px', borderRadius:20, background: ok ? '#f0fdf4' : '#f8fafc', color: ok ? '#059669' : '#94a3b8', fontSize:12, fontWeight:600 }}>
      {ok ? '✅' : '☐'} {label}
    </span>
  );
}

// ── 인쇄용 HTML 생성 ──────────────────────────
function buildAutoDebitHTML(d) {
  const isAccount = d.payType === 'account';
  const today     = d.appliedDateStr || new Date().toLocaleDateString('ko-KR');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Malgun Gothic','맑은 고딕',serif; padding:15mm 18mm; font-size:9pt; color:#111; width:210mm; }
  h1 { text-align:center; font-size:18pt; font-weight:bold; letter-spacing:6px; margin:4mm 0; padding:3mm 0; border-top:2px solid #111; border-bottom:2px solid #111; }
  .subtitle { text-align:center; font-size:9pt; margin-bottom:4mm; }
  .notice { font-size:7.5pt; color:#333; line-height:1.6; margin-bottom:4mm; padding:3mm; border:1px solid #ccc; border-radius:2mm; background:#fafafa; }
  .section-title { font-size:9pt; font-weight:bold; margin:3mm 0 1mm; }
  table { width:100%; border-collapse:collapse; margin-bottom:3mm; }
  td { border:1px solid #888; padding:2mm 3mm; font-size:8.5pt; vertical-align:middle; }
  .label { background:#f5f5f5; font-weight:bold; text-align:center; width:28mm; }
  .law-box { font-size:7pt; line-height:1.6; margin:3mm 0; padding:3mm; border:1px solid #ccc; }
  .law-box h3 { font-size:8pt; font-weight:bold; margin-bottom:2mm; }
  .law-box ol { padding-left:4mm; }
  .sig-section { margin-top:4mm; border-top:1px solid #888; padding-top:3mm; }
  .sig-row { display:flex; justify-content:space-between; align-items:flex-end; margin-top:3mm; }
  .sig-box { text-align:center; }
  .sig-img { width:35mm; height:15mm; border:1px solid #ccc; object-fit:contain; display:block; margin:1mm auto 0; }
  @media print { body { padding:10mm 15mm; } }
</style>
</head>
<body>
  <h1>계좌/신용카드 자동출금 이용신청서</h1>
  <div class="subtitle">☑ 신규 &nbsp; □ 변경 &nbsp; □ 해지</div>

  <div class="notice">
    ※ 전자금융거래법 관련 규정(시행령 10조)에 의거, 자동이체 신청시에는 반드시 서면/공인인증서/녹취를 통한 예금주/카드주/휴대폰명의자 본인의 동의가 필요합니다.
  </div>

  <div class="section-title">◈ 수납기관 및 요금정보</div>
  <table>
    <tr>
      <td class="label">수납기관명</td><td>화이트라인</td>
      <td class="label">자동이체사유</td><td>${d.reason || '방역 서비스 이용료'}</td>
    </tr>
    <tr>
      <td class="label">금 액</td><td>${Number(d.amount||0).toLocaleString()} 원</td>
      <td class="label">통장기재내역</td><td>화이트라인</td>
    </tr>
  </table>

  <div class="section-title">◈ 납부자 정보</div>
  <table>
    <tr>
      <td class="label">납부자번호(고객번호)</td>
      <td>${d.customerCode || ''}</td>
      <td class="label">이체개시 년월</td>
      <td>${d.debitStartYear || ''}년 ${d.debitStartMonth || ''}월</td>
      <td class="label">지정 출금일</td>
      <td>매월 ${d.debitDay || ''}일</td>
    </tr>
  </table>

  <div class="section-title">◈ 신청인 정보</div>
  <table>
    <tr>
      <td class="label">신청인 성명</td><td>${d.applicantName || ''}</td>
      <td class="label">이메일</td><td>${d.email || ''}</td>
    </tr>
    <tr>
      <td class="label">주 소</td><td colspan="3">(${d.zipCode || ''}) ${d.address || ''}</td>
    </tr>
    <tr>
      <td class="label">연락처</td><td>${d.phone || ''}</td>
      <td class="label">휴대폰번호</td><td>${d.mobile || ''}</td>
    </tr>
    <tr>
      <td class="label">결제수단</td>
      <td colspan="3">${isAccount ? '☑ 계좌(CMS) &nbsp; □ 신용카드' : '□ 계좌(CMS) &nbsp; ☑ 신용카드'}</td>
    </tr>
    <tr>
      <td class="label">${isAccount ? '은행명' : '카드사'}</td>
      <td>${isAccount ? (d.bankName || '') : (d.cardCompany || '')}</td>
      <td class="label">사업자번호</td>
      <td>${d.businessNo || ''}</td>
    </tr>
    <tr>
      <td class="label">예금주/카드주 본인명</td>
      <td>${isAccount ? (d.accountHolder || '') : (d.cardHolder || '')}</td>
      <td class="label">계좌/카드번호</td>
      <td>${isAccount ? (d.accountNumber || '') : (d.cardNumber || '')}</td>
    </tr>
    <tr>
      <td class="label">예금주/카드주 주민번호 앞6자리</td>
      <td>${isAccount ? (d.ownerIdFront || '') : (d.cardOwnerIdFront || '')} - *******</td>
      <td class="label">카드유효기간</td>
      <td>${!isAccount ? `${d.cardExpireMonth || ''} / ${d.cardExpireYear || ''}` : ''}</td>
    </tr>
  </table>

  <div class="law-box">
    <h3>자동이체 서비스 이용 약관</h3>
    <ol>
      <li>이용자는 본 신청서에 서명하거나 공인인증 및 그에 준하는 전자 인증절차를 통함으로써 본 서비스를 이용할 수 있습니다.</li>
      <li>회사는 서비스 제공을 위하여 이용자가 제출한 지급결제수단 정보를 해당 금융기관(통신사 포함)에 제공할 수 있습니다.</li>
      <li>자동이체 개시일을 이용자가 지정하지 않은 경우 재화 등을 공급하는 자로부터 사전 통지 받은 납기일을 최초 개시일로 합니다.</li>
      <li>출금이체 금액은 해당 지정 출금일 영업 시간 내에 입금된 예금에 한하여 출금 처리됩니다.</li>
      <li>납기일에 동일한 수종의 자동이체 청구가 있는 경우 이체 우선 순위는 이용자의 거래 금융기관이 정하는 바에 따릅니다.</li>
      <li>자동이체 납부일이 영업일이 아닌 경우에는 다음 영업일을 납부일로 합니다.</li>
      <li>이용자가 자동이체 신청(신규, 해지, 변경)을 원하는 경우 해당 납기일 30일 전까지 회사에 통지해야 합니다.</li>
    </ol>
    <br>
    <h3>개인정보 수집 및 이용동의</h3>
    <ol>
      <li>수집 및 이용목적 : 자동이체서비스를 통한 요금 수납, 민원처리 및 상담요청 응답</li>
      <li>수집항목 : 성명, 전화번호, 은행명, 계좌번호, 예금주명, 주민번호앞6자리, 카드번호, 카드사, 카드주, 카드유효기간, 이메일</li>
      <li>보유 및 이용기간 : 수집 이용 동의일부터 자동이체서비스 종료일(해지일)까지, 해지일로부터 5년간 보존 후 파기</li>
    </ol>
    <br>
    <h3>문자(SMS)발송 동의</h3>
    <p>1. 자동이체 동의 및 처리결과 안내(휴대폰 문자전송) 송부에 동의합니다.</p>
  </div>

  <div style="font-size:8pt; line-height:1.8; margin:3mm 0; padding:3mm 0; border-top:1px solid #888; border-bottom:1px solid #888;">
    상기 자동이체 신청과 관련하여 계좌예금주/카드주로서 자동이체서비스 이용약관과 개인정보 수집 및 이용동의,
    개인정보 취급 위탁에 동의, 문자(SMS)발송에 동의하며, 자동출금이체서비스를 신청합니다.
  </div>

  <div class="sig-section">
    <div style="text-align:center; font-size:10pt; margin-bottom:4mm;">${today}</div>
    <div class="sig-row">
      <div class="sig-box">
        <div style="font-size:8.5pt;">신 청 인</div>
        <div style="font-size:9pt; font-weight:bold; margin-top:1mm;">${d.applicantName || ''}</div>
        ${d.signatureData ? `<img src="${d.signatureData}" class="sig-img" alt="서명">` : '<div class="sig-img"></div>'}
        <div style="font-size:8pt; margin-top:1mm;">(인) 또는 서명</div>
      </div>
      <div class="sig-box">
        <div style="font-size:8.5pt;">예금주/카드주 동의란</div>
        <div style="font-size:9pt; font-weight:bold; margin-top:1mm;">
          ${d.ownerDiff ? (d.payType === 'account' ? (d.accountHolder||'') : (d.cardHolder||'')) : (d.applicantName||'')}
        </div>
        ${(d.ownerDiff && d.ownerSignatureData) ? `<img src="${d.ownerSignatureData}" class="sig-img" alt="예금주서명">` : (d.signatureData ? `<img src="${d.signatureData}" class="sig-img" alt="서명">` : '<div class="sig-img"></div>')}
        <div style="font-size:8pt; margin-top:1mm;">(인) 또는 서명</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

const S = {
  panel:       { height:'100%', display:'flex', flexDirection:'column', background:'#f8fafc' },
  header:      { background:'linear-gradient(135deg,#1e40af,#2563eb)', padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 },
  closeBtn:    { background:'rgba(255,255,255,0.2)', border:'none', borderRadius:6, color:'white', fontSize:14, width:28, height:28, cursor:'pointer' },
  backIconBtn: { background:'rgba(255,255,255,0.2)', border:'none', borderRadius:6, color:'white', fontSize:16, width:28, height:28, cursor:'pointer' },
  printBtn:    { background:'rgba(255,255,255,0.2)', border:'1px solid rgba(255,255,255,0.3)', borderRadius:6, color:'white', fontSize:12, fontWeight:600, padding:'4px 10px', cursor:'pointer' },
  badge:       { background:'#f59e0b', color:'white', fontSize:11, fontWeight:700, padding:'2px 7px', borderRadius:10, lineHeight:'16px' },
  filterRow:   { display:'flex', gap:4, padding:'10px 12px', background:'white', borderBottom:'1px solid #e2e8f0', flexShrink:0 },
  filterBtn:   { flex:1, padding:'6px 4px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:11, fontWeight:600, color:'#64748b', background:'white', cursor:'pointer' },
  filterBtnActive: { background:'#eff6ff', borderColor:'#2563eb', color:'#2563eb' },
  list:        { flex:1, overflowY:'auto', padding:12 },
  empty:       { textAlign:'center', padding:'40px 0', color:'#94a3b8', display:'flex', flexDirection:'column', alignItems:'center', gap:8, fontSize:14 },
  card:        { background:'white', borderRadius:10, padding:'12px 14px', marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,0.06)', cursor:'pointer', display:'flex', alignItems:'center', gap:10 },
  statusBadge: { fontSize:11, fontWeight:600, padding:'3px 9px', borderRadius:20, display:'inline-block', whiteSpace:'nowrap' },
  detail:      { flex:1, overflowY:'auto', padding:12 },
  actionBtn:   (bg) => ({ padding:'6px 14px', background:bg, color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' }),
};
