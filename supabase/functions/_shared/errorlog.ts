// Entradas do log de falhas (tabela capture_errors): classificação e remoção de segredos antes de gravar.

export type ErrorStage = 'pipeline' | 'media_fetch' | 'ai' | 'embedding' | 'crawl' | 'save';
export type ErrorCategory = 'quota' | 'timeout' | 'network' | 'http' | 'auth' | 'unreadable' | 'unsupported' | 'unknown';

export interface ErrorLogEntry {
  stage: ErrorStage;
  category: ErrorCategory;
  severity: 'error' | 'warning';
  message: string;
  detail?: Record<string, unknown>;
}

const MAX_MESSAGE = 500;
const MAX_DETAIL = 4000;

/** Remove tokens e query strings (chaves de API costumam ir na URL) antes de gravar. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [oculto]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/(https?:\/\/[^\s?#"')]+)[?#][^\s"')]*/gi, '$1')
    .replace(/\b(api[_-]?key|key|token|secret)=[^\s&"']+/gi, '$1=[oculto]');
}

export function categoryOf(error: unknown): ErrorCategory {
  const status = (error as { status?: number } | null)?.status;
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (status === 429 || /quota|rate.?limit|resource.?exhausted|HTTP 429/i.test(text)) return 'quota';
  if (status === 401 || status === 403 || /unauthor|forbidden|permission denied/i.test(text)) return 'auth';
  if (/timed? ?out|timeout|tempo esgotado|abort|demorou demais/i.test(text)) return 'timeout';
  if (/failed to fetch|network|ECONN|ENOTFOUND|dns|socket/i.test(text)) return 'network';
  if (typeof status === 'number' && status >= 400) return 'http';
  if (/HTTP [45]\d\d/i.test(text)) return 'http';
  return 'unknown';
}

export function buildEntry(entry: ErrorLogEntry): ErrorLogEntry {
  const message = redactSecrets(entry.message).trim().slice(0, MAX_MESSAGE) || 'Falha sem detalhes.';
  const json = redactSecrets(JSON.stringify(entry.detail ?? {}));
  const detail = json.length <= MAX_DETAIL
    ? (JSON.parse(json) as Record<string, unknown>)
    : { truncado: true, previa: json.slice(0, MAX_DETAIL) };
  return { ...entry, message, detail };
}
