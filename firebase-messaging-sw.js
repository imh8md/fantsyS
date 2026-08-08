/* Service Worker لاستقبال إشعارات FCM في الخلفية */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBHJ8WjFEl71NMonIHa7KY6nRXZEves4nM",
  authDomain: "fantsys.firebaseapp.com",
  projectId: "fantsys",
  storageBucket: "fantsys.firebasestorage.app",
  messagingSenderId: "842271960256",
  appId: "1:842271960256:web:6804a82382dc95a07f5125"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'الدوري مع السقيفة', {
    body: d.body || '',
    tag: d.tag || ('saq_' + Date.now()),
    dir: 'rtl',
    lang: 'ar',
    data: { link: d.link || '' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '';
  const base = self.registration.scope;   // نطاق التطبيق الحالي (أي دومين)
  const url = base + (link || '');
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) { try { await c.focus(); if (link) await c.navigate(url); } catch (e) {} return; }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
