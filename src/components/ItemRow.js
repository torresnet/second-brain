import { getMediaBadge } from '../shared/utils/formatters.js';
import { formatRelativeBR } from '../shared/utils/time.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';

const STATUS_CHIPS = {
  pending: { label: 'aguardando indexação', cssClass: 'meta-warn' },
  processing: { label: 'indexando…', cssClass: 'meta-warn' },
  failed: { label: 'falha na indexação', cssClass: 'meta-danger' }
};

/**
 * Linha da lista do acervo: ícone do tipo, título, metadados e favorito.
 */
export function createItemRow(item, { onSelect, onToggleFavorite, isSelected = false }) {
  const badge = getMediaBadge(item.source_type);
  const status = STATUS_CHIPS[item.analysis_status];
  const tags = (item.tags || []).slice(0, 2).map(t => `<span>#${escapeHtml(t)}</span>`).join('');

  const row = document.createElement('div');
  row.className = `item-row${isSelected ? ' selected' : ''}${item.is_favorite ? ' is-fav' : ''}`;
  row.dataset.id = item.id;
  row.setAttribute('role', 'listitem');
  row.tabIndex = 0;

  row.innerHTML = `
    <span class="type-glyph ${badge.cssClass}" title="${escapeHtml(badge.label)}">${badge.icon}</span>
    <div class="row-text">
      <h3 class="row-title">${escapeHtml(item.title || 'Sem título')}</h3>
      <p class="row-summary">${escapeHtml(item.summary || item.raw_content || 'Sem resumo.')}</p>
      <div class="row-meta">
        <span>${escapeHtml(badge.label)}</span>
        <span>${escapeHtml(formatRelativeBR(item.created_at))}</span>
        ${status ? `<span class="${status.cssClass}">${status.label}</span>` : ''}
        ${tags}
      </div>
    </div>
    <button type="button" class="fav-btn" aria-pressed="${item.is_favorite ? 'true' : 'false'}"
            aria-label="${item.is_favorite ? 'Remover dos favoritos' : 'Favoritar'}">${icon('star')}</button>
  `;

  row.querySelector('.fav-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (onToggleFavorite) onToggleFavorite(item);
  });
  row.addEventListener('click', () => onSelect && onSelect(item));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === row && onSelect) onSelect(item);
  });

  return row;
}

export function skeletonRowsHtml(count = 6) {
  return Array.from({ length: count }, () => `
    <div class="item-row skeleton" aria-hidden="true">
      <span class="type-glyph"></span>
      <div class="row-text"><span class="sk-line w70"></span><span class="sk-line w90"></span><span class="sk-line w40"></span></div>
    </div>`).join('');
}
