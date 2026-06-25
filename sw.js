const CACHE = 'agendazoa-v2';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/agendazoa/index.html'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('/agendazoa/index.html')))
  );
});

// ── DB helpers ─────────────────────────────────────────────────
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('agendazoaDB', 2);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendientes')) db.createObjectStore('pendientes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = e => { _db = e.target.result; res(_db); };
    r.onerror = rej;
  });
}
async function kvGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction('kv','readonly').objectStore('kv').get(key);
    r.onsuccess = () => res(r.result); r.onerror = rej;
  });
}
async function kvSet(key, val) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv','readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = res; tx.onerror = rej;
  });
}

// ── Check and fire due alarms ──────────────────────────────────
async function checkAlarms() {
  // If app is open let it handle — SW only fires when app is closed
  const cs = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (cs.length > 0) return;

  const alarms = await kvGet('alarms') || [];
  const now = Date.now();
  let changed = false;

  for (const a of alarms) {
    if (!a.fired && a.at <= now) {
      await self.registration.showNotification(a.title, {
        body: a.body,
        icon: '/agendazoa/icons/icon-192.png',
        badge: '/agendazoa/icons/icon-72.png',
        tag: a.id,
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: false,
        data: { pendId: a.pendId }
      });
      a.fired = true;
      changed = true;
    }
  }
  if (changed) await kvSet('alarms', alarms);
}

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK') checkAlarms();
});

// Periodic background sync — fires even when app is closed (Android Chrome supports this)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'alarms') e.waitUntil(checkAlarms());
});

// Fallback: use push event if periodic sync not supported
self.addEventListener('push', e => { e.waitUntil(checkAlarms()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) { cs[0].focus(); return; }
      return clients.openWindow('/agendazoa/');
    })
  );
});
