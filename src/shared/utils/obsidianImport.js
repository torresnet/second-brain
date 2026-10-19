// Converte uma nota do Obsidian (.md com frontmatter e [[wikilinks]]) em uma linha de brain_items.
// Só funções puras: leitura de disco e gravação no banco ficam em scripts/import-obsidian.mjs.

const WIKILINK = /(?<!!)\[\[([^\[\]\n]+?)\]\]/g;
const FENCED_CODE = /(```|~~~)[\s\S]*?(?:\1|$)/g;
const INLINE_CODE = /`[^`\n]*`/g;
const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const DATE_BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const MAX_TAGS = 30;
const MAX_TAKEAWAYS = 12;
const MAX_SUMMARY = 1000;

const STAGE_BY_STATUS = {
  novo: 'seedling',
  stub: 'seedling',
  superficial: 'seedling',
  ideia: 'seedling',
  aplicado: 'evergreen',
  ativo: 'evergreen'
};
const DEFAULT_STAGE = 'budding';

const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const asList = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);

function unquote(raw) {
  const text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

function parseValue(raw) {
  const text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).split(',').map(unquote).filter((item) => item !== '');
  }
  return unquote(text);
}

/** Lê o subconjunto de YAML que o Obsidian grava: chave: valor, listas [a, b] e listas em bloco ("- item"). */
export function parseFrontmatter(text) {
  const source = String(text ?? '');
  const match = FRONTMATTER.exec(source);
  if (!match) return { data: {}, body: source };

  const data = {};
  let openKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && openKey) {
      data[openKey] = [...asList(data[openKey]), unquote(item[1])];
      continue;
    }
    const pair = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    openKey = pair[1].trim();
    data[openKey] = pair[2] === '' ? [] : parseValue(pair[2]);
  }
  return { data, body: source.slice(match[0].length).trim() };
}

const withoutCode = (text) => String(text ?? '').replace(FENCED_CODE, '').replace(INLINE_CODE, '');
const linkTarget = (inner) => inner.split('|')[0].split('#')[0].split('^')[0].trim();

/** Destinos únicos dos [[wikilinks]] (sem alias nem âncora; código e embeds ![[...]] ficam de fora). */
export function extractWikilinks(text) {
  const seen = new Set();
  const targets = [];
  for (const [, inner] of withoutCode(text).matchAll(WIKILINK)) {
    const target = linkTarget(inner);
    const key = target.toLowerCase();
    if (!target || seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

/** [[A|apelido]] -> apelido, [[A#seção]] -> A: texto legível para campos que o app mostra sem renderizar links. */
export function stripWikilinks(text) {
  return String(text ?? '').replace(WIKILINK, (_, inner) => (inner.includes('|') ? inner.split('|').slice(1).join('|').trim() : linkTarget(inner)));
}

/** "22/09/2026" -> ISO ao meio-dia UTC (evita virar o dia anterior por fuso). null se inválida. */
export function parseCaptureDate(value) {
  const match = DATE_BR.exec(String(value ?? '').trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString() : null;
}

function httpUrl(value) {
  const text = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text) && text;
  } catch {
    return null;
  }
}

/** Tipo de mídia que o app já sabe desenhar (config.mediaTypes), decidido pelo domínio do link. */
export function mapSourceType(url) {
  const link = httpUrl(url);
  if (!link) return 'note';
  const host = new URL(link).hostname.replace(/^www\./, '').toLowerCase();
  if (host.endsWith('instagram.com')) return 'reel';
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  return 'article';
}

export function mapStage(status) {
  return STAGE_BY_STATUS[collapse(status).toLowerCase()] ?? DEFAULT_STAGE;
}

function extractSection(body, namePattern) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    return heading && namePattern.test(collapse(heading[1]));
  });
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,3}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

function firstParagraph(body) {
  const skip = /^(#|\*\*MOC:\*\*|```|~~~|\||---|>)/;
  const paragraph = body.split(/\n\s*\n/).map((block) => block.trim()).find((block) => block && !skip.test(block));
  return paragraph ?? '';
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const textList = (value) => asList(value).map((v) => collapse(v)).filter(Boolean);

function takeawaysOf(body) {
  return extractSection(body, /^pontos[- ]chave/i)
    .split(/\r?\n/)
    .map((line) => /^\s*[-*]\s+(?:\[.\]\s+)?(.*)$/.exec(line)?.[1])
    .filter(Boolean)
    .map((line) => collapse(stripWikilinks(line).replace(/\*\*/g, '')))
    .filter(Boolean)
    .slice(0, MAX_TAKEAWAYS);
}

function fileTitle(relPath) {
  return relPath.split(/[\\/]/).pop().replace(/\.md$/i, '');
}

/**
 * @param {{ relPath: string, text: string, mtime: Date }} note
 * @returns linha para brain_items, ou null se a nota estiver vazia
 */
export function noteToItem({ relPath, text, mtime }) {
  const { data, body } = parseFrontmatter(text);
  if (!body) return null;

  const path = String(relPath).replace(/\\/g, '/');
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1];
  const rawTitle = collapse(data.titulo || h1 || fileTitle(path));
  const url = httpUrl(data.url);
  const tipo = collapse(data.tipo);
  const summary = collapse(stripWikilinks(extractSection(body, /^resumo/i) || firstParagraph(body))).slice(0, MAX_SUMMARY);

  const obsidian = Object.fromEntries(Object.entries({
    path,
    tipo,
    status: collapse(data.status),
    autor: collapse(data.autor),
    resolve: textList(data.resolve),
    sinonimos: textList(data.sinonimos),
    alternativa_a: textList(data.alternativa_a),
    stack: textList(data.stack)
  }).filter(([, value]) => (Array.isArray(value) ? value.length : value)));

  return {
    title: rawTitle.replace(/^⭐\s*/, '') || fileTitle(path),
    summary: summary || null,
    source_type: mapSourceType(url),
    source_url: url,
    raw_content: body,
    key_takeaways: takeawaysOf(body),
    entities: extractWikilinks(body),
    stage: mapStage(data.status),
    tags: unique([tipo, ...textList(data.topicos), ...textList(data.stack)]).slice(0, MAX_TAGS),
    metadata: { imported_from: 'obsidian', obsidian },
    is_favorite: rawTitle.startsWith('⭐'),
    created_at: parseCaptureDate(data.capturado) ?? new Date(mtime).toISOString()
  };
}
