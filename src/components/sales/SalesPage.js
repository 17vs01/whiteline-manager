// =============================================
// 영업 탭 - 견적 + 계약서 통합 페이지
// =============================================
import React, { useState } from 'react';
import QuotePage              from '../quote/QuotePage';
import ContractPage           from '../contract/ContractPage';
import SalesPipeline          from './SalesPipeline';
import ShortTermCustomerTab   from './ShortTermCustomerTab';
import { useAppContext } from '../../context/AppContext';

const S = {
  container: { paddingBottom: 8 },
  tabBar: {
    display: 'flex', background: 'white',
    borderBottom: '2px solid #e5e7eb', marginBottom: 0,
    position: 'sticky', top: 0, zIndex: 50,
  },
  tab: (active) => ({
    flex: 1, padding: '12px 0', border: 'none',
    background: 'transparent', cursor: 'pointer',
    fontSize: 14, fontWeight: 'bold',
    color: active ? '#1e40af' : '#9ca3af',
    borderBottom: active ? '3px solid #3b82f6' : '3px solid transparent',
    transition: 'all 0.15s',
  }),
  badge: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: '#ef4444', color: 'white', borderRadius: '50%',
    width: 16, height: 16, fontSize: 10, fontWeight: 'bold',
    marginLeft: 4, verticalAlign: 'middle',
  },
};

export default function SalesPage({
  currentUser,
  staffList,
  badgeStats,
  onNavigateToContract,
  onNavigateToQuote,
  initialTab,
  initialQuoteId,
  onQuoteOpened,
  initialSalesData,  // 영업→견적 전환 시 미리 채워줄 데이터
  onSalesDataUsed,
}) {
  const { settings } = useAppContext();
  const [activeTab, setActiveTab] = useState(initialTab || 'quote');

  return (
    <div style={S.container}>
      {/* 서브탭 */}
      <div style={S.tabBar}>
        <button style={S.tab(activeTab === 'quote')} onClick={() => setActiveTab('quote')}>
          📄 견적
          {(badgeStats?.quotePending > 0) && (
            <span style={S.badge}>
              {badgeStats.quotePending > 9 ? '9+' : badgeStats.quotePending}
            </span>
          )}
        </button>
        <button style={S.tab(activeTab === 'contract')} onClick={() => setActiveTab('contract')}>
          📃 계약서
          {(badgeStats?.contractPending > 0) && (
            <span style={S.badge}>
              {badgeStats.contractPending > 9 ? '9+' : badgeStats.contractPending}
            </span>
          )}
        </button>
        <button style={S.tab(activeTab === 'pipeline')} onClick={() => setActiveTab('pipeline')}>
          📊 파이프라인
        </button>
        <button style={S.tab(activeTab === 'shortterm')} onClick={() => setActiveTab('shortterm')}>
          🟡 단기고객
        </button>
      </div>

      {/* 탭 컨텐츠 */}
      <div style={{ padding: '12px 0 0' }}>
        {activeTab === 'quote' && (
          <QuotePage
            currentUser={currentUser}
            staffList={staffList}
            apiKey={settings.anthropicApiKey}
            initialQuoteId={initialQuoteId}
            onQuoteOpened={onQuoteOpened}
            onNavigateToContract={() => setActiveTab('contract')}
            initialNewCustomerData={initialSalesData}
            onInitialDataUsed={onSalesDataUsed}
          />
        )}
        {activeTab === 'contract' && (
          <ContractPage
            currentUser={currentUser}
            staffList={staffList}
            onNavigateToQuote={() => setActiveTab('quote')}
          />
        )}
        {activeTab === 'pipeline' && (
          <SalesPipeline
            currentUser={currentUser}
            staffList={staffList}
          />
        )}
        {activeTab === 'shortterm' && (
          <ShortTermCustomerTab
            currentUser={currentUser}
            staffList={staffList}
          />
        )}
      </div>
    </div>
  );
}
