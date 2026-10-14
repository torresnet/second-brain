import { formatDateBR, getMediaBadge, getStageBadge } from '../shared/utils/formatters.js';

export function createBrainItemCard(item, { onClick, onToggleFavorite }) {
  const badge = getMediaBadge(item.source_type);
  const stage = getStageBadge(item.stage || 'budding');
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.id = item.id;

  const tagsHtml = (item.tags || [])
    .slice(0, 3)
    .map(t => `<span class="tag-item">#${escapeHtml(t)}</span>`)
    .join('');

  const starIcon = item.is_favorite ? '★' : '☆';
  const actionsCount = Array.isArray(item.action_items) ? item.action_items.length : 0;
  const actionsBadgeHtml = actionsCount > 0 
    ? `<span style="font-size: 0.75rem; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.15rem 0.45rem; border-radius: var(--radius-full);" title="${actionsCount} ações práticas extraídas">⚡ ${actionsCount} ações</span>`
    : '';

  card.innerHTML = `
    <div>
      <div class="card-header-row">
        <div style="display: flex; align-items: center; gap: 0.4rem;">
          <span class="source-badge ${badge.cssClass}">
            ${badge.icon} ${badge.label}
          </span>
          <span style="font-size: 0.85rem;" title="${stage.label}">${stage.icon}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button class="fav-btn" title="Favoritar" style="background: none; border: none; font-size: 1.2rem; cursor: pointer; color: ${item.is_favorite ? '#f59e0b' : '#64748b'};">
            ${starIcon}
          </button>
          <span class="card-date">${formatDateBR(item.created_at)}</span>
        </div>
      </div>
      <h3 class="card-title" style="margin-top: 0.75rem;">${escapeHtml(item.title)}</h3>
      <p class="card-summary" style="margin-top: 0.5rem;">${escapeHtml(item.summary || item.raw_content || 'Sem resumo.')}</p>
    </div>
    
    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem;">
      <div class="card-tags" style="align-items: center;">
        ${tagsHtml}
        ${actionsBadgeHtml}
      </div>
      <span style="font-size: 0.8rem; color: var(--accent-cyan); font-weight: 500;">Ver detalhes →</span>
    </div>
  `;

  // Listener para favoritar
  const favBtn = card.querySelector('.fav-btn');
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onToggleFavorite) onToggleFavorite(item);
  });

  // Listener para abrir modal
  card.addEventListener('click', () => {
    if (onClick) onClick(item);
  });

  return card;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
