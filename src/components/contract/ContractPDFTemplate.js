import React, { useRef, useState } from 'react';
import { doc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { CLAUSE_KEYS, CLAUSE_META, DEFAULT_CLAUSES, priceToKorean } from './contractConstants';
import { notifyContractSent } from '../../utils/notifyCustomer';

function ContractPDFTemplate({ contract, settings, onBack, onSave }) {
  const printRef = useRef();
  const [signLinkCopied, setSignLinkCopied] = useState(false);
  const c = contract;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const contractDateStr = c.contractStart
    ? `${c.contractStart} ~ ${c.contractEnd || '별도 협의'}`
    : dateStr;

  const handleDownloadPDF = async () => {
    Swal.fire({ title: 'PDF 생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).default;
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
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
      const fileName = `계약서_${c.custName || '고객'}_${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}.pdf`;
      pdf.save(fileName);
      Swal.fire({ icon: 'success', title: 'PDF 저장 완료', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', 'PDF 생성 실패: ' + e.message, 'error');
    }
  };

  // 서명 요청 링크 생성 및 발송
  const handleSignRequest = async () => {
    if (!c.id) {
      Swal.fire('알림', '먼저 계약서를 저장하세요.', 'warning');
      return;
    }
    try {
      // 계약서 상태를 'sent'로 변경
      await updateDoc(doc(db, 'contracts', c.id), {
        status: 'sent',
        sentAt: new Date().toISOString(),
      });
      const link = `${window.location.origin}/contract-sign/${c.id}`;
      await navigator.clipboard.writeText(link);
      setSignLinkCopied(true);
      setTimeout(() => setSignLinkCopied(false), 3000);

      // 고객앱 알림 발송 (앱 없으면 무시됨)
      notifyContractSent(
        { ...c, customerCode: c.customerCode || c.custCode || '' },
        c.customerId || null,
      ).catch(() => {});

      Swal.fire({
        icon: 'success',
        title: '🔗 서명 링크 복사 완료!',
        html: `
          <div style="text-align:left;padding:0 10px;">
            <p style="font-size:13px;color:#64748b;margin-bottom:10px;">아래 링크를 고객에게 카카오톡/문자로 전달하세요.</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12px;word-break:break-all;color:#1e3a5f;">
              ${link}
            </div>
            <p style="font-size:12px;color:#94a3b8;margin-top:8px;">고객이 링크 접속 → 계약서 확인 → 서명 → 담당자에게 알림</p>
            <div style="margin-top:8px;font-size:11px;background:#f0fdf4;color:#059669;padding:6px 10px;border-radius:6px;">
              📱 고객앱이 설치되어 있다면 앱 알림도 함께 전송됩니다
            </div>
          </div>
        `,
      });
    } catch (e) {
      Swal.fire('오류', '링크 생성 실패: ' + e.message, 'error');
    }
  };

  const handleShare = async () => {
    const text = `[화이트라인 계약서]\n고객: ${c.custName}\n계약기간: ${contractDateStr}\n월 비용: ${(c.monthlyFee||0).toLocaleString()}원\n\n서명 링크: (별도 안내 예정)`;
    await navigator.clipboard.writeText(text);
    Swal.fire({ icon: 'success', title: '계약서 정보 복사 완료', timer: 1500, showConfirmButton: false });
  };

  // 활성화된 조항만 순서대로
  const enabledClauses = CLAUSE_KEYS
    .filter(key => c.clauses?.[key]?.enabled)
    .map((key, idx) => ({
      key,
      number: idx + 1,
      label: CLAUSE_META[key]?.label || key,
      content: (c.clauses[key]?.content || DEFAULT_CLAUSES[key] || '')
        .replace('{{contractDuration}}', c.contractDuration || '1년'),
    }));

  const formatPrice = (price) => price ? price.toLocaleString() + '원' : '0원';

  return (
    <div style={ps.wrap}>
      {/* 툴바 */}
      <div style={ps.toolbar} className="no-print">
        <button onClick={onBack} style={ps.backBtn}>← 뒤로</button>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold', color: '#1e3a5f' }}>계약서 미리보기</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleSignRequest}
            style={{ ...ps.shareBtn, background: signLinkCopied ? '#10b981' : '#1e3a5f' }}>
            {signLinkCopied ? '✅ 복사됨' : '✍️ 서명요청'}
          </button>
          <button onClick={handleShare} style={ps.shareBtn}>🔗 공유</button>
          <button onClick={handleDownloadPDF} style={ps.pdfBtn}>📥 PDF</button>
          {onSave && <button onClick={onSave} style={ps.saveBtn}>💾 저장</button>}
        </div>
      </div>

      {/* PDF 미리보기 */}
      <div style={ps.previewWrap}>
        <div ref={printRef} style={ps.page}>

          {/* 헤더 */}
          <div style={ps.header}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {settings.companyLogo && <img src={settings.companyLogo} alt="로고" style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '6px' }} />}
              <div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1e3a5f' }}>{settings.companyName || '화이트라인'}</div>
                {settings.companyAddress && <div style={{ fontSize: '10px', color: '#64748b' }}>{settings.companyAddress}</div>}
                {settings.companyPhone && <div style={{ fontSize: '10px', color: '#64748b' }}>Tel: {settings.companyPhone}</div>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#1e3a5f', letterSpacing: '4px' }}>계 약 서</div>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>작성일: {dateStr}</div>
            </div>
          </div>

          {/* 계약 개요 표 */}
          <table style={ps.overviewTable}>
            <tbody>
              <tr>
                <td style={ps.ovLabel}>업 장 명</td>
                <td style={ps.ovVal}><b>{c.custName || ''}</b></td>
                <td style={ps.ovLabel}>연 락 처</td>
                <td style={ps.ovVal}>{c.phone || ''}</td>
              </tr>
              <tr>
                <td style={ps.ovLabel}>담 당 자</td>
                <td style={ps.ovVal}>{c.staffName || ''}</td>
                <td style={ps.ovLabel}>대상 해충</td>
                <td style={ps.ovVal}>{c.targetPests || '바퀴벌레, 개미, 쥐'}</td>
              </tr>
              <tr>
                <td style={ps.ovLabel}>주 소</td>
                <td style={ps.ovVal} colSpan={3}>{c.address || ''}</td>
              </tr>
              <tr>
                <td style={ps.ovLabel}>서비스 구획</td>
                <td style={ps.ovVal} colSpan={3}>{c.serviceScope || '전체'}</td>
              </tr>
              <tr>
                <td style={ps.ovLabel}>방 제 횟 수</td>
                <td style={ps.ovVal}>월 {c.visitPerMonth || 1}회</td>
                <td style={ps.ovLabel}>계 약 면 적</td>
                <td style={ps.ovVal}>{c.area ? `${c.area}평` : '-'}</td>
              </tr>
              <tr>
                <td style={ps.ovLabel}>계 약 기 간</td>
                <td style={ps.ovVal} colSpan={3}>{contractDateStr}</td>
              </tr>
              <tr>
                <td style={ps.ovLabel}>결 제 방 법</td>
                <td style={ps.ovVal} colSpan={3}>{c.paymentMethod || ''} · {c.paymentDay || ''}</td>
              </tr>
            </tbody>
          </table>

          {/* 방역 비용 표 */}
          <table style={{ ...ps.overviewTable, marginBottom: '14px' }}>
            <thead>
              <tr style={{ background: '#1e3a5f', color: 'white' }}>
                <th style={ps.costTh}>구 분</th>
                <th style={ps.costTh}>기 간 / 수 량</th>
                <th style={ps.costTh}>금 액</th>
                <th style={ps.costTh}>비 고</th>
              </tr>
            </thead>
            <tbody>
              {c.initialFee > 0 && (
                <tr>
                  <td style={ps.costTd}>초 기</td>
                  <td style={ps.costTdC}>-</td>
                  <td style={{ ...ps.costTdR, fontWeight: 'bold' }}>{formatPrice(c.initialFee)}</td>
                  <td style={ps.costTd}>*면세</td>
                </tr>
              )}
              <tr>
                <td style={ps.costTd}>정 기</td>
                <td style={ps.costTdC}>매월 {c.visitPerMonth}회</td>
                <td style={{ ...ps.costTdR, fontWeight: 'bold', color: '#1e3a5f' }}>{formatPrice(c.monthlyFee)}</td>
                <td style={ps.costTd}></td>
              </tr>
              {c.trapCount > 0 && (
                <tr style={{ background: '#fef3c7' }}>
                  <td style={ps.costTd}>포 충 기</td>
                  <td style={ps.costTdC}>{c.trapCount}대</td>
                  <td style={{ ...ps.costTdR, fontWeight: 'bold', color: '#d97706' }}>{formatPrice(c.trapMonthlyFee * c.trapCount)}/월</td>
                  <td style={{ ...ps.costTd, fontSize: '10px', color: '#92400e' }}>
                    {c.trapWinterExempt ? '동절기(12~3월) 면제' : ''}
                  </td>
                </tr>
              )}
              <tr style={{ background: '#f0f9ff' }}>
                <td style={{ ...ps.costTd, fontWeight: 'bold' }} colSpan={2}>월 합 계</td>
                <td style={{ ...ps.costTdR, fontWeight: 'bold', fontSize: '15px', color: '#1e3a5f' }}>
                  {formatPrice((c.monthlyFee || 0) + (c.trapCount > 0 ? (c.trapMonthlyFee || 0) * c.trapCount : 0))}
                </td>
                <td style={ps.costTd}></td>
              </tr>
            </tbody>
          </table>

          <div style={ps.autoRenewNote}>
            ※ 위 계약기간 1개월 전까지 특별한 사유가 없는 한 동일한 조건으로 자동 연장됩니다.
          </div>

          <div style={ps.divider} />

          {/* 기본 계약 내용 (활성화된 조항) */}
          <div style={ps.clauseTitle}>기 본 계 약 내 용</div>
          {enabledClauses.map((clause) => (
            <div key={clause.key} style={ps.clauseBlock}>
              <div style={ps.clauseLabel}>{clause.label.replace(/제\d+조 /, `제${clause.number}조 `)}</div>
              <div style={ps.clauseContent}>
                {clause.content.split('\n').map((line, i) => (
                  <div key={i} style={{ lineHeight: '1.7', fontSize: '11px', color: '#1e293b' }}>{line}</div>
                ))}
              </div>
            </div>
          ))}

          {/* 유의사항 */}
          {c.includeNotices !== false && c.notices?.length > 0 && (
            <div style={ps.noticeBox}>
              <div style={{ fontWeight: 'bold', color: '#1e3a5f', fontSize: '12px', marginBottom: '6px' }}>★ 유의사항</div>
              {c.notices.map((notice, i) => notice && (
                <div key={i} style={{ fontSize: '11px', color: '#374151', marginBottom: '3px', lineHeight: '1.5' }}>
                  {i + 1}. {notice}
                </div>
              ))}
            </div>
          )}

          {/* 개인정보 처리 동의 (privacy 조항이 활성인 경우 별도 박스로) */}
          {c.clauses?.privacy?.enabled && (
            <div style={{ ...ps.noticeBox, background: '#f0f9ff', borderColor: '#bae6fd', marginTop: '10px' }}>
              <div style={{ fontWeight: 'bold', color: '#0369a1', fontSize: '12px', marginBottom: '6px' }}>
                ※ 개인정보 처리 동의서
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                <thead>
                  <tr style={{ background: '#0369a1', color: 'white' }}>
                    <th style={{ padding: '4px 8px', border: '1px solid rgba(255,255,255,0.3)', textAlign: 'left' }}>개인정보 항목</th>
                    <th style={{ padding: '4px 8px', border: '1px solid rgba(255,255,255,0.3)' }}>수집·이용 목적</th>
                    <th style={{ padding: '4px 8px', border: '1px solid rgba(255,255,255,0.3)' }}>보유기간</th>
                    <th style={{ padding: '4px 8px', border: '1px solid rgba(255,255,255,0.3)' }}>동의여부</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 8px', border: '1px solid #e2e8f0' }}>고객명, 주소, 연락처, 사업자번호, 결제정보</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>계약 이행 및 서비스 제공</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>계약 종료 후 3년</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>□ 동의</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* 서명란 */}
          <div style={ps.signSection}>
            <div style={{ textAlign: 'center', fontSize: '12px', color: '#374151', marginBottom: '16px' }}>
              본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하여 서명·날인하고 각 1통씩 보관합니다.
            </div>
            <div style={{ textAlign: 'center', color: '#374151', marginBottom: '16px', fontSize: '13px' }}>
              {c.contractStart || dateStr}
            </div>
            <div style={ps.signRow}>
              {/* 고객 (갑) */}
              <div style={ps.signBox}>
                <div style={ps.signRole}>도 급 인 (갑)</div>
                {c.address && <div style={ps.signDetail}>주 소: {c.address}</div>}
                {c.businessNumber && <div style={ps.signDetail}>사업자: {c.businessNumber}</div>}
                <div style={ps.signDetail}>상 호: {c.custName || ''}</div>
                {c.representativeName && <div style={ps.signDetail}>대 표: {c.representativeName}</div>}
                <div style={ps.signLine}>
                  <span>대표이사</span>
                  <div style={ps.signBlank}>(인)</div>
                </div>
              </div>

              {/* 화이트라인 (을) */}
              <div style={ps.signBox}>
                <div style={ps.signRole}>수 급 인 (을)</div>
                {settings.companyAddress && <div style={ps.signDetail}>주 소: {settings.companyAddress}</div>}
                <div style={ps.signDetail}>상 호: {settings.companyName || '화이트라인'}</div>
                <div style={ps.signDetail}>대 표: {c.representativeStaff || '김현숙'}</div>
                <div style={ps.signLine}>
                  <span>대표이사</span>
                  {settings.sealImage ? (
                    <img src={settings.sealImage} alt="직인" style={{ width: '50px', height: '50px', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ ...ps.signBlank, borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>(인)</div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @media print { .no-print { display: none !important; } body { background: white; } }
      `}</style>
    </div>
  );
}

const ps = {
  wrap: { paddingBottom: '30px' },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'white', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 100, gap: '8px' },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', padding: '4px 8px', whiteSpace: 'nowrap' },
  shareBtn: { padding: '8px 12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  pdfBtn: { padding: '8px 12px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  saveBtn: { padding: '8px 12px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  previewWrap: { background: '#f1f5f9', padding: '10px' },
  page: { background: 'white', padding: '24px 28px', maxWidth: '794px', margin: '0 auto', fontFamily: 'Malgun Gothic, Apple SD Gothic Neo, sans-serif', fontSize: '11px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', paddingBottom: '14px', borderBottom: '2px solid #1e3a5f' },
  overviewTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '8px', fontSize: '11px' },
  ovLabel: { padding: '6px 10px', background: '#1e3a5f', color: 'white', fontWeight: 'bold', border: '1px solid #1e3a5f', width: '80px', textAlign: 'center', whiteSpace: 'nowrap' },
  ovVal: { padding: '6px 10px', border: '1px solid #e2e8f0', minWidth: '100px' },
  costTh: { padding: '7px 10px', textAlign: 'center', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.2)' },
  costTd: { padding: '7px 10px', border: '1px solid #e2e8f0' },
  costTdC: { padding: '7px 10px', border: '1px solid #e2e8f0', textAlign: 'center' },
  costTdR: { padding: '7px 10px', border: '1px solid #e2e8f0', textAlign: 'right' },
  autoRenewNote: { fontSize: '10px', color: '#64748b', marginBottom: '12px', fontStyle: 'italic' },
  divider: { border: 'none', borderTop: '1px solid #e2e8f0', margin: '12px 0' },
  clauseTitle: { fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', textAlign: 'center', marginBottom: '10px', letterSpacing: '2px' },
  clauseBlock: { marginBottom: '10px' },
  clauseLabel: { fontSize: '12px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '4px' },
  clauseContent: { paddingLeft: '12px' },
  noticeBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', marginTop: '12px' },
  signSection: { marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' },
  signRow: { display: 'flex', gap: '20px', justifyContent: 'center' },
  signBox: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 20px', flex: 1, maxWidth: '300px' },
  signRole: { fontSize: '13px', fontWeight: 'bold', color: '#1e3a5f', textAlign: 'center', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #e2e8f0' },
  signDetail: { fontSize: '11px', color: '#374151', marginBottom: '4px' },
  signLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' },
  signBlank: { border: '1px solid #e2e8f0', padding: '4px 12px', fontSize: '11px', color: '#94a3b8' },
};

export default ContractPDFTemplate;
