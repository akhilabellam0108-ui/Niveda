/* Niveda service worker: shows medicine reminders pushed by the server, even when the app is closed. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Niveda', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Niveda', {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    requireInteraction: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/', dose: d.data },
    actions: (d.actions || []).filter((a) => a.action === 'taken').concat([{ action: 'open', title: 'Open' }]).slice(0, 2),
  }));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  const { url, dose } = n.data || {};
  if (event.action === 'taken' && dose) {
    event.waitUntil(fetch('/api/medications/doses', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Niveda': '1' },
      body: JSON.stringify({ recordId: dose.recordId, date: dose.date, time: dose.time, status: 'taken' }),
    }).catch(() => undefined));
    return;
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); if (url && 'navigate' in c) c.navigate(url); return; } }
    await self.clients.openWindow(url || '/');
  })());
});
