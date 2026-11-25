const CACHE = 'aesthetic-analytics-offline-v8';
const MEDIA_CACHE='aesthetic-exercise-media-v1';
const SHELL = ['/analytics/', '/analytics/index.html', '/analytics/style.css', '/analytics/fonts.css', '/analytics/app.js', '/analytics/offline.js', '/analytics/exercise-media.js', '/analytics/exercise-media-data.js', '/analytics/exercise-illustration-data.js', '/analytics/exercise-image-cache.js', '/analytics/food-search.js', '/analytics/icon.svg', '/analytics/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('aesthetic-analytics-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache health, workout, food, auth responses or failed writes.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;
  if(url.pathname.startsWith('/exercise-media/')){
    event.respondWith(caches.open(MEDIA_CACHE).then(async c=>{const hit=await c.match(event.request);if(hit&&!['reload','no-store'].includes(event.request.cache))return hit;try{const r=await fetch(event.request);if(r.ok)await c.put(event.request,r.clone());return r}catch(error){if(hit)return hit;throw error}}));return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && SHELL.includes(url.pathname)) { const copy = response.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(r => r || (event.request.mode === 'navigate' ? caches.match('/analytics/') : Response.error()))));
});
