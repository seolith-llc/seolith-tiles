// public/sw.js
// Seolith Tiles Service Worker (v1.6.0)
// 1. Offline-first caching for WASM physics engine, Three.js bundle, icons, and HTML shell
// 2. Push & Local Notification display + Notification Click deep-link routing (/?daily=1)
// 3. Periodic Background Sync / Reminder checks for Daily Challenge & Streak preservation

const CACHE_NAME = 'seolith-tiles-pwa-v1.6.0';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/wasm/seolith_engine.wasm',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/blog/index.html',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Always network-first for live API endpoints
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Stale-while-revalidate for static assets & WASM binary
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            url.origin === self.location.origin
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Listen for messages from the main thread to trigger immediate or scheduled notifications
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION') {
    const title = data.title || '🎯 Seolith Daily Challenge Ready!';
    const options = {
      body:
        data.body ||
        'Today’s QA-certified micro-tile vault is live. Beat Par Time to claim +3 Free ⚡ x3 Boosts!',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'seolith-daily-reminder',
      renotify: true,
      data: {
        url: data.url || '/?daily=1&ref=PushReminder',
      },
      actions: [
        { action: 'play_daily', title: '🚀 Play Daily Vault' },
        { action: 'dismiss', title: 'Later' },
      ],
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

// Handle Web Push events from edge server
self.addEventListener('push', (event) => {
  let payload = {
    title: '🎯 Seolith Daily Challenge Live!',
    body: 'A new 64x64 micro-tile vault seed is ready. Beat Par Time for +3 ⚡ Boosts!',
    url: '/?daily=1&ref=WebPush',
  };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'seolith-push',
      data: { url: payload.url || '/?daily=1' },
      actions: [
        { action: 'play_daily', title: '🚀 Launch Vault' },
        { action: 'dismiss', title: 'Later' },
      ],
    })
  );
});

// Periodic Background Sync (for browsers supporting periodicSync)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'seolith-daily-challenge-sync') {
    event.waitUntil(
      fetch('/api/daily-challenge')
        .then((r) => r.json())
        .then((data) => {
          const c = data?.challenge;
          if (!c) return;
          return self.registration.showNotification(`🎯 ${c.title}`, {
            body: `Today's vault: ${c.levelName} • Par ${(c.targetTimeMs / 1000).toFixed(1)}s. Tap to play & claim +3 ⚡ Boosts!`,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: `daily-${c.dayKey}`,
            data: { url: '/?daily=1&ref=PeriodicSync' },
          });
        })
        .catch(() => {})
    );
  }
});

// Deep-link into the game or Daily Challenge modal when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/?daily=1';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'OPEN_DAILY_CHALLENGE', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
