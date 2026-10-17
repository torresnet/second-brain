// Responde perguntas sobre o acervo do Segundo Cérebro.
//   POST { question: string, history?: [{ role: "user"|"assistant", content: string }] }
// Exige o token do dono (mesma regra do RLS).

import { askBrain } from '../_shared/ask.ts';
import type { HistoryTurn } from '../_shared/ask.ts';
import { createAskDeps, geminiFromEnv, json, preflight, readJson, requireOwner } from '../_shared/runtime.ts';

const MAX_QUESTION = 2000;
const MAX_HISTORY = 8;

function parseHistory(value: unknown): HistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is { role: string; content: string } =>
      Boolean(t) && typeof t === 'object' &&
      ((t as { role?: string }).role === 'user' || (t as { role?: string }).role === 'assistant') &&
      typeof (t as { content?: unknown }).content === 'string')
    .slice(-MAX_HISTORY)
    .map(t => ({ role: t.role as HistoryTurn['role'], content: t.content.slice(0, 1500) }));
}

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;
  if (req.method !== 'POST') return json(req, { error: 'Método não permitido.' }, 405);

  const auth = await requireOwner(req);
  if ('error' in auth) return auth.error;

  const gemini = geminiFromEnv();
  if (!gemini) return json(req, { error: 'GEMINI_API_KEY não configurada nas secrets da função.' }, 500);

  const body = await readJson(req);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return json(req, { error: 'Informe a pergunta.' }, 400);
  if (question.length > MAX_QUESTION) return json(req, { error: `A pergunta excede ${MAX_QUESTION} caracteres.` }, 400);

  try {
    const result = await askBrain(question, parseHistory(body?.history), createAskDeps(auth.supabase, gemini));
    return json(req, result);
  } catch (error) {
    console.error('brain-ask falhou:', error instanceof Error ? error.message : error);
    return json(req, { error: 'Não foi possível consultar o acervo agora. Tente novamente.' }, 500);
  }
});
