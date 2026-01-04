const CACHE = 'splittimer-cache-dark-v10';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith((async ()=>{
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, {ignoreSearch:true});
    try{
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    }catch{
      return cached || new Response('Offline', {status:200, headers:{'Content-Type':'text/plain'}});
    }
  })());
});
