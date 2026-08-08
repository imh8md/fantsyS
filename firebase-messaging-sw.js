/* Service Worker لاستقبال إشعارات FCM في الخلفية.
   نرسل الإشعارات بصيغة webpush.notification، فيعرضها المتصفح تلقائياً
   ويتكفّل بفتح الرابط عبر fcm_options.link — بدون معالجات مخصّصة (تفادياً للتكرار). */
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

firebase.messaging();   // يفعّل عرض إشعارات الخلفية تلقائياً

// تفعيل النسخة الجديدة فوراً بدل انتظار إغلاق كل التبويبات
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
