import { getBrainItems } from '../shared/services/supabaseClient.js';
import { getMediaBadge } from '../shared/utils/formatters.js';

export function createBrainChat(container, { onOpenItem }) {
  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-header">
        <div class="chat-header-info">
          <div style="width: 38px; height: 38px; border-radius: 10px; background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
            🧠
          </div>
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 700;">Conversar com o Segundo Cérebro</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Pergunte em linguagem natural sobre seus Reels, vídeos, notas e arquivos.</p>
          </div>
        </div>
        <button id="chat-clear-btn" style="background: none; border: 1px solid var(--border-color); color: var(--text-secondary); font-size: 0.75rem; padding: 0.3rem 0.7rem; border-radius: var(--radius-full); cursor: pointer;">
          Limpar conversa
        </button>
      </div>

      <!-- Sugestões Rápidas -->
      <div style="padding: 0.75rem 1.5rem; background: rgba(0,0,0,0.15); border-bottom: 1px solid var(--border-color); display: flex; gap: 0.5rem; overflow-x: auto;">
        <span style="font-size: 0.8rem; color: var(--text-muted); align-self: center; white-space: nowrap;">Exemplos:</span>
        <button class="chip-suggestion pill-btn" data-query="Quais foram os últimos Reels que salvei?">📱 Últimos Reels</button>
        <button class="chip-suggestion pill-btn" data-query="Me mostre um resumo dos conteúdos de inteligência artificial">⚡ Conteúdos de IA</button>
        <button class="chip-suggestion pill-btn" data-query="Quais são as principais anotações e aprendizados catalogados?">💡 Principais ideias</button>
      </div>

      <div class="chat-messages" id="chat-messages-box">
        <div class="message-bubble message-ai">
          Olá! Eu sou o assistente do seu <strong>Segundo Cérebro</strong>. Eu indexo e correlaciono tudo o que você envia (Reels, vídeos do YouTube, podcasts, anotações e documentos).
          <br><br>
          O que você gostaria de recordar ou pesquisar hoje?
        </div>
      </div>

      <div class="chat-input-bar">
        <textarea id="chat-user-input" class="chat-textarea" placeholder="Pergunte ao seu Segundo Cérebro... (Pressione Enter para enviar)"></textarea>
        <button id="chat-send-btn" class="btn-primary" style="padding: 0 1.25rem;">
          Enviar ↗
        </button>
      </div>
    </div>
  `;

  const messagesBox = container.querySelector('#chat-messages-box');
  const userInput = container.querySelector('#chat-user-input');
  const sendBtn = container.querySelector('#chat-send-btn');
  const clearBtn = container.querySelector('#chat-clear-btn');
  const suggestionChips = container.querySelectorAll('.chip-suggestion');

  async function handleSend() {
    const text = userInput.value.trim();
    if (!text) return;

    // Adiciona mensagem do usuário
    appendMessage(text, 'user');
    userInput.value = '';

    // Indicador de digitação
    const typingId = appendTypingIndicator();

    try {
      // 1. Busca contextual no Supabase
      const allItems = await getBrainItems();
      
      // Filtra itens relevantes por busca de palavras-chave
      const keywords = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const matched = allItems.filter(item => {
        const fullText = `${item.title} ${item.summary} ${(item.tags || []).join(' ')} ${item.raw_content || ''}`.toLowerCase();
        return keywords.some(k => fullText.includes(k));
      }).slice(0, 4);

      removeTypingIndicator(typingId);

      if (allItems.length === 0) {
        appendMessage('Seu Segundo Cérebro ainda está vazio! Que tal colar o link de um Reels do Instagram, um vídeo ou escrever sua primeira nota usando o botão **+ Capturar** no topo?', 'ai');
        return;
      }

      if (matched.length === 0) {
        appendMessage(`Procurei no seu acervo (${allItems.length} itens catalogados), mas não encontrei menção direta aos termos pesquisados.<br><br>Você possui conteúdos sobre: <em>${Array.from(new Set(allItems.flatMap(i => i.tags || []))).slice(0, 6).join(', ')}</em>.<br><br>Tente pesquisar por outros tópicos!`, 'ai');
        return;
      }

      // Sintetiza resposta com os itens encontrados
      let responseHtml = `Encontrei <strong>${matched.length}</strong> anotações/mídias relevantes no seu Segundo Cérebro:<br><br>`;
      
      matched.forEach((item, index) => {
        const badge = getMediaBadge(item.source_type);
        responseHtml += `
          <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.75rem; margin-bottom: 0.6rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
              <span class="source-badge ${badge.cssClass}">${badge.icon} ${badge.label}</span>
              <button class="view-item-btn" data-id="${item.id}" style="background: none; border: none; color: var(--accent-cyan); font-size: 0.8rem; cursor: pointer; text-decoration: underline;">
                Ver nota completa →
              </button>
            </div>
            <strong>${escapeHtml(item.title)}</strong>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.3rem;">${escapeHtml(item.summary || item.raw_content || '')}</p>
          </div>
        `;
      });

      appendMessage(responseHtml, 'ai', matched);

    } catch (err) {
      removeTypingIndicator(typingId);
      appendMessage(`Houve um erro ao consultar o banco de dados: ${err.message}`, 'ai');
    }
  }

  function appendMessage(htmlContent, sender, attachedItems = []) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble message-${sender}`;
    bubble.innerHTML = htmlContent;

    // Atacha listeners nos botões de ver nota completa
    bubble.querySelectorAll('.view-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.id;
        const found = attachedItems.find(i => i.id === itemId);
        if (found && onOpenItem) onOpenItem(found);
      });
    });

    messagesBox.appendChild(bubble);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  function appendTypingIndicator() {
    const id = 'typing-' + Date.now();
    const bubble = document.createElement('div');
    bubble.id = id;
    bubble.className = 'message-bubble message-ai';
    bubble.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">Pensando e consultando seu Segundo Cérebro... 🧠</span>';
    messagesBox.appendChild(bubble);
    messagesBox.scrollTop = messagesBox.scrollHeight;
    return id;
  }

  function removeTypingIndicator(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  sendBtn.addEventListener('click', handleSend);
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      userInput.value = chip.dataset.query;
      handleSend();
    });
  });

  clearBtn.addEventListener('click', () => {
    messagesBox.innerHTML = `
      <div class="message-bubble message-ai">
        Conversa limpa. Como posso ajudar você a consultar seu acervo agora?
      </div>
    `;
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
