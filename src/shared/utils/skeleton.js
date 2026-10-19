export function skeletonCardsHtml(count = 6) {
  const card = `
    <div class="atom-card skeleton-card" aria-hidden="true">
      <span class="sk-line w40"></span>
      <span class="sk-line w90"></span>
      <span class="sk-line w70"></span>
    </div>`;
  return `<div class="sr-only" role="status">Carregando…</div>${card.repeat(count)}`;
}
