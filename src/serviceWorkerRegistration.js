// PWA 서비스워커 등록
// Create React App 표준 방식

const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
  window.location.hostname === '[::1]' ||
  window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

export function register(config) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = `${process.env.PUBLIC_URL}/firebase-messaging-sw.js`;

      if (isLocalhost) {
        checkValidServiceWorker(swUrl, config);
        navigator.serviceWorker.ready.then(() => {
          console.log('로컬호스트: 서비스워커 활성화됨');
        });
      } else {
        registerValidSW(swUrl, config);
      }
    });
  }
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then(registration => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('새 버전 사용 가능');
              if (config && config.onUpdate) config.onUpdate(registration);
            } else {
              console.log('오프라인 캐시 완료');
              if (config && config.onSuccess) config.onSuccess(registration);
            }
          }
        };
      };
    })
    .catch(error => {
      console.error('서비스워커 등록 오류:', error);
    });
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then(response => {
      const contentType = response.headers.get('content-type');
      if (response.status === 404 || (contentType && !contentType.includes('javascript'))) {
        navigator.serviceWorker.ready.then(registration => {
          registration.unregister().then(() => window.location.reload());
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      console.log('오프라인 상태 - 캐시된 앱 실행 중');
    });
}

export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(registration => registration.unregister())
      .catch(error => console.error(error.message));
  }
}
