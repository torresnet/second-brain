// Orquestra o enriquecimento de um item: átomos -> cobertura -> varredura de links -> trechos -> embeddings -> gravação.

import { buildAtomChunkText, ensureCoverage, normalizeAtoms, normalizeKind } from './atoms.ts';
import { buildEntry, categoryOf } from './errorlog.ts';
import type { ErrorLogEntry } from './errorlog.ts';
import type { Atom } from './atoms.ts';
import { crawlLink } from './crawl.ts';
import { examplesSearchText, normalizeExamples } from './examples.ts';
import type { PracticalExample } from './examples.ts';
import type { SafeFetch } from './crawl.ts';
import type { Gemini } from './gemini.ts';
import { buildAtomizePrompt, buildExamplesPrompt, buildLinkSummaryPrompt } from './prompts.ts';
import { chunkText, extractUrls, isUnreadableCapture, normalizeUrl, slugify, splitWindows, truncate } from './text.ts';

export interface ItemRow {
  id: string;
  title: string | null;
  summary: string | null;
  source_type: string | null;
  source_url: string | null;
  raw_content: string | null;
  key_takeaways: unknown;
  entities: unknown;
  tags: string[] | null;
  metadata: unknown;
  analysis_status?: string | null;
}

export interface ChunkInput {
  atom_id: string | null;
  chunk_type: 'summary' | 'content' | 'atom';
  chunk_index: number;
  content: string;
  embedding: number[] | null;
}

export interface ReplaceArgs {
  itemId: string;
  atoms: Atom[];
  chunks: ChunkInput[];
  category: string | null;
  useCases: string[];
  status: 'done' | 'partial';
  error: string | null;
}

export interface ProcessStore {
  getItem(id: string): Promise<ItemRow | null>;
  claim(id: string): Promise<boolean>;
  replace(args: ReplaceArgs): Promise<{ atoms: number; chunks: number }>;
  saveExamples(id: string, examples: PracticalExample[]): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
  /** Cota da IA esgotada: volta o item para "pendente" (recuperável) em vez de marcá-lo como falho. */
  markDeferred(id: string, message: string): Promise<void>;
  /** Histórico de falhas (tabela capture_errors). Opcional: falhar ao registrar nunca interrompe o processamento. */
  logEvent?(itemId: string, entry: ErrorLogEntry): Promise<void>;
}

export interface ProcessDeps {
  store: ProcessStore;
  gemini: Gemini;
  safeFetch: SafeFetch;
  newId: () => string;
  now?: () => Date;
}

export interface ProcessResult {
  status: 'done' | 'partial' | 'failed' | 'busy' | 'not_found' | 'quota';
  atoms: number;
  chunks: number;
  links: { ok: number; inaccessible: number; skipped: number };
  warnings: string[];
}

const MAX_LINKS_PER_ITEM = 5;
// A Edge Function morre em ~150 s: o que não couber no orçamento é pulado com aviso, nunca perdido em silêncio
const WINDOW_DEADLINE_MS = 95_000;
const CRAWL_DEADLINE_MS = 85_000;
const SUMMARY_DEADLINE_MS = 105_000;
const EXAMPLES_DEADLINE_MS = 108_000;
const CRAWL_CONCURRENCY = 4;
const ATOMIZE_CONCURRENCY = 2;
const MAX_CONTENT_CHUNKS = 400;
const MAX_EMBEDDED_CONTENT_CHUNKS = 40;
const LINK_KINDS = new Set(['ferramenta', 'repositorio', 'biblioteca', 'skill', 'plugin', 'mcp', 'api', 'servico', 'link', 'curso', 'documentacao']);

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const UNREADABLE_MESSAGE = 'O conteúdo do link não pôde ser lido na captura (só a página-base foi obtida).';
const UNREADABLE_MESSAGE_FOR_USER = `${UNREADABLE_MESSAGE} Reprocessar não resolve: capture o link novamente.`;

const QUOTA_MESSAGE = 'A IA atingiu o limite de uso por agora. A nota continua salva e será indexada quando a cota voltar: use "Indexar agora" mais tarde.';
const isQuotaError = (e: unknown) => (e as { status?: number } | null)?.status === 429;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function listText(value: unknown): string {
  return Array.isArray(value) ? value.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join('; ') : '';
}

