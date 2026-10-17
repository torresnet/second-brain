import { APP_CONFIG } from '../constants/config.js';
import { getSession } from './supabaseClient.js';

export function isPipelineConfigured() {
  return Boolean(APP_CONFIG.n8n.webhookUrl);
}

/**
 * Envia um link ao pipeline de ingestão (n8n), autenticado com o token da sessão
 */
export async function sendToPipeline({ url }) {
  const session = await getSession();
  if (!session) throw new Error('Sessão expirada. Entre novamente.');

  const response = await fetch(APP_CONFIG.n8n.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Pipeline indisponível (HTTP ${response.status}).`);
  }
  return response.json();
}
