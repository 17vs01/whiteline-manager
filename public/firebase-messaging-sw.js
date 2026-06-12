// =============================================
// Firebase Cloud Messaging 백그라운드 서비스워커
// 앱이 닫혀 있거나 백그라운드 상태일 때 푸시 알림 수신
// public/firebase-messaging-sw.js 에 배치
// =============================================

// Firebase SDK 버전은 firebase.js와 맞춰야 함 (10.x)
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase 설정 (firebase.js와 동일)
firebase.initializeApp({
  apiKey:            "AIzaSyCeLMJuvDo8f6a3qo_IU9a678pobUma_Uw",
  authDomain:        "customer-pl.firebaseapp.com",
  projectId:         "customer-pl",
  storageBucket:     "customer-pl.firebasestorage.app",
  messagingSenderId: "1051503799392",
  appId:             "1:1051503799392:web:25b8fd7398651ed6de2705",
});

const messaging = firebase.messaging();

// ── 백그라운드 메시지 수신 ────────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] 백그라운드 메시지 수신:', payload);

  const { title, body, icon, data } = payload.notification || {};
  const notifTitle = title || '📅 화이트라인 매니저';
  const notifBody  = body  || '새 알림이 있습니다.';

  const options = {
    body:    notifBody,
    icon:    icon || '/logo192.png',
    badge:   '/logo192.png',
    tag:     data?.eventId || 'schedule-alarm',
    data:    data || {},
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open',    title: '앱 열기' },
      { action: 'dismiss', title: '닫기'   },
    ],
  };

  self.registration.showNotification(notifTitle, options);
});

// ── 알림 클릭 처리 ────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // 앱 열기 또는 포커스
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 탭이 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭 열기
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// ── 서비스워커 설치/활성화 ──────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
