import { APP_CONFIG } from '../constants/config.js';
import { getSession } from './supabaseClient.js';

export function isPipelineConfigured() {
  return Boolean(APP_CONFIG.n8n.webhookUrl);
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_FILE_TYPES =
  '.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg,application/pdf,text/plain,text/markdown,image/*,audio/*';

/**
 * Lê um File e devolve o conteúdo em base64 (sem o prefixo data:)
 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Envia um link ou arquivo ({ url } | { file_base64, file_mime, file_name }) ao pipeline
 * de ingestão (n8n), autenticado com o token da sessão
 */
export async function sendToPipeline(payload) {
  const session = await getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');

  const response = await fetch(APP_CONFIG.n8n.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Pipeline indisponível (HTTP ${response.status}).`);
  }
  return response.json();
}
