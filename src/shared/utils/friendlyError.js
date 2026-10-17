const MAX_LENGTH = 200;

const RULES = [
  [/HTTP 429|quota|rate.?limit|resource.?exhausted/i, 'A IA atingiu o limite de uso por agora. Tente novamente mais tarde.'],
  [/HTTP (5\d\d|408)|overload|unavailable|sobrecarregad/i, 'O serviço está sobrecarregado ou fora do ar no momento. Tente novamente em instantes.'],
  [/demorou demais|timed? ?out|abort/i, 'O processamento demorou demais. Tente novamente.'],
  [/failed to fetch|networkerror|load failed|falha de rede/i, 'Sem conexão com o servidor. Verifique a internet e tente de novo.']
];

/** Traduz erros técnicos (provedor de IA, rede) em texto curto para o usuário, sem URLs. */
export function friendlyError(error, fallback = 'Algo deu errado. Tente novamente.') {
  const raw = String(error?.message ?? error ?? '').trim();
  if (!raw) return fallback;
  for (const [pattern, message] of RULES) {
    if (pattern.test(raw)) return message;
  }
  const clean = raw.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > MAX_LENGTH ? `${clean.slice(0, MAX_LENGTH - 1)}…` : clean;
}
