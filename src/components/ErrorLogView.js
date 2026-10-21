import {
  getCaptureErrors,
  setCaptureErrorResolved,
  resolveAllCaptureErrors,
  deleteResolvedCaptureErrors
} from '../shared/services/errorLogService.js';
import { STAGE_LABELS, CATEGORY_LABELS } from '../shared/utils/errorLog.js';
import { copyToClipboard } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { friendlyError } from '../shared/utils/friendlyError.js';
import { skeletonCardsHtml } from '../shared/utils/skeleton.js';

const PAGE_SIZE = 50;

const STATUS_TABS = [
  ['open', 'Pendentes'],
  ['resolved', 'Resolvidas'],
  ['all', 'Todas']
];
const SEVERITY_TABS = [
  ['', 'Erros e avisos'],
  ['error', 'Só erros'],
  ['warning', 'Só avisos']
];

function formatDateTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Texto para colar numa conversa de suporte / pedir ajuda para corrigir. */
export function diagnosticText(entry) {
  return [
    `Falha de captura em ${formatDateTime(entry.created_at)}`,
    `Etapa: ${STAGE_LABELS[entry.stage] ?? entry.stage} | Categoria: ${CATEGORY_LABELS[entry.category] ?? entry.category} | Gravidade: ${entry.severity}`,
    `Tipo de mídia: ${entry.source_type ?? 'n/d'}`,
    `Mensagem: ${entry.message}`,
    `Detalhes: ${JSON.stringify(entry.detail ?? {})}`
  ].join('\n');
}

export function errorCardHtml(entry) {
  const resolved = Boolean(entry.resolved_at);
  const detail = entry.detail && Object.keys(entry.detail).length ? JSON.stringify(entry.detail, null, 2) : '';
  const noteTitle = entry.brain_items?.title;
  return `
    <article class="atom-card errlog-card ${resolved ? 'is-resolved' : ''}" data-error-id="${escapeHtml(entry.id)}">
      <div class="atom-head">
        <span class="atom-chip ${entry.severity === 'error' ? 'errlog-chip-error' : 'atom-chip-warn'}">${entry.severity === 'error' ? 'erro' : 'aviso'}</span>
        <span class="atom-kind">${escapeHtml(STAGE_LABELS[entry.stage] ?? entry.stage)}</span>
        <span class="atom-chip">${escapeHtml(CATEGORY_LABELS[entry.category] ?? entry.category)}</span>
        ${entry.source_type ? `<span class="atom-chip">${escapeHtml(entry.source_type)}</span>` : ''}
        <span class="errlog-date">${escapeHtml(formatDateTime(entry.created_at))}</span>
      </div>
      <p class="errlog-message">${escapeHtml(entry.message)}</p>
      ${noteTitle ? `<button type="button" class="atom-source" data-act="open" data-item-id="${escapeHtml(entry.item_id)}">nota: ${escapeHtml(noteTitle)}</button>` : ''}
      ${detail ? `<details class="errlog-detail"><summary>Detalhes técnicos</summary><pre>${escapeHtml(detail)}</pre></details>` : ''}
      <div class="errlog-actions">
        <button type="button" class="chip-btn" data-act="${resolved ? 'reopen' : 'resolve'}">${resolved ? 'Reabrir' : 'Marcar como resolvida'}</button>
        <button type="button" class="chip-btn" data-act="copy">Copiar diagnóstico</button>
      </div>
    </article>`;
}

