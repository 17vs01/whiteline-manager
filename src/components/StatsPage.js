import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import Swal from 'sweetalert2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function StatsPage({ currentUser, staffList }) {
  const [activeTab, setActiveTab] = useState('monthly');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [monthlyData, setMonthlyData] = useState(null);
  const [staffData, setStaffData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (activeTab === 'monthly') {
      loadMonthlyStats();
    } else {
      loadStaffPerformance();
    }
  }, [activeTab, year, month]);

  const loadMonthlyStats = async () => {
    setLoading(true);
    try {
      const eventSnap = await getDocs(collection(db, 'events'));
      const events = eventSnap.docs.map(doc => doc.data());

      const labels = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
      const assigned = new Array(12).fill(0);
      const completed = new Array(12).fill(0);
      const completedAmount = new Array(12).fill(0);

      events.forEach(e => {
        if (!e.date) return;
        const eventDate = new Date(e.date);
        if (eventDate.getFullYear() !== year) return;
        const m = eventDate.getMonth();
        
        assigned[m]++;
        if (['완료', '야근', '마감완료'].includes(e.status)) {
          completed[m]++;
          completedAmount[m] += parseInt(e.price) || 0;
        }
      });

      setMonthlyData({ labels, assigned, completed, completedAmount });
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  const loadStaffPerformance = async () => {
    setLoading(true);
    try {
      const eventSnap = await getDocs(collection(db, 'events'));
      const events = eventSnap.docs.map(doc => doc.data());

      // 직원별 집계
      const staffStats = {};
      
      events.forEach(e => {
        if (!e.date) return;
        const eventDate = new Date(e.date);
        if (eventDate.getFullYear() !== year || eventDate.getMonth() + 1 !== month) return;

        // 완료자 기준으로 집계
        const completedBy = e.completedBy || e.staffName || '미지정';
        
        if (!staffStats[completedBy]) {
          staffStats[completedBy] = { name: completedBy, assigned: 0, completed: 0, overtime: 0, amount: 0 };
        }
        
        staffStats[completedBy].assigned++;
        
        if (['완료', '야근', '마감완료'].includes(e.status)) {
          staffStats[completedBy].completed++;
          staffStats[completedBy].amount += parseInt(e.price) || 0;
        }
        if (e.status === '야근') {
          staffStats[completedBy].overtime++;
        }
      });

      // 관리자가 아니면 본인 것만
      let result = Object.values(staffStats);
      if (currentUser.role !== 'master') {
        result = result.filter(s => s.name === currentUser.name);
      }

      // 매출 기준 정렬
      result.sort((a, b) => b.amount - a.amount);

      setStaffData(result);
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  // 내일 방문 알림 발송
  const sendTomorrowNotifications = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    try {
      const eventSnap = await getDocs(collection(db, 'events'));
      const tomorrowEvents = eventSnap.docs
        .map(doc => doc.data())
        .filter(e => e.date === tomorrowStr && e.status === '배정');

      if (tomorrowEvents.length === 0) {
        Swal.fire('발송 대상 없음', '내일 예정된 방문이 없습니다', 'info');
        return;
      }

      const result = await Swal.fire({
        title: '📤 내일 방문 알림',
        html: `
          <div style="text-align:left;">
            <div style="margin-bottom:10px;"><b>${tomorrowEvents.length}명</b>에게 발송합니다</div>
            <div style="max-height:150px; overflow-y:auto; font-size:12px; background:#f8fafc; padding:10px; border-radius:8px;">
              ${tomorrowEvents.slice(0, 10).map(e => `<div>• ${e.title}</div>`).join('')}
              ${tomorrowEvents.length > 10 ? `<div>... 외 ${tomorrowEvents.length - 10}명</div>` : ''}
            </div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: '발송',
        confirmButtonColor: '#10b981',
        cancelButtonText: '취소'
      });

      if (result.isConfirmed) {
        // 실제로는 알림톡 API 호출
        Swal.fire('발송 완료', `${tomorrowEvents.length}명에게 알림 발송됨`, 'success');
      }
    } catch (error) {
      Swal.fire('오류', '발송 실패', 'error');
    }
  };

  const chartData = monthlyData ? {
    labels: monthlyData.labels,
    datasets: [
      {
        label: '배정',
        data: monthlyData.assigned,
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
      },
      {
        label: '완료',
        data: monthlyData.completed,
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
      }
    ]
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' }
    },
    scales: {
      y: { beginAtZero: true }
    }
  };

  // 월별 요약
  const totalAssigned = monthlyData ? monthlyData.assigned.reduce((a, b) => a + b, 0) : 0;
  const totalCompleted = monthlyData ? monthlyData.completed.reduce((a, b) => a + b, 0) : 0;
  const totalAmount = monthlyData ? monthlyData.completedAmount.reduce((a, b) => a + b, 0) : 0;
  const completionRate = totalAssigned > 0 ? Math.round(totalCompleted / totalAssigned * 100) : 0;

  // 직원별 요약
  const staffTotalCompleted = staffData.reduce((sum, s) => sum + s.completed, 0);
  const staffTotalOvertime = staffData.reduce((sum, s) => sum + s.overtime, 0);
  const staffTotalAmount = staffData.reduce((sum, s) => sum + s.amount, 0);

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 탭 */}
      <div style={styles.tabRow}>
        <button 
          onClick={() => setActiveTab('monthly')}
          style={{...styles.tabBtn, ...(activeTab === 'monthly' ? styles.tabActive : {})}}
        >
          📊 월별 매출
        </button>
        <button 
          onClick={() => setActiveTab('staff')}
          style={{...styles.tabBtn, ...(activeTab === 'staff' ? styles.tabActive : {})}}
        >
          👥 직원별 실적
        </button>
      </div>

      {/* 월별 매출 탭 */}
      {activeTab === 'monthly' && (
        <div>
          <div style={styles.filterRow}>
            <h3 style={styles.sectionTitle}>📊 월별 매출 통계</h3>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={styles.yearSelect}>
              {[...Array(6)].map((_, i) => {
                const y = new Date().getFullYear() - i;
                return <option key={y} value={y}>{y}년</option>;
              })}
            </select>
          </div>

          {/* 요약 카드 */}
          <div style={styles.summaryRow}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{totalAssigned}</div>
              <div style={styles.summaryLabel}>총 배정</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{...styles.summaryValue, color: '#059669'}}>{totalCompleted}</div>
              <div style={styles.summaryLabel}>총 완료</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{...styles.summaryValue, color: '#3b82f6'}}>{completionRate}%</div>
              <div style={styles.summaryLabel}>완료율</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{...styles.summaryValue, color: '#f59e0b'}}>{totalAmount.toLocaleString()}</div>
              <div style={styles.summaryLabel}>매출(원)</div>
            </div>
          </div>

          {/* 차트 */}
          <div style={styles.chartContainer}>
            {chartData && <Bar data={chartData} options={chartOptions} />}
          </div>
        </div>
      )}

      {/* 직원별 실적 탭 */}
      {activeTab === 'staff' && (
        <div>
          <div style={styles.filterRow}>
            <h3 style={styles.sectionTitle}>👥 직원별 실적</h3>
            <div style={styles.filterGroup}>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={styles.yearSelect}>
                {[...Array(6)].map((_, i) => {
                  const y = new Date().getFullYear() - i;
                  return <option key={y} value={y}>{y}년</option>;
                })}
              </select>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={styles.yearSelect}>
                {[...Array(12)].map((_, i) => (
                  <option key={i+1} value={i+1}>{i+1}월</option>
                ))}
              </select>
            </div>
          </div>

          {/* 요약 카드 */}
          <div style={styles.summaryRow}>
            <div style={styles.summaryCard}>
              <div style={styles.summaryValue}>{staffData.length}</div>
              <div style={styles.summaryLabel}>직원수</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{...styles.summaryValue, color: '#059669'}}>{staffTotalCompleted}</div>
              <div style={styles.summaryLabel}>총 완료</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{...styles.summaryValue, color: '#7e22ce'}}>{staffTotalOvertime}</div>
              <div style={styles.summaryLabel}>총 야근</div>
            </div>
            <div style={styles.summaryCard}>
              <div style={{...styles.summaryValue, color: '#f59e0b'}}>{staffTotalAmount.toLocaleString()}</div>
              <div style={styles.summaryLabel}>총 매출</div>
            </div>
          </div>

          {/* 직원별 카드 */}
          <div style={styles.staffList}>
            {staffData.length === 0 ? (
              <div style={styles.empty}>실적 데이터가 없습니다</div>
            ) : (
              staffData.map((s, idx) => {
                const rank = idx + 1;
                const rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}위`;
                const completionRate = s.assigned > 0 ? Math.round(s.completed / s.assigned * 100) : 0;

                return (
                  <div key={s.name} style={styles.staffCard}>
                    <div style={styles.staffCardHeader}>
                      <div style={styles.staffRank}>
                        <span style={styles.rankBadge}>{rankBadge}</span>
                        <span style={styles.staffName}>{s.name}</span>
                      </div>
                      <div style={styles.staffAmount}>{s.amount.toLocaleString()}원</div>
                    </div>
                    <div style={styles.staffStats}>
                      <div style={styles.staffStatItem}>
                        <div style={{...styles.staffStatValue, color: '#3b82f6'}}>{s.assigned}</div>
                        <div style={styles.staffStatLabel}>배정</div>
                      </div>
                      <div style={styles.staffStatItem}>
                        <div style={{...styles.staffStatValue, color: '#059669'}}>{s.completed}</div>
                        <div style={styles.staffStatLabel}>완료</div>
                      </div>
                      <div style={styles.staffStatItem}>
                        <div style={{...styles.staffStatValue, color: '#7e22ce'}}>{s.overtime}</div>
                        <div style={styles.staffStatLabel}>야근</div>
                      </div>
                      <div style={styles.staffStatItem}>
                        <div style={styles.staffStatValue}>{completionRate}%</div>
                        <div style={styles.staffStatLabel}>완료율</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 알림톡 섹션 */}
      <div style={styles.notificationSection}>
        <h4 style={styles.notificationTitle}>📱 자동 알림톡</h4>
        <p style={styles.notificationDesc}>내일 방문 예정인 고객에게 알림을 보냅니다.</p>
        <button onClick={sendTomorrowNotifications} style={styles.notificationBtn}>
          📤 내일 방문 알림 발송
        </button>
      </div>
    </div>
  );
}

const styles = {
  loading: { textAlign: 'center', padding: '50px', color: '#666' },
  
  tabRow: { display: 'flex', gap: '10px', marginBottom: '15px', borderBottom: '2px solid #e5e7eb', paddingBottom: '10px' },
  tabBtn: { padding: '10px 20px', backgroundColor: 'transparent', border: 'none', fontSize: '14px', cursor: 'pointer', borderRadius: '5px' },
  tabActive: { backgroundColor: '#3b82f6', color: 'white', fontWeight: 'bold' },
  
  filterRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' },
  sectionTitle: { margin: 0, fontSize: '16px' },
  filterGroup: { display: 'flex', gap: '5px' },
  yearSelect: { padding: '8px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '13px' },
  
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' },
  summaryCard: { backgroundColor: 'white', padding: '15px', borderRadius: '10px', textAlign: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  summaryValue: { fontSize: '20px', fontWeight: 'bold', color: '#374151' },
  summaryLabel: { fontSize: '11px', color: '#666', marginTop: '5px' },
  
  chartContainer: { backgroundColor: 'white', borderRadius: '10px', padding: '15px', height: '250px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', marginBottom: '20px' },
  
  staffList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  staffCard: { backgroundColor: 'white', padding: '15px', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' },
  staffCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  staffRank: { display: 'flex', alignItems: 'center', gap: '8px' },
  rankBadge: { fontSize: '18px' },
  staffName: { fontSize: '16px', fontWeight: 'bold' },
  staffAmount: { fontSize: '18px', fontWeight: 'bold', color: '#059669' },
  staffStats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', textAlign: 'center' },
  staffStatItem: {},
  staffStatValue: { fontSize: '18px', fontWeight: 'bold' },
  staffStatLabel: { fontSize: '11px', color: '#666' },
  
  notificationSection: { marginTop: '20px', padding: '15px', backgroundColor: '#fffbeb', borderRadius: '8px', border: '1px solid #fcd34d' },
  notificationTitle: { margin: '0 0 10px 0', fontSize: '14px' },
  notificationDesc: { fontSize: '12px', color: '#666', margin: '0 0 10px 0' },
  notificationBtn: { width: '100%', padding: '12px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  
  empty: { textAlign: 'center', padding: '30px', color: '#999' }
};

export default StatsPage;
