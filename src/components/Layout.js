import React, { useState } from 'react';

function Layout({ user, children, onLogout, currentPage, onPageChange }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const menuItems = [
    { id: 'calendar', icon: '📅', label: '배정 플랜' },
    { id: 'customers', icon: '👥', label: '고객 관리' },
    { id: 'assignment', icon: '🤵', label: '직원 배정' },
    { id: 'stats', icon: '📊', label: '통계' },
    { id: 'settings', icon: '⚙️', label: '설정' },
  ];

  const handleMenuClick = (pageId) => {
    onPageChange(pageId);
    setSidebarOpen(false);
  };

  return (
    <div style={styles.container}>
      {/* 오버레이 */}
      {sidebarOpen && (
        <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* 사이드바 */}
      <div style={{
        ...styles.sidebar,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)'
      }}>
        <div style={styles.sidebarHeader}>화이트라인 시스템</div>
        {menuItems.map(item => (
          <div
            key={item.id}
            style={{
              ...styles.menuItem,
              backgroundColor: currentPage === item.id ? '#e0e7ff' : 'transparent'
            }}
            onClick={() => handleMenuClick(item.id)}
          >
            {item.icon} {item.label}
          </div>
        ))}
        <div style={{...styles.menuItem, color: 'red', marginTop: '20px'}} onClick={onLogout}>
          🔒 로그아웃
        </div>
      </div>

      {/* 헤더 */}
      <header style={styles.header}>
        <button style={styles.menuBtn} onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
        <h1 style={styles.title}>
          {menuItems.find(m => m.id === currentPage)?.label || '화이트라인'}
        </h1>
        <span style={styles.userEmail}>{user?.email}</span>
      </header>

      {/* 메인 콘텐츠 */}
      <main style={styles.main}>
        {children}
      </main>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f0f2f5'
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 998
  },
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '250px',
    height: '100vh',
    backgroundColor: 'white',
    boxShadow: '2px 0 10px rgba(0,0,0,0.1)',
    zIndex: 999,
    transition: 'transform 0.3s ease'
  },
  sidebarHeader: {
    padding: '20px',
    fontWeight: 'bold',
    fontSize: '18px',
    color: '#2563eb',
    borderBottom: '1px solid #eee'
  },
  menuItem: {
    padding: '15px 20px',
    cursor: 'pointer',
    borderBottom: '1px solid #f0f0f0',
    transition: 'background 0.2s'
  },
  header: {
    backgroundColor: '#2563eb',
    color: 'white',
    padding: '15px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    color: 'white',
    fontSize: '24px',
    cursor: 'pointer'
  },
  title: {
    margin: 0,
    fontSize: '18px',
    flex: 1
  },
  userEmail: {
    fontSize: '12px',
    opacity: 0.9
  },
  main: {
    padding: '20px'
  }
};

export default Layout;