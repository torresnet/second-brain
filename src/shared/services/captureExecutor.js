import { insertBrainItem } from './supabaseClient.js';
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
    const reasons = (result.warnings || []).join(' ');
    return {
      message: `Salvo na caixa de entrada, mas a IA não conseguiu analisar tudo. ${reasons}`.trim(),
      warning: true
    };
  }
  return { message: successMessage, warning: false };
}

// Tenta o pipeline de IA; se falhar, devolve o aviso para o salvamento simples (inbox)
async function tryPipeline(buildPayload, successMessage, fallbackNotice) {
  if (!isPipelineConfigured()) return { outcome: null, notice: '' };
  try {
    const result = await sendToPipeline(await buildPayload());
    return { outcome: pipelineOutcome(result, successMessage), notice: '' };
  } catch (err) {
    return { outcome: null, notice: `${err.message} ${fallbackNotice}` };
  }
}

function linkSourceType(url) {
  if (/instagram\.com\/(reel|p)\//i.test(url)) return 'reel';
  if (/youtu(be\.com|\.be)/i.test(url)) return 'youtube';
  if (/tiktok\.com/i.test(url)) return 'reel';
  if (/\.pdf/i.test(url)) return 'pdf';
  return 'article';
}

async function saveLink({ url, hint }) {
  const piped = await tryPipeline(
    () => ({ url, hint: hint || undefined }),
    'Link analisado e catalogado pela IA!',
    'Salvo na caixa de entrada sem análise.'
  );
  if (piped.outcome) return piped.outcome;

  const sourceType = linkSourceType(url);
  await insertBrainItem({
    title: hint || `Captura: ${url.replace(/^https?:\/\//, '').slice(0, 35)}...`,
    summary: 'Item salvo para processamento cognitivo.',
    source_type: sourceType,
    source_url: url,
    raw_content: `URL original capturada para indexação: ${url}`,
    key_takeaways: ['Aguardando extração detalhada de tópicos pelo n8n'],
    tags: [sourceType, 'inbox']
  });
  return { message: piped.notice || 'Salvo com sucesso no seu Segundo Cérebro!', warning: Boolean(piped.notice) };
}

async function saveNote({ title, body, tags }) {
  await insertBrainItem({
    title,
    summary: clip(body),
    source_type: 'note',
    source_url: null,
    raw_content: body,
    key_takeaways: [body.slice(0, 80)],
    tags: tags.length ? tags : ['nota-pessoal']
  });
  return { message: 'Nota salva no seu Segundo Cérebro!', warning: false };
}

async function saveFile({ file, hint }) {
  const mime = file.type || 'application/octet-stream';
  const piped = await tryPipeline(
    async () => ({
      file_base64: await readFileAsBase64(file),
      file_mime: mime,
      file_name: file.name,
      hint: hint || undefined
    }),
    'Arquivo analisado e catalogado pela IA!',
    'Registrado na caixa de entrada sem análise.'
  );
  if (piped.outcome) return piped.outcome;

  const textContent = mime.startsWith('text/') ? (await file.text()).trim() : '';
  const sourceType = mime === 'application/pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : 'note';
  await insertBrainItem({
    title: hint || file.name,
    summary: textContent ? clip(textContent) : `Arquivo anexado: ${file.name}`,
    source_type: sourceType,
    source_url: null,
    raw_content: textContent || `Arquivo anexado (${mime}): ${file.name}. Conteúdo não processado.`,
    key_takeaways: ['Aguardando extração detalhada pelo n8n'],
    tags: [sourceType, 'arquivo', 'inbox']
  });
  return { message: piped.notice || 'Arquivo registrado no seu Segundo Cérebro!', warning: Boolean(piped.notice) };
}

async function saveVoice({ blob, seconds }) {
  const piped = await tryPipeline(
    async () => ({
      file_base64: await readFileAsBase64(await recordingToWav(blob)),
      file_mime: 'audio/wav',
      file_name: 'voz.wav'
    }),
    'Áudio transcrito e catalogado pela IA!',
    'A gravação não foi transcrita.'
  );
  if (piped.outcome) return piped.outcome;

  await insertBrainItem({
    title: `Áudio Gravado (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`,
    summary: `Gravação de voz com ${seconds}s (não transcrita).`,
    source_type: 'audio',
    source_url: null,
    raw_content: 'Áudio capturado pelo microfone, sem transcrição.',
    key_takeaways: ['Gravação de voz sem análise da IA'],
    tags: ['audio', 'voz', 'inbox']
  });
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
