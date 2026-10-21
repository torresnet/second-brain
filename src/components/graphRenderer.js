import { APP_CONFIG } from '../shared/constants/config.js';

const FALLBACK_COLOR = '#6C6D75';
const LABEL_FONT_PX = 11.5;
const LABEL_GAP = 3;
const LABEL_PAD = 4;
const FULL_TITLE_ZOOM = 1.6;
const FULL_TITLE_MAX = 46;
const CULL_MARGIN = 40;
const COLLISION_CELL = 96;
const MEASURE_CACHE_MAX = 4000;

// Fios finos e translúcidos (px na tela): a malha vira textura, não massa. `fade` = faixa de zoom em que ganha corpo
const LINK_STYLES = {
  tag: { color: 'muted', px: 0.7, alpha: 0.22, fade: [0.2, 1.0] },
  entity: { color: 'entity', px: 0.7, alpha: 0.2, fade: [0.2, 1.0] },
  shared: { color: 'accent', px: 1.1, alpha: 0.38, fade: [0.15, 0.8] },
  similar: { color: 'similar', px: 0.7, alpha: 0.2, fade: [0.45, 1.3] }
};
const LINK_KIND_ORDER = ['entity', 'similar', 'tag', 'shared'];
const DIMMED_LINK_FACTOR = 0.22;
const HUB_GLOW_COUNT = 24;
const NODE_ALPHA = 0.94;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Cresce de 0 a 1 entre dois níveis de zoom
const fadeIn = (k, [from, to], floor = 0) => floor + (1 - floor) * clamp((k - from) / (to - from), 0, 1);

function focusWidthPx(link) {
  if (link.kind === 'shared') return 1.6 + Math.min(2.4, link.weight * 0.6);
  if (link.kind === 'similar') return 1.1 + clamp((link.weight - 0.5) * 4, 0, 1.6);
  return 1.2;
}

// O canvas não entende var(--cor): resolvemos as variáveis CSS do tema atual
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || FALLBACK_COLOR;
}

export function readPalette() {
  return {
    text: cssVar('--text'),
    muted: cssVar('--muted'),
    surface: cssVar('--surface'),
    line: cssVar('--line-strong'),
    accent: cssVar('--accent'),
    tag: cssVar('--graph-tag'),
    entity: cssVar('--graph-entity'),
    similar: cssVar('--graph-similar')
  };
}

export function nodeColor(item) {
  const raw = APP_CONFIG.mediaTypes[item.source_type]?.color || 'var(--badge-note)';
  const match = raw.match(/^var\((--[\w-]+)\)$/);
  return match ? cssVar(match[1]) : raw;
}

/**
 * Tamanho dos elementos no mundo. Na tela o nó cresce com k^0.15: em 4× fica ~1,2× maior (e não 4×),
 * então o zoom revela espaço em vez de empastar tudo.
 */
export const visualScale = (k) => k ** -0.85;

export const nodeDrawRadius = (node, k, extra = 0) => (node.radius + extra) * visualScale(k);

// Nós por importância, para os rótulos mais relevantes ganharem o espaço primeiro
const rankedCache = new WeakMap();
function rankedNodes(model) {
  let ranked = rankedCache.get(model);
  if (!ranked) {
    ranked = [...model.nodes].sort((a, b) => a.rank - b.rank);
    rankedCache.set(model, ranked);
  }
  return ranked;
}

const widthCache = new Map();
function textWidth(ctx, text, weight) {
  const key = `${weight}|${text}`;
  let width = widthCache.get(key);
  if (width === undefined) {
    if (widthCache.size > MEASURE_CACHE_MAX) widthCache.clear();
    width = ctx.measureText(text).width;
    widthCache.set(key, width);
  }
  return width;
}

function labelText(node, k) {
  if (k < FULL_TITLE_ZOOM || node.fullTitle.length <= node.label.length) return node.label;
  const full = node.fullTitle;
  return full.length > FULL_TITLE_MAX ? `${full.slice(0, FULL_TITLE_MAX - 1)}…` : full;
}

