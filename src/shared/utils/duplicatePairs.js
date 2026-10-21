const SUMMARY_PREVIEW_CHARS = 280;

function noteFrom(row, side) {
  return {
    id: row[`${side}_id`],
    title: row[`${side}_title`] || 'Sem título',
    summary: (row[`${side}_summary`] || '').trim(),
    url: row[`${side}_source_url`] || '',
    type: row[`${side}_source_type`] || 'note',
    createdAt: row[`${side}_created_at`]
  };
}

function time(iso) {
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/** Texto curto de um resumo, cortado em fim de palavra. */
export function previewText(text, max = SUMMARY_PREVIEW_CHARS) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Linha de brain_duplicate_pairs → par pronto para exibir, com a nota mais antiga primeiro
 * (é a que a unificação mantém).
 */
export function toDuplicatePair(row) {
  const [older, newer] = [noteFrom(row, 'a'), noteFrom(row, 'b')]
    .sort((x, y) => time(x.createdAt) - time(y.createdAt));
  const sameLink = row.reason === 'mesmo_link';
  return {
    key: [older.id, newer.id].sort().join('|'),
    reason: sameLink ? 'mesmo_link' : 'muito_parecida',
    label: sameLink ? 'Mesmo link' : `${Math.round((row.similarity ?? 0) * 100)}% parecidas`,
    older,
    newer
  };
}

/** Soma o que precisa da atenção do usuário na central de alertas. */
export function alertTotal(counts) {
  return ['links', 'dups', 'errors'].reduce((sum, key) => sum + Math.max(0, Number(counts?.[key]) || 0), 0);
}

/** Primeira aba com pendências (na ordem dada) ou a aba atual se não houver nenhuma. */
export function pickAlertTab(counts, order, current) {
  return order.find((tab) => (counts?.[tab] || 0) > 0) ?? current;
}
