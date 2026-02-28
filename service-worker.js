// ===========================================
// service-worker.js — ShiftSaaS
// ===========================================

// ── FCM Background Messaging (must be at top) ──
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyDQ101ga04UwKYUALbNOJy8LeeF7EFEOIs",
  authDomain:        "shift-saas.firebaseapp.com",
  databaseURL:       "https://shift-saas-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "shift-saas",
  storageBucket:     "shift-saas.firebasestorage.app",
  messagingSenderId: "957350830489",
  appId:             "1:957350830489:web:fe458f5333fa93c5ce7308"
});

const messaging = firebase.messaging();

// הודעת פוש כשהאפליקציה סגורה
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'ShiftSaaS';
  const body  = payload.notification?.body  || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'he'
  });
});

// ── Cache Management ────────────────────────
const CACHE_NAME = 'shift-saas-v3';
const CACHE_URLS = [
  './',
  './index.html',
  './setup.html',
  './manager.html',
  './employee.html',
  './staffing.html',
  './style.css',
  './manifest.json',
  './js/firebase.js',
  './js/setup.js',
  './js/manager.js',
  './js/employee.js',
  './js/scheduler.js',
  './js/staffing.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(CACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
