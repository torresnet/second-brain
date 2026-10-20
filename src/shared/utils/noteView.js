// Regras de exibição do topo da ficha da nota (origem e indexação) e dos exemplos práticos.
// Funções puras: a ficha (ItemDetail) só desenha o que elas devolvem.

import { friendlyError } from './friendlyError.js';

export const MAX_EXAMPLES = 5;

const ORIGIN_BY_TYPE = {
  audio: 'Gravação de voz',
  pdf: 'Arquivo enviado',
  reel: 'Vídeo enviado',
  note: 'Anotação de texto'
};

/** Link http(s) pronto para exibir (sem protocolo e sem www); `null` para qualquer outra coisa. */
function safeLink(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return { href: url, text: url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') };
}

/**
 * De onde a nota veio: o link original (quando há) ou a origem descrita em texto.
 * @returns {{ href: string|null, text: string }}
 */
export function noteOrigin(item) {
  const link = safeLink(item?.source_url);
  if (link) return link;
  const fileName = item?.metadata?.extracted_from_file;
  if (typeof fileName === 'string' && fileName.trim()) return { href: null, text: `Arquivo enviado: ${fileName.trim()}` };
  return { href: null, text: ORIGIN_BY_TYPE[item?.source_type] || 'Sem link de origem' };
}

const STATUS = {
  done: { tone: 'ok', label: 'Indexada', action: 'Reprocessar' },
  pending: { tone: 'warn', label: 'Aguardando indexação avançada', action: 'Indexar agora' },
  processing: { tone: 'warn', label: 'Indexando…', action: 'Indexar agora' },
  partial: { tone: 'warn', label: 'Indexada parcialmente', action: 'Indexar novamente' },
  failed: { tone: 'danger', label: 'Falha na indexação', action: 'Indexar novamente' }
};

const DEFAULT_REASON = {
  pending: 'A nota está salva; o conteúdo ainda não foi indexado para a busca e o Pergunte.',
  failed: 'Não foi possível indexar esta nota.'
};

/**
 * Situação da indexação para o topo da nota. `null` quando a nota não passa pela indexação.
 * @returns {{ tone: 'ok'|'warn'|'danger', label: string, reason: string, action: string } | null}
 */
export function indexStatus(item) {
  const status = STATUS[item?.analysis_status];
  if (!status) return null;
  const reason = item.analysis_status === 'done'
    ? ''
    : friendlyError(item.analysis_error, DEFAULT_REASON[item.analysis_status] || '');
  return { ...status, reason };
}

/**
 * Até 5 exemplos práticos. Notas antigas sem exemplos mostram as "próximas ações" antigas no mesmo formato.
 * @returns {Array<{ title: string, scenario: string, how: string, uses: string[] }>}
 */
export function noteExamples(item) {
  const examples = (Array.isArray(item?.practical_examples) ? item.practical_examples : [])
    .filter(e => e && typeof e.title === 'string' && e.title.trim());
  if (examples.length) return examples.slice(0, MAX_EXAMPLES);
  return (Array.isArray(item?.action_items) ? item.action_items : [])
    .filter(a => typeof a === 'string' && a.trim())
    .slice(0, MAX_EXAMPLES)
    .map(a => ({ title: a.trim(), scenario: '', how: '', uses: [] }));
}

/**
 * Selo e fontes de uma nota que reúne outras (unificada). `null` quando a nota nunca foi mesclada.
 * Enquanto a IA não terminou (cota esgotada), `pending` é verdadeiro e o selo diz que a unificação está na fila.
 * @returns {{ count: number, pending: boolean, label: string, hint: string, sources: Array<{ title: string, href: string|null, text: string, date: string|null }> } | null}
 */
export function unifiedInfo(item) {
  const meta = item?.metadata;
  const merged = (Array.isArray(meta?.merged_sources) ? meta.merged_sources : []).filter(s => s && typeof s === 'object');
  if (!merged.length) return null;

  const pending = Boolean(meta.pending_unify);
  const base = meta.pending_unify?.base ?? meta.unified_base ?? { title: null, url: item.source_url, created_at: item.created_at };
  const sources = [base, ...merged].map(s => {
    const link = safeLink(s.url);
    return {
      title: (typeof s.title === 'string' && s.title.trim()) || 'Sem título',
      href: link?.href ?? null,
      text: link?.text ?? '',
      date: typeof s.created_at === 'string' ? s.created_at : null
    };
  });
  const count = merged.length + 1;
  return {
    count,
    pending,
    label: pending ? 'Unificação na fila' : 'Unificada',
    hint: pending
      ? `Reúne ${count} notas. A IA ainda vai tirar as repetições e dar um título novo.`
      : `Reúne ${count} notas, sem repetições`,
    sources
  };
}
