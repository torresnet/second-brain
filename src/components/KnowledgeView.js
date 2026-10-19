import { getAtoms, getBrainItemById, getBrainOverview } from '../shared/services/supabaseClient.js';
import { copyToClipboard } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';
import { skeletonCardsHtml } from '../shared/utils/skeleton.js';

const PAGE_SIZE = 40;

export function atomCardHtml(atom, { showSource = true } = {}) {
  const url = atom.url && /^https?:\/\//i.test(atom.url) ? atom.url : null;
  const fetchNote = atom.fetch_status === 'ok'
    ? '<span class="atom-chip atom-chip-ok">link lido</span>'
    : atom.fetch_status
      ? `<span class="atom-chip atom-chip-warn" title="${escapeHtml(atom.fetch_error || '')}">link não lido</span>`
      : '';
  const inferred = atom.inferred ? '<span class="atom-chip atom-chip-warn" title="O endereço não aparece no material original">link inferido pela IA</span>' : '';
  const source = showSource && atom.brain_items?.title
    ? `<button type="button" class="atom-source" data-item-id="${escapeHtml(atom.item_id)}">de: ${escapeHtml(atom.brain_items.title)}</button>`
    : '';

  return `
    <article class="atom-card">
      <div class="atom-head">
        <span class="atom-kind">${escapeHtml(atom.kind)}</span>
        <h4>${escapeHtml(atom.name)}</h4>
        ${fetchNote}${inferred}
      </div>
      ${url ? `<a class="atom-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ''}
      ${atom.explanation ? `<p>${escapeHtml(atom.explanation)}</p>` : ''}
      ${atom.use_for ? `<p class="atom-usefor"><strong>Para que serve / onde é usado:</strong> ${escapeHtml(atom.use_for)}</p>` : ''}
      ${atom.contents_summary ? `<p class="atom-inside"><strong>O que tem dentro do link:</strong> ${escapeHtml(atom.contents_summary)}</p>` : ''}
      ${atom.content ? `
        <div class="md-code">
          <div class="md-code-head"><span>${escapeHtml(atom.language || 'conteúdo')}</span><button type="button" class="md-copy-btn">Copiar</button></div>
          <pre><code>${escapeHtml(atom.content)}</code></pre>
        </div>` : ''}
      ${source}
    </article>`;
}

export function createKnowledgeView(container, { onOpenItem }) {
  container.innerHTML = `
    <div class="section-heading">
      <h1>Conhecimento</h1>
      <p>Ferramentas, links, códigos e ideias que a IA tirou de tudo o que você salvou.</p>
    </div>
    <div class="knowledge-controls">
      <div class="search-wrapper">
        ${icon('search', 'search-icon')}
        <input type="text" id="knowledge-search" class="search-input" placeholder="Filtrar ferramentas, links, códigos, ideias..." />
      </div>
      <div class="chip-row scroll" id="knowledge-kinds"></div>
    </div>
    <div id="knowledge-list" class="knowledge-list"></div>
    <div style="text-align: center; margin-top: 1rem;">
      <button id="knowledge-more" class="chip-btn" type="button" style="display: none;">Carregar mais</button>
    </div>
  `;

  const searchInput = container.querySelector('#knowledge-search');
  const kindsBox = container.querySelector('#knowledge-kinds');
  const listBox = container.querySelector('#knowledge-list');
  const moreBtn = container.querySelector('#knowledge-more');

  const state = { kind: '', search: '', offset: 0, requestId: 0 };
  let searchTimer = null;

  function renderKinds(byKind) {
    const entries = Object.entries(byKind || {}).sort((a, b) => b[1] - a[1]);
    kindsBox.innerHTML = [
      `<button class="chip-btn ${state.kind ? '' : 'active'}" type="button" data-kind="">Todos</button>`,
      ...entries.map(([kind, count]) =>
        `<button class="chip-btn ${state.kind === kind ? 'active' : ''}" type="button" data-kind="${escapeHtml(kind)}">${escapeHtml(kind)} <span class="chip-count">${count}</span></button>`)
    ].join('');
  }

  async function load({ reset }) {
    const requestId = ++state.requestId;
    if (reset) {
      state.offset = 0;
      listBox.innerHTML = skeletonCardsHtml();
    }
    try {
      const atoms = await getAtoms({ kind: state.kind, search: state.search, limit: PAGE_SIZE, offset: state.offset });
      if (requestId !== state.requestId) return;
      if (reset) listBox.innerHTML = '';
      if (reset && atoms.length === 0) {
        listBox.innerHTML = '<div class="knowledge-empty">Nada encontrado. Capture mais conteúdo ou ajuste o filtro.</div>';
      }
      listBox.insertAdjacentHTML('beforeend', atoms.map(a => atomCardHtml(a)).join(''));
      state.offset += atoms.length;
      moreBtn.style.display = atoms.length === PAGE_SIZE ? '' : 'none';
    } catch (err) {
      if (requestId !== state.requestId) return;
      listBox.innerHTML = `<div class="knowledge-empty chat-error">Não foi possível carregar o catálogo: ${escapeHtml(err.message)}<br>Se a migração do banco ainda não foi aplicada, aplique <code>supabase/migrations</code>.</div>`;
      moreBtn.style.display = 'none';
    }
  }

  async function refresh() {
    try {
      renderKinds((await getBrainOverview()).by_kind);
    } catch {
      renderKinds({});
    }
    await load({ reset: true });
  }

  kindsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    state.kind = btn.dataset.kind;
    kindsBox.querySelectorAll('.chip-btn').forEach(b => b.classList.toggle('active', b === btn));
    load({ reset: true });
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = searchInput.value.trim();
      load({ reset: true });
    }, 300);
  });

  moreBtn.addEventListener('click', () => load({ reset: false }));

  listBox.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.md-copy-btn');
    if (copyBtn) {
      const code = copyBtn.closest('.md-code')?.querySelector('code')?.textContent || '';
      if (await copyToClipboard(code)) {
        copyBtn.textContent = 'Copiado ✓';
        setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1800);
      }
      return;
    }
    const sourceBtn = e.target.closest('.atom-source');
    if (sourceBtn && onOpenItem) {
      const item = await getBrainItemById(sourceBtn.dataset.itemId).catch(() => null);
      if (item) onOpenItem(item);
    }
  });

  return { refresh };
}