// Grade de retângulos já ocupados: evita rótulos por cima de rótulos
function createOccupancy() {
  const cells = new Map();
  const keysFor = (r) => {
    const keys = [];
    for (let cx = Math.floor(r.x0 / COLLISION_CELL); cx <= Math.floor(r.x1 / COLLISION_CELL); cx++) {
      for (let cy = Math.floor(r.y0 / COLLISION_CELL); cy <= Math.floor(r.y1 / COLLISION_CELL); cy++) keys.push(`${cx},${cy}`);
    }
    return keys;
  };
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  return {
    isFree(rect) {
      return keysFor(rect).every((key) => !(cells.get(key) ?? []).some((other) => overlaps(rect, other)));
    },
    add(rect) {
      for (const key of keysFor(rect)) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(rect);
      }
    }
  };
}

const linksByKindCache = new WeakMap();
function linksByKind(model) {
  let groups = linksByKindCache.get(model);
  if (!groups) {
    groups = Object.fromEntries(LINK_KIND_ORDER.map((kind) => [kind, []]));
    for (const link of model.links) groups[link.kind]?.push(link);
    linksByKindCache.set(model, groups);
  }
  return groups;
}

function drawLinks(ctx, { model, transform, palette, focus, width, height }) {
  const { x: tx, y: ty, k } = transform;
  const onScreen = (link) => {
    const ax = link.source.x * k + tx;
    const ay = link.source.y * k + ty;
    const bx = link.target.x * k + tx;
    const by = link.target.y * k + ty;
    return !((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax > width && bx > width) || (ay > height && by > height));
  };
  const isLit = (link) => (focus.center
    ? link.source === focus.center || link.target === focus.center
    : focus.set.has(link.source) && focus.set.has(link.target));
  const groups = linksByKind(model);

  ctx.lineCap = 'round';
  // Ligações em repouso: um traço único por tipo (rápido mesmo com milhares de fios)
  for (const kind of LINK_KIND_ORDER) {
    const style = LINK_STYLES[kind];
    const ambient = style.alpha * fadeIn(k, style.fade, kind === 'similar' ? 0.25 : 0.6) * (focus ? DIMMED_LINK_FACTOR : 1);
    if (ambient < 0.01) continue;
    ctx.globalAlpha = ambient;
    ctx.strokeStyle = palette[style.color];
    ctx.lineWidth = style.px / k;
    ctx.beginPath();
    for (const link of groups[kind]) {
      if (focus && isLit(link)) continue;
      if (!onScreen(link)) continue;
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
    }
    ctx.stroke();
  }
  if (!focus) return;

  // Ligações do foco: nítidas, na cor do tipo
  for (const kind of LINK_KIND_ORDER) {
    const style = LINK_STYLES[kind];
    ctx.strokeStyle = palette[kind === 'tag' ? 'accent' : style.color];
    ctx.globalAlpha = kind === 'similar' ? 0.7 : 0.85;
    for (const link of groups[kind]) {
      if (!isLit(link) || !onScreen(link)) continue;
      ctx.lineWidth = focusWidthPx(link) / k;
      ctx.setLineDash(kind === 'similar' ? [5 / k, 5 / k] : []);
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

function nodeFill(n, palette) {
  return n.type === 'tag' ? palette.tag : n.type === 'entity' ? palette.entity : n.color;
}

function drawNodes(ctx, { model, transform, palette, focus, selected, hovered, width, height }) {
  const { x: tx, y: ty, k } = transform;
  const scale = visualScale(k);
  const visible = [];
  const hot = [];
  for (const n of model.nodes) {
    const reach = nodeDrawRadius(n, k, 3) * k + CULL_MARGIN;
    const sx = n.x * k + tx;
    const sy = n.y * k + ty;
    if (sx < -reach || sy < -reach || sx > width + reach || sy > height + reach) continue;
    visible.push(n);
    if (n === hovered || n === selected) {
      hot.push(n);
      continue;
    }

    const dim = focus && !focus.set.has(n);
    ctx.globalAlpha = dim ? 0.14 : n.type === 'item' ? NODE_ALPHA : 0.8;
    ctx.beginPath();
    ctx.arc(n.x, n.y, nodeDrawRadius(n, k), 0, Math.PI * 2);
    ctx.fillStyle = nodeFill(n, palette);
    ctx.fill();
    if (!dim && n.type === 'item') {
      ctx.lineWidth = 0.9 * scale;
      ctx.strokeStyle = palette.surface;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
    }
  }

  // Hubs mais importantes ganham um brilho suave (poucos, para não custar caro)
  if (!focus) {
    const onScreen = new Set(visible);
    let glowed = 0;
    for (const n of rankedNodes(model)) {
      if (glowed >= HUB_GLOW_COUNT) break;
      if (!onScreen.has(n) || n.type !== 'item') continue;
      glowed++;
      ctx.save();
      ctx.shadowColor = n.color;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, nodeDrawRadius(n, k) * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();
      ctx.restore();
    }
  }

  for (const n of hot) {
    ctx.save();
    ctx.shadowColor = nodeFill(n, palette);
    ctx.shadowBlur = 22;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, nodeDrawRadius(n, k, 2), 0, Math.PI * 2);
    ctx.fillStyle = nodeFill(n, palette);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.lineWidth = (n === selected ? 2.4 : 1.8) * scale;
    ctx.strokeStyle = n === selected ? palette.accent : palette.text;
    ctx.stroke();
  }
  return new Set(visible);
}

// Rótulos em tamanho fixo na tela; o zoom só abre espaço para mais deles aparecerem
function drawLabels(ctx, { model, transform, palette, focus, selected, hovered }, visible) {
  const { x: tx, y: ty, k } = transform;
  const share = clamp((k - 0.5) / 1.7, 0.02, 1);
  const limit = Math.max(8, Math.ceil(model.nodes.length * share));
  const headline = Math.max(4, Math.ceil(limit * 0.25));
  const occupied = createOccupancy();
  const isHot = (n) => n === hovered || n === selected;

  const candidates = [];
  for (const n of [hovered, selected]) if (n && visible.has(n) && !candidates.includes(n)) candidates.push(n);
  for (const n of rankedNodes(model)) {
    if (!visible.has(n) || isHot(n)) continue;
    if (focus ? !focus.set.has(n) : n.rank >= limit) continue;
    candidates.push(n);
  }

  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const n of candidates) {
    const hot = isHot(n);
    const strong = hot || (!focus && n.rank < headline);
    const weight = hot ? 600 : strong ? 500 : 400;
    ctx.font = `${weight} ${LABEL_FONT_PX}px Geist, system-ui, sans-serif`;
    const text = labelText(n, hot ? FULL_TITLE_ZOOM : k);
    const w = textWidth(ctx, text, weight);
    const sx = n.x * k + tx;
    const baseline = n.y * k + ty + nodeDrawRadius(n, k, hot ? 2 : 0) * k + LABEL_FONT_PX + LABEL_GAP;
    const rect = {
      x0: sx - w / 2 - LABEL_PAD,
      x1: sx + w / 2 + LABEL_PAD,
      y0: baseline - LABEL_FONT_PX - 1,
      y1: baseline + 3
    };
    if (!hot && !occupied.isFree(rect)) continue;
    occupied.add(rect);

    const dim = focus && !focus.set.has(n);
    ctx.globalAlpha = dim ? 0.18 : strong ? 1 : 0.78;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = palette.surface;
    ctx.strokeText(text, sx, baseline);
    ctx.fillStyle = strong ? palette.text : palette.muted;
    ctx.fillText(text, sx, baseline);
  }
}

/** Desenha o grafo inteiro: ligações, nós e, por cima, os rótulos. `focus` = { center, set } ou null */
export function drawGraph(ctx, args) {
  const { transform, width, height } = args;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);
  drawLinks(ctx, args);
  const visible = drawNodes(ctx, args);
  ctx.restore();

  drawLabels(ctx, args, visible);
  ctx.globalAlpha = 1;
}
