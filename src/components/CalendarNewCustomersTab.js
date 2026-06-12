import React from 'react';

const getPrice = (c) =>
  c.services ? c.services.reduce((s, sv) => s + (sv.price || 0), 0) : (c.price || 0);

// 신규/복귀 공통 카드
const CustomerCard = ({ c, badgeLabel, badgeColor, nameColor, cardBg, cardBorder, borderColor, extra }) => (
  <div style={{
    background: cardBg, border: `1px solid ${cardBorder}`, borderLeft: `4px solid ${borderColor}`,
    borderRadius: '10px', padding: '12px 14px', marginBottom: '8px',
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ background: badgeColor, color: 'white', fontSize: '10px', fontWeight: 'bold', padding: '2px 7px', borderRadius: '20px' }}>{badgeLabel}</span>
        <span style={{ fontSize: '15px', fontWeight: 'bold', color: nameColor }}>{c.name || c.custName}</span>
      </div>
      <span style={{ fontSize: '11px', color: '#6b7280', flexShrink: 0 }}>{c.code ? `#${c.code}` : ''}</span>
    </div>
    <div style={{ fontSize: '12px', color: '#374151', marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {c.phone && <span>📞 {c.phone}</span>}
      {c.address && <span>📍 {c.address}</span>}
      {c.salesStaffName && <span style={{ color: '#10b981', fontWeight: 'bold' }}>💼 영업: {c.salesStaffName}</span>}
      {c.staffName && <span>👤 담당: {c.staffName}</span>}
      <span style={{ fontWeight: 'bold', color: badgeColor }}>
        💰 {getPrice(c).toLocaleString()}원
      </span>
      {extra}
    </div>
  </div>
);

// 누락 카드 — missingReason 배지 표시
const MissingCard = ({ c }) => {
  const reason = c.missingReason || { label: '사유 미상', color: '#6b7280', bg: '#f3f4f6' };
  const borderColor = c.isCancelledMissing ? '#dc2626' : '#ef4444';
  const cardBg = c.isCancelledMissing ? '#fef2f2' : reason.bg;

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${c.isCancelledMissing ? '#fecaca' : '#fca5a5'}`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: '10px', padding: '12px 14px', marginBottom: '8px',
      opacity: c.isCancelledMissing ? 0.75 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* 누락 사유 배지 */}
          <span style={{
            background: reason.color, color: 'white',
            fontSize: '10px', fontWeight: 'bold', padding: '2px 7px', borderRadius: '20px',
            whiteSpace: 'nowrap',
          }}>
            {reason.label}
          </span>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: c.isCancelledMissing ? '#7f1d1d' : '#1e293b' }}>
            {c.name || c.custName}
          </span>
        </div>
        <span style={{ fontSize: '11px', color: '#6b7280', flexShrink: 0 }}>{c.code ? `#${c.code}` : ''}</span>
      </div>
      <div style={{ fontSize: '12px', color: '#374151', marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {c.phone && <span>📞 {c.phone}</span>}
        {c.address && <span>📍 {c.address}</span>}
        {c.staffName && !reason.label.includes('담당') && <span>👤 담당: {c.staffName}</span>}
        <span style={{ fontWeight: 'bold', color: reason.color }}>
          💰 {getPrice(c).toLocaleString()}원
        </span>
      </div>
    </div>
  );
};

function CalendarNewCustomersTab({ newOnes, returnOnes, missingOnes, thisMonthStr, newCustomerSubTab, setNewCustomerSubTab }) {
  const [yr, mo] = thisMonthStr.split('-');

  // 누락 사유별 통계
  const urgentCount = missingOnes.filter(c => c.isUrgent).length;
  const cancelledCount = missingOnes.filter(c => c.isCancelledMissing).length;
  const otherCount = missingOnes.length - urgentCount - cancelledCount;

  return (
    <div>
      <div style={{ background: 'white', borderRadius: '12px', padding: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#92400e', marginBottom: '12px' }}>
          🔔 {yr}년 {parseInt(mo)}월 변동 현황
        </div>

        {/* 서브탭 */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setNewCustomerSubTab('new')}
            style={{
              flex: 1, padding: '9px 6px', border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '12px',
              background: newCustomerSubTab === 'new' ? '#10b981' : '#f1f5f9',
              color: newCustomerSubTab === 'new' ? 'white' : '#374151',
            }}
          >
            🆕 신규 ({newOnes.length})
          </button>
          <button
            onClick={() => setNewCustomerSubTab('return')}
            style={{
              flex: 1, padding: '9px 6px', border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '12px',
              background: newCustomerSubTab === 'return' ? '#8b5cf6' : '#f1f5f9',
              color: newCustomerSubTab === 'return' ? 'white' : '#374151',
            }}
          >
            🔄 복귀 ({returnOnes.length})
          </button>
          <button
            onClick={() => setNewCustomerSubTab('missing')}
            style={{
              flex: 1, padding: '9px 6px', border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '12px', position: 'relative',
              background: newCustomerSubTab === 'missing' ? '#ef4444' : '#f1f5f9',
              color: newCustomerSubTab === 'missing' ? 'white' : '#374151',
            }}
          >
            ⚠️ 누락 ({missingOnes.length})
            {missingOnes.length > 0 && newCustomerSubTab !== 'missing' && (
              <span style={{
                position: 'absolute', top: '-4px', right: '-4px',
                background: '#ef4444', color: 'white', borderRadius: '50%',
                width: '16px', height: '16px', fontSize: '9px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold',
              }}>{missingOnes.length > 9 ? '9+' : missingOnes.length}</span>
            )}
          </button>
        </div>

        {/* 신규고객 리스트 */}
        {newCustomerSubTab === 'new' && (
          <div>
            {newOnes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af', fontSize: '13px' }}>
                이번달 신규 계약 고객이 없습니다.
              </div>
            ) : newOnes.map(c => (
              <CustomerCard key={c.id} c={c}
                badgeLabel="신규" badgeColor="#10b981"
                nameColor="#065f46" cardBg="#f0fdf4" cardBorder="#bbf7d0" borderColor="#10b981"
                extra={c.createdAt && <span style={{ color: '#9ca3af' }}>📅 {c.createdAt.substring(0, 10)}</span>}
              />
            ))}
          </div>
        )}

        {/* 복귀고객 리스트 */}
        {newCustomerSubTab === 'return' && (
          <div>
            {returnOnes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af', fontSize: '13px' }}>
                이번달 복귀 고객이 없습니다.
              </div>
            ) : returnOnes.map(c => (
              <CustomerCard key={c.id} c={c}
                badgeLabel="복귀" badgeColor="#8b5cf6"
                nameColor="#4c1d95" cardBg="#faf5ff" cardBorder="#e9d5ff" borderColor="#8b5cf6"
              />
            ))}
          </div>
        )}

        {/* 누락고객 리스트 */}
        {newCustomerSubTab === 'missing' && (
          <div>
            {missingOnes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#9ca3af', fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>✅</div>
                누락된 고객이 없습니다!
              </div>
            ) : (
              <>
                {/* 사유별 요약 */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  {urgentCount > 0 && (
                    <div style={{ flex: 1, minWidth: '80px', padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#ef4444' }}>{urgentCount}</div>
                      <div style={{ fontSize: '10px', color: '#dc2626' }}>배정 필요</div>
                    </div>
                  )}
                  {otherCount > 0 && (
                    <div style={{ flex: 1, minWidth: '80px', padding: '8px 10px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#6b7280' }}>{otherCount}</div>
                      <div style={{ fontSize: '10px', color: '#6b7280' }}>계획 없음/기타</div>
                    </div>
                  )}
                  {cancelledCount > 0 && (
                    <div style={{ flex: 1, minWidth: '80px', padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#dc2626' }}>{cancelledCount}</div>
                      <div style={{ fontSize: '10px', color: '#dc2626' }}>해약</div>
                    </div>
                  )}
                </div>

                {/* 배정 필요 (요주의) 먼저 */}
                {missingOnes.filter(c => c.isUrgent).length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#ef4444', marginBottom: '6px', paddingLeft: '2px' }}>
                      🔴 배정 필요
                    </div>
                    {missingOnes.filter(c => c.isUrgent).map(c => (
                      <MissingCard key={c.id} c={c} />
                    ))}
                  </div>
                )}

                {/* 작업계획 없음 / 동절기 / 기타 */}
                {missingOnes.filter(c => !c.isUrgent && !c.isCancelledMissing).length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#6b7280', marginBottom: '6px', paddingLeft: '2px' }}>
                      🟡 계획 없음 / 기타
                    </div>
                    {missingOnes.filter(c => !c.isUrgent && !c.isCancelledMissing).map(c => (
                      <MissingCard key={c.id} c={c} />
                    ))}
                  </div>
                )}

                {/* 해약 고객 */}
                {missingOnes.filter(c => c.isCancelledMissing).length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#dc2626', marginBottom: '6px', paddingLeft: '2px' }}>
                      ⚫ 해약
                    </div>
                    {missingOnes.filter(c => c.isCancelledMissing).map(c => (
                      <MissingCard key={c.id} c={c} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CalendarNewCustomersTab;
