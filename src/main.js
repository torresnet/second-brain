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
  processItemKnowledge,
  processPendingItems
} from './shared/services/supabaseClient.js';
import { createLoginScreen } from './components/LoginScreen.js';
import { createBrainItemCard } from './components/BrainItemCard.js';
import { renderStatsBar } from './components/StatsBar.js';
import { createItemDetailModal } from './components/ItemDetailModal.js';
import { createCaptureModal } from './components/CaptureModal.js';
import { createBrainChat } from './components/BrainChat.js';
import { createGraphView } from './components/GraphView.js';
import { createKnowledgeView } from './components/KnowledgeView.js';
import { takeSharedFile } from './shared/services/captureService.js';

// Estado da Aplicação
const state = {
  currentTab: 'feed', // 'feed' | 'knowledge' | 'graph' | 'chat'
  filterType: 'all',
  searchQuery: '',
  items: [],
  stats: { total: 0, favorites: 0, byType: {}, topTags: [] },
  isLoading: false,
  itemLinks: []
};

// Referências DOM
const sectionFeed = document.getElementById('section-feed');
const sectionKnowledge = document.getElementById('section-knowledge');
const sectionGraph = document.getElementById('section-graph');
const sectionChat = document.getElementById('section-chat');
const navBtnFeed = document.getElementById('nav-btn-feed');
const navBtnKnowledge = document.getElementById('nav-btn-knowledge');
const navBtnGraph = document.getElementById('nav-btn-graph');
const navBtnChat = document.getElementById('nav-btn-chat');
const headerCaptureBtn = document.getElementById('header-capture-btn');
const emptyStateCaptureBtn = document.getElementById('empty-state-capture-btn');

const statsContainer = document.getElementById('stats-container');
const itemsGridContainer = document.getElementById('items-grid-container');
const emptyStateContainer = document.getElementById('empty-state-container');
const searchInput = document.getElementById('feed-search-input');
const mediaFiltersContainer = document.getElementById('media-filters-container');
const chatMountPoint = document.getElementById('chat-mount-point');
const knowledgeMountPoint = document.getElementById('knowledge-mount-point');
const indexingBanner = document.getElementById('indexing-banner');
const graphMountPoint = document.getElementById('graph-mount-point');

// Inicialização dos Modais
const detailModal = createItemDetailModal({
  onDelete: async (id) => {
    try {
      await deleteBrainItem(id);
      await loadDashboardData();
    } catch (err) {
      alert('Erro ao excluir item: ' + err.message);
    }
  },
  getRelated: (id) => relatedFor(id),
  onOpenRelated: async (id) => {
    const item = await getBrainItemById(id).catch(() => null);
    if (item) detailModal.open(item);
  },
  onReprocess: async (id) => {
    const result = await processItemKnowledge(id);
    const outcome = result?.results?.[0] ?? result;
    if (outcome?.status === 'not_found') throw new Error('A nota não existe mais.');
    if (outcome?.status === 'busy') throw new Error('Este item já está sendo processado. Aguarde alguns minutos.');
    if (outcome?.status === 'failed') {
      throw new Error(outcome.warnings?.[0] || 'A indexação falhou. Tente novamente em instantes.');
    }
    refreshIndexBanner();
    return getBrainItemById(id);
  }
});

const captureModal = createCaptureModal({
  onItemSaved: async () => {
    await loadDashboardData();
  }
});

// Inicialização do Chat RAG
createBrainChat(chatMountPoint, {
  onOpenItem: (item) => {
    detailModal.open(item);
  }
});

// Catálogo de conhecimento extraído (ferramentas, links, códigos, ideias...)
const knowledgeView = createKnowledgeView(knowledgeMountPoint, {
  onOpenItem: (item) => detailModal.open(item)
});

// Inicialização do Grafo de Conexões (Inspirado em NoteDiscovery e SamurAIGPT)
const graphView = createGraphView(graphMountPoint, {
  onSelectNode: (item) => {
    if (item) detailModal.open(item);
  }
});

/**
 * Carrega itens e estatísticas do Supabase
 */
async function loadDashboardData() {
  state.isLoading = true;
  itemsGridContainer.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
      <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚡</div>
      Carregando seu Segundo Cérebro...
    </div>
  `;

  try {
    const [items, stats] = await Promise.all([
      getBrainItems({ type: state.filterType, search: state.searchQuery }),
      getBrainStats()
    ]);

    state.items = items;
    state.stats = stats;
    state.itemLinks = await getItemLinks();

    renderStatsBar(statsContainer, stats);
    renderItemsGrid();
    graphView.update(items, state.itemLinks);
    refreshIndexBanner();
  } catch (err) {
    itemsGridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #f87171;">
        Erro ao carregar dados do Supabase: ${err.message}
      </div>
    `;
  } finally {
    state.isLoading = false;
  }
}

/**
 * Notas ligadas a uma nota (nas duas direções), da mais forte para a mais fraca
 */
