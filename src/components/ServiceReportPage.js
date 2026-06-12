// =============================================
// 서비스리포트 출력 탭 — 그룹출력 기능 추가
// =============================================
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection, getDocs, query, where,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import {
  printSmallReports,
  printIndustrialReports,
  previewReport,
} from './ServiceReportPrint';
import DisinfectionCertPrint from './DisinfectionCertPrint';
import VehicleCertPrint from './VehicleCertPrint';

// ── 스타일 ──────────────────────────────────
const S = {
  card:    { background:'#fff', borderRadius:10, padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(0,0,0,0.07)' },
  row:     { display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' },
  btn:     (c='#3b82f6') => ({ padding:'8px 16px', background:c, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:'bold' }),
  btnSm:   (c='#3b82f6') => ({ padding:'4px 10px', background:c, color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:'bold' }),
  btnGhost:{ padding:'6px 12px', background:'transparent', color:'#6b7280', border:'1px solid #d1d5db', borderRadius:8, cursor:'pointer', fontSize:12 },
  select:  { padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:13, background:'#fff' },
  badge:   (c, bg) => ({ display:'inline-block', padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:'bold', color:c, background:bg||c+'22' }),
  th:      { padding:'8px 10px', background:'#f1f5f9', fontWeight:'bold', fontSize:12, color:'#475569', textAlign:'left', borderBottom:'1px solid #e2e8f0' },
  td:      { padding:'8px 10px', fontSize:12, borderBottom:'1px solid #f1f5f9', verticalAlign:'middle' },
  chk:     { width:16, height:16, cursor:'pointer', accentColor:'#3b82f6', border:'2px solid #9ca3af', borderRadius:3 },
};

const PAY_LABEL = {
  '직수금':  { label:'직수금',   color:'#16a34a', bg:'#dcfce7' },
  '송금':    { label:'송금',     color:'#0891b2', bg:'#e0f2fe' },
  '자동이체':{ label:'자동이체', color:'#7c3aed', bg:'#ede9fe' },
  '카드':    { label:'카드',     color:'#dc2626', bg:'#fee2e2' },
};

function PayBadge({ method }) {
  const m = method || '';
  const key = Object.keys(PAY_LABEL).find(k => m.includes(k)) || '';
  const info = PAY_LABEL[key];
  if (!info) return <span style={{ fontSize:11, color:'#9ca3af' }}>{m||'-'}</span>;
  return <span style={S.badge(info.color, info.bg)}>{info.label}</span>;
}

function BizBadge({ bizType }) {
  if (bizType === 'industrial')
    return <span style={S.badge('#3c3489','#eeedfe')}>산업체</span>;
  return <span style={S.badge('#085041','#e1f5ee')}>소규모</span>;
}

// ── 서비스 날짜 로드 ──────────────────────────
async function loadServiceDates(yearMonth) {
  try {
    const [year, month] = yearMonth.split('-');
    const startDate = `${year}-${month}-01`;
    const endDate   = `${year}-${month}-31`;
    const snap = await getDocs(query(
      collection(db, 'events'),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
    ));
    const dates = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const code = data.customerCode || data.extendedProps?.customerCode;
      const date = data.date || data.start;
      if (code && date) {
        if (!dates[code] || date < dates[code]) dates[code] = date;
      }
    });
    return dates;
  } catch (e) {
    console.warn('서비스 날짜 로드 실패:', e);
    return {};
  }
}

