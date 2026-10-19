import { escapeHtml } from '../shared/utils/markdown.js';
import {
  buildGraphModel,
  computeInsights,
  localSubgraph,
  neighborsOf
} from '../shared/utils/graphModel.js';
import {
  ALPHA_DECAY,
  ALPHA_MIN,
  clampZoom,
  easeTransform,
  fitTransform,
  stepSimulation,
  zoomAt
} from '../shared/utils/graphPhysics.js';
import { loadGraphPrefs, saveGraphPrefs } from '../shared/utils/graphPrefs.js';
import { insightsHtml, legendHtml, selectionHtml } from './graphPanelHtml.js';
import { createGraphSearch } from './graphSearch.js';
import { GRAPH_TEMPLATE } from './graphTemplate.js';
import { drawGraph, nodeColor, readPalette } from './graphRenderer.js';

const CLICK_MOVE_TOLERANCE = 5;
const DOUBLE_CLICK_MS = 350;
const PREFS_SAVE_DELAY_MS = 400;
const SIMILARITY_DEBOUNCE_MS = 120;
const NOTICE_MS = 5000;
const KEY_PAN_STEP = 48;
const ZOOM_STEP = 1.25;
const WHEEL_SENSITIVITY = 0.0015;
const FIT_EASE = 0.1;
const FALLBACK_SIZE = { width: 800, height: 600 };
const REDUCED_MOTION_MAX_TICKS = 600;
const ALPHA = { fresh: 1, newNodes: 0.5, same: 0.15, drag: 0.3 };

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Aba Conexões. `update(items, links, opts)` recebe o acervo e as ligações;
 * `showLocal(itemId)` abre o grafo local de uma nota.
 */
