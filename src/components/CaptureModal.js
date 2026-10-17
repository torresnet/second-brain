import {
  splitSharedText,
  MAX_FILE_BYTES,
  MAX_RECORD_SECONDS,
  ACCEPTED_FILE_TYPES
} from '../shared/services/captureService.js';

export function createCaptureModal({ onSubmit }) {
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
            Cole o link de um <strong>Reels/post do Instagram</strong>, <strong>YouTube</strong>, <strong>TikTok</strong>, <strong>site/artigo</strong>, <strong>PDF</strong> ou arquivo do <strong>Google Drive</strong> (público) para a IA ler, ouvir e indexar:
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
            Anexe um <strong>PDF</strong>, <strong>imagem</strong>, <strong>áudio</strong>, <strong>vídeo</strong> ou <strong>texto</strong> (até 10 MB; para vídeos maiores, suba no Google Drive e cole o link):
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
    const fromText = splitSharedText(prefilled.text);
    const url = prefilled.url || fromText.url;
    const context = prefilled.title || (fromText.url ? fromText.rest : '');

    if (prefilled.file) {
      setSelectedFile(prefilled.file);
      inputFileTitle.value = context;
      switchTab('file');
    } else if (url) {
      inputUrl.value = url;
      inputTitleHint.value = context;
      switchTab('link');
    } else if (prefilled.text) {
      inputNoteTitle.value = prefilled.title || '';
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
    resetRecording();
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
  const VOICE_PLACEHOLDER = voiceStatusText.innerText;
  let micStream = null;
  let recordedBlob = null;

  function releaseMic() {
    clearInterval(recordInterval);
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
  }

  function resetRecording() {
    if (mediaRecorder) {
      mediaRecorder.onstop = null;
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }
    releaseMic();
    mediaRecorder = null;
    audioChunks = [];
    recordedBlob = null;
    recordSeconds = 0;
    voiceTimer.innerText = '00:00';
    voiceRecordBtn.style.transform = 'scale(1)';
    voiceRecordBtn.style.background = 'rgba(239, 68, 68, 0.2)';
    voiceStatusText.innerText = VOICE_PLACEHOLDER;
  }

  voiceRecordBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }

    try {
      resetRecording();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(micStream);
      mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      recorder.onstop = () => {
        releaseMic();
        recordedBlob = new Blob(audioChunks, { type: recorder.mimeType || 'audio/webm' });
        voiceRecordBtn.style.transform = 'scale(1)';
        voiceRecordBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        voiceStatusText.innerText = 'Áudio gravado! Clique em Salvar para a IA transcrever, ou no microfone para regravar.';
      };

      recorder.start();
      voiceRecordBtn.style.transform = 'scale(1.15)';
      voiceRecordBtn.style.background = 'rgba(239, 68, 68, 0.6)';
      voiceStatusText.innerText = `Gravando sua voz... Fale normalmente (máx. ${MAX_RECORD_SECONDS / 60} min).`;

      recordInterval = setInterval(() => {
        recordSeconds++;
        const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
        const sec = String(recordSeconds % 60).padStart(2, '0');
        voiceTimer.innerText = `${m}:${sec}`;
        if (recordSeconds >= MAX_RECORD_SECONDS) recorder.stop();
      }, 1000);
    } catch (err) {
      releaseMic();
      alert('Permissão de microfone negada ou dispositivo não encontrado.');
    }
  });

  function showError(message) {
    statusBox.style.display = 'block';
    statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
    statusBox.style.color = '#f87171';
    statusBox.innerText = `Erro: ${message}`;
  }

  // Valida na hora e devolve o pedido de captura; o processamento acontece em segundo plano
  function buildCaptureSpec() {
    if (activeMode === 'link') {
      const url = inputUrl.value.trim();
      if (!url) throw new Error('Por favor, informe a URL.');
      if (!/^https?:\/\//i.test(url)) throw new Error('Informe uma URL começando com http:// ou https://.');
      return { kind: 'link', label: url.replace(/^https?:\/\//, '').slice(0, 60), url, hint: inputTitleHint.value.trim() };
    }

    if (activeMode === 'note') {
      const body = inputNoteBody.value.trim();
      if (!body) throw new Error('O corpo da anotação não pode ficar vazio.');
      const title = inputNoteTitle.value.trim() || 'Nota Rápida';
      const tags = inputNoteTags.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      return { kind: 'note', label: title, title, body, tags };
    }

    if (activeMode === 'file') {
      if (!selectedFile) throw new Error('Escolha um arquivo para anexar.');
      if (selectedFile.size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 10 MB.');
      return { kind: 'file', label: selectedFile.name, file: selectedFile, hint: inputFileTitle.value.trim() };
    }

    if (!recordedBlob) throw new Error('Grave um áudio antes de salvar.');
    return { kind: 'voice', label: 'Gravação de voz', blob: recordedBlob, seconds: recordSeconds };
  }

  submitBtn.addEventListener('click', () => {
    let spec;
    try {
      spec = buildCaptureSpec();
    } catch (err) {
      showError(err.message);
      return;
    }
    onSubmit(spec);
    close();
  });

  return { open, close };
}