function relatedFor(id) {
  return state.itemLinks
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

async function refreshIndexBanner() {
  if (isIndexing) return;
  const pending = await getPendingIndexCount();
  if (!pending) {
    indexingBanner.style.display = 'none';
    return;
  }
  indexingBanner.style.display = 'flex';
  indexingBanner.innerHTML = `
    <span>🧩 <strong>${pending}</strong> ${pending === 1 ? 'item aguarda' : 'itens aguardam'} a indexação avançada (links, códigos e ferramentas ficam pesquisáveis).</span>
    <button id="indexing-run-btn" class="btn-primary" type="button">Indexar agora</button>
    <span id="indexing-progress"></span>
  `;
  indexingBanner.querySelector('#indexing-run-btn').addEventListener('click', runIndexing);
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

  try {
    for (let guard = 0; guard < 300; guard++) {
      progress.textContent = processed ? `Indexados: ${processed}…` : 'Indexando… (cada item leva de 10 a 60 segundos)';
      const { results = [], remaining = 0 } = await processPendingItems(1);
      if (!results.length) break;
      for (const r of results) {
        if (r.status === 'done' || r.status === 'partial') processed++;
        else if (r.status === 'failed') failures++;
      }
      busyStreak = results.every(r => r.status === 'busy') ? busyStreak + 1 : 0;
      if (busyStreak >= 3 || remaining === 0) break;
    }
    progress.textContent = failures
      ? `${processed} indexado(s); ${failures} falharam (abra a nota e use "Tentar de novo").`
      : `${processed} item(ns) indexado(s).`;
  } catch (err) {
    progress.textContent = `Interrompido: ${err.message}`;
  } finally {
    isIndexing = false;
    setTimeout(() => { refreshIndexBanner(); loadDashboardData(); }, 2500);
  }
}

/**
 * Renderiza o grid de cartões de notas
 */
function renderItemsGrid() {
  itemsGridContainer.innerHTML = '';

  if (state.items.length === 0) {
    itemsGridContainer.style.display = 'none';
    emptyStateContainer.style.display = 'block';
    return;
  }

  itemsGridContainer.style.display = 'grid';
  emptyStateContainer.style.display = 'none';

  state.items.forEach(item => {
    const card = createBrainItemCard(item, {
      onClick: (selected) => detailModal.open(selected),
      onToggleFavorite: async (selected) => {
        try {
          await toggleItemFavorite(selected.id, selected.is_favorite);
          selected.is_favorite = !selected.is_favorite;
          await loadDashboardData();
        } catch (err) {
          console.error(err);
        }
      }
    });
    itemsGridContainer.appendChild(card);
  });
}

/**
 * Alternância de Abas (Feed, Grafo, Chat)
 */
function switchTab(tab) {
  state.currentTab = tab;
  navBtnFeed.classList.toggle('active', tab === 'feed');
  navBtnKnowledge.classList.toggle('active', tab === 'knowledge');
  navBtnGraph.classList.toggle('active', tab === 'graph');
  navBtnChat.classList.toggle('active', tab === 'chat');

  sectionFeed.style.display = tab === 'feed' ? 'block' : 'none';
  sectionKnowledge.style.display = tab === 'knowledge' ? 'block' : 'none';
  sectionGraph.style.display = tab === 'graph' ? 'block' : 'none';
  sectionChat.style.display = tab === 'chat' ? 'block' : 'none';

  if (tab === 'graph') {
    graphView.update(state.items, state.itemLinks);
  }
  if (tab === 'knowledge') {
    knowledgeView.refresh();
  }
}

navBtnFeed.addEventListener('click', () => switchTab('feed'));
navBtnKnowledge.addEventListener('click', () => switchTab('knowledge'));
navBtnGraph.addEventListener('click', () => switchTab('graph'));
navBtnChat.addEventListener('click', () => switchTab('chat'));

// Botões de Abertura do Modal de Captura
headerCaptureBtn.addEventListener('click', () => captureModal.open());
if (emptyStateCaptureBtn) {
  emptyStateCaptureBtn.addEventListener('click', () => captureModal.open());
}

// Filtro de Mídia
mediaFiltersContainer.addEventListener('click', (e) => {
  const btn = e.target.closest('.pill-btn');
  if (!btn) return;

  mediaFiltersContainer.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  state.filterType = btn.dataset.type;
  loadDashboardData();
});

// Busca com Debounce
let searchTimeout = null;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.searchQuery = e.target.value.trim();
    loadDashboardData();
  }, 250);
});

/**
 * Tratamento de Compartilhamento Direto via Web Share Target do Celular
 */
async function checkSharedParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedUrl = urlParams.get('shared_url') || urlParams.get('url');
  const sharedTitle = urlParams.get('shared_title') || urlParams.get('title');
  const sharedText = urlParams.get('shared_text') || urlParams.get('text');
  const hasSharedFile = urlParams.get('shared_file') === '1';

  if (sharedUrl || sharedText || hasSharedFile) {
    const sharedFile = hasSharedFile ? await takeSharedFile().catch(() => null) : null;
    captureModal.open({
      url: sharedUrl,
      title: sharedTitle,
      text: sharedText,
      file: sharedFile
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
    navigator.serviceWorker.register('/public/sw.js').catch(err => {
      console.log('Service Worker não registrado:', err);
    });
  });
}

/**
 * Controle de acesso: o app só carrega dados com sessão válida do Supabase Auth
 */
const appLayout = document.querySelector('.app-layout');
const logoutBtn = document.getElementById('header-logout-btn');
const loginScreen = createLoginScreen();
let isSignedIn = null;

function applySession(session) {
  const signedIn = Boolean(session);
  if (signedIn === isSignedIn) return;
  isSignedIn = signedIn;

  if (signedIn) {
    loginScreen.hide();
    appLayout.style.display = '';
    checkSharedParams();
    loadDashboardData();
    return;
  }

  appLayout.style.display = 'none';
  captureModal.close();
  detailModal.close();
  state.items = [];
  itemsGridContainer.innerHTML = '';
  loginScreen.show();
}

logoutBtn.addEventListener('click', async () => {
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
