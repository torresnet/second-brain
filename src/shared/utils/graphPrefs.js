// Preferências do grafo lembradas entre visitas (localStorage, com tolerância a falhas)
import { SIMILARITY_FLOOR, SIMILARITY_MAX, DEFAULT_SIMILARITY } from './graphModel.js';
import { clampZoom } from './graphPhysics.js';

const STORAGE_KEY = 'second-brain.graph.v1';
const MODES = new Set(['graph', 'list']);

export const DEFAULT_PREFS = Object.freeze({
  hubs: true,
  similar: true,
  hideLoose: false,
  useFilters: false,
  minSimilarity: DEFAULT_SIMILARITY,
  mode: 'graph',
  transform: null
});

function sanitizeTransform(value) {
  if (!value || ![value.x, value.y, value.k].every(Number.isFinite)) return null;
  return { x: value.x, y: value.y, k: clampZoom(value.k) };
}

export function sanitizePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const sim = Number(p.minSimilarity);
  return {
    hubs: p.hubs !== false,
    similar: p.similar !== false,
    hideLoose: p.hideLoose === true,
    useFilters: p.useFilters === true,
    minSimilarity: Number.isFinite(sim)
      ? Math.min(SIMILARITY_MAX, Math.max(SIMILARITY_FLOOR, sim))
      : DEFAULT_PREFS.minSimilarity,
    mode: MODES.has(p.mode) ? p.mode : DEFAULT_PREFS.mode,
    transform: sanitizeTransform(p.transform)
  };
}

export function loadGraphPrefs(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizePrefs(null);
  }
}

export function saveGraphPrefs(storage, prefs) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Sem armazenamento (modo privado, cota cheia): o grafo segue funcionando sem lembrar
  }
}
