import {
  getBrainItems,
  getBrainStats,
  toggleItemFavorite,
  deleteBrainItem,
  getSession,
  onAuthChange,
  signOut
} from './shared/services/supabaseClient.js';
import { createLoginScreen } from './components/LoginScreen.js';
import { createBrainItemCard } from './components/BrainItemCard.js';
import { renderStatsBar } from './components/StatsBar.js';
import { createItemDetailModal } from './components/ItemDetailModal.js';
import { createCaptureModal } from './components/CaptureModal.js';
import { createBrainChat } from './components/BrainChat.js';
import { createGraphView } from './components/GraphView.js';

// Estado da Aplicação
const state = {
  currentTab: 'feed', // 'feed' | 'graph' | 'chat'
  filterType: 'all',
  searchQuery: '',
  items: [],
  stats: { total: 0, favorites: 0, byType: {}, topTags: [] },
  isLoading: false
};

// Referências DOM
const sectionFeed = document.getElementById('section-feed');
const sectionGraph = document.getElementById('section-graph');
const sectionChat = document.getElementById('section-chat');
const navBtnFeed = document.getElementById('nav-btn-feed');
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

    renderStatsBar(statsContainer, stats);
    renderItemsGrid();
    graphView.update(items);
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
  navBtnGraph.classList.toggle('active', tab === 'graph');
  navBtnChat.classList.toggle('active', tab === 'chat');

  sectionFeed.style.display = tab === 'feed' ? 'block' : 'none';
  sectionGraph.style.display = tab === 'graph' ? 'block' : 'none';
  sectionChat.style.display = tab === 'chat' ? 'block' : 'none';

  if (tab === 'graph') {
    graphView.update(state.items);
  }
}

navBtnFeed.addEventListener('click', () => switchTab('feed'));
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
function checkSharedParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedUrl = urlParams.get('shared_url') || urlParams.get('url');
  const sharedTitle = urlParams.get('shared_title') || urlParams.get('title');
  const sharedText = urlParams.get('shared_text') || urlParams.get('text');

  if (sharedUrl || sharedText) {
    captureModal.open({
      url: sharedUrl,
      title: sharedTitle,
      text: sharedText
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
