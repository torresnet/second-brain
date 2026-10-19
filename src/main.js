import {
  getBrainItems,
  getBrainStats,
  toggleItemFavorite,
  deleteBrainItem,
  getSession,
  onAuthChange,
  signOut,
  getBrainItemById,
  getItemLinks,
  getPendingIndexCount,
  findDuplicatesByUrl,
  mergeItems,
  processItemKnowledge,
  processPendingItems
} from './shared/services/supabaseClient.js';
import { APP_CONFIG } from './shared/constants/config.js';
import { createLoginScreen } from './components/LoginScreen.js';
import { createItemRow, createPendingRow, skeletonRowsHtml } from './components/ItemRow.js';
import { createItemDetail } from './components/ItemDetail.js';
import { createCaptureModal } from './components/CaptureModal.js';
import { createBrainChat } from './components/BrainChat.js';
import { createGraphView } from './components/GraphView.js';
import { createKnowledgeView } from './components/KnowledgeView.js';
import { createAlertCenter } from './components/AlertCenter.js';
import { createErrorLogView } from './components/ErrorLogView.js';
import { getOpenCaptureErrorCount, onCaptureErrorsChange } from './shared/services/errorLogService.js';
import { createCaptureToasts } from './components/CaptureToasts.js';
import { createCommandPalette } from './components/CommandPalette.js';
import { createFeedFilters } from './components/FeedFilters.js';
import { createReviewStrip } from './components/ReviewStrip.js';
import { takeSharedFile } from './shared/services/captureService.js';
import { parseSharedParams } from './shared/utils/sharedParams.js';
import { createCaptureQueue } from './shared/services/captureQueue.js';
import { executeCapture } from './shared/services/captureExecutor.js';
import { setupThemeToggle } from './shared/services/theme.js';
import { injectIconSprite, icon } from './shared/utils/icons.js';
import { escapeHtml } from './shared/utils/markdown.js';
import { friendlyError } from './shared/utils/friendlyError.js';
import { filterItemsLocally } from './shared/utils/search.js';
import { SIMILARITY_FLOOR, selectNoteLinks } from './shared/utils/graphModel.js';
import { pickForReview, createOpenedTracker } from './shared/utils/review.js';

injectIconSprite();
setupThemeToggle(document.getElementById('theme-toggle-btn'));

// Painel de leitura ao lado da lista só cabe em telas largas; abaixo disso a ficha abre como janela
const WIDE_READER = window.matchMedia('(min-width: 1100px)');
const SEARCH_DEBOUNCE_MS = 250;

// Estado da Aplicação
const state = {
  currentTab: 'feed', // 'feed' | 'knowledge' | 'graph' | 'chat' | 'errors'
  filterType: 'all',
  filterTag: '',
  searchQuery: '',
  items: [],
  stats: { total: 0, favorites: 0, byType: {}, topTags: [], topTagCounts: [] },
  itemLinks: [],
  linksFailed: false,
  graphItems: [],
  selectedId: null
};

// Referências DOM
const $ = (id) => document.getElementById(id);
const sections = {
  feed: $('section-feed'),
  knowledge: $('section-knowledge'),
  graph: $('section-graph'),
  chat: $('section-chat'),
  errors: $('section-errors')
};
const itemsList = $('items-list');
const emptyState = $('empty-state-container');
const searchInput = $('feed-search-input');
const listTitle = $('list-title');
const clearFilterBtn = $('list-clear-filter');
const readerPane = $('reader-pane');
const indexingBanner = $('indexing-banner');
const navCountFeed = $('nav-count-feed');

const openedTracker = createOpenedTracker(safeLocalStorage());

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}

