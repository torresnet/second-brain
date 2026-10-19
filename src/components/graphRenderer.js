import { APP_CONFIG } from '../shared/constants/config.js';

const FALLBACK_COLOR = '#6C6D75';

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

function showLabel(node, focus, { model, transform }) {
  if (focus) return focus.set.has(node);
  const share = clamp((transform.k - 0.35) / 1.15, 0.12, 1);
  return node.rank < Math.max(6, Math.ceil(model.nodes.length * share));
}

/** Desenha o grafo inteiro: ligações primeiro, depois nós e rótulos. `focus` = { center, set } ou null */
export function drawGraph(ctx, { model, transform, palette, focus, selected, hovered, width, height }) {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  for (const link of model.links) {
    const style = LINK_STYLES[link.kind];
    const lit = !focus || (focus.center
      ? link.source === focus.center || link.target === focus.center
      : focus.set.has(link.source) && focus.set.has(link.target));
    ctx.globalAlpha = style.alpha * (lit ? 1 : 0.08);
    ctx.strokeStyle = palette[style.color];
    ctx.lineWidth = linkWidth(link) + (focus && lit ? 0.8 : 0);
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const fontPx = clamp(10 / transform.k, 9, 14);
  ctx.textAlign = 'center';
  for (const n of model.nodes) {
    const isHot = n === hovered || n === selected;
    ctx.globalAlpha = !focus || focus.set.has(n) ? 1 : 0.18;
    ctx.beginPath();
    ctx.arc(n.x, n.y, isHot ? n.radius + 3 : n.radius, 0, Math.PI * 2);
    ctx.fillStyle = n.type === 'tag' ? palette.tag : n.type === 'entity' ? palette.entity : n.color;
    ctx.fill();
    ctx.strokeStyle = n === selected ? palette.accent : isHot ? palette.text : palette.surface;
    ctx.lineWidth = n === selected ? 3 : isHot ? 2 : 1.5;
    ctx.stroke();

    if (!isHot && !showLabel(n, focus, { model, transform })) continue;
    ctx.font = `${isHot ? 600 : 400} ${fontPx}px Geist, system-ui, sans-serif`;
    const y = n.y + n.radius + fontPx + 3;
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.surface;
    ctx.strokeText(n.label, n.x, y);
    ctx.fillStyle = isHot ? palette.text : palette.muted;
    ctx.fillText(n.label, n.x, y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
