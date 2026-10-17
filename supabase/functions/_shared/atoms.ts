// Normalização, cobertura e texto de busca dos "átomos" de conhecimento.

import { canonicalKey, extractCodeBlocks, extractUrls, hostOf, normalizeUrl, slugify, squash, truncate } from './text.ts';
import type { CodeBlock } from './text.ts';

export interface Atom {
  id: string;
  kind: string;
  name: string;
  content: string | null;
  explanation: string;
  use_for: string | null;
  url: string | null;
  language: string | null;
  questions: string[];
  tags: string[];
  source_pos: string | null;
  inferred: boolean;
  fetch_status: 'ok' | 'inaccessible' | 'skipped' | null;
  fetch_error: string | null;
  fetched_content: string | null;
  contents_summary: string | null;
  fetched_at: string | null;
  canonical_key: string;
}

const KIND_ALIASES: Record<string, string> = {
  tool: 'ferramenta', ferramentas: 'ferramenta', software: 'ferramenta', app: 'ferramenta', aplicativo: 'ferramenta',
  repo: 'repositorio', repository: 'repositorio', repositorios: 'repositorio', github: 'repositorio',
  library: 'biblioteca', lib: 'biblioteca', pacote: 'biblioteca', package: 'biblioteca', framework: 'biblioteca',
  code: 'codigo', snippet: 'codigo', script: 'codigo', 'trecho-de-codigo': 'codigo',
  command: 'comando', cli: 'comando', 'linha-de-comando': 'comando',
  step: 'passo-a-passo', steps: 'passo-a-passo', tutorial: 'passo-a-passo', procedimento: 'passo-a-passo',
  config: 'configuracao', configuration: 'configuracao', setting: 'configuracao',
  person: 'pessoa', people: 'pessoa', company: 'empresa', organization: 'empresa',
  concept: 'conceito', idea: 'ideia', recommendation: 'recomendacao', reference: 'referencia',
  data: 'dado', number: 'dado', statistic: 'dado', metric: 'dado', price: 'dado', preco: 'dado',
  service: 'servico', platform: 'servico', plataforma: 'servico', website: 'link', site: 'link', url: 'link'
};

const LIMITS = { name: 200, content: 20000, explanation: 2500, useFor: 1200, question: 220, tag: 40, pos: 60 };

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function asList(value: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = truncate(asText(entry), maxLen).trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeKind(raw: unknown): string {
  const slug = slugify(asText(raw)).slice(0, 40);
  if (slug.length < 2) return 'outro';
  return KIND_ALIASES[slug] ?? slug;
}

export function emptyAtom(partial: Partial<Atom> & { kind: string; name: string; id: string }): Atom {
  const url = partial.url ? normalizeUrl(partial.url) : null;
  return {
    content: null, explanation: '', use_for: null, language: null, questions: [], tags: [], source_pos: null,
    inferred: false, fetch_status: null, fetch_error: null, fetched_content: null, contents_summary: null,
    fetched_at: null,
    ...partial,
    url,
    canonical_key: partial.canonical_key ?? canonicalKey(partial.kind, partial.name, url, Boolean(partial.content))
  };
}

/** Converte a saída (não confiável) do modelo em átomos válidos. `sourceUrls` marca URLs não vistas no texto como inferidas. */
export function normalizeAtoms(raw: unknown, newId: () => string, sourceUrls: string[] = []): Atom[] {
  if (!Array.isArray(raw)) return [];
  const knownKeys = new Set(sourceUrls.map(u => canonicalKey('link', '', u)));
  const merged = new Map<string, Atom>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const content = asText(r.content) ? truncate(asText(r.content), LIMITS.content) : null;
    let name = truncate(asText(r.name), LIMITS.name);
    const url = r.url ? normalizeUrl(asText(r.url)) : null;
    if (!name && url) name = hostOf(url);
    if (!name && !content) continue;
    if (!name && content) name = truncate(squash(content), 80);

    const kind = normalizeKind(r.kind);
    const atom = emptyAtom({
      id: newId(),
      kind,
      name,
      content,
      explanation: truncate(asText(r.explanation), LIMITS.explanation),
      use_for: asText(r.use_for) ? truncate(asText(r.use_for), LIMITS.useFor) : null,
      url,
      language: asText(r.language) ? truncate(asText(r.language).toLowerCase(), 30) : null,
      questions: asList(r.questions, 8, LIMITS.question),
      tags: asList(r.tags, 10, LIMITS.tag).map(t => slugify(t)).filter(Boolean),
      source_pos: asText(r.where) || asText(r.source_pos) ? truncate(asText(r.where) || asText(r.source_pos), LIMITS.pos) : null,
      inferred: url ? !knownKeys.has(canonicalKey('link', '', url)) : false
    });

    const existing = merged.get(atom.canonical_key);
    merged.set(atom.canonical_key, existing ? mergeAtoms(existing, atom) : atom);
  }
  return [...merged.values()];
}

