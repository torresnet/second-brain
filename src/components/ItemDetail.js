import { formatDateBR, getMediaBadge, getStageBadge, downloadMarkdownFile, copyToClipboard } from '../shared/utils/formatters.js';
import { getItemAtoms, getPossibleDuplicates, setDuplicateDecision } from '../shared/services/supabaseClient.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { friendlyError } from '../shared/utils/friendlyError.js';
import { icon } from '../shared/utils/icons.js';
import { indexStatus, noteExamples, noteOrigin } from '../shared/utils/noteView.js';
import { atomCardHtml } from './KnowledgeView.js';

const COPY_FEEDBACK_MS = 2000;

/**
 * Ficha da nota. Abre no painel de leitura ao lado da lista (`inline`) ou como janela
 * sobreposta (celular e demais seções). O mesmo elemento é movido entre os dois lugares.
 */
export function createItemDetail({ readerPane, onDelete, onReprocess, getRelated, onOpenRelated, onMerge, onOpened, onClosed }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'item-detail-modal';
  overlay.innerHTML = '<div class="modal-box detail-box"></div>';
  const overlayBox = overlay.querySelector('.modal-box');
  document.body.appendChild(overlay);

  const placeholder = [...readerPane.childNodes];

  const root = document.createElement('article');
  root.className = 'detail';
  root.innerHTML = `
    <header class="detail-head">
      <span id="detail-type" class="type-chip"></span>
      <span id="detail-stage" class="stage-chip"></span>
      <span id="detail-date" class="detail-date"></span>
      <div class="detail-head-actions">
        <a id="detail-source-link" class="icon-btn" href="#" target="_blank" rel="noopener noreferrer" aria-label="Abrir fonte original" title="Abrir fonte original">${icon('external')}</a>
        <button id="detail-close-btn" class="icon-btn" type="button" aria-label="Fechar">${icon('close')}</button>
      </div>
    </header>

    <div class="detail-body">
      <div class="detail-top">
        <h2 id="detail-title" class="detail-title"></h2>
        <div id="detail-origin" class="detail-origin"></div>

        <section id="detail-index-section" class="detail-index" hidden>
          <div class="detail-index-text">
            <strong id="detail-index-label"></strong>
            <span id="detail-analysis-status" class="detail-hint"></span>
          </div>
          <button id="detail-reprocess-btn" class="chip-btn" type="button">Reprocessar</button>
        </section>
      </div>

      <section id="detail-dup-section" class="detail-callout callout-warn" hidden>
        <div class="detail-label">${icon('alert')}Possível duplicata</div>
        <div id="detail-dup-list"></div>
        <div id="detail-dup-status" class="dup-status"></div>
      </section>

      <p id="detail-summary" class="detail-summary"></p>

      <section id="detail-takeaways-section" hidden>
        <div class="detail-label">${icon('target')}Pontos-chave</div>
        <ul id="detail-takeaways-list" class="detail-bullets"></ul>
      </section>

      <section id="detail-atoms-section" hidden>
        <div class="detail-label">${icon('atom')}Extraído do conteúdo <span id="detail-atoms-count" class="detail-count"></span></div>
        <div id="detail-atoms-list" class="knowledge-list compact"></div>
      </section>

      <section id="detail-examples-section" hidden>
        <div class="detail-label">${icon('lightbulb')}Como aplicar na prática</div>
        <div id="detail-examples-list" class="example-list"></div>
      </section>

      <section id="detail-related-section" hidden>
        <div class="detail-label">${icon('graph')}Aparece também em</div>
        <div id="detail-related-list" class="related-list"></div>
      </section>

      <section id="detail-entities-section" hidden>
        <div class="detail-label">${icon('hash')}Pessoas, marcas e conceitos</div>
        <div id="detail-entities" class="chip-row"></div>
      </section>

      <details class="detail-raw">
        <summary>
          <span class="detail-label">${icon('doc')}Transcrição e conteúdo completo</span>
          <button id="detail-copy-raw-btn" class="chip-btn" type="button">Copiar texto</button>
        </summary>
        <div id="detail-raw-content" class="detail-raw-content"></div>
      </details>

      <div id="detail-tags" class="chip-row"></div>
    </div>

    <footer class="detail-foot">
      <button id="detail-delete-btn" class="btn-ghost danger" type="button">${icon('trash')}Excluir</button>
      <button id="detail-download-md-btn" class="btn-ghost" type="button">${icon('download')}Baixar .md</button>
    </footer>
  `;

  const $ = (id) => root.querySelector(`#${id}`);
  const typeEl = $('detail-type');
  const stageEl = $('detail-stage');
  const dateEl = $('detail-date');
  const titleEl = $('detail-title');
  const sourceLink = $('detail-source-link');
  const originEl = $('detail-origin');
  const indexSection = $('detail-index-section');
  const indexLabel = $('detail-index-label');
  const summaryEl = $('detail-summary');
  const takeawaysSection = $('detail-takeaways-section');
  const takeawaysList = $('detail-takeaways-list');
  const examplesSection = $('detail-examples-section');
  const examplesList = $('detail-examples-list');
  const entitiesSection = $('detail-entities-section');
  const entitiesEl = $('detail-entities');
  const dupSection = $('detail-dup-section');
  const dupList = $('detail-dup-list');
  const dupStatus = $('detail-dup-status');
  const relatedSection = $('detail-related-section');
  const relatedList = $('detail-related-list');
  const atomsSection = $('detail-atoms-section');
  const atomsList = $('detail-atoms-list');
  const atomsCount = $('detail-atoms-count');
  const analysisStatusEl = $('detail-analysis-status');
  const reprocessBtn = $('detail-reprocess-btn');
  const rawDetails = root.querySelector('.detail-raw');
  const rawContentEl = $('detail-raw-content');
  const tagsEl = $('detail-tags');
  const copyRawBtn = $('detail-copy-raw-btn');
  const downloadMdBtn = $('detail-download-md-btn');
  const deleteBtn = $('detail-delete-btn');
  const closeBtn = $('detail-close-btn');

  let currentItem = null;
  let placement = null; // 'inline' | 'overlay' | null

  function place(inline) {
    if (inline) {
      overlay.classList.remove('active');
      if (root.parentNode !== readerPane) readerPane.replaceChildren(root);
      placement = 'inline';
    } else {
      if (placement === 'inline') readerPane.replaceChildren(...placeholder);
      if (root.parentNode !== overlayBox) overlayBox.appendChild(root);
      overlay.classList.add('active');
      placement = 'overlay';
    }
    root.classList.toggle('is-inline', inline);
  }

  function open(item, { inline = false } = {}) {
    currentItem = item;
    const badge = getMediaBadge(item.source_type);
    typeEl.className = `type-chip ${badge.cssClass}`;
    typeEl.innerHTML = `${badge.icon}${escapeHtml(badge.label)}`;

    const stage = getStageBadge(item.stage || 'budding');
    stageEl.className = `stage-chip ${stage.cssClass}`;
    stageEl.textContent = stage.short;
    stageEl.title = stage.label;

    dateEl.textContent = formatDateBR(item.created_at);
    titleEl.textContent = item.title || 'Sem título';

    const hasUrl = Boolean(item.source_url && /^https?:\/\//i.test(item.source_url));
    sourceLink.hidden = !hasUrl;
    if (hasUrl) sourceLink.href = item.source_url;
    renderOrigin(item, hasUrl);
    renderIndexStatus(item);

    summaryEl.textContent = item.summary || 'Sem resumo catalogado.';

    const takeaways = Array.isArray(item.key_takeaways) ? item.key_takeaways : [];
    takeawaysList.innerHTML = takeaways.map(t => `<li>${escapeHtml(t)}</li>`).join('');
    takeawaysSection.hidden = !takeaways.length;

    renderExamples(item);

    const entities = Array.isArray(item.entities) ? item.entities : [];
    entitiesEl.innerHTML = entities.map(e => `<span class="chip">${escapeHtml(e)}</span>`).join('');
    entitiesSection.hidden = !entities.length;

    rawContentEl.textContent = item.raw_content || 'Nenhuma transcrição ou texto bruto gravado.';
    rawDetails.open = false;

    const tags = Array.isArray(item.tags) ? item.tags : [];
    tagsEl.innerHTML = tags.map(t => `<span class="chip chip-tag">#${escapeHtml(t)}</span>`).join('');

    renderDuplicates(item);
    renderRelated(item);
    renderAtoms(item);

    place(inline);
    root.querySelector('.detail-body').scrollTop = 0;
    if (onOpened) onOpened(item);
  }

  async function renderDuplicates(item) {
    dupSection.hidden = true;
    dupList.innerHTML = '';
    dupStatus.textContent = '';
    const duplicates = await getPossibleDuplicates(item.id).catch(() => []);
    if (!currentItem || currentItem.id !== item.id || !duplicates.length) return;
    dupSection.hidden = false;
    dupList.innerHTML = duplicates.map(d => `
      <div class="dup-card" data-id="${escapeHtml(d.id)}" data-created="${escapeHtml(d.created_at)}">
        <div class="dup-text">
          <strong>${escapeHtml(d.title || 'Sem título')}</strong>
          <span>${d.reason === 'mesmo_link' ? 'mesmo link' : `${Math.round(d.similarity * 100)}% parecida`} · salva em ${escapeHtml(formatDateBR(d.created_at))}</span>
        </div>
        <div class="dup-actions">
          <button type="button" class="chip-btn" data-dup="open">Ver a outra nota</button>
          <button type="button" class="chip-btn" data-dup="keep">Manter as duas</button>
          <button type="button" class="chip-btn" data-dup="merge" title="Junta o conteúdo das duas e mantém a nota mais antiga">Mesclar</button>
          <button type="button" class="chip-btn danger" data-dup="delete">Apagar esta</button>
        </div>
      </div>`).join('');
  }

  dupList.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-dup]');
    const card = e.target.closest('.dup-card');
    if (!button || !card || !currentItem) return;
    const action = button.dataset.dup;
    const otherId = card.dataset.id;
    const otherTitle = card.querySelector('strong')?.textContent || 'a outra nota';
    const item = currentItem;

    if (action === 'open') {
      if (onOpenRelated) onOpenRelated(otherId);
      return;
    }
    if (action === 'delete') {
      deleteBtn.click();
      return;
    }

    const buttons = card.querySelectorAll('button');
    try {
      if (action === 'keep') {
        buttons.forEach(b => { b.disabled = true; });
        await setDuplicateDecision(item.id, otherId);
        card.remove();
        if (!dupList.children.length) dupSection.hidden = true;
      } else if (action === 'merge' && onMerge) {
        const otherIsOlder = new Date(card.dataset.created) < new Date(item.created_at);
        const keep = otherIsOlder ? otherId : item.id;
        const keepTitle = otherIsOlder ? otherTitle : item.title;
        const removeTitle = otherIsOlder ? item.title : otherTitle;
        const ok = confirm(`Juntar “${removeTitle}” em “${keepTitle}”?\n\nO conteúdo das duas fica na nota mais antiga e a outra é apagada. Isso não pode ser desfeito.`);
        if (!ok) return;
        buttons.forEach(b => { b.disabled = true; });
        dupStatus.textContent = 'Mesclando…';
        await onMerge(keep, otherIsOlder ? item.id : otherId);
      }
    } catch (err) {
      buttons.forEach(b => { b.disabled = false; });
      dupStatus.textContent = err.message;
    }
  });

  function renderRelated(item) {
    const related = getRelated ? getRelated(item.id) : [];
    relatedSection.hidden = !related.length;
    relatedList.innerHTML = related
      .map(r => `<button type="button" class="related-item" data-id="${escapeHtml(r.id)}">
          <strong>${escapeHtml(r.title || 'Sem título')}</strong>
          <span>${r.type === 'shared' ? 'ambas citam: ' + escapeHtml((r.labels || []).slice(0, 4).join(', ') || 'o mesmo conteúdo') : 'assunto parecido'}</span>
        </button>`)
      .join('');
  }

  relatedList.addEventListener('click', (e) => {
    const btn = e.target.closest('.related-item');
    if (btn && onOpenRelated) onOpenRelated(btn.dataset.id);
  });

  function renderOrigin(item, hasUrl) {
    const origin = noteOrigin(item);
    originEl.innerHTML = hasUrl && origin.href
      ? `${icon('link')}<a href="${escapeHtml(origin.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(origin.text)}</a>`
      : `${icon('note')}<span>${escapeHtml(origin.text)}</span>`;
  }

  function renderIndexStatus(item) {
    const status = indexStatus(item);
    indexSection.hidden = !status;
    if (!status) return;
    indexSection.dataset.tone = status.tone;
    indexLabel.textContent = status.label;
    analysisStatusEl.textContent = status.reason;
    reprocessBtn.hidden = !onReprocess;
    reprocessBtn.disabled = false;
    reprocessBtn.textContent = status.action;
  }

  function renderExamples(item) {
    const examples = noteExamples(item);
    examplesList.innerHTML = examples.map((e, i) => `
      <div class="example-card">
        <div class="example-title"><span>${i + 1}</span>${escapeHtml(e.title)}</div>
        ${e.scenario ? `<div class="example-scenario">${escapeHtml(e.scenario)}</div>` : ''}
        ${e.how ? `<div class="example-how">${escapeHtml(e.how)}</div>` : ''}
        ${Array.isArray(e.uses) && e.uses.length ? `<div class="chip-row">${e.uses.map(u => `<span class="chip">${escapeHtml(u)}</span>`).join('')}</div>` : ''}
      </div>`).join('');
    examplesSection.hidden = !examples.length;
  }

  async function renderAtoms(item) {
    // Só notas indexadas (ou em indexação) têm o que listar; o status e o botão ficam no topo da nota
    const hasStatus = typeof item.analysis_status === 'string';
    atomsSection.hidden = !hasStatus;
    atomsList.innerHTML = '';
    atomsCount.textContent = '';
    if (!hasStatus) return;

    try {
      const atoms = await getItemAtoms(item.id);
      if (!currentItem || currentItem.id !== item.id) return;
      atomsCount.textContent = String(atoms.length);
      atomsList.innerHTML = atoms.length
        ? atoms.map(a => atomCardHtml(a, { showSource: false })).join('')
        : '<div class="knowledge-empty">Nenhum item extraído ainda.</div>';
    } catch (err) {
      atomsList.innerHTML = `<div class="knowledge-empty chat-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function close() {
    if (placement === 'inline') readerPane.replaceChildren(...placeholder);
    overlay.classList.remove('active');
    const closedId = currentItem?.id ?? null;
    placement = null;
    currentItem = null;
    if (closedId && onClosed) onClosed(closedId);
  }

  function flash(button, text, original) {
    button.textContent = text;
    setTimeout(() => { button.textContent = original; }, COPY_FEEDBACK_MS);
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    // Outra janela aberta por cima (ex.: captura) fica com o Escape
    const otherOverlayOpen = [...document.querySelectorAll('.modal-overlay.active')].some(el => el !== overlay);
    if (e.key === 'Escape' && placement === 'overlay' && !otherOverlayOpen) close();
  });

  copyRawBtn.addEventListener('click', async (e) => {
    e.preventDefault(); // não abre/fecha o <details>
    if (!currentItem) return;
    if (await copyToClipboard(currentItem.raw_content || currentItem.summary || '')) {
      flash(copyRawBtn, 'Copiado ✓', 'Copiar texto');
    }
  });

  downloadMdBtn.addEventListener('click', () => {
    if (currentItem) downloadMarkdownFile(currentItem);
  });

  reprocessBtn.addEventListener('click', async () => {
    if (!currentItem || !onReprocess) return;
    const item = currentItem;
    reprocessBtn.disabled = true;
    reprocessBtn.textContent = 'Processando…';
    indexSection.dataset.tone = 'warn';
    indexLabel.textContent = indexStatus({ analysis_status: 'processing' }).label;
    analysisStatusEl.textContent = 'Isso pode levar até 1 minuto.';
    try {
      const updated = await onReprocess(item.id);
      if (updated && currentItem && currentItem.id === item.id) {
        currentItem = updated;
        renderIndexStatus(updated);
        renderExamples(updated);
        renderAtoms(updated);
      }
    } catch (err) {
      if (!currentItem || currentItem.id !== item.id) return;
      indexSection.dataset.tone = 'danger';
      indexLabel.textContent = indexStatus({ analysis_status: 'failed' }).label;
      analysisStatusEl.textContent = friendlyError(err);
      reprocessBtn.disabled = false;
      reprocessBtn.textContent = 'Tentar de novo';
    }
  });

  atomsList.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.md-copy-btn');
    if (!copyBtn) return;
    const code = copyBtn.closest('.md-code')?.querySelector('code')?.textContent || '';
    if (await copyToClipboard(code)) flash(copyBtn, 'Copiado ✓', 'Copiar');
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentItem) return;
    const confirmDelete = confirm(`Deseja realmente remover a nota "${currentItem.title}" do Segundo Cérebro?`);
    if (confirmDelete && onDelete) {
      await onDelete(currentItem.id);
      close();
    }
  });

  // Move a ficha aberta entre painel e janela (ex.: a janela do navegador mudou de largura)
  function reposition(inline) {
    if (currentItem && placement && (placement === 'inline') !== inline) place(inline);
  }

  return {
    open,
    close,
    reposition,
    currentId: () => currentItem?.id ?? null,
    isInline: () => placement === 'inline'
  };
}
