import React, { useState } from 'react';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

function ExcelUploadPage({ currentUser, staffList, onComplete }) {
  const [tempCustomers, setTempCustomers] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [displayCount, setDisplayCount] = useState(100);

  // 계약 상태 체크 (만료: 1개월 이내, 해약: 1개월 이상)
  const getContractStatus = (contractPeriod, today) => {
    if (!contractPeriod) return '정상';
    try {
      const str = String(contractPeriod);
      let parts = str.split('~');
      if (parts.length < 2) parts = str.split(/\s+-\s+/);
      if (parts.length < 2) return '정상';
      
      const endStr = parts[1].trim();
      let endDate = null;
      
      let match = endStr.match(/(\d{4})[\.\-\/](\d{1,2})[\.\-\/](\d{1,2})/);
      if (match) endDate = new Date(match[1], match[2]-1, match[3]);
      
      if (!endDate) {
        match = endStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?/);
        if (match) endDate = new Date(match[1], match[2]-1, match[3]);
      }
      
      if (!endDate) {
        match = endStr.match(/(\d{4})[\.\-\/](\d{1,2})(?!\d)/);
        if (match) endDate = new Date(match[1], match[2], 0);
      }
      
      if (!endDate) {
        match = endStr.match(/(\d{4})년\s*(\d{1,2})월/);
        if (match) endDate = new Date(match[1], match[2], 0);
      }
      
      if (!endDate) return '정상';
      if (endDate >= today) return '정상';
      
      const oneMonthAgo = new Date(today);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      
      return endDate >= oneMonthAgo ? '만료' : '해약';
    } catch (e) {
      return '정상';
    }
  };

  const parseWorkMonths = (workMonthStr) => {
    const months = {};
    for (let m = 1; m <= 12; m++) {
      months[m] = { enabled: true, count: 1 };
    }
    if (!workMonthStr) return months;
    const str = String(workMonthStr).toLowerCase();
    if (str.includes('매월') || str.includes('전체') || str === 'all') return months;
    if (str.includes('짝수')) {
      for (let m = 1; m <= 12; m++) months[m].enabled = m % 2 === 0;
      return months;
    }
    if (str.includes('홀수')) {
      for (let m = 1; m <= 12; m++) months[m].enabled = m % 2 === 1;
      return months;
    }
    const numbers = str.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      for (let m = 1; m <= 12; m++) months[m].enabled = false;
      numbers.forEach(n => {
        const num = parseInt(n);
        if (num >= 1 && num <= 12) months[num].enabled = true;
      });
    }
    return months;
  };

  const parsePrice = (val) => {
    if (!val) return 0;
    return Number(String(val).replace(/[,원\s]/g, '')) || 0;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        // 헤더 행 찾기
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(10, rawData.length); i++) {
          const row = rawData[i];
          if (row && row.some(cell => {
            const cellStr = String(cell || '').trim();
            return cellStr === '고객코드' || cellStr === '고객명' || cellStr === '업체명';
          })) {
            headerRowIndex = i;
            break;
          }
        }
        
        const headers = rawData[headerRowIndex].map(h => String(h || '').trim());
        const dataRows = rawData.slice(headerRowIndex + 1);

        // 컬럼 인덱스 찾기 (정확한 매칭 우선, 부분 매칭은 후순위)
        const findCol = (...names) => {
          // 공백 제거 버전 헤더
          const headersNoSpace = headers.map(h => h.replace(/\s+/g, ''));
          const namesNoSpace = names.map(n => n.replace(/\s+/g, ''));
          
          // 1차: 정확히 일치하는 헤더 찾기 (공백 무시)
          for (const name of namesNoSpace) {
            const idx = headersNoSpace.findIndex(h => h === name);
            if (idx !== -1) return idx;
          }
          // 2차: 부분 매칭 (단, 다른 키워드 포함 제외)
          for (const name of namesNoSpace) {
            const idx = headersNoSpace.findIndex(h => {
              if (!h.includes(name)) return false;
              // "이메일주소"에서 "주소"만 찾는 것 방지
              if (name === '주소' && (h.includes('이메일') || h.includes('메일'))) return false;
              return true;
            });
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const colCode = findCol('고객코드', '코드');
        const colName = findCol('고객명', '업체명', '상호', '거래처');
        const colPhone = findCol('연락처', '전화', '휴대폰');
        const colAddress = findCol('주소', '주 소', '소재지', '사업장주소', '사업장 주소');
        const colPrice = findCol('방제대금', '금액', '단가', '월금액', '대금');
        const colContract = findCol('계약기간', '계약');
        const colCeo = findCol('대표자명', '대표자', '대표');
        const colBizNum = findCol('사업자번호', '사업자');
        const colEmail = findCol('메일', '이메일', 'email');
        const colMemo = findCol('비고', '메모');
        const colWorkMonth = findCol('작업월', '작업주기');
        const colPayment = findCol('수금방법', '결제방식', '결제');
        const colArea = findCol('평수', '면적');
        const colServiceType = findCol('서비스종류', '서비스', '종류');
        const colWinter = findCol('동절기', '겨울');
        const colZipCode = findCol('우편번호', '우편');

        // 기존 고객 코드 가져오기
        const existingSnap = await getDocs(collection(db, 'customers'));
        const existingCodes = existingSnap.docs
          .map(d => d.data().code)
          .filter(code => code && /^\d{4}$/.test(code))
          .map(code => parseInt(code) || 0);
        let nextCodeNum = existingCodes.length > 0 ? Math.max(...existingCodes) + 1 : 1;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const customers = [];
        for (const row of dataRows) {
          if (!row || row.length === 0) continue;
          
          const getValue = (colIdx) => {
            if (colIdx === -1 || colIdx >= row.length) return '';
            return row[colIdx] || '';
          };

          const name = String(getValue(colName)).trim();
          if (!name || name === '' || name === 'undefined') continue;

          const contractPeriod = String(getValue(colContract) || '');
          const workMonths = parseWorkMonths(getValue(colWorkMonth));
          
          const defaultUnpaidMonths = {};
          for (let m = 1; m <= 12; m++) {
            defaultUnpaidMonths[m] = { checked: false, amount: 0, completed: false };
          }

          let code = String(getValue(colCode) || '').trim();
          if (!code || !/^\d{4}$/.test(code)) {
            code = String(nextCodeNum).padStart(4, '0');
            nextCodeNum++;
          }
          
          const price = parsePrice(getValue(colPrice));
          const custStatus = getContractStatus(contractPeriod, today);
          const winterPrice = parsePrice(getValue(colWinter));
          const serviceType = String(getValue(colServiceType) || '일반');

          customers.push({
            tempId: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            code,
            name,
            phone: String(getValue(colPhone) || '').replace(/\n/g, ' / '),
            address: String(getValue(colAddress) || ''),
            services: [{ type: serviceType, price: price }],
            contractPeriod,
            ceoName: String(getValue(colCeo) || ''),
            businessNumber: String(getValue(colBizNum) || ''),
            email: String(getValue(colEmail) || ''),
            paymentMethod: String(getValue(colPayment) || ''),
            area: String(getValue(colArea) || ''),
            winterPrice,
            zipCode: String(getValue(colZipCode) || ''),
            memo: String(getValue(colMemo) || ''),
            custStatus,
            workMonths,
            staffId: '',
            staffName: '',
            specialWork: null,
            unpaidMonths: defaultUnpaidMonths,
            lastWorkDate: null,
            trapInstalled: false,
            trapCount: 0
          });
        }

        setTempCustomers(customers);
        setSelectedIds(new Set());
        Swal.fire('완료', `${customers.length}건 로드됨`, 'success');
      } catch (error) {
        console.error('Excel error:', error);
        Swal.fire('오류', '엑셀 처리 실패: ' + error.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // 전체 선택/해제
  const handleSelectAll = () => {
    if (selectedIds.size === tempCustomers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tempCustomers.map(c => c.tempId)));
    }
  };

  // 개별 선택
  const handleSelect = (tempId) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(tempId)) {
      newSet.delete(tempId);
    } else {
      newSet.add(tempId);
    }
    setSelectedIds(newSet);
  };

  // 선택 항목 해약 처리
  const handleBulkCancel = () => {
    if (selectedIds.size === 0) {
      Swal.fire('알림', '선택된 고객이 없습니다.', 'warning');
      return;
    }
    
    setTempCustomers(prev => prev.map(c => 
      selectedIds.has(c.tempId) ? { ...c, custStatus: '해약' } : c
    ));
    setSelectedIds(new Set());
    Swal.fire('완료', `${selectedIds.size}건 해약 처리됨`, 'success');
  };

  // 선택 항목 정기 처리
  const handleBulkNormal = () => {
    if (selectedIds.size === 0) {
      Swal.fire('알림', '선택된 고객이 없습니다.', 'warning');
      return;
    }
    
    setTempCustomers(prev => prev.map(c => 
      selectedIds.has(c.tempId) ? { ...c, custStatus: '정상' } : c
    ));
    setSelectedIds(new Set());
    Swal.fire('완료', `${selectedIds.size}건 정기 처리됨`, 'success');
  };

  // 고객등록 완료
  const handleComplete = async () => {
    if (tempCustomers.length === 0) {
      Swal.fire('알림', '등록할 고객이 없습니다.', 'warning');
      return;
    }

    const result = await Swal.fire({
      title: '✅ 고객등록 완료',
      html: `
        <div style="text-align:left;">
          <div>총 <b>${tempCustomers.length}</b>명 등록됩니다.</div>
          <div style="margin-top:10px; padding:10px; background:#f1f5f9; border-radius:8px; font-size:12px;">
            <div>🟢 정상: ${tempCustomers.filter(c => c.custStatus === '정상').length}명</div>
            <div>🟠 만료: ${tempCustomers.filter(c => c.custStatus === '만료').length}명</div>
            <div>🔴 해약: ${tempCustomers.filter(c => c.custStatus === '해약').length}명</div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '등록',
      cancelButtonText: '취소',
      confirmButtonColor: '#22c55e'
    });

    if (!result.isConfirmed) return;

    try {
      Swal.fire({ title: '등록 중...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      
      for (const customer of tempCustomers) {
        const { tempId, ...customerData } = customer;
        await addDoc(collection(db, 'customers'), {
          ...customerData,
          createdAt: new Date().toISOString().split('T')[0]
        });
      }

      Swal.fire('완료', `${tempCustomers.length}명 등록됨`, 'success');
      setTempCustomers([]);
      onComplete(); // 고객관리 페이지로 이동
    } catch (error) {
      console.error('등록 오류:', error);
      Swal.fire('오류', '등록 실패: ' + error.message, 'error');
    }
  };

  // 통계
  const stats = {
    total: tempCustomers.length,
    normal: tempCustomers.filter(c => c.custStatus === '정상').length,
    expired: tempCustomers.filter(c => c.custStatus === '만료').length,
    cancelled: tempCustomers.filter(c => c.custStatus === '해약').length
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>📂 엑셀 고객등록</h2>
        <button onClick={onComplete} style={styles.backBtn}>← 돌아가기</button>
      </div>

      {/* 업로드 영역 */}
      <div style={styles.uploadArea}>
        <label style={styles.uploadBtn}>
          📂 엑셀 파일 선택
          <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{display:'none'}} />
        </label>
        <p style={styles.uploadHint}>엑셀 파일을 업로드하면 고객 목록이 표시됩니다.</p>
      </div>

      {tempCustomers.length > 0 && (
        <>
          {/* 통계 */}
          <div style={styles.statsRow}>
            <div style={styles.statBox}>총 <b>{stats.total}</b></div>
            <div style={{...styles.statBox, color:'#22c55e'}}>정상 <b>{stats.normal}</b></div>
            <div style={{...styles.statBox, color:'#f97316'}}>만료 <b>{stats.expired}</b></div>
            <div style={{...styles.statBox, color:'#ef4444'}}>해약 <b>{stats.cancelled}</b></div>
          </div>

          {/* 액션 버튼 */}
          <div style={styles.actionRow}>
            <label style={styles.checkAll}>
              <input 
                type="checkbox" 
                checked={selectedIds.size === tempCustomers.length && tempCustomers.length > 0}
                onChange={handleSelectAll}
              />
              전체선택 ({selectedIds.size})
            </label>
            <div style={styles.actionBtns}>
              <button onClick={handleBulkCancel} style={styles.cancelBtn}>🔴 해약</button>
              <button onClick={handleBulkNormal} style={styles.normalBtn}>🟢 정기</button>
            </div>
          </div>

          {/* 고객 목록 */}
          <div style={styles.list}>
            {tempCustomers.slice(0, displayCount).map(c => (
              <div 
                key={c.tempId} 
                style={{
                  ...styles.card,
                  borderLeft: c.custStatus === '해약' ? '4px solid #ef4444' : 
                              c.custStatus === '만료' ? '4px solid #f97316' : '4px solid #22c55e',
                  opacity: c.custStatus === '해약' ? 0.7 : 1
                }}
                onClick={() => handleSelect(c.tempId)}
              >
                <div style={styles.cardHeader}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.has(c.tempId)}
                    onChange={() => handleSelect(c.tempId)}
                    onClick={(e) => e.stopPropagation()}
                    style={styles.checkbox}
                  />
                  <div style={styles.cardInfo}>
                    <div style={styles.cardName}>
                      <span style={styles.code}>[{c.code}]</span> {c.name}
                    </div>
                    <div style={styles.cardDetail}>
                      📞 {c.phone || '-'} | 💰 {(c.services?.[0]?.price || 0).toLocaleString()}원
                    </div>
                    {c.contractPeriod && (
                      <div style={styles.cardContract}>📅 {c.contractPeriod}</div>
                    )}
                  </div>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: c.custStatus === '해약' ? '#fee2e2' : 
                                    c.custStatus === '만료' ? '#ffedd5' : '#dcfce7',
                    color: c.custStatus === '해약' ? '#dc2626' : 
                           c.custStatus === '만료' ? '#c2410c' : '#166534'
                  }}>
                    {c.custStatus}
                  </span>
                </div>
              </div>
            ))}
            
            {tempCustomers.length > displayCount && (
              <button 
                onClick={() => setDisplayCount(prev => prev + 100)} 
                style={styles.loadMoreBtn}
              >
                📋 더 보기 ({tempCustomers.length - displayCount}명 더)
              </button>
            )}
          </div>

          {/* 등록 버튼 */}
          <button onClick={handleComplete} style={styles.completeBtn}>
            ✅ 고객등록 완료 ({tempCustomers.length}명)
          </button>
        </>
      )}
    </div>
  );
}

const styles = {
  container: { padding: '15px', maxWidth: '600px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  title: { margin: 0, fontSize: '18px' },
  backBtn: { padding: '8px 15px', backgroundColor: '#64748b', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  
  uploadArea: { textAlign: 'center', padding: '30px', backgroundColor: '#f8fafc', borderRadius: '12px', marginBottom: '20px', border: '2px dashed #cbd5e1' },
  uploadBtn: { display: 'inline-block', padding: '15px 30px', backgroundColor: '#6366f1', color: 'white', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' },
  uploadHint: { marginTop: '10px', color: '#64748b', fontSize: '12px' },
  
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '15px' },
  statBox: { backgroundColor: 'white', padding: '10px', borderRadius: '8px', textAlign: 'center', fontSize: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  
  actionRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', padding: '10px', backgroundColor: '#f1f5f9', borderRadius: '8px' },
  checkAll: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' },
  actionBtns: { display: 'flex', gap: '8px' },
  cancelBtn: { padding: '8px 15px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  normalBtn: { padding: '8px 15px', backgroundColor: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  
  list: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' },
  card: { backgroundColor: 'white', padding: '12px', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', cursor: 'pointer' },
  cardHeader: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
  checkbox: { width: '20px', height: '20px', cursor: 'pointer', flexShrink: 0 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' },
  code: { color: '#6366f1', fontSize: '12px' },
  cardDetail: { fontSize: '11px', color: '#666' },
  cardContract: { fontSize: '10px', color: '#888', marginTop: '4px' },
  statusBadge: { padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold', flexShrink: 0 },
  
  loadMoreBtn: { width: '100%', padding: '15px', backgroundColor: '#f1f5f9', color: '#475569', border: '2px dashed #cbd5e1', borderRadius: '10px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' },
  
  completeBtn: { width: '100%', padding: '18px', backgroundColor: '#22c55e', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', position: 'sticky', bottom: '10px' }
};

export default ExcelUploadPage;
