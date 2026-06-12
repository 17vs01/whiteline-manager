import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import Swal from 'sweetalert2';
import { QUOTE_CUSTOMER_STATUS, BUSINESS_TYPES } from './quoteConstants';
import QuoteCustomerForm from './QuoteCustomerForm';
import QuoteDetail from './QuoteDetail';
import QuoteDashboard from './QuoteDashboard';
import QuoteHistory from './QuoteHistory';

function QuotePage({ currentUser, staffList, apiKey = '', initialQuoteId = null, onQuoteOpened, onNavigateToContract, initialNewCustomerData = null, onInitialDataUsed }) {
  const [tab, setTab] = useState('quote'); // 'quote' | 'cancelled' | 'dashboard'
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [renewalAlerts, setRenewalAlerts] = useState([]);
  const [quoteCustomers, setQuoteCustomers] = useState([]);
  const [cancelledCustomers, setCancelledCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('list'); // 'list' | 'form' | 'detail'
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null); // 특정 견적서로 바로 이동

  useEffect(() => {
    fetchData();
  }, []);

  // 영업→견적 전환: 데이터 자동 채워서 새 고객 폼 열기
  useEffect(() => {
    if (!initialNewCustomerData) return;
    setSelectedCustomer({
      custName:   initialNewCustomerData.custName || '',
      area:       initialNewCustomerData.area || '',
      memo:       initialNewCustomerData.memo || '',
      staffName:  currentUser?.name || '',
    });
    setView('form');
    if (onInitialDataUsed) onInitialDataUsed();
  }, [initialNewCustomerData]);

  // 알림에서 특정 견적서 ID가 전달된 경우 자동으로 해당 견적서 열기
  useEffect(() => {
    if (!initialQuoteId || loading || quoteCustomers.length === 0) return;

    // 해당 quoteId를 가진 견적고객 찾기
    const findAndOpen = async () => {
      try {
        const { collection: col, getDocs: gd, query: q, where: w } = await import('firebase/firestore');
        const { db: firestoreDb } = await import('../../firebase');
        const snap = await gd(q(col(firestoreDb, 'quotes'), w('__name__', '==', initialQuoteId)));
        if (!snap.empty) {
          const quoteData = snap.docs[0].data();
          const customer = quoteCustomers.find(c => c.id === quoteData.quoteCustomerId);
          if (customer) {
            setSelectedCustomer(customer);
            setSelectedQuote(initialQuoteId);
            setView('detail');
          }
        }
      } catch (e) {
        console.error('견적서 자동 열기 실패:', e);
      } finally {
        if (onQuoteOpened) onQuoteOpened(); // 처리 완료 후 부모에게 알림
      }
    };
    findAndOpen();
  }, [initialQuoteId, loading, quoteCustomers, onQuoteOpened]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 견적고객 로드
      const qSnap = await getDocs(collection(db, 'quoteCustomers'));
      const qList = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setQuoteCustomers(qList);

      // 기존 고객 로드 (해약 + 재계약 임박)
      const cSnap = await getDocs(collection(db, 'customers'));
      const allCustomers = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 해약고객
      const cancelled = allCustomers.filter(c => c.custStatus === '해약');
      setCancelledCustomers(cancelled);

      // 재계약 임박 (30일 이내 만료 예정인 정상 고객)
      const now = new Date();
      const soon = allCustomers.filter(c => {
        if (c.custStatus !== '정상' || !c.contractPeriod) return false;
        try {
          const parts = c.contractPeriod.split('-');
          if (parts.length < 2) return false;
          const endStr = parts[parts.length - 1].trim().replace(/\./g, '-');
          const endDate = new Date(endStr);
          if (isNaN(endDate)) return false;
          const daysLeft = Math.ceil((endDate - now) / 86400000);
          return daysLeft >= 0 && daysLeft <= 30;
        } catch (e) { return false; }
      }).map(c => {
        const parts = c.contractPeriod.split('-');
        const endStr = parts[parts.length - 1].trim().replace(/\./g, '-');
        const daysLeft = Math.ceil((new Date(endStr) - now) / 86400000);
        return { ...c, daysLeft };
      }).sort((a, b) => a.daysLeft - b.daysLeft);
      setRenewalAlerts(soon);

    } catch (e) {
      console.error('데이터 로드 오류:', e);
    }
    setLoading(false);
  };

  const handleNewCustomer = () => {
    setSelectedCustomer(null);
    setView('form');
  };

  const handleEditCustomer = (customer) => {
    setSelectedCustomer(customer);
    setView('form');
  };

  const handleOpenDetail = (customer, quoteId = null) => {
    setSelectedCustomer(customer);
    setSelectedQuote(quoteId);
    setView('detail');
  };

  const handleOpenHistory = (customer) => {
    setHistoryCustomer(customer);
  };

  const handleBack = () => {
    setView('list');
    setSelectedCustomer(null);
    setSelectedQuote(null);
    fetchData();
  };

  const handleSaveCustomer = async (data) => {
    try {
      if (data.id) {
        const { id, ...rest } = data;
        await updateDoc(doc(db, 'quoteCustomers', id), { ...rest, updatedAt: new Date().toISOString() });
      } else {
        await addDoc(collection(db, 'quoteCustomers'), {
          ...data,
          status: 'pending',
          createdAt: new Date().toISOString(),
          createdBy: currentUser?.name || '',
        });
      }
      await fetchData();
      setView('list');
      Swal.fire({ icon: 'success', title: '저장 완료', timer: 1200, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '저장에 실패했습니다: ' + e.message, 'error');
    }
  };

  // 견적 → 계약서 생성 (데이터 자동 이관)
  const handleCreateContract = async (quote, quoteCustomer) => {
    try {
      Swal.fire({ title: '계약서 생성 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      // 계약서 기본 데이터 구성 (견적 내용 이관)
      const contractData = {
        custName:            quoteCustomer?.custName || '',
        phone:               quoteCustomer?.phone || '',
        address:             quoteCustomer?.address || '',
        businessType:        quoteCustomer?.businessType || '',
        area:                quoteCustomer?.area || '',
        unitCount:           quoteCustomer?.unitCount || '',
        floors:              quoteCustomer?.floors || '',
        staffName:           quoteCustomer?.staffName || currentUser?.name || '',
        representativeName:  quoteCustomer?.representativeName || '',
        businessNumber:      quoteCustomer?.businessNumber || '',
        // 견적 금액 이관
        monthlyFee:          quote?.monthlyTotal || quote?.totalPrice || 0,
        initialFee:          quote?.initialTotal || 0,
        visitPerMonth:       quote?.visitPerMonth || 1,
        serviceScope:        quote?.serviceScope || '',
        contractType:        'basic',
        // 출처 연결
        fromQuoteId:         quote?.id || null,
        fromQuoteCustomerId: quoteCustomer?.id || null,
        status:              'draft',
        createdAt:           new Date().toISOString(),
        createdBy:           currentUser?.name || '',
      };

      await addDoc(collection(db, 'contracts'), contractData);

      // 견적 상태를 'contracted'로 업데이트
      if (quote?.id) {
        await updateDoc(doc(db, 'quotes', quote.id), {
          status: 'contracted',
          contractedAt: new Date().toISOString(),
        });
      }

      Swal.fire({
        icon: 'success',
        title: '📃 계약서 생성 완료!',
        html: `<b>${quoteCustomer?.custName}</b>의 계약서가 생성되었습니다.<br>
               <span style="font-size:12px;color:#6b7280;">계약서 탭에서 내용을 확인하고 발송하세요.</span>`,
        confirmButtonText: '계약서 탭으로 이동',
        showCancelButton: true,
        cancelButtonText: '여기 있기',
      }).then(r => {
        if (r.isConfirmed && onNavigateToContract) {
          onNavigateToContract();
        }
      });

      fetchData();
    } catch(e) {
      Swal.fire('오류', '계약서 생성 실패: ' + e.message, 'error');
    }
  };

  const handleDeleteCustomer = async (customer) => {
    const result = await Swal.fire({
      title: '견적고객 삭제',
      html: `<b>${customer.custName}</b> 고객을 삭제하시겠습니까?<br><span style="color:#ef4444;font-size:13px;">관련 견적서도 모두 삭제됩니다.</span>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
    });
    if (!result.isConfirmed) return;

    try {
      // 관련 견적서 삭제
      const qSnap = await getDocs(collection(db, 'quotes'));
      const related = qSnap.docs.filter(d => d.data().quoteCustomerId === customer.id);
      for (const d of related) await deleteDoc(doc(db, 'quotes', d.id));
      // 견적고객 삭제
      await deleteDoc(doc(db, 'quoteCustomers', customer.id));
      await fetchData();
      Swal.fire({ icon: 'success', title: '삭제 완료', timer: 1200, showConfirmButton: false });
    } catch (e) {
      Swal.fire('오류', '삭제 실패: ' + e.message, 'error');
    }
  };

  const handleConvertToCustomer = async (qc) => {
    const result = await Swal.fire({
      title: '🎉 계약 전환',
      html: `
        <div style="text-align:left;padding:10px;">
          <p><b>${qc.custName}</b> 고객을 정식 고객으로 전환합니다.</p>
          <p style="color:#10b981;font-size:13px;margin-top:8px;">✅ 고객코드가 자동 발급됩니다.</p>
          <p style="font-size:12px;color:#666;margin-top:4px;">전환 후 고객관리에서 확인하실 수 있습니다.</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonColor: '#10b981',
      confirmButtonText: '전환 완료',
      cancelButtonText: '취소',
    });
    if (!result.isConfirmed) return;

    try {
      Swal.fire({ title: '처리 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      // 새 고객코드 발급 (기존 최대값 + 1, 4자리)
      const custSnap = await getDocs(collection(db, 'customers'));
      const codes = custSnap.docs
        .map(d => parseInt(d.data().code || '0'))
        .filter(n => !isNaN(n));
      const maxCode = codes.length > 0 ? Math.max(...codes) : 0;
      const newCode = String(maxCode + 1).padStart(4, '0');

      // customers 컬렉션에 추가
      await addDoc(collection(db, 'customers'), {
        code: newCode,
        custName: qc.custName,
        phone: qc.phone || '',
        address: qc.address || '',
        area: qc.area || '',
        businessType: qc.businessType || '',
        unitCount: qc.unitCount || '',
        staffName: qc.staffName || currentUser?.name || '',
        memo: qc.memo || '',
        custStatus: '정상',
        contractPeriod: qc.contractPeriod || '',
        services: qc.services || [],
        convertedFrom: qc.id,
        createdAt: new Date().toISOString(),
      });

      // 견적고객 상태 업데이트
      await updateDoc(doc(db, 'quoteCustomers', qc.id), {
        status: 'contracted',
        contractedAt: new Date().toISOString(),
        newCode,
      });

      await fetchData();

      // 배정플랜에 알림 (notifications 컬렉션)
      try {
        const { addDoc, collection: col } = await import('firebase/firestore');
        const { db: fdb } = await import('../../firebase');
        await addDoc(col(fdb, 'notifications'), {
          type: 'newCustomerConverted',
          customerName: qc.custName,
          customerCode: newCode,
          message: `견적고객 ${qc.custName}이 정식 고객(${newCode})으로 전환되었습니다. 배정플랜에 추가해주세요!`,
          read: false,
          createdAt: new Date().toISOString(),
          createdBy: currentUser?.name || '',
        });
      } catch(e) { console.warn('전환 알림 저장 오류:', e); }

      Swal.fire({
        icon: 'success',
        title: '🎉 계약 전환 완료!',
        html: `고객코드 <b>${newCode}</b>가 발급되었습니다.<br><span style="font-size:12px;color:#059669;">✅ 관리자에게 배정 알림이 전송됐어요!</span>`,
      });
    } catch (e) {
      Swal.fire('오류', '전환 실패: ' + e.message, 'error');
    }
  };

  // 검색 필터
  const filterList = (list) => {
    if (!searchTerm.trim()) return list;
    const term = searchTerm.toLowerCase();
    return list.filter(c =>
      (c.custName || '').toLowerCase().includes(term) ||
      (c.address || '').toLowerCase().includes(term) ||
      (c.phone || '').includes(term)
    );
  };

  const getBusinessLabel = (value) => {
    const found = BUSINESS_TYPES.find(b => b.value === value);
    return found ? `${found.icon} ${found.label}` : value || '-';
  };

  // 서브뷰 렌더링
  if (view === 'form') {
    return (
      <QuoteCustomerForm
        customer={selectedCustomer}
        currentUser={currentUser}
        staffList={staffList}
        apiKey={apiKey}
        onSave={handleSaveCustomer}
        onBack={() => setView('list')}
      />
    );
  }

  if (view === 'detail') {
    return (
      <QuoteDetail
        quoteCustomer={selectedCustomer}
        initialQuoteId={selectedQuote}
        currentUser={currentUser}
        staffList={staffList}
        onBack={handleBack}
        onConvert={handleConvertToCustomer}
        onCreateContract={(quote) => handleCreateContract(quote, selectedCustomer)}
        onNavigateToContract={onNavigateToContract}
      />
    );
  }

  // 메인 리스트
  const filteredQuote = filterList(quoteCustomers);
  const filteredCancelled = filterList(cancelledCustomers);

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <div style={styles.header}>
        <h2 style={styles.title}>📄 견적 관리</h2>
        <button onClick={handleNewCustomer} style={styles.addBtn}>
          + 견적고객 등록
        </button>
      </div>

      {/* 검색 */}
      <div style={styles.searchBox}>
        <span style={styles.searchIcon}>🔍</span>
        <input
          type="text"
          placeholder="고객명, 주소, 연락처 검색"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} style={styles.clearBtn}>✕</button>
        )}
      </div>

      {/* 재계약 임박 알림 */}
      {renewalAlerts.length > 0 && (
        <div style={styles.renewalBox}>
          <div style={styles.renewalTitle}>🔔 계약 만료 임박 ({renewalAlerts.length}건)</div>
          {renewalAlerts.map(c => (
            <div key={c.id} style={styles.renewalItem}>
              <div style={{ flex: 1 }}>
                <span style={styles.renewalCode}>{c.code}</span>
                <span style={styles.renewalName}>{c.custName || c.name}</span>
                <span style={{
                  marginLeft: '8px', fontSize: '11px', fontWeight: 'bold',
                  color: c.daysLeft <= 7 ? '#ef4444' : '#f59e0b'
                }}>
                  {c.daysLeft === 0 ? '오늘 만료!' : `D-${c.daysLeft}`}
                </span>
              </div>
              <div style={styles.renewalInfo}>
                {c.contractPeriod && <span>{c.contractPeriod}</span>}
                {c.staffName && <span>👤 {c.staffName}</span>}
              </div>
              <button
                onClick={async () => {
                  // 기존 고객 기반으로 견적고객 임시 생성 후 견적 탭으로
                  const { addDoc, collection } = await import('firebase/firestore');
                  const { db } = await import('../../firebase');
                  try {
                    // eslint-disable-next-line no-unused-vars
                    const docRef = await addDoc(collection(db, 'quoteCustomers'), {
                      custName: c.custName || c.name,
                      phone: c.phone || '',
                      address: c.address || '',
                      area: c.area || '',
                      businessType: c.businessType || '',
                      staffName: c.staffName || '',
                      memo: `재계약 견적 (기존 고객 ${c.code})`,
                      status: 'pending',
                      renewalFromCode: c.code,
                      createdAt: new Date().toISOString(),
                    });
                    await fetchData();
                    setTab('quote');
                  } catch (e) {
                    alert('견적고객 생성 실패: ' + e.message);
                  }
                }}
                style={styles.renewalBtn}
              >
                📄 재견적 작성
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 탭 */}
      <div style={styles.tabBar}>
        <button
          style={{ ...styles.tabBtn, ...(tab === 'quote' ? styles.tabActive : {}) }}
          onClick={() => setTab('quote')}
        >
          📋 견적고객 ({quoteCustomers.length})
        </button>
        <button
          style={{ ...styles.tabBtn, ...(tab === 'cancelled' ? styles.tabActive : {}) }}
          onClick={() => setTab('cancelled')}
        >
          🔴 해약 재견적 ({cancelledCustomers.length})
        </button>
        <button
          style={{ ...styles.tabBtn, ...(tab === 'dashboard' ? styles.tabActive : {}), flex: 'none', padding: '10px 12px' }}
          onClick={() => setTab('dashboard')}
        >
          📊
        </button>
      </div>

      {loading ? (
        <div style={styles.loading}>로딩 중...</div>
      ) : (
        <>
          {/* 대시보드 탭 */}
          {tab === 'dashboard' && (
            <QuoteDashboard currentUser={currentUser} staffList={staffList} />
          )}

          {/* 견적고객 탭 */}
          {tab === 'quote' && (
            <div>
              {filteredQuote.length === 0 ? (
                <div style={styles.empty}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
                  <div style={{ color: '#666' }}>
                    {searchTerm ? '검색 결과가 없습니다.' : '등록된 견적고객이 없습니다.'}
                  </div>
                  {!searchTerm && (
                    <button onClick={handleNewCustomer} style={{ ...styles.addBtn, marginTop: '16px' }}>
                      + 견적고객 등록하기
                    </button>
                  )}
                </div>
              ) : (
                filteredQuote.map(c => (
                  <QuoteCustomerCard
                    key={c.id}
                    customer={c}
                    getBusinessLabel={getBusinessLabel}
                    onEdit={() => handleEditCustomer(c)}
                    onOpenDetail={() => handleOpenDetail(c)}
                    onDelete={() => handleDeleteCustomer(c)}
                    onConvert={() => handleConvertToCustomer(c)}
                    onHistory={() => handleOpenHistory(c)}
                    currentUser={currentUser}
                  />
                ))
              )}
            </div>
          )}

          {/* 해약고객 탭 */}
          {tab === 'cancelled' && (
            <div>
              {filteredCancelled.length === 0 ? (
                <div style={styles.empty}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                  <div style={{ color: '#666' }}>해약 고객이 없습니다.</div>
                </div>
              ) : (
                filteredCancelled.map(c => (
                  <CancelledCustomerCard
                    key={c.id}
                    customer={c}
                    getBusinessLabel={getBusinessLabel}
                    onOpenDetail={() => handleOpenDetail(c)}
                    onHistory={() => handleOpenHistory(c)}
                  />
                ))
              )}
            </div>
          )}

          {/* 이력 모달 */}
          {historyCustomer && (
            <QuoteHistory
              quoteCustomer={historyCustomer}
              onClose={() => setHistoryCustomer(null)}
              onOpenQuote={(quoteId) => {
                handleOpenDetail(historyCustomer, quoteId);
                setHistoryCustomer(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// 견적고객 카드
function QuoteCustomerCard({ customer, getBusinessLabel, onEdit, onOpenDetail, onDelete, onConvert, onHistory, currentUser }) {
  const status = QUOTE_CUSTOMER_STATUS[customer.status] || QUOTE_CUSTOMER_STATUS.pending;
  const isContracted = customer.status === 'contracted';

  return (
    <div style={{ ...styles.card, opacity: isContracted ? 0.75 : 1 }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardLeft}>
          <span style={{ ...styles.statusBadge, color: status.color, background: status.bg }}>
            {status.label}
          </span>
          <span style={styles.custName}>{customer.custName || '(이름 없음)'}</span>
        </div>
        <div style={styles.cardRight}>
          <span style={styles.date}>
            {customer.createdAt ? customer.createdAt.split('T')[0] : ''}
          </span>
        </div>
      </div>

      <div style={styles.cardInfo}>
        {customer.phone && <span>📞 {customer.phone}</span>}
        {customer.address && <span>📍 {customer.address}</span>}
        {customer.businessType && <span>{getBusinessLabel(customer.businessType)}</span>}
        {customer.area && <span>📐 {customer.area}평</span>}
        {customer.unitCount && <span>🏠 {customer.unitCount}호실</span>}
      </div>

      {customer.memo && (
        <div style={styles.memo}>💬 {customer.memo}</div>
      )}

      {isContracted && (
        <div style={{ fontSize: '12px', color: '#10b981', marginTop: '6px', fontWeight: 'bold' }}>
          ✅ 고객코드 {customer.newCode} 로 전환 완료
        </div>
      )}

      <div style={styles.cardActions}>
        <button onClick={onOpenDetail} style={styles.btnPrimary}>
          📄 견적서
        </button>
        {!isContracted && (
          <>
            <button onClick={onEdit} style={styles.btnSecondary}>✏️ 수정</button>
            <button onClick={onHistory} style={{ ...styles.btnSecondary, color:'#8b5cf6', borderColor:'#ddd8fe' }}>📋 이력</button>
            <button onClick={onConvert} style={styles.btnSuccess}>🎉 계약전환</button>
            <button onClick={onDelete} style={styles.btnDanger}>🗑️</button>
          </>
        )}
      </div>
    </div>
  );
}

// 해약고객 카드
function CancelledCustomerCard({ customer, getBusinessLabel, onOpenDetail, onHistory }) {
  return (
    <div style={{ ...styles.card, borderLeft: '4px solid #ef4444' }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardLeft}>
          <span style={{ ...styles.statusBadge, color: '#ef4444', background: '#fee2e2' }}>
            해약
          </span>
          <span style={styles.custName}>
            {customer.code && <span style={{ fontSize: '12px', color: '#999', marginRight: '6px' }}>{customer.code}</span>}
            {customer.custName || customer.name || '(이름 없음)'}
          </span>
        </div>
      </div>

      <div style={styles.cardInfo}>
        {customer.phone && <span>📞 {customer.phone}</span>}
        {customer.address && <span>📍 {customer.address}</span>}
        {customer.area && <span>📐 {customer.area}평</span>}
        {customer.staffName && <span>👤 {customer.staffName}</span>}
      </div>

      {customer.cancelReason && (
        <div style={{ ...styles.memo, color: '#ef4444' }}>해약사유: {customer.cancelReason}</div>
      )}

      <div style={styles.cardActions}>
        <button onClick={onOpenDetail} style={styles.btnPrimary}>
          📄 재견적서 작성
        </button>
        <button onClick={onHistory} style={{ ...styles.btnSecondary, color:'#8b5cf6', borderColor:'#ddd8fe' }}>📋 이력</button>
      </div>
    </div>
  );
}

const styles = {
  container: { padding: '0 0 20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  title: { fontSize: '18px', fontWeight: 'bold', color: '#1e3a5f', margin: 0 },
  addBtn: {
    padding: '10px 16px', backgroundColor: '#3b82f6', color: 'white',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold'
  },
  searchBox: {
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'white', border: '1px solid #ddd', borderRadius: '10px',
    padding: '8px 14px', marginBottom: '12px'
  },
  searchIcon: { fontSize: '16px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '14px' },
  clearBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '16px' },
  tabBar: { display: 'flex', gap: '8px', marginBottom: '14px' },
  tabBtn: {
    flex: 1, padding: '10px 8px', border: '1px solid #ddd',
    borderRadius: '8px', background: 'white', cursor: 'pointer',
    fontSize: '13px', color: '#666', fontWeight: 'bold'
  },
  tabActive: { background: '#3b82f6', color: 'white', border: '1px solid #3b82f6' },
  loading: { textAlign: 'center', padding: '40px', color: '#666' },
  empty: { textAlign: 'center', padding: '60px 20px', color: '#999' },
  card: {
    background: 'white', borderRadius: '12px', padding: '14px 16px',
    marginBottom: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderLeft: '4px solid #3b82f6'
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  cardLeft: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  cardRight: {},
  statusBadge: { padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold' },
  custName: { fontSize: '15px', fontWeight: 'bold', color: '#1e293b' },
  date: { fontSize: '12px', color: '#94a3b8' },
  cardInfo: { display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: '#64748b', marginBottom: '8px' },
  memo: { fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', marginBottom: '6px' },
  cardActions: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' },
  btnPrimary: {
    padding: '7px 14px', background: '#3b82f6', color: 'white',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold'
  },
  btnSecondary: {
    padding: '7px 12px', background: '#f1f5f9', color: '#475569',
    border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
  },
  btnSuccess: {
    padding: '7px 12px', background: '#10b981', color: 'white',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold'
  },
  renewalBox: {
    background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px',
    padding: '12px 14px', marginBottom: '12px',
  },
  renewalTitle: { fontSize: '13px', fontWeight: 'bold', color: '#92400e', marginBottom: '8px' },
  renewalItem: {
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
    padding: '8px 0', borderBottom: '1px solid #fde68a',
  },
  renewalCode: { fontSize: '11px', color: '#92400e', background: '#fde68a', padding: '1px 6px', borderRadius: '4px', marginRight: '4px' },
  renewalName: { fontSize: '14px', fontWeight: 'bold', color: '#92400e' },
  renewalInfo: { display: 'flex', gap: '8px', fontSize: '11px', color: '#b45309', flexWrap: 'wrap', flex: 1 },
  renewalBtn: {
    padding: '6px 12px', background: '#f59e0b', color: 'white',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap',
  },
  btnDanger: {
    padding: '7px 10px', background: '#fee2e2', color: '#ef4444',
    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
  },
};

export default QuotePage;
