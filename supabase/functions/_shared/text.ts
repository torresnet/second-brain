// Utilitários de texto puros (sem dependências), compartilhados pelas funções e pelos testes.

const TLDS = 'com|com\\.br|io|ai|dev|org|net|co|so|xyz|tech|cloud|site|me|tv|gg|studio';

const SCHEME_URL = /https?:\/\/[^\s<>"'`)\]}]+/gi;
const BARE_URL = new RegExp(
  `(?<![@\\w./:-])((?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?::\\d+)?(?:/[^\\s<>"'\`)\\]}]*)?)(?![\\w@-])`,
  'gi'
);
export const bareUrlPattern = (): RegExp => new RegExp(BARE_URL.source, 'gi');
const TRAILING_PUNCT = /[.,;:!?'"»”’]+$/;

export function normalizeUrl(raw: string): string | null {
  let value = String(raw ?? '').trim().replace(TRAILING_PUNCT, '');
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) return null;
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|igshid$|si$)/i.test(key)) parsed.searchParams.delete(key);
  }
  let out = parsed.toString();
  if (parsed.pathname === '/' && !parsed.search) out = out.replace(/\/$/, '');
  return out.replace(/\/$/, parsed.search ? '/' : '');
}

export function extractUrls(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(SCHEME_URL)) {
      const url = normalizeUrl(match[0]);
      if (url) found.add(url);
    }
    // domínios sem https:// (comuns em falas transcritas: "acesse remotion.dev")
    const withoutSchemeUrls = text.replace(SCHEME_URL, ' ');
    for (const match of withoutSchemeUrls.matchAll(BARE_URL)) {
      const url = normalizeUrl(match[1]);
      if (url) found.add(url);
    }
  }
  return [...found];
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function slugify(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function shortHash(text: string): string {
  let h = 5381;
  for (const ch of text) h = ((h << 5) + h + ch.codePointAt(0)!) | 0;
  return (h >>> 0).toString(36);
}

export function canonicalKey(kind: string, name: string, url?: string | null, hasContent = false): string {
  const normalized = hasContent ? null : url ? normalizeUrl(url) : null;
  if (normalized) {
    const parsed = new URL(normalized);
    return `url:${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`.toLowerCase();
  }
  return `${slugify(kind)}:${slugify(name) || `h${shortHash(name)}`}`;
}

export interface CodeBlock {
  language: string | null;
  code: string;
}

export function extractCodeBlocks(text: string | null | undefined): CodeBlock[] {
  if (!text) return [];
  const blocks: CodeBlock[] = [];
  const fence = /```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(fence)) {
    const code = match[2].replace(/\s+$/, '');
    if (code.trim().length >= 3) blocks.push({ language: match[1] ? match[1].toLowerCase() : null, code });
  }
  return blocks;
}

export function squash(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Quebra o texto em trechos de até `size` caracteres, respeitando parágrafos/frases, com sobreposição. */
export function chunkText(text: string | null | undefined, size = 1200, overlap = 200, maxChunks = 80): string[] {
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < maxChunks) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('\n'),
        window.lastIndexOf(' ')
      );
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Divide um texto longo em janelas grandes (para análise por IA) sem cortar palavras. */
export function splitWindows(text: string, windowSize = 30000, maxWindows = 6): string[] {
  const clean = String(text ?? '').trim();
  if (clean.length <= windowSize) return clean ? [clean] : [];
  return chunkText(clean, windowSize, 500, maxWindows);
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '-', mdash: '-', hellip: '...',
  ccedil: 'ç', atilde: 'ã', otilde: 'õ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', agrave: 'à'
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  try {
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

export function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return squash(decodeEntities((og?.[1] ?? title?.[1] ?? '')));
}

export function extractMetaDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  return squash(decodeEntities(m?.[1] ?? ''));
}

export function htmlToText(html: string, maxChars = 40000): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text.slice(0, maxChars);
}

export function truncate(text: string | null | undefined, max: number): string {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
