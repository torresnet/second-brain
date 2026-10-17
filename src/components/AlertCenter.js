import { formatDateBR } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';

/**
 * Central de alertas: sino com contador no cabeçalho e painel com as decisões pendentes
 * (hoje: links repetidos — reprocessar e manter, ou ignorar).
 */
export function createAlertCenter(mountPoint, queue, { onOpenItem }) {
  mountPoint.classList.add('alert-center');
  mountPoint.innerHTML = `
    <button type="button" class="alert-bell" aria-haspopup="true" aria-expanded="false" aria-label="Central de alertas">
      🔔<span class="alert-badge" style="display: none;"></span>
    </button>
    <div class="alert-panel" style="display: none;" role="dialog" aria-label="Central de alertas"></div>`;

  const bell = mountPoint.querySelector('.alert-bell');
  const badge = mountPoint.querySelector('.alert-badge');
  const panel = mountPoint.querySelector('.alert-panel');
  let isOpen = false;

  function setOpen(next) {
    isOpen = next;
    panel.style.display = next ? 'block' : 'none';
    bell.setAttribute('aria-expanded', String(next));
  }

  function alertHtml(alert) {
    return `
      <div class="dup-card" data-alert="${escapeHtml(alert.id)}">
        <div class="dup-text">
          <strong>Link já salvo</strong>
          <span class="alert-url">${escapeHtml(alert.url)}</span>
          <span>Existe a nota “${escapeHtml(alert.existing.title || 'Sem título')}” desde ${escapeHtml(formatDateBR(alert.existing.created_at))}.</span>
        </div>
        <div class="dup-actions">
          <button type="button" class="pill-btn" data-act="open">Ver nota existente</button>
          <button type="button" class="pill-btn" data-act="reprocess" title="Processa o link de novo e mantém as duas notas">Reprocessar e manter</button>
          <button type="button" class="pill-btn" data-act="ignore">Ignorar</button>
        </div>
      </div>`;
  }

  function render({ alerts }) {
    badge.style.display = alerts.length ? 'flex' : 'none';
    badge.textContent = String(alerts.length);
    panel.innerHTML = `
      <div class="alert-panel-title">Central de alertas</div>
      ${alerts.length ? alerts.map(alertHtml).join('') : '<p class="alert-empty">Nenhum alerta pendente.</p>'}`;
  }

  panel.addEventListener('click', (e) => {
    const action = e.target.closest('[data-act]')?.dataset.act;
    const alertId = e.target.closest('[data-alert]')?.dataset.alert;
    if (!action || !alertId) return;

    if (action === 'open') {
      const alert = queue.getSnapshot().alerts.find((a) => a.id === alertId);
      if (alert && onOpenItem) {
        setOpen(false);
        onOpenItem(alert.existing.id);
      }
      return;
    }
    queue.resolveAlert(alertId, action);
  });

  bell.addEventListener('click', () => setOpen(!isOpen));
  document.addEventListener('click', (e) => {
    if (isOpen && !mountPoint.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') setOpen(false);
  });

  queue.subscribe(render);
  render(queue.getSnapshot());

  return { open: () => setOpen(true) };
}
