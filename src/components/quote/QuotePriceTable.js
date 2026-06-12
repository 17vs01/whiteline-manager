import React, { useState } from 'react';
import { DEFAULT_PRICE_TABLE, formatPrice } from './quoteConstants';

function QuotePriceTable({ onBack }) {
  const [activeTab, setActiveTab] = useState('residential');

  const tabs = [
    { key: 'residential', label: '🏠 가정/아파트' },
    { key: 'commercial', label: '🍽️ 음식점/상가' },
    { key: 'disinfection', label: '🧴 살균소독' },
    { key: 'blocking', label: '🚫 유입차단' },
    { key: 'bedbug', label: '🛏️ 빈대방제' },
    { key: 'multiUnit', label: '🏘️ 다세대/빌라' },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn}>← 뒤로</button>
        <h2 style={styles.title}>📊 방역서비스 단가표</h2>
        <div style={{ width: '60px' }} />
      </div>

      <div style={styles.notice}>
        💡 단가표는 기준 참고용이며, 현장 상황에 따라 조정될 수 있습니다.
        단가 수정은 <b>설정 &gt; 단가표 관리</b>에서 가능합니다.
      </div>

      {/* 탭 */}
      <div style={styles.tabBar}>
        {tabs.map(t => (
          <button
            key={t.key}
            style={{ ...styles.tab, ...(activeTab === t.key ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 가정/아파트 */}
      {activeTab === 'residential' && (
        <PriceCard title="🏠 일반 가정 (아파트/빌라/오피스텔/단독주택)">
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>평수</th>
                <th style={styles.th}>1회 방문</th>
                <th style={styles.th}>초기 (2개월)</th>
                <th style={styles.th}>비고</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_PRICE_TABLE.residential.byArea.map((row, i) => (
                <tr key={i} style={{ background: i % 2 ? '#f8fafc' : 'white' }}>
                  <td style={styles.td}>{row.label}</td>
                  <td style={{ ...styles.tdR, color: '#10b981', fontWeight: 'bold' }}>
                    {row.visitPrice ? formatPrice(row.visitPrice) : '별도 협의'}
                  </td>
                  <td style={{ ...styles.tdR, color: '#d97706' }}>
                    {row.initialPrice ? `${formatPrice(row.initialPrice)} × 2` : '별도 협의'}
                  </td>
                  <td style={{ ...styles.td, color: '#94a3b8', fontSize: '12px' }}>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PriceCard>
      )}

      {/* 음식점/상가 */}
      {activeTab === 'commercial' && (
        <PriceCard title="🍽️ 음식점/상가/사무실">
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>평수</th>
                <th style={styles.th}>1회 방문</th>
                <th style={styles.th}>초기 (2개월~)</th>
                <th style={styles.th}>정기계약 (월)</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_PRICE_TABLE.commercial.byArea.map((row, i) => (
                <tr key={i} style={{ background: i % 2 ? '#f8fafc' : 'white' }}>
                  <td style={styles.td}>{row.label}</td>
                  <td style={{ ...styles.tdR, color: '#3b82f6', fontWeight: 'bold' }}>
                    {row.visitPrice ? formatPrice(row.visitPrice) : '별도 협의'}
                  </td>
                  <td style={{ ...styles.tdR, color: '#d97706' }}>
                    {row.initialPrice ? `${formatPrice(row.initialPrice)}~` : '별도 협의'}
                  </td>
                  <td style={{ ...styles.tdR, color: '#10b981', fontWeight: 'bold' }}>
                    {row.monthlyPrice ? formatPrice(row.monthlyPrice) : '별도 협의'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PriceCard>
      )}

      {/* 살균소독 */}
      {activeTab === 'disinfection' && (
        <PriceCard title="🧴 살균소독 서비스">
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>평수</th>
                <th style={styles.th}>비용</th>
                <th style={styles.th}>비고</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_PRICE_TABLE.disinfection.byArea.map((row, i) => (
                <tr key={i} style={{ background: i % 2 ? '#f8fafc' : 'white' }}>
                  <td style={styles.td}>{row.label}</td>
                  <td style={{ ...styles.tdR, color: '#3b82f6', fontWeight: 'bold' }}>
                    {row.visitPrice ? formatPrice(row.visitPrice) : '별도 협의'}
                  </td>
                  <td style={{ ...styles.td, color: '#94a3b8', fontSize: '12px' }}>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={styles.infoBox}>
            ※ 살균소독은 표면에 약제를 분무하는 방식입니다.<br />
            교차오염 방지를 위해 구역별 별도 장비 사용을 권장합니다.
          </div>
        </PriceCard>
      )}

      {/* 유입차단 */}
      {activeTab === 'blocking' && (
        <PriceCard title="🚫 해충 유입 차단 시공">
          <div style={styles.infoRow}>
            <span style={styles.infoKey}>작업 방식</span>
            <span>{DEFAULT_PRICE_TABLE.blocking.method}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoKey}>기본 비용</span>
            <span style={{ color: '#10b981', fontWeight: 'bold' }}>
              {formatPrice(DEFAULT_PRICE_TABLE.blocking.basePrice)} / 회
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoKey}>추가 비용</span>
            <span>{DEFAULT_PRICE_TABLE.blocking.desc}</span>
          </div>
          <div style={styles.infoBox}>
            ※ 30평 기준이며, 초과 평수는 30평당 {formatPrice(DEFAULT_PRICE_TABLE.blocking.extraPer30)} 추가됩니다.
          </div>
        </PriceCard>
      )}

      {/* 빈대방제 */}
      {activeTab === 'bedbug' && (
        <PriceCard title="🛏️ 침대빈대 방제">
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>작업 시간</th>
                <th style={styles.th}>비용</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_PRICE_TABLE.bedbug.byTime.map((row, i) => (
                <tr key={i} style={{ background: i % 2 ? '#f8fafc' : 'white' }}>
                  <td style={styles.td}>{row.label}</td>
                  <td style={{ ...styles.tdR, color: '#ef4444', fontWeight: 'bold' }}>
                    {row.price ? `${formatPrice(row.price)}~` : '별도 협의'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={styles.infoBox}>
            ※ 빈대 방제는 정밀 진단 후 작업 시간 산정. 재발 시 무상 재방문 협의 가능.
          </div>
        </PriceCard>
      )}

      {/* 다세대/빌라 */}
      {activeTab === 'multiUnit' && (
        <PriceCard title="🏘️ 다세대/빌라 (세대수 기반)">
          <div style={styles.infoRow}>
            <span style={styles.infoKey}>적용 대상</span>
            <span>{DEFAULT_PRICE_TABLE.multiUnit.minUnits}세대 이상 계약 시</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoKey}>세대당 단가</span>
            <span style={{ color: '#10b981', fontWeight: 'bold' }}>
              {formatPrice(DEFAULT_PRICE_TABLE.multiUnit.pricePerUnit.min)} ~ {formatPrice(DEFAULT_PRICE_TABLE.multiUnit.pricePerUnit.max)} / 월
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoKey}>최소 계약</span>
            <span>{DEFAULT_PRICE_TABLE.multiUnit.minMonths}개월 이상</span>
          </div>
          <div style={styles.exampleBox}>
            <b>📌 예시</b><br />{DEFAULT_PRICE_TABLE.multiUnit.example}
          </div>
          <div style={styles.infoBox}>
            ※ 세대 수, 건물 규모에 따라 세대당 단가 협의 가능합니다.
          </div>
        </PriceCard>
      )}
    </div>
  );
}

function PriceCard({ title, children }) {
  return (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '16px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '12px'
    }}>
      <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#1e3a5f', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

const styles = {
  container: { paddingBottom: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0' },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#3b82f6', fontWeight: 'bold', padding: '4px 8px' },
  title: { fontSize: '17px', fontWeight: 'bold', color: '#1e3a5f', margin: 0 },
  notice: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#166534', marginBottom: '14px', lineHeight: '1.5' },
  tabBar: { display: 'flex', gap: '6px', marginBottom: '14px', overflowX: 'auto', paddingBottom: '4px' },
  tab: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '20px', background: 'white', cursor: 'pointer', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' },
  tabActive: { background: '#1e40af', color: 'white', border: '1px solid #1e40af', fontWeight: 'bold' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  thead: { background: '#1e3a5f' },
  th: { padding: '8px', textAlign: 'center', color: 'white', fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.2)' },
  td: { padding: '8px 10px', border: '1px solid #e2e8f0', color: '#374151' },
  tdR: { padding: '8px 10px', border: '1px solid #e2e8f0', textAlign: 'right' },
  infoRow: { display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '14px' },
  infoKey: { minWidth: '100px', fontSize: '13px', color: '#64748b', fontWeight: 'bold' },
  infoBox: { background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#64748b', marginTop: '12px', lineHeight: '1.6' },
  exampleBox: { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#1e40af', marginTop: '10px', lineHeight: '1.6' },
};

export default QuotePriceTable;
