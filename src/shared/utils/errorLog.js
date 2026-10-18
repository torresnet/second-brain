// Monta entradas do log de falhas da captura (tabela capture_errors): classifica, higieniza e limita o tamanho.

const MAX_MESSAGE = 500;
const MAX_DETAIL = 4000;

export const STAGE_LABELS = {
  pipeline: 'Envio / pipeline',
  media_fetch: 'Download da mídia',
  ai: 'Análise por IA',
  embedding: 'Índice de busca',
  crawl: 'Leitura de links',
  save: 'Salvamento'
};

export const CATEGORY_LABELS = {
  quota: 'Cota da IA',
  timeout: 'Tempo esgotado',
  network: 'Rede',
  http: 'Erro HTTP',
  auth: 'Sessão / permissão',
  unreadable: 'Conteúdo ilegível',
  unsupported: 'Formato não suportado',
  unknown: 'Outro'
};

/** Remove tokens e query strings (chaves de API costumam ir na URL) antes de gravar. */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [oculto]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/(https?:\/\/[^\s?#"')]+)[?#][^\s"')]*/gi, '$1')
    .replace(/\b(api[_-]?key|key|token|secret)=[^\s&"']+/gi, '$1=[oculto]');
}

export function classifyCategory(text) {
  const raw = String(text ?? '');
  if (/HTTP 429|quota|rate.?limit|resource.?exhausted|limite de uso/i.test(raw)) return 'quota';
  if (/Sessão expirada|HTTP (401|403)|unauthor|forbidden/i.test(raw)) return 'auth';
  if (/Formato não suportado|maior que 14 MB|não foi possível processar a gravação/i.test(raw)) return 'unsupported';
  if (/não estava acessível|pouco texto legível|não é público|acesso restrito|exige login|não pôde ser lido/i.test(raw)) return 'unreadable';
  if (/demorou demais|timed? ?out|timeout|tempo esgotado|abort/i.test(raw)) return 'timeout';
  if (/failed to fetch|networkerror|load failed|falha de rede|ECONN|ENOTFOUND/i.test(raw)) return 'network';
  if (/HTTP [45]\d\d/i.test(raw)) return 'http';
  return 'unknown';
}

export function classifyStage(text) {
  const raw = String(text ?? '');
  if (/baixar a mídia|media.?fetcher|serviço de mídia|yt-dlp/i.test(raw)) return 'media_fetch';
  if (/vetor|embedding/i.test(raw)) return 'embedding';
  if (/gemini|análise|\bIA\b/i.test(raw)) return 'ai';
  return 'pipeline';
}

function errorMessage(error) {
  return String(error?.message ?? error ?? '').trim();
}

function sanitizeDetail(detail) {
  const json = redactSecrets(JSON.stringify(detail ?? {}));
  if (json.length <= MAX_DETAIL) return JSON.parse(json);
  return { truncado: true, previa: json.slice(0, MAX_DETAIL) };
}

/**
 * Linha pronta para inserir em capture_errors.
 * `stage` e `category` são deduzidos do texto quando não informados.
 */
export function buildErrorEntry({ error, message, stage, category, severity = 'error', sourceType = null, itemId = null, detail = {} }) {
  const text = message ?? errorMessage(error);
  const cause = error?.cause ? errorMessage(error.cause) : '';
  const fullDetail = cause ? { ...detail, causa: cause } : detail;
  return {
    stage: stage ?? classifyStage(text),
    category: category ?? classifyCategory(`${text} ${cause}`),
    severity,
    source_type: sourceType,
    item_id: itemId,
    message: redactSecrets(text).trim().slice(0, MAX_MESSAGE) || 'Falha sem detalhes.',
    detail: sanitizeDetail(fullDetail)
  };
}
