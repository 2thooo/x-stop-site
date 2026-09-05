const CACHE = "x-group-passport-v14";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./src/language-boot.js", "./src/app.js", "./src/i18n.js", "./src/api.js", "./src/core.js", "./src/vendor/jsQR.js", "./manifest.webmanifest",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable-512.png", "./assets/apple-touch-icon.png", "./assets/x-group-logo.jpg",
  "./assets/venue-x-entertainment.jpg", "./assets/venue-master-bowling.jpg", "./assets/venue-expert-billiards.jpg",
  "./assets/poppins-400.woff2", "./assets/poppins-600.woff2", "./assets/poppins-700.woff2", "./assets/poppins-800.woff2",
  "./assets/tajawal-arabic-400.woff2", "./assets/tajawal-latin-400.woff2", "./assets/tajawal-arabic-500.woff2", "./assets/tajawal-latin-500.woff2", "./assets/tajawal-arabic-700.woff2", "./assets/tajawal-latin-700.woff2",
  "./assets/activity-icons/laser-tag.svg", "./assets/activity-icons/bowling.svg", "./assets/activity-icons/escape-room.svg", "./assets/activity-icons/billiard.svg", "./assets/activity-icons/gaming.svg", "./assets/activity-icons/others.svg"
];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then(hit => hit || caches.match("./index.html"))));
});
