import { APP_CONFIG } from '../shared/constants/config.js';
import { escapeHtml as esc } from '../shared/utils/markdown.js';

const LIST_LIMIT = 300;

const typeLabel = (item) => APP_CONFIG.mediaTypes[item?.source_type]?.label ?? 'Nota';
const percent = (weight) => `${Math.round(weight * 100)}%`;

function reason(link) {
  return link.kind === 'shared'
    ? `cita ${(link.labels ?? []).slice(0, 3).join(', ') || 'o mesmo conteúdo'}`
    : `assunto parecido (${percent(link.weight)})`;
}

const noteRow = (node, why) => `
  <button type="button" class="gp-row" data-action="select-node" data-node-id="${esc(node.id)}">
    <strong>${esc(node.fullTitle)}</strong>${why ? `<span>${esc(why)}</span>` : ''}
  </button>`;

const idRow = (id, title, why) => noteRow({ id: `item-${id}`, fullTitle: title }, why);

const section = (title, body) => `<section class="gp-section"><h3>${esc(title)}</h3>${body}</section>`;
const empty = (text) => `<p class="gp-empty">${esc(text)}</p>`;
const clearBtn = '<button type="button" class="chip-btn" data-action="clear">Limpar seleção</button>';

function itemPanel(node, model) {
  const edges = model.adjacency.get(node) ?? [];
  const notes = edges.filter((e) => e.node.type === 'item').sort((a, b) => b.link.weight - a.link.weight);
  const hubs = edges.filter((e) => e.node.type !== 'item');
  const id = esc(node.rawItem.id);
  return `
    <div class="gp-head"><span class="gp-kicker">NOTA · ${esc(typeLabel(node.rawItem))}</span><h2>${esc(node.fullTitle)}</h2></div>
    <div class="gp-actions">
      <button type="button" class="chip-btn active" data-action="open-note" data-id="${id}">Abrir nota</button>
      <button type="button" class="chip-btn" data-action="show-local" data-id="${id}">Ver só as conexões</button>
      ${clearBtn}
    </div>
    ${hubs.length ? `<div class="gp-chips">${hubs.map((e) => `<button type="button" class="chip-btn" data-action="select-node" data-node-id="${esc(e.node.id)}">${esc(e.node.label)}</button>`).join('')}</div>` : ''}
    ${section(`Liga com ${notes.length} nota(s)`, notes.length
      ? notes.map((e) => noteRow(e.node, reason(e.link))).join('')
      : empty('Nenhuma outra nota se liga a esta por enquanto.'))}`;
}

function hubPanel(node, model) {
  const notes = (model.adjacency.get(node) ?? []).map((e) => e.node).filter((n) => n.type === 'item');
  const isTag = node.type === 'tag';
  return `
    <div class="gp-head"><span class="gp-kicker">${isTag ? 'TAG' : 'ENTIDADE'}</span><h2>${esc(node.label)}</h2></div>
    <div class="gp-actions">
      ${isTag ? `<button type="button" class="chip-btn active" data-action="filter-tag" data-tag="${esc(node.value)}">Filtrar o Acervo por esta tag</button>` : ''}
      ${clearBtn}
    </div>
    ${section(`${notes.length} nota(s)`, notes.map((n) => noteRow(n, '')).join(''))}`;
}

function groupPanel(selection) {
  return `
    <div class="gp-head"><span class="gp-kicker">${esc(selection.kicker)}</span><h2>${esc(selection.label)}</h2></div>
    <div class="gp-actions">${clearBtn}</div>
    ${section(`${selection.nodes.length} nota(s)`, selection.nodes.map((n) => noteRow(n, '')).join(''))}`;
}

export function selectionHtml(selection, model) {
  if (selection.type === 'group') return groupPanel(selection);
  return selection.node.type === 'item' ? itemPanel(selection.node, model) : hubPanel(selection.node, model);
}

export function insightsHtml(insights) {
  const { topConnected, clusters, suggestions, loose } = insights;
  const summary = `<p class="gp-summary">${insights.totalNotes} nota(s) · ${insights.totalLinks} ligação(ões) entre notas.
    Toque ou clique em uma nota, tag ou entidade para ver os detalhes.</p>`;

  const top = section('Mais conectadas', topConnected.length
    ? topConnected.map((t) => idRow(t.id, t.title, `${t.degree} ligação(ões)`)).join('')
    : empty('Ainda não há notas ligadas entre si.'));

  const groups = section('Grupos de assunto', clusters.length
    ? clusters.map((c) => `
        <button type="button" class="gp-row" data-action="focus-group" data-label="${esc(c.label)}" data-ids="${esc(c.ids.join(','))}">
          <strong>${esc(c.label)}</strong><span>${c.size} notas ligadas</span>
        </button>`).join('')
    : empty('Os grupos aparecem quando notas se ligam em cadeia.'));

  const maybe = section('Talvez ligar', suggestions.length
    ? suggestions.map((s) => `
        <button type="button" class="gp-row" data-action="focus-pair" data-a="${esc(s.aId)}" data-b="${esc(s.bId)}">
          <strong>${esc(s.aTitle)} ↔ ${esc(s.bTitle)}</strong><span>assunto parecido (${percent(s.weight)}), sem nenhuma tag em comum</span>
        </button>`).join('')
    : empty('Nenhum par parecido sem tag em comum.'));

  const looseBlock = section(`Soltas (${loose.count})`, loose.count
    ? `<p class="gp-empty">Sem tags e sem ligações: vale classificar.</p>${loose.sample.map((l) => idRow(l.id, l.title, '')).join('')}`
    : empty('Nenhuma nota solta.'));

  return summary + top + groups + maybe + looseBlock;
}

export function listHtml(pairs) {
  if (!pairs.length) {
    return empty('Nenhuma ligação entre notas ainda. Capture mais conteúdo ou reduza a semelhança mínima.');
  }
  const shown = pairs.slice(0, LIST_LIMIT);
  const rows = shown.map((p) => `
    <li class="gl-pair">
      <button type="button" data-action="select-node" data-node-id="item-${esc(p.aId)}">${esc(p.aTitle)}</button>
      <span class="gl-arrow" aria-hidden="true">↔</span>
      <button type="button" data-action="select-node" data-node-id="item-${esc(p.bId)}">${esc(p.bTitle)}</button>
      <span class="gl-why">${esc(reason(p))}</span>
    </li>`).join('');
  const more = pairs.length > shown.length
    ? `<p class="gp-empty">Mostrando ${shown.length} de ${pairs.length} ligações (as mais fortes).</p>`
    : '';
  return `<ul class="gl-list">${rows}</ul>${more}`;
}

export function legendHtml(items, { hubs, similar, hasShared, hasSimilar }) {
  const types = [...new Set(items.map((i) => i.source_type).filter((t) => APP_CONFIG.mediaTypes[t]?.color))];
  const dots = (types.length ? types : ['note']).map((t) => {
    const def = APP_CONFIG.mediaTypes[t];
    return `<span><i class="dot" style="background:${def.color}"></i> ${esc(def.label)}</span>`;
  });
  const parts = [...dots];
  if (hubs) {
    parts.push('<span><i class="dot small dot-tag"></i> Tag</span>', '<span><i class="dot small dot-entity"></i> Entidade</span>');
  }
  if (hasShared) parts.push('<span><i class="line line-shared"></i> Citam a mesma coisa</span>');
  if (similar && hasSimilar) parts.push('<span><i class="line dashed"></i> Assunto parecido</span>');
  parts.push('<span class="gp-hint">Tamanho = nº de ligações · linha mais grossa = ligação mais forte</span>');
  return parts.join('');
}
