const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RELATIVE_LIMIT_DAYS = 28;

/**
 * Data curta e relativa para listas: "há 5 min", "ontem", "há 2 sem", "5 de mar."
 */
export function formatRelativeBR(dateString, now = Date.now()) {
  if (!dateString) return '';
  const ts = Date.parse(dateString);
  if (!Number.isFinite(ts)) return '';

  const diff = Math.max(0, now - ts);
  if (diff < MIN) return 'agora';
  if (diff < HOUR) return `há ${Math.floor(diff / MIN)} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;

  const days = Math.floor(diff / DAY);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  if (days < RELATIVE_LIMIT_DAYS) return `há ${Math.floor(days / 7)} sem`;

  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('pt-BR', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
