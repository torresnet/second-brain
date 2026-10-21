// Física e geometria do grafo: simulação de forças com grade espacial, zoom e enquadramento.

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
export const ALPHA_DECAY = 0.99;
export const ALPHA_MIN = 0.02;

const REPULSE_RADIUS = 240;
const REPULSE_DIVISOR = 8;
const GRAVITY = 0.002;
const COLLISION_GAP = 6;
const COLLISION_STRENGTH = 0.5;
const SPRING = 0.035;
const DAMPING = 0.88;
const MAX_SPEED = 40;
const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 1.5;
const CELL_KEY_STRIDE = 100003;

export const LINK_LENGTH = { tag: 70, entity: 85, shared: 120, similar: 160 };

export function clampZoom(k) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Zoom que mantém fixo o ponto (sx, sy) da tela */
export function zoomAt(transform, sx, sy, factor) {
  const k = clampZoom(transform.k * factor);
  const ratio = k / transform.k;
  return { k, x: sx - (sx - transform.x) * ratio, y: sy - (sy - transform.y) * ratio };
}

/** Transformação que enquadra todos os nós na área visível */
export function fitTransform(nodes, width, height, padding = FIT_PADDING) {
  if (!nodes.length || width < 2 || height < 2) return { x: 0, y: 0, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.radius);
    maxX = Math.max(maxX, n.x + n.radius);
    minY = Math.min(minY, n.y - n.radius);
    maxY = Math.max(maxY, n.y + n.radius);
  }
  const boxW = Math.max(maxX - minX, 1);
  const boxH = Math.max(maxY - minY, 1);
  const k = Math.min(
    FIT_MAX_ZOOM,
    clampZoom(Math.min((width - padding * 2) / boxW, (height - padding * 2) / boxH))
  );
  return {
    k,
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k
  };
}

export function easeTransform(from, to, amount) {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    k: from.k + (to.k - from.k) * amount
  };
}

const cellKey = (cx, cy) => cx * CELL_KEY_STRIDE + cy;

function repel(a, b, alpha) {
  const dx = b.x - a.x || (Math.random() - 0.5) * 0.1;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist >= REPULSE_RADIUS) return;
  const force = ((REPULSE_RADIUS - dist) / (dist * REPULSE_DIVISOR)) * alpha;
  a.vx -= dx * force;
  a.vy -= dy * force;
  b.vx += dx * force;
  b.vy += dy * force;

  const minDist = a.radius + b.radius + COLLISION_GAP;
  if (dist < minDist) {
    const push = ((minDist - dist) / dist) * COLLISION_STRENGTH * Math.max(alpha, 0.3);
    a.vx -= dx * push;
    a.vy -= dy * push;
    b.vx += dx * push;
    b.vy += dy * push;
  }
}

/**
 * Um passo da simulação. `alpha` (1 → 0) escala todas as forças: quando esfria, o grafo para.
 * A repulsão usa uma grade de células do tamanho do raio de alcance: custo ~linear, não quadrático.
 */
export function stepSimulation(nodes, links, { cx, cy, alpha, pinned = null }) {
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
      n.x = cx;
      n.y = cy;
      n.vx = 0;
      n.vy = 0;
    }
    n.vx += (cx - n.x) * GRAVITY * alpha;
    n.vy += (cy - n.y) * GRAVITY * alpha;
  }

  const grid = new Map();
  nodes.forEach((n, i) => {
    n.idx = i;
    const key = cellKey(Math.floor(n.x / REPULSE_RADIUS), Math.floor(n.y / REPULSE_RADIUS));
    const bucket = grid.get(key);
    if (bucket) bucket.push(n);
    else grid.set(key, [n]);
  });
  for (const a of nodes) {
    const gx = Math.floor(a.x / REPULSE_RADIUS);
    const gy = Math.floor(a.y / REPULSE_RADIUS);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(cellKey(gx + ox, gy + oy));
        if (!bucket) continue;
        for (const b of bucket) if (b.idx > a.idx) repel(a, b, alpha);
      }
    }
  }
  for (const link of links) {
    const a = link.source;
    const b = link.target;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const force = (dist - LINK_LENGTH[link.kind]) * SPRING * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const n of nodes) {
    if (n === pinned) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vx * DAMPING));
    n.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n.vy * DAMPING));
    n.x += n.vx;
    n.y += n.vy;
  }
}
