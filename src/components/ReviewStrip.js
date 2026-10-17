import { getMediaBadge } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';

/**
 * "Vale rever hoje": notas salvas há algum tempo e esquecidas, no topo do acervo.
 * Recebe as sugestões já escolhidas por pickForReview.
 */
export function createReviewStrip(container, { onOpen, onDismiss }) {
  let picks = [];

  function render(nextPicks) {
    picks = nextPicks;
    container.hidden = !picks.length;
    if (!picks.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <div class="review-head">${icon('clock')}Vale rever hoje</div>
      ${picks.map(({ item, reason }) => {
        const badge = getMediaBadge(item.source_type);
        return `
          <div class="review-item" data-id="${escapeHtml(item.id)}">
            <span class="type-glyph mini ${badge.cssClass}">${badge.icon}</span>
            <button type="button" class="review-open" data-act="open">
              <strong>${escapeHtml(item.title || 'Sem título')}</strong>
              <span>${escapeHtml(reason)}</span>
            </button>
            <button type="button" class="chip-btn" data-act="dismiss" title="Some daqui por algumas semanas">Já revi</button>
          </div>`;
      }).join('')}`;
  }

  container.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-id]')?.dataset.id;
    const pick = picks.find((p) => p.item.id === id);
    if (!act || !pick) return;
    if (act === 'open') onOpen(pick.item);
    else onDismiss(pick.item);
  });

  return { render };
}
