import { insertBrainItem } from './supabaseClient.js';
import { friendlyError } from '../utils/friendlyError.js';
import { logCaptureError } from './errorLogService.js';
import {
  isPipelineConfigured,
  sendToPipeline,
  readFileAsBase64,
  recordingToWav
} from './captureService.js';

const INBOX_SUMMARY_MAX = 180;

function clip(text) {
  return text.slice(0, INBOX_SUMMARY_MAX) + (text.length > INBOX_SUMMARY_MAX ? '...' : '');
}

function pipelineOutcome(result, successMessage) {
  if (result && result.analysis_ok === false) {
    const reasons = [...new Set((result.warnings || []).map((w) => friendlyError(w)))].join(' ');
    return {
      message: `Salvo na caixa de entrada, mas a IA não conseguiu analisar tudo. ${reasons}`.trim(),
      warning: true
    };
  }
  return { message: successMessage, warning: false };
}

// Um registro por motivo distinto informado pelo pipeline (download, IA, link ilegível...)
function logPipelineWarnings(result, ctx) {
  const reasons = [...new Set((result.warnings || []).map(String).filter(Boolean))];
  const itemId = result.item?.id ?? null;
  const entries = reasons.length ? reasons : ['A IA não conseguiu analisar o conteúdo (sem detalhes do pipeline).'];
  entries.forEach((message) => {
    void logCaptureError({ message, severity: 'warning', sourceType: ctx.sourceType, itemId, detail: ctx.detail });
  });
}

// Tenta o pipeline de IA; se falhar, devolve o aviso e o erro para o salvamento simples (inbox)
async function tryPipeline(buildPayload, successMessage, fallbackNotice, ctx) {
  if (!isPipelineConfigured()) return { outcome: null, notice: '', failure: null };
  try {
    const result = await sendToPipeline(await buildPayload());
    if (result && result.analysis_ok === false) logPipelineWarnings(result, ctx);
    return { outcome: pipelineOutcome(result, successMessage), notice: '', failure: null };
  } catch (err) {
    return { outcome: null, notice: `${friendlyError(err)} ${fallbackNotice}`, failure: err };
  }
}

// Salva a nota simples (inbox) e registra por que o pipeline não foi usado, ligado à nota criada
async function insertFallback(item, piped, ctx) {
  let saved;
  try {
    saved = await insertBrainItem(item);
  } catch (error) {
    void logCaptureError({ error, stage: 'save', sourceType: ctx.sourceType, detail: ctx.detail });
    throw error;
  }
  if (piped.failure) {
    void logCaptureError({
      error: piped.failure,
      sourceType: ctx.sourceType,
      itemId: saved?.id ?? null,
      detail: { ...ctx.detail, fallback: 'caixa de entrada' }
    });
  }
  return saved;
}

function fileSourceType(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'file';
}

