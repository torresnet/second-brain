import { getDuplicatePairs, setDuplicateDecision } from '../shared/services/supabaseClient.js';
import { toDuplicatePair, previewText } from '../shared/utils/duplicatePairs.js';
import { safeHttpUrl } from '../shared/utils/obsidianExport.js';
import { formatDateBR, getMediaBadge } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { friendlyError } from '../shared/utils/friendlyError.js';
import { skeletonCardsHtml } from '../shared/utils/skeleton.js';

const PAIR_LIMIT = 100;

function linkHtml(url) {
  const href = safeHttpUrl(url);
  if (!href) return '<span class="pair-link pair-link-none">sem link</span>';
  return `<a class="pair-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(href.replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
}

function noteHtml(note, role) {
  const badge = getMediaBadge(note.type);
  const preview = previewText(note.summary);
  const isLong = note.summary.length > preview.length;
  return `
    <div class="pair-note" data-note="${escapeHtml(note.id)}">
      <div class="pair-note-head">
        <span class="pair-role">${role}</span>
        <span class="atom-chip">${escapeHtml(badge.label)}</span>
        <span class="pair-date">${escapeHtml(formatDateBR(note.createdAt))}</span>
      </div>
      <strong class="pair-title">${escapeHtml(note.title)}</strong>
      ${linkHtml(note.url)}
      <p class="pair-summary" data-full="${escapeHtml(note.summary)}" data-short="${escapeHtml(preview)}">${note.summary ? escapeHtml(preview) : '<em>Sem resumo ainda.</em>'}</p>
      <div class="pair-note-actions">
        ${isLong ? '<button type="button" class="chip-btn" data-act="expand" aria-expanded="false">Ler tudo</button>' : ''}
        <button type="button" class="chip-btn" data-act="open" data-id="${escapeHtml(note.id)}">Abrir nota</button>
      </div>
    </div>`;
}

export function pairCardHtml(pair) {
  return `
    <article class="atom-card pair-card" data-pair="${escapeHtml(pair.key)}">
      <div class="atom-head">
        <span class="atom-chip atom-chip-warn">${escapeHtml(pair.label)}</span>
        <span class="atom-kind">${pair.reason === 'mesmo_link' ? 'Mesmo endereço salvo duas vezes' : 'Conteúdo quase igual'}</span>
      </div>
      <div class="pair-notes">
        ${noteHtml(pair.older, 'Mais antiga')}
        ${noteHtml(pair.newer, 'Mais nova')}
      </div>
      <div class="pair-status" role="status"></div>
      <div class="errlog-actions">
        <button type="button" class="chip-btn" data-act="keep">Manter as duas</button>
        <button type="button" class="chip-btn" data-act="merge" title="A IA lê as duas notas, junta o que é novo, tira o que se repete e dá um título novo. Fica a nota mais antiga.">Unificar</button>
      </div>
    </article>`;
}

/**
 * Notas duplicadas lado a lado (título, link, data e resumo), para decidir sem abrir cada nota.
 * onCount recebe a quantidade de pares pendentes sempre que a lista é carregada ou muda.
 */
export function createDuplicatesView(container, { onOpenItem, onMerge, onCount } = {}) {
  container.innerHTML = `
    <div class="errlog-toolbar">
      <button type="button" class="chip-btn" data-act="refresh">Atualizar</button>
    </div>
    <div class="pair-list knowledge-list"></div>`;

  const listBox = container.querySelector('.pair-list');
  let pairs = [];
  let requestId = 0;
  let pendingDecisions = 0;

  function render(message = '') {
    onCount?.(pairs.length);
    if (message) {
      listBox.innerHTML = `<div class="knowledge-empty">${escapeHtml(message)}</div>`;
      return;
    }
    listBox.innerHTML = pairs.length
      ? pairs.map(pairCardHtml).join('')
      : '<div class="knowledge-empty">Nenhuma nota duplicada. Tudo certo por aqui.</div>';
  }

  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    if (!quiet && !pairs.length) listBox.innerHTML = skeletonCardsHtml(2);
    try {
      const result = await getDuplicatePairs({ limit: PAIR_LIMIT });
      // Uma decisão em andamento é dona dos botões do cartão: não reconstruir a lista por cima dela
      if (current !== requestId || pendingDecisions) return;
      pairs = result.pairs.map(toDuplicatePair);
      render(result.unavailable
        ? 'A busca de duplicatas ainda não está disponível. Aplique a migration 20261021110000_duplicate_pairs.sql.'
        : '');
    } catch (err) {
      if (current !== requestId || quiet) return;
      if (!pairs.length) render(`Não foi possível carregar as duplicatas. ${friendlyError(err)}`);
    }
  }

  function removePair(key) {
    pairs = pairs.filter((p) => p.key !== key);
    render();
  }

  async function decide(card, pair, action) {
    const status = card.querySelector('.pair-status');
    const buttons = card.querySelectorAll('.errlog-actions button');
    const setBusy = (busy) => buttons.forEach((b) => { b.disabled = busy; });

    if (action === 'merge') {
      const ok = window.confirm(`Unificar “${pair.newer.title}” em “${pair.older.title}”?\n\nA IA junta o conhecimento das duas, sem repetições, e cria um título novo. A nota mais antiga é mantida e a outra sai da lista (o texto original dela fica guardado nas fontes). Se a IA estiver sem cota, a unificação espera na fila e termina sozinha.`);
      if (!ok) return;
    }

    pendingDecisions++;
    setBusy(true);
    status.textContent = action === 'merge' ? 'Unificando…' : 'Salvando…';
    try {
      if (action === 'keep') await setDuplicateDecision(pair.older.id, pair.newer.id);
      else await onMerge(pair.older.id, pair.newer.id);
      pendingDecisions--;
      removePair(pair.key);
      load({ quiet: true });
    } catch (err) {
      pendingDecisions--;
      status.textContent = friendlyError(err);
      setBusy(false);
    }
  }

  container.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'refresh') return load();

    if (act === 'expand') {
      const summary = button.closest('.pair-note').querySelector('.pair-summary');
      const open = button.getAttribute('aria-expanded') !== 'true';
      summary.textContent = open ? summary.dataset.full : summary.dataset.short;
      summary.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'Ler menos' : 'Ler tudo';
      return;
    }
    if (act === 'open') return onOpenItem?.(button.dataset.id);

    const card = button.closest('[data-pair]');
    const pair = card && pairs.find((p) => p.key === card.dataset.pair);
    if (pair && (act === 'keep' || act === 'merge')) decide(card, pair, act);
  });

  return { refresh: load, getCount: () => pairs.length };
}
