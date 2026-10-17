// Cliente mínimo da API do Gemini (JSON estruturado + embeddings) com retentativas.

export const EMBEDDING_DIMENSIONS = 768;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  embeddingModel: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface EmbedResult {
  vectors: Array<number[] | null>;
  errors: string[];
}

export interface Gemini {
  generateJson(prompt: string, options?: { temperature?: number; timeoutMs?: number; attempts?: number }): Promise<unknown>;
  embedBatch(texts: string[], taskType: EmbedTaskType, options?: { timeoutMs?: number; attempts?: number }): Promise<EmbedResult>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const EMBED_BATCH_SIZE = 50;
const EMBED_MAX_CHARS = 7000;

/** Extrai JSON de uma resposta de modelo, tolerando cercas de markdown e texto ao redor. */
export function parseModelJson(raw: string): unknown {
  const cleaned = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // tenta recortar o primeiro objeto/array completo
  }
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = cleaned.indexOf(open);
    const b = cleaned.lastIndexOf(close);
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch {
        // continua
      }
    }
  }
  throw new GeminiError('A resposta da IA não veio em JSON válido.');
}

export function createGemini(config: GeminiConfig): Gemini {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const base = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';

  async function post(path: string, body: unknown, timeoutMs: number, attempts = 2): Promise<any> {
    let lastError: Error = new GeminiError('Falha desconhecida ao chamar o Gemini.');
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${base}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const text = await response.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
        if (response.ok) return json ?? {};
        const message = json?.error?.message ?? text.slice(0, 200);
        lastError = new GeminiError(`Gemini HTTP ${response.status}: ${message}`, response.status);
        if (!RETRYABLE.has(response.status)) throw lastError;
      } catch (error) {
        if (error instanceof GeminiError && !RETRYABLE.has(error.status)) throw error;
        lastError = error instanceof GeminiError
          ? error
          : new GeminiError(
              error instanceof Error && error.name === 'AbortError'
                ? 'O Gemini demorou demais para responder.'
                : `Falha de rede ao chamar o Gemini: ${error instanceof Error ? error.message : String(error)}`
            );
      } finally {
        clearTimeout(timer);
      }
      if (attempt < attempts) await sleep(attempt * 1500);
    }
    throw lastError;
  }

  return {
    async generateJson(prompt, options = {}) {
      const json = await post(
        `models/${config.model}:generateContent`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: options.temperature ?? 0.2 }
        },
        options.timeoutMs ?? 70000,
        options.attempts ?? 2
      );
      const candidate = json?.candidates?.[0];
      const text = (candidate?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
      if (!text) {
        const reason = json?.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'resposta vazia';
        throw new GeminiError(`O Gemini não retornou conteúdo (${reason}).`);
      }
      return parseModelJson(text);
    },

    async embedBatch(texts, taskType, options = {}) {
      const vectors: Array<number[] | null> = new Array(texts.length).fill(null);
      const errors: string[] = [];
      for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
        const slice = texts.slice(start, start + EMBED_BATCH_SIZE);
        try {
          const json = await post(
            `models/${config.embeddingModel}:batchEmbedContents`,
            {
              requests: slice.map(text => ({
                model: `models/${config.embeddingModel}`,
                content: { parts: [{ text: (text || ' ').slice(0, EMBED_MAX_CHARS) }] },
                taskType,
                outputDimensionality: EMBEDDING_DIMENSIONS
              }))
            },
            options.timeoutMs ?? 60000,
            options.attempts ?? 2
          );
          const embeddings = json?.embeddings ?? [];
          slice.forEach((_, i) => {
            const values = embeddings[i]?.values;
            if (Array.isArray(values) && values.length === EMBEDDING_DIMENSIONS) vectors[start + i] = values;
            else errors.push(`Embedding ${start + i} inválido (dimensão ${values?.length ?? 0}).`);
          });
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      return { vectors, errors };
    }
  };
}
