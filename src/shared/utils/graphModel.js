// Modelo do grafo de Conexões: monta nós e ligações a partir das notas, sem tocar em DOM nem canvas.

const NOTE_KINDS = new Set(['shared', 'similar']);
const LABEL_MAX = 22;
const MIN_CLUSTER_SIZE = 2;
const INSIGHT_LIST_SIZE = 5;
const LOOSE_SAMPLE_SIZE = 8;

// O servidor devolve ligações a partir de SIMILARITY_FLOOR; o controle do grafo filtra daí para cima
export const SIMILARITY_FLOOR = 0.45;
export const DEFAULT_SIMILARITY = 0.62;
export const SIMILARITY_MAX = 0.9;

export function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const asList = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value ?? '').trim();

function truncate(text) {
  return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX - 2) + '…' : text;
}

/**
 * Ligações entre notas que valem ser mostradas: mesma citação (sempre) ou assunto parecido
 * (se ligado e com semelhança suficiente).
 */
export function selectNoteLinks(itemLinks, { similar = true, minSimilarity = DEFAULT_SIMILARITY } = {}) {
  return asList(itemLinks).filter((l) => {
    if (!l || !NOTE_KINDS.has(l.link_type)) return false;
    if (l.link_type === 'similar') return similar && Number(l.weight) >= minSimilarity;
    return true;
  });
}

function itemNode(item) {
  const title = clean(item.title) || 'Sem título';
  return {
    id: `item-${item.id}`,
    type: 'item',
    rawItem: item,
    label: truncate(title),
    fullTitle: title,
    degree: 0,
    noteDegree: 0,
    radius: 10,
    rank: 0
  };
}

function hubNode(type, value) {
  const text = clean(value);
  return {
    id: `${type === 'tag' ? 'tag' : 'ent'}-${text.toLowerCase()}`,
    type,
    value: text,
    label: type === 'tag' ? `#${text}` : text,
    fullTitle: type === 'tag' ? `#${text}` : text,
    degree: 0,
    noteDegree: 0,
    radius: 6,
    rank: 0
  };
}

// Calcula grau, raio e ordem de importância (usada para decidir quais rótulos aparecem)
function finalize(nodes, links) {
  const adjacency = new Map(nodes.map((n) => [n, []]));
  for (const n of nodes) {
    n.degree = 0;
    n.noteDegree = 0;
  }
  for (const link of links) {
    adjacency.get(link.source).push({ node: link.target, link });
    adjacency.get(link.target).push({ node: link.source, link });
    link.source.degree++;
    link.target.degree++;
    if (NOTE_KINDS.has(link.kind)) {
      link.source.noteDegree++;
      link.target.noteDegree++;
    }
  }
  for (const n of nodes) {
    n.radius = n.type === 'item'
      ? 8 + Math.min(12, 2.4 * Math.sqrt(n.degree))
      : 5 + Math.min(8, 1.6 * Math.sqrt(n.degree));
  }
  const importance = (n) => (n.type === 'item' ? n.degree + 0.5 : n.degree * 0.8);
  [...nodes]
    .sort((a, b) => importance(b) - importance(a) || a.label.localeCompare(b.label))
    .forEach((n, i) => { n.rank = i; });

  return { nodes, links, adjacency, byId: new Map(nodes.map((n) => [n.id, n])) };
}

/**
 * @returns {{nodes, links, adjacency, byId, hiddenLoose: number, noteLinkCount: number}}
 */
export function buildGraphModel({
  items,
  itemLinks,
  hubs = true,
  similar = true,
  hideLoose = false,
  minSimilarity = DEFAULT_SIMILARITY
}) {
  let nodes = [];
  let links = [];
  const byId = new Map();

  for (const item of asList(items)) {
    if (!item?.id) continue;
    const node = itemNode(item);
    nodes.push(node);
    byId.set(node.id, node);
  }
  const itemNodes = [...nodes];

  if (hubs) {
    const addHubs = (source, type, values) => {
      const seen = new Set();
      for (const value of asList(values)) {
        const text = clean(value);
        if (!text) continue;
        const candidate = hubNode(type, text);
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        let hub = byId.get(candidate.id);
        if (!hub) {
          hub = candidate;
          nodes.push(hub);
          byId.set(hub.id, hub);
        }
        links.push({ source, target: hub, kind: type });
      }
    };
    for (const node of itemNodes) {
      addHubs(node, 'tag', node.rawItem.tags);
      addHubs(node, 'entity', node.rawItem.entities);
    }
  }

  const seenPairs = new Set();
  for (const l of selectNoteLinks(itemLinks, { similar, minSimilarity })) {
    const a = byId.get(`item-${l.source_id}`);
    const b = byId.get(`item-${l.target_id}`);
    if (!a || !b || a === b) continue;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    links.push({ source: a, target: b, kind: l.link_type, labels: asList(l.labels), weight: Number(l.weight) || 0 });
  }

  let model = finalize(nodes, links);
  let hiddenLoose = 0;

  if (hideLoose) {
    // Solta = sem ligação com outra nota e sem tag/entidade compartilhada com outra nota
    const connected = new Set();
    for (const link of links) {
      if (NOTE_KINDS.has(link.kind)) {
        connected.add(link.source);
        connected.add(link.target);
      } else if (link.target.degree >= 2) {
        connected.add(link.source);
      }
    }
    const dropped = new Set(itemNodes.filter((n) => !connected.has(n)));
    hiddenLoose = dropped.size;
    if (hiddenLoose) {
      links = links.filter((l) => !dropped.has(l.source) && !dropped.has(l.target));
      const linked = new Set(links.flatMap((l) => [l.source, l.target]));
      nodes = nodes.filter((n) => !dropped.has(n) && (n.type === 'item' || linked.has(n)));
      model = finalize(nodes, links);
    }
  }

  return {
    ...model,
    hiddenLoose,
    noteLinkCount: model.links.filter((l) => NOTE_KINDS.has(l.kind)).length
  };
}

