import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGraphModel,
  computeInsights,
  localSubgraph,
  neighborsOf,
  searchNodes,
  selectNoteLinks
} from '../../src/shared/utils/graphModel.js';
import {
  ALPHA_DECAY,
  ALPHA_MIN,
  MAX_ZOOM,
  MIN_ZOOM,
  fitTransform,
  stepSimulation,
  zoomAt
} from '../../src/shared/utils/graphPhysics.js';
import { DEFAULT_PREFS, loadGraphPrefs, sanitizePrefs, saveGraphPrefs } from '../../src/shared/utils/graphPrefs.js';

const item = (id, title, tags = [], entities = []) => ({ id, title, tags, entities, source_type: 'article' });
const shared = (a, b, labels = ['X'], weight = 1) => ({ source_id: a, target_id: b, link_type: 'shared', weight, labels });
const similar = (a, b, weight) => ({ source_id: a, target_id: b, link_type: 'similar', weight, labels: [] });

const ITEMS = [
  item('a', 'Alfa', ['ia', 'dev']),
  item('b', 'Beta', ['ia']),
  item('c', 'Gama', ['dev']),
  item('d', 'Delta', []),
  item('e', 'Épsilon Único', ['raro'])
];
const LINKS = [shared('a', 'b'), similar('a', 'c', 0.7), similar('b', 'c', 0.5)];

test('constrói nós de notas, tags e ligações entre notas', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  assert.equal(m.nodes.filter((n) => n.type === 'item').length, 5);
  assert.equal(m.nodes.filter((n) => n.type === 'tag').length, 3);
  assert.equal(m.noteLinkCount, 2, 'a similar de 0.5 fica abaixo da semelhança mínima padrão');
});

test('o controle de semelhança filtra só ligações de assunto parecido', () => {
  const low = buildGraphModel({ items: ITEMS, itemLinks: LINKS, minSimilarity: 0.45 });
  assert.equal(low.noteLinkCount, 3);
  const high = buildGraphModel({ items: ITEMS, itemLinks: LINKS, minSimilarity: 0.9 });
  assert.equal(high.noteLinkCount, 1);
  const off = buildGraphModel({ items: ITEMS, itemLinks: LINKS, similar: false, minSimilarity: 0.45 });
  assert.equal(off.noteLinkCount, 1);
});

test('sem tags e entidades, só ficam as notas', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS, hubs: false });
  assert.ok(m.nodes.every((n) => n.type === 'item'));
});

test('tag repetida na mesma nota gera uma ligação só', () => {
  const m = buildGraphModel({ items: [item('a', 'A', ['IA', 'ia'])], itemLinks: [] });
  assert.equal(m.links.length, 1);
});

test('ligações para notas inexistentes ou repetidas são ignoradas', () => {
  const m = buildGraphModel({
    items: ITEMS,
    itemLinks: [shared('a', 'zzz'), shared('a', 'b'), shared('b', 'a'), shared('a', 'a')]
  });
  assert.equal(m.noteLinkCount, 1);
});

test('tamanho do nó cresce com o número de ligações', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  const radius = (id) => m.byId.get(`item-${id}`).radius;
  assert.ok(radius('a') > radius('d'));
});

test('ocultar soltas remove notas sem ligação nem tag compartilhada', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS, hideLoose: true });
  assert.equal(m.hiddenLoose, 2);
  assert.ok(!m.byId.has('item-d'));
  assert.ok(!m.byId.has('item-e'));
  assert.ok(!m.byId.has('tag-raro'), 'tag órfã some junto');
  assert.ok(m.byId.has('item-a'));
});

test('nota que só compartilha tag com outra não é solta', () => {
  const m = buildGraphModel({
    items: [item('x', 'X', ['t']), item('y', 'Y', ['t']), item('z', 'Z', ['u'])],
    itemLinks: [],
    hideLoose: true
  });
  assert.equal(m.hiddenLoose, 1);
  assert.ok(m.byId.has('item-x') && m.byId.has('item-y'));
});

test('grafo local de 1 passo inclui vizinhos diretos e tags da nota', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  const sub = localSubgraph(m, 'item-a', 1);
  const ids = sub.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['item-a', 'item-b', 'item-c', 'tag-dev', 'tag-ia']);
  assert.equal(localSubgraph(m, 'item-nao-existe', 1), null);
});

test('grafo local de 2 passos alcança mais nós que 1 passo', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  const one = localSubgraph(m, 'item-d', 1).nodes.length;
  const m2 = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  const two = localSubgraph(m2, 'item-b', 2).nodes.length;
  assert.equal(one, 1);
  assert.ok(two > 3);
});

test('vizinhos de um nó incluem o próprio nó', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  const a = m.byId.get('item-a');
  const set = neighborsOf(m, a);
  assert.ok(set.has(a) && set.has(m.byId.get('item-b')));
});

test('busca no grafo ignora acento e caixa, e prioriza notas', () => {
  const m = buildGraphModel({ items: ITEMS, itemLinks: LINKS });
  assert.equal(searchNodes(m, 'epsilon')[0].id, 'item-e');
  assert.equal(searchNodes(m, 'IA').some((n) => n.id === 'tag-ia'), true);
  assert.equal(searchNodes(m, '#ia')[0].id, 'tag-ia', 'o # inicial é ignorado');
  assert.deepEqual(searchNodes(m, '   '), []);
});

