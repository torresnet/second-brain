import { APP_CONFIG } from '../shared/constants/config.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';

const TYPE_ORDER = ['reel', 'tiktok', 'youtube', 'article', 'pdf', 'audio', 'note'];

/**
 * Filtros por tipo e por tema: lista na barra lateral (desktop) e faixa de chips (celular).
 * `onChange({ type, tag })` recebe o novo filtro; os dois são exclusivos entre si.
 */
export function createFeedFilters({ sideTypes, sideTags, mobileTypes }, { onChange }) {
  let current = { type: 'all', tag: '' };

  function typeEntries(stats) {
    const byType = stats.byType || {};
    return [
      { type: 'all', label: 'Todos', icon: 'globe', count: stats.total || 0 },
      ...TYPE_ORDER
        .filter((t) => byType[t])
        .map((t) => ({ type: t, label: APP_CONFIG.mediaTypes[t].label, icon: APP_CONFIG.mediaTypes[t].icon, count: byType[t] }))
    ];
  }

  function render(stats) {
    const types = typeEntries(stats);
    const isTypeActive = (t) => !current.tag && current.type === t;

    sideTypes.innerHTML = types.map((t) => `
      <button type="button" class="side-item${isTypeActive(t.type) ? ' active' : ''}" data-type="${t.type}">
        <span class="type-glyph mini badge-${t.type === 'all' ? 'all' : t.type}">${icon(t.icon)}</span>${escapeHtml(t.label)}<span class="nav-count">${t.count}</span>
      </button>`).join('');

    const tags = stats.topTagCounts || [];
    sideTags.innerHTML = tags.length
      ? tags.map(([tag, count]) => `
        <button type="button" class="side-item${current.tag === tag ? ' active' : ''}" data-tag="${escapeHtml(tag)}">
          ${icon('hash')}<span class="side-item-label">${escapeHtml(tag)}</span><span class="nav-count">${count}</span>
        </button>`).join('')
      : '<p class="side-empty">Os temas aparecem quando suas notas tiverem tags.</p>';

    mobileTypes.innerHTML = types.map((t) => `
      <button type="button" class="chip-btn${isTypeActive(t.type) ? ' active' : ''}" data-type="${t.type}">${escapeHtml(t.label)}</button>`).join('');
  }

  function handleClick(e) {
    const btn = e.target.closest('[data-type],[data-tag]');
    if (!btn) return;
    current = btn.dataset.tag !== undefined
      ? { type: 'all', tag: btn.dataset.tag }
      : { type: btn.dataset.type, tag: '' };
    onChange({ ...current });
  }

  [sideTypes, sideTags, mobileTypes].forEach((el) => el.addEventListener('click', handleClick));

  return {
    render,
    reset() { current = { type: 'all', tag: '' }; },
    get: () => ({ ...current })
  };
}