export function createGraphView(container, { onSelectNode, onFilterTag, onRetryLinks, storage = safeStorage() }) {
  container.innerHTML = GRAPH_TEMPLATE;
  const $ = (selector) => container.querySelector(selector);
  const canvas = $('#brain-graph-canvas');
  const ctx = canvas.getContext('2d');
  const el = {
    summary: $('#graph-summary'),
    notice: $('#graph-notice'),
    local: $('#graph-local'),
    legend: $('#graph-legend'),
    main: $('.graph-main'),
    empty: $('#graph-empty'),
    tooltip: $('#graph-tooltip'),
    panel: $('#graph-panel'),
    search: $('#graph-search'),
    results: $('#graph-search-results'),
    slider: $('#graph-sim'),
    sliderValue: $('#graph-sim-value'),
    fitBtn: $('#graph-fit-btn'),
    toolbar: $('#graph-toolbar'),
    filtersBtn: $('#graph-filters-btn'),
    filtersCount: $('#graph-filters-count'),
    toggles: {
      hubs: $('#graph-toggle-hubs'),
      similar: $('#graph-toggle-similar'),
      hideLoose: $('#graph-toggle-loose'),
      useFilters: $('#graph-toggle-filters')
    }
  };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  let prefs = loadGraphPrefs(storage);
  let inputs = { items: [], links: [], filtered: null, isFiltered: false, linksFailed: false };
  let model = { nodes: [], links: [], adjacency: new Map(), byId: new Map(), hiddenLoose: 0, noteLinkCount: 0 };
  let insights = computeInsights({ items: [], itemLinks: [] });
  let local = null;
  let selection = null;
  const positions = new Map();

  let hoveredNode = null;
  let draggedNode = null;
  let down = null;
  let panning = false;
  let pinch = null;
  let lastClick = null;
  const pointers = new Map();
  let lastPointer = { x: 0, y: 0 };

  let transform = prefs.transform ? { ...prefs.transform } : { x: 0, y: 0, k: 1 };
  let userMoved = Boolean(prefs.transform);
  let alpha = 0;
  let rafId = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let palette = readPalette();
  let focusMemo = null;
  let transientNotice = '';
  let noticeTimer = null;
  let prefsTimer = null;
  let simTimer = null;
  let sheetOpen = false;

  // ---------- preferências ----------

  function savePrefsSoon() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => {
      saveGraphPrefs(storage, { ...prefs, transform: userMoved ? { ...transform } : null });
    }, PREFS_SAVE_DELAY_MS);
  }

  // ---------- tamanho do canvas ----------

  // O canvas só tem tamanho quando a aba está visível: medimos de novo sempre que isso muda
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const dpr = window.devicePixelRatio || 1;
    cssWidth = rect.width;
    cssHeight = rect.height;
    const pixelW = Math.round(rect.width * dpr);
    const pixelH = Math.round(rect.height * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  const viewSize = () => ({
    width: cssWidth || FALLBACK_SIZE.width,
    height: cssHeight || FALLBACK_SIZE.height
  });

  // ---------- foco (hover, seleção, grupo) ----------

  function currentFocus() {
    const center = hoveredNode || (selection?.type === 'node' ? selection.node : null);
    if (center) {
      if (focusMemo?.center !== center || focusMemo.model !== model) {
        focusMemo = { model, center, set: neighborsOf(model, center) };
      }
      return focusMemo;
    }
    return selection?.type === 'group' ? { center: null, set: selection.set } : null;
  }

  // ---------- montagem dos dados ----------

  function savePositions() {
    for (const n of model.nodes) positions.set(n.id, { x: n.x, y: n.y });
  }

  function seedPositions() {
    const { width, height } = viewSize();
    const spread = Math.max(Math.min(width, height) * 0.7, 200);
    let known = 0;
    let added = 0;
    const place = (n, near) => {
      const saved = positions.get(n.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
        known++;
      } else {
        const originX = near ? near.x : width / 2;
        const originY = near ? near.y : height / 2;
        const range = near ? 70 : spread;
        n.x = originX + (Math.random() - 0.5) * range;
        n.y = originY + (Math.random() - 0.5) * range;
        added++;
      }
      n.vx = 0;
      n.vy = 0;
    };
    for (const n of model.nodes) if (n.type === 'item') place(n, null);
    for (const n of model.nodes) {
      if (n.type === 'item') continue;
      const anchor = (model.adjacency.get(n) ?? []).map((e) => e.node).find((o) => positions.has(o.id) || o.x !== undefined);
      place(n, anchor);
    }
    return { known, added };
  }

  function buildModel() {
    const dataset = prefs.useFilters && inputs.filtered ? inputs.filtered : inputs.items;
    const base = {
      itemLinks: inputs.links,
      hubs: prefs.hubs,
      similar: prefs.similar,
      minSimilarity: prefs.minSimilarity
    };
    let built = buildGraphModel({ ...base, items: dataset, hideLoose: prefs.hideLoose });
    insights = computeInsights({ ...base, items: dataset });
    if (!local) return built;

    const centerId = `item-${local.id}`;
    if (!built.byId.has(centerId)) {
      // A nota pode estar fora por causa do filtro ou de "ocultar soltas": ignoramos os dois só para ela
      built = buildGraphModel({ ...base, items: inputs.items, hideLoose: false });
    }
    const sub = localSubgraph(built, centerId, local.depth);
    if (sub) return sub;
    local = null;
    notify('Esta nota não aparece no grafo.');
    return built;
  }

  function rebuild() {
    resizeCanvas();
    savePositions();
    model = buildModel();
    for (const n of model.nodes) if (n.type === 'item') n.color = nodeColor(n.rawItem);
    const { known, added } = seedPositions();
    focusMemo = null;
    hoveredNode = null;
    el.tooltip.hidden = true;

    if (selection?.type === 'node') {
      const still = model.byId.get(selection.node.id);
      selection = still ? { type: 'node', node: still } : null;
    } else if (selection?.type === 'group') {
      const nodes = selection.nodes.map((n) => model.byId.get(n.id)).filter(Boolean);
      selection = nodes.length ? { ...selection, nodes, set: new Set(nodes) } : null;
    }
    if (local && !selection) selection = { type: 'node', node: model.byId.get(`item-${local.id}`) };

    alpha = known === 0 ? ALPHA.fresh : added > 0 ? ALPHA.newNodes : ALPHA.same;
    renderChrome();
    if (reducedMotion?.matches) settleNow();
    else requestFrame();
  }

  // ---------- textos e painéis ----------

  function renderChrome() {
    const total = model.nodes.filter((n) => n.type === 'item').length;
    const parts = [`${total} nota(s)`, `${model.noteLinkCount} ligação(ões) entre notas`];
    if (model.hiddenLoose) parts.push(`${model.hiddenLoose} solta(s) oculta(s)`);
    el.summary.innerHTML = inputs.items.length
      ? `${parts.join(' · ')}<span class="graph-hint">. Clique em uma nota, tag ou entidade para ver os detalhes.</span>`
      : 'Como suas notas se conectam.';
    canvas.setAttribute('aria-label', `Grafo de conexões: ${parts.join(', ')}. Use as setas para mover, + e − para o zoom, 0 para enquadrar.`);

    el.empty.hidden = inputs.items.length > 0;
    el.empty.textContent = 'Nenhuma nota para mostrar ainda. Capture conteúdo e as conexões aparecem aqui.';

    const dataItems = model.nodes.filter((n) => n.type === 'item').map((n) => n.rawItem);
    el.legend.innerHTML = legendHtml(dataItems, {
      hubs: prefs.hubs,
      similar: prefs.similar,
      hasShared: model.links.some((l) => l.kind === 'shared'),
      hasSimilar: model.links.some((l) => l.kind === 'similar')
    });

    renderLocalBar();
    syncControls();
    refreshNotice();
    renderPanel();
  }

  function renderPanel() {
    el.panel.dataset.state = selection ? 'selection' : sheetOpen ? 'open' : 'closed';
    el.panel.innerHTML = selection ? selectionHtml(selection, model) : insightsHtml(insights, { sheetOpen });
    el.panel.scrollTop = 0;
  }

  function renderLocalBar() {
    el.local.hidden = !local;
    if (!local) return;
    const item = inputs.items.find((i) => i.id === local.id);
    const title = escapeHtml(item?.title || 'Sem título');
    const depthBtn = (d) => `<button type="button" class="chip-btn${local.depth === d ? ' active' : ''}" data-action="local-depth" data-depth="${d}">${d} passo${d > 1 ? 's' : ''}</button>`;
    el.local.innerHTML = `<span>Grafo local de <strong>${title}</strong></span>${depthBtn(1)}${depthBtn(2)}
      <button type="button" class="chip-btn" data-action="exit-local">Voltar ao grafo completo</button>`;
  }

  function syncControls() {
    for (const [key, btn] of Object.entries(el.toggles)) {
      btn.classList.toggle('active', prefs[key]);
      btn.setAttribute('aria-pressed', String(prefs[key]));
    }
    el.toggles.useFilters.disabled = !inputs.isFiltered && !prefs.useFilters;
    el.slider.value = String(Math.round(prefs.minSimilarity * 100));
    el.slider.disabled = !prefs.similar;
    el.sliderValue.textContent = `${Math.round(prefs.minSimilarity * 100)}%`;
    const activeFilters = ['hubs', 'similar', 'hideLoose', 'useFilters'].filter((k) => prefs[k]).length;
    el.filtersCount.textContent = String(activeFilters);
  }

  function notify(text) {
    transientNotice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      transientNotice = '';
      refreshNotice();
    }, NOTICE_MS);
    refreshNotice();
  }

  function refreshNotice() {
    if (transientNotice) {
      el.notice.hidden = false;
      el.notice.textContent = transientNotice;
    } else if (inputs.linksFailed) {
      el.notice.hidden = false;
      el.notice.innerHTML = `Não foi possível carregar as ligações entre notas; só as tags aparecem.
        ${onRetryLinks ? '<button type="button" class="chip-btn" data-action="retry">Tentar de novo</button>' : ''}`;
    } else {
      el.notice.hidden = true;
      el.notice.textContent = '';
    }
  }

  // ---------- simulação e desenho ----------

  function requestFrame() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  // Enquadra na área que a gaveta (celular) não cobre
  function fitTarget() {
    const { width, height } = viewSize();
    return fitTransform(model.nodes, width, Math.max(height - sheetInset(), height * 0.4));
  }

  function fitNow() {
    transform = fitTarget();
  }

  function settleNow() {
    const { width, height } = viewSize();
    let a = alpha;
    for (let tick = 0; a > ALPHA_MIN && tick < REDUCED_MOTION_MAX_TICKS; tick++) {
      stepSimulation(model.nodes, model.links, { cx: width / 2, cy: height / 2, alpha: a });
      a *= ALPHA_DECAY;
    }
    alpha = 0;
    savePositions();
    if (!userMoved) fitNow();
    requestFrame();
  }

  // Esquenta a simulação (ex.: ao arrastar um nó); com movimento reduzido só redesenha
  function reheat(level) {
    if (reducedMotion?.matches) {
      requestFrame();
      return;
    }
    alpha = Math.max(alpha, level);
    requestFrame();
  }

  function frame() {
    rafId = null;
    // Aba oculta: pausa (retoma em requestFrame quando voltar a ter tamanho)
    if (!canvas.offsetParent || !resizeCanvas()) return;
    if (alpha > ALPHA_MIN) {
      stepSimulation(model.nodes, model.links, {
        cx: cssWidth / 2,
        cy: cssHeight / 2,
        alpha,
        pinned: draggedNode
      });
      alpha *= ALPHA_DECAY;
      if (!userMoved) transform = easeTransform(transform, fitTarget(), FIT_EASE);
      if (alpha <= ALPHA_MIN) {
        savePositions();
        if (!userMoved) fitNow();
      }
    }
    draw();
    if (alpha > ALPHA_MIN) requestFrame();
  }

  function draw() {
    drawGraph(ctx, {
      model,
      transform,
      palette,
      focus: currentFocus(),
      selected: selection?.type === 'node' ? selection.node : null,
      hovered: hoveredNode,
      width: cssWidth,
      height: cssHeight
    });
  }

  // ---------- navegação ----------

  function moveView(next) {
    transform = next;
    userMoved = true;
    requestFrame();
    savePrefsSoon();
  }

  function zoomBy(factor, sx = cssWidth / 2, sy = cssHeight / 2) {
    moveView(zoomAt(transform, sx, sy, factor));
  }

  function fit() {
    userMoved = false;
    fitNow();
    requestFrame();
    savePrefsSoon();
  }

  // No celular a gaveta cobre a parte de baixo do grafo: centralizamos só na área visível
  function sheetInset() {
    if (!window.matchMedia?.('(max-width: 859px)').matches) return 0;
    return Math.min(el.panel.offsetHeight, cssHeight * 0.6);
  }

  function centerOn(node, minZoom = 1) {
    if (!cssWidth) return;
    const k = clampZoom(Math.max(transform.k, minZoom));
    moveView({ k, x: cssWidth / 2 - node.x * k, y: (cssHeight - sheetInset()) / 2 - node.y * k });
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, x: (sx - transform.x) / transform.k, y: (sy - transform.y) / transform.k };
  }

  function nodeAt(pos) {
    for (let i = model.nodes.length - 1; i >= 0; i--) {
      const n = model.nodes[i];
      if (Math.hypot(n.x - pos.x, n.y - pos.y) <= n.radius + 5) return n;
    }
    return null;
  }

  // ---------- seleção ----------

  function selectNode(node, { center = false } = {}) {
    selection = { type: 'node', node };
    renderPanel();
    if (center) centerOn(node);
    requestFrame();
  }

  function clearSelection() {
    if (!selection) return;
    selection = null;
    renderPanel();
    requestFrame();
  }

  function focusGroup(ids, label, kicker) {
    const nodes = ids.map((id) => model.byId.get(`item-${id}`)).filter(Boolean);
    if (!nodes.length) {
      notify('Estas notas não aparecem no grafo com os filtros atuais.');
      return;
    }
    selection = { type: 'group', kicker, label, nodes, set: new Set(nodes) };
    renderPanel();
    if (cssWidth) moveView(fitTransform(nodes, cssWidth, Math.max(cssHeight - sheetInset(), 120)));
    requestFrame();
  }

  function showLocal(itemId, depth = 1) {
    local = { id: itemId, depth };
    selection = null;
    userMoved = false;
    rebuild();
  }

  function exitLocal() {
    local = null;
    selection = null;
    userMoved = false;
    rebuild();
  }

  function togglePref(key) {
    prefs = { ...prefs, [key]: !prefs[key] };
    savePrefsSoon();
    rebuild();
  }

  // ---------- descrição (dica ao passar o mouse) ----------

  function describe(node) {
    if (node.type !== 'item') {
      return `<strong>${escapeHtml(node.label)}</strong><br><span class="graph-tip-sub">${node.type === 'tag' ? 'TAG' : 'ENTIDADE'} · ${node.degree} nota(s)</span>`;
    }
    const related = (model.adjacency.get(node) ?? []).filter((e) => e.node.type === 'item');
    const lines = related.slice(0, 4).map(({ node: other, link }) => {
      const why = link.kind === 'shared'
        ? `cita ${escapeHtml(link.labels.slice(0, 3).join(', ') || 'o mesmo conteúdo')}`
        : 'assunto parecido';
      return `<div class="graph-tip-rel">↔ ${escapeHtml(other.fullTitle)} <span>(${why})</span></div>`;
    });
    return `<strong>${escapeHtml(node.fullTitle)}</strong><br><span class="graph-tip-sub">NOTA · ${related.length} ligação(ões) com outras notas</span>${lines.join('')}`;
  }

  function showTooltip(node, pos) {
    hoveredNode = node;
    if (!node) {
      el.tooltip.hidden = true;
      return;
    }
    el.tooltip.hidden = false;
    el.tooltip.style.left = `${Math.min(pos.sx + 15, Math.max(cssWidth - 260, 0))}px`;
    el.tooltip.style.top = `${pos.sy + 14}px`;
    el.tooltip.innerHTML = describe(node);
  }

  // ---------- ponteiro: arrastar, mover, pinçar, clicar ----------

  function startPinch() {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    down = null;
    draggedNode = null;
    panning = false;
    showTooltip(null);
  }

  function movePinch() {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const rect = canvas.getBoundingClientRect();
    const moved = { ...transform, x: transform.x + (mx - pinch.mx), y: transform.y + (my - pinch.my) };
    moveView(zoomAt(moved, mx - rect.left, my - rect.top, dist / pinch.dist));
    pinch = { dist, mx, my };
  }

  function endGesture() {
    down = null;
    draggedNode = null;
    panning = false;
    canvas.style.cursor = 'grab';
  }

  function handleClick(node) {
    if (!node) {
      clearSelection();
      return;
    }
    const now = performance.now();
    if (node.type === 'item' && lastClick?.id === node.id && now - lastClick.time < DOUBLE_CLICK_MS) {
      lastClick = null;
      onSelectNode?.(node.rawItem);
      return;
    }
    lastClick = { id: node.id, time: now };
    selectNode(node);
  }

  canvas.addEventListener('pointerdown', (e) => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ponteiro já encerrado (toque rápido): seguimos sem captura
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
    const node = nodeAt(pointerPos(e));
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, node, moved: false };
    lastPointer = { x: e.clientX, y: e.clientY };
    if (node) {
      draggedNode = node;
      canvas.style.cursor = 'grabbing';
    } else {
      panning = true;
      canvas.style.cursor = 'move';
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      movePinch();
      return;
    }
    if (down && down.id === e.pointerId) {
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MOVE_TOLERANCE) down.moved = true;
      if (!down.moved) return;
      if (draggedNode) {
        const pos = pointerPos(e);
        draggedNode.x = pos.x;
        draggedNode.y = pos.y;
        reheat(ALPHA.drag);
      } else if (panning) {
        moveView({ ...transform, x: transform.x + e.clientX - lastPointer.x, y: transform.y + e.clientY - lastPointer.y });
        lastPointer = { x: e.clientX, y: e.clientY };
      }
      return;
    }
    if (e.pointerType === 'touch') return;
    const pos = pointerPos(e);
    const node = nodeAt(pos);
    canvas.style.cursor = node ? 'pointer' : 'grab';
    showTooltip(node, pos);
    requestFrame();
  });

  canvas.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (!down || down.id !== e.pointerId) return;
    const { moved, node } = down;
    endGesture();
    if (!moved) handleClick(node);
    else savePositions();
  });

  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    endGesture();
  });

  canvas.addEventListener('pointerleave', () => {
    if (down || pinch) return;
    showTooltip(null);
    requestFrame();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomBy(Math.exp(-e.deltaY * WHEEL_SENSITIVITY), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  canvas.addEventListener('keydown', (e) => {
    const pan = (dx, dy) => moveView({ ...transform, x: transform.x + dx, y: transform.y + dy });
    const actions = {
      '+': () => zoomBy(ZOOM_STEP),
      '=': () => zoomBy(ZOOM_STEP),
      '-': () => zoomBy(1 / ZOOM_STEP),
      '_': () => zoomBy(1 / ZOOM_STEP),
      0: fit,
      ArrowLeft: () => pan(KEY_PAN_STEP, 0),
      ArrowRight: () => pan(-KEY_PAN_STEP, 0),
      ArrowUp: () => pan(0, KEY_PAN_STEP),
      ArrowDown: () => pan(0, -KEY_PAN_STEP),
      Escape: clearSelection,
      Enter: () => { if (selection?.type === 'node' && selection.node.type === 'item') onSelectNode?.(selection.node.rawItem); }
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  });

  createGraphSearch({
    input: el.search,
    results: el.results,
    getModel: () => model,
    onChoose: (node) => selectNode(node, { center: true })
  });

  // ---------- botões e ações do painel ----------

  const actionHandlers = {
    'select-node': (target) => {
      const node = model.byId.get(target.dataset.nodeId);
      if (node) selectNode(node, { center: true });
      else notify('Esta nota não aparece no grafo com os filtros atuais.');
    },
    'open-note': (target) => {
      const item = model.byId.get(`item-${target.dataset.id}`)?.rawItem;
      if (item) onSelectNode?.(item);
    },
    'show-local': (target) => showLocal(target.dataset.id, 1),
    'local-depth': (target) => showLocal(local.id, Number(target.dataset.depth)),
    'exit-local': exitLocal,
    clear: clearSelection,
    'filter-tag': (target) => onFilterTag?.(target.dataset.tag),
    'focus-group': (target) => focusGroup(target.dataset.ids.split(','), target.dataset.label, 'GRUPO DE ASSUNTO'),
    'focus-pair': (target) => {
      const { a, b } = target.dataset;
      const titleOf = (id) => model.byId.get(`item-${id}`)?.fullTitle ?? 'Sem título';
      focusGroup([a, b], `${titleOf(a)} ↔ ${titleOf(b)}`, 'POSSÍVEL CONEXÃO');
    },
    'toggle-sheet': () => {
      sheetOpen = !sheetOpen;
      renderPanel();
      if (!userMoved) fitNow();
      requestFrame();
    },
    retry: () => onRetryLinks?.()
  };

  container.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (target) actionHandlers[target.dataset.action]?.(target);
  });

  for (const [key, btn] of Object.entries(el.toggles)) btn.addEventListener('click', () => togglePref(key));
  el.filtersBtn.addEventListener('click', () => {
    const open = el.toolbar.dataset.open !== 'true';
    el.toolbar.dataset.open = String(open);
    el.filtersBtn.setAttribute('aria-expanded', String(open));
  });
  el.fitBtn.addEventListener('click', fit);
  $('#graph-zoom-in').addEventListener('click', () => zoomBy(ZOOM_STEP));
  $('#graph-zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));

  el.slider.addEventListener('input', () => {
    prefs = { ...prefs, minSimilarity: Number(el.slider.value) / 100 };
    el.sliderValue.textContent = `${el.slider.value}%`;
    savePrefsSoon();
    clearTimeout(simTimer);
    simTimer = setTimeout(rebuild, SIMILARITY_DEBOUNCE_MS);
  });

  // ---------- ambiente ----------

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (!resizeCanvas()) return;
      if (!userMoved && alpha <= ALPHA_MIN) fitNow();
      requestFrame();
    }).observe(canvas);
  }
  window.addEventListener('resize', () => requestFrame());
  window.addEventListener('themechange', () => {
    palette = readPalette();
    for (const n of model.nodes) if (n.type === 'item') n.color = nodeColor(n.rawItem);
    requestFrame();
  });

  syncControls();
  renderPanel();

  return {
    update(nextItems, nextLinks, opts = {}) {
      const next = {
        items: Array.isArray(nextItems) ? nextItems : [],
        links: Array.isArray(nextLinks) ? nextLinks : [],
        filtered: Array.isArray(opts.filteredItems) ? opts.filteredItems : null,
        isFiltered: Boolean(opts.isFiltered),
        linksFailed: Boolean(opts.linksFailed)
      };
      const changed = next.items !== inputs.items || next.links !== inputs.links || next.filtered !== inputs.filtered;
      inputs = next;
      if (changed) rebuild();
      else {
        syncControls();
        refreshNotice();
        requestFrame();
      }
    },
    showLocal(itemId, depth = 1) {
      showLocal(itemId, depth);
    }
  };
}