// Ficha da nota (painel de leitura ou janela)
const detail = createItemDetail({
  readerPane,
  onDelete: async (id) => {
    try {
      await deleteBrainItem(id);
      await loadDashboardData({ quiet: true });
    } catch (err) {
      alert('Erro ao excluir item: ' + err.message);
    }
  },
  getRelated: (id) => relatedFor(id),
  onShowConnections: (item) => {
    switchTab('graph');
    graphView.showLocal(item.id);
  },
  onMerge: async (keepId, removeId) => {
    await mergeItems(keepId, removeId);
    detail.close();
    await loadDashboardData({ quiet: true });
    openItemById(keepId);
    // reindexa em segundo plano para os itens extraídos refletirem o conteúdo mesclado
    processItemKnowledge(keepId)
      .catch(() => null)
      .finally(() => { loadDashboardData({ quiet: true }); });
  },
  onOpenRelated: (id) => openItemById(id),
  onReprocess: async (id) => {
    // Roda na fila de segundo plano: o aviso de sucesso/erro aparece mesmo se a ficha for fechada
    const title = state.items.find(i => i.id === id)?.title || 'nota';
    let failure = null;
    await captureQueue.enqueue({
      kind: 'task',
      label: `Reprocessando: ${title}`,
      run: async () => {
        try {
          const result = await processItemKnowledge(id);
          const outcome = result?.results?.[0] ?? result;
          if (outcome?.status === 'not_found') throw new Error('A nota não existe mais.');
          if (outcome?.status === 'busy') throw new Error('Este item já está sendo processado. Aguarde alguns minutos.');
          if (outcome?.status === 'quota') throw new Error(friendlyError(outcome.warnings?.[0]));
          if (outcome?.status === 'failed') {
            throw new Error(friendlyError(outcome.warnings?.[0], 'A indexação falhou. Tente novamente em instantes.'));
          }
          refreshIndexBanner();
          return outcome?.status === 'partial'
            ? { message: 'Indexada parcialmente. Abra a nota e tente de novo.', warning: true }
            : { message: 'Nota reprocessada com sucesso.', warning: false };
        } catch (err) {
          failure = err;
          throw err;
        }
      }
    }).done;
    if (failure) throw failure;
    return getBrainItemById(id);
  },
  onOpened: (item) => {
    openedTracker.markOpened(item.id);
    state.selectedId = item.id;
    markSelectedRow();
  },
  onClosed: () => {
    state.selectedId = null;
    markSelectedRow();
  }
});

function openItem(item) {
  detail.open(item, { inline: state.currentTab === 'feed' && WIDE_READER.matches });
}

async function openItemById(id) {
  const item = await getBrainItemById(id).catch(() => null);
  if (item) openItem(item);
}

// Ao cruzar a largura mínima, a ficha aberta muda de lugar (painel ↔ janela)
WIDE_READER.addEventListener('change', () => {
  detail.reposition(state.currentTab === 'feed' && WIDE_READER.matches);
});

// Capturas rodam em segundo plano: o modal só entrega o pedido e fecha
const captureQueue = createCaptureQueue({
  execute: executeCapture,
  findDuplicates: findDuplicatesByUrl,
  storage: safeLocalStorage(),
  onItemSaved: () => loadDashboardData({ quiet: true })
});

const captureModal = createCaptureModal({
  onSubmit: (spec) => captureQueue.enqueue(spec)
});

createCaptureToasts(captureQueue);

// Link enviado aparece no acervo como "processando" até o item real chegar
captureQueue.subscribe(() => {
  if (state.currentTab === 'feed') renderItemsList();
});
createAlertCenter($('alert-center-mount'), captureQueue, { onOpenItem: openItemById });

window.addEventListener('beforeunload', (e) => {
  if (!captureQueue.hasActive()) return;
  e.preventDefault();
  e.returnValue = '';
});

const chat = createBrainChat($('chat-mount-point'), { onOpenItem: openItem });
const knowledgeView = createKnowledgeView($('knowledge-mount-point'), { onOpenItem: openItem });
const graphView = createGraphView($('graph-mount-point'), {
  onSelectNode: (item) => { if (item) openItem(item); },
  onFilterTag: (tag) => {
    filters.setTag(tag);
    state.filterType = 'all';
    state.filterTag = tag;
    switchTab('feed');
    loadDashboardData();
  },
  onRetryLinks: () => loadDashboardData({ quiet: true })
});

// O grafo recebe o acervo inteiro e, à parte, o que a lista mostra (para a opção "só filtro do Acervo")
function updateGraphView() {
  graphView.update(state.graphItems, state.itemLinks, {
    filteredItems: state.items,
    isFiltered: hasActiveFilter(),
    linksFailed: state.linksFailed
  });
}

const navCountErrors = $('nav-count-errors');
const errorLogView = createErrorLogView($('errors-mount-point'), {
  onOpenItem: openItemById,
  onChange: refreshErrorCount
});

async function refreshErrorCount() {
  const count = await getOpenCaptureErrorCount();
  navCountErrors.textContent = count ? String(count) : '';
  navCountErrors.title = count ? `${count} falha(s) de captura pendente(s)` : '';
}

onCaptureErrorsChange(() => {
  refreshErrorCount();
  if (state.currentTab === 'errors') errorLogView.refresh();
});

