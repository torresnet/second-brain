import { escapeHtml } from '../shared/utils/markdown.js';
import { searchNodes } from '../shared/utils/graphModel.js';

const BLUR_CLOSE_DELAY_MS = 150;
const TYPE_LABELS = { item: 'nota', tag: 'tag', entity: 'entidade' };

/**
 * Busca com lista de sugestões (combobox) sobre os nós do grafo.
 * `getModel()` devolve o modelo atual; `onChoose(node)` recebe o nó escolhido.
 */
export function createGraphSearch({ input, results, getModel, onChoose }) {
  let hits = [];
  let index = -1;

  function close() {
    hits = [];
    index = -1;
    results.hidden = true;
    results.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function render() {
    results.hidden = hits.length === 0;
    input.setAttribute('aria-expanded', String(hits.length > 0));
    results.innerHTML = hits.map((n, i) => `
      <li id="graph-hit-${i}" role="option" aria-selected="${i === index}" class="${i === index ? 'active' : ''}" data-index="${i}">
        <strong>${escapeHtml(n.fullTitle)}</strong><span>${TYPE_LABELS[n.type] ?? ''}</span>
      </li>`).join('');
    if (index >= 0) input.setAttribute('aria-activedescendant', `graph-hit-${index}`);
  }

  function choose(i) {
    const node = hits[i];
    if (!node) return;
    input.value = node.fullTitle;
    close();
    input.blur();
    onChoose(node);
  }

  input.addEventListener('input', () => {
    hits = searchNodes(getModel(), input.value);
    index = hits.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      index = (index + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(Math.max(index, 0));
    }
  });
  input.addEventListener('blur', () => setTimeout(close, BLUR_CLOSE_DELAY_MS));
  // pointerdown (e não mousedown): em toque o mousedown chega depois do blur e a lista já sumiu
  results.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-index]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.index));
  });
}
