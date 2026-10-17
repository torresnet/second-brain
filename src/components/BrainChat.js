import { askBrain, getBrainItemById } from '../shared/services/supabaseClient.js';
import { copyToClipboard, getMediaBadge } from '../shared/utils/formatters.js';
import { escapeHtml, renderMarkdown } from '../shared/utils/markdown.js';

const MAX_HISTORY_TURNS = 8;

const SUGGESTIONS = [
  { icon: '🗂️', label: 'Panorama do acervo', query: 'O que você tem salvo aqui? Faça um panorama por assunto.' },
  { icon: '🛠️', label: 'Ferramentas salvas', query: 'Quais ferramentas e repositórios eu salvei?' },
  { icon: '🚀', label: 'Ajuda para um projeto', query: 'Quero montar um projeto novo. O que eu já tenho salvo que pode ajudar?' },
  { icon: '💻', label: 'Códigos e comandos', query: 'Quais códigos e comandos eu guardei e para que servem?' }
];

export function createBrainChat(container, { onOpenItem }) {
  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-header">
        <div class="chat-header-info">
          <div style="width: 38px; height: 38px; border-radius: 10px; background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">🧠</div>
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 700;">Conversar com o Segundo Cérebro</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Pergunte do seu jeito: pelo objetivo, pelo nome, pelo problema ou por uma lembrança vaga.</p>
          </div>
        </div>
        <button id="chat-clear-btn" class="chat-clear-btn" type="button">Limpar conversa</button>
      </div>

      <div class="chat-suggestions">
        <span>Sugestões:</span>
        ${SUGGESTIONS.map(s => `<button class="chip-suggestion pill-btn" type="button" data-query="${escapeHtml(s.query)}">${s.icon} ${escapeHtml(s.label)}</button>`).join('')}
      </div>

      <div class="chat-messages" id="chat-messages-box" aria-live="polite">
        <div class="message-bubble message-ai">
          Olá! Tudo o que você salvou está aqui: links, ferramentas, códigos, ideias e transcrições. O que você quer lembrar ou encontrar?
        </div>
      </div>

      <div class="chat-input-bar">
        <textarea id="chat-user-input" class="chat-textarea" rows="1" maxlength="2000" placeholder="Pergunte ao seu Segundo Cérebro... (Enter envia, Shift+Enter quebra linha)"></textarea>
        <button id="chat-send-btn" class="btn-primary" type="button" style="padding: 0 1.25rem;">Enviar ↗</button>
      </div>
    </div>
  `;

  const messagesBox = container.querySelector('#chat-messages-box');
  const userInput = container.querySelector('#chat-user-input');
  const sendBtn = container.querySelector('#chat-send-btn');
  const clearBtn = container.querySelector('#chat-clear-btn');

  let history = [];
  let isBusy = false;
  let generation = 0;

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
          <span class="source-badge ${badge.cssClass}">${badge.icon} ${escapeHtml(badge.label)}</span>
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
    addUserBubble(text);
    userInput.value = '';

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
    messagesBox.innerHTML = '';
    addAiBubble('Conversa limpa. O que você quer encontrar no seu acervo?');
  });
}
