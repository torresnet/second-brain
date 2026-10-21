// Capturas em andamento guardadas no IndexedDB (aceita arquivos e áudios): sobrevivem a recarregar a página.
const DB_NAME = 'second-brain-pending';
const STORE = 'captures';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function createPendingStore() {
  if (typeof indexedDB === 'undefined') return null;
  return {
    save: (record) => withStore('readwrite', (store) => store.put(record)),
    remove: (key) => withStore('readwrite', (store) => store.delete(key)),
    all: async () => (await withStore('readonly', (store) => store.getAll())) || []
  };
}
