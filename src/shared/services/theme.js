import { icon } from '../utils/icons.js';

const STORAGE_KEY = 'sb:theme';
const MODES = ['system', 'light', 'dark'];
const LABELS = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' };
const ICONS = { system: 'monitor', light: 'sun', dark: 'moon' };
const THEME_COLORS = { light: '#FBFBFA', dark: '#111216' };

function readMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function saveMode(mode) {
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // armazenamento indisponível: o tema vale só nesta sessão
  }
}

/** Tema efetivo ('light' | 'dark'), já resolvendo o modo automático. */
export function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Botão que alterna entre automático → claro → escuro.
 * Dispara o evento `themechange` na window para quem desenha em canvas (o grafo).
 */
export function setupThemeToggle(button) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = readMode();

  function apply() {
    if (mode === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    button.innerHTML = icon(ICONS[mode]);
    button.setAttribute('aria-label', LABELS[mode]);
    button.title = LABELS[mode];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[currentTheme()]);
    window.dispatchEvent(new Event('themechange'));
  }

  button.addEventListener('click', () => {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    saveMode(mode);
    apply();
  });
  media.addEventListener('change', () => { if (mode === 'system') apply(); });
  apply();
}
