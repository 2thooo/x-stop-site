const CACHE = "x-entertainment-loyalty-v5";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./src/app.js", "./src/api.js", "./src/core.js", "./src/vendor/jsQR.js", "./manifest.webmanifest",
  "./assets/icon.svg", "./assets/icon-maskable.svg", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png", "./assets/x-entertainment-logo.jpg",
  "./assets/poppins-400.woff2", "./assets/poppins-600.woff2", "./assets/poppins-700.woff2", "./assets/poppins-800.woff2",
  "./assets/activity-icons/laser-tag.svg", "./assets/activity-icons/bowling.svg", "./assets/activity-icons/billiard.svg", "./assets/activity-icons/pc.svg", "./assets/activity-icons/playstation.svg"
];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then(hit => hit || caches.match("./index.html"))));
});
