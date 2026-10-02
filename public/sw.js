/* Niveda service worker
 * - Lets the website be installed as an app and open without a connection.
 * - Shows medicine reminders pushed by the server (live mode), even when Niveda is
 *   closed, with a "Taken" button that works without opening the app.
 * Health data is never cached here: it comes from the backend on another origin.
 */
const CACHE = 'niveda-shell-v1';
const scope = self.registration.scope; // e.g. https://user.github.io/niveda/

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon-192.png'])).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !req.url.startsWith(scope)) return;
  if (req.mode === 'navigate') {
    // Network first, so a new version shows up straight away; the last copy when offline.
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('./', copy)).catch(() => undefined);
      return res;
    }).catch(async () => (await caches.match('./')) || Response.error()));
    return;
  }
  // Built files have content hashes in their names, so a cached copy is always right.
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.pathname.includes('/assets/') || /\.(png|webmanifest)$/.test(url.pathname))) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
    }
    return res;
  })());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Niveda', {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    requireInteraction: true,
    icon: new URL('icon-192.png', scope).href,
    badge: new URL('icon-192.png', scope).href,
    data: { url: d.url || '', taken: d.taken },
    actions: d.taken ? [{ action: 'taken', title: 'Taken' }, { action: 'open', title: 'Open' }] : [],
  }));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const { url, taken } = n.data || {};
  n.close();
  if (event.action === 'taken' && taken && taken.token) {
    event.waitUntil(fetch(taken.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: taken.key, Authorization: `Bearer ${taken.key}` },
      body: JSON.stringify({ p_token: taken.token }),
    }).then((res) => self.registration.showNotification(res.ok ? 'Marked as taken' : 'Couldn’t mark the dose', {
      body: res.ok ? n.body : 'Open Niveda to mark it.', tag: n.tag, silent: true,
      icon: new URL('icon-192.png', scope).href,
    })).catch(() => undefined));
    return;
  }
  const target = new URL(url || '', scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(scope) && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(target).catch(() => undefined);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