test('insights: mais conectadas, grupos, soltas e pares sem tag em comum', () => {
  const ins = computeInsights({
    items: ITEMS,
    itemLinks: [...LINKS, similar('c', 'd', 0.8)],
    minSimilarity: 0.62
  });
  assert.equal(ins.topConnected[0].degree, 2);
  assert.deepEqual(ins.topConnected.slice(0, 2).map((t) => t.id).sort(), ['a', 'c']);
  assert.equal(ins.clusters.length, 1);
  assert.equal(ins.clusters[0].size, 4);
  assert.deepEqual(ins.loose.sample.map((s) => s.id), []);
  assert.equal(ins.suggestions[0].bId, 'd', 'Delta não tem tags: nenhum par em comum com Gama');
});

test('insights: nota sem tag e sem ligação aparece como solta', () => {
  const ins = computeInsights({ items: ITEMS, itemLinks: [] });
  assert.deepEqual(ins.loose.sample.map((s) => s.id), ['d']);
  assert.equal(ins.clusters.length, 0);
});

test('selectNoteLinks descarta tipos desconhecidos e entradas inválidas', () => {
  const out = selectNoteLinks([null, { link_type: 'x' }, shared('a', 'b')]);
  assert.equal(out.length, 1);
  assert.deepEqual(selectNoteLinks(undefined), []);
});

// ---------- física ----------

function randomNodes(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, x: 400 + Math.random() * 300, y: 300 + Math.random() * 300, vx: 0, vy: 0, radius: 10
  }));
}

test('a simulação esfria e para sem gerar valores inválidos', () => {
  const nodes = randomNodes(60);
  const links = nodes.slice(1).map((n, i) => ({ source: nodes[i], target: n, kind: 'shared' }));
  let alpha = 1;
  let ticks = 0;
  while (alpha > ALPHA_MIN) {
    stepSimulation(nodes, links, { cx: 500, cy: 400, alpha });
    alpha *= ALPHA_DECAY;
    ticks++;
  }
  assert.ok(ticks < 600);
  assert.ok(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('nós sobrepostos se afastam', () => {
  const a = { x: 100, y: 100, vx: 0, vy: 0, radius: 10 };
  const b = { x: 101, y: 100, vx: 0, vy: 0, radius: 10 };
  for (let i = 0; i < 20; i++) stepSimulation([a, b], [], { cx: 100, cy: 100, alpha: 1 });
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 30);
});

test('nó fixado não se move', () => {
  const a = { x: 100, y: 100, vx: 0, vy: 0, radius: 10 };
  const b = { x: 110, y: 100, vx: 0, vy: 0, radius: 10 };
  stepSimulation([a, b], [], { cx: 400, cy: 400, alpha: 1, pinned: a });
  assert.deepEqual([a.x, a.y], [100, 100]);
});

test('coordenadas inválidas voltam ao centro', () => {
  const a = { x: NaN, y: 5, vx: 0, vy: 0, radius: 10 };
  stepSimulation([a], [], { cx: 50, cy: 60, alpha: 1 });
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
});

test('zoom mantém fixo o ponto sob o cursor', () => {
  const t = { x: 10, y: 20, k: 1 };
  const next = zoomAt(t, 200, 150, 2);
  const worldBefore = [(200 - t.x) / t.k, (150 - t.y) / t.k];
  const worldAfter = [(200 - next.x) / next.k, (150 - next.y) / next.k];
  assert.ok(Math.abs(worldBefore[0] - worldAfter[0]) < 1e-9);
  assert.ok(Math.abs(worldBefore[1] - worldAfter[1]) < 1e-9);
});

test('zoom respeita os limites', () => {
  let t = { x: 0, y: 0, k: 1 };
  for (let i = 0; i < 40; i++) t = zoomAt(t, 0, 0, 2);
  assert.equal(t.k, MAX_ZOOM);
  for (let i = 0; i < 80; i++) t = zoomAt(t, 0, 0, 0.5);
  assert.equal(t.k, MIN_ZOOM);
});

test('enquadrar tudo coloca todos os nós dentro da área visível', () => {
  const nodes = [
    { x: -500, y: -300, radius: 10 },
    { x: 900, y: 700, radius: 10 }
  ];
  const t = fitTransform(nodes, 800, 600);
  for (const n of nodes) {
    const sx = n.x * t.k + t.x;
    const sy = n.y * t.k + t.y;
    assert.ok(sx >= 0 && sx <= 800 && sy >= 0 && sy <= 600);
  }
  assert.deepEqual(fitTransform([], 800, 600), { x: 0, y: 0, k: 1 });
});

// ---------- preferências ----------

test('preferências inválidas voltam ao padrão', () => {
  assert.deepEqual(sanitizePrefs(null), DEFAULT_PREFS);
  const p = sanitizePrefs({ minSimilarity: 5, transform: { x: 1, y: 'a', k: 1 }, hubs: false });
  assert.equal(p.minSimilarity, 0.9);
  assert.equal(p.transform, null);
  assert.equal(p.hubs, false);
});

test('preferências são salvas e lidas do armazenamento', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveGraphPrefs(storage, { ...DEFAULT_PREFS, hideLoose: true, transform: { x: 5, y: 6, k: 2 } });
  const loaded = loadGraphPrefs(storage);
  assert.equal(loaded.hideLoose, true);
  assert.deepEqual(loaded.transform, { x: 5, y: 6, k: 2 });
});

test('armazenamento quebrado ou ausente não derruba o grafo', () => {
  const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cheio'); } };
  assert.deepEqual(loadGraphPrefs(broken), DEFAULT_PREFS);
  assert.doesNotThrow(() => saveGraphPrefs(broken, DEFAULT_PREFS));
  assert.deepEqual(loadGraphPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(loadGraphPrefs({ getItem: () => '{json ruim' }), DEFAULT_PREFS);
});
