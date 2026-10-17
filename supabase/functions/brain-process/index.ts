// Enriquece itens do Segundo Cérebro: átomos de conhecimento, varredura de links, trechos e embeddings.
//   POST { item_id: "<uuid>" }                       processa um item
//   POST { mode: "pending", limit?: 1 }           processa itens pendentes (nunca os falhos: ficam para nova tentativa manual)
// Exige o token do dono (mesma regra do RLS).

import { geminiFromEnv, json, preflight, readJson, requireOwner, createProcessStore, safeFetch } from '../_shared/runtime.ts';
import { processItem } from '../_shared/process.ts';
import type { ProcessResult } from '../_shared/process.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 1;

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== 'POST') return json(req, { error: 'Método não permitido.' }, 405);

  const auth = await requireOwner(req);
  if ('error' in auth) return auth.error;
  const { supabase } = auth;

  const gemini = geminiFromEnv();
  if (!gemini) return json(req, { error: 'GEMINI_API_KEY não configurada nas secrets da função.' }, 500);

  const body = await readJson(req);
  if (!body) return json(req, { error: 'Corpo da requisição inválido.' }, 400);

  const store = createProcessStore(supabase);
  const deps = { store, gemini, safeFetch, newId: () => crypto.randomUUID() };

  let ids: string[];
  if (body.mode === 'pending') {
    const limit = Math.min(Math.max(Number(body.limit) || 1, 1), MAX_BATCH);
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('brain_items')
      .select('id')
      .or(`analysis_status.eq.pending,and(analysis_status.eq.processing,analysis_updated_at.lt.${staleBefore})`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('brain-process: falha ao listar pendentes:', error.message);
      return json(req, { error: 'Não foi possível listar os itens pendentes. Tente novamente.' }, 500);
    }
    ids = (data ?? []).map((r: { id: string }) => r.id);
  } else if (typeof body.item_id === 'string' && UUID.test(body.item_id)) {
    ids = [body.item_id];
  } else {
    return json(req, { error: 'Informe item_id (uuid) ou mode "pending".' }, 400);
  }

  const results: Array<ProcessResult & { item_id: string }> = [];
  for (const id of ids) {
    try {
      results.push({ item_id: id, ...(await processItem(id, deps)) });
    } catch (error) {
      // O detalhe (pode conter mensagens do banco) fica no log; o cliente recebe só uma mensagem genérica
      console.error('brain-process falhou:', id, error instanceof Error ? error.message : error);
      results.push({
        item_id: id, status: 'failed', atoms: 0, chunks: 0, links: { ok: 0, inaccessible: 0, skipped: 0 },
        warnings: ['Erro inesperado ao processar a nota. Tente novamente em instantes.']
      });
    }
  }

  let remaining = 0;
  if (body.mode === 'pending') {
    const { count } = await supabase
      .from('brain_items')
      .select('id', { count: 'exact', head: true })
      .eq('analysis_status', 'pending');
    remaining = count ?? 0;
  }
  return json(req, { results, remaining });
});
