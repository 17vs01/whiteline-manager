import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA 서비스 워커 등록 (앱 설치 가능)
serviceWorkerRegistration.register({
  onUpdate: (registration) => {
    // 새 버전이 있으면 알림
    if (window.confirm('새로운 버전이 있습니다. 업데이트하시겠습니까?')) {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    }
  },
  onSuccess: () => {
    console.log('앱이 오프라인에서도 사용 가능합니다.');
  }
});
