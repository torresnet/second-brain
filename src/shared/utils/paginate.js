// O PostgREST do Supabase corta qualquer resposta em 1000 linhas; para ler tudo, pedimos em páginas.

export const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

/**
 * @param {(from: number, to: number) => PromiseLike<{data: any[]|null, error: any}>} fetchPage
 *   busca as linhas de `from` a `to` (inclusive); a ordenação precisa ser estável entre as páginas.
 * @returns {Promise<{data: any[], error: any}>}
 */
export async function fetchAllPages(fetchPage, pageSize = PAGE_SIZE) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { data: all, error: null };
}
