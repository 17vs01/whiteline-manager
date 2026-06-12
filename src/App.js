import React, { useState, useEffect, useRef, useCallback } from 'react';
import { collection, getDocs, query, where, updateDoc, doc, addDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import Swal from 'sweetalert2';
import { AppProvider, useAppContext } from './context/AppContext';
import CalendarPage from './components/CalendarPage';
import CustomerList from './components/CustomerList';
import StaffManagement from './components/StaffManagement';
import SettingPage from './components/SettingPage';
import ExcelUploadPage from './components/ExcelUploadPage';
import ReportView from './components/ReportView';
import PestMonitoringPage from './components/pest/PestMonitoringPage';
import QuotePage from './components/quote/QuotePage';
import QuotePublicView from './components/quote/QuotePublicView';
import QuoteComparePublic from './components/quote/QuoteComparePublic';
import ContractPage from './components/contract/ContractPage';
import ContractPublicView from './components/contract/ContractPublicView';
import SchedulerPage from './components/scheduler/SchedulerPage';
import { requestNotificationPermission, onForegroundMessage, checkTodayAlarms } from './utils/fcmNotification';
import SalesPage from './components/sales/SalesPage';
import NoticeBoard from './components/NoticeBoard';
import CustomerInquiryPanel from './components/CustomerInquiryPanel';
import CustomerRequestPanel from './components/CustomerRequestPanel';
import AutoDebitPanel       from './components/AutoDebitPanel';
import ReviewPanel          from './components/ReviewPanel';
import ChatManagePanel      from './components/ChatManagePanel';

// --- URL 라우팅 헬퍼 ---
const getReportIdFromUrl = () => {
  const path = window.location.pathname;
  if (path.startsWith('/report/')) return path.replace('/report/', '');
  return null;
};

const getContractSignIdFromUrl = () => {
  const path = window.location.pathname;
  if (path.startsWith('/contract-sign/')) return path.replace('/contract-sign/', '');
  const hash = window.location.hash;
  if (hash.startsWith('#/contract-sign/')) return hash.replace('#/contract-sign/', '');
  return null;
};

const getCompareIdFromUrl = () => {
  const path = window.location.pathname;
  if (path.startsWith('/quote-compare/')) return path.replace('/quote-compare/', '');
  const hash = window.location.hash;
  if (hash.startsWith('#/quote-compare/')) return hash.replace('#/quote-compare/', '');
  return null;
};

const getQuoteIdFromUrl = () => {
  const path = window.location.pathname;
  if (path.startsWith('/quote-view/')) return path.replace('/quote-view/', '');
  const hash = window.location.hash;
  if (hash.startsWith('#/quote-view/')) return hash.replace('#/quote-view/', '');
  return null;
};

// XSS 방지: HTML 특수문자 이스케이프
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// --- 공개 라우트 래퍼 ---
function AppWrapper() {
  if (getReportIdFromUrl()) return <ReportView />;
  const contractSignId = getContractSignIdFromUrl();
  if (contractSignId) return <ContractPublicView contractId={contractSignId} />;
  const compareId = getCompareIdFromUrl();
  if (compareId) return <QuoteComparePublic customerId={compareId} />;
  const quoteId = getQuoteIdFromUrl();
  if (quoteId) return <QuotePublicView quoteId={quoteId} />;

  return (
    <AppProvider>
      <App />
    </AppProvider>
  );
}

function App() {
  const { staffList, fetchStaffList, settings } = useAppContext();
  const { companyName, companyLogo, anthropicApiKey } = settings;

  const [user, setUser] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(settings.startTab || 'calendar');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [badgeStats, setBadgeStats] = useState({ quotePending: 0, contractPending: 0, inquiryPending: 0, requestPending: 0, autoDebitPending: 0 });
  const [showInquiryPanel,   setShowInquiryPanel]   = useState(false);
  const [showRequestPanel,   setShowRequestPanel]   = useState(false);
  const [showAutoDebitPanel, setShowAutoDebitPanel] = useState(false);
  const [showReviewPanel,    setShowReviewPanel]    = useState(false);
  const [showChatPanel,      setShowChatPanel]      = useState(false);
  const [chatUnread,         setChatUnread]         = useState(0);
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(0);

  // 알림에서 특정 견적서 바로 열기용 state (window 전역변수 대체)
  const [pendingQuoteId, setPendingQuoteId] = useState(null);
  const [pendingSalesData, setPendingSalesData] = useState(null); // 영업→견적 전환 데이터

  // 페이지 히스토리 & 뒤로가기 종료용
  const pageHistoryRef = useRef(['calendar']);
  const backPressedOnce = useRef(false);
  const backToastRef = useRef(null);
  const isNavigatingBack = useRef(false);

  // --- 페이지 이동 ---
  const navigateToPage = useCallback((page) => {
    if (page === currentPage) return;
    if (!isNavigatingBack.current) {
      pageHistoryRef.current.push(page);
      window.history.pushState({ page }, '');
    }
    isNavigatingBack.current = false;
    setCurrentPage(page);
  }, [currentPage]);

  // --- 모바일 뒤로가기 ---
  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return;

    window.history.pushState({ page: 'calendar' }, '');

    const handlePopState = () => {
      if (pageHistoryRef.current.length > 1) {
        pageHistoryRef.current.pop();
        const prevPage = pageHistoryRef.current[pageHistoryRef.current.length - 1];
        isNavigatingBack.current = true;
        setCurrentPage(prevPage);
        window.history.pushState({ page: prevPage }, '');
        backPressedOnce.current = false;
        if (backToastRef.current) backToastRef.current.close();
      } else {
        window.history.pushState({ page: 'app' }, '');
        if (backPressedOnce.current) {
          if (backToastRef.current) backToastRef.current.close();
          window.close();
          setTimeout(() => { window.location.href = 'about:blank'; }, 100);
        } else {
          backPressedOnce.current = true;
          backToastRef.current = Swal.mixin({
            toast: true, position: 'bottom',
            showConfirmButton: false, timer: 2000, timerProgressBar: true,
            didClose: () => { backPressedOnce.current = false; }
          });
          backToastRef.current.fire({ icon: 'info', title: '한번 더 누르면 종료됩니다' });
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // --- 인증 상태 감지 ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        // staff를 한 번만 fetch하고 currentUser도 같이 처리
        const list = await fetchStaffList();
        const emailId = firebaseUser.email.split('@')[0];
        const found = list.find(s => s.visibleId === emailId);
        if (found) {
          setCurrentUser({ ...found, id: found.visibleId });
        } else {
          setCurrentUser({ id: emailId, name: emailId, role: 'master', visibleId: emailId });
        }
      } else {
        setUser(null);
        setCurrentUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [fetchStaffList]);

  // --- 뱃지 통계: 실시간 onSnapshot으로 자동 갱신 ---
  useEffect(() => {
    if (!currentUser) return;

    // 고객 문의 미처리 실시간
    const unsubInquiry = onSnapshot(
      query(collection(db, 'customerInquiries'), where('status', '==', 'pending')),
      snap => setBadgeStats(prev => ({ ...prev, inquiryPending: snap.docs.length })),
      err  => console.error('문의 뱃지 오류:', err)
    );

    // 고객 요청 미처리 실시간
    const unsubRequest = onSnapshot(
      query(collection(db, 'customerRequests'), where('status', '==', 'pending')),
      snap => setBadgeStats(prev => ({ ...prev, requestPending: snap.docs.length })),
      err  => console.error('요청 뱃지 오류:', err)
    );

    // 자동이체 접수 실시간
    const unsubAutoDebit = onSnapshot(
      query(collection(db, 'autoDebits'), where('status', '==', 'submitted')),
      snap => setBadgeStats(prev => ({ ...prev, autoDebitPending: snap.docs.length })),
      err  => console.error('자동이체 뱃지 오류:', err)
    );

    // 견적서/계약서는 변경 빈도 낮으므로 1회 로드 후 갱신
    const loadQuoteContract = async () => {
      try {
        const [qSnap, cSnap] = await Promise.all([
          getDocs(collection(db, 'quotes')),
          getDocs(collection(db, 'contracts')),
        ]);
        const quotePending    = qSnap.docs.filter(d => ['sent','viewed','approved'].includes(d.data().status)).length;
        const contractPending = cSnap.docs.filter(d => ['sent','signed'].includes(d.data().status) && !d.data().registeredCode).length;
        setBadgeStats(prev => ({ ...prev, quotePending, contractPending }));
      } catch (e) { console.error('견적/계약 뱃지 오류:', e); }
    };
    loadQuoteContract();

    return () => { unsubInquiry(); unsubRequest(); unsubAutoDebit(); };
  }, [currentUser]);

  // 채팅 안 읽은 수 실시간
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(
      collection(db, 'chatRooms'),
      s => setChatUnread(s.docs.reduce((sum, d) => sum + (d.data().unreadByManager || 0), 0)),
      () => {}
    );
    return unsub;
  }, [currentUser]);

  // loadBadgeStats는 하위 컴포넌트 호환성 유지용으로만 남김
  const loadBadgeStats = useCallback(async () => {
    try {
      const [qSnap, cSnap] = await Promise.all([
        getDocs(collection(db, 'quotes')),
        getDocs(collection(db, 'contracts')),
      ]);
      const quotePending    = qSnap.docs.filter(d => ['sent','viewed','approved'].includes(d.data().status)).length;
      const contractPending = cSnap.docs.filter(d => ['sent','signed'].includes(d.data().status) && !d.data().registeredCode).length;
      setBadgeStats(prev => ({ ...prev, quotePending, contractPending }));
    } catch (e) { console.error('뱃지 통계 로드 오류:', e); }
  }, []);

  // 로그인 후 재계약 알림 체크 (1회)
  useEffect(() => {
    if (currentUser) checkRenewalAlerts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]); // checkRenewalAlerts는 currentUser 변경 시만 1회 실행

  // 재계약 임박 자동 알림 (로그인 시 1회, 관리자만)
  const checkRenewalAlerts = useCallback(async () => {
    if (!currentUser || !['master','master1','master2'].includes(currentUser.role)) return;
    try {
      const snap = await getDocs(collection(db, 'customers'));
      const now  = new Date();
      const soon = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => {
          if (c.custStatus !== '정상' || !c.contractPeriod) return false;
          try {
            const parts = c.contractPeriod.split('-');
            const endStr = parts[parts.length-1].trim().replace(/\./g,'-');
            const endDate = new Date(endStr);
            if (isNaN(endDate)) return false;
            const days = Math.ceil((endDate - now) / 86400000);
            return days >= 0 && days <= 7; // 7일 이내
          } catch { return false; }
        });

      if (soon.length > 0) {
        Swal.fire({
          toast: true, position: 'bottom',
          icon: 'warning',
          title: `📋 계약 만료 임박 ${soon.length}건`,
          html: `<span style="font-size:12px;">${soon.slice(0,3).map(c => c.name).join(', ')}${soon.length>3?` 외 ${soon.length-3}건`:''}</span>`,
          showConfirmButton: true,
          confirmButtonText: '견적 탭에서 확인',
          timer: 8000,
          timerProgressBar: true,
        }).then(r => {
          if (r.isConfirmed) navigateToPage('sales');
        });
      }
    } catch(e) { console.warn('재계약 알림 오류:', e); }
  }, [currentUser, navigateToPage]);

  // ── 공지사항 읽지 않은 수 실시간 감지 ─────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const staffId = currentUser.visibleId || currentUser.id;
    const q = query(collection(db, 'notices'));
    const unsub = onSnapshot(q, snap => {
      const count = snap.docs.filter(d => {
        const data = d.data();
        return !(data.readBy || []).includes(staffId);
      }).length;
      setUnreadNoticeCount(count);
    }, () => {});
    return () => unsub();
  }, [currentUser]);

  // ── FCM 푸시 알림 초기화 ──────────────────────────────
  useEffect(() => {
    if (!currentUser) return;

    // staff 문서 ID 찾기 (FCM 토큰 저장용)
    const initFCM = async () => {
      try {
        const list = staffList.length > 0 ? staffList : [];
        const staffDoc = list.find(s => s.visibleId === (currentUser.visibleId || currentUser.id));
        const staffDocId = staffDoc?.id || null;

        // 권한 요청 + 토큰 등록 (처음 한 번만, 이후엔 기존 토큰 재사용)
        await requestNotificationPermission(staffDocId);
      } catch (e) {
        console.warn('FCM 초기화 오류 (무시됨):', e.message);
      }
    };

    initFCM();

    // 포그라운드 메시지 수신 (앱 켜져 있을 때)
    const unsub = onForegroundMessage((payload) => {
      const { title, body } = payload.notification || {};
      Swal.fire({
        toast: true,
        position: 'top',
        icon: 'info',
        title: title || '📅 새 알림',
        text:  body  || '',
        timer: 6000,
        showConfirmButton: false,
        timerProgressBar: true,
      });
    });

    return () => { if (typeof unsub === 'function') unsub(); };
  }, [currentUser, staffList]);

  // --- 알림 (실시간 onSnapshot) ---
  useEffect(() => {
    if (currentUser?.role !== 'master') return;
    const q = query(collection(db, 'notifications'), where('read', '==', false));
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (e) => {
      console.error('알림 실시간 오류:', e);
    });
    return () => unsub();
  }, [currentUser]);

  // CalendarPage 등 하위 컴포넌트와의 인터페이스 유지 (onSnapshot이 자동 갱신)
  const fetchNotifications = () => {};

  const handleNotificationClick = async () => {
    if (notifications.length === 0) {
      Swal.fire('알림', '새 알림이 없습니다.', 'info');
      return;
    }

    // 알림 액션 핸들러 (클로저로 처리 → window 전역변수 불필요)
    const dismissNotif = async (notifId) => {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
      Swal.close();
      fetchNotifications();
    };

    const openQuoteNotif = async (notifId, quoteId) => {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
      setNotifications(prev => prev.filter(n => n.id !== notifId));
      Swal.close();
      setPendingQuoteId(quoteId); // React state로 전달
      navigateToPage('quote');
    };

    const openContractNotif = async (notifId) => {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
      setNotifications(prev => prev.filter(n => n.id !== notifId));
      Swal.close();
      navigateToPage('contract');
    };

    const approveCancelReq = async (notifId, customerCode) => {
      Swal.close();
      const custSnap = await getDocs(collection(db, 'customers'));
      const customer = custSnap.docs.find(d => d.id === customerCode)?.data();
      const hasSpecialWork = customer?.specialWork?.staffId;

      if (hasSpecialWork) {
        const result = await Swal.fire({
          title: '특별작업 처리',
          html: '이 고객에게 등록된 특별작업이 있습니다.<br>특별작업도 삭제하시겠습니까?',
          icon: 'question',
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: '예 (함께 삭제)',
          denyButtonText: '아니오 (별도 처리)',
          cancelButtonText: '취소',
        });
        if (result.isConfirmed) {
          await updateDoc(doc(db, 'customers', customerCode), {
            custStatus: '해약', cancelledAt: new Date().toISOString(),
            cancelledBy: currentUser.name, specialWork: null,
          });
        } else if (result.isDenied) {
          await updateDoc(doc(db, 'customers', customerCode), {
            custStatus: '해약', cancelledAt: new Date().toISOString(), cancelledBy: currentUser.name,
          });
        } else return;
      } else {
        await updateDoc(doc(db, 'customers', customerCode), {
          custStatus: '해약', cancelledAt: new Date().toISOString(), cancelledBy: currentUser.name,
        });
      }
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
      Swal.fire('완료', '해약 처리 완료', 'success');
      fetchNotifications();
    };

    // 알림 HTML (XSS 방지: escapeHtml 적용)
    let html = '<div style="max-height:400px; overflow-y:auto; text-align:left;">';
    notifications.forEach(n => {
      const name = escapeHtml(n.customerName || n.custName || '고객');
      const date = escapeHtml((n.createdAt || n.requestAt || '').split('T')[0] || '-');
      const memo = escapeHtml(n.memo || '');

      if (n.type === 'cancelRequest') {
        html += `
          <div style="padding:12px;border-bottom:1px solid #eee;background:#fef2f2;border-radius:8px;margin-bottom:8px;">
            <div style="font-weight:bold;color:#dc2626;">🔴 해약 요청</div>
            <div style="margin:5px 0;"><b>${name}</b></div>
            <div style="font-size:12px;color:#666;">요청: ${escapeHtml(n.requestBy || '')} (${date})</div>
            ${memo ? `<div style="font-size:12px;color:#666;margin-top:5px;">사유: ${memo}</div>` : ''}
            <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div>
          </div>`;
      } else if (n.type === 'reQuoteRequest') {
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#eff6ff;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#1e40af;">📋 재견적 요청</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 재견적을 요청했습니다.</div>
          <div style="font-size:12px;color:#666;">${date}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      } else if (n.type === 'quoteApproved') {
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#d1fae5;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#065f46;">✅ 견적 승인!</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 견적을 승인했습니다!</div>
          <div style="font-size:12px;color:#666;">${date}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      } else if (n.type === 'quoteRejected') {
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#fee2e2;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#991b1b;">❌ 견적 거절</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 견적을 거절했습니다.</div>
          <div style="font-size:12px;color:#666;">${escapeHtml(n.message || '')}</div>
          <div style="font-size:12px;color:#666;">${date}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      } else if (n.type === 'contractRequest') {
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#fef3c7;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#92400e;">🎉 계약 요청!</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 계약을 요청했습니다!</div>
          <div style="font-size:12px;color:#666;">${date}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      } else if (n.type === 'contractSigned') {
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#d1fae5;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#065f46;">✍️ 계약서 서명 완료!</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 계약서에 서명했습니다!</div>
          <div style="font-size:12px;color:#666;">${date}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      } else if (n.type === 'newCustomerConverted') {
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#f0fdf4;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#059669;">🎉 신규 고객 전환!</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 정식 고객으로 등록됐어요!</div>
          <div style="font-size:12px;color:#666;">고객코드: <b>${escapeHtml(n.customerCode || '')}</b></div>
          <div style="font-size:12px;color:#666;">${date}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      } else if (n.type === 'quoteQuestion') {
        const msg = escapeHtml(n.message?.split(': "')[1]?.replace('"', '') || '');
        html += `<div style="padding:12px;border-bottom:1px solid #eee;background:#f0f9ff;border-radius:8px;margin-bottom:8px;">
          <div style="font-weight:bold;color:#0369a1;">💬 견적 질문</div>
          <div style="margin:5px 0;"><b>${name}</b>님이 질문을 남겼습니다.</div>
          <div style="font-size:12px;color:#374151;background:#e0f2fe;padding:6px 10px;border-radius:6px;margin:6px 0;">${msg}</div>
          <div style="margin-top:10px;display:flex;gap:8px;" id="notif-actions-${n.id}"></div></div>`;
      }
    });
    html += '</div>';

    await Swal.fire({
      title: `🔔 알림 (${notifications.length})`,
      html,
      showConfirmButton: false,
      showCloseButton: true,
      width: '400px',
      didOpen: () => {
        // SweetAlert2가 렌더링된 후 버튼을 React 방식 대신 DOM API로 안전하게 추가
        notifications.forEach(n => {
          const container = document.getElementById(`notif-actions-${n.id}`);
          if (!container) return;

          const btnStyle = 'flex:1;padding:8px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;';

          if (n.type === 'cancelRequest') {
            const approveBtn = document.createElement('button');
            approveBtn.style.cssText = `${btnStyle}background:#ef4444;color:white;`;
            approveBtn.textContent = '해약 승인';
            approveBtn.onclick = () => approveCancelReq(n.id, n.customerCode);

            const laterBtn = document.createElement('button');
            laterBtn.style.cssText = `${btnStyle}background:#6b7280;color:white;`;
            laterBtn.textContent = '나중에';
            laterBtn.onclick = () => dismissNotif(n.id);

            container.appendChild(approveBtn);
            container.appendChild(laterBtn);
          } else if (['reQuoteRequest', 'quoteApproved', 'quoteRejected', 'contractRequest', 'quoteQuestion'].includes(n.type)) {
            const color = n.type === 'quoteRejected' ? '#ef4444' : n.type === 'contractRequest' ? '#f59e0b' : n.type === 'quoteQuestion' ? '#0ea5e9' : '#10b981';
            const label = n.type === 'quoteQuestion' ? '답변하기' : '견적서 확인';

            const viewBtn = document.createElement('button');
            viewBtn.style.cssText = `${btnStyle}background:${color};color:white;`;
            viewBtn.textContent = label;
            viewBtn.onclick = () => openQuoteNotif(n.id, n.quoteId);

            const laterBtn = document.createElement('button');
            laterBtn.style.cssText = `${btnStyle}background:#6b7280;color:white;`;
            laterBtn.textContent = '나중에';
            laterBtn.onclick = () => dismissNotif(n.id);

            container.appendChild(viewBtn);
            container.appendChild(laterBtn);
          } else if (n.type === 'newCustomerConverted') {
            const goBtn = document.createElement('button');
            goBtn.style.cssText = `${btnStyle}background:#059669;color:white;`;
            goBtn.textContent = '고객관리 이동';
            goBtn.onclick = async () => {
              await updateDoc(doc(db, 'notifications', n.id), { read: true });
              setNotifications(prev => prev.filter(x => x.id !== n.id));
              Swal.close();
              navigateToPage('customers');
            };
            const okBtn = document.createElement('button');
            okBtn.style.cssText = `${btnStyle}background:#6b7280;color:white;`;
            okBtn.textContent = '확인';
            okBtn.onclick = () => dismissNotif(n.id);
            container.appendChild(goBtn);
            container.appendChild(okBtn);
          } else if (n.type === 'contractSigned') {
            const viewBtn = document.createElement('button');
            viewBtn.style.cssText = `${btnStyle}background:#10b981;color:white;`;
            viewBtn.textContent = '계약서 확인';
            viewBtn.onclick = () => openContractNotif(n.id);

            const okBtn = document.createElement('button');
            okBtn.style.cssText = `${btnStyle}background:#6b7280;color:white;`;
            okBtn.textContent = '확인';
            okBtn.onclick = () => dismissNotif(n.id);

            container.appendChild(viewBtn);
            container.appendChild(okBtn);
          }
        });
      },
    });
  };

  // --- 직원 목록 갱신 핸들러 ---
  const handleStaffUpdate = useCallback(async () => {
    await fetchStaffList();
  }, [fetchStaffList]);

  // --- 비밀번호 찾기 ---
  const handleForgotPassword = async () => {
    const { value: userId } = await Swal.fire({
      title: '🔐 비밀번호 찾기',
      html: `
        <div style="text-align:left;padding:10px;">
          <p style="font-size:13px;color:#666;margin-bottom:15px;">
            가입 시 등록한 이메일로 비밀번호 재설정 링크를 보내드립니다.
          </p>
          <input id="swal-userid" class="swal2-input" placeholder="아이디 입력" style="margin:0;">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '전송',
      cancelButtonText: '취소',
      preConfirm: () => {
        const id = document.getElementById('swal-userid').value.trim();
        if (!id) { Swal.showValidationMessage('아이디를 입력하세요'); return false; }
        return id;
      },
    });
    if (!userId) return;

    try {
      const staffSnap = await getDocs(collection(db, 'staff'));
      const staffMember = staffSnap.docs.map(d => ({ id: d.id, ...d.data() })).find(s => s.visibleId === userId);
      if (!staffMember || !staffMember.email) {
        Swal.fire('오류', '해당 아이디를 찾을 수 없거나 등록된 이메일이 없습니다.', 'error');
        return;
      }
      // 실제 등록된 이메일로 전송 (Firebase Auth 계정은 @test.com이지만
      // 비밀번호 재설정은 실제 이메일이 있어야 하므로 안내 메시지만 표시)
      if (!staffMember.email) {
        Swal.fire('오류', '등록된 이메일이 없습니다. 관리자에게 문의하세요.', 'error');
        return;
      }
      // Firebase Auth 계정(아이디@test.com)으로 리셋 메일 발송
      await sendPasswordResetEmail(auth, `${userId}@test.com`);
      Swal.fire({
        icon: 'success', title: '비밀번호 재설정 안내',
        html: `<div style="text-align:left;padding:10px;">
          <p>관리자에게 비밀번호 재설정을 요청하거나,</p>
          <p style="margin-top:8px;">아래 이메일로 재설정 링크가 전송되었습니다:</p>
          <p style="color:#3b82f6;font-weight:bold;margin-top:10px;">${escapeHtml(staffMember.email)}</p>
          <p style="font-size:12px;color:#f59e0b;margin-top:10px;">※ 이메일이 도착하지 않으면 관리자에게 직접 문의하세요.</p>
        </div>`,
      });
    } catch (error) {
      console.error('비밀번호 찾기 오류:', error);
      const errorMsg = error.code === 'auth/user-not-found' ? '등록되지 않은 사용자입니다.' : '이메일 전송 실패';
      Swal.fire('오류', errorMsg, 'error');
    }
  };

  // --- 로그인 ---
  const handleLogin = async () => {
    const { value: formValues, isDenied } = await Swal.fire({
      title: '로그인',
      html: `
        <input id="swal-id" class="swal2-input" placeholder="아이디">
        <input id="swal-pw" class="swal2-input" type="password" placeholder="비밀번호">
        <div style="margin-top:15px;">
          <button type="button" id="forgot-pw-btn" style="background:none;border:none;color:#3b82f6;cursor:pointer;font-size:13px;text-decoration:underline;">
            비밀번호를 잊으셨나요?
          </button>
        </div>
      `,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: '로그인',
      denyButtonText: '회원가입',
      denyButtonColor: '#22c55e',
      cancelButtonText: '취소',
      didOpen: () => {
        document.getElementById('forgot-pw-btn').addEventListener('click', () => {
          Swal.close();
          handleForgotPassword();
        });
      },
      preConfirm: () => {
        const id = document.getElementById('swal-id').value;
        const pw = document.getElementById('swal-pw').value;
        if (!id || !pw) { Swal.showValidationMessage('아이디와 비밀번호를 입력하세요'); return false; }
        return { id, pw };
      },
    });

    if (isDenied) { handleRegister(); return; }
    if (formValues) {
      try {
        await signInWithEmailAndPassword(auth, `${formValues.id}@test.com`, formValues.pw);
        Swal.fire({ icon: 'success', title: '로그인 성공!', timer: 1500, showConfirmButton: false });
      } catch (error) {
        console.error('로그인 오류:', error);
        let msg = '로그인 실패';
        if (error.code === 'auth/user-not-found') msg = '존재하지 않는 사용자입니다';
        else if (error.code === 'auth/wrong-password') msg = '비밀번호가 틀렸습니다';
        else if (error.code === 'auth/invalid-credential') msg = '아이디 또는 비밀번호를 확인하세요';
        Swal.fire('로그인 실패', msg, 'error');
      }
    }
  };

  // --- 회원가입 ---
  const handleRegister = async () => {
    const { value } = await Swal.fire({
      title: '📝 회원가입',
      html: `
        <div style="text-align:left;padding:0 10px;max-height:450px;overflow-y:auto;">
          <div style="font-weight:bold;margin:10px 0 5px;color:#dc2626;font-size:12px;">* 필수 입력</div>
          <input id="reg-id" class="swal2-input" placeholder="아이디 (영문/숫자)" style="margin:5px auto;">
          <input id="reg-pw" class="swal2-input" type="password" placeholder="비밀번호 (영문+숫자+특수문자, 8자 이상)" style="margin:5px auto;">
          <input id="reg-pw2" class="swal2-input" type="password" placeholder="비밀번호 확인" style="margin:5px auto;">
          <input id="reg-name" class="swal2-input" placeholder="성함" style="margin:5px auto;">
          <input id="reg-phone" class="swal2-input" placeholder="전화번호 (010-0000-0000)" style="margin:5px auto;">
          <input id="reg-address" class="swal2-input" placeholder="주소" style="margin:5px auto;">
          <input id="reg-email" class="swal2-input" type="email" placeholder="이메일" style="margin:5px auto;">
          <div style="font-weight:bold;margin:15px 0 5px;color:#666;font-size:12px;">선택 입력</div>
          <input id="reg-dept" class="swal2-input" placeholder="부서" style="margin:5px auto;">
          <select id="reg-position" class="swal2-input" style="margin:5px auto;">
            <option value="">직급 선택</option>
            <option value="사원">사원</option><option value="주임">주임</option>
            <option value="대리">대리</option><option value="과장">과장</option>
            <option value="차장">차장</option><option value="부장">부장</option>
            <option value="이사">이사</option>
          </select>
          <input id="reg-hobby" class="swal2-input" placeholder="취미" style="margin:5px auto;">
          <div style="display:flex;gap:8px;align-items:center;margin:5px 15px;">
            <input id="reg-birth" type="date" class="swal2-input" style="flex:1;margin:0;">
            <select id="reg-birthType" class="swal2-input" style="width:80px;margin:0;">
              <option value="solar">양력</option><option value="lunar">음력</option>
            </select>
          </div>
          <div style="margin-top:15px;padding:10px;background:#f0f9ff;border-radius:8px;font-size:11px;color:#0369a1;">
            💡 비밀번호 양식: 영문, 숫자, 특수문자(!@#$%^&*) 조합 8자 이상
          </div>
        </div>
      `,
      width: '420px',
      showCancelButton: true,
      confirmButtonText: '가입하기',
      cancelButtonText: '취소',
      preConfirm: () => {
        const id = document.getElementById('reg-id').value.trim();
        const pw = document.getElementById('reg-pw').value;
        const pw2 = document.getElementById('reg-pw2').value;
        const name = document.getElementById('reg-name').value.trim();
        const phone = document.getElementById('reg-phone').value.trim();
        const address = document.getElementById('reg-address').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        if (!id || !pw || !name || !phone || !address || !email) {
          Swal.showValidationMessage('필수 항목을 모두 입력하세요'); return false;
        }
        if (!/^[a-zA-Z0-9]+$/.test(id)) {
          Swal.showValidationMessage('아이디는 영문/숫자만 가능합니다'); return false;
        }
        if (pw.length < 8) {
          Swal.showValidationMessage('비밀번호는 8자 이상이어야 합니다'); return false;
        }
        if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[!@#$%^&*]/.test(pw)) {
          Swal.showValidationMessage('비밀번호는 영문, 숫자, 특수문자(!@#$%^&*)를 포함해야 합니다'); return false;
        }
        if (pw !== pw2) {
          Swal.showValidationMessage('비밀번호가 일치하지 않습니다'); return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          Swal.showValidationMessage('올바른 이메일 형식을 입력하세요'); return false;
        }
        return {
          visibleId: id, pw, name, phone, address, email,
          department: document.getElementById('reg-dept').value,
          position: document.getElementById('reg-position').value,
          hobby: document.getElementById('reg-hobby').value,
          birthDate: document.getElementById('reg-birth').value,
          birthType: document.getElementById('reg-birthType').value,
          role: 'staff',
        };
      },
    });

    if (value) {
      Swal.fire({ title: '가입 중...', text: '계정을 생성하고 있습니다.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      try {
        await createUserWithEmailAndPassword(auth, `${value.visibleId}@test.com`, value.pw);
        await addDoc(collection(db, 'staff'), { ...value, createdAt: new Date().toISOString() });
        const list = await fetchStaffList();
        const found = list.find(s => s.visibleId === value.visibleId);
        if (found) setCurrentUser({ ...found, id: found.visibleId });
        Swal.fire({
          icon: 'success', title: '🎉 가입 완료!',
          html: `<div style="text-align:left;padding:10px;">
            <p><b>성함:</b> ${escapeHtml(value.name)}</p>
            <p><b>아이디:</b> ${escapeHtml(value.visibleId)}</p>
          </div><div style="font-size:12px;color:#666;">자동 로그인되었습니다.</div>`,
        });
      } catch (error) {
        console.error('가입 오류:', error);
        const msg = error.code === 'auth/email-already-in-use' ? '이미 사용 중인 아이디입니다.' : error.code === 'auth/weak-password' ? '비밀번호가 너무 약합니다.' : '가입 실패';
        Swal.fire('오류', msg, 'error');
      }
    }
  };

  // --- 로그아웃 ---
  const handleLogout = async () => {
    const result = await Swal.fire({
      title: '로그아웃', text: '로그아웃 하시겠습니까?',
      showCancelButton: true, confirmButtonText: '로그아웃', cancelButtonText: '취소',
    });
    if (result.isConfirmed) {
      await signOut(auth);
      setUser(null);
      setCurrentUser(null);
      setCurrentPage('calendar');
      pageHistoryRef.current = ['calendar'];
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>로딩중...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginBox}>
          <h1 style={styles.loginTitle}>
            {companyLogo && companyLogo.startsWith('data:image') ? (
              <img src={companyLogo} alt="로고" style={{ width: '40px', height: '40px', borderRadius: '8px', marginRight: '10px', verticalAlign: 'middle' }} />
            ) : (
              <span>📋 </span>
            )}
            {companyName}
          </h1>
          <p style={styles.loginSubtitle}>고객관리 시스템</p>
          <button onClick={handleLogin} style={styles.loginButton}>로그인</button>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'calendar':
        return <CalendarPage currentUser={currentUser} staffList={staffList} onNotification={fetchNotifications} />;
      case 'customers':
        return <CustomerList currentUser={currentUser} staffList={staffList} setCurrentPage={navigateToPage} onNavigateToQuote={navigateToPage} />;
      case 'excel':
        return <ExcelUploadPage currentUser={currentUser} staffList={staffList} onComplete={() => navigateToPage('customers')} />;
      case 'staff':
        return <StaffManagement currentUser={currentUser} staffList={staffList} onStaffUpdate={handleStaffUpdate} />;
      case 'settings':
        if (currentUser?.role !== 'master') return (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af', fontSize: 14 }}>
            ⛔ 설정은 관리자만 접근할 수 있습니다.
          </div>
        );
        return <SettingPage currentUser={currentUser} staffList={staffList} onStaffUpdate={handleStaffUpdate} />;
      case 'pest':
        return <PestMonitoringPage currentUser={currentUser} />;
      case 'notice':
        return <NoticeBoard currentUser={currentUser} />;
      case 'scheduler':
        return <SchedulerPage currentUser={currentUser} staffList={staffList}
          onNavigateToSales={(tab, data) => {
            if (data) setPendingSalesData(data);
            navigateToPage('sales');
          }} />;
      case 'sales':
        return (
          <SalesPage
            currentUser={currentUser}
            staffList={staffList}
            badgeStats={badgeStats}
            initialQuoteId={pendingQuoteId}
            onQuoteOpened={() => setPendingQuoteId(null)}
            initialSalesData={pendingSalesData}
            onSalesDataUsed={() => setPendingSalesData(null)}
          />
        );
      case 'quote':
        return (
          <SalesPage
            currentUser={currentUser}
            staffList={staffList}
            badgeStats={badgeStats}
            initialTab="quote"
            initialQuoteId={pendingQuoteId}
            onQuoteOpened={() => setPendingQuoteId(null)}
          />
        );
      case 'contract':
        return (
          <SalesPage
            currentUser={currentUser}
            staffList={staffList}
            badgeStats={badgeStats}
            initialTab="contract"
          />
        );
      default:
        return <CalendarPage currentUser={currentUser} staffList={staffList} onNotification={fetchNotifications} />;
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerTitle}>
          {companyLogo && companyLogo.startsWith('data:image') ? (
            <img src={companyLogo} alt="로고" style={{ width: '24px', height: '24px', borderRadius: '4px', marginRight: '8px', verticalAlign: 'middle' }} />
          ) : (
            <span style={{ marginRight: '8px' }}>📋</span>
          )}
          {companyName}
        </div>
        <div style={styles.headerRight}>
          {/* 고객 요청 버튼 */}
          <button onClick={() => setShowRequestPanel(true)}
            style={{ position:'relative', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
            📋
            {badgeStats.requestPending > 0 && (
              <span style={{ position:'absolute', top:'-4px', right:'-4px', backgroundColor:'#f59e0b', color:'white', fontSize:'9px', fontWeight:'bold', padding:'1px 4px', borderRadius:'8px', minWidth:'14px', textAlign:'center', lineHeight:'14px' }}>
                {badgeStats.requestPending > 9 ? '9+' : badgeStats.requestPending}
              </span>
            )}
          </button>
          {/* 1:1 채팅 버튼 */}
          <button onClick={() => setShowChatPanel(true)}
            style={{ position:'relative', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
            💬
            {chatUnread > 0 && (
              <span style={{ position:'absolute', top:'-4px', right:'-4px', backgroundColor:'#ef4444', color:'white', fontSize:'9px', fontWeight:'bold', padding:'1px 4px', borderRadius:'8px', minWidth:'14px', textAlign:'center', lineHeight:'14px' }}>
                {chatUnread > 9 ? '9+' : chatUnread}
              </span>
            )}
          </button>
          {/* 리뷰 버튼 */}
          <button onClick={() => setShowReviewPanel(true)}
            style={{ background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
            ⭐
          </button>
          {/* 자동이체 신청서 버튼 */}
          <button onClick={() => setShowAutoDebitPanel(true)}
            style={{ position:'relative', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
            🏦
            {badgeStats.autoDebitPending > 0 && (
              <span style={{ position:'absolute', top:'-4px', right:'-4px', backgroundColor:'#7c3aed', color:'white', fontSize:'9px', fontWeight:'bold', padding:'1px 4px', borderRadius:'8px', minWidth:'14px', textAlign:'center', lineHeight:'14px' }}>
                {badgeStats.autoDebitPending > 9 ? '9+' : badgeStats.autoDebitPending}
              </span>
            )}
          </button>
          {/* 고객 문의 버튼 */}
          <button onClick={() => setShowInquiryPanel(true)}
            style={{ position:'relative', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
            📩
            {badgeStats.inquiryPending > 0 && (
              <span style={{ position:'absolute', top:'-4px', right:'-4px', backgroundColor:'#ef4444', color:'white', fontSize:'9px', fontWeight:'bold', padding:'1px 4px', borderRadius:'8px', minWidth:'14px', textAlign:'center', lineHeight:'14px' }}>
                {badgeStats.inquiryPending > 9 ? '9+' : badgeStats.inquiryPending}
              </span>
            )}
          </button>
          {/* 공지사항 버튼 (전 직원) */}
          <button onClick={() => navigateToPage('notice')}
            style={{ position:'relative', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
            📢
            {unreadNoticeCount > 0 && (
              <span style={{ position:'absolute', top:'-4px', right:'-4px', backgroundColor:'#f59e0b', color:'white', fontSize:'9px', fontWeight:'bold', padding:'1px 4px', borderRadius:'8px', minWidth:'14px', textAlign:'center', lineHeight:'14px' }}>
                {unreadNoticeCount}
              </span>
            )}
          </button>
          {currentUser?.role === 'master' && (
            <button onClick={handleNotificationClick}
              style={{ position:'relative', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:'6px', cursor:'pointer', width:'28px', height:'28px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', padding:0, flexShrink:0 }}>
              🔔
              {notifications.length > 0 && (
                <span style={{ position:'absolute', top:'-4px', right:'-4px', backgroundColor:'#ef4444', color:'white', fontSize:'9px', fontWeight:'bold', padding:'1px 4px', borderRadius:'8px', minWidth:'14px', textAlign:'center', lineHeight:'14px' }}>
                  {notifications.length}
                </span>
              )}
            </button>
          )}
          <div style={styles.headerUser}>
            <span style={{
              ...styles.roleTag,
              backgroundColor: currentUser?.role === 'master' ? '#dc2626' :
                currentUser?.role === 'master1' ? '#7c3aed' :
                currentUser?.role === 'master2' ? '#0891b2' : '#3b82f6',
            }}>
              {currentUser?.role === 'master' ? '관리자' :
                currentUser?.role === 'master1' ? '팀장' :
                currentUser?.role === 'master2' ? '부팀장' : '직원'}
            </span>
            {currentUser?.name || '사용자'}
            <button
              onClick={handleLogout}
              title="로그아웃"
              style={styles.logoutBtn}
            >
              OFF
            </button>
          </div>
        </div>
      </header>

      {/* 고객 요청 패널 */}
      {showRequestPanel && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowRequestPanel(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column', height:'100%' }}>
            <CustomerRequestPanel currentUser={currentUser} onClose={() => { setShowRequestPanel(false); loadBadgeStats(); }} />
          </div>
        </div>
      )}

      {/* 고객 문의 패널 */}
      {showInquiryPanel && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowInquiryPanel(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column', height:'100%' }}>
            <CustomerInquiryPanel currentUser={currentUser} onClose={() => { setShowInquiryPanel(false); loadBadgeStats(); }} />
          </div>
        </div>
      )}

      {/* 자동이체 신청서 패널 */}
      {showAutoDebitPanel && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowAutoDebitPanel(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column', height:'100%' }}>
            <AutoDebitPanel currentUser={currentUser} onClose={() => { setShowAutoDebitPanel(false); loadBadgeStats(); }} />
          </div>
        </div>
      )}

      {/* 고객 리뷰 패널 */}
      {showReviewPanel && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowReviewPanel(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column', height:'100%' }}>
            <ReviewPanel currentUser={currentUser} onClose={() => setShowReviewPanel(false)} />
          </div>
        </div>
      )}

      {/* 1:1 채팅 패널 */}
      {showChatPanel && (
        <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)' }} onClick={() => setShowChatPanel(false)} />
          <div style={{ position:'relative', width:'100%', maxWidth:480, background:'white', boxShadow:'-4px 0 24px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column', height:'100%' }}>
            <ChatManagePanel currentUser={currentUser} onClose={() => setShowChatPanel(false)} />
          </div>
        </div>
      )}


      <main style={styles.main}>{renderPage()}</main>

      <nav style={styles.nav}>
        <button onClick={() => navigateToPage('calendar')} style={{ ...styles.navBtn, ...(currentPage === 'calendar' ? styles.navBtnActive : {}) }}>
          <span style={styles.navIcon}>📅</span>
          <span style={styles.navText}>배정</span>
        </button>
        <button onClick={() => navigateToPage('scheduler')} style={{ ...styles.navBtn, ...(currentPage === 'scheduler' ? styles.navBtnActive : {}) }}>
          <span style={styles.navIcon}>🗓️</span>
          <span style={styles.navText}>스케쥴</span>
        </button>
        <button onClick={() => navigateToPage('customers')} style={{ ...styles.navBtn, ...(currentPage === 'customers' ? styles.navBtnActive : {}) }}>
          <span style={styles.navIcon}>👥</span>
          <span style={styles.navText}>고객</span>
        </button>
        <button onClick={() => navigateToPage('staff')} style={{ ...styles.navBtn, ...(currentPage === 'staff' ? styles.navBtnActive : {}) }}>
          <span style={styles.navIcon}>📊</span>
          <span style={styles.navText}>직원</span>
        </button>
        <button
          onClick={() => { navigateToPage('sales'); loadBadgeStats(); }}
          style={{ ...styles.navBtn, ...(['sales','quote','contract'].includes(currentPage) ? styles.navBtnActive : {}), position: 'relative' }}
        >
          <span style={styles.navIcon}>💼</span>
          <span style={styles.navText}>영업</span>
          {(badgeStats.quotePending + badgeStats.contractPending) > 0 && (
            <span style={{ position: 'absolute', top: '4px', right: '4px', background: '#ef4444', color: 'white', borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
              {(badgeStats.quotePending + badgeStats.contractPending) > 9 ? '9+' : (badgeStats.quotePending + badgeStats.contractPending)}
            </span>
          )}
        </button>
        {currentUser?.role === 'master' && (
          <button onClick={() => navigateToPage('settings')} style={{ ...styles.navBtn, ...(currentPage === 'settings' ? styles.navBtnActive : {}) }}>
            <span style={styles.navIcon}>⚙️</span>
            <span style={styles.navText}>설정</span>
          </button>
        )}
      </nav>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#f3f4f6', display: 'flex', flexDirection: 'column' },
  loadingContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f3f4f6' },
  loadingText: { fontSize: '18px', color: '#666' },
  loginContainer: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#3b82f6' },
  loginBox: { backgroundColor: 'white', padding: '40px', borderRadius: '20px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  loginTitle: { fontSize: '28px', marginBottom: '10px', color: '#1e40af' },
  loginSubtitle: { color: '#666', marginBottom: '30px' },
  loginButton: { width: '100%', padding: '15px 40px', fontSize: '16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' },
  header: { backgroundColor: '#1e40af', color: 'white', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 },
  headerTitle: { fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  headerUser: { fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' },
  logoutBtn: { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: '6px', padding: '4px 7px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.5px' },
  roleTag: { display: 'none' },
  main: { flex: 1, padding: '15px', paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))', overflowY: 'auto' },
  nav: { position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: 'white', display: 'flex', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)', zIndex: 1000, paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
  navBtn: { flex: 1, padding: '12px 0', border: 'none', backgroundColor: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', color: '#9ca3af' },
  navBtnActive: { color: '#3b82f6', backgroundColor: '#eff6ff' },
  navIcon: { fontSize: '20px', marginBottom: '3px' },
  navText: { fontSize: '11px', fontWeight: 'bold' },
};

export default AppWrapper;
