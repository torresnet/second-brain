function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Filtro instantâneo nos itens já carregados (para a barra de comando).
 * Todas as palavras precisam aparecer; títulos que casam vêm primeiro.
 */
export function filterItemsLocally(items, text) {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  return items
    .map((item) => {
      const title = normalize(item.title);
      const haystack = `${title} ${normalize(item.summary)} ${normalize((item.tags || []).join(' '))}`;
      if (!words.every((w) => haystack.includes(w))) return null;
      return { item, titleHits: words.filter((w) => title.includes(w)).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.titleHits - a.titleHits)
    .map(({ item }) => item);
}
