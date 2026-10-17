import { insertBrainItem } from '../shared/services/supabaseClient.js';
import { isPipelineConfigured, sendToPipeline, readFileAsBase64, MAX_FILE_BYTES, ACCEPTED_FILE_TYPES } from '../shared/services/captureService.js';

export function createCaptureModal({ onItemSaved }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'capture-modal';

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 1.2rem;">⚡</span>
          <h2 style="font-size: 1.2rem; font-weight: 700;">Captura Rápida no Segundo Cérebro</h2>
        </div>
        <button id="capture-close-btn" style="background: none; border: none; color: var(--text-secondary); font-size: 1.5rem; cursor: pointer;">✕</button>
      </div>

      <div class="modal-body">
        <!-- Sub-abas de tipo de captura -->
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem; background: rgba(0,0,0,0.3); padding: 4px; border-radius: var(--radius-full); border: 1px solid var(--border-color);">
          <button id="cap-tab-link" class="tab-btn active" style="flex: 1; justify-content: center; font-size: 0.85rem;">🔗 Link / Reel / Vídeo</button>
          <button id="cap-tab-note" class="tab-btn" style="flex: 1; justify-content: center; font-size: 0.85rem;">📝 Anotação de Texto</button>
          <button id="cap-tab-voice" class="tab-btn" style="flex: 1; justify-content: center; font-size: 0.85rem;">🎙️ Gravar Voz</button>
          <button id="cap-tab-file" class="tab-btn" style="flex: 1; justify-content: center; font-size: 0.85rem;">📎 Arquivo</button>
        </div>

        <!-- Painel 1: Link / Reels / Vídeo -->
        <div id="panel-link">
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            Cole o link de um <strong>Instagram Reels</strong>, <strong>YouTube</strong>, <strong>TikTok</strong>, artigo ou PDF para ser analisado e indexado pela IA:
          </p>
          <input type="url" id="input-capture-url" placeholder="https://www.instagram.com/reel/... ou https://youtu.be/..." 
                 class="search-input" style="padding-left: 1rem; border-radius: var(--radius-md); font-size: 0.95rem; margin-bottom: 0.75rem;" />
          
          <input type="text" id="input-capture-title-hint" placeholder="Título ou contexto opcional (ex: Dicas de investimento do perfil X)"
                 class="search-input" style="padding-left: 1rem; border-radius: var(--radius-md); font-size: 0.9rem;" />
        </div>

        <!-- Painel 2: Anotação de Texto -->
        <div id="panel-note" style="display: none;">
          <input type="text" id="input-note-title" placeholder="Título da Anotação..." 
                 class="search-input" style="padding-left: 1rem; border-radius: var(--radius-md); margin-bottom: 0.75rem;" />
          <textarea id="input-note-body" placeholder="Escreva suas ideias, aprendizados ou síntese..." 
                    rows="5" class="chat-textarea" style="height: auto; width: 100%; border-radius: var(--radius-md); margin-bottom: 0.75rem;"></textarea>
          <input type="text" id="input-note-tags" placeholder="Tags separadas por vírgula (ex: produtividade, ideias, ia)" 
                 class="search-input" style="padding-left: 1rem; border-radius: var(--radius-md); font-size: 0.85rem;" />
        </div>

        <!-- Painel 3: Gravação de Voz -->
        <div id="panel-voice" style="display: none; text-align: center; padding: 1.5rem 1rem;">
          <div id="voice-record-btn" style="width: 70px; height: 70px; border-radius: 50%; background: rgba(239, 68, 68, 0.2); border: 2px solid #ef4444; color: #ef4444; font-size: 2rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem auto; cursor: pointer; transition: all 0.2s;">
            🎙️
          </div>
          <div id="voice-timer" style="font-size: 1.2rem; font-weight: 700; font-family: monospace; color: var(--text-primary); margin-bottom: 0.5rem;">00:00</div>
          <p id="voice-status-text" style="font-size: 0.85rem; color: var(--text-secondary);">Clique no microfone para começar a ditar sua nota.</p>
        </div>

        <!-- Painel 4: Anexar Arquivo -->
        <div id="panel-file" style="display: none;">
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            Anexe um <strong>PDF</strong>, <strong>imagem</strong>, <strong>áudio</strong> ou <strong>texto</strong> (até 10 MB) para ser analisado e indexado pela IA:
          </p>
          <label id="file-dropzone" for="input-capture-file" style="display: block; text-align: center; padding: 1.5rem 1rem; border: 2px dashed var(--border-color); border-radius: var(--radius-md); cursor: pointer; color: var(--text-secondary);">
            <div style="font-size: 1.8rem; margin-bottom: 0.25rem;">📎</div>
            <div id="file-name-label" style="font-size: 0.9rem;">Clique para escolher ou arraste o arquivo aqui</div>
          </label>
          <input type="file" id="input-capture-file" style="display: none;" />
          <input type="text" id="input-file-title-hint" placeholder="Título ou contexto opcional"
                 class="search-input" style="padding-left: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; margin-top: 0.75rem;" />
        </div>

        <!-- Alerta de status / progresso -->
        <div id="capture-status-box" style="display: none; padding: 0.75rem; border-radius: var(--radius-md); font-size: 0.88rem; margin-top: 0.5rem;"></div>
      </div>

      <div class="modal-footer">
        <button id="capture-cancel-btn" style="background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); padding: 0.5rem 1rem; border-radius: var(--radius-full); cursor: pointer;">
          Cancelar
        </button>
        <button id="capture-submit-btn" class="btn-primary">
          Salvar no Cérebro ⚡
        </button>
      </div>
    </div>
  `;

  overlay.querySelector('#input-capture-file').setAttribute('accept', ACCEPTED_FILE_TYPES);

  document.body.appendChild(overlay);

  // Seleção de elementos
  const closeBtn = overlay.querySelector('#capture-close-btn');
  const cancelBtn = overlay.querySelector('#capture-cancel-btn');
  const submitBtn = overlay.querySelector('#capture-submit-btn');

  const tabLink = overlay.querySelector('#cap-tab-link');
  const tabNote = overlay.querySelector('#cap-tab-note');
  const tabVoice = overlay.querySelector('#cap-tab-voice');
  const tabFile = overlay.querySelector('#cap-tab-file');

  const panelLink = overlay.querySelector('#panel-link');
  const panelNote = overlay.querySelector('#panel-note');
  const panelVoice = overlay.querySelector('#panel-voice');
  const panelFile = overlay.querySelector('#panel-file');
  const inputFile = overlay.querySelector('#input-capture-file');
  const inputFileTitle = overlay.querySelector('#input-file-title-hint');
  const fileNameLabel = overlay.querySelector('#file-name-label');
  const fileDropzone = overlay.querySelector('#file-dropzone');
  const FILE_PLACEHOLDER = fileNameLabel.innerText;
  let selectedFile = null;

  const inputUrl = overlay.querySelector('#input-capture-url');
  const inputTitleHint = overlay.querySelector('#input-capture-title-hint');
  const inputNoteTitle = overlay.querySelector('#input-note-title');
  const inputNoteBody = overlay.querySelector('#input-note-body');
  const inputNoteTags = overlay.querySelector('#input-note-tags');

  const statusBox = overlay.querySelector('#capture-status-box');

  let activeMode = 'link'; // 'link' | 'note' | 'voice' | 'file'
  let mediaRecorder = null;
  let audioChunks = [];
  let recordInterval = null;
  let recordSeconds = 0;

  function switchTab(mode) {
    activeMode = mode;
    tabLink.classList.toggle('active', mode === 'link');
    tabNote.classList.toggle('active', mode === 'note');
    tabVoice.classList.toggle('active', mode === 'voice');
    tabFile.classList.toggle('active', mode === 'file');

    panelLink.style.display = mode === 'link' ? 'block' : 'none';
    panelNote.style.display = mode === 'note' ? 'block' : 'none';
    panelVoice.style.display = mode === 'voice' ? 'block' : 'none';
    panelFile.style.display = mode === 'file' ? 'block' : 'none';

    statusBox.style.display = 'none';
  }

  tabLink.addEventListener('click', () => switchTab('link'));
  tabNote.addEventListener('click', () => switchTab('note'));
  tabVoice.addEventListener('click', () => switchTab('voice'));
  tabFile.addEventListener('click', () => switchTab('file'));

  function setSelectedFile(file) {
    selectedFile = file;
    fileNameLabel.innerText = file
      ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
      : FILE_PLACEHOLDER;
  }

  inputFile.addEventListener('change', () => setSelectedFile(inputFile.files[0] || null));
  ['dragenter', 'dragover'].forEach(evt => fileDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDropzone.style.borderColor = 'var(--accent-primary, #8b5cf6)';
  }));
  ['dragleave', 'drop'].forEach(evt => fileDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDropzone.style.borderColor = 'var(--border-color)';
  }));
  fileDropzone.addEventListener('drop', (e) => setSelectedFile(e.dataTransfer.files[0] || null));

  function open(prefilled = {}) {
    if (prefilled.url) {
      inputUrl.value = prefilled.url;
      switchTab('link');
    }
    if (prefilled.title) {
      inputTitleHint.value = prefilled.title;
      inputNoteTitle.value = prefilled.title;
    }
    if (prefilled.text && !prefilled.url) {
      inputNoteBody.value = prefilled.text;
      switchTab('note');
    }
    overlay.classList.add('active');
  }

  function close() {
    overlay.classList.remove('active');
    inputUrl.value = '';
    inputTitleHint.value = '';
    inputNoteTitle.value = '';
    inputNoteBody.value = '';
    inputNoteTags.value = '';
    inputFile.value = '';
    inputFileTitle.value = '';
    setSelectedFile(null);
    statusBox.style.display = 'none';
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Gravação de Áudio
  const voiceRecordBtn = overlay.querySelector('#voice-record-btn');
  const voiceTimer = overlay.querySelector('#voice-timer');
  const voiceStatusText = overlay.querySelector('#voice-status-text');

  voiceRecordBtn.addEventListener('click', async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        recordSeconds = 0;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          clearInterval(recordInterval);
          voiceRecordBtn.style.transform = 'scale(1)';
          voiceRecordBtn.style.background = 'rgba(239, 68, 68, 0.2)';
          voiceStatusText.innerText = 'Áudio gravado com sucesso! Pronto para salvar.';
        };

        mediaRecorder.start();
        voiceRecordBtn.style.transform = 'scale(1.15)';
        voiceRecordBtn.style.background = 'rgba(239, 68, 68, 0.6)';
        voiceStatusText.innerText = 'Gravando sua voz... Fale normalmente.';

        recordInterval = setInterval(() => {
          recordSeconds++;
          const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
          const s = String(recordSeconds % 60).padStart(2, '0');
          voiceTimer.innerText = `${m}:${s}`;
        }, 1000);

      } catch (err) {
        alert('Permissão de microfone negada ou dispositivo não encontrado.');
      }
    } else if (mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  });

  function showSuccess(message, isWarning = false) {
    statusBox.style.display = 'block';
    statusBox.style.background = isWarning ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)';
    statusBox.style.color = isWarning ? '#fbbf24' : '#34d399';
    statusBox.innerText = message;

    setTimeout(() => {
      close();
      if (onItemSaved) onItemSaved();
    }, isWarning ? 2500 : 900);
  }

  // Salvar
  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Processando...';
    let pipelineWarning = '';

    try {
      if (activeMode === 'link') {
        const url = inputUrl.value.trim();
        if (!url) throw new Error('Por favor, informe a URL.');

        if (!/^https?:\/\//i.test(url)) throw new Error('Informe uma URL começando com http:// ou https://.');

        if (isPipelineConfigured()) {
          try {
            await sendToPipeline({ url });
            showSuccess('✅ Link enviado e analisado pela IA!');
            return;
          } catch (pipelineErr) {
            pipelineWarning = `⚠️ ${pipelineErr.message} Salvo na caixa de entrada sem análise.`;
          }
        }

        let sourceType = 'article';
        if (/instagram\.com\/(reel|p)\//i.test(url)) sourceType = 'reel';
        else if (/youtu(be\.com|\.be)/i.test(url)) sourceType = 'youtube';
        else if (/tiktok\.com/i.test(url)) sourceType = 'reel';
        else if (/\.pdf/i.test(url)) sourceType = 'pdf';

        const newItem = {
          title: inputTitleHint.value.trim() || `Captura: ${url.replace(/^https?:\/\//, '').slice(0, 35)}...`,
          summary: 'Item salvo para processamento cognitivo.',
          source_type: sourceType,
          source_url: url,
          raw_content: `URL original capturada para indexação: ${url}`,
          key_takeaways: ['Aguardando extração detalhada de tópicos pelo n8n'],
          tags: [sourceType, 'inbox']
        };

        await insertBrainItem(newItem);

      } else if (activeMode === 'note') {
        const title = inputNoteTitle.value.trim() || 'Nota Rápida';
        const body = inputNoteBody.value.trim();
        if (!body) throw new Error('O corpo da anotação não pode ficar vazio.');

        const tags = inputNoteTags.value
          .split(',')
          .map(t => t.trim().toLowerCase())
          .filter(Boolean);

        const newItem = {
          title,
          summary: body.slice(0, 180) + (body.length > 180 ? '...' : ''),
          source_type: 'note',
          source_url: null,
          raw_content: body,
          key_takeaways: [body.slice(0, 80)],
          tags: tags.length ? tags : ['nota-pessoal']
        };

        await insertBrainItem(newItem);

      } else if (activeMode === 'file') {
        if (!selectedFile) throw new Error('Escolha um arquivo para anexar.');
        if (selectedFile.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 10 MB.');

        const mime = selectedFile.type || 'application/octet-stream';
        const titleHint = inputFileTitle.value.trim();

        if (isPipelineConfigured()) {
          try {
            await sendToPipeline({
              file_base64: await readFileAsBase64(selectedFile),
              file_mime: mime,
              file_name: selectedFile.name
            });
            showSuccess('✅ Arquivo enviado e analisado pela IA!');
            return;
          } catch (pipelineErr) {
            pipelineWarning = `⚠️ ${pipelineErr.message} Registrado na caixa de entrada sem análise.`;
          }
        }

        const isText = mime.startsWith('text/');
        const sourceType = mime === 'application/pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : 'note';
        const textContent = isText ? (await selectedFile.text()).trim() : '';

        await insertBrainItem({
          title: titleHint || selectedFile.name,
          summary: textContent ? textContent.slice(0, 180) + (textContent.length > 180 ? '...' : '') : `Arquivo anexado: ${selectedFile.name}`,
          source_type: sourceType,
          source_url: null,
          raw_content: textContent || `Arquivo anexado (${mime}): ${selectedFile.name}. Conteúdo não processado.`,
          key_takeaways: ['Aguardando extração detalhada pelo n8n'],
          tags: [sourceType, 'arquivo', 'inbox']
        });

      } else if (activeMode === 'voice') {
        const newItem = {
          title: `Áudio Gravado (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`,
          summary: `Gravação de voz com ${recordSeconds}s gravada diretamente no Segundo Cérebro.`,
          source_type: 'audio',
          source_url: null,
          raw_content: 'Áudio capturado pelo microfone via PWA.',
          key_takeaways: ['Gravação de voz direta via navegador'],
          tags: ['audio', 'voz']
        };

        await insertBrainItem(newItem);
      }

      showSuccess(pipelineWarning || '✅ Salvo com sucesso no seu Segundo Cérebro!', Boolean(pipelineWarning));

    } catch (err) {
      statusBox.style.display = 'block';
      statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
      statusBox.style.color = '#f87171';
      statusBox.innerText = `Erro: ${err.message}`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Salvar no Cérebro ⚡';
    }
  });

  return { open, close };
}