export function neighborsOf(model, node) {
  const set = new Set([node]);
  for (const { node: other } of model.adjacency.get(node) ?? []) set.add(other);
  return set;
}

/**
 * Subgrafo até `depth` passos de uma nota. Reaproveita os mesmos nós (e suas posições),
 * mas recalcula grau e rótulos: use no lugar do modelo completo, não junto com ele.
 */
export function localSubgraph(model, centerId, depth = 1) {
  const center = model.byId.get(centerId);
  if (!center) return null;
  const reached = new Set([center]);
  let frontier = [center];
  for (let step = 0; step < depth; step++) {
    const next = [];
    for (const node of frontier) {
      for (const { node: other } of model.adjacency.get(node) ?? []) {
        if (reached.has(other)) continue;
        reached.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  const nodes = model.nodes.filter((n) => reached.has(n));
  const links = model.links.filter((l) => reached.has(l.source) && reached.has(l.target));
  return {
    ...finalize(nodes, links),
    hiddenLoose: model.hiddenLoose,
    noteLinkCount: links.filter((l) => NOTE_KINDS.has(l.kind)).length
  };
}

/** Pares de notas ligadas, das mais fortes (citam o mesmo) para as mais fracas */
export function listPairs(model) {
  return model.links
    .filter((l) => NOTE_KINDS.has(l.kind))
    .map((l) => ({
      aId: l.source.rawItem.id,
      aTitle: l.source.fullTitle,
      bId: l.target.rawItem.id,
      bTitle: l.target.fullTitle,
      kind: l.kind,
      weight: l.weight,
      labels: l.labels ?? []
    }))
    .sort((x, y) => (x.kind === y.kind ? y.weight - x.weight : x.kind === 'shared' ? -1 : 1));
}

export function searchNodes(model, query, limit = 6) {
  const q = normalizeText(query).replace(/^#/, '');
  if (!q) return [];
  const scored = [];
  for (const node of model.nodes) {
    const text = normalizeText(node.type === 'item' ? node.fullTitle : node.value);
    const at = text.indexOf(q);
    if (at < 0) continue;
    scored.push({ node, score: (at === 0 ? 0 : 10) + (node.type === 'item' ? 0 : 5) + node.rank / 1000 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.node);
}

function tagSet(item) {
  return new Set(asList(item.tags).map((t) => normalizeText(t)).filter(Boolean));
}

function groupNoteIds(ids, links) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(id, root);
    return root;
  };
  for (const l of links) parent.set(find(l.source_id), find(l.target_id));
  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return [...groups.values()];
}

function clusterLabel(members) {
  const counts = new Map();
  for (const item of members) {
    for (const tag of asList(item.tags)) {
      const text = clean(tag);
      if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top ? `#${top[0]}` : members[0].title || 'Sem título';
}

/**
 * Leituras prontas do grafo: notas centrais, grupos de assunto, notas soltas e
 * pares parecidos que ainda não dividem nenhuma tag.
 */
export function computeInsights({ items, itemLinks, similar = true, minSimilarity = DEFAULT_SIMILARITY }) {
  const byId = new Map(asList(items).filter((i) => i?.id).map((i) => [i.id, i]));
  const links = selectNoteLinks(itemLinks, { similar, minSimilarity })
    .filter((l) => l.source_id !== l.target_id && byId.has(l.source_id) && byId.has(l.target_id));

  const neighbors = new Map();
  for (const l of links) {
    for (const [from, to] of [[l.source_id, l.target_id], [l.target_id, l.source_id]]) {
      if (!neighbors.has(from)) neighbors.set(from, new Set());
      neighbors.get(from).add(to);
    }
  }
  const titleOf = (id) => clean(byId.get(id)?.title) || 'Sem título';

  const topConnected = [...neighbors.entries()]
    .map(([id, set]) => ({ id, title: titleOf(id), degree: set.size }))
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
    .slice(0, INSIGHT_LIST_SIZE);

  const looseAll = [...byId.values()].filter((i) => !neighbors.has(i.id) && tagSet(i).size === 0);
  const loose = {
    count: looseAll.length,
    sample: looseAll.slice(0, LOOSE_SAMPLE_SIZE).map((i) => ({ id: i.id, title: titleOf(i.id) }))
  };

  const suggestions = links
    .filter((l) => {
      if (l.link_type !== 'similar') return false;
      const a = tagSet(byId.get(l.source_id));
      return ![...tagSet(byId.get(l.target_id))].some((t) => a.has(t));
    })
    .sort((a, b) => Number(b.weight) - Number(a.weight))
    .slice(0, INSIGHT_LIST_SIZE)
    .map((l) => ({
      aId: l.source_id,
      aTitle: titleOf(l.source_id),
      bId: l.target_id,
      bTitle: titleOf(l.target_id),
      weight: Number(l.weight)
    }));

  const clusters = groupNoteIds([...neighbors.keys()], links)
    .filter((ids) => ids.length >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b.length - a.length)
    .slice(0, INSIGHT_LIST_SIZE)
    .map((ids) => ({ label: clusterLabel(ids.map((id) => byId.get(id))), size: ids.length, ids }));

  return { totalNotes: byId.size, totalLinks: links.length, topConnected, loose, suggestions, clusters };
}