export function createErrorLogView(container, { onOpenItem, onChange } = {}) {
  container.innerHTML = `
    <div class="errlog-controls">
      <div class="chip-row scroll" id="errlog-status"></div>
      <div class="chip-row scroll" id="errlog-severity"></div>
      <div class="chip-row scroll" id="errlog-stage"></div>
    </div>
    <div class="errlog-toolbar">
      <button type="button" class="chip-btn" id="errlog-refresh">Atualizar</button>
      <button type="button" class="chip-btn" id="errlog-resolve-all">Marcar todas como resolvidas</button>
      <button type="button" class="chip-btn danger" id="errlog-clear">Apagar resolvidas</button>
    </div>
    <div id="errlog-list" class="knowledge-list"></div>
    <div style="text-align: center; margin-top: 1rem;">
      <button id="errlog-more" class="chip-btn" type="button" style="display: none;">Carregar mais</button>
    </div>`;

  const statusBox = container.querySelector('#errlog-status');
  const severityBox = container.querySelector('#errlog-severity');
  const stageBox = container.querySelector('#errlog-stage');
  const listBox = container.querySelector('#errlog-list');
  const moreBtn = container.querySelector('#errlog-more');

  const state = { status: 'open', severity: '', stage: '', offset: 0, requestId: 0 };
  let entries = [];

  function chipsHtml(options, current, attr) {
    return options
      .map(([value, label]) => `<button type="button" class="chip-btn ${current === value ? 'active' : ''}" data-${attr}="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
      .join('');
  }

  function renderFilters() {
    statusBox.innerHTML = chipsHtml(STATUS_TABS, state.status, 'status');
    severityBox.innerHTML = chipsHtml(SEVERITY_TABS, state.severity, 'severity');
    stageBox.innerHTML = chipsHtml([['', 'Todas as etapas'], ...Object.entries(STAGE_LABELS)], state.stage, 'stage');
  }

  async function load({ reset }) {
    const requestId = ++state.requestId;
    if (reset) {
      state.offset = 0;
      entries = [];
      listBox.innerHTML = skeletonCardsHtml(4);
    }
    try {
      const page = await getCaptureErrors({
        status: state.status, severity: state.severity, stage: state.stage, limit: PAGE_SIZE, offset: state.offset
      });
      if (requestId !== state.requestId) return;
      entries = entries.concat(page);
      state.offset += page.length;
      listBox.innerHTML = entries.length
        ? entries.map(errorCardHtml).join('')
        : `<div class="knowledge-empty">${state.status === 'open' ? 'Nenhuma falha pendente. Tudo certo por aqui.' : 'Nada encontrado com esse filtro.'}</div>`;
      moreBtn.style.display = page.length === PAGE_SIZE ? 'inline-flex' : 'none';
    } catch (err) {
      if (requestId !== state.requestId) return;
      listBox.innerHTML = `<div class="knowledge-empty">Não foi possível carregar o log. ${escapeHtml(friendlyError(err))} Se ainda não aplicou a migration 20261018100000_capture_errors.sql, aplique-a primeiro.</div>`;
      moreBtn.style.display = 'none';
    }
  }

  function reload() {
    renderFilters();
    return load({ reset: true });
  }

  function setFilter(key, value) {
    state[key] = value;
    reload();
  }

  async function mutate(action) {
    try {
      await action();
      onChange?.();
      await reload();
    } catch (err) {
      listBox.insertAdjacentHTML('afterbegin', `<div class="knowledge-empty">${escapeHtml(friendlyError(err))}</div>`);
    }
  }

  container.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.dataset.status !== undefined) return setFilter('status', target.dataset.status);
    if (target.dataset.severity !== undefined) return setFilter('severity', target.dataset.severity);
    if (target.dataset.stage !== undefined) return setFilter('stage', target.dataset.stage);
    if (target.id === 'errlog-refresh') return reload();
    if (target.id === 'errlog-more') return load({ reset: false });
    if (target.id === 'errlog-resolve-all') return mutate(resolveAllCaptureErrors);
    if (target.id === 'errlog-clear') {
      if (window.confirm('Apagar definitivamente todas as falhas já resolvidas?')) mutate(deleteResolvedCaptureErrors);
      return;
    }

    const card = target.closest('[data-error-id]');
    const entry = card && entries.find((it) => it.id === card.dataset.errorId);
    if (!entry) return;
    if (target.dataset.act === 'resolve') mutate(() => setCaptureErrorResolved(entry.id, true));
    if (target.dataset.act === 'reopen') mutate(() => setCaptureErrorResolved(entry.id, false));
    if (target.dataset.act === 'copy') copyToClipboard(diagnosticText(entry));
    if (target.dataset.act === 'open' && entry.item_id) onOpenItem?.(entry.item_id);
  });

  renderFilters();

  return { refresh: reload };
}