function linkSourceType(url) {
  if (/instagram\.com\/(reel|p)\//i.test(url)) return 'reel';
  if (/youtu(be\.com|\.be)/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'reel';
  if (/\.pdf/i.test(url)) return 'pdf';
  return 'article';
}

async function saveLink({ url, hint }) {
  const sourceType = linkSourceType(url);
  const ctx = { sourceType, detail: { url } };
  const piped = await tryPipeline(
    () => ({ url, hint: hint || undefined }),
    'Link analisado e catalogado pela IA!',
    'Salvo na caixa de entrada sem análise.',
    ctx
  );
  if (piped.outcome) return piped.outcome;

  await insertFallback({
    title: hint || `Captura: ${url.replace(/^https?:\/\//, '').slice(0, 35)}...`,
    summary: 'Item salvo para processamento cognitivo.',
    source_type: sourceType,
    source_url: url,
    raw_content: `URL original capturada para indexação: ${url}`,
    key_takeaways: ['Aguardando extração detalhada de tópicos pelo n8n'],
    tags: [sourceType, 'inbox']
  }, piped, ctx);
  return { message: piped.notice || 'Salvo com sucesso no seu Segundo Cérebro!', warning: Boolean(piped.notice) };
}

const PROVISIONAL_TITLE_MAX = 60;

// Título provisório (primeira linha da nota) até a IA nomear a nota pelo assunto
export function provisionalTitle(body) {
  const firstLine = body.split('\n').map((l) => l.trim()).find(Boolean) || 'Nota Rápida';
  return firstLine.length > PROVISIONAL_TITLE_MAX ? `${firstLine.slice(0, PROVISIONAL_TITLE_MAX - 1).trimEnd()}…` : firstLine;
}

async function saveNote({ title, body, tags }) {
  const typedTitle = (title || '').trim();
  await insertBrainItem({
    title: typedTitle || provisionalTitle(body),
    summary: clip(body),
    source_type: 'note',
    source_url: null,
    raw_content: body,
    key_takeaways: [body.slice(0, 80)],
    tags: tags.length ? tags : ['nota-pessoal'],
    metadata: { pending_headline: { title: !typedTitle } }
  });
  return { message: 'Nota salva no seu Segundo Cérebro!', warning: false };
}

async function saveFile({ file, hint }) {
  const mime = file.type || 'application/octet-stream';
  const ctx = { sourceType: fileSourceType(mime), detail: { file_name: file.name, file_mime: mime, file_bytes: file.size } };
  const piped = await tryPipeline(
    async () => ({
      file_base64: await readFileAsBase64(file),
      file_mime: mime,
      file_name: file.name,
      hint: hint || undefined
    }),
    'Arquivo analisado e catalogado pela IA!',
    'Registrado na caixa de entrada sem análise.',
    ctx
  );
  if (piped.outcome) return piped.outcome;

  const textContent = mime.startsWith('text/') ? (await file.text()).trim() : '';
  const sourceType = mime === 'application/pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : 'note';
  await insertFallback({
    title: hint || file.name,
    summary: textContent ? clip(textContent) : `Arquivo anexado: ${file.name}`,
    source_type: sourceType,
    source_url: null,
    raw_content: textContent || `Arquivo anexado (${mime}): ${file.name}. Conteúdo não processado.`,
    key_takeaways: ['Aguardando extração detalhada pelo n8n'],
    tags: [sourceType, 'arquivo', 'inbox']
  }, piped, ctx);
  return { message: piped.notice || 'Arquivo registrado no seu Segundo Cérebro!', warning: Boolean(piped.notice) };
}

async function saveVoice({ blob, seconds }) {
  const ctx = { sourceType: 'voice', detail: { seconds, blob_mime: blob?.type, blob_bytes: blob?.size } };
  const piped = await tryPipeline(
    async () => ({
      file_base64: await readFileAsBase64(await recordingToWav(blob)),
      file_mime: 'audio/wav',
      file_name: 'voz.wav'
    }),
    'Áudio transcrito e catalogado pela IA!',
    'A gravação não foi transcrita.',
    ctx
  );
  if (piped.outcome) return piped.outcome;

  await insertFallback({
    title: `Áudio Gravado (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`,
    summary: `Gravação de voz com ${seconds}s (não transcrita).`,
    source_type: 'audio',
    source_url: null,
    raw_content: 'Áudio capturado pelo microfone, sem transcrição.',
    key_takeaways: ['Gravação de voz sem análise da IA'],
    tags: ['audio', 'voz', 'inbox']
  }, piped, ctx);
  return { message: piped.notice || 'Áudio registrado no seu Segundo Cérebro!', warning: Boolean(piped.notice) };
}

const SAVERS = { link: saveLink, note: saveNote, file: saveFile, voice: saveVoice };

/**
 * Executa uma captura ({ kind, ...dados }) e devolve { message, warning }.
 * Lança erro se nem o salvamento simples funcionar.
 */
export function executeCapture(spec) {
  const save = SAVERS[spec.kind];
  if (!save) throw new Error(`Tipo de captura desconhecido: ${spec.kind}`);
  return save(spec);
}
