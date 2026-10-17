import { escapeHtml } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';

const STATUS_ICON = {
  processing: '<span class="toast-spinner" aria-hidden="true"></span>',
  done: icon('check'),
  warning: icon('alert'),
  error: icon('alert'),
  attention: icon('bell'),
  skipped: icon('info')
};

const AUTO_DISMISS_MS = { done: 4000, skipped: 4000, warning: 9000, attention: 9000 };

/**
 * Avisos temporários no canto da tela: "processando…" e o resultado de cada captura.
 * Erros ficam até o usuário fechar.
 */
export function createCaptureToasts(queue) {
  const tray = document.createElement('div');
  tray.className = 'toast-tray';
  tray.setAttribute('role', 'status');
  tray.setAttribute('aria-live', 'polite');
  document.body.appendChild(tray);

  const timers = new Map();

  function scheduleDismiss(job) {
    const delay = AUTO_DISMISS_MS[job.status];
    if (!delay || timers.has(job.id)) return;
    timers.set(job.id, setTimeout(() => {
      timers.delete(job.id);
      queue.dismissJob(job.id);
    }, delay));
  }

  function render({ jobs }) {
    tray.innerHTML = jobs.map((job) => `
      <div class="toast toast-${job.status}" data-job="${escapeHtml(job.id)}">
        <span class="toast-icon">${STATUS_ICON[job.status] || ''}</span>
        <div class="toast-text">
          <strong>${escapeHtml(job.label)}</strong>
          <span>${escapeHtml(job.status === 'processing' ? 'Processando em segundo plano…' : job.message)}</span>
        </div>
        ${job.status === 'processing' ? '' : `<button type="button" class="toast-close" data-close aria-label="Fechar aviso">${icon('close')}</button>`}
      </div>`).join('');
    jobs.forEach(scheduleDismiss);
  }

  tray.addEventListener('click', (e) => {
    const toast = e.target.closest('[data-job]');
    if (toast && e.target.closest('[data-close]')) queue.dismissJob(toast.dataset.job);
  });

  queue.subscribe(render);
  render(queue.getSnapshot());
}
