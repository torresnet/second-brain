const CACHE_NAME = 'second-brain-v3';
const SHARED_CACHE = 'share-target-files';
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
        keys.filter((key) => key.startsWith('second-brain-') && key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Compartilhar do celular (POST): guarda o arquivo recebido e abre o app com os demais campos
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const params = new URLSearchParams();
      try {
        const form = await event.request.formData();
        ['url', 'title', 'text'].forEach((key) => {
          const value = form.get(key);
          if (typeof value === 'string' && value) params.set('shared_' + key, value);
        });
        const file = form.get('media');
        if (file && typeof file !== 'string' && file.size > 0) {
          const cache = await caches.open(SHARED_CACHE);
          await cache.put('/shared-file', new Response(file, {
            headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'arquivo') }
          }));
          params.set('shared_file', '1');
        }
      } catch (err) {
        // Sem dados legíveis: abre o app normalmente
      }
      return Response.redirect('/?' + params.toString(), 303);
    })());
    return;
  }

  // Redireciona o share-target (GET) para a página inicial com query parameters
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
