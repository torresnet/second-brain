import { APP_CONFIG } from '../shared/constants/config.js';
import { escapeHtml } from '../shared/utils/markdown.js';

const CLICK_MOVE_TOLERANCE = 5;

const LINK_STYLES = {
  tag: { color: 'rgba(255,255,255,0.12)', width: 1, dash: [], length: 70 },
  entity: { color: 'rgba(168,85,247,0.28)', width: 1, dash: [], length: 85 },
  shared: { color: 'rgba(129,140,248,0.7)', width: 2, dash: [], length: 120 },
  similar: { color: 'rgba(6,182,212,0.45)', width: 1.2, dash: [5, 5], length: 160 }
};

export function createGraphView(container, { onSelectNode }) {
  container.innerHTML = `
    <div class="graph-card">
      <div class="graph-bar">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 36px; height: 36px; border-radius: 10px; background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">🕸️</div>
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 700;">Grafo de Conexões do Conhecimento</h3>
            <p id="graph-summary" style="font-size: 0.8rem; color: var(--text-muted);">Como suas notas se conectam.</p>
          </div>
        </div>
        <div class="graph-controls">
          <button id="graph-toggle-hubs" class="pill-btn active" type="button" title="Mostrar tags e entidades">Tags e entidades</button>
          <button id="graph-toggle-similar" class="pill-btn active" type="button" title="Mostrar notas de assunto parecido">Assunto parecido</button>
          <button id="graph-reset-btn" class="pill-btn" type="button">Centralizar</button>
        </div>
      </div>
      <div class="graph-legend">
        <span><i class="dot" style="background:#6366f1"></i> Nota</span>
        <span><i class="dot small" style="background:#06b6d4"></i> Tag</span>
        <span><i class="dot small" style="background:#a855f7"></i> Entidade</span>
        <span><i class="line" style="background:rgba(129,140,248,0.9)"></i> Citam a mesma coisa</span>
        <span><i class="line dashed"></i> Assunto parecido</span>
      </div>
      <canvas id="brain-graph-canvas" style="flex: 1; width: 100%; min-height: 0; display: block; cursor: grab; touch-action: none;"></canvas>
      <div id="graph-empty" class="graph-empty" style="display: none;"></div>
      <div id="graph-tooltip" class="graph-tooltip" style="display: none;"></div>
    </div>
  `;

  const canvas = container.querySelector('#brain-graph-canvas');
  const ctx = canvas.getContext('2d');
  const tooltip = container.querySelector('#graph-tooltip');
  const emptyBox = container.querySelector('#graph-empty');
  const summaryEl = container.querySelector('#graph-summary');
  const resetBtn = container.querySelector('#graph-reset-btn');
  const hubsBtn = container.querySelector('#graph-toggle-hubs');
  const similarBtn = container.querySelector('#graph-toggle-similar');

  let items = [];
  let itemLinks = [];
  let nodes = [];
  let links = [];
  let animationFrameId = null;
  let hoveredNode = null;
  let draggedNode = null;
  let pointerDown = null;
  let isPanning = false;
  let lastPointer = { x: 0, y: 0 };
  let transform = { x: 0, y: 0, k: 1 };
  const show = { hubs: true, similar: true };
  let cssWidth = 0;
  let cssHeight = 0;

  // O canvas só tem tamanho quando a aba está visível: medimos de novo sempre que isso muda
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const dpr = window.devicePixelRatio || 1;
    const changed = Math.abs(rect.width - cssWidth) > 0.5 || Math.abs(rect.height - cssHeight) > 0.5;
    cssWidth = rect.width;
    cssHeight = rect.height;
    if (changed || canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (resizeCanvas() && nodes.length) ensureLoop();
    }).observe(canvas);
  }
  window.addEventListener('resize', () => resizeCanvas());

  // O canvas não entende var(--cor): resolvemos a variável CSS para o valor real
  function nodeColor(item) {
    const raw = APP_CONFIG.mediaTypes[item.source_type]?.color || '#6366f1';
    const match = raw.match(/^var\((--[\w-]+)\)$/);
    if (!match) return raw;
    return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() || '#6366f1';
  }

  function buildGraphData() {
    const placed = () => ({
      x: cssWidth / 2 + (Math.random() - 0.5) * Math.max(cssWidth * 0.6, 200),
      y: cssHeight / 2 + (Math.random() - 0.5) * Math.max(cssHeight * 0.6, 200),
      vx: 0,
      vy: 0
    });
    nodes = [];
    links = [];
    const nodeMap = new Map();
    const hub = (id, label, type, color, radius, near) => {
      let n = nodeMap.get(id);
      if (!n) {
        n = { id, label, type, color, radius, ...placed() };
        n.x = near.x + (Math.random() - 0.5) * 70;
        n.y = near.y + (Math.random() - 0.5) * 70;
        nodes.push(n);
        nodeMap.set(id, n);
      }
      return n;
    };

    for (const item of items) {
      const title = item.title || 'Sem título';
      const node = {
        id: 'item-' + item.id,
        rawItem: item,
        label: title.length > 22 ? title.slice(0, 20) + '…' : title,
        fullTitle: title,
        type: 'item',
        color: nodeColor(item),
        radius: 12,
        ...placed()
      };
      nodes.push(node);
      nodeMap.set(node.id, node);

      if (show.hubs) {
        for (const tag of Array.isArray(item.tags) ? item.tags : []) {
          const t = hub('tag-' + String(tag).toLowerCase(), '#' + tag, 'tag', '#06b6d4', 8, node);
          links.push({ source: node, target: t, kind: 'tag' });
        }
        for (const entity of Array.isArray(item.entities) ? item.entities : []) {
          const e = hub('ent-' + String(entity).toLowerCase(), String(entity), 'entity', '#a855f7', 9, node);
          links.push({ source: node, target: e, kind: 'entity' });
        }
      }
    }

    for (const l of itemLinks) {
      if (l.link_type === 'similar' && !show.similar) continue;
      const a = nodeMap.get('item-' + l.source_id);
      const b = nodeMap.get('item-' + l.target_id);
      if (a && b) links.push({ source: a, target: b, kind: l.link_type, labels: l.labels || [], weight: l.weight });
    }

    const noteLinks = links.filter(l => l.kind === 'shared' || l.kind === 'similar').length;
    summaryEl.textContent = items.length
      ? `${items.length} nota(s) · ${noteLinks} ligação(ões) entre notas. Passe o mouse para destacar, clique para abrir.`
      : 'Como suas notas se conectam.';
    emptyBox.style.display = items.length ? 'none' : 'flex';
    emptyBox.textContent = 'Nenhuma nota para mostrar ainda. Capture conteúdo e as conexões aparecem aqui.';
  }

  function neighborsOf(node) {
    const set = new Set([node]);
    for (const l of links) {
      if (l.source === node) set.add(l.target);
      if (l.target === node) set.add(l.source);
    }
    return set;
  }

  function simulate() {
    const centerX = cssWidth / 2;
    const centerY = cssHeight / 2;

    for (const n of nodes) {
      n.vx += (centerX - n.x) * 0.002;
      n.vy += (centerY - n.y) * 0.002;
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 180) {
          const force = (180 - dist) / (dist * 12);
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
    }

    for (const link of links) {
      const a = link.source;
      const b = link.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - LINK_STYLES[link.kind].length) * 0.035;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const n of nodes) {
      if (n === draggedNode) continue;
      n.vx *= 0.88;
      n.vy *= 0.88;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  function render() {
    ctx.save();
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const focus = hoveredNode ? neighborsOf(hoveredNode) : null;

    for (const link of links) {
      const style = LINK_STYLES[link.kind];
      const lit = !focus || (focus.has(link.source) && focus.has(link.target) && (link.source === hoveredNode || link.target === hoveredNode));
      ctx.globalAlpha = lit ? 1 : 0.08;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width + (focus && lit ? 0.8 : 0);
      ctx.setLineDash(style.dash);
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const n of nodes) {
      const isHovered = n === hoveredNode;
      ctx.globalAlpha = !focus || focus.has(n) ? 1 : 0.18;
      ctx.shadowColor = n.color;
      ctx.shadowBlur = isHovered ? 15 : 0;

      ctx.beginPath();
      ctx.arc(n.x, n.y, isHovered ? n.radius + 3 : n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.75)';
      ctx.font = isHovered ? 'bold 11px Inter, sans-serif' : '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + n.radius + 13);
    }
    ctx.restore();
  }

  function loop() {
    // Aba oculta: pausa a animação (retoma em ensureLoop quando voltar a ter tamanho)
    if (!canvas.offsetParent || !resizeCanvas()) {
      animationFrameId = null;
      return;
    }
    simulate();
    render();
    animationFrameId = requestAnimationFrame(loop);
  }

  function ensureLoop() {
    if (animationFrameId === null) animationFrameId = requestAnimationFrame(loop);
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
      x: (e.clientX - rect.left - transform.x) / transform.k,
      y: (e.clientY - rect.top - transform.y) / transform.k
    };
  }

  function nodeAt(pos) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 5) return n;
    }
    return null;
  }

  function describe(node) {
    if (node.type !== 'item') return `<strong>${escapeHtml(node.label)}</strong><br><span class="graph-tip-sub">${node.type === 'tag' ? 'TAG' : 'ENTIDADE'}</span>`;
    const related = links.filter(l => (l.kind === 'shared' || l.kind === 'similar') && (l.source === node || l.target === node));
    const lines = related.slice(0, 4).map(l => {
      const other = l.source === node ? l.target : l.source;
      const why = l.kind === 'shared' ? `cita ${escapeHtml((l.labels || []).slice(0, 3).join(', ') || 'o mesmo conteúdo')}` : 'assunto parecido';
      return `<div class="graph-tip-rel">↔ ${escapeHtml(other.fullTitle)} <span>(${why})</span></div>`;
    });
    return `<strong>${escapeHtml(node.fullTitle)}</strong><br><span class="graph-tip-sub">NOTA · ${related.length} ligação(ões) com outras notas</span>${lines.join('')}`;
  }

  canvas.addEventListener('pointermove', (e) => {
    const pos = pointerPos(e);
    if (draggedNode) {
      draggedNode.x = pos.x;
      draggedNode.y = pos.y;
      return;
    }
    if (isPanning) {
      transform.x += e.clientX - lastPointer.x;
      transform.y += e.clientY - lastPointer.y;
      lastPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    hoveredNode = nodeAt(pos);
    if (hoveredNode) {
      canvas.style.cursor = hoveredNode.type === 'item' ? 'pointer' : 'grab';
      tooltip.style.display = 'block';
      tooltip.style.left = Math.min(pos.sx + 15, Math.max(cssWidth - 260, 0)) + 'px';
      tooltip.style.top = (pos.sy + 70) + 'px';
      tooltip.innerHTML = describe(hoveredNode);
    } else {
      canvas.style.cursor = 'grab';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    const pos = pointerPos(e);
    hoveredNode = nodeAt(pos);
    pointerDown = { x: e.clientX, y: e.clientY, node: hoveredNode };
    if (hoveredNode) {
      draggedNode = hoveredNode;
      canvas.style.cursor = 'grabbing';
    } else {
      isPanning = true;
      lastPointer = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'move';
    }
  });

  function endPointer(e) {
    if (pointerDown?.node?.type === 'item' && onSelectNode) {
      const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
      if (moved <= CLICK_MOVE_TOLERANCE) onSelectNode(pointerDown.node.rawItem);
    }
    pointerDown = null;
    draggedNode = null;
    isPanning = false;
    canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => { pointerDown = null; draggedNode = null; isPanning = false; });
  canvas.addEventListener('pointerleave', () => {
    if (!draggedNode && !isPanning) {
      hoveredNode = null;
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    transform.k = Math.max(0.4, Math.min(3, transform.k * factor));
  }, { passive: false });

  resetBtn.addEventListener('click', () => { transform = { x: 0, y: 0, k: 1 }; });

  function rebuild() {
    resizeCanvas();
    buildGraphData();
    ensureLoop();
  }

  hubsBtn.addEventListener('click', () => {
    show.hubs = !show.hubs;
    hubsBtn.classList.toggle('active', show.hubs);
    rebuild();
  });
  similarBtn.addEventListener('click', () => {
    show.similar = !show.similar;
    similarBtn.classList.toggle('active', show.similar);
    rebuild();
  });

  return {
    update: (nextItems, nextLinks) => {
      items = Array.isArray(nextItems) ? nextItems : [];
      if (Array.isArray(nextLinks)) itemLinks = nextLinks;
      rebuild();
    }
  };
}
