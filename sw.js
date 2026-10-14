/* ==========================================================================
   Nexus – Service Worker
   --------------------------------------------------------------------------
   * Offline: App-Shell cachen, HTML und sw.js selbst network-first
   * System-Benachrichtigungen, wenn die Seite eine Nachricht meldet
   * App-Badge für ungelesene Hinweise
   * Klick auf eine Benachrichtigung fokussiert das Fenster und öffnet
     den Raum bzw. die Direktnachricht
   ========================================================================== */

'use strict';

const CACHE = 'nexus-b2-v1';

const SHELL = [
  './',
  './index.html',
  './games.js',
  './qr.js',
  './manifest.json',
  './vendor/mqtt.min.js',
  './vendor/qrcode.js',
  './assets/cover.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/badge-72.png',
  './icons/favicon-32.png',
  './icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  const fresh = path === '/' || path.endsWith('/') || path.endsWith('.html') || path.endsWith('/sw.js');
  event.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  const copy = res.clone();
  caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
  return res;
}

/* ------------------------------------------------------- Badge + Hinweis -- */

let badgeCount = 0;

function setBadge(count) {
  badgeCount = Math.max(0, Number(count) || 0);
  const nav = self.navigator;
  if (!nav) return Promise.resolve();
  try {
    if (badgeCount > 0 && typeof nav.setAppBadge === 'function') return nav.setAppBadge(badgeCount);
    if (badgeCount === 0 && typeof nav.clearAppBadge === 'function') return nav.clearAppBadge();
  } catch (err) { /* ältere Browser */ }
  return Promise.resolve();
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    const title = String(data.title || 'Nexus');
    const body = String(data.body || '');
    const tag = data.room ? `room:${data.room}` : (data.user ? `dm:${data.user}` : 'nexus');
    const show = self.registration && typeof self.registration.showNotification === 'function'
      ? self.registration.showNotification(title, {
          body,
          icon: 'icons/icon-192.png',
          badge: 'icons/badge-72.png',
          tag,
          renotify: true,
          data: { room: data.room || null, user: data.user || null },
        })
      : Promise.resolve();
    event.waitUntil(show.then(() => setBadge(badgeCount + 1)));
    return;
  }
  if (data.type === 'badge' || data.type === 'badge-clear') {
    const next = data.type === 'badge-clear' ? 0 : data.count;
    event.waitUntil(setBadge(next));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = all.find((entry) => entry.url && entry.url.indexOf(self.registration.scope) === 0) || all[0];
    if (client) {
      if (typeof client.focus === 'function') await client.focus();
      client.postMessage({
        type: data.room ? 'open-room' : 'open-dm',
        room: data.room || null,
        user: data.user || null,
      });
    } else if (self.clients.openWindow) {
      const target = data.room
        ? `./index.html?room=${encodeURIComponent(data.room)}`
        : './index.html';
      await self.clients.openWindow(target);
    }
    await setBadge(0);
  })());
});
