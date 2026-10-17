// Termos digitados entram em filtros .or() do PostgREST montados por string: remove tudo que altera a sintaxe do filtro.
export function sanitizeFilterTerm(term) {
  return String(term ?? '').replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}
