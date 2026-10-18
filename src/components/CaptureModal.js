import {
  splitSharedText,
  MAX_FILE_BYTES,
  MAX_RECORD_SECONDS,
  ACCEPTED_FILE_TYPES
} from '../shared/services/captureService.js';
import { icon } from '../shared/utils/icons.js';

export function createCaptureModal({ onSubmit }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'capture-modal';

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h2 class="modal-title">Capturar</h2>
        <button id="capture-close-btn" class="icon-btn" type="button" aria-label="Fechar">${icon('close')}</button>
      </div>

      <div class="modal-body">
        <div id="capture-external-notice" class="capture-status warn" role="alert" hidden>
          Este conteúdo veio de fora do app (link, compartilhamento ou outro site). Confira o endereço e o texto antes de salvar.
        </div>

        <!-- Sub-abas de tipo de captura -->
        <div class="segmented" role="tablist">
          <button id="cap-tab-link" class="tab-btn active" type="button">${icon('link')}Link</button>
          <button id="cap-tab-note" class="tab-btn" type="button">${icon('note')}Anotação</button>
          <button id="cap-tab-voice" class="tab-btn" type="button">${icon('mic')}Voz</button>
          <button id="cap-tab-file" class="tab-btn" type="button">${icon('paperclip')}Arquivo</button>
        </div>

        <!-- Painel 1: Link / Reels / Vídeo -->
        <div id="panel-link">
          <p class="modal-hint">
            Reels ou post do Instagram, YouTube, TikTok, site, PDF ou arquivo público do Google Drive. A IA lê, ouve e indexa.
          </p>
          <input type="url" id="input-capture-url" placeholder="https://www.instagram.com/reel/... ou https://youtu.be/..." 
                 class="field" />
          
          <input type="text" id="input-capture-title-hint" placeholder="Título ou contexto opcional (ex: Dicas de investimento do perfil X)"
                 class="field" />
        </div>

        <!-- Painel 2: Anotação de Texto -->
        <div id="panel-note" style="display: none;">
          <input type="text" id="input-note-title" placeholder="Título da Anotação..." 
                 class="field" />
          <textarea id="input-note-body" placeholder="Escreva suas ideias, aprendizados ou síntese..." 
                    rows="5" class="field field-area"></textarea>
          <input type="text" id="input-note-tags" placeholder="Tags separadas por vírgula (ex: produtividade, ideias, ia)" 
                 class="field" />
        </div>

        <!-- Painel 3: Gravação de Voz -->
        <div id="panel-voice" class="voice-panel" style="display: none;">
          <button id="voice-record-btn" class="record-btn" type="button" aria-label="Gravar ou parar">
            ${icon('mic')}
          </button>
          <div id="voice-timer" class="voice-timer">00:00</div>
          <p id="voice-status-text" class="modal-hint">Clique no microfone para começar a ditar sua nota.</p>
        </div>

        <!-- Painel 4: Anexar Arquivo -->
        <div id="panel-file" style="display: none;">
          <p class="modal-hint">
            PDF, imagem, áudio, vídeo ou texto até 10 MB. Para vídeos maiores, suba no Google Drive e cole o link.
          </p>
          <label id="file-dropzone" for="input-capture-file" class="dropzone">
            ${icon('paperclip', 'dropzone-icon')}
            <div id="file-name-label">Clique para escolher ou arraste o arquivo aqui</div>
          </label>
          <input type="file" id="input-capture-file" style="display: none;" />
          <input type="text" id="input-file-title-hint" placeholder="Título ou contexto opcional"
                 class="field" />
        </div>

        <!-- Alerta de status / progresso -->
        <div id="capture-status-box" class="capture-status" style="display: none;"></div>
      </div>

      <div class="modal-footer">
        <button id="capture-cancel-btn" class="btn-ghost" type="button">Cancelar</button>
        <button id="capture-submit-btn" class="btn-primary" type="button">Capturar</button>
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
  const externalNotice = overlay.querySelector('#capture-external-notice');

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
    fileDropzone.style.borderColor = 'var(--accent)';
  }));
  ['dragleave', 'drop'].forEach(evt => fileDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDropzone.style.borderColor = '';
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
    } else if (prefilled.mode) {
      switchTab(prefilled.mode);
    }
    externalNotice.hidden = !prefilled.external;
    overlay.classList.add('active');
    const firstField = { link: inputUrl, note: inputNoteBody, file: inputFileTitle }[activeMode];
    if (firstField) setTimeout(() => firstField.focus(), 50);
  }

  function close() {
    overlay.classList.remove('active');
    inputUrl.value = '';
    inputTitleHint.value = '';
    inputNoteTitle.value = '';
    inputNoteBody.value = '';
    inputNoteTags.value = '';
    inputFile.value = '';
    externalNotice.hidden = true;
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
    voiceRecordBtn.classList.remove('recording');
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
        voiceRecordBtn.classList.remove('recording');
        voiceStatusText.innerText = 'Áudio gravado! Clique em Capturar para a IA transcrever, ou no microfone para regravar.';
      };

      recorder.start();
      voiceRecordBtn.classList.add('recording');
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
    statusBox.className = 'capture-status error';
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

  [inputUrl, inputTitleHint].forEach((input) => input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    submitBtn.click();
  }));

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