// Barra de comando: link captura, pergunta vai para o chat, termo busca no acervo
const palette = createCommandPalette({
  findItems: (text) => filterItemsLocally(state.items, text),
  onCapture: ({ url, hint }) => captureQueue.enqueue({
    kind: 'link',
    label: url.replace(/^https?:\/\//, '').slice(0, 60),
    url,
    hint
  }),
  onOpenCapture: (prefill) => captureModal.open(prefill),
  onAsk: (text) => {
    switchTab('chat');
    chat.ask(text);
  },
  onSearch: (text) => {
    switchTab('feed');
    searchInput.value = text;
    state.searchQuery = text;
    loadDashboardData();
  },
  onOpenItem: (item) => openItem(item)
});

const filters = createFeedFilters({
  sideTypes: $('type-filters'),
  sideTags: $('tag-filters'),
  mobileTypes: $('mobile-type-filters')
}, {
  onChange: ({ type, tag }) => {
    state.filterType = type;
    state.filterTag = tag;
    switchTab('feed');
    loadDashboardData();
  }
});

const reviewStrip = createReviewStrip($('review-strip'), {
  onOpen: (item) => openItem(item),
  onDismiss: (item) => {
    openedTracker.markOpened(item.id);
    renderReview();
  }
});

/**
 * Carrega itens e estatísticas do Supabase. `quiet` evita o esqueleto (recargas em segundo plano).
 */
let loadSeq = 0;

async function loadDashboardData({ quiet = false, isRetry = false } = {}) {
  const seq = ++loadSeq;
  if (!quiet) itemsList.innerHTML = skeletonRowsHtml();

  try {
    // O grafo mostra o acervo inteiro: filtros e busca da lista não podem esvaziá-lo
    const filtered = hasActiveFilter();
    const [items, stats, linksResult, graphItems] = await Promise.all([
      getBrainItems({ type: state.filterType, tag: state.filterTag, search: state.searchQuery }),
      getBrainStats(),
      getItemLinks({ minSimilarity: SIMILARITY_FLOOR }),
      filtered ? getBrainItems() : null
    ]);
    // Uma recarga mais nova (outro filtro ou busca) já foi pedida: descarta esta resposta
    if (seq !== loadSeq) return;

    state.items = items;
    state.graphItems = graphItems ?? items;
    state.stats = stats;
    state.itemLinks = linksResult.links;
    state.linksFailed = linksResult.failed;

    navCountFeed.textContent = String(stats.total || 0);
    filters.render(stats);
    renderListHeader();
    renderItemsList();
    renderReview();
    updateGraphView();
    refreshIndexBanner();
  } catch (err) {
    if (seq !== loadSeq) return;
    // Falha de rede passageira (comum no celular): tenta mais uma vez antes de mostrar o erro
    if (err instanceof TypeError && !isRetry) {
      setTimeout(() => {
        if (seq === loadSeq) loadDashboardData({ quiet, isRetry: true });
      }, 1500);
      return;
    }
    emptyState.hidden = true;
    itemsList.innerHTML = `<div class="list-error">Erro ao carregar dados do Supabase: ${escapeHtml(err.message)}<br><button type="button" class="btn" data-retry-load>Tentar novamente</button></div>`;
    itemsList.querySelector('[data-retry-load]')?.addEventListener('click', () => loadDashboardData());
  }
}

function hasActiveFilter() {
  return state.filterType !== 'all' || Boolean(state.filterTag) || Boolean(state.searchQuery);
}

function renderListHeader() {
  const typeLabel = state.filterType !== 'all' ? APP_CONFIG.mediaTypes[state.filterType]?.label : '';
  listTitle.textContent = state.filterTag ? `#${state.filterTag}` : typeLabel || 'Acervo';
  clearFilterBtn.hidden = !(state.filterType !== 'all' || state.filterTag);
}

function getPendingLinkJobs() {
  if (hasActiveFilter()) return [];
  return captureQueue.getSnapshot().jobs.filter((job) => job.kind === 'link' && job.status === 'processing');
}

function renderItemsList() {
  itemsList.innerHTML = '';
  const pendingJobs = getPendingLinkJobs();
  const isEmpty = state.items.length === 0 && pendingJobs.length === 0;
  emptyState.hidden = !isEmpty;
  if (isEmpty) {
    const filtered = hasActiveFilter();
    emptyState.querySelector('h3').textContent = filtered ? 'Nada encontrado' : 'Nada por aqui ainda';
    emptyState.querySelector('p').textContent = filtered
      ? 'Tente outro termo ou limpe o filtro. Para perguntar em linguagem natural, use Ctrl K.'
      : 'Salve Reels, vídeos do YouTube, PDFs ou grave um áudio. A IA lê, resume e organiza para você.';
    $('empty-state-capture-btn').hidden = filtered;
    return;
  }

  const fragment = document.createDocumentFragment();
  pendingJobs.forEach((job) => fragment.appendChild(createPendingRow(job)));
  state.items.forEach(item => {
    fragment.appendChild(createItemRow(item, {
      isSelected: item.id === state.selectedId,
      onSelect: (selected) => openItem(selected),
      onToggleFavorite: async (selected) => {
        try {
          await toggleItemFavorite(selected.id, selected.is_favorite);
          await loadDashboardData({ quiet: true });
        } catch (err) {
          console.error('Erro ao favoritar:', err);
        }
      }
    }));
  });
  itemsList.appendChild(fragment);
}

function markSelectedRow() {
  itemsList.querySelectorAll('.item-row').forEach(row => {
    row.classList.toggle('selected', row.dataset.id === state.selectedId);
  });
}

function renderReview() {
  // Só no acervo completo: com filtro ou busca, a lista já é o foco
  const picks = hasActiveFilter() ? [] : pickForReview(state.items, openedTracker.getAll());
  reviewStrip.render(picks);
}

/**
 * Notas ligadas a uma nota (nas duas direções), da mais forte para a mais fraca
 */
function relatedFor(id) {
  return selectNoteLinks(state.itemLinks)
    .filter(l => l.source_id === id || l.target_id === id)
    .map(l => {
      const otherIsTarget = l.source_id === id;
      return {
        id: otherIsTarget ? l.target_id : l.source_id,
        title: otherIsTarget ? l.target_title : l.source_title,
        type: l.link_type,
        labels: l.labels || [],
        weight: l.weight
      };
    })
    .sort((a, b) => (a.type === b.type ? b.weight - a.weight : a.type === 'shared' ? -1 : 1));
}

/**
 * Aviso (e ação) para indexar itens antigos que ainda não têm o conhecimento extraído
 */
let isIndexing = false;
let autoIndexPausedUntil = 0;
const AUTO_INDEX_QUOTA_PAUSE_MS = 30 * 60 * 1000;
const AUTO_INDEX_NO_PROGRESS_PAUSE_MS = 5 * 60 * 1000;

async function refreshIndexBanner() {
  if (isIndexing) return;
  const pending = await getPendingIndexCount().catch(() => 0);
  indexingBanner.hidden = !pending;
  if (!pending) return;
  indexingBanner.innerHTML = `
    ${icon('atom')}
    <span><strong>${pending}</strong> ${pending === 1 ? 'nota aguarda' : 'notas aguardam'} a indexação de links, códigos e ferramentas.</span>
    <button id="indexing-run-btn" class="chip-btn" type="button">Indexar agora</button>
    <span id="indexing-progress" class="indexing-progress"></span>
  `;
  indexingBanner.querySelector('#indexing-run-btn').addEventListener('click', runIndexing);
  // Indexação automática; pausa após cota esgotada ou rodada sem progresso para não entrar em laço
  if (Date.now() >= autoIndexPausedUntil) runIndexing();
}

async function runIndexing() {
  if (isIndexing) return;
  isIndexing = true;
  const button = indexingBanner.querySelector('#indexing-run-btn');
  const progress = indexingBanner.querySelector('#indexing-progress');
  button.disabled = true;
  let processed = 0;
  let failures = 0;
  let busyStreak = 0;
  let quotaHit = false;

  try {
    for (let guard = 0; guard < 300; guard++) {
      progress.textContent = processed ? `Indexados: ${processed}…` : 'Indexando… (cada item leva de 10 a 60 segundos)';
      const { results = [], remaining = 0 } = await processPendingItems(1);
      if (!results.length) break;
      if (results.some(r => r.status === 'quota')) {
        quotaHit = true;
        break;
      }
      for (const r of results) {
        if (r.status === 'done' || r.status === 'partial') processed++;
        else if (r.status === 'failed') failures++;
      }
      busyStreak = results.every(r => r.status === 'busy') ? busyStreak + 1 : 0;
      if (busyStreak >= 3 || remaining === 0) break;
    }
    if (quotaHit) autoIndexPausedUntil = Date.now() + AUTO_INDEX_QUOTA_PAUSE_MS;
    else if (!processed) autoIndexPausedUntil = Date.now() + AUTO_INDEX_NO_PROGRESS_PAUSE_MS;
    progress.textContent = quotaHit
      ? `${processed} indexado(s). O limite de uso da IA acabou por agora; tente de novo mais tarde.`
      : failures
      ? `${processed} indexado(s); ${failures} falharam (abra a nota e use "Tentar de novo").`
      : `${processed} item(ns) indexado(s).`;
  } catch (err) {
    autoIndexPausedUntil = Date.now() + AUTO_INDEX_NO_PROGRESS_PAUSE_MS;
    progress.textContent = `Interrompido: ${err.message}`;
  } finally {
    isIndexing = false;
    setTimeout(() => { refreshIndexBanner(); loadDashboardData({ quiet: true }); }, 2500);
  }
}

/**
 * Alternância de seções (barra lateral no desktop, barra inferior no celular)
 */
function switchTab(tab) {
  state.currentTab = tab;
  document.querySelector('.app-layout').dataset.view = tab;
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  Object.entries(sections).forEach(([name, el]) => { el.hidden = name !== tab; });

  if (tab === 'graph') updateGraphView();
  if (tab === 'knowledge') knowledgeView.refresh();
  if (tab === 'errors') errorLogView.refresh();
}

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Botões de captura e da barra de comando
[$('header-capture-btn'), $('mobile-capture-btn'), $('empty-state-capture-btn')]
  .forEach(btn => btn.addEventListener('click', () => captureModal.open()));
$('command-open-btn').addEventListener('click', () => palette.open());

clearFilterBtn.addEventListener('click', () => {
  filters.reset();
  state.filterType = 'all';
  state.filterTag = '';
  loadDashboardData();
});

// Busca com Debounce
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.searchQuery = e.target.value.trim();
    loadDashboardData();
  }, SEARCH_DEBOUNCE_MS);
});

