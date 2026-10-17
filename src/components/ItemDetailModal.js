import { formatDateBR, getMediaBadge, getStageBadge, downloadMarkdownFile, copyToClipboard } from '../shared/utils/formatters.js';
import { getItemAtoms } from '../shared/services/supabaseClient.js';
import { atomCardHtml } from './KnowledgeView.js';

const ANALYSIS_LABELS = {
  pending: 'Aguardando indexação avançada',
  processing: 'Indexando…',
  done: 'Indexada',
  partial: 'Indexada parcialmente',
  failed: 'Falha na indexação'
};

export function createItemDetailModal({ onDelete, onReprocess, getRelated, onOpenRelated }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'item-detail-modal';

  let currentItem = null;

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <span id="modal-source-badge" class="source-badge"></span>
          <span id="modal-stage-badge" class="source-badge" style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-color); color: var(--text-secondary);"></span>
          <span id="modal-date" style="font-size: 0.8rem; color: var(--text-muted);"></span>
        </div>
        <button id="modal-close-btn" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer; padding: 0.2rem 0.5rem;">✕</button>
      </div>

      <div class="modal-body">
        <h2 id="modal-title" style="font-size: 1.35rem; line-height: 1.3; color: var(--text-primary);"></h2>
        
        <div id="modal-link-container" style="display: none;">
          <a id="modal-source-link" href="#" target="_blank" rel="noopener noreferrer" style="font-size: 0.85rem; color: var(--accent-cyan); display: inline-flex; align-items: center; gap: 0.4rem; text-decoration: none; word-break: break-all;">
            🔗 Abrir link original da fonte ↗
          </a>
        </div>

        <!-- Seção: Entidades & Conceitos Relacionados (Inspirado em SamurAIGPT e Karpathy Wiki) -->
        <div id="modal-entities-section" style="display: none; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: var(--radius-md); padding: 0.75rem 1rem;">
          <div style="font-size: 0.8rem; font-weight: 600; color: #818cf8; margin-bottom: 0.35rem;">
            🧬 Entidades & Conceitos Vinculados ([[Wikilinks]])
          </div>
          <div id="modal-entities-container" style="display: flex; flex-wrap: wrap; gap: 0.4rem;"></div>
        </div>

        <!-- Seção: Resumo Executivo -->
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem 1.25rem;">
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--accent-indigo); margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.4rem;">
            💡 Resumo Executivo
          </div>
          <p id="modal-summary" style="font-size: 0.95rem; color: var(--text-secondary); line-height: 1.6; white-space: pre-line;"></p>
        </div>

        <!-- Seção: Pontos Chave -->
        <div id="modal-takeaways-section" style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: none;">
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--accent-cyan); margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
            🎯 Pontos-Chave (Takeaways)
          </div>
          <ul id="modal-takeaways-list" style="list-style: none; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);"></ul>
        </div>

        <!-- Seção: Ações Práticas / GTD (Inspirado em Mindwtr) -->
        <div id="modal-actions-section" style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-md); padding: 1rem 1.25rem; display: none;">
          <div style="font-size: 0.85rem; font-weight: 600; color: #34d399; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem;">
            ⚡ Próximas Ações Recomendadas (Next Actions)
          </div>
          <ul id="modal-actions-list" style="list-style: none; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);"></ul>
        </div>

        <!-- Seção: Conteúdo Bruto / Transcrição -->
        <div id="modal-raw-section" style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">
              📝 Transcrição / Conteúdo Completo
            </div>
            <button id="modal-copy-raw-btn" style="background: rgba(255, 255, 255, 0.08); border: none; color: var(--text-secondary); font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: var(--radius-sm); cursor: pointer;">
              Copiar texto
            </button>
          </div>
          <div id="modal-raw-content" style="max-height: 200px; overflow-y: auto; font-size: 0.88rem; color: var(--text-muted); line-height: 1.6; font-family: inherit; white-space: pre-wrap;"></div>
        </div>

        <!-- Notas relacionadas (backlinks, como no Obsidian) -->
        <div id="modal-related-section" style="display: none;">
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--accent-indigo); margin-bottom: 0.5rem;">🔗 Notas relacionadas</div>
          <div id="modal-related-list" class="related-list"></div>
        </div>

        <!-- Conhecimento extraído (ferramentas, links, códigos, ideias...) -->
        <div id="modal-atoms-section" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.6rem;">
            <div style="font-size: 0.85rem; font-weight: 600; color: var(--accent-cyan);">
              🧩 Conhecimento extraído <span id="modal-atoms-count" style="color: var(--text-muted); font-weight: 400;"></span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span id="modal-analysis-status" style="font-size: 0.78rem; color: var(--text-muted);"></span>
              <button id="modal-reprocess-btn" class="pill-btn" type="button">Reprocessar</button>
            </div>
          </div>
          <div id="modal-atoms-list" class="knowledge-list"></div>
        </div>

        <!-- Tags -->
        <div id="modal-tags-container" style="display: flex; flex-wrap: wrap; gap: 0.4rem;"></div>
      </div>

      <div class="modal-footer" style="justify-content: space-between;">
        <button id="modal-delete-btn" style="background: transparent; border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; padding: 0.5rem 1rem; border-radius: var(--radius-full); cursor: pointer; font-size: 0.85rem;">
          Excluir
        </button>

        <div style="display: flex; gap: 0.6rem;">
          <button id="modal-download-md-btn" style="background: rgba(99, 102, 241, 0.15); border: 1px solid var(--accent-indigo); color: #818cf8; padding: 0.5rem 1rem; border-radius: var(--radius-full); cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 0.4rem;">
            📥 Baixar Markdown (.md)
          </button>
          <button id="modal-close-footer-btn" class="btn-primary" style="padding: 0.5rem 1.2rem; font-size: 0.85rem;">
            Fechar
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Elementos internos
  const badgeEl = overlay.querySelector('#modal-source-badge');
  const stageBadgeEl = overlay.querySelector('#modal-stage-badge');
  const dateEl = overlay.querySelector('#modal-date');
  const titleEl = overlay.querySelector('#modal-title');
  const linkContainer = overlay.querySelector('#modal-link-container');
  const sourceLink = overlay.querySelector('#modal-source-link');
  const summaryEl = overlay.querySelector('#modal-summary');

  const entitiesSection = overlay.querySelector('#modal-entities-section');
  const entitiesContainer = overlay.querySelector('#modal-entities-container');

  const takeawaysSection = overlay.querySelector('#modal-takeaways-section');
  const takeawaysList = overlay.querySelector('#modal-takeaways-list');

  const actionsSection = overlay.querySelector('#modal-actions-section');
  const actionsList = overlay.querySelector('#modal-actions-list');

  const relatedSection = overlay.querySelector('#modal-related-section');
  const relatedList = overlay.querySelector('#modal-related-list');
  const atomsSection = overlay.querySelector('#modal-atoms-section');
  const atomsList = overlay.querySelector('#modal-atoms-list');
  const atomsCount = overlay.querySelector('#modal-atoms-count');
  const analysisStatusEl = overlay.querySelector('#modal-analysis-status');
  const reprocessBtn = overlay.querySelector('#modal-reprocess-btn');

  const rawContentEl = overlay.querySelector('#modal-raw-content');
  const tagsContainer = overlay.querySelector('#modal-tags-container');

  const closeBtn = overlay.querySelector('#modal-close-btn');
  const closeFooterBtn = overlay.querySelector('#modal-close-footer-btn');
  const copyRawBtn = overlay.querySelector('#modal-copy-raw-btn');
  const downloadMdBtn = overlay.querySelector('#modal-download-md-btn');
  const deleteBtn = overlay.querySelector('#modal-delete-btn');

  function open(item) {
    currentItem = item;
    const badge = getMediaBadge(item.source_type);
    badgeEl.className = `source-badge ${badge.cssClass}`;
    badgeEl.innerHTML = `${badge.icon} ${badge.label}`;

    // Estágio do Jardim Digital
    const stage = getStageBadge(item.stage || 'budding');
    stageBadgeEl.innerHTML = `${stage.icon} ${stage.label}`;
    stageBadgeEl.style.borderColor = stage.color;

    dateEl.innerText = formatDateBR(item.created_at);
    titleEl.innerText = item.title;

    if (item.source_url && /^https?:\/\//i.test(item.source_url)) {
      sourceLink.href = item.source_url;
      sourceLink.innerText = `🔗 ${item.source_url.slice(0, 60)}...`;
      linkContainer.style.display = 'block';
    } else {
      linkContainer.style.display = 'none';
    }

    // Entidades & Conceitos ([[Wikilinks]])
    if (Array.isArray(item.entities) && item.entities.length > 0) {
      entitiesContainer.innerHTML = item.entities
        .map(e => `<span class="tag-item" style="color: #a5b4fc; background: rgba(99, 102, 241, 0.15);">[[${escapeHtml(e)}]]</span>`)
        .join('');
      entitiesSection.style.display = 'block';
    } else {
      entitiesSection.style.display = 'none';
    }

    summaryEl.innerText = item.summary || 'Sem resumo catalogado.';

    // Takeaways
    if (Array.isArray(item.key_takeaways) && item.key_takeaways.length > 0) {
      takeawaysList.innerHTML = item.key_takeaways
        .map(t => `<li style="display: flex; align-items: flex-start; gap: 0.5rem;"><span>💡</span><span>${escapeHtml(t)}</span></li>`)
        .join('');
      takeawaysSection.style.display = 'block';
    } else {
      takeawaysSection.style.display = 'none';
    }

    // Ações Práticas (GTD)
    if (Array.isArray(item.action_items) && item.action_items.length > 0) {
      actionsList.innerHTML = item.action_items
        .map(a => `<li style="display: flex; align-items: center; gap: 0.5rem;"><input type="checkbox" style="cursor: pointer; accent-color: #10b981;" /><span>${escapeHtml(a)}</span></li>`)
        .join('');
      actionsSection.style.display = 'block';
    } else {
      actionsSection.style.display = 'none';
    }

    rawContentEl.innerText = item.raw_content || 'Nenhuma transcrição ou texto bruto gravado.';

    // Tags
    if (Array.isArray(item.tags) && item.tags.length > 0) {
      tagsContainer.innerHTML = item.tags
        .map(t => `<span class="tag-item">#${escapeHtml(t)}</span>`)
        .join('');
    } else {
      tagsContainer.innerHTML = '';
    }

    renderRelated(item);
    renderAtoms(item);
    overlay.classList.add('active');
  }

  function renderRelated(item) {
    const related = getRelated ? getRelated(item.id) : [];
    relatedSection.style.display = related.length ? 'block' : 'none';
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

  async function renderAtoms(item) {
    const hasStatus = typeof item.analysis_status === 'string';
    atomsSection.style.display = hasStatus ? 'block' : 'none';
    atomsList.innerHTML = '';
    atomsCount.innerText = '';
    if (!hasStatus) return;

    analysisStatusEl.innerText = ANALYSIS_LABELS[item.analysis_status] || '';
    reprocessBtn.style.display = onReprocess ? '' : 'none';
    reprocessBtn.disabled = false;
    reprocessBtn.innerText = item.analysis_status === 'done' ? 'Reprocessar' : 'Indexar agora';

    try {
      const atoms = await getItemAtoms(item.id);
      if (!currentItem || currentItem.id !== item.id) return;
      atomsCount.innerText = `(${atoms.length})`;
      atomsList.innerHTML = atoms.length
        ? atoms.map(a => atomCardHtml(a, { showSource: false })).join('')
        : '<div class="knowledge-empty">Nenhum item extraído ainda.</div>';
    } catch (err) {
      atomsList.innerHTML = `<div class="knowledge-empty chat-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function close() {
    overlay.classList.remove('active');
    currentItem = null;
  }

  closeBtn.addEventListener('click', close);
  closeFooterBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  copyRawBtn.addEventListener('click', async () => {
    if (!currentItem) return;
    const textToCopy = currentItem.raw_content || currentItem.summary || '';
    const success = await copyToClipboard(textToCopy);
    if (success) {
      copyRawBtn.innerText = 'Copiado! ✓';
      setTimeout(() => { copyRawBtn.innerText = 'Copiar texto'; }, 2000);
    }
  });

  downloadMdBtn.addEventListener('click', () => {
    if (currentItem) {
      downloadMarkdownFile(currentItem);
    }
  });

  reprocessBtn.addEventListener('click', async () => {
    if (!currentItem || !onReprocess) return;
    const item = currentItem;
    reprocessBtn.disabled = true;
    reprocessBtn.innerText = 'Processando…';
    analysisStatusEl.innerText = 'Isso pode levar até 1 minuto.';
    try {
      const updated = await onReprocess(item.id);
      if (updated && currentItem && currentItem.id === item.id) {
        currentItem = updated;
        renderAtoms(updated);
      }
    } catch (err) {
      analysisStatusEl.innerText = err.message;
      reprocessBtn.disabled = false;
      reprocessBtn.innerText = 'Tentar de novo';
    }
  });

  atomsList.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.md-copy-btn');
    if (!copyBtn) return;
    const code = copyBtn.closest('.md-code')?.querySelector('code')?.textContent || '';
    if (await copyToClipboard(code)) {
      copyBtn.innerText = 'Copiado ✓';
      setTimeout(() => { copyBtn.innerText = 'Copiar'; }, 1800);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentItem) return;
    const confirmDelete = confirm(`Deseja realmente remover a nota "${currentItem.title}" do Segundo Cérebro?`);
    if (confirmDelete && onDelete) {
      await onDelete(currentItem.id);
      close();
    }
  });

  return { open, close };
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