function sourceTexts(item: ItemRow): string[] {
  return [
    item.raw_content, item.summary, listText(item.key_takeaways), listText(item.entities),
    item.metadata ? JSON.stringify(item.metadata) : ''
  ].filter((t): t is string => Boolean(t));
}

export async function processItem(itemId: string, deps: ProcessDeps): Promise<ProcessResult> {
  const { store, gemini, safeFetch, newId } = deps;
  const empty: ProcessResult = { status: 'failed', atoms: 0, chunks: 0, links: { ok: 0, inaccessible: 0, skipped: 0 }, warnings: [] };

  const item = await store.getItem(itemId);
  if (!item) return { ...empty, status: 'not_found' };
  if (!(await store.claim(itemId))) return { ...empty, status: 'busy' };

  const report = async (entry: ErrorLogEntry) => {
    try {
      await store.logEvent?.(itemId, buildEntry({
        ...entry,
        detail: { source_type: item.source_type, title: item.title, ...entry.detail }
      }));
    } catch {
      // o log nunca pode derrubar o processamento
    }
  };

  // Sem o conteúdo do link não há o que analisar: não gasta cota da IA e não marca como indexada
  if (isUnreadableCapture(item.tags)) {
    await report({ stage: 'pipeline', category: 'unreadable', severity: 'error', message: UNREADABLE_MESSAGE });
    await store.markFailed(itemId, UNREADABLE_MESSAGE);
    return { ...empty, status: 'failed', warnings: [UNREADABLE_MESSAGE_FOR_USER] };
  }

  const warnings: string[] = [];
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const hadKnowledge = item.analysis_status === 'done' || item.analysis_status === 'partial';
  try {
    const title = item.title?.trim() || 'Sem título';
    const texts = sourceTexts(item);
    const sourceUrls = extractUrls(...texts);

    // 1) átomos via IA, janela a janela (nada fica de fora em textos longos)
    const body = (item.raw_content?.trim() || [item.summary, listText(item.key_takeaways)].filter(Boolean).join('\n\n')).trim();
    const windows = splitWindows(body || title);
    let failedWindows = 0;
    let quotaWindows = 0;
    let lastWindowError: unknown = null;
    let category: string | null = null;
    let useCases: string[] = [];
    const rawAtoms: unknown[] = [];

    await mapLimit(windows, ATOMIZE_CONCURRENCY, async (windowText, index) => {
      if (elapsed() > WINDOW_DEADLINE_MS) {
        failedWindows++;
        warnings.push(`Parte ${index + 1}/${windows.length} não analisada: tempo esgotado.`);
        return;
      }
      try {
        const out = (await gemini.generateJson(buildAtomizePrompt(item, windowText, index, windows.length))) as Record<string, unknown>;
        if (Array.isArray(out?.atoms)) rawAtoms.push(...out.atoms);
        if (!category && typeof out?.category === 'string') category = slugify(out.category).slice(0, 30) || null;
        if (Array.isArray(out?.use_cases)) {
          useCases = [...new Set([...useCases, ...out.use_cases.filter((u): u is string => typeof u === 'string').map(u => truncate(u.trim(), 140))])].slice(0, 8);
        }
      } catch (error) {
        failedWindows++;
        lastWindowError = error;
        if (isQuotaError(error)) quotaWindows++;
        warnings.push(`Análise por IA falhou na parte ${index + 1}/${windows.length}: ${errText(error)}`);
      }
    });

    if (quotaWindows === windows.length) {
      await report({ stage: 'ai', category: 'quota', severity: 'warning', message: QUOTA_MESSAGE, detail: { windows: windows.length } });
      await store.markDeferred(itemId, QUOTA_MESSAGE);
      return { ...empty, status: 'quota', warnings: [QUOTA_MESSAGE] };
    }
    if (failedWindows === windows.length) {
      const message = warnings.join(' | ') || 'A análise por IA falhou.';
      await report({ stage: 'ai', category: categoryOf(lastWindowError), severity: 'error', message, detail: { windows: windows.length } });
      await store.markFailed(itemId, truncate(message, 500));
      return { ...empty, status: 'failed', warnings };
    }

    let atoms = normalizeAtoms(rawAtoms, newId, sourceUrls);

    // 2) cobertura determinística: todo link/código do texto precisa virar átomo
    const coverage = ensureCoverage(atoms, { texts, title, ownUrl: item.source_url }, newId);
    atoms = coverage.atoms;
    if (coverage.addedLinks.length) warnings.push(`${coverage.addedLinks.length} link(s) completado(s) automaticamente.`);
    if (coverage.addedCode) warnings.push(`${coverage.addedCode} trecho(s) de código completado(s) automaticamente.`);

    // 3) varredura de links (profundidade 1)
    const links = { ok: 0, inaccessible: 0, skipped: 0 };
    const ownUrl = item.source_url ? normalizeUrl(item.source_url) : null;
    const candidates = atoms
      .filter(a => a.url && a.url !== ownUrl)
      .sort((a, b) => Number(LINK_KINDS.has(b.kind)) - Number(LINK_KINDS.has(a.kind)))
      .slice(0, MAX_LINKS_PER_ITEM);
    const fetchedAt = (deps.now?.() ?? new Date()).toISOString();

    if (candidates.length && elapsed() > CRAWL_DEADLINE_MS) warnings.push('Links não varridos: tempo esgotado.');
    const crawled = elapsed() > CRAWL_DEADLINE_MS ? [] : await mapLimit(candidates, CRAWL_CONCURRENCY, async atom => ({
      atom, result: await crawlLink(atom.url as string, safeFetch)
    }));
    for (const { atom, result } of crawled) {
      atom.fetch_status = result.status;
      atom.fetch_error = result.error ?? null;
      atom.fetched_at = fetchedAt;
      if (result.status === 'ok') atom.fetched_content = result.text ?? null;
      links[result.status]++;
    }
    const unreachable = crawled.filter(c => c.result.status === 'inaccessible');
    if (unreachable.length) {
      await report({
        stage: 'crawl', category: 'http', severity: 'warning',
        message: `${unreachable.length} link(s) não puderam ser lidos na varredura.`,
        detail: { links: unreachable.map(c => ({ url: c.atom.url, error: c.result.error ?? null })) }
      });
    }

    // 4) "o que tem dentro" de cada link lido
    const readable = crawled.filter(c => c.result.status === 'ok' && c.result.text);
    if (readable.length && elapsed() <= SUMMARY_DEADLINE_MS) {
      try {
        const pages = readable.map((c, i) => ({ n: i + 1, url: c.atom.url as string, title: c.result.title ?? '', text: c.result.text as string }));
        const out = (await gemini.generateJson(buildLinkSummaryPrompt(pages))) as { pages?: Array<Record<string, unknown>> };
        for (const entry of out?.pages ?? []) {
          const target = readable[Number(entry.n) - 1]?.atom;
          if (!target) continue;
          const summary = typeof entry.summary === 'string' ? truncate(entry.summary.trim(), 1500) : '';
          if (summary) target.contents_summary = summary;
          if (target.kind === 'link' && typeof entry.kind === 'string') target.kind = normalizeKind(entry.kind);
          if (typeof entry.name === 'string' && entry.name.trim() && target.name === target.url) target.name = truncate(entry.name.trim(), 200);
        }
      } catch (error) {
        warnings.push(`Não foi possível resumir o conteúdo dos links: ${errText(error)}`);
        await report({ stage: 'ai', category: categoryOf(error), severity: 'warning', message: `Resumo dos links falhou: ${errText(error)}` });
      }
    }
    for (const a of atoms) {
      if (!a.explanation && a.contents_summary) a.explanation = a.contents_summary;
    }

    // 5) exemplos práticos que juntam o conhecimento da nota (falhar aqui nunca impede de salvar)
    let examples: PracticalExample[] | null = null;
    if (atoms.length && elapsed() <= EXAMPLES_DEADLINE_MS) {
      try {
        const out = (await gemini.generateJson(buildExamplesPrompt(item, atoms, useCases))) as { examples?: unknown };
        if (Array.isArray(out?.examples)) examples = normalizeExamples(out.examples);
      } catch (error) {
        warnings.push(`Não foi possível gerar os exemplos práticos: ${errText(error)}`);
        await report({ stage: 'ai', category: categoryOf(error), severity: 'warning', message: `Exemplos práticos falharam: ${errText(error)}` });
      }
    }

    // 6) trechos para busca
    const summaryText = [
      title, item.summary, listText(item.key_takeaways),
      category ? `Categoria: ${category}` : '', useCases.length ? `Serve para: ${useCases.join('; ')}` : '',
      examples?.length ? examplesSearchText(examples) : '',
      item.tags?.length ? `Tags: ${item.tags.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    const planned: Array<Omit<ChunkInput, 'embedding' | 'chunk_index'>> = [
      { atom_id: null, chunk_type: 'summary', content: summaryText },
      ...chunkText(item.raw_content, 1200, 200, MAX_CONTENT_CHUNKS).map(content => ({ atom_id: null, chunk_type: 'content' as const, content })),
      ...atoms.map(a => ({ atom_id: a.id, chunk_type: 'atom' as const, content: buildAtomChunkText(a) }))
    ];

    // Trechos do conteúdo bruto além do limite recebem vetor por amostragem; todos continuam na busca por texto
    const contentIdx = planned.flatMap((c, i) => (c.chunk_type === 'content' ? [i] : []));
    const stride = Math.max(1, Math.ceil(contentIdx.length / MAX_EMBEDDED_CONTENT_CHUNKS));
    const skipVector = new Set(contentIdx.filter((_, n) => n % stride !== 0));
    const toEmbed = planned.map((_, i) => i).filter(i => !skipVector.has(i));
    const embedded = await gemini.embedBatch(toEmbed.map(i => planned[i].content), 'RETRIEVAL_DOCUMENT');
    if (embedded.errors.length) {
      warnings.push(`Falha ao gerar ${embedded.errors.length} vetor(es) de busca: ${embedded.errors[0]}`);
      await report({
        stage: 'embedding', category: categoryOf(embedded.errors[0]), severity: 'warning',
        message: `Falha ao gerar ${embedded.errors.length} vetor(es) de busca: ${embedded.errors[0]}`,
        detail: { failed: embedded.errors.length, total: toEmbed.length }
      });
    }
    const vectorAt = new Map(toEmbed.map((plannedIndex, n) => [plannedIndex, embedded.vectors[n] ?? null]));
    const chunks: ChunkInput[] = planned.map((c, i) => ({ ...c, chunk_index: i, embedding: vectorAt.get(i) ?? null }));

    // 7) gravação atômica
    const partial = failedWindows > 0 || embedded.errors.length > 0;
    // reprocesso incompleto nunca apaga conhecimento anterior que estava bom
    if (partial && hadKnowledge) {
      const message = truncate(`Reprocessamento incompleto; o conhecimento anterior foi mantido. ${warnings.join(' | ')}`, 500);
      await store.markFailed(itemId, message);
      return { ...empty, status: 'failed', warnings };
    }
    const status = partial ? 'partial' : 'done';
    const saved = await store.replace({
      itemId, atoms, chunks, category, useCases, status,
      error: partial ? truncate(warnings.join(' | '), 500) : null
    });
    // exemplos são extras: se falharem, o conhecimento já salvo continua valendo (e os exemplos anteriores ficam)
    if (examples) {
      try {
        await store.saveExamples(itemId, examples);
      } catch (error) {
        warnings.push(`Não foi possível salvar os exemplos práticos: ${errText(error)}`);
      }
    }
    return { status, atoms: saved.atoms, chunks: saved.chunks, links, warnings };
  } catch (error) {
    const message = errText(error);
    await report({ stage: 'pipeline', category: categoryOf(error), severity: 'error', message, detail: { warnings } });
    try {
      await store.markFailed(itemId, truncate(message, 500));
    } catch {
      // o erro original é o que importa
    }
    return { ...empty, status: 'failed', warnings: [...warnings, message] };
  }
}