/**
 * Atalhos: Ctrl/Cmd+K ou "/" abrem a barra de comando; ↑↓ (ou j/k) trocam de nota no acervo
 */
function isTypingTarget(el) {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function moveSelection(delta) {
  if (!state.items.length) return;
  const index = state.items.findIndex(i => i.id === state.selectedId);
  const next = index === -1 ? 0 : Math.min(Math.max(index + delta, 0), state.items.length - 1);
  const item = state.items[next];
  openItem(item);
  const row = itemsList.querySelector(`.item-row[data-id="${CSS.escape(item.id)}"]`);
  if (row) row.focus({ preventScroll: false });
}

// Clicar no texto da nota não dá foco a nada; lembramos onde foi o último clique
// para as setas rolarem a leitura em vez de trocar de nota
let lastPointerInReader = false;
document.addEventListener('pointerdown', (e) => { lastPointerInReader = readerPane.contains(e.target); });

document.addEventListener('keydown', (e) => {
  if (!isSignedIn) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (palette.isOpen()) palette.close();
    else palette.open();
    return;
  }
  if (palette.isOpen() || isTypingTarget(e.target) || document.querySelector('.modal-overlay.active')) return;

  if (e.key === '/') {
    e.preventDefault();
    palette.open();
    return;
  }

  const inReader = lastPointerInReader || readerPane.contains(document.activeElement);
  const canNavigate = state.currentTab === 'feed' && WIDE_READER.matches && !inReader;
  if (!canNavigate || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveSelection(1); }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveSelection(-1); }
});

