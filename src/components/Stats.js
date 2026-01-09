import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function Stats() {
  const [stats, setStats] = useState({
    totalCustomers: 0,
    totalEvents: 0,
    completedEvents: 0,
    totalRevenue: 0
  });
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // 고객 데이터
      const custSnapshot = await getDocs(collection(db, 'customers'));
      const customers = custSnapshot.docs.map(doc => doc.data());
      
      // 일정 데이터
      const eventSnapshot = await getDocs(collection(db, 'events'));
      const events = eventSnapshot.docs.map(doc => doc.data());

      // 통계 계산
      const completed = events.filter(e => e.status === '완료').length;
      const totalRevenue = customers.reduce((sum, c) => sum + (c.price || 0), 0);

      setStats({
        totalCustomers: customers.length,
        totalEvents: events.length,
        completedEvents: completed,
        totalRevenue: totalRevenue
      });

      // 월별 데이터 계산
      const monthly = {};
      events.forEach(event => {
        if (event.date) {
          const month = event.date.substring(0, 7); // YYYY-MM
          if (!monthly[month]) {
            monthly[month] = { total: 0, completed: 0 };
          }
          monthly[month].total++;
          if (event.status === '완료') {
            monthly[month].completed++;
          }
        }
      });

      const sortedMonths = Object.keys(monthly).sort();
      setMonthlyData(sortedMonths.map(month => ({
        month,
        ...monthly[month]
      })));

      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  };

  const chartData = {
    labels: monthlyData.map(d => d.month),
    datasets: [
      {
        label: '전체 배정',
        data: monthlyData.map(d => d.total),
        backgroundColor: '#3b82f6'
      },
      {
        label: '완료',
        data: monthlyData.map(d => d.completed),
        backgroundColor: '#22c55e'
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top'
      }
    }
  };

  if (loading) {
    return <div style={styles.loading}>로딩중...</div>;
  }

  return (
    <div>
      {/* 통계 카드 */}
      <div style={styles.cardGrid}>
        <div style={styles.card}>
          <div style={styles.cardIcon}>👥</div>
          <div style={styles.cardValue}>{stats.totalCustomers}</div>
          <div style={styles.cardLabel}>전체 고객</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardIcon}>📅</div>
          <div style={styles.cardValue}>{stats.totalEvents}</div>
          <div style={styles.cardLabel}>전체 배정</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardIcon}>✅</div>
          <div style={styles.cardValue}>{stats.completedEvents}</div>
          <div style={styles.cardLabel}>완료</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardIcon}>💰</div>
          <div style={styles.cardValue}>{stats.totalRevenue.toLocaleString()}원</div>
          <div style={styles.cardLabel}>총 매출</div>
        </div>
      </div>

      {/* 차트 */}
      <div style={styles.chartContainer}>
        <h3 style={styles.chartTitle}>📊 월별 현황</h3>
        {monthlyData.length > 0 ? (
          <Bar data={chartData} options={chartOptions} />
        ) : (
          <div style={styles.noData}>데이터가 없습니다</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '15px',
    marginBottom: '20px'
  },
  card: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '10px',
    textAlign: 'center',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
  },
  cardIcon: {
    fontSize: '24px',
    marginBottom: '10px'
  },
  cardValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#2563eb'
  },
  cardLabel: {
    fontSize: '12px',
    color: '#666',
    marginTop: '5px'
  },
  chartContainer: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '10px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
  },
  chartTitle: {
    margin: '0 0 15px 0',
    fontSize: '16px'
  },
  noData: {
    textAlign: 'center',
    padding: '40px',
    color: '#999'
  },
  loading: {
    textAlign: 'center',
    padding: '50px',
    color: '#666'
  }
};

export default Stats;