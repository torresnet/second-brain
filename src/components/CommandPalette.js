import { detectIntent } from '../shared/utils/intent.js';
import { getMediaBadge } from '../shared/utils/formatters.js';
import { escapeHtml } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';

const MAX_ITEM_RESULTS = 6;

const INTENT_LABELS = {
  capture: { icon: 'link', text: 'Link detectado' },
  ask: { icon: 'chat', text: 'Pergunta detectada' },
  search: { icon: 'search', text: 'Busca' }
};

/**
 * Barra de comando única (Ctrl K): colar um link captura, uma pergunta vai para o chat,
 * um termo busca no acervo. A ação sugerida vem primeiro; as outras continuam disponíveis.
 */
export function createCommandPalette({ findItems, onCapture, onOpenCapture, onAsk, onSearch, onOpenItem }) {
  const overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="Barra de comando">
      <div class="palette-input-row">
        ${icon('search')}
        <input id="palette-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="Cole um link, faça uma pergunta ou busque…" aria-controls="palette-results" />
        <span id="palette-intent" class="palette-intent" hidden></span>
      </div>
      <div id="palette-results" class="palette-results" role="listbox"></div>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> executar</span><span><kbd>Esc</kbd> fechar</span></div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#palette-input');
  const intentEl = overlay.querySelector('#palette-intent');
  const results = overlay.querySelector('#palette-results');
  let actions = [];
  let activeIndex = 0;
  let lastFocus = null;

  function buildActions(intent) {
    const text = intent.text;
    const capture = intent.kind === 'capture' && [
      { group: 'Ação', icon: 'plus', label: 'Capturar este link', detail: intent.url, run: () => onCapture({ url: intent.url, hint: intent.hint }) },
      { group: 'Ação', icon: 'layers', label: 'Capturar com mais opções', detail: 'Abre a janela de captura', run: () => onOpenCapture({ url: intent.url, title: intent.hint }) }
    ];
    const ask = { group: 'Ação', icon: 'chat', label: 'Perguntar ao cérebro', detail: text, run: () => onAsk(text) };
    const search = { group: 'Ação', icon: 'search', label: 'Buscar no acervo', detail: text, run: () => onSearch(text) };

    if (intent.kind === 'empty') {
      return [
        { group: 'Capturar', icon: 'link', label: 'Link, Reel ou vídeo', run: () => onOpenCapture({ mode: 'link' }) },
        { group: 'Capturar', icon: 'note', label: 'Anotação de texto', run: () => onOpenCapture({ mode: 'note' }) },
        { group: 'Capturar', icon: 'mic', label: 'Gravar voz', run: () => onOpenCapture({ mode: 'voice' }) },
        { group: 'Capturar', icon: 'paperclip', label: 'Anexar arquivo', run: () => onOpenCapture({ mode: 'file' }) }
      ];
    }
    if (capture) return capture;

    const primary = intent.kind === 'ask' ? [ask, search] : [search, ask];
    const items = findItems(text).slice(0, MAX_ITEM_RESULTS).map(item => {
      const badge = getMediaBadge(item.source_type);
      return { group: 'Notas', iconHtml: badge.icon, label: item.title || 'Sem título', detail: badge.label, run: () => onOpenItem(item) };
    });
    return [...primary, ...items];
  }

  function render() {
    const intent = detectIntent(input.value);
    actions = buildActions(intent);
    activeIndex = Math.min(activeIndex, Math.max(actions.length - 1, 0));

    const label = INTENT_LABELS[intent.kind];
    intentEl.hidden = !label;
    if (label) intentEl.innerHTML = `${icon(label.icon)}${label.text}`;

    let lastGroup = '';
    results.innerHTML = actions.map((action, i) => {
      const header = action.group !== lastGroup ? `<div class="palette-group">${escapeHtml(action.group)}</div>` : '';
      lastGroup = action.group;
      return `${header}
        <button type="button" class="palette-item${i === activeIndex ? ' active' : ''}" role="option"
                aria-selected="${i === activeIndex}" data-index="${i}">
          ${action.iconHtml || icon(action.icon)}
          <span class="palette-label">${escapeHtml(action.label)}</span>
          ${action.detail ? `<span class="palette-detail">${escapeHtml(action.detail)}</span>` : ''}
        </button>`;
    }).join('');
  }

  function setActive(index) {
    if (!actions.length) return;
    activeIndex = (index + actions.length) % actions.length;
    results.querySelectorAll('.palette-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
      el.setAttribute('aria-selected', String(i === activeIndex));
      if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function execute(index) {
    const action = actions[index];
    if (!action) return;
    close();
    action.run();
  }

  function open(initialText = '') {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    input.value = initialText;
    activeIndex = 0;
    render();
    input.focus();
    input.select();
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  input.addEventListener('input', () => { activeIndex = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(activeIndex); }
  });
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.palette-item');
    if (item) execute(Number(item.dataset.index));
  });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  return { open, close, isOpen: () => !overlay.hidden };
}
