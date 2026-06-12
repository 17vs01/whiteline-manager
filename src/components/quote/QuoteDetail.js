import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import Swal from 'sweetalert2';
import {
  SERVICE_ITEMS, BUSINESS_TO_PRICE_CATEGORY, UNIT_BASED_TYPES,
  getPriceByArea, formatPrice, priceToKorean,
  COMPARE_LABELS, QUOTE_STATUS_EXTENDED, emptyInsectTrap, defaultLinkSettings,
  TRAP_LOCATION_PRESETS, DEFAULT_QUOTE_VALIDITY_DAYS,
} from './quoteConstants';
import QuoteTemplates, { saveAsTemplate } from './QuoteTemplates';
import QuotePDFTemplate from './QuotePDFTemplate';
import QuotePriceTable from './QuotePriceTable';

// 방제 서비스 내용 기본값
const DEFAULT_SERVICE_CONTENT = {
  showGeneral: true,
  showRodent: false,
  showDisinfection: false,
  pests: {
    cockroach: true, ant: true, fly: true, fruitfly: false,
    bedbug: false, cigarette: false, silverfish: false,
    dustlouse: false, centipede: false, mosquito: false, other: false,
  },
  includeReport: true,
  includeRodentBox: true,
};

const DEFAULT_PLAN_ROWS = [
  { key: 'bait',      label: '보행해충 베이트/트랩' },
  { key: 'outdoor',   label: '외곽 잔류분무' },
  { key: 'indoor',    label: '내부 잔류분무' },
  { key: 'rodentbox', label: '구서함 점검/트랩교체' },
  { key: 'rodentout', label: '외곽 구서작업' },
  { key: 'disinfect', label: '살균작업(협의)' },
];

const makeDefaultPlanGrid = () => {
  const grid = {};
  DEFAULT_PLAN_ROWS.forEach(row => { grid[row.key] = Array(12).fill(true); });
  return grid;
};

const emptyQuote = () => ({
  title: 'A안',
  services: [],
  visitPerMonth: 1,
  hasInitial: false,
  initialMonths: 2,
  initialVisitsPerMonth: 2,
  initialExtraRate: 40,
  monthlyTotal: 0,
  initialTotal: 0,
  photos: [],
  memo: '',
  serviceContent: { ...DEFAULT_SERVICE_CONTENT, pests: { ...DEFAULT_SERVICE_CONTENT.pests } },
  planGrid: makeDefaultPlanGrid(),
  planRows: DEFAULT_PLAN_ROWS.map(r => ({ ...r, visible: true })),
  insectTrap: emptyInsectTrap(),
  zoneServices: [],
  linkSettings: defaultLinkSettings(),
  monthlyVisits: Array(12).fill(null),
  monthlyVisitPriceChange: Array(12).fill(false),
  showMonthlyTable: true,
  validityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
  // [ADD] 기간 설정
  periodType: 'none',       // 'none' | 'specific'
  periodMonths: 1,          // 개월수 선택 시
  periodSpecific: [],       // 특정 월 체크 [1,2,...,12]
  // [ADD] 금액 편집
  priceOverride: false,
  priceOverrideAmount: 0,
  priceExtraItems: [],      // [{label, amount}]
});

