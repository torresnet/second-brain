const CACHE_NAME = 'second-brain-v4';
const SHARED_CACHE = 'share-target-files';
const MAX_SHARED_FILE_BYTES = 10 * 1024 * 1024; // mesmo limite do app
const SHARED_FILE_TYPE = /^(application\/pdf|image\/|audio\/|video\/|text\/plain|text\/markdown)/i;
const SHARED_FILE_EXT = /\.(pdf|md|txt|png|jpe?g|webp|heic|heif|mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|3gp)$/i;

function isAcceptedSharedFile(file) {
  return file.size <= MAX_SHARED_FILE_BYTES && (SHARED_FILE_TYPE.test(file.type || '') || SHARED_FILE_EXT.test(file.name || ''));
}
// Os demais arquivos (com hash no nome) entram no cache na primeira visita
const ASSETS = ['/', '/index.html'];

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
        if (file && typeof file !== 'string' && file.size > 0 && isAcceptedSharedFile(file)) {
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

  // O manifest só declara POST: um GET em /share-target viria de link externo, então abre o app sem pré-preencher nada
  if (url.pathname === '/share-target') {
    event.respondWith(Response.redirect('/', 303));
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
