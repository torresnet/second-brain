import { APP_CONFIG } from '../constants/config.js';
import { getSession } from './supabaseClient.js';

export function isPipelineConfigured() {
  return Boolean(APP_CONFIG.n8n.webhookUrl);
}

// 10 MB de arquivo viram ~13,4 MB em base64: cabe no limite de payload do n8n (16 MB) e do Gemini (20 MB)
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RECORD_SECONDS = 300;
const PIPELINE_TIMEOUT_MS = 6 * 60 * 1000;
const WAV_SAMPLE_RATE = 16000;
const SHARED_CACHE = 'share-target-files';
const SHARED_KEY = '/shared-file';

export const ACCEPTED_FILE_TYPES = [
  '.pdf', '.txt', '.md', '.csv',
  '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  '.mp4', '.mov', '.webm', '.3gp',
  'application/pdf', 'text/plain', 'text/markdown', 'image/*', 'audio/*', 'video/*'
].join(',');

/**
 * Lê um File/Blob e devolve o conteúdo em base64 (sem o prefixo data:)
 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Converte uma gravação do MediaRecorder (webm/mp4) em WAV mono 16 kHz,
 * formato aceito pelo Gemini em qualquer navegador.
 */
export async function recordingToWav(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);

    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, WAV_SAMPLE_RATE, true);
    view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const sample = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  } catch {
    throw new Error('Não foi possível processar a gravação de áudio.');
  } finally {
    ctx.close();
  }
}

/**
 * Extrai o primeiro link de um texto compartilhado (ex.: "Veja isso https://...")
 * e devolve o link e o restante do texto
 */
export function splitSharedText(text) {
  const match = (text || '').match(/https?:\/\/[^\s]+/i);
  if (!match) return { url: null, rest: (text || '').trim() };
  return { url: match[0], rest: text.replace(match[0], '').trim() };
}

/**
 * Recupera (e remove) o arquivo recebido pelo "Compartilhar" do celular, guardado pelo service worker
 */
export async function takeSharedFile() {
  if (!('caches' in window)) return null;
  const cache = await caches.open(SHARED_CACHE);
  const response = await cache.match(SHARED_KEY);
  if (!response) return null;
  await cache.delete(SHARED_KEY);
  const blob = await response.blob();
  const name = decodeURIComponent(response.headers.get('X-File-Name') || 'arquivo');
  return new File([blob], name, { type: response.headers.get('Content-Type') || blob.type });
}

/**
 * Envia um link ou arquivo ({ url, hint } | { file_base64, file_mime, file_name, hint }) ao pipeline
 * de ingestão (n8n), autenticado com o token da sessão.
 * Devolve { analysis_ok, warnings, item }.
 */
export async function sendToPipeline(payload) {
  const session = await getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

  try {
    const response = await fetch(APP_CONFIG.n8n.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Pipeline indisponível (HTTP ${response.status}).`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('O processamento demorou demais e foi cancelado.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
