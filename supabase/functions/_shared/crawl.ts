// Varredura de um link: descobre "o que tem dentro" para guardar no cérebro.

import { extractMetaDescription, extractTitle, hostOf, htmlToText, truncate } from './text.ts';
import type { SafeFetchResult } from './ssrf.ts';

export interface CrawlResult {
  status: 'ok' | 'inaccessible' | 'skipped';
  error?: string;
  title?: string;
  text?: string;
}

export type SafeFetch = (url: string, headers?: Record<string, string>) => Promise<SafeFetchResult>;

const MAX_STORED_CHARS = 40000;
const MIN_READABLE_CHARS = 120;

// Conteúdo que exige o pipeline de captura (vídeo/rede social) ou login: não dá para ler com um GET simples
const NEEDS_CAPTURE =
  /(^|\.)(instagram\.com|tiktok\.com|facebook\.com|fb\.watch|fb\.com|x\.com|twitter\.com|threads\.net|youtube\.com|youtu\.be|vimeo\.com|linkedin\.com|kwai\.com|pinterest\.[a-z.]+|reddit\.com|twitch\.tv)$/i;

const GITHUB_REPO = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export async function crawlLink(url: string, safeFetch: SafeFetch): Promise<CrawlResult> {
  const host = hostOf(url);
  if (NEEDS_CAPTURE.test(host)) {
    return {
      status: 'skipped',
      error: 'Conteúdo de rede social/vídeo: capture este link separadamente para o sistema ler o conteúdo.'
    };
  }
  try {
    const repo = url.match(GITHUB_REPO);
    if (repo) {
      const github = await crawlGithubRepo(repo[1], repo[2], safeFetch);
      if (github) return github;
    }
    return await crawlGeneric(url, safeFetch);
  } catch (error) {
    return { status: 'inaccessible', error: error instanceof Error ? error.message : String(error) };
  }
}

async function crawlGithubRepo(owner: string, repo: string, safeFetch: SafeFetch): Promise<CrawlResult | null> {
  const meta = await safeFetch(`https://api.github.com/repos/${owner}/${repo}`, { Accept: 'application/vnd.github+json' });
  if (meta.status === 404) return { status: 'inaccessible', error: 'Repositório não encontrado ou privado.' };
  if (meta.status !== 200) return null; // limite de API etc.: cai no HTML da página

  let info: Record<string, unknown>;
  try {
    info = JSON.parse(meta.body);
  } catch {
    return null;
  }
  const lines = [`Repositório GitHub: ${info.full_name ?? `${owner}/${repo}`}`];
  if (info.description) lines.push(`Descrição: ${info.description}`);
  if (info.language) lines.push(`Linguagem principal: ${info.language}`);
  if (Array.isArray(info.topics) && info.topics.length) lines.push(`Tópicos: ${(info.topics as string[]).join(', ')}`);
  if (typeof info.stargazers_count === 'number') lines.push(`Estrelas: ${info.stargazers_count}`);
  if (info.homepage) lines.push(`Site: ${info.homepage}`);
  if ((info.license as { name?: string } | null)?.name) lines.push(`Licença: ${(info.license as { name: string }).name}`);

  let readme = '';
  try {
    const res = await safeFetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { Accept: 'application/vnd.github.raw+json' });
    if (res.status === 200) readme = res.body;
  } catch {
    // README é opcional
  }
  if (readme) lines.push('', 'README:', readme);
  return {
    status: 'ok',
    title: String(info.full_name ?? `${owner}/${repo}`),
    text: truncate(lines.join('\n'), MAX_STORED_CHARS)
  };
}

async function crawlGeneric(url: string, safeFetch: SafeFetch): Promise<CrawlResult> {
  const res = await safeFetch(url);
  if (res.status >= 400) return { status: 'inaccessible', error: `O site respondeu HTTP ${res.status}.` };

  const type = res.contentType;
  if (/^(image|audio|video)\//.test(type) || type.includes('pdf') || type.includes('octet-stream') || type.includes('zip')) {
    return {
      status: 'skipped',
      error: `Arquivo (${type.split(';')[0] || 'binário'}): capture como arquivo para o sistema ler o conteúdo.`
    };
  }

  let title = '';
  let text: string;
  if (type.includes('html') || /<html[\s>]/i.test(res.body.slice(0, 2000))) {
    title = extractTitle(res.body);
    const description = extractMetaDescription(res.body);
    text = [title, description, htmlToText(res.body)].filter(Boolean).join('\n\n');
  } else {
    text = res.body.trim();
  }
  text = truncate(text, MAX_STORED_CHARS);
  if (text.length < MIN_READABLE_CHARS) {
    return { status: 'inaccessible', error: 'Página sem conteúdo legível (pode exigir login ou JavaScript).' };
  }
  return { status: 'ok', title, text };
}
