const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'sb:opened';
const DEFAULTS = { limit: 3, minAgeDays: 7, cooldownDays: 21 };

/**
 * Escolhe notas para "Vale rever hoje": salvas há algum tempo e não abertas recentemente.
 * Favoritos primeiro, depois as nunca abertas, depois as abertas há mais tempo.
 * `opened` mapeia id → timestamp (ms) da última abertura.
 */
export function pickForReview(items, opened, now = Date.now(), options = {}) {
  const { limit, minAgeDays, cooldownDays } = { ...DEFAULTS, ...options };

  const candidates = items
    .map((item) => {
      const savedAt = Date.parse(item.created_at);
      const lastOpened = opened[item.id] ?? null;
      return { item, savedAt, lastOpened };
    })
    .filter(({ savedAt, lastOpened }) =>
      Number.isFinite(savedAt)
      && now - savedAt >= minAgeDays * DAY_MS
      && (lastOpened === null || now - lastOpened >= cooldownDays * DAY_MS));

  const rank = (c) => (c.item.is_favorite ? 0 : c.lastOpened === null ? 1 : 2);
  const sorted = [...candidates].sort((a, b) =>
    rank(a) - rank(b) || (a.lastOpened ?? a.savedAt) - (b.lastOpened ?? b.savedAt));

  return sorted.slice(0, limit).map((c) => ({ item: c.item, reason: reasonFor(c, now) }));
}

function reasonFor({ item, savedAt, lastOpened }, now) {
  const days = (ts) => Math.floor((now - ts) / DAY_MS);
  if (lastOpened !== null) return `Aberto pela última vez há ${days(lastOpened)} dias`;
  if (item.is_favorite) return `Favorito salvo há ${days(savedAt)} dias e nunca aberto`;
  return `Salvo há ${days(savedAt)} dias e nunca aberto`;
}

/**
 * Lembra neste aparelho quando cada nota foi aberta. Falhas de armazenamento
 * (modo privado, cota cheia) não quebram o app: o estado fica só na memória.
 */
export function createOpenedTracker(storage, clock = Date.now) {
  let cache = read();

  function read() {
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function markOpened(id) {
    cache = { ...cache, [id]: clock() };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // armazenamento indisponível: mantém só em memória
    }
  }

  return { getAll: () => ({ ...cache }), markOpened };
}
