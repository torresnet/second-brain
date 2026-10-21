import { formatDateBR } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { alertTotal, pickAlertTab } from '../shared/utils/duplicatePairs.js';
import { createDuplicatesView } from './DuplicatesView.js';
import { createErrorLogView } from './ErrorLogView.js';
import { getOpenCaptureErrorCount, onCaptureErrorsChange } from '../shared/services/errorLogService.js';

const TABS = [
  ['links', 'Links repetidos', 'Links que você tentou salvar e que já existem no acervo. Decida se reprocessa ou ignora.'],
  ['dups', 'Notas duplicadas', 'Notas com o mesmo link ou conteúdo quase igual, lado a lado. Compare aqui e decida sem abrir cada nota.'],
  ['errors', 'Falhas', 'Tudo o que deu errado ou ficou incompleto na captura de links, vídeos, áudios, imagens e arquivos.']
];
const TAB_ORDER = TABS.map(([id]) => id);

function repeatedLinkHtml(alert) {
  return `
    <div class="dup-card atom-card" data-alert="${escapeHtml(alert.id)}">
      <div class="dup-text">
        <strong>Link já salvo</strong>
        <span class="alert-url">${escapeHtml(alert.url)}</span>
        <span>Existe a nota “${escapeHtml(alert.existing.title || 'Sem título')}” desde ${escapeHtml(formatDateBR(alert.existing.created_at))}.</span>
      </div>
      <div class="dup-actions">
        <button type="button" class="chip-btn" data-act="open">Ver nota existente</button>
        <button type="button" class="chip-btn" data-act="reprocess" title="Processa o link de novo e mantém as duas notas">Reprocessar e manter</button>
        <button type="button" class="chip-btn" data-act="ignore">Ignorar</button>
      </div>
    </div>`;
}

/**
 * Página única de alertas: links repetidos (decisão pendente na captura), notas duplicadas e falhas.
 * onTotalChange recebe a soma das pendências para o sino e o menu.
 */
export function createAlertsView(container, queue, { onOpenItem, onMerge, onTotalChange } = {}) {
  container.innerHTML = `
    <div class="section-heading">
      <h1>Alertas</h1>
      <p class="alerts-lead"></p>
    </div>
    <div class="chip-row scroll alerts-tabs" role="tablist" aria-label="Tipos de alerta"></div>
    <div data-pane="links" role="tabpanel"><div class="knowledge-list alerts-links"></div></div>
    <div data-pane="dups" role="tabpanel"></div>
    <div data-pane="errors" role="tabpanel"></div>`;

  const lead = container.querySelector('.alerts-lead');
  const tabsBox = container.querySelector('.alerts-tabs');
  const linksBox = container.querySelector('.alerts-links');
  const pane = (id) => container.querySelector(`[data-pane="${id}"]`);

  const counts = { links: 0, dups: 0, errors: 0 };
  let activeTab = 'links';

  const duplicates = createDuplicatesView(pane('dups'), {
    onOpenItem,
    onMerge,
    onCount: (n) => setCount('dups', n)
  });
  const errorLog = createErrorLogView(pane('errors'), {
    onOpenItem,
    onChange: refreshErrorCount
  });

  function setCount(key, value) {
    counts[key] = value;
    renderTabs();
    onTotalChange?.(alertTotal(counts));
  }

  function renderTabs() {
    tabsBox.innerHTML = TABS.map(([id, label]) => `
      <button type="button" role="tab" class="chip-btn ${id === activeTab ? 'active' : ''}" aria-selected="${id === activeTab}" data-tab-id="${id}">
        ${escapeHtml(label)}${counts[id] ? `<span class="alerts-tab-count">${counts[id]}</span>` : ''}
      </button>`).join('');
  }

  function renderPanes() {
    TAB_ORDER.forEach((id) => { pane(id).hidden = id !== activeTab; });
    lead.textContent = TABS.find(([id]) => id === activeTab)[2];
  }

  function renderLinks({ alerts }) {
    linksBox.innerHTML = alerts.length
      ? alerts.map(repeatedLinkHtml).join('')
      : '<div class="knowledge-empty">Nenhum link repetido pendente.</div>';
    setCount('links', alerts.length);
  }

  async function refreshErrorCount() {
    setCount('errors', await getOpenCaptureErrorCount());
  }

  function refreshActive() {
    if (activeTab === 'dups') duplicates.refresh();
    if (activeTab === 'errors') errorLog.refresh();
  }

  function selectTab(id) {
    activeTab = id;
    renderTabs();
    renderPanes();
    refreshActive();
  }

  tabsBox.addEventListener('click', (e) => {
    const id = e.target.closest('[data-tab-id]')?.dataset.tabId;
    if (id && id !== activeTab) selectTab(id);
  });

  linksBox.addEventListener('click', (e) => {
    const action = e.target.closest('[data-act]')?.dataset.act;
    const alertId = e.target.closest('[data-alert]')?.dataset.alert;
    if (!action || !alertId) return;
    if (action === 'open') {
      const alert = queue.getSnapshot().alerts.find((a) => a.id === alertId);
      if (alert) onOpenItem?.(alert.existing.id);
      return;
    }
    queue.resolveAlert(alertId, action);
  });

  queue.subscribe(renderLinks);
  onCaptureErrorsChange(() => {
    refreshErrorCount();
    if (activeTab === 'errors') errorLog.refresh();
  });

  renderTabs();
  renderPanes();
  renderLinks(queue.getSnapshot());

  /** Carrega as contagens (duplicatas e falhas) sem exigir que a página esteja aberta. */
  function refreshCounts() {
    refreshErrorCount();
    duplicates.refresh({ quiet: true });
  }

  function show(tab) {
    if (tab && TAB_ORDER.includes(tab)) activeTab = tab;
    renderTabs();
    renderPanes();
    refreshActive();
    if (activeTab !== 'dups') duplicates.refresh({ quiet: true });
    if (activeTab !== 'errors') refreshErrorCount();
  }

  return {
    refreshCounts,
    /** Abre a página na aba em que o usuário estava. */
    show: () => show(),
    /** Abre a página (pelo sino) na primeira aba que tem pendências. */
    showPending: () => show(pickAlertTab(counts, TAB_ORDER, activeTab))
  };
}
