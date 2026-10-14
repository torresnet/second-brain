const CACHE_NAME = 'second-brain-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/styles/index.css',
  '/public/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Redireciona o share-target para a página inicial com query parameters
  if (url.pathname === '/share-target') {
    event.respondWith(
      Response.redirect('/?shared_url=' + encodeURIComponent(url.searchParams.get('url') || '') + 
                        '&shared_title=' + encodeURIComponent(url.searchParams.get('title') || '') + 
                        '&shared_text=' + encodeURIComponent(url.searchParams.get('text') || ''), 303)
    );
    return;
  }

  // Política stale-while-revalidate para recursos estáticos locais
  if (event.request.method === 'GET' && url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
          }
          return networkResponse;
        }).catch(() => cachedResponse);
        return cachedResponse || fetchPromise;
      })
    );
  }
});
