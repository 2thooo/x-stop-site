const CACHE_PREFIX = "x-group-passport-";
const CACHE = `${CACHE_PREFIX}v16`;
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./src/language-boot.js", "./src/app.js", "./src/i18n.js", "./src/api.js", "./src/core.js", "./src/vendor/jsQR.js", "./manifest.webmanifest",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable-512.png", "./assets/apple-touch-icon.png", "./assets/x-group-logo.jpg",
  "./assets/venue-x-entertainment.jpg", "./assets/venue-master-bowling.jpg",
  "./assets/poppins-400.woff2", "./assets/poppins-600.woff2", "./assets/poppins-700.woff2", "./assets/poppins-800.woff2",
  "./assets/tajawal-arabic-400.woff2", "./assets/tajawal-latin-400.woff2", "./assets/tajawal-arabic-500.woff2", "./assets/tajawal-latin-500.woff2", "./assets/tajawal-arabic-700.woff2", "./assets/tajawal-latin-700.woff2",
  "./assets/activity-icons/laser-tag.svg", "./assets/activity-icons/bowling.svg", "./assets/activity-icons/escape-room.svg", "./assets/activity-icons/billiard.svg", "./assets/activity-icons/gaming.svg", "./assets/activity-icons/others.svg", "./assets/activity-icons/vr.svg", "./assets/activity-icons/car.svg"
];
const SHELL_PATHS = new Set(SHELL.map(item => new URL(item, self.registration.scope).pathname));
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }
  if (!SHELL_PATHS.has(url.pathname)) return;
  const canonicalUrl = new URL(url.pathname, location.origin).href;
  event.respondWith(caches.match(canonicalUrl).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && response.type === "basic") void caches.open(CACHE).then(cache => cache.put(canonicalUrl, response.clone()));
    return response;
  })));
});
