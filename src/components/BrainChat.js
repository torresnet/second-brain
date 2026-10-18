import { askBrain, getBrainItemById } from '../shared/services/supabaseClient.js';
import { copyToClipboard, getMediaBadge } from '../shared/utils/formatters.js';
import { escapeHtml, renderMarkdown } from '../shared/utils/markdown.js';
import { icon } from '../shared/utils/icons.js';

const MAX_HISTORY_TURNS = 8;
const MAX_INPUT_HEIGHT_PX = 120;

const SUGGESTIONS = [
  { label: 'Panorama do acervo', query: 'O que você tem salvo aqui? Faça um panorama por assunto.' },
  { label: 'Ferramentas salvas', query: 'Quais ferramentas e repositórios eu salvei?' },
  { label: 'Ajuda para um projeto', query: 'Quero montar um projeto novo. O que eu já tenho salvo que pode ajudar?' },
  { label: 'Códigos e comandos', query: 'Quais códigos e comandos eu guardei e para que servem?' }
];

export function createBrainChat(container, { onOpenItem }) {
  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-header">
        <button class="chat-back-btn icon-btn" type="button" data-tab="feed" aria-label="Voltar ao acervo">${icon('arrow')}</button>
        <div class="section-heading">
          <h1>Perguntar</h1>
          <p>Pergunte do seu jeito: pelo objetivo, pelo nome, pelo problema ou por uma lembrança vaga.</p>
        </div>
        <button id="chat-clear-btn" class="chip-btn" type="button">${icon('refresh')}Limpar<span class="chat-clear-long"> conversa</span></button>
      </div>

      <div class="chat-suggestions">
        ${SUGGESTIONS.map(s => `<button class="chip-suggestion chip-btn" type="button" data-query="${escapeHtml(s.query)}">${escapeHtml(s.label)}</button>`).join('')}
      </div>

      <div class="chat-messages" id="chat-messages-box" aria-live="polite">
        <div class="message-bubble message-ai">
          Olá! Tudo o que você salvou está aqui: links, ferramentas, códigos, ideias e transcrições. O que você quer lembrar ou encontrar?
        </div>
      </div>

      <div class="chat-input-bar">
        <textarea id="chat-user-input" class="chat-textarea" rows="1" maxlength="2000" placeholder="Pergunte ao seu Segundo Cérebro" title="Enter envia, Shift+Enter quebra linha"></textarea>
        <button id="chat-send-btn" class="btn-primary" type="button" aria-label="Enviar">${icon('arrow')}</button>
      </div>
    </div>
  `;

  const messagesBox = container.querySelector('#chat-messages-box');
  const userInput = container.querySelector('#chat-user-input');
  const sendBtn = container.querySelector('#chat-send-btn');
  const clearBtn = container.querySelector('#chat-clear-btn');
  const chatRoot = container.querySelector('.chat-container');

  let history = [];
  let isBusy = false;
  let generation = 0;

  function resizeInput() {
    userInput.style.height = 'auto';
    userInput.style.height = `${Math.min(userInput.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }

  function scrollToEnd() {
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function addUserBubble(text) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble message-user';
    bubble.textContent = text;
    messagesBox.appendChild(bubble);
    scrollToEnd();
  }

  function addAiBubble(html) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble message-ai';
    bubble.innerHTML = html;
    messagesBox.appendChild(bubble);
    scrollToEnd();
    return bubble;
  }

  function sourcesHtml(sources) {
    if (!sources?.length) return '';
    const cards = sources.map(source => {
      const badge = getMediaBadge(source.source_type);
      const atoms = (source.atoms || []).slice(0, 6)
        .map(a => `<span class="source-atom">${escapeHtml(a.kind)}: ${escapeHtml(a.name)}</span>`).join('');
      return `
        <button type="button" class="source-card view-item-btn" data-id="${escapeHtml(source.item_id)}">
          <span class="type-chip ${badge.cssClass}">${badge.icon}${escapeHtml(badge.label)}</span>
          <strong>${escapeHtml(source.title)}</strong>
          ${atoms ? `<span class="source-atoms">${atoms}</span>` : ''}
        </button>`;
    }).join('');
    return `<div class="chat-sources"><div class="chat-sources-title">Fontes no seu acervo</div>${cards}</div>`;
  }

  async function handleSend(textOverride) {
    const text = (textOverride ?? userInput.value).trim();
    if (!text || isBusy) return;

    isBusy = true;
    const myGeneration = generation;
    sendBtn.disabled = true;
    chatRoot.classList.add('is-active');
    addUserBubble(text);
    userInput.value = '';
    resizeInput();

    const typing = addAiBubble('<span class="chat-typing">Consultando seu Segundo Cérebro…</span>');

    try {
      const result = await askBrain(text, history.slice(-MAX_HISTORY_TURNS));
      typing.remove();
      if (myGeneration !== generation) return;
      const notice = result.degraded
        ? '<div class="chat-notice">Resposta em modo reduzido: parte da inteligência estava indisponível.</div>'
        : '';
      addAiBubble(`${renderMarkdown(result.answer)}${notice}${sourcesHtml(result.sources)}`);
      history = [...history, { role: 'user', content: text }, { role: 'assistant', content: result.answer }].slice(-MAX_HISTORY_TURNS);
    } catch (err) {
      typing.remove();
      if (myGeneration !== generation) return;
      addAiBubble(`<span class="chat-error">${escapeHtml(err.message || 'Erro ao consultar o acervo.')}</span>`);
    } finally {
      isBusy = false;
      sendBtn.disabled = false;
      userInput.focus();
    }
  }

  messagesBox.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest('.md-copy-btn');
    if (copyBtn) {
      const code = copyBtn.closest('.md-code')?.querySelector('code')?.textContent || '';
      if (await copyToClipboard(code)) {
        copyBtn.textContent = 'Copiado ✓';
        setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1800);
      }
      return;
    }
    const sourceBtn = event.target.closest('.view-item-btn');
    if (sourceBtn && onOpenItem) {
      try {
        const item = await getBrainItemById(sourceBtn.dataset.id);
        if (item) onOpenItem(item);
      } catch (err) {
        addAiBubble(`<span class="chat-error">Não foi possível abrir a nota: ${escapeHtml(err.message)}</span>`);
      }
    }
  });

  sendBtn.addEventListener('click', () => handleSend());
  userInput.addEventListener('input', resizeInput);
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  container.querySelectorAll('.chip-suggestion').forEach(chip => {
    chip.addEventListener('click', () => handleSend(chip.dataset.query));
  });
  clearBtn.addEventListener('click', () => {
    generation++;
    isBusy = false;
    sendBtn.disabled = false;
    history = [];
    chatRoot.classList.remove('is-active');
    messagesBox.innerHTML = '';
    addAiBubble('Conversa limpa. O que você quer encontrar no seu acervo?');
  });

  return { ask: (text) => handleSend(text) };
}
