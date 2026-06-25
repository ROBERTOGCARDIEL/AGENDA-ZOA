const CACHE = 'agendazoa-v4';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['./index.html', './manifest.json']))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

// ── IndexedDB helpers ──────────────────────────────────────────
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open('agendazoaDB', 2);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendientes'))
        db.createObjectStore('pendientes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv'))
        db.createObjectStore('kv');
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

// ── Alarm checker ──────────────────────────────────────────────
async function checkAlarms() {
  const cs = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (cs.length > 0) return;
  const alarms = (await kvGet('alarms')) || [];
  const now = Date.now();
  let changed = false;
  for (const a of alarms) {
    if (!a.fired && a.at <= now) {
      await self.registration.showNotification(a.title, {
        body: a.body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-72.png',
        tag: a.id,
        vibrate: [300, 100, 300, 100, 300],
        data: { pendId: a.pendId }
      });
      a.fired = true;
      changed = true;
    }
  }
  if (changed) await kvSet('alarms', alarms);
}

self.addEventListener('message', e => {
  if (e.data?.type === 'CHECK') checkAlarms();
});
self.addEventListener('periodicsync', e => {
  if (e.tag === 'alarms') e.waitUntil(checkAlarms());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) { cs[0].focus(); return; }
      return clients.openWindow('./');
    })
  );
});
