// Daily Joy service worker: caches the app so it opens with no internet.
// Bump VERSION whenever you change a file so phones pick up the new copy.
var VERSION = 'dailyjoy-v25';
// Push server address. Must match PUSH_SERVER in app.js. Leave '' until the Worker is deployed.
var PUSH_SERVER = 'https://dailyjoy-push.asser1811.workers.dev';
var FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
             'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Alerts while the app is closed. The server sends an empty "ping"; we then ask it which reminders are due.
// Safari requires every push to show a notification, so we always show one.
self.addEventListener('push', function (e) {
  e.waitUntil(
    self.registration.pushManager.getSubscription().then(function (sub) {
      if (!sub || !PUSH_SERVER) return [];
      return fetch(PUSH_SERVER + '/due', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).then(function (r) { return r.json(); }).then(function (d) { return d.items || []; })
        .catch(function () { return []; });
    }).then(function (items) {
      if (!items.length) {
        return self.registration.showNotification('Daily Joy', { body: 'You have a task due.', tag: 'dailyjoy-due', icon: 'icons/icon-192.png' });
      }
      return Promise.all(items.map(function (it) {
        return self.registration.showNotification(it.time ? it.time + '  ' + it.title : it.title, {
          body: 'Daily Joy reminder', tag: 'dailyjoy-' + it.title, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png'
        });
      }));
    })
  );
});

// Tapping a notification opens the app (or brings the open window to the front).
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
      return self.clients.openWindow('./');
    })
  );
});

// Network first (so updates show up), falling back to the cache when offline.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // reminder.ics?d=<calendar text>: serve it as a real calendar file so iPhone Safari offers "Add to Calendar".
  var u = new URL(e.request.url);
  if (/\/reminder\.ics$/.test(u.pathname) && u.searchParams.get('d')) {
    e.respondWith(new Response(u.searchParams.get('d'), { headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="reminder.ics"',
      'Cache-Control': 'no-store'
    } }));
    return;
  }
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
    })
  );
});
