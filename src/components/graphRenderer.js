import { APP_CONFIG } from '../shared/constants/config.js';

const FALLBACK_COLOR = '#6C6D75';
const LABEL_FONT_PX = 12;
const LABEL_GAP = 3;
const LABEL_PAD = 4;
const FULL_TITLE_ZOOM = 1.6;
const FULL_TITLE_MAX = 46;
const CULL_MARGIN = 40;
const COLLISION_CELL = 96;
const MEASURE_CACHE_MAX = 4000;

// `color` é a chave da paleta lida do tema (ver readPalette); `alpha` suaviza a linha
const LINK_STYLES = {
  tag: { color: 'line', alpha: 1, dash: [] },
  entity: { color: 'entity', alpha: 0.35, dash: [] },
  shared: { color: 'accent', alpha: 0.8, dash: [] },
  similar: { color: 'similar', alpha: 0.6, dash: [5, 5] }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function linkWidth(link) {
  if (link.kind === 'shared') return 1.5 + Math.min(3, link.weight * 0.7);
  if (link.kind === 'similar') return 0.8 + clamp((link.weight - 0.5) * 5, 0, 2.2);
  return 1;
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
 * Tamanho dos elementos no mundo. Na tela o nó cresce com k^0.3: em 4× fica ~1,5× maior (e não 4×),
 * então o zoom revela espaço em vez de empastar tudo.
 */
export const visualScale = (k) => k ** -0.7;

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

function drawLinks(ctx, { model, transform, palette, focus, width, height }) {
  const { x: tx, y: ty, k } = transform;
  const scale = visualScale(k);
  for (const link of model.links) {
    const ax = link.source.x * k + tx;
    const ay = link.source.y * k + ty;
    const bx = link.target.x * k + tx;
    const by = link.target.y * k + ty;
    if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax > width && bx > width) || (ay > height && by > height)) continue;

    const style = LINK_STYLES[link.kind];
    const lit = !focus || (focus.center
      ? link.source === focus.center || link.target === focus.center
      : focus.set.has(link.source) && focus.set.has(link.target));
    ctx.globalAlpha = style.alpha * (lit ? 1 : 0.08);
    ctx.strokeStyle = palette[style.color];
    ctx.lineWidth = (linkWidth(link) + (focus && lit ? 0.8 : 0)) * scale;
    ctx.setLineDash(style.dash.map((d) => d * scale));
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawNodes(ctx, { model, transform, palette, focus, selected, hovered, width, height }) {
  const { x: tx, y: ty, k } = transform;
  const scale = visualScale(k);
  const visible = [];
  for (const n of model.nodes) {
    const reach = nodeDrawRadius(n, k, 3) * k + CULL_MARGIN;
    const sx = n.x * k + tx;
    const sy = n.y * k + ty;
    if (sx < -reach || sy < -reach || sx > width + reach || sy > height + reach) continue;
    visible.push(n);

    const isHot = n === hovered || n === selected;
    ctx.globalAlpha = !focus || focus.set.has(n) ? 1 : 0.18;
    ctx.beginPath();
    ctx.arc(n.x, n.y, nodeDrawRadius(n, k, isHot ? 3 : 0), 0, Math.PI * 2);
    ctx.fillStyle = n.type === 'tag' ? palette.tag : n.type === 'entity' ? palette.entity : n.color;
    ctx.fill();
    ctx.strokeStyle = n === selected ? palette.accent : isHot ? palette.text : palette.surface;
    ctx.lineWidth = (n === selected ? 3 : isHot ? 2 : 1.5) * scale;
    ctx.stroke();
  }
  return new Set(visible);
}

// Rótulos em tamanho fixo na tela; o zoom só abre espaço para mais deles aparecerem
function drawLabels(ctx, { model, transform, palette, focus, selected, hovered }, visible) {
  const { x: tx, y: ty, k } = transform;
  const share = clamp((k - 0.35) / 1.15, 0.12, 1);
  const limit = Math.max(6, Math.ceil(model.nodes.length * share));
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
    const weight = hot ? 600 : 400;
    ctx.font = `${weight} ${LABEL_FONT_PX}px Geist, system-ui, sans-serif`;
    const text = labelText(n, hot ? FULL_TITLE_ZOOM : k);
    const w = textWidth(ctx, text, weight);
    const sx = n.x * k + tx;
    const baseline = n.y * k + ty + nodeDrawRadius(n, k, hot ? 3 : 0) * k + LABEL_FONT_PX + LABEL_GAP;
    const rect = {
      x0: sx - w / 2 - LABEL_PAD,
      x1: sx + w / 2 + LABEL_PAD,
      y0: baseline - LABEL_FONT_PX - 1,
      y1: baseline + 3
    };
    if (!hot && !occupied.isFree(rect)) continue;
    occupied.add(rect);

    ctx.globalAlpha = !focus || focus.set.has(n) ? 1 : 0.18;
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.surface;
    ctx.strokeText(text, sx, baseline);
    ctx.fillStyle = hot ? palette.text : palette.muted;
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
