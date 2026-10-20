// Indexador em segundo plano: chamado pelo pg_cron (sem o app aberto) e processa as notas pendentes.
//   POST (header x-cron-secret) -> processa pendentes até esgotar o orçamento de tempo desta execução.
// Não usa a sessão do usuário: autentica pelo segredo do agendador (Vault) e acessa o banco com a service role.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { geminiFromEnv, createProcessStore, safeFetch } from '../_shared/runtime.ts';
import { buildEntry, categoryOf } from '../_shared/errorlog.ts';
import { processItem } from '../_shared/process.ts';
import { drainPending } from '../_shared/worker.ts';

const START_BUDGET_MS = 70_000; // um item leva até ~60 s; o limite da função é 150 s
const MAX_ITEMS_PER_RUN = 5;
const STALE_AFTER_MS = 10 * 60 * 1000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return reply({ error: 'Servidor sem configuração do Supabase.' }, 500);
  const gemini = geminiFromEnv();
  if (!gemini) return reply({ error: 'GEMINI_API_KEY não configurada nas secrets da função.' }, 500);

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // O segredo do agendador mora só no Vault do banco; a RPC compara sem expô-lo
  const provided = req.headers.get('x-cron-secret') ?? '';
  const { data: authorized, error: authError } = await supabase.rpc('brain_check_cron_secret', { p_secret: provided });
  if (authError) {
    console.error('brain-index-worker: falha ao validar o segredo:', authError.message);
    return reply({ error: 'Falha ao validar o segredo.' }, 500);
  }
  if (authorized !== true) return reply({ error: 'Não autorizado.' }, 401);

  const store = createProcessStore(supabase);
  const deps = { store, gemini, safeFetch, newId: () => crypto.randomUUID() };

  const summary = await drainPending({
    now: () => Date.now(),
    startBudgetMs: START_BUDGET_MS,
    maxItems: MAX_ITEMS_PER_RUN,
    async listPending(excludeIds) {
      const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
      let query = supabase
        .from('brain_items')
        .select('id')
        .or(`analysis_status.eq.pending,and(analysis_status.eq.processing,analysis_updated_at.lt.${staleBefore})`)
        .order('created_at', { ascending: false })
        .limit(1);
      if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`);
      const { data, error } = await query;
      if (error) throw new Error(`Falha ao listar pendentes: ${error.message}`);
      return (data ?? []).map((r: { id: string }) => r.id);
    },
    async processOne(id) {
      try {
        return await processItem(id, deps);
      } catch (error) {
        console.error('brain-index-worker falhou:', id, error instanceof Error ? error.message : error);
        try {
          await store.logEvent?.(id, buildEntry({
            stage: 'pipeline', category: categoryOf(error), severity: 'error',
            message: error instanceof Error ? error.message : String(error)
          }));
        } catch {
          // o log nunca pode derrubar o worker
        }
        return { status: 'failed' as const };
      }
    }
  }).catch((error) => {
    console.error('brain-index-worker: execução interrompida:', error instanceof Error ? error.message : error);
    return null;
  });

  if (!summary) return reply({ error: 'Execução interrompida. Será retomada na próxima rodada.' }, 500);
  return reply(summary);
});
