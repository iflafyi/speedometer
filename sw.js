// Offline cache for GPS Спідометр.
// Bump VERSION whenever app files change so phones pick up the new version.
const VERSION = 'v5';
const APP_CACHE = 'speedo-app-' + VERSION;
const CDN_CACHE = 'speedo-cdn';
const TILE_CACHE = 'speedo-tiles';
const MAX_TILES = 600;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './keepawake.mp4'
];
const CDN_FILES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES);
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_FILES.map(u => cdn.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('speedo-app-') && k !== APP_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The page itself: try network first (fresh version), fall back to cache offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(APP_CACHE);
        c.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  // Map tiles: cache what you've already seen so the map works without signal.
  if (/tile|openstreetmap|cartocdn|arcgisonline/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Everything else (app files, fonts, Leaflet): cache first, refresh in the background.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(async res => {
      if (res.ok || res.type === 'opaque') {
        const name = url.origin === location.origin ? APP_CACHE : CDN_CACHE;
        (await caches.open(name)).put(req, res.clone());
      }
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  })());
});