function QuoteDetail({ quoteCustomer, initialQuoteId, currentUser, staffList, onBack, onConvert, onCreateContract, onNavigateToContract }) {
  const [quotes, setQuotes] = useState([]);           // 저장된 견적서 목록
  const [activeIdx, setActiveIdx] = useState(0);      // 현재 선택 탭 인덱스
  const [editingQuote, setEditingQuote] = useState(null); // 편집 중인 견적
  const [showPDF, setShowPDF] = useState(false);
  const [showPriceTable, setShowPriceTable] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [qnaList, setQnaList] = useState([]);
  const [showQnA, setShowQnA] = useState(false);
  const { settings } = useAppContext();
  const [loading, setLoading] = useState(true);


  const fetchQnA = async (loadedQuotes) => {
    try {
      const snap = await getDocs(collection(db, 'quoteQnA'));
      const quoteIds = Array.isArray(loadedQuotes) ? loadedQuotes.map(q => q.id) : [];
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(q => quoteIds.includes(q.quoteId) || q.quoteCustomerId === quoteCustomer.id)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setQnaList(list);
    } catch (e) { console.error('Q&A 로드 오류:', e); }
  };

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'quotes'));
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(q => q.quoteCustomerId === quoteCustomer.id)
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setQuotes(list);
      if (list.length === 0) {
        setEditingQuote({ ...emptyQuote(), label: 'A', title: 'A안' });
      } else {
        const targetIdx = initialQuoteId ? list.findIndex(q => q.id === initialQuoteId) : 0;
        setActiveIdx(targetIdx >= 0 ? targetIdx : 0);
      }
      // quotes 로드 완료 후 Q&A 로드 (정확한 quoteId 기반 필터링)
      await fetchQnA(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [quoteCustomer.id, initialQuoteId]);

  useEffect(() => {
    fetchQuotes();
    // settings는 AppContext에서 가져오므로 별도 fetch 불필요
  }, [fetchQuotes]);

  // 새 견적 추가
  const handleAddQuote = () => {
    const nextLabel = COMPARE_LABELS[quotes.length] || String(quotes.length + 1);
    setEditingQuote({ ...emptyQuote(), label: nextLabel, title: `${nextLabel}안` });
  };

  // 기존 견적 편집
  const handleEditQuote = (q) => {
    setEditingQuote({ ...q });
  };

  // 견적 저장
  const handleSaveQuote = async (data) => {
    try {
      Swal.fire({ title: '저장 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const payload = {
        ...data,
        quoteCustomerId: quoteCustomer.id,
        custName: quoteCustomer.custName,
        updatedAt: new Date().toISOString(),
      };
      if (data.id) {
        const { id, ...rest } = payload;
        await updateDoc(doc(db, 'quotes', data.id), rest);
      } else {
        payload.createdAt = new Date().toISOString();
        payload.createdBy = currentUser?.name || '';
        payload.status = 'draft';
        await addDoc(collection(db, 'quotes'), payload);
      }
      setEditingQuote(null);
      await fetchQuotes();
      Swal.fire({ icon: 'success', title: '저장 완료', timer: 1000, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '저장 실패: ' + e.message, 'error');
    }
  };

  // 견적 삭제
  const handleDeleteQuote = async (q) => {
    const r = await Swal.fire({
      title: `"${q.title}" 견적 삭제`,
      text: '이 견적서를 삭제하시겠습니까?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
    });
    if (!r.isConfirmed) return;
    await deleteDoc(doc(db, 'quotes', q.id));
    await fetchQuotes();
  };

  // 견적 → 계약서 생성
  const handleCreateContract = async (q) => {
    const PEST_LABELS = {
      cockroach:'바퀴벌레', ant:'개미', fly:'파리', fruitfly:'초파리',
      bedbug:'빈대', cigarette:'권연벌레', silverfish:'좀벌레',
      dustlouse:'먼지다듬이', centipede:'그리마', mosquito:'모기', other:'기타해충'
    };
    const sc = q.serviceContent || {};
    const pestList = Object.entries(sc.pests || {})
      .filter(([,v]) => v).map(([k]) => PEST_LABELS[k]).join(', ') || '바퀴벌레, 개미, 쥐';

    // 계약서 타입 선택
    const contractType = await new Promise((resolve) => {
      let resolved = false;
      const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

      const btnStyle = (bg) =>
        `display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;` +
        `background:${bg};color:white;border:none;border-radius:10px;cursor:pointer;` +
        `font-size:13px;font-weight:bold;text-align:left;margin-bottom:8px;`;

      Swal.fire({
        title: '📃 계약서 타입 선택',
        html: `
          <div style="text-align:left;padding:0 4px;">
            <p style="font-size:13px;color:#64748b;margin-bottom:12px;">
              <b>${quoteCustomer.custName}</b>의 견적 데이터로 계약서를 생성합니다.
            </p>
            <button id="ctype-basic" style="${btnStyle('#1e3a5f')}">
              <span style="font-size:20px;">📋</span>
              <div><div>소규모/일반</div><div style="font-size:11px;font-weight:normal;opacity:0.85;">일반 음식점, 소규모 사업장</div></div>
            </button>
            <button id="ctype-corporate" style="${btnStyle('#0369a1')}">
              <span style="font-size:20px;">🏢</span>
              <div><div>대형/도급</div><div style="font-size:11px;font-weight:normal;opacity:0.85;">백화점, 대형 건물, 도급계약</div></div>
            </button>
            <button id="ctype-public" style="${btnStyle('#065f46')}">
              <span style="font-size:20px;">🏛️</span>
              <div><div>관공서/법인</div><div style="font-size:11px;font-weight:normal;opacity:0.85;">관공서, 학교, 공공기관</div></div>
            </button>
          </div>`,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: '취소',
        width: '92%',
        didOpen: () => {
          ['basic', 'corporate', 'public'].forEach(key => {
            const btn = document.getElementById(`ctype-${key}`);
            if (btn) btn.addEventListener('click', () => { done(key); Swal.close(); });
          });
        },
        willClose: () => done(null),
      });
    });
    if (!contractType) return;

    // Firebase에 계약서 저장
    try {
      Swal.fire({ title: '계약서 생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const { getDefaultClauses } = await import('../contract/contractConstants');
      const payload = {
        // 고객 정보
        custName: quoteCustomer.custName || '',
        phone: quoteCustomer.phone || '',
        address: quoteCustomer.address || '',
        businessType: quoteCustomer.businessType || '',
        area: quoteCustomer.area || '',
        // 계약 조건
        visitPerMonth: q.visitPerMonth || 1,
        monthlyFee: q.monthlyTotal || 0,
        initialFee: q.hasInitial ? (q.initialTotal || 0) : 0,
        contractDuration: '1년',
        serviceScope: (quoteCustomer.zones || []).filter(z=>z.include).map(z=>z.label).join(', ') || '전체',
        targetPests: pestList,
        // 포충기
        trapCount: q.insectTrap?.enabled ? (q.insectTrap.count || 0) : 0,
        trapMonthlyFee: q.insectTrap?.enabled ? (q.insectTrap.unitPrice || 0) : 0,
        trapUnitPrice: q.insectTrap?.unitPrice || 0,
        trapWinterExempt: false,
        // 결제
        paymentMethod: '송금',
        paymentDay: '말일',
        // 담당자
        staffName: q.createdBy || currentUser?.name || '',
        representativeStaff: '김현숙',
        // 조항
        contractType,
        clauses: getDefaultClauses(contractType),
        // 메타
        fromQuoteId: q.id,
        fromQuoteCustomerId: quoteCustomer.id,
        status: 'draft',
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.name || '',
      };
      const { addDoc, collection: fiCol } = await import('firebase/firestore');
      const { db: fireDb } = await import('../../firebase');
      await addDoc(fiCol(fireDb, 'contracts'), payload);

      // 견적 상태 업데이트
      await updateDoc(doc(db, 'quotes', q.id), {
        status: 'contracted',
        contractedAt: new Date().toISOString(),
      });
      await fetchQuotes();

      Swal.fire({
        icon: 'success',
        title: '🎉 계약서 생성 완료!',
        html: '<div style="font-size:13px;color:#64748b;">계약서 탭에서 확인 및 수정 후 서명 요청하세요.</div>',
        confirmButtonText: '계약서 탭으로 이동',
        showCancelButton: true,
        cancelButtonText: '여기 머물기',
      }).then(r => {
        if (r.isConfirmed && onNavigateToContract) {
          onNavigateToContract();
        }
      });
    } catch (e) {
      Swal.fire('오류', '계약서 생성 실패: ' + e.message, 'error');
    }
  };

  // 견적 복사
  const handleCopyQuote = async (q) => {
    const r = await Swal.fire({
      title: '📋 견적 복사',
      html: `<div style="text-align:left;padding:0 10px;">
        <p style="margin-bottom:8px;">"<b>${q.title}</b>" 견적을 복사합니다.</p>
        <label style="font-size:13px;color:#666;">복사본 이름</label>
        <input id="copy-title" class="swal2-input" value="${q.title} (복사본)" style="margin:6px 0;">
      </div>`,
      showCancelButton: true,
      confirmButtonText: '복사',
      cancelButtonText: '취소',
      preConfirm: () => document.getElementById('copy-title').value,
    });
    if (!r.isConfirmed || !r.value) return;
    try {
      const { id, createdAt, updatedAt, status, viewedAt, approvedAt,
        rejectedAt, customerEdits, reQuoteRequest, ...rest } = q;
      const nextLabel = COMPARE_LABELS[quotes.length] || String(quotes.length + 1);
      await addDoc(collection(db, 'quotes'), {
        ...rest,
        title: r.value,
        label: nextLabel,
        quoteCustomerId: quoteCustomer.id,
        custName: quoteCustomer.custName,
        status: 'draft',
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.name || '',
      });
      await fetchQuotes();
      Swal.fire({ icon: 'success', title: '복사 완료!', timer: 1000, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '복사 실패: ' + e.message, 'error');
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}>로딩 중...</div>;

  // 템플릿 모달
  if (showTemplates) {
    return (
      <QuoteTemplates
        currentUser={currentUser}
        onClose={() => setShowTemplates(false)}
        onSelect={(tpl) => {
          const nextLabel = COMPARE_LABELS[quotes.length] || String(quotes.length + 1);
          const { id, name, createdAt, createdBy, ...rest } = tpl;
          setEditingQuote({
            ...rest,
            title: `${nextLabel}안`,
            label: nextLabel,
          });
          setShowTemplates(false);
        }}
      />
    );
  }

  // PDF 미리보기
  if (showPDF) {
    const currentQuote = quotes[activeIdx];
    return (
      <QuotePDFTemplate
        quoteCustomer={quoteCustomer}
        quote={currentQuote}
        allQuotes={quotes}
        settings={settings}
        currentUser={currentUser}
        onBack={() => setShowPDF(false)}
      />
    );
  }

  // 단가표 모달
  if (showPriceTable) {
    return <QuotePriceTable onBack={() => setShowPriceTable(false)} />;
  }

  // 견적 편집 화면
  if (editingQuote) {
    return (
      <QuoteEditor
        quote={editingQuote}
        quoteCustomer={quoteCustomer}
        currentUser={currentUser}
        onSave={handleSaveQuote}
        onCancel={() => setEditingQuote(null)}
        onShowPriceTable={() => setShowPriceTable(true)}
      />
    );
  }

  // 견적 목록/비교 화면
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn}>← 뒤로</button>
        <div style={{ flex: 1, marginLeft: '10px' }}>
          <div style={styles.custName}>{quoteCustomer.custName}</div>
          <div style={styles.custSub}>
            {quoteCustomer.address || ''}
            {quoteCustomer.area ? ` · ${quoteCustomer.area}평` : ''}
          </div>
        </div>
        <button onClick={() => setShowPriceTable(true)} style={styles.priceTableBtn}>
          📊 단가표
        </button>
      </div>

      {/* 비교 탭 */}
      {quotes.length > 0 && (
        <div style={styles.tabBar}>
          {quotes.map((q, i) => {
            const st = QUOTE_STATUS_EXTENDED[q.status] || QUOTE_STATUS_EXTENDED.draft;
            // 만료 체크
            const isExpired = q.validityDays && q.createdAt &&
              (new Date() - new Date(q.createdAt)) / 86400000 > q.validityDays;
            return (
              <button key={q.id}
                style={{ ...styles.tab, ...(activeIdx === i ? styles.tabActive : {}),
                  ...(isExpired ? { opacity: 0.6 } : {}) }}
                onClick={() => setActiveIdx(i)}>
                {st.icon} {q.label || q.title || `${i+1}안`}
              </button>
            );
          })}
          {quotes.length < COMPARE_LABELS.length && (
            <button onClick={handleAddQuote} style={styles.addTabBtn}>+ 비교견적</button>
          )}
          <button onClick={() => setShowTemplates(true)} style={{ ...styles.addTabBtn, borderColor: '#3b82f6', color: '#3b82f6' }}>
            📋 템플릿
          </button>
        </div>
      )}

      {quotes.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
          <div style={{ color: '#666', marginBottom: '16px' }}>아직 작성된 견적서가 없습니다.</div>
          <button onClick={handleAddQuote} style={styles.primaryBtn}>+ 견적서 작성하기</button>
        </div>
      ) : (
        <>
          <QuoteSummaryCard
            quote={quotes[activeIdx]}
            onEdit={() => handleEditQuote(quotes[activeIdx])}
            onDelete={() => handleDeleteQuote(quotes[activeIdx])}
            onCopy={() => handleCopyQuote(quotes[activeIdx])}
            onCreateContract={() => handleCreateContract(quotes[activeIdx])}
            onShowPDF={() => setShowPDF(true)}
          />

          {/* 전체 비교 테이블 */}
          {quotes.length > 1 && (
            <CompareTable quotes={quotes} />
          )}

          <div style={styles.actionRow}>
            {quotes.length < COMPARE_LABELS.length && (
              <button onClick={handleAddQuote} style={styles.secondaryBtn}>
                + {COMPARE_LABELS[quotes.length]}안 추가
              </button>
            )}
          </div>

          {/* Q&A 답변 섹션 */}
          {(() => {
            // 현재 고객의 모든 견적 QnA 로드 (quotes의 id 기준)
            const allQnA = qnaList.filter(q => quotes.some(qt => qt.id === q.quoteId));
            const unanswered = allQnA.filter(q => !q.answer);
            return (
              <div style={{ background:'white', borderRadius:'12px', padding:'14px 16px', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', marginTop:'8px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
                  <div style={{ fontSize:'14px', fontWeight:'bold', color:'#1e3a5f' }}>
                    💬 고객 Q&A
                    {unanswered.length > 0 && (
                      <span style={{ marginLeft:'8px', background:'#ef4444', color:'white', fontSize:'11px', padding:'2px 7px', borderRadius:'20px', fontWeight:'bold' }}>
                        답변 {unanswered.length}건
                      </span>
                    )}
                  </div>
                  <button onClick={() => setShowQnA(!showQnA)}
                    style={{ fontSize:'12px', color:'#3b82f6', background:'none', border:'none', cursor:'pointer' }}>
                    {showQnA ? '접기' : '펼치기'}
                  </button>
                </div>
                {showQnA && (
                  allQnA.length === 0 ? (
                    <div style={{ fontSize:'13px', color:'#94a3b8', textAlign:'center', padding:'12px' }}>아직 고객 질문이 없습니다.</div>
                  ) : (
                    allQnA.map((qa, i) => (
                      <QnAItem key={qa.id || i} qa={qa} onAnswered={(updated) => {
                        setQnaList(prev => prev.map(q => q.id === updated.id ? updated : q));
                      }} />
                    ))
                  )
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

// 견적 요약 카드
function QuoteSummaryCard({ quote, onEdit, onDelete, onCopy, onCreateContract, onShowPDF }) {
  if (!quote) return null;
  const status = QUOTE_STATUS_EXTENDED[quote.status] || QUOTE_STATUS_EXTENDED.draft;
  // 유효기간 계산
  const validityDays = quote.validityDays || DEFAULT_QUOTE_VALIDITY_DAYS;
  const createdDate = quote.createdAt ? new Date(quote.createdAt) : null;
  const expireDate = createdDate ? new Date(createdDate.getTime() + validityDays * 86400000) : null;
  const daysLeft = expireDate ? Math.ceil((expireDate - new Date()) / 86400000) : null;
  const isExpired = daysLeft !== null && daysLeft <= 0;

  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ ...styles.badge, color: status.color, background: status.bg }}>
            {status.icon} {status.label}
          </span>
          {quote.viewedAt && (
            <span style={{ ...styles.badge, color: '#8b5cf6', background: '#f5f3ff', fontSize: '11px' }}>
              👁️ {quote.viewedAt.split('T')[0]} 열람
            </span>
          )}
          {quote.rejectedReason && (
            <span style={{ ...styles.badge, color: '#ef4444', background: '#fee2e2', fontSize: '11px' }}>
              사유: {quote.rejectedReason}
            </span>
          )}
          <span style={styles.quoteTitle}>{quote.title || '견적서'}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            {quote.updatedAt ? quote.updatedAt.split('T')[0] : quote.createdAt?.split('T')[0]}
          </div>
          {!isExpired && daysLeft !== null && daysLeft <= 7 && (
            <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 'bold' }}>⏰ {daysLeft}일 후 만료</div>
          )}
          {isExpired && (
            <div style={{ fontSize: '11px', color: '#ef4444', fontWeight: 'bold' }}>⏰ 만료됨</div>
          )}
        </div>
      </div>

      {/* 정기 월 비용 */}
      <div style={styles.priceBox}>
        <div style={styles.priceLabel}>📅 정기 월 비용</div>
        <div style={styles.priceMain}>{formatPrice(quote.monthlyTotal)}</div>
        <div style={styles.priceSub}>
          월 {quote.visitPerMonth}회 작업 기준
          {quote.periodType === 'specific' && (quote.periodSpecific||[]).length > 0 && (
            <span style={{ marginLeft:6, color:'#92400e', fontWeight:600 }}>
              · {(() => {
                const s = [...(quote.periodSpecific||[])].sort((a,b)=>a-b);
                return s.length===1 ? `${s[0]}월` : `${s[0]}월~${s[s.length-1]}월`;
              })()}
            </span>
          )}
        </div>
      </div>

      {/* 초기비용 */}
      {quote.hasInitial && (
        <div style={{ ...styles.priceBox, background: '#fef3c7', borderColor: '#fde68a' }}>
          <div style={styles.priceLabel}>🚀 초기 비용 (처음 {quote.initialMonths}개월)</div>
          <div style={{ ...styles.priceMain, color: '#d97706' }}>{formatPrice(quote.initialTotal)}/월</div>
          <div style={styles.priceSub}>
            월 {quote.initialVisitsPerMonth}회 + 초기 추가 {quote.initialExtraRate}%
          </div>
        </div>
      )}

      {/* 서비스 항목 */}
      {quote.services?.length > 0 && (
        <div style={styles.serviceList}>
          {quote.services.map((s, i) => {
            const svc = SERVICE_ITEMS.find(x => x.value === s.serviceType);
            return (
              <div key={i} style={styles.serviceRow}>
                <span>{svc?.icon || '•'} {svc?.label || s.serviceType}</span>
                <span style={{ fontWeight: 'bold' }}>{formatPrice(s.totalPrice)}</span>
              </div>
            );
          })}
        </div>
      )}

      {quote.memo && (
        <div style={styles.memo}>💬 {quote.memo}</div>
      )}

      {/* 현장 사진 */}
      {quote.photos?.length > 0 && (
        <div style={styles.photoRow}>
          {quote.photos.map((p, i) => (
            <img key={i} src={p} alt={`현장${i + 1}`} style={styles.photoThumb} />
          ))}
        </div>
      )}

      {/* 견적 → 계약서 전환 버튼 (승인/계약요청 상태일 때 강조) */}
      {quote.status === 'approved' && (
        <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
          <div style={{ fontSize: '13px', color: '#065f46', fontWeight: 'bold', marginBottom: '6px' }}>
            ✅ 고객이 이 견적을 승인했습니다!
          </div>
          <button onClick={onCreateContract}
            style={{ width: '100%', padding: '10px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
            📃 계약서 바로 생성하기
          </button>
        </div>
      )}
      <div style={styles.cardActions}>
        <button onClick={onShowPDF} style={styles.pdfBtn}>📄 PDF 생성/공유</button>
        <button onClick={onEdit} style={styles.editBtn}>✏️ 수정</button>
        <button onClick={onCopy} style={styles.copyBtn}>📋 복사</button>
        <button onClick={onCreateContract} style={{ ...styles.copyBtn, color:'#1e3a5f', borderColor:'#bfdbfe', background:'#eff6ff' }}>
          📃 계약서
        </button>
        <button onClick={onDelete} style={styles.deleteBtn}>🗑️</button>
      </div>
    </div>
  );
}

// 비교 테이블
function CompareTable({ quotes }) {
  return (
    <div style={styles.compareBox}>
      <div style={styles.compareTitle}>📊 견적 비교</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.thead}>
              <th style={styles.th}>항목</th>
              {quotes.map(q => <th key={q.id} style={styles.th}>{q.label || q.title}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>월 작업횟수</td>
              {quotes.map(q => <td key={q.id} style={styles.tdVal}>{q.visitPerMonth}회</td>)}
            </tr>
            <tr style={{ background: '#f0fdf4' }}>
              <td style={{ ...styles.td, fontWeight: 'bold' }}>정기 월 비용</td>
              {quotes.map(q => (
                <td key={q.id} style={{ ...styles.tdVal, fontWeight: 'bold', color: '#10b981' }}>
                  {formatPrice(q.monthlyTotal)}
                </td>
              ))}
            </tr>
            <tr>
              <td style={styles.td}>초기 여부</td>
              {quotes.map(q => <td key={q.id} style={styles.tdVal}>{q.hasInitial ? '있음' : '없음'}</td>)}
            </tr>
            {quotes.some(q => q.hasInitial) && (
              <tr style={{ background: '#fef3c7' }}>
                <td style={styles.td}>초기 월 비용</td>
                {quotes.map(q => (
                  <td key={q.id} style={{ ...styles.tdVal, color: '#d97706' }}>
                    {q.hasInitial ? formatPrice(q.initialTotal) : '-'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 견적 편집기 ─────────────────────────────────────────────
function QuoteEditor({ quote, quoteCustomer, currentUser, onSave, onCancel, onShowPriceTable }) {
  // serviceContent / planGrid 기본값 보장 (구 데이터 또는 신규 견적 모두 대응)
  const [form, setForm] = useState({
    ...emptyQuote(),
    ...quote,
    serviceContent: {
      ...DEFAULT_SERVICE_CONTENT,
      ...(quote.serviceContent || {}),
      pests: {
        ...DEFAULT_SERVICE_CONTENT.pests,
        ...(quote.serviceContent?.pests || {}),
      },
    },
    planGrid: quote.planGrid || makeDefaultPlanGrid(),
    planRows: quote.planRows || DEFAULT_PLAN_ROWS.map(r => ({ ...r, visible: true })),
    insectTrap: { ...emptyInsectTrap(), ...(quote.insectTrap || {}) },
    monthlyVisits: quote.monthlyVisits || Array(12).fill(null),
    monthlyVisitPriceChange: quote.monthlyVisitPriceChange || Array(12).fill(false),
    showMonthlyTable: quote.showMonthlyTable !== undefined ? quote.showMonthlyTable : true,
    validityDays: quote.validityDays || DEFAULT_QUOTE_VALIDITY_DAYS,
    zoneServices: quote.zoneServices || (quoteCustomer.zones || []).filter(z => z.include).map(z => ({
      zoneKey: z.key, zoneLabel: z.label, zoneIcon: z.icon || '📍',
      count: z.count || 1, unitPrice: 0, totalPrice: 0, include: true,
    })),
    linkSettings: { ...defaultLinkSettings(), ...(quote.linkSettings || {}) },
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // 서비스 추가
  const addService = () => {
    const newSvc = {
      serviceType: 'general',
      area: quoteCustomer.area || '',
      unitCount: quoteCustomer.unitCount || '',
      pricePerUnit: 0,
      totalPrice: 0,
      visits: form.visitPerMonth,
      note: '',
    };
    // 단가 자동 제안
    const cat = BUSINESS_TO_PRICE_CATEGORY[quoteCustomer.businessType] || 'commercial';
    if (cat !== 'multiUnit') {
      const row = getPriceByArea(cat, parseFloat(quoteCustomer.area) || 0);
      if (row && row.visitPrice) {
        newSvc.pricePerUnit = row.visitPrice;
        newSvc.totalPrice = row.visitPrice * form.visitPerMonth;
      }
    }
    set('services', [...(form.services || []), newSvc]);
  };

  const isUnitBased = UNIT_BASED_TYPES.includes(quoteCustomer.businessType);

  const updateService = (i, key, val) => {
    const svcs = [...(form.services || [])];
    svcs[i] = { ...svcs[i], [key]: val };
    // 합계금액 자동 계산
    if (key === 'pricePerUnit' || key === 'unitCount') {
      const price = key === 'pricePerUnit' ? parseFloat(val) || 0 : parseFloat(svcs[i].pricePerUnit) || 0;
      if (isUnitBased) {
        // 호실 기반: 단가 × 호실수
        const units = key === 'unitCount' ? parseFloat(val) || 1 : parseFloat(svcs[i].unitCount) || 1;
        svcs[i].totalPrice = price * units;
      } else {
        // 방문 기반: 단가 × 월 작업횟수
        svcs[i].totalPrice = price * (form.visitPerMonth || 1);
      }
    }
    set('services', svcs);
  };

  // Fix 3: visitPerMonth 변경 시 방문기반 서비스 금액 재계산
  const handleVisitPerMonthChange = (newVal) => {
    const val = Math.max(1, newVal);
    if (!isUnitBased) {
      const svcs = (form.services || []).map(s => ({
        ...s,
        totalPrice: (parseFloat(s.pricePerUnit) || 0) * val,
      }));
      setForm(f => ({ ...f, visitPerMonth: val, services: svcs }));
    } else {
      set('visitPerMonth', val);
    }
  };

  const removeService = (i) => {
    const svcs = [...(form.services || [])];
    svcs.splice(i, 1);
    set('services', svcs);
  };

  // 월별 상세 계산
  const calcMonthlyDetail = () => {
    const baseVisits = form.visitPerMonth || 1;
    const serviceUnitPrice = (form.services || []).reduce((sum, s) => sum + (parseFloat(s.pricePerUnit) || 0), 0);
    const zoneBase = (form.zoneServices || []).filter(z => z.include).reduce((sum, z) => sum + (parseFloat(z.totalPrice) || 0), 0);
    const trapEnabled = form.insectTrap?.enabled;
    const trapUnitPrice = (parseFloat(form.insectTrap?.unitPrice) || 0) * (form.insectTrap?.count || 1);
    const trapGrid = form.planGrid?.insectTrap || Array(12).fill(true);
    const monthlyVisits = form.monthlyVisits || Array(12).fill(null);
    const monthlyVisitPriceChange = form.monthlyVisitPriceChange || Array(12).fill(false);

    return Array.from({ length: 12 }, (_, i) => {
      // [ADD] 기간 설정에 따라 비활성 월은 0 처리
      const isActiveMonth = (() => {
        if (form.periodType !== 'specific') return true;
        return (form.periodSpecific||[]).includes(i+1);
      })();

      if (!isActiveMonth) {
        return { month: i+1, visits: 0, serviceMonthly: 0, trapMonthly: 0, total: 0, inactive: true };
      }

      const visits = monthlyVisits[i] !== null ? monthlyVisits[i] : baseVisits;
      const priceChanges = monthlyVisitPriceChange[i];
      const serviceMonthly = isUnitBased
        ? (form.services || []).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0) + zoneBase
        : priceChanges
          ? serviceUnitPrice * visits + zoneBase
          : serviceUnitPrice * baseVisits + zoneBase;
      const trapMonthly = (trapEnabled && trapGrid[i]) ? trapUnitPrice : 0;
      return { month: i + 1, visits, serviceMonthly, trapMonthly, total: serviceMonthly + trapMonthly, inactive: false };
    });
  };

  // 합계 계산 (서비스 + 구획 + 포충기 포함)
  const calcTotals = () => {
    const monthlyDetail = calcMonthlyDetail();
    const serviceBase = (form.services || []).reduce((sum, s) => sum + (parseFloat(s.totalPrice) || 0), 0);
    const zoneBase = (form.zoneServices || []).filter(z => z.include).reduce((sum, z) => sum + (parseFloat(z.totalPrice) || 0), 0);
    const trapMonthlyBase = form.insectTrap?.enabled ? (parseFloat(form.insectTrap?.totalPrice) || 0) : 0;
    const monthly = serviceBase + zoneBase + trapMonthlyBase;
    const initialExtra = form.hasInitial ? Math.round(monthly * (form.initialExtraRate / 100)) : 0;
    const initialVisitRatio = form.hasInitial ? (form.initialVisitsPerMonth / Math.max(form.visitPerMonth, 1)) : 1;
    const initialTotal = form.hasInitial ? Math.round(monthly * initialVisitRatio + initialExtra) : 0;
    const annualTotal = monthlyDetail.reduce((sum, m) => sum + m.total, 0);
    return { monthly, initialTotal, serviceBase, zoneBase, trapMonthlyBase, monthlyDetail, annualTotal };
  };

  const { monthly, initialTotal, zoneBase, trapMonthlyBase, monthlyDetail, annualTotal: calcAnnualTotal } = calcTotals();

  // [ADD] 기간 합계 계산
  const calcPeriodTotal = () => {
    const baseMonthly = form.priceOverride
      ? (parseFloat(form.priceOverrideAmount) || 0)
      : monthly;
    const extraSum = (form.priceExtraItems || []).reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
    const adjustedMonthly = baseMonthly + extraSum;

    if (form.periodType === 'specific') {
      const checked = (form.periodSpecific || []).sort((a,b)=>a-b);
      if (checked.length === 0) return { months: 0, total: 0, label: '', adjustedMonthly };
      const first = checked[0], last = checked[checked.length-1];
      const label = first === last ? `${first}월` : `${first}월~${last}월`;
      return { months: checked.length, total: adjustedMonthly * checked.length, label, adjustedMonthly };
    }
    return { months: 0, total: adjustedMonthly, label: '', adjustedMonthly };
  };
  const periodInfo = calcPeriodTotal();

  // 현장사진 추가
  const handlePhotoAdd = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      if (file.size > 1000000) {
        Swal.fire('알림', '사진은 1MB 이하로 해주세요', 'warning');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        set('photos', [...(form.photos || []), reader.result]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (i) => {
    const p = [...(form.photos || [])];
    p.splice(i, 1);
    set('photos', p);
  };

  const handleSave = () => {
    if ((form.services || []).length === 0) {
      Swal.fire('알림', '서비스 항목을 최소 1개 추가해주세요', 'warning');
      return;
    }
    onSave({
      ...form,
      monthlyTotal:  monthly,
      initialTotal,
      // [ADD] 기간/금액편집 저장
      periodType:          form.periodType          || 'none',
      periodMonths:        form.periodMonths        || 1,
      periodSpecific:      form.periodSpecific      || [],
      priceOverride:       form.priceOverride       || false,
      priceOverrideAmount: form.priceOverrideAmount || 0,
      priceExtraItems:     form.priceExtraItems     || [],
      // 기간 합계 (계산값 저장)
      periodTotal: (() => {
        const base = form.priceOverride ? (parseFloat(form.priceOverrideAmount)||0) : monthly;
        const extra = (form.priceExtraItems||[]).reduce((s,it)=>s+(parseFloat(it.amount)||0),0);
        const adj = base + extra;
        if (form.periodType === 'specific') return adj * (form.periodSpecific||[]).length;
        return 0;
      })(),
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onCancel} style={styles.backBtn}>← 취소</button>
        <h2 style={styles.title}>{form.id ? '견적 수정' : '새 견적 작성'}</h2>
        <button onClick={onShowPriceTable} style={styles.priceTableBtn}>📊</button>
      </div>

      {/* 견적 제목 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📋 견적 기본 설정</div>
        <div style={styles.row}>
          <label style={styles.label}>견적명</label>
          <input
            style={{ ...styles.input, flex: 1 }}
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="예: A안, 기본안, 절충안"
          />
        </div>
        <div style={styles.row}>
          <label style={styles.label}>월 작업횟수</label>
          <div style={styles.stepper}>
            <button style={styles.stepBtn} onClick={() => handleVisitPerMonthChange((form.visitPerMonth || 1) - 1)}>−</button>
            <span style={styles.stepVal}>{form.visitPerMonth || 1}회/월</span>
            <button style={styles.stepBtn} onClick={() => handleVisitPerMonthChange((form.visitPerMonth || 1) + 1)}>+</button>
          </div>
        </div>

        {/* [ADD] 작업 월 지정 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={styles.label}>작업 월 지정</label>
            {(form.periodSpecific||[]).length > 0 && (
              <button onClick={() => {
                // 전체 해제 → planGrid도 초기화
                set('periodSpecific', []);
                set('periodType', 'none');
                const grid = { ...(form.planGrid || makeDefaultPlanGrid()) };
                const rows = form.planRows || DEFAULT_PLAN_ROWS.map(r => ({ ...r, visible: true }));
                rows.filter(r => r.visible !== false).forEach(r => { grid[r.key] = Array(12).fill(false); });
                if (form.insectTrap?.enabled) grid.insectTrap = Array(12).fill(false);
                set('planGrid', grid);
              }} style={{ fontSize:11, color:'#94a3b8', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}>
                전체 해제
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const checked = (form.periodSpecific || []).includes(m);
              return (
                <button key={m}
                  onClick={() => {
                    const cur = form.periodSpecific || [];
                    const next = checked ? cur.filter(x => x !== m) : [...cur, m];
                    set('periodSpecific', next);
                    set('periodType', next.length > 0 ? 'specific' : 'none');

                    // planGrid 동기화 (해당 월 토글)
                    const grid = { ...(form.planGrid || makeDefaultPlanGrid()) };
                    const rows = form.planRows || DEFAULT_PLAN_ROWS.map(r => ({ ...r, visible: true }));
                    rows.filter(r => r.visible !== false).forEach(r => {
                      const arr = [...(grid[r.key] || Array(12).fill(false))];
                      arr[m - 1] = !checked;
                      grid[r.key] = arr;
                    });
                    if (form.insectTrap?.enabled) {
                      const arr = [...(grid.insectTrap || Array(12).fill(false))];
                      arr[m - 1] = !checked;
                      grid.insectTrap = arr;
                    }
                    set('planGrid', grid);
                  }}
                  style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                    border: `1.5px solid ${checked ? '#3b82f6' : '#e2e8f0'}`,
                    background: checked ? '#dbeafe' : 'white',
                    color: checked ? '#1e40af' : '#374151',
                    fontWeight: checked ? 700 : 400,
                  }}>
                  {m}월
                </button>
              );
            })}
          </div>
          {(form.periodSpecific || []).length > 0 && (
            <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 6, fontWeight: 600 }}>
              📅 {(() => {
                const s = [...(form.periodSpecific||[])].sort((a,b)=>a-b);
                return s.length === 1 ? `${s[0]}월` : `${s[0]}월~${s[s.length-1]}월`;
              })()} / 월 {form.visitPerMonth||1}회 / {(form.periodSpecific||[]).length}개월
            </div>
          )}
        </div>
      </div>

      {/* 서비스 항목 */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={styles.sectionTitle2}>🪳 서비스 항목</div>
          <button onClick={addService} style={styles.addSvcBtn}>+ 항목 추가</button>
        </div>

        {(form.services || []).length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px', fontSize: '13px' }}>
            항목을 추가해주세요. 업종에 맞는 단가가 자동 제안됩니다.
          </div>
        )}

        {(form.services || []).map((svc, i) => {
          const svcInfo = SERVICE_ITEMS.find(x => x.value === svc.serviceType);
          const isUnitBased = UNIT_BASED_TYPES.includes(quoteCustomer.businessType);
          return (
            <div key={i} style={styles.svcCard}>
              <div style={styles.svcHeader}>
                <select
                  style={styles.svcSelect}
                  value={svc.serviceType}
                  onChange={e => updateService(i, 'serviceType', e.target.value)}
                >
                  {SERVICE_ITEMS.map(s => (
                    <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
                  ))}
                </select>
                <button onClick={() => removeService(i)} style={styles.removeSvcBtn}>✕</button>
              </div>

              {svcInfo && (
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>{svcInfo.desc}</div>
              )}

              <div style={styles.svcGrid}>
                {isUnitBased && (
                  <div>
                    <div style={styles.svcLabel}>호실/세대 수</div>
                    <input
                      type="number" style={styles.svcInput}
                      value={svc.unitCount}
                      onChange={e => updateService(i, 'unitCount', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                )}
                <div>
                  <div style={styles.svcLabel}>
                    {isUnitBased ? '단가/호실' : '방문 단가'}
                  </div>
                  <input
                    type="number" style={styles.svcInput}
                    value={svc.pricePerUnit}
                    onChange={e => updateService(i, 'pricePerUnit', e.target.value)}
                    placeholder="0"
                    step="1000"
                  />
                </div>
                <div>
                  <div style={styles.svcLabel}>합계금액</div>
                  <input
                    type="number" style={{ ...styles.svcInput, background: '#f0fdf4', fontWeight: 'bold' }}
                    value={svc.totalPrice}
                    onChange={e => updateService(i, 'totalPrice', e.target.value)}
                    placeholder="0"
                    step="1000"
                  />
                </div>
              </div>

              <input
                style={{ ...styles.input, marginTop: '8px', fontSize: '12px' }}
                value={svc.note}
                onChange={e => updateService(i, 'note', e.target.value)}
                placeholder="비고 (예: 공용구역 전체, 외곽 포함)"
              />
            </div>
          );
        })}

        {/* 합계 + 금액편집 + 기간합계 */}
        {(form.services || []).length > 0 && (
          <div>
            {/* 정기 월 합계 */}
            <div style={styles.totalBox}>
              <div style={styles.totalRow}>
                <span>📅 정기 월 합계</span>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={styles.totalPrice}>{formatPrice(monthly)}</span>
                  <button
                    onClick={() => set('priceOverride', !form.priceOverride)}
                    style={{
                      padding:'3px 10px', fontSize:11, fontWeight:700, cursor:'pointer',
                      border:`1.5px solid ${form.priceOverride ? '#3b82f6' : '#e2e8f0'}`,
                      borderRadius:8, background: form.priceOverride ? '#eff6ff' : 'white',
                      color: form.priceOverride ? '#1d4ed8' : '#64748b',
                    }}>
                    ✏️ 직접편집
                  </button>
                </div>
              </div>
              <div style={{ fontSize:'11px', color:'#94a3b8', textAlign:'right' }}>
                {priceToKorean(monthly)}
              </div>
            </div>

            {/* 금액 직접 편집 */}
            {form.priceOverride && (
              <div style={{ background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:10, padding:'12px 14px', marginTop:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#1e40af', marginBottom:8 }}>✏️ 금액 직접 편집</div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <label style={{ fontSize:12, color:'#374151', whiteSpace:'nowrap' }}>기본 금액</label>
                  <input
                    type="number"
                    value={form.priceOverrideAmount || monthly}
                    onChange={e => set('priceOverrideAmount', parseFloat(e.target.value)||0)}
                    style={{ flex:1, padding:'6px 10px', border:'1.5px solid #bfdbfe', borderRadius:8, fontSize:13, textAlign:'right' }}
                    placeholder={String(monthly)}
                    step="1000"
                  />
                  <span style={{ fontSize:12, color:'#6b7280' }}>원</span>
                </div>

                {/* 추가 금액 항목 */}
                {(form.priceExtraItems||[]).map((item, ei) => (
                  <div key={ei} style={{ display:'flex', gap:6, marginBottom:6, alignItems:'center' }}>
                    <input
                      value={item.label}
                      onChange={e => {
                        const items = [...(form.priceExtraItems||[])];
                        items[ei] = { ...items[ei], label: e.target.value };
                        set('priceExtraItems', items);
                      }}
                      placeholder="항목명 (예: 할인, 추가비용)"
                      style={{ flex:2, padding:'6px 8px', border:'1.5px solid #bfdbfe', borderRadius:8, fontSize:12 }}
                    />
                    <input
                      type="number"
                      value={item.amount}
                      onChange={e => {
                        const items = [...(form.priceExtraItems||[])];
                        items[ei] = { ...items[ei], amount: parseFloat(e.target.value)||0 };
                        set('priceExtraItems', items);
                      }}
                      placeholder="금액"
                      step="1000"
                      style={{ flex:1, padding:'6px 8px', border:'1.5px solid #bfdbfe', borderRadius:8, fontSize:12, textAlign:'right' }}
                    />
                    <span style={{ fontSize:12, color:'#6b7280' }}>원</span>
                    <button
                      onClick={() => {
                        const items = (form.priceExtraItems||[]).filter((_,j)=>j!==ei);
                        set('priceExtraItems', items);
                      }}
                      style={{ padding:'4px 8px', background:'#fee2e2', border:'none', borderRadius:6, color:'#ef4444', cursor:'pointer', fontSize:12 }}>
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => set('priceExtraItems', [...(form.priceExtraItems||[]), { label:'', amount:0 }])}
                  style={{ width:'100%', padding:'7px', background:'white', border:'1.5px dashed #93c5fd', borderRadius:8, color:'#3b82f6', fontSize:12, fontWeight:600, cursor:'pointer', marginBottom:8 }}>
                  + 추가 금액 항목
                </button>

                {/* 편집 후 합계 */}
                <div style={{ borderTop:'1px solid #bfdbfe', paddingTop:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:12, color:'#1e40af', fontWeight:700 }}>편집 후 월 합계</span>
                  <span style={{ fontSize:16, fontWeight:800, color:'#1e40af' }}>
                    {formatPrice(
                      (parseFloat(form.priceOverrideAmount)||monthly) +
                      (form.priceExtraItems||[]).reduce((s,it)=>s+(parseFloat(it.amount)||0),0)
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* 기간 합계 */}
            {form.periodType !== 'none' && periodInfo.months > 0 && (
              <div style={{ background:'#fef9c3', border:'1.5px solid #fde68a', borderRadius:10, padding:'12px 14px', marginTop:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:'#92400e' }}>
                      📆 기간 합계 ({periodInfo.label})
                    </div>
                    <div style={{ fontSize:11, color:'#b45309', marginTop:3 }}>
                      월 {formatPrice(periodInfo.adjustedMonthly)} × {periodInfo.months}개월
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20, fontWeight:800, color:'#92400e' }}>
                      {formatPrice(periodInfo.total)}
                    </div>
                    <div style={{ fontSize:10, color:'#b45309' }}>
                      {priceToKorean(periodInfo.total)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 구획별 세부 견적 */}
      {(form.zoneServices || []).length > 0 && (
        <div style={styles.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={styles.sectionTitle2}>📍 구획별 세부 견적</div>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>단가 × 개수 = 금액 자동계산</span>
          </div>
          {(form.zoneServices || []).map((z, i) => (
            <div key={z.zoneKey} style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
              padding: '10px 12px', borderRadius: '8px',
              background: z.include ? '#f0fdf4' : '#f8fafc',
              border: `1.5px solid ${z.include ? '#86efac' : '#e2e8f0'}`,
            }}>
              <button onClick={() => {
                const zs = [...form.zoneServices]; zs[i] = { ...zs[i], include: !zs[i].include };
                set('zoneServices', zs);
              }} style={{ width: '26px', height: '26px', borderRadius: '50%', border: 'none',
                background: z.include ? '#10b981' : '#e2e8f0', color: 'white', cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                {z.include ? '✓' : ''}
              </button>
              <span style={{ fontSize: '15px', flexShrink: 0 }}>{z.zoneIcon}</span>
              <span style={{ minWidth: '80px', fontSize: '13px', fontWeight: 'bold', color: z.include ? '#166534' : '#94a3b8' }}>{z.zoneLabel}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <button onClick={() => { const zs=[...form.zoneServices]; zs[i]={...zs[i], count: Math.max(0,(zs[i].count||0)-1)}; set('zoneServices',zs); }}
                  style={styles.miniStepBtn}>−</button>
                <span style={{ minWidth: '28px', textAlign: 'center', fontSize: '13px', fontWeight: 'bold' }}>{z.count || 0}</span>
                <button onClick={() => { const zs=[...form.zoneServices]; zs[i]={...zs[i], count: (zs[i].count||0)+1}; set('zoneServices',zs); }}
                  style={styles.miniStepBtn}>+</button>
                <span style={{ fontSize: '11px', color: '#64748b' }}>개</span>
              </div>
              <input type="number" placeholder="단가" step="1000"
                value={z.unitPrice || ''}
                onChange={e => {
                  const price = parseFloat(e.target.value) || 0;
                  const zs = [...form.zoneServices];
                  zs[i] = { ...zs[i], unitPrice: price, totalPrice: price * (zs[i].count || 1) };
                  set('zoneServices', zs);
                }}
                style={{ width: '90px', padding: '6px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' }}
              />
              <span style={{ fontSize: '12px', color: '#64748b', flexShrink: 0 }}>×{z.count||0} =</span>
              <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#10b981', minWidth: '70px', textAlign: 'right' }}>
                {(z.totalPrice || 0).toLocaleString()}원
              </span>
            </div>
          ))}
          {zoneBase > 0 && (
            <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: 'bold', color: '#166534', marginTop: '6px' }}>
              구획 소계: {formatPrice(zoneBase)}
            </div>
          )}
        </div>
      )}

      {/* 포충기 설치 */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={styles.sectionTitle2}>🪰 포충기 설치</div>
          <button
            onClick={() => set('insectTrap', { ...form.insectTrap, enabled: !form.insectTrap?.enabled })}
            style={{ ...styles.toggleBtn,
              background: form.insectTrap?.enabled ? '#f59e0b' : '#e2e8f0',
              color: form.insectTrap?.enabled ? 'white' : '#64748b' }}>
            {form.insectTrap?.enabled ? 'ON ✅' : 'OFF'}
          </button>
        </div>
        {form.insectTrap?.enabled && (
          <div>
            {/* 설치 위치 선택 */}
            <div style={{ marginBottom: '12px' }}>
              <div style={styles.subLabel}>설치 구역</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {[
                  ...(TRAP_LOCATION_PRESETS[quoteCustomer.businessType] || TRAP_LOCATION_PRESETS.default),
                  ...(quoteCustomer.zones || []).filter(z => z.include).map(z => z.label),
                ].filter((v, i, a) => a.indexOf(v) === i).map(loc => {
                  const isSelected = (form.insectTrap?.locations || []).includes(loc);
                  return (
                    <button key={loc} onClick={() => {
                      const locs = form.insectTrap?.locations || [];
                      const next = isSelected ? locs.filter(l => l !== loc) : [...locs, loc];
                      set('insectTrap', { ...form.insectTrap, locations: next });
                    }} style={{
                      padding: '5px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                      border: isSelected ? '1.5px solid #f59e0b' : '1.5px solid #e2e8f0',
                      background: isSelected ? '#fef3c7' : '#f8fafc',
                      color: isSelected ? '#92400e' : '#64748b', fontWeight: isSelected ? 'bold' : 'normal',
                    }}>{isSelected ? '✓ ' : ''}{loc}</button>
                  );
                })}
              </div>
              <input style={styles.input} placeholder="직접 구역 입력 (쉼표로 구분, 예: 주방,창고)"
                onBlur={e => {
                  if (!e.target.value.trim()) return;
                  const customs = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  const locs = [...new Set([...(form.insectTrap?.locations || []), ...customs])];
                  set('insectTrap', { ...form.insectTrap, locations: locs });
                  e.target.value = '';
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={styles.label}>설치 대수</span>
                <button style={styles.stepBtn} onClick={() => set('insectTrap', { ...form.insectTrap, count: Math.max(1,(form.insectTrap?.count||1)-1), totalPrice: Math.max(1,(form.insectTrap?.count||1)-1)*(form.insectTrap?.unitPrice||0) })}>−</button>
                <span style={{ ...styles.stepVal, minWidth: '40px' }}>{form.insectTrap?.count || 1}대</span>
                <button style={styles.stepBtn} onClick={() => set('insectTrap', { ...form.insectTrap, count: (form.insectTrap?.count||1)+1, totalPrice: ((form.insectTrap?.count||1)+1)*(form.insectTrap?.unitPrice||0) })}>+</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                <span style={styles.label}>대당 단가</span>
                <input type="number" step="1000"
                  value={form.insectTrap?.unitPrice || ''}
                  onChange={e => {
                    const price = parseFloat(e.target.value) || 0;
                    set('insectTrap', { ...form.insectTrap, unitPrice: price, totalPrice: price * (form.insectTrap?.count || 1) });
                  }}
                  style={{ ...styles.input, flex: 1 }}
                  placeholder="0"
                />
              </div>
            </div>
            {(form.insectTrap?.totalPrice || 0) > 0 && (
              <div style={{ ...styles.totalBox, marginTop: '10px', background: '#fef3c7', borderColor: '#fde68a' }}>
                <div style={styles.totalRow}>
                  <span>🪰 포충기 소계</span>
                  <span style={{ ...styles.totalPrice, color: '#d97706' }}>
                    {form.insectTrap?.count}대 × {formatPrice(form.insectTrap?.unitPrice)} = {formatPrice(form.insectTrap?.totalPrice)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 초기비용 설정 */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={styles.sectionTitle2}>🚀 초기비용</div>
          <button
            style={{
              ...styles.toggleBtn,
              background: form.hasInitial ? '#d97706' : '#e2e8f0',
              color: form.hasInitial ? 'white' : '#64748b'
            }}
            onClick={() => set('hasInitial', !form.hasInitial)}
          >
            {form.hasInitial ? 'ON ✅' : 'OFF'}
          </button>
        </div>

        {form.hasInitial && (
          <div>
            <div style={styles.initialInfo}>
              초기비용은 정기 서비스 시작 전 집중방제 기간으로, 작업 횟수가 더 많고 추가비용이 발생합니다.
            </div>

            <div style={styles.row}>
              <label style={styles.label}>초기 기간</label>
              <div style={styles.stepper}>
                <button style={styles.stepBtn} onClick={() => set('initialMonths', Math.max(1, (form.initialMonths || 2) - 1))}>−</button>
                <span style={styles.stepVal}>{form.initialMonths || 2}개월</span>
                <button style={styles.stepBtn} onClick={() => set('initialMonths', (form.initialMonths || 2) + 1)}>+</button>
              </div>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>초기 월 작업횟수</label>
              <div style={styles.stepper}>
                <button style={styles.stepBtn} onClick={() => set('initialVisitsPerMonth', Math.max(1, (form.initialVisitsPerMonth || 2) - 1))}>−</button>
                <span style={styles.stepVal}>{form.initialVisitsPerMonth || 2}회/월</span>
                <button style={styles.stepBtn} onClick={() => set('initialVisitsPerMonth', (form.initialVisitsPerMonth || 2) + 1)}>+</button>
              </div>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>추가비용 비율</label>
              <div style={styles.stepper}>
                <button style={styles.stepBtn} onClick={() => set('initialExtraRate', Math.max(0, (form.initialExtraRate || 40) - 5))}>−</button>
                <span style={styles.stepVal}>{form.initialExtraRate || 40}%</span>
                <button style={styles.stepBtn} onClick={() => set('initialExtraRate', Math.min(100, (form.initialExtraRate || 40) + 5))}>+</button>
              </div>
            </div>

            {monthly > 0 && (
              <div style={{ ...styles.totalBox, background: '#fef3c7', borderColor: '#fde68a' }}>
                <div style={styles.totalRow}>
                  <span>🚀 초기 월 합계</span>
                  <span style={{ ...styles.totalPrice, color: '#d97706' }}>{formatPrice(initialTotal)}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#92400e', marginTop: '4px' }}>
                  정기 {formatPrice(monthly)} × {form.initialVisitsPerMonth}회/{form.visitPerMonth}회
                  + 추가 {form.initialExtraRate}% = {formatPrice(initialTotal)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 총합계금 */}
        {monthly > 0 && (() => {
          const im = form.hasInitial ? (form.initialMonths || 2) : 0;
          // 작업 월 지정 여부에 따라 실제 작업 개월 수 계산
          const hasSpecificPeriod = form.periodType === 'specific' && (form.periodSpecific||[]).length > 0;
          const workMonthCount  = hasSpecificPeriod ? form.periodSpecific.length : 12;
          const initMonths      = hasSpecificPeriod ? Math.min(im, workMonthCount) : im;
          const regularMonths   = workMonthCount - initMonths;
          const displayTotal    = initMonths * initialTotal + regularMonths * monthly;
          // 기간 라벨
          const periodLabel = hasSpecificPeriod
            ? `${[...form.periodSpecific].sort((a,b)=>a-b).join('·')}월 / ${workMonthCount}개월`
            : '연간 12개월';
          // 포충기 사용 월 범위 계산
          const trapGrid = form.planGrid?.insectTrap || Array(12).fill(true);
          const trapMonths = trapGrid.filter(Boolean).length;
          const trapAnnual = form.insectTrap?.enabled
            ? (parseFloat(form.insectTrap?.unitPrice) || 0) * (form.insectTrap?.count || 1) * trapMonths
            : 0;
          const trapActiveMonths = form.insectTrap?.enabled
            ? trapGrid.map((v, i) => v ? `${i+1}월` : null).filter(Boolean)
            : [];
          return (
            <div style={{ background: '#1e3a5f', borderRadius: '10px', padding: '14px 16px', marginTop: '12px' }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' }}>
                💰 총 합계금
              </div>
              {form.hasInitial && initMonths > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#fde68a', marginBottom: '6px' }}>
                  <span>🚀 초기 1~{initMonths}개월</span>
                  <span style={{ fontWeight: 'bold' }}>{formatPrice(initialTotal)}/월 × {initMonths}개월 = {formatPrice(initialTotal * initMonths)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#bbf7d0', marginBottom: '4px' }}>
                <span>📅 정기 방제 ({regularMonths}개월)</span>
                <span style={{ fontWeight: 'bold' }}>{formatPrice(monthly)}/월 × {regularMonths}개월</span>
              </div>
              {form.insectTrap?.enabled && trapMonths > 0 && (
                <div style={{ fontSize: '12px', color: '#fde68a', marginBottom: '4px' }}>
                  🪰 포충기 {trapActiveMonths.join(', ')} ({trapMonths}개월) = {formatPrice(trapAnnual)}
                </div>
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.25)', paddingTop: '10px', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'white', fontWeight: 'bold', fontSize: '13px' }}>📆 기간 총계</span>
                <span style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: '22px' }}>{formatPrice(displayTotal)}</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                {priceToKorean(displayTotal)} ({periodLabel})
              </div>
            </div>
          );
        })()}
      </div>

      {/* 현장 사진 */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={styles.sectionTitle2}>📸 현장 사진</div>
          <label style={styles.addSvcBtn}>
            + 사진 추가
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handlePhotoAdd} />
          </label>
        </div>

        {(form.photos || []).length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '16px', fontSize: '13px' }}>
            현장 사진을 첨부하면 견적서에 포함됩니다.
          </div>
        )}

        <div style={styles.photoGrid}>
          {(form.photos || []).map((p, i) => (
            <div key={i} style={styles.photoWrap}>
              <img src={p} alt={`현장${i + 1}`} style={styles.photoImg} />
              <button onClick={() => removePhoto(i)} style={styles.removePhotoBtn}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* 방제 서비스 내용 설정 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>📄 방제 서비스 내용 설정</div>

        {/* 서비스 항목 ON/OFF - 토글버튼 */}
        <div style={{ marginBottom: '14px' }}>
          <div style={styles.subLabel}>서비스 항목 선택</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { key: 'showGeneral',      label: '일반방제 (보행해충 통합관리)', icon: '🪳' },
              { key: 'showRodent',       label: '구서방제 (쥐)',                icon: '🐀' },
              { key: 'showDisinfection', label: '살균소독',                     icon: '🧴' },
            ].map(item => {
              const isOn = form.serviceContent?.[item.key] ?? false;
              return (
                <button
                  key={item.key}
                  onClick={() => set('serviceContent', { ...form.serviceContent, [item.key]: !isOn })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                    border: isOn ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                    background: isOn ? '#eff6ff' : '#f8fafc',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '14px', color: isOn ? '#1e40af' : '#64748b', fontWeight: isOn ? 'bold' : 'normal' }}>
                    {item.icon} {item.label}
                  </span>
                  <span style={{
                    padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold',
                    background: isOn ? '#3b82f6' : '#e2e8f0',
                    color: isOn ? 'white' : '#94a3b8',
                  }}>
                    {isOn ? 'ON ✓' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 대상 해충 선택 (일반방제 ON일 때만) */}
        {form.serviceContent?.showGeneral && (
          <div style={{ marginBottom: '14px' }}>
            <div style={styles.subLabel}>대상 해충 선택</div>
            <div style={styles.pestGrid}>
              {[
                { key: 'cockroach', label: '바퀴벌레', icon: '🪳' },
                { key: 'ant',       label: '개미',     icon: '🐜' },
                { key: 'fly',       label: '파리',     icon: '🪰' },
                { key: 'fruitfly',  label: '초파리',   icon: '🦟' },
                { key: 'bedbug',    label: '빈대',     icon: '🛏️' },
                { key: 'cigarette', label: '권연벌레', icon: '🦗' },
                { key: 'silverfish',label: '좀벌레',   icon: '🐛' },
                { key: 'dustlouse', label: '먼지다듬이',icon: '🔬' },
                { key: 'centipede', label: '그리마',   icon: '🐛' },
                { key: 'mosquito',  label: '모기',     icon: '🦟' },
                { key: 'other',     label: '기타해충', icon: '🐞' },
              ].map(pest => {
                const checked = form.serviceContent?.pests?.[pest.key] ?? false;
                return (
                  <button
                    key={pest.key}
                    onClick={() => set('serviceContent', {
                      ...form.serviceContent,
                      pests: { ...form.serviceContent?.pests, [pest.key]: !checked }
                    })}
                    style={{
                      ...styles.pestBtn,
                      ...(checked ? styles.pestBtnActive : {})
                    }}
                  >
                    <span>{pest.icon}</span>
                    <span style={{ fontSize: '11px', marginTop: '2px' }}>{pest.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 주요활동 옵션 - 토글버튼 */}
        <div>
          <div style={styles.subLabel}>주요 활동 옵션</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { key: 'includeReport', label: '📊 모니터링 보고서 제출', show: true },
              { key: 'includeRodentBox', label: '📦 구서함 설치/관리', show: !!form.serviceContent?.showRodent },
            ].filter(o => o.show).map(opt => {
              const isOn = form.serviceContent?.[opt.key] ?? true;
              return (
                <button
                  key={opt.key}
                  onClick={() => set('serviceContent', { ...form.serviceContent, [opt.key]: !isOn })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                    border: isOn ? '2px solid #10b981' : '2px solid #e2e8f0',
                    background: isOn ? '#f0fdf4' : '#f8fafc',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '14px', color: isOn ? '#166534' : '#64748b', fontWeight: isOn ? 'bold' : 'normal' }}>
                    {opt.label}
                  </span>
                  <span style={{
                    padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold',
                    background: isOn ? '#10b981' : '#e2e8f0',
                    color: isOn ? 'white' : '#94a3b8',
                  }}>
                    {isOn ? '포함 ✓' : '제외'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 월별 작업 계획표 설정 */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={styles.sectionTitle}>📅 월별 작업 계획표 설정</div>
        </div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
          💡 항목명 탭 → 행 전체 / 월 제목 탭 → 열 전체 / 각 칸 탭 → 개별 체크/해제
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '520px' }}>
            <thead>
              <tr>
                <th style={styles.planThItem}>작업항목</th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th
                    key={i}
                    style={styles.planThMonth}
                    onClick={() => {
                      const grid = { ...(form.planGrid || makeDefaultPlanGrid()) };
                      const rows = form.planRows || DEFAULT_PLAN_ROWS.map(r => ({ ...r, visible: true }));
                      // 해당 열 전체가 체크되어 있으면 해제, 아니면 전체 체크
                      const visibleKeys = rows.filter(r => r.visible !== false).map(r => r.key);
                      const allChecked = visibleKeys.every(k => grid[k]?.[i]);
                      visibleKeys.forEach(k => {
                        grid[k] = [...(grid[k] || Array(12).fill(false))];
                        grid[k][i] = !allChecked;
                      });
                      set('planGrid', grid);
                    }}
                  >
                    {i + 1}월
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(form.planRows || DEFAULT_PLAN_ROWS.map(r => ({ ...r, visible: true }))).map((row, ri) => {
                const grid = form.planGrid || makeDefaultPlanGrid();
                const rowChecks = grid[row.key] || Array(12).fill(false);
                const allRowChecked = rowChecks.every(Boolean);
                const isVisible = row.visible !== false;
                const sc = form.serviceContent || {};

                // 서비스 설정에 따라 행 숨기기
                if ((row.key === 'rodentbox' || row.key === 'rodentout') && !sc.showRodent) return null;
                if (row.key === 'disinfect' && !sc.showDisinfection) return null;

                return (
                  <tr key={row.key} style={{ background: ri % 2 === 0 ? 'white' : '#f8fafc', opacity: isVisible ? 1 : 0.4 }}>
                    <td style={{ ...styles.planTdItem, color: allRowChecked ? '#1e3a5f' : '#94a3b8', cursor: 'pointer' }}
                      onClick={() => { const ng = { ...(form.planGrid || makeDefaultPlanGrid()) }; ng[row.key] = Array(12).fill(!allRowChecked); set('planGrid', ng); }}>
                      <span style={{ marginRight: '6px', fontSize: '13px' }}>{allRowChecked ? '✅' : '⬜'}</span>{row.label}
                    </td>
                    {rowChecks.map((checked, ci) => (
                      <td key={ci} style={{ ...styles.planTdCell, background: checked ? '#dbeafe' : '#f1f5f9', cursor: 'pointer' }}
                        onClick={() => { const ng = { ...(form.planGrid || makeDefaultPlanGrid()) }; ng[row.key] = [...(ng[row.key] || Array(12).fill(false))]; ng[row.key][ci] = !ng[row.key][ci]; set('planGrid', ng); }}>
                        {checked ? '✓' : ''}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {/* 포충기 관리 행 - 포충기 ON일 때만 표시 */}
              {form.insectTrap?.enabled && (() => {
                const trapGrid = form.planGrid?.insectTrap || Array(12).fill(true);
                const allTrapChecked = trapGrid.every(Boolean);
                return (
                  <tr style={{ background: '#fef3c7' }}>
                    <td style={{ ...styles.planTdItem, color: '#92400e', cursor: 'pointer', fontWeight: 'bold' }}
                      onClick={() => {
                        const ng = { ...(form.planGrid || makeDefaultPlanGrid()), insectTrap: Array(12).fill(!allTrapChecked) };
                        set('planGrid', ng);
                      }}>
                      <span style={{ marginRight: '6px' }}>{allTrapChecked ? '✅' : '⬜'}</span>🪰 포충기 관리
                    </td>
                    {trapGrid.map((checked, ci) => (
                      <td key={ci} style={{ ...styles.planTdCell, background: checked ? '#fde68a' : '#f1f5f9', color: '#92400e', cursor: 'pointer' }}
                        onClick={() => {
                          const cur = form.planGrid?.insectTrap || Array(12).fill(true);
                          const next = [...cur]; next[ci] = !next[ci];
                          set('planGrid', { ...(form.planGrid || makeDefaultPlanGrid()), insectTrap: next });
                        }}>
                        {checked ? '✓' : ''}
                      </td>
                    ))}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
          ※ 실제 작업일은 고객사와 협의 후 시행
        </div>
      </div>

      {/* 월별 작업횟수 개별 설정 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔢 월별 작업횟수 설정</div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
          기본 횟수({form.visitPerMonth || 1}회/월)와 다른 월만 개별 설정하세요.
          {form.periodType !== 'none' && (
            <span style={{ marginLeft:6, color:'#3b82f6', fontWeight:600 }}>
              · 기간 설정에서 선택한 월만 활성화돼요
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '520px', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ ...styles.planThItem, background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0' }}>구분</th>
                {Array.from({ length: 12 }, (_, i) => {
                  // 기간 설정에 따라 활성 월 결정
                  const isActive = (() => {
                    if (form.periodType !== 'specific') return true;
                    return (form.periodSpecific||[]).includes(i+1);
                  })();
                  return (
                    <th key={i} style={{
                      ...styles.planThMonth,
                      background: isActive ? '#dbeafe' : '#f1f5f9',
                      color: isActive ? '#1e40af' : '#9ca3af',
                      border: '1px solid #e2e8f0', cursor: 'default',
                      fontWeight: isActive ? 700 : 400,
                    }}>{i+1}월</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* 작업횟수 행 */}
              <tr>
                <td style={{ ...styles.planTdItem, fontWeight: 'bold', color: '#374151' }}>작업횟수</td>
                {Array.from({ length: 12 }, (_, i) => {
                  const isActive = (() => {
                    if (form.periodType !== 'specific') return true;
                    return (form.periodSpecific||[]).includes(i+1);
                  })();
                  const mv  = form.monthlyVisits || Array(12).fill(null);
                  const val = mv[i];
                  return (
                    <td key={i} style={{
                      border: '1px solid #e2e8f0', textAlign: 'center', padding: '3px 2px',
                      background: isActive ? 'white' : '#f8fafc',
                    }}>
                      {isActive ? (
                        <input type="number" min="0" max="99"
                          value={val === null ? '' : val}
                          placeholder={form.visitPerMonth || 1}
                          onChange={e => {
                            const newMv = [...(form.monthlyVisits || Array(12).fill(null))];
                            newMv[i] = e.target.value === '' ? null : parseInt(e.target.value) || 0;
                            set('monthlyVisits', newMv);
                          }}
                          style={{ width: '30px', textAlign: 'center',
                            border: val !== null ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                            borderRadius: '4px', padding: '3px 2px', fontSize: '12px',
                            background: val !== null ? '#eff6ff' : 'transparent' }}
                        />
                      ) : (
                        <span style={{ fontSize: 12, color: '#d1d5db' }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {/* 금액변동 행 */}
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ ...styles.planTdItem, fontSize: '11px', color: '#64748b' }}>금액변동</td>
                {Array.from({ length: 12 }, (_, i) => {
                  const isActive = (() => {
                    if (form.periodType !== 'specific') return true;
                    return (form.periodSpecific||[]).includes(i+1);
                  })();
                  const mvpc = form.monthlyVisitPriceChange || Array(12).fill(false);
                  const isOn = mvpc[i];
                  return (
                    <td key={i} style={{
                      border: '1px solid #e2e8f0', textAlign: 'center', padding: '4px 2px',
                      background: isActive ? '#f8fafc' : '#f1f5f9',
                    }}>
                      {isActive ? (
                        <button onClick={() => {
                          const next = [...(form.monthlyVisitPriceChange || Array(12).fill(false))];
                          next[i] = !next[i];
                          set('monthlyVisitPriceChange', next);
                        }} style={{ fontSize: '10px', padding: '2px 4px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                          background: isOn ? '#fef3c7' : '#f1f5f9', color: isOn ? '#92400e' : '#94a3b8', fontWeight: isOn ? 'bold' : 'normal' }}>
                          {isOn ? '변동' : '유지'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: '#d1d5db' }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
          💡 횟수 입력 시 파란 테두리. 금액변동 "유지"=기본금액 그대로, "변동"=단가×해당월횟수로 재계산
        </div>
      </div>

      {/* 월별 금액표 */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={styles.sectionTitle2}>📊 월별 금액표</div>
          <button onClick={() => set('showMonthlyTable', !form.showMonthlyTable)}
            style={{ ...styles.toggleBtn, background: form.showMonthlyTable ? '#3b82f6' : '#e2e8f0', color: form.showMonthlyTable ? 'white' : '#64748b' }}>
            {form.showMonthlyTable ? 'ON ✓' : 'OFF'}
          </button>
        </div>
        {form.showMonthlyTable && (() => {
          const detail = monthlyDetail;
          const annualSvc = detail.reduce((s, m) => s + m.serviceMonthly, 0);
          const annualTrap = detail.reduce((s, m) => s + m.trapMonthly, 0);
          const annualAll = annualSvc + annualTrap;
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '600px', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#1e3a5f', color: 'white' }}>
                    <th style={{ padding: '7px 8px', textAlign: 'left', border: '1px solid rgba(255,255,255,0.2)', minWidth: '70px' }}>구분</th>
                    {detail.map(m => (
                      <th key={m.month} style={{
                        padding: '7px 3px', textAlign: 'center',
                        border: '1px solid rgba(255,255,255,0.2)', width: '50px',
                        background: m.inactive ? '#374151' : 'transparent',
                        color: m.inactive ? '#6b7280' : 'white',
                      }}>{m.month}월</th>
                    ))}
                    <th style={{ padding: '7px 4px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.2)', background: '#0f2340', minWidth: '70px' }}>연간</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 8px', border: '1px solid #e2e8f0', fontWeight: 'bold', color: '#374151' }}>작업횟수</td>
                    {detail.map(m => (
                      <td key={m.month} style={{
                        padding: '6px 3px', border: '1px solid #e2e8f0', textAlign: 'center',
                        background: m.inactive ? '#f8fafc' : 'white',
                        color: m.inactive ? '#d1d5db' : ((form.monthlyVisits||[])[m.month-1] !== null ? '#1e40af' : '#374151'),
                        fontWeight: (!m.inactive && (form.monthlyVisits||[])[m.month-1] !== null) ? 'bold' : 'normal',
                      }}>
                        {m.inactive ? '—' : `${m.visits}회`}
                      </td>
                    ))}
                    <td style={{ padding: '6px 4px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 'bold', background: '#f8fafc' }}>
                      {detail.filter(m=>!m.inactive).reduce((s, m) => s + m.visits, 0)}회
                    </td>
                  </tr>
                  <tr style={{ background: '#f0fdf4' }}>
                    <td style={{ padding: '6px 8px', border: '1px solid #e2e8f0', fontWeight: 'bold', color: '#166534' }}>방제비용</td>
                    {detail.map(m => (
                      <td key={m.month} style={{
                        padding: '6px 3px', border: '1px solid #e2e8f0', textAlign: 'right',
                        color: m.inactive ? '#d1d5db' : '#166534',
                        background: m.inactive ? '#f8fafc' : '#f0fdf4',
                      }}>
                        {m.inactive ? '—' : (m.serviceMonthly > 0 ? (m.serviceMonthly / 10000).toFixed(1) + '만' : '-')}
                      </td>
                    ))}
                    <td style={{ padding: '6px 4px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 'bold', color: '#166534', background: '#f0fdf4' }}>
                      {(annualSvc / 10000).toFixed(0)}만원
                    </td>
                  </tr>
                  {form.insectTrap?.enabled && (
                    <tr style={{ background: '#fef3c7' }}>
                      <td style={{ padding: '6px 8px', border: '1px solid #e2e8f0', fontWeight: 'bold', color: '#92400e' }}>🪰 포충기</td>
                      {detail.map(m => (
                        <td key={m.month} style={{
                          padding: '6px 3px', border: '1px solid #e2e8f0', textAlign: 'right',
                          color: m.inactive ? '#d1d5db' : '#d97706',
                          background: m.inactive ? '#f8fafc' : '#fef3c7',
                        }}>
                          {m.inactive ? '—' : (m.trapMonthly > 0 ? (m.trapMonthly / 10000).toFixed(1) + '만' : '-')}
                        </td>
                      ))}
                      <td style={{ padding: '6px 4px', border: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 'bold', color: '#d97706', background: '#fef3c7' }}>
                        {(annualTrap / 10000).toFixed(0)}만원
                      </td>
                    </tr>
                  )}
                  <tr style={{ background: '#1e3a5f' }}>
                    <td style={{ padding: '7px 8px', border: '1px solid rgba(255,255,255,0.2)', fontWeight: 'bold', color: 'white' }}>월 합계</td>
                    {detail.map(m => (
                      <td key={m.month} style={{
                        padding: '7px 3px', border: '1px solid rgba(255,255,255,0.2)', textAlign: 'right',
                        color: m.inactive ? '#4b5563' : '#bbf7d0',
                        fontWeight: 'bold',
                        background: m.inactive ? '#111827' : 'transparent',
                      }}>
                        {m.inactive ? '—' : (m.total > 0 ? (m.total / 10000).toFixed(1) + '만' : '-')}
                      </td>
                    ))}
                    <td style={{ padding: '7px 4px', border: '1px solid rgba(255,255,255,0.2)', textAlign: 'right', fontWeight: 'bold', color: '#fbbf24', background: '#0f2340', fontSize: '12px' }}>
                      {(annualAll / 10000).toFixed(0)}만원
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 'bold', color: '#1e3a5f', marginTop: '6px' }}>
                {form.periodType !== 'none' && periodInfo.months > 0
                  ? `기간 합계 (${periodInfo.label}): ${formatPrice(periodInfo.total)}`
                  : `연간 총계: ${formatPrice(annualAll)}`
                }
              </div>
            </div>
          );
        })()}
      </div>

      {/* 메모 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle2}>💬 견적 메모</div>
        <textarea
          style={{ ...styles.input, height: '80px', resize: 'vertical' }}
          value={form.memo || ''}
          onChange={e => set('memo', e.target.value)}
          placeholder="고객에게 전달할 특이사항, 조건 등"
        />
      </div>

      {/* 🔗 고객 링크 설정 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>🔗 고객 공유 링크 설정</div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '12px' }}>
          고객에게 공유하는 링크에서 허용할 기능을 설정하세요.
        </div>
        {[
          { key: 'allowEdit',        label: '고객 수정 허용',       desc: '고객이 견적 내용을 수정할 수 있습니다.' },
          { key: 'allowTrapToggle',  label: '포충기 추가/제외 허용', desc: '고객이 포충기를 포함하거나 뺄 수 있습니다.' },
          { key: 'allowZoneAdjust',  label: '구획 수량 조정 허용',   desc: '고객이 구획 수를 조정할 수 있습니다.' },
          { key: 'allowZoneRequest', label: '구획 추가 요청 허용',   desc: '고객이 새 구획을 추가 요청할 수 있습니다.' },
        ].map(opt => {
          const isOn = form.linkSettings?.[opt.key] ?? false;
          return (
            <button key={opt.key} onClick={() => set('linkSettings', { ...form.linkSettings, [opt.key]: !isOn })}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', padding: '10px 14px', marginBottom: '6px', borderRadius: '8px',
                border: isOn ? '1.5px solid #3b82f6' : '1.5px solid #e2e8f0',
                background: isOn ? '#eff6ff' : '#f8fafc', cursor: 'pointer', textAlign: 'left' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: isOn ? '#1e40af' : '#374151' }}>{opt.label}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{opt.desc}</div>
              </div>
              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold',
                background: isOn ? '#3b82f6' : '#e2e8f0', color: isOn ? 'white' : '#94a3b8', flexShrink: 0, marginLeft: '8px' }}>
                {isOn ? 'ON ✓' : 'OFF'}
              </span>
            </button>
          );
        })}
      </div>

      {/* 유효기간 + 템플릿 저장 */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>⚙️ 저장 옵션</div>
        <div style={styles.row}>
          <label style={styles.label}>유효기간</label>
          <div style={styles.stepper}>
            <button type="button" style={styles.stepBtn} onClick={() => set('validityDays', Math.max(7, (form.validityDays||30) - 7))}>−</button>
            <span style={styles.stepVal}>{form.validityDays || 30}일</span>
            <button type="button" style={styles.stepBtn} onClick={() => set('validityDays', (form.validityDays||30) + 7)}>+</button>
          </div>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            만료: {new Date(Date.now() + (form.validityDays||30)*86400000).toLocaleDateString('ko-KR')}
          </span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer' }}>
          <input type="checkbox" id="saveAsTemplate"
            style={{ width: '16px', height: '16px', accentColor: '#10b981' }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#166534' }}>📋 템플릿으로도 저장</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>다음에 비슷한 견적 작성 시 불러올 수 있습니다</div>
          </div>
        </label>
      </div>

      <div style={styles.footer}>
        <button onClick={onCancel} style={styles.cancelBtn}>취소</button>
        <button onClick={async () => {
          const saveTemplate = document.getElementById('saveAsTemplate')?.checked;
          if (saveTemplate) {
            const { value: tplName } = await Swal.fire({
              title: '템플릿 이름',
              input: 'text',
              inputValue: form.title || 'A안',
              inputPlaceholder: '예: 음식점 기본형, 학교 표준형',
              showCancelButton: true,
              confirmButtonText: '저장',
              cancelButtonText: '취소',
            });
            if (tplName) {
              await saveAsTemplate(form, tplName, currentUser);
            }
          }
          handleSave();
        }} style={styles.saveBtn}>💾 견적 저장</button>
      </div>
    </div>
  );
}

const styles = {
  container: { paddingBottom: '30px' },
  header: {
    display: 'flex', alignItems: 'center', marginBottom: '14px',
    paddingBottom: '12px', borderBottom: '1px solid #e2e8f0'
  },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', padding: '4px 8px' },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', margin: '0 0 0 8px', flex: 1 },
  custName: { fontSize: '16px', fontWeight: 'bold', color: '#1e293b' },
  custSub: { fontSize: '12px', color: '#94a3b8', marginTop: '2px' },
  priceTableBtn: { padding: '7px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' },
  tabBar: { display: 'flex', gap: '6px', marginBottom: '14px', overflowX: 'auto', paddingBottom: '4px' },
  tab: { padding: '8px 18px', border: '1.5px solid #e2e8f0', borderRadius: '20px', background: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', color: '#64748b', whiteSpace: 'nowrap' },
  tabActive: { background: '#3b82f6', color: 'white', border: '1.5px solid #3b82f6' },
  addTabBtn: { padding: '8px 14px', border: '1.5px dashed #94a3b8', borderRadius: '20px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' },
  empty: { textAlign: 'center', padding: '60px 20px' },
  summaryCard: { background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '12px' },
  summaryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  badge: { padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', marginRight: '8px' },
  quoteTitle: { fontSize: '16px', fontWeight: 'bold', color: '#1e293b' },
  priceBox: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px 14px', marginBottom: '10px' },
  priceLabel: { fontSize: '12px', color: '#16a34a', fontWeight: 'bold', marginBottom: '4px' },
  priceMain: { fontSize: '24px', fontWeight: 'bold', color: '#10b981' },
  priceSub: { fontSize: '12px', color: '#64748b', marginTop: '2px' },
  serviceList: { borderTop: '1px solid #f1f5f9', paddingTop: '10px', marginTop: '4px' },
  serviceRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', color: '#374151' },
  memo: { fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', marginTop: '8px' },
  photoRow: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' },
  photoThumb: { width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e2e8f0' },
  cardActions: { display: 'flex', gap: '8px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' },
  pdfBtn: { flex: 2, padding: '9px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  editBtn: { flex: 1, padding: '9px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' },
  deleteBtn: { padding: '9px 12px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' },
  compareBox: { background: 'white', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '12px' },
  compareTitle: { fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '10px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  thead: { background: '#f8fafc' },
  th: { padding: '8px 10px', textAlign: 'center', fontWeight: 'bold', color: '#374151', borderBottom: '1px solid #e2e8f0' },
  td: { padding: '8px 10px', color: '#374151', borderBottom: '1px solid #f1f5f9' },
  tdVal: { padding: '8px 10px', textAlign: 'center', color: '#374151', borderBottom: '1px solid #f1f5f9' },
  actionRow: { display: 'flex', gap: '8px', marginTop: '8px' },
  primaryBtn: { flex: 1, padding: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' },
  secondaryBtn: { flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontSize: '14px' },
  // Editor styles
  section: { background: 'white', borderRadius: '12px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sectionTitle: { fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' },
  sectionTitle2: { fontSize: '14px', fontWeight: 'bold', color: '#374151' },
  row: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' },
  label: { fontSize: '13px', color: '#374151', fontWeight: 'bold', minWidth: '100px' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' },
  stepper: { display: 'flex', alignItems: 'center', gap: '10px' },
  stepBtn: { width: '32px', height: '32px', border: '1px solid #ddd', borderRadius: '8px', background: '#f8fafc', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stepVal: { fontSize: '15px', fontWeight: 'bold', color: '#1e293b', minWidth: '80px', textAlign: 'center' },
  svcCard: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', marginBottom: '10px' },
  svcHeader: { display: 'flex', gap: '8px', marginBottom: '6px' },
  svcSelect: { flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' },
  removeSvcBtn: { padding: '4px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
  svcGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' },
  svcLabel: { fontSize: '11px', color: '#64748b', marginBottom: '3px' },
  svcInput: { width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' },
  addSvcBtn: { padding: '7px 12px', background: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  totalBox: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px 14px', marginTop: '12px' },
  totalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  totalPrice: { fontSize: '20px', fontWeight: 'bold', color: '#10b981' },
  initialInfo: { fontSize: '12px', color: '#92400e', background: '#fef3c7', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', lineHeight: '1.5' },
  toggleBtn: { padding: '6px 16px', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' },
  photoGrid: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  photoWrap: { position: 'relative' },
  photoImg: { width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0' },
  removePhotoBtn: { position: 'absolute', top: '-6px', right: '-6px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  footer: { display: 'flex', gap: '10px', marginTop: '20px' },
  cancelBtn: { flex: 1, padding: '13px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontSize: '15px' },
  miniStepBtn: {
    width: '22px', height: '22px', border: '1px solid #ddd', borderRadius: '4px',
    background: '#f8fafc', cursor: 'pointer', fontSize: '13px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0,
  },
  saveBtn: { flex: 2, padding: '13px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' },
  // 서비스 내용 / 계획표 스타일
  subLabel: { fontSize: '12px', fontWeight: 'bold', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', cursor: 'pointer' },
  checkbox: { width: '16px', height: '16px', cursor: 'pointer', accentColor: '#3b82f6' },
  pestGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' },
  pestBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 4px', border: '1.5px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', cursor: 'pointer', fontSize: '16px', gap: '2px' },
  pestBtnActive: { border: '1.5px solid #3b82f6', background: '#eff6ff', color: '#1e40af' },
  planThItem: { padding: '8px 10px', background: '#1e3a5f', color: 'white', fontSize: '12px', fontWeight: 'bold', textAlign: 'left', border: '1px solid rgba(255,255,255,0.2)', minWidth: '130px', whiteSpace: 'nowrap' },
  planThMonth: { padding: '7px 3px', background: '#1e3a5f', color: 'white', fontSize: '11px', fontWeight: 'bold', textAlign: 'center', border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', width: '32px' },
  planTdItem: { padding: '7px 10px', border: '1px solid #e2e8f0', fontSize: '12px', whiteSpace: 'nowrap' },
  planTdCell: { border: '1px solid #e2e8f0', textAlign: 'center', fontSize: '12px', color: '#1e40af', fontWeight: 'bold', width: '32px', height: '32px' },
};

// Q&A 아이템 컴포넌트 (담당자 답변용)
function QnAItem({ qa, onAnswered }) {
  const [answerText, setAnswerText] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  const handleAnswer = async () => {
    if (!answerText.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'quoteQnA', qa.id), {
        answer: answerText.trim(),
        answeredAt: new Date().toISOString(),
      });
      onAnswered({ ...qa, answer: answerText.trim(), answeredAt: new Date().toISOString() });
      setEditing(false);
      setAnswerText('');
    } catch (e) { alert('답변 저장 실패'); }
    setSaving(false);
  };

  return (
    <div style={{ marginBottom: '12px', padding: '10px 12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
      <div style={{ fontSize: '11px', color: '#0369a1', marginBottom: '4px' }}>Q · {qa.createdAt?.split('T')[0]} · {qa.custName}</div>
      <div style={{ fontSize: '13px', color: '#0c4a6e', marginBottom: '8px' }}>{qa.question}</div>
      {qa.answer && !editing ? (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '8px 10px' }}>
          <div style={{ fontSize: '11px', color: '#166534', marginBottom: '3px' }}>A · {qa.answeredAt?.split('T')[0]}</div>
          <div style={{ fontSize: '13px', color: '#14532d' }}>{qa.answer}</div>
          <button onClick={() => { setEditing(true); setAnswerText(qa.answer); }}
            style={{ marginTop: '6px', fontSize: '11px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
            수정
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea value={answerText} onChange={e => setAnswerText(e.target.value)}
            placeholder="답변을 입력하세요"
            style={{ flex: 1, padding: '8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', height: '60px', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button onClick={handleAnswer} disabled={saving}
              style={{ padding: '8px 14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
              {saving ? '...' : '답변'}
            </button>
            {editing && (
              <button onClick={() => setEditing(false)}
                style={{ padding: '6px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                취소
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default QuoteDetail;