function mergeAtoms(a: Atom, b: Atom): Atom {
  const longer = (x: string | null, y: string | null) => ((y?.length ?? 0) > (x?.length ?? 0) ? y : x);
  return {
    ...a,
    content: longer(a.content, b.content),
    explanation: longer(a.explanation, b.explanation) ?? '',
    use_for: longer(a.use_for, b.use_for),
    language: a.language ?? b.language,
    questions: [...new Set([...a.questions, ...b.questions])].slice(0, 8),
    tags: [...new Set([...a.tags, ...b.tags])].slice(0, 10),
    inferred: a.inferred && b.inferred
  };
}

export interface CoverageResult {
  atoms: Atom[];
  addedLinks: string[];
  addedCode: number;
}

const MAX_FALLBACK_LINKS = 30;

/** Garante, sem depender da IA, que todo link e todo bloco de código do texto-fonte virou um átomo. */
export function ensureCoverage(
  atoms: Atom[],
  input: { texts: Array<string | null | undefined>; title: string; ownUrl?: string | null },
  newId: () => string
): CoverageResult {
  const result = [...atoms];
  const ownKey = input.ownUrl ? canonicalKey('link', '', input.ownUrl) : null;
  const haveKeys = new Set(result.map(a => a.canonical_key));
  const haystack = result.map(a => `${a.content ?? ''} ${a.url ?? ''}`.toLowerCase()).join(' ');

  const addedLinks: string[] = [];
  for (const url of extractUrls(...input.texts)) {
    const key = canonicalKey('link', '', url);
    if (key === ownKey || haveKeys.has(key) || haystack.includes(url.toLowerCase())) continue;
    if (addedLinks.length >= MAX_FALLBACK_LINKS) break;
    addedLinks.push(url);
    haveKeys.add(key);
    result.push(emptyAtom({
      id: newId(), kind: 'link', name: hostOf(url) || url, url,
      explanation: `Link citado em “${truncate(input.title, 100)}”.`
    }));
  }

  const blocks: CodeBlock[] = input.texts.flatMap(t => extractCodeBlocks(t));
  const seenCode = new Set<string>();
  let addedCode = 0;
  for (const block of blocks) {
    const normalized = squash(block.code);
    if (seenCode.has(normalized)) continue;
    seenCode.add(normalized);
    const covered = result.some(a => a.content && squash(a.content).includes(normalized));
    if (covered) continue;
    addedCode++;
    result.push(emptyAtom({
      id: newId(), kind: 'codigo',
      name: `Código${block.language ? ` ${block.language}` : ''} de “${truncate(input.title, 80)}”`,
      content: truncate(block.code, LIMITS.content),
      language: block.language,
      explanation: `Trecho de código${block.language ? ` em ${block.language}` : ''} citado em “${truncate(input.title, 100)}” (sem explicação automática disponível).`
    }));
  }
  return { atoms: result, addedLinks, addedCode };
}

/** Texto que representa o átomo no índice de busca (vetorial e textual). */
export function buildAtomChunkText(atom: Atom): string {
  const lines = [`[${atom.kind}] ${atom.name}`];
  if (atom.explanation) lines.push(atom.explanation);
  if (atom.use_for) lines.push(`Para que serve / onde é usado: ${atom.use_for}`);
  if (atom.url) lines.push(`Link${atom.inferred ? ' (inferido)' : ''}: ${atom.url}`);
  if (atom.contents_summary) lines.push(`O que tem no link: ${atom.contents_summary}`);
  if (atom.questions.length) lines.push(`Perguntas que responde: ${atom.questions.join(' | ')}`);
  if (atom.content) lines.push(`Conteúdo:\n${truncate(atom.content, 2500)}`);
  return truncate(lines.join('\n'), 6000);
}
