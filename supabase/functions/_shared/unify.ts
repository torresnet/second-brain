// Unificação de notas: lê o pedido deixado pela mesclagem (metadata.pending_unify), valida o que a IA devolve
// e garante, sem depender da IA, que nenhum link das notas originais se perca. Sem dependências do Deno.

import { extractUrls, truncate } from './text.ts';

export interface UnifyNote {
  title: string | null;
  url: string | null;
  summary: string | null;
  raw_content: string | null;
  created_at?: string | null;
}

export interface UnifyRequest {
  base: UnifyNote;
  sources: UnifyNote[];
}

export interface UnifiedNote {
  title: string;
  summary: string;
  keyTakeaways: string[];
  /** Texto unificado; `null` quando a IA encurtou demais e o texto provisório (completo) é mantido. */
  content: string | null;
  /** Links das notas originais que a IA não manteve e foram anexados ao final. */
  restoredLinks: string[];
}

/** Acima disto (soma das notas) a IA não reescreve o texto: ele cabe mal na resposta e na janela de tempo. */
export const UNIFY_MAX_CHARS = 45_000;
/** O texto unificado nunca pode ser bem menor que a maior nota: unificar é tirar repetição, não resumir. */
export const UNIFY_MIN_KEEP_RATIO = 0.6;

const TITLE_MAX = 90;
const SUMMARY_MAX = 400;
const TAKEAWAY_MAX = 220;
const MAX_TAKEAWAYS = 6;

const asNote = (value: unknown): UnifyNote | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' ? x : null);
  return { title: text(v.title), url: text(v.url), summary: text(v.summary), raw_content: text(v.raw_content), created_at: text(v.created_at) };
};

/** Pedido de unificação pendente na nota (ou `null` quando não há). */
export function pendingUnify(metadata: unknown): UnifyRequest | null {
  const raw = (metadata as { pending_unify?: unknown } | null)?.pending_unify;
  if (!raw || typeof raw !== 'object') return null;
  const base = asNote((raw as Record<string, unknown>).base);
  const sources = (Array.isArray((raw as Record<string, unknown>).sources) ? (raw as { sources: unknown[] }).sources : [])
    .map(asNote)
    .filter((n): n is UnifyNote => n !== null);
  return base && sources.length ? { base, sources } : null;
}

export const unifyNotes = (request: UnifyRequest): UnifyNote[] => [request.base, ...request.sources];

export function unifyTotalChars(request: UnifyRequest): number {
  return unifyNotes(request).reduce((sum, n) => sum + (n.raw_content?.length ?? 0), 0);
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? truncate(v.trim().replace(/\s+/g, ' '), max) : '');

/**
 * Valida a resposta da IA. Devolve `null` se faltar título, resumo ou pontos-chave (a unificação é tentada de novo).
 * O texto só é aceito se não for bem menor que a maior nota; os links das notas originais ausentes são anexados.
 */
export function parseUnified(out: unknown, request: UnifyRequest, { withContent = true }: { withContent?: boolean } = {}): UnifiedNote | null {
  const o = (out ?? {}) as Record<string, unknown>;
  const title = clean(o.title, TITLE_MAX).replace(/[.\s]+$/, '');
  const summary = clean(o.summary, SUMMARY_MAX);
  const keyTakeaways = (Array.isArray(o.key_takeaways) ? o.key_takeaways : [])
    .map(t => clean(t, TAKEAWAY_MAX)).filter(Boolean).slice(0, MAX_TAKEAWAYS);
  if (!title || !summary || !keyTakeaways.length) return null;
  if (!withContent) return { title, summary, keyTakeaways, content: null, restoredLinks: [] };

  const notes = unifyNotes(request);
  const longest = Math.max(...notes.map(n => n.raw_content?.trim().length ?? 0));
  let content = typeof o.content === 'string' ? o.content.trim() : '';
  if (!content || content.length < longest * UNIFY_MIN_KEEP_RATIO) {
    return { title, summary, keyTakeaways, content: null, restoredLinks: [] };
  }

  const kept = new Set(extractUrls(content));
  const wanted = extractUrls(...notes.flatMap(n => [n.url, n.raw_content]));
  const restoredLinks = wanted.filter(u => !kept.has(u));
  if (restoredLinks.length) content += `\n\nLinks das notas originais:\n${restoredLinks.map(u => `- ${u}`).join('\n')}`;
  return { title, summary, keyTakeaways, content, restoredLinks };
}