// ── 그룹 로드 ─────────────────────────────────
async function loadGroups() {
  try {
    const snap = await getDocs(collection(db, 'printGroups'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('그룹 로드 실패:', e);
    return [];
  }
}

// ── 토글 스위치 컴포넌트 ──────────────────────
function Toggle({ value, onChange, label }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div
        onClick={() => onChange(!value)}
        style={{
          width:36, height:20, borderRadius:10, cursor:'pointer', position:'relative',
          background: value ? '#22c55e' : '#d1d5db',
          transition:'background 0.2s',
        }}
      >
        <div style={{
          position:'absolute', top:2, left: value ? 18 : 2,
          width:16, height:16, borderRadius:'50%', background:'#fff',
          transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      {label && <span style={{ fontSize:11, color: value ? '#16a34a' : '#9ca3af' }}>{label}</span>}
    </div>
  );
}

// ── 그룹출력 모달 ──────────────────────────────
function GroupModal({
  groups, customers, onClose, onSaveGroup, onPrintGroup,
  onToggleInclude, onDeleteGroup, yearMonth, serviceDates, staffList,
}) {
  const [checkedGroupIds, setCheckedGroupIds] = useState(new Set());
  const [expandedGroupId, setExpandedGroupId] = useState(null);
  const [lastTap, setLastTap] = useState({ id: null, time: 0 });

  const toggleGroup = (id) => {
    setCheckedGroupIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // 더블클릭/더블탭 처리
  const handleRowClick = (id) => {
    const now = Date.now();
    if (lastTap.id === id && now - lastTap.time < 400) {
      setExpandedGroupId(prev => prev === id ? null : id);
      setLastTap({ id: null, time: 0 });
    } else {
      setLastTap({ id, time: now });
    }
  };

  const checkedGroups = groups.filter(g => checkedGroupIds.has(g.id));

  const handlePrint = () => {
    if (checkedGroups.length === 0) {
      Swal.fire('선택 없음', '출력할 그룹을 선택하세요', 'info');
      return;
    }
    // 체크된 그룹의 모든 고객 합치기 (중복 제거)
    const allIds = new Set(checkedGroups.flatMap(g => g.customerIds || []));
    const toPrint = customers.filter(c => allIds.has(c.id));
    onPrintGroup(toPrint);
  };

  return (
    <div style={{
      position:'fixed', top:0, left:0, right:0, bottom:0,
      background:'rgba(0,0,0,0.5)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background:'#fff', borderRadius:12, width:'min(520px, 95vw)',
        maxHeight:'80vh', display:'flex', flexDirection:'column',
        boxShadow:'0 8px 32px rgba(0,0,0,0.18)',
      }}>
        {/* 헤더 */}
        <div style={{ padding:'16px 18px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontWeight:'bold', fontSize:16, color:'#1e3a8a' }}>📂 그룹출력</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#9ca3af' }}>×</button>
        </div>

        {/* 그룹 목록 */}
        <div style={{ flex:1, overflowY:'auto', padding:'10px 0' }}>
          {groups.length === 0 ? (
            <div style={{ padding:'30px', textAlign:'center', color:'#9ca3af', fontSize:13 }}>
              저장된 그룹이 없습니다.<br/>고객을 선택한 후 그룹을 저장하세요.
            </div>
          ) : groups.map(g => {
            const memberCount = (g.customerIds || []).length;
            const isExpanded  = expandedGroupId === g.id;
            const members     = customers.filter(c => (g.customerIds || []).includes(c.id));

            return (
              <div key={g.id}>
                {/* 그룹 행 */}
                <div
                  onClick={() => handleRowClick(g.id)}
                  style={{
                    display:'flex', alignItems:'center', gap:10,
                    padding:'10px 16px', cursor:'pointer',
                    background: checkedGroupIds.has(g.id) ? '#eff6ff' : isExpanded ? '#f8fafc' : '#fff',
                    borderBottom:'1px solid #f1f5f9',
                  }}
                >
                  <input type="checkbox"
                    checked={checkedGroupIds.has(g.id)}
                    onChange={(e) => { e.stopPropagation(); toggleGroup(g.id); }}
                    style={S.chk}
                    onClick={e => e.stopPropagation()}
                  />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:'bold', fontSize:13, color:'#1f2937' }}>{g.name}</div>
                    <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>
                      {memberCount}명 · 더블클릭으로 목록 보기
                    </div>
                  </div>
                  {/* 전체포함 토글 */}
                  <div onClick={e => e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:10, color:'#6b7280' }}>전체출력</span>
                    <Toggle
                      value={g.includeInAll !== false}
                      onChange={(v) => onToggleInclude(g.id, v)}
                      label={g.includeInAll !== false ? 'ON' : 'OFF'}
                    />
                  </div>
                  {/* 삭제 */}
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteGroup(g.id, g.name); }}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', fontSize:16, padding:'2px 4px' }}
                    title="그룹 삭제"
                  >🗑</button>
                  <span style={{ fontSize:12, color:'#9ca3af' }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* 펼쳐진 고객 목록 */}
                {isExpanded && (
                  <div style={{ background:'#f8fafc', padding:'8px 16px 8px 48px', borderBottom:'1px solid #e5e7eb' }}>
                    {members.length === 0
                      ? <div style={{ fontSize:12, color:'#9ca3af' }}>고객 정보를 찾을 수 없습니다</div>
                      : members.map(m => (
                        <div key={m.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', borderBottom:'1px solid #f0f0f0', fontSize:12 }}>
                          <BizBadge bizType={m.bizType} />
                          <span style={{ fontWeight:500 }}>{m.name}</span>
                          <span style={{ color:'#9ca3af' }}>{m.staffName || ''}</span>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 하단 버튼 */}
        <div style={{ padding:'12px 16px', borderTop:'1px solid #e5e7eb', display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={S.btnGhost}>닫기</button>
          <button
            onClick={handlePrint}
            disabled={checkedGroups.length === 0}
            style={S.btn(checkedGroups.length > 0 ? '#1d4ed8' : '#9ca3af')}
          >
            🖨️ 선택 그룹 출력 ({checkedGroups.reduce((s, g) => s + (g.customerIds||[]).length, 0)}명)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────
function ServiceReportPage({ customers, staffList, currentUser }) {
  const now = new Date();
  const defaultYM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const [yearMonth,    setYearMonth]    = useState(defaultYM);
  const [typeFilter,   setTypeFilter]   = useState('all');
  const [staffFilter,  setStaffFilter]  = useState('all');
  const [checkedIds,   setCheckedIds]   = useState(new Set());
  const [serviceDates, setServiceDates] = useState({});
  const [dateLoading,  setDateLoading]  = useState(false);
  const [search,       setSearch]       = useState('');
  const [groups,       setGroups]       = useState([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [activeTab,    setActiveTab]    = useState('report'); // 'report' | 'cert' | 'vehicle'
  const [showCertPrint, setShowCertPrint] = useState(false);
  const [showVehiclePrint, setShowVehiclePrint] = useState(false);

  // ── 화면 이동 시 선택 해제
  useEffect(() => {
    return () => setCheckedIds(new Set());
  }, []);

  // ── 월 선택 목록
  const monthOptions = useMemo(() => {
    const opts = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      opts.push({ value:ym, label:`${d.getFullYear()}년 ${d.getMonth()+1}월` });
    }
    return opts;
  }, []);

  // ── 담당자 목록
  const staffNames = useMemo(() => {
    const names = new Set();
    customers.forEach(c => { if (c.staffName) names.add(c.staffName); });
    return ['all', ...Array.from(names).sort()];
  }, [customers]);

  // ── 필터링된 고객
  const selectedMonth = parseInt(yearMonth.split('-')[1]);
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (['해약','삭제'].includes(c.custStatus)) return false;
      const wm = c.workMonths;
      const wmData = c.workMonthsData;
      const inWorkMonths = Array.isArray(wm) ? wm.includes(selectedMonth) : false;
      const inWorkMonthsData =
        wmData?.[selectedMonth]?.enabled === true ||
        wmData?.[String(selectedMonth)]?.enabled === true;
      if (!inWorkMonths && !inWorkMonthsData) return false;
      if (typeFilter === 'small' && c.bizType === 'industrial') return false;
      if (typeFilter === 'industrial' && c.bizType !== 'industrial') return false;
      if (staffFilter !== 'all' && c.staffName !== staffFilter) return false;
      const nameMatch = typeof c.name === 'string' && c.name.includes(search);
      const codeMatch = typeof c.code === 'string' && c.code.includes(search);
      if (search && !nameMatch && !codeMatch) return false;
      return true;
    });
  }, [customers, selectedMonth, typeFilter, staffFilter, search]);

  // ── 서비스 날짜 로드
  useEffect(() => {
    setDateLoading(true);
    loadServiceDates(yearMonth).then(dates => {
      setServiceDates(dates);
      setDateLoading(false);
    });
    setCheckedIds(new Set());
  }, [yearMonth]);

  // ── 그룹 로드
  useEffect(() => {
    loadGroups().then(setGroups);
  }, []);

  // ── 체크 핸들러
  const toggleAll = (e) => {
    setCheckedIds(e.target.checked
      ? new Set(filteredCustomers.map(c => c.id))
      : new Set()
    );
  };
  const toggleOne = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const checkedCustomers = filteredCustomers.filter(c => checkedIds.has(c.id));

  // ── 실제 출력 실행
  const executePrint = (list) => {
    if (list.length === 0) {
      Swal.fire('선택 없음', '출력할 고객이 없습니다', 'info');
      return;
    }
    const small      = list.filter(c => c.bizType !== 'industrial');
    const industrial = list.filter(c => c.bizType === 'industrial');
    if (typeFilter === 'industrial' || (industrial.length > 0 && small.length === 0)) {
      printIndustrialReports(industrial.length > 0 ? industrial : list, yearMonth, serviceDates, staffList);
    } else if (typeFilter === 'small' || (small.length > 0 && industrial.length === 0)) {
      printSmallReports(small.length > 0 ? small : list, yearMonth, serviceDates, staffList);
    } else {
      if (small.length > 0) printSmallReports(small, yearMonth, serviceDates, staffList);
      if (industrial.length > 0) setTimeout(() => printIndustrialReports(industrial, yearMonth, serviceDates, staffList), 500);
    }
  };

  // ── 출력 (전체 = OFF 그룹 제외)
  const handlePrint = (target) => {
    if (target === 'all') {
      // OFF 그룹에 속한 고객 ID 수집
      const excludedIds = new Set(
        groups
          .filter(g => g.includeInAll === false)
          .flatMap(g => g.customerIds || [])
      );
      const list = filteredCustomers.filter(c => !excludedIds.has(c.id));
      const excludedCount = filteredCustomers.length - list.length;
      if (excludedCount > 0) {
        Swal.fire({
          title: `전체 출력`,
          text: `그룹 OFF 고객 ${excludedCount}명 제외, ${list.length}명 출력합니다.`,
          icon: 'info',
          showCancelButton: true,
          confirmButtonText: '출력',
          cancelButtonText: '취소',
        }).then(r => { if (r.isConfirmed) executePrint(list); });
      } else {
        executePrint(list);
      }
    } else {
      if (checkedCustomers.length === 0) {
        Swal.fire('선택 없음', '출력할 고객을 선택하세요', 'info');
        return;
      }
      executePrint(checkedCustomers);
    }
  };

  // ── 그룹 저장
  const handleSaveGroup = async () => {
    if (checkedCustomers.length === 0) {
      Swal.fire('선택 없음', '그룹으로 저장할 고객을 먼저 선택하세요', 'info');
      return;
    }
    const { value: name } = await Swal.fire({
      title: '그룹 이름 입력',
      input: 'text',
      inputPlaceholder: '예) 이창주팀, VIP고객, 안양지역...',
      showCancelButton: true,
      confirmButtonText: '저장',
      cancelButtonText: '취소',
      inputValidator: v => !v && '그룹 이름을 입력하세요',
    });
    if (!name) return;

    try {
      const docRef = await addDoc(collection(db, 'printGroups'), {
        name,
        customerIds: checkedCustomers.map(c => c.id),
        includeInAll: true,
        createdAt: serverTimestamp(),
      });
      setGroups(prev => [...prev, {
        id: docRef.id, name,
        customerIds: checkedCustomers.map(c => c.id),
        includeInAll: true,
      }]);
      Swal.fire('저장 완료', `"${name}" 그룹 저장 (${checkedCustomers.length}명)`, 'success');
    } catch (e) {
      Swal.fire('오류', '그룹 저장 실패: ' + e.message, 'error');
    }
  };

  // ── 전체포함 토글
  const handleToggleInclude = async (groupId, value) => {
    try {
      await updateDoc(doc(db, 'printGroups', groupId), { includeInAll: value });
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, includeInAll: value } : g));
    } catch (e) {
      Swal.fire('오류', '저장 실패: ' + e.message, 'error');
    }
  };

  // ── 그룹 삭제
  const handleDeleteGroup = async (groupId, groupName) => {
    const r = await Swal.fire({
      title: `"${groupName}" 삭제`,
      text: '그룹을 삭제합니다. 고객 데이터는 삭제되지 않습니다.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '삭제',
      cancelButtonText: '취소',
      confirmButtonColor: '#ef4444',
    });
    if (!r.isConfirmed) return;
    try {
      await deleteDoc(doc(db, 'printGroups', groupId));
      setGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (e) {
      Swal.fire('오류', '삭제 실패: ' + e.message, 'error');
    }
  };

  // ── 그룹에서 출력
  const handlePrintGroup = (list) => {
    setShowGroupModal(false);
    executePrint(list);
  };

  // ── 개별 미리보기
  const handlePreview = (customer) => {
    const date = serviceDates[customer.id] || '';
    previewReport(customer, yearMonth, date, customer.bizType || 'small', staffList);
  };

  const smallCount = filteredCustomers.filter(c => c.bizType !== 'industrial').length;
  const indCount   = filteredCustomers.filter(c => c.bizType === 'industrial').length;
  const offGroupCount = groups.filter(g => g.includeInAll === false)
    .reduce((s, g) => s + (g.customerIds||[]).length, 0);

  return (
    <div>
      {/* 소독증명서 출력 팝업 */}
      {showCertPrint && (
        <DisinfectionCertPrint
          customers={filteredCustomers}
          yearMonth={yearMonth}
          onClose={() => setShowCertPrint(false)}
        />
      )}

      {/* 차량소독 출력 팝업 */}
      {showVehiclePrint && (
        <VehicleCertPrint onClose={() => setShowVehiclePrint(false)} />
      )}

      {/* 탭 전환 */}
      <div style={{ display:'flex', gap:0, marginBottom:12,
        borderRadius:10, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
        {[
          { key:'report',  label:'🖨️ 서비스리포트' },
          { key:'cert',    label:'🧾 소독증명서' },
          { key:'vehicle', label:'🚗 차량소독' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            flex:1, padding:'12px 0', border:'none', cursor:'pointer',
            fontSize:13, fontWeight:'bold',
            background: activeTab === t.key ? '#1e40af' : '#f1f5f9',
            color:      activeTab === t.key ? '#fff'    : '#6b7280',
            borderBottom: activeTab === t.key ? '3px solid #60a5fa' : '3px solid transparent',
            transition:'background 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── 소독증명서 탭 ── */}
      {activeTab === 'cert' && (
        <div style={S.card}>
          <div style={{ ...S.row, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:11, color:'#6b7280', marginBottom:3 }}>출력 월</div>
              <select style={S.select} value={yearMonth} onChange={e => setYearMonth(e.target.value)}>
                {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex:1 }} />
            <button style={S.btn('#10b981')} onClick={() => setShowCertPrint(true)}>
              🧾 소독증명서 출력
            </button>
          </div>
          <div style={{ fontSize:12, color:'#6b7280', background:'#f8fafc',
            borderRadius:8, padding:'10px 14px', lineHeight:1.8 }}>
            <b>📋 소독증명서 출력 안내</b><br />
            • 배정플랜에서 <b>완료 처리</b>된 고객만 자동으로 포함됩니다.<br />
            • 약제 정보는 완료 시 입력한 사용약제가 자동 기입됩니다.<br />
            • 출력 팝업에서 데이터 편집 및 필드 위치 조정이 가능합니다.<br />
            • 설정은 자동 저장되어 다음에도 유지됩니다.
          </div>
        </div>
      )}

      {/* ── 차량소독 탭 ── */}
      {activeTab === 'vehicle' && (
        <div style={S.card}>
          <div style={{ ...S.row, marginBottom:12 }}>
            <div style={{ flex:1 }} />
            <button style={S.btn('#065f46')} onClick={() => setShowVehiclePrint(true)}>
              🚗 차량소독 출력
            </button>
          </div>
          <div style={{ fontSize:12, color:'#6b7280', background:'#f0fdf4',
            borderRadius:8, padding:'10px 14px', lineHeight:1.9 }}>
            <b>🚗 차량소독 증명서 출력 안내</b><br />
            • 차량 사진을 업로드하면 <b>AI가 번호판을 자동 인식</b>합니다.<br />
            • 인식된 번호판이 증명서 번호 칸에 자동 기입됩니다.<br />
            • 여러 차량은 쉼표(,)로 구분합니다.<br />
            • <b>양식 A / 양식 B</b> 두 가지 서식을 지원합니다.<br />
            • 차량소독 양식 파일을 제공해주시면 바로 반영해드릴게요!
          </div>
        </div>
      )}

      {/* ── 서비스리포트 탭 ── */}
      {activeTab === 'report' && (
      <>
      {/* 상단 설정 카드 */}
      <div style={S.card}>
        <div style={{ ...S.row, marginBottom:12 }}>
          {/* 월 선택 */}
          <div>
            <div style={{ fontSize:11, color:'#6b7280', marginBottom:3 }}>출력 월</div>
            <select style={S.select} value={yearMonth} onChange={e => setYearMonth(e.target.value)}>
              {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* 구분 필터 */}
          <div>
            <div style={{ fontSize:11, color:'#6b7280', marginBottom:3 }}>리포트 구분</div>
            <div style={{ display:'flex', gap:4 }}>
              {[['all','전체'],['small','소규모'],['industrial','산업체']].map(([v,l]) => (
                <button key={v} onClick={() => setTypeFilter(v)} style={{
                  padding:'7px 12px', borderRadius:7, fontSize:12, cursor:'pointer',
                  fontWeight: typeFilter===v ? 'bold' : 'normal',
                  border:`1.5px solid ${typeFilter===v ? '#3b82f6' : '#d1d5db'}`,
                  background: typeFilter===v ? '#eff6ff' : '#fff',
                  color: typeFilter===v ? '#1d4ed8' : '#6b7280',
                }}>{l}</button>
              ))}
            </div>
          </div>

          <div style={{ flex:1 }} />

          {/* 출력 버튼 그룹 */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            {/* 그룹저장 */}
            <button
              style={S.btn(checkedCustomers.length > 0 ? '#7c3aed' : '#9ca3af')}
              onClick={handleSaveGroup}
              disabled={checkedCustomers.length === 0}
              title="선택한 고객을 그룹으로 저장"
            >
              📂 그룹저장 ({checkedCustomers.length})
            </button>

            {/* 그룹출력 */}
            <button
              style={S.btn('#6366f1')}
              onClick={() => setShowGroupModal(true)}
            >
              📋 그룹출력 {groups.length > 0 && `(${groups.length})`}
            </button>

            {/* 선택출력 */}
            <button
              style={S.btn(checkedCustomers.length > 0 ? '#1d4ed8' : '#9ca3af')}
              onClick={() => handlePrint('selected')}
              disabled={checkedCustomers.length === 0}
            >
              🖨️ 선택 출력 ({checkedCustomers.length}명)
            </button>

            {/* 전체출력 */}
            <button style={S.btn('#6b7280')} onClick={() => handlePrint('all')}>
              📄 전체 출력 ({filteredCustomers.length}명
              {offGroupCount > 0 && <span style={{ fontSize:10 }}> -{offGroupCount}</span>})
            </button>
          </div>
        </div>

        <div style={{ fontSize:11, color:'#9ca3af' }}>
          💡 폼에 고객정보가 자동 입력됩니다. 서비스일자는 배정플랜 데이터에서 자동 불러옵니다.
          {dateLoading && ' (날짜 로딩 중...)'}
          {offGroupCount > 0 && (
            <span style={{ color:'#f59e0b', marginLeft:8 }}>
              ⚠ 전체출력 제외 그룹: {offGroupCount}명
            </span>
          )}
        </div>
      </div>

      {/* 담당자 탭 */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
        {staffNames.map(s => {
          const cnt = s === 'all'
            ? filteredCustomers.length
            : filteredCustomers.filter(c => c.staffName === s).length;
          if (s !== 'all' && cnt === 0) return null;
          return (
            <button key={s} onClick={() => setStaffFilter(s)} style={{
              padding:'5px 14px', borderRadius:20, fontSize:12, cursor:'pointer',
              border:`1.5px solid ${staffFilter===s ? '#3b82f6' : '#e5e7eb'}`,
              background: staffFilter===s ? '#eff6ff' : '#fff',
              color: staffFilter===s ? '#1d4ed8' : '#6b7280',
              fontWeight: staffFilter===s ? 'bold' : 'normal',
            }}>
              {s === 'all' ? '전체' : s} ({cnt})
            </button>
          );
        })}
      </div>

      {/* 요약 카드 */}
      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        {[
          { label:'이번달 작업', val:filteredCustomers.length, color:'#374151' },
          { label:'선택됨',     val:checkedCustomers.length,   color:'#1d4ed8' },
          { label:'소규모',     val:smallCount,                color:'#085041' },
          { label:'산업체',     val:indCount,                  color:'#3c3489' },
        ].map(item => (
          <div key={item.label} style={{ flex:1, background:'#f8fafc', borderRadius:8, padding:'8px 12px' }}>
            <div style={{ fontSize:18, fontWeight:'bold', color:item.color }}>{item.val}</div>
            <div style={{ fontSize:11, color:'#9ca3af' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* 검색 + 전체선택 */}
      <div style={{ ...S.row, marginBottom:8 }}>
        <label style={{ ...S.row, fontSize:12, color:'#6b7280', gap:6 }}>
          <input type="checkbox"
            checked={filteredCustomers.length > 0 && checkedIds.size === filteredCustomers.length}
            onChange={toggleAll}
            style={S.chk} />
          전체 선택
        </label>
        <div style={{ flex:1 }} />
        <input
          placeholder="고객명/코드 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:7, fontSize:12, width:160 }}
        />
      </div>

      {/* 고객 목록 테이블 */}
      <div style={{ ...S.card, padding:0, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:520 }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width:40, textAlign:'center' }}>
                <input type="checkbox" onChange={toggleAll}
                  checked={filteredCustomers.length > 0 && checkedIds.size === filteredCustomers.length}
                  style={S.chk} />
              </th>
              <th style={S.th}>고객명</th>
              <th style={S.th}>구분</th>
              <th style={S.th}>담당자</th>
              <th style={S.th}>작업일</th>
              <th style={S.th}>수금형태</th>
              <th style={{ ...S.th, textAlign:'right' }}>당월금액</th>
              <th style={{ ...S.th, textAlign:'right' }}>미수금</th>
              <th style={S.th}>미리보기</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.length === 0 ? (
              <tr><td colSpan={9} style={{ ...S.td, textAlign:'center', color:'#9ca3af', padding:'30px 0' }}>
                이번달 작업 고객이 없습니다
              </td></tr>
            ) : filteredCustomers.map(c => {
              const svcDate  = serviceDates[c.id] ? serviceDates[c.id].slice(5) : '-';
              const unpaidAmt = Number(c.unpaid) || 0;
              const inOffGroup = groups.some(g => g.includeInAll === false && (g.customerIds||[]).includes(c.id));
              return (
                <tr key={c.id} style={{ background: checkedIds.has(c.id) ? '#eff6ff' : inOffGroup ? '#fff7ed' : '#fff' }}>
                  <td style={{ ...S.td, textAlign:'center', width:40 }}>
                    <input type="checkbox" checked={checkedIds.has(c.id)} onChange={() => toggleOne(c.id)} style={S.chk} />
                  </td>
                  <td style={{ ...S.td, fontWeight:500 }}>
                    {c.name}
                    {inOffGroup && <span style={{ fontSize:10, color:'#f59e0b', marginLeft:4 }}>제외</span>}
                  </td>
                  <td style={S.td}><BizBadge bizType={c.bizType} /></td>
                  <td style={S.td}>{c.staffName || '-'}</td>
                  <td style={{ ...S.td, color: svcDate==='-' ? '#9ca3af' : '#374151' }}>{svcDate}</td>
                  <td style={S.td}><PayBadge method={c.paymentMethod} /></td>
                  <td style={{ ...S.td, textAlign:'right' }}>{(Number(c.price)||0).toLocaleString()}</td>
                  <td style={{ ...S.td, textAlign:'right', color: unpaidAmt>0 ? '#dc2626' : '#9ca3af', fontWeight: unpaidAmt>0 ? 'bold' : 'normal' }}>
                    {unpaidAmt > 0 ? unpaidAmt.toLocaleString() : '0'}
                  </td>
                  <td style={S.td}>
                    <button style={S.btnSm('#6b7280')} onClick={() => handlePreview(c)}>미리보기</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredCustomers.length > 0 && (
        <div style={{ marginTop:8, padding:'10px 12px', background:'#f0f9ff', borderRadius:8, fontSize:11, color:'#0369a1' }}>
          ℹ️ 소규모 확인서: 고객용+회사용 2장을 A4 1장에 출력 &nbsp;|&nbsp;
          산업체 리포트: A4 1장에 1고객 출력
        </div>
      )}

      {/* 그룹출력 모달 */}
      {showGroupModal && (
        <GroupModal
          groups={groups}
          customers={customers}
          onClose={() => setShowGroupModal(false)}
          onSaveGroup={handleSaveGroup}
          onPrintGroup={handlePrintGroup}
          onToggleInclude={handleToggleInclude}
          onDeleteGroup={handleDeleteGroup}
          yearMonth={yearMonth}
          serviceDates={serviceDates}
          staffList={staffList}
        />
      )}
      </> /* activeTab === 'report' */
      )}
    </div>
  );
}

export default ServiceReportPage;