/**
 * Tratamento de Compartilhamento Direto via Web Share Target do Celular
 */
async function checkSharedParams() {
  const shared = parseSharedParams(window.location.search);

  if (shared.hasAny) {
    const sharedFile = shared.hasFile ? await takeSharedFile().catch(() => null) : null;
    captureModal.open({
      url: shared.url,
      title: shared.title,
      text: shared.text,
      file: sharedFile,
      external: true
    });
    // Limpa a URL na barra de endereços sem recarregar a página
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

/**
 * Registro do Service Worker para PWA
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // O Vite publica public/ na raiz (dev e build): /sw.js com escopo / cobre o app inteiro e o /share-target
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
      console.warn('Service Worker não registrado:', err);
    });
  });
}

/**
 * Controle de acesso: o app só carrega dados com sessão válida do Supabase Auth
 */
const appLayout = document.querySelector('.app-layout');
const loginScreen = createLoginScreen();
let isSignedIn = null;

function applySession(session) {
  const signedIn = Boolean(session);
  if (signedIn === isSignedIn) return;
  isSignedIn = signedIn;

  if (signedIn) {
    loginScreen.hide();
    appLayout.hidden = false;
    checkSharedParams();
    loadDashboardData();
    refreshErrorCount();
    return;
  }

  appLayout.hidden = true;
  captureModal.close();
  palette.close();
  detail.close();
  state.items = [];
  itemsList.innerHTML = '';
  loginScreen.show();
}

$('header-logout-btn').addEventListener('click', async () => {
  try {
    await signOut();
  } catch (err) {
    alert('Erro ao sair: ' + err.message);
  }
});

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  onAuthChange(applySession);
  try {
    applySession(await getSession());
  } catch (err) {
    applySession(null);
  }
});
