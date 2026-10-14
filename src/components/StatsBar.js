export function renderStatsBar(container, stats) {
  const total = stats.total || 0;
  const videosCount = (stats.byType?.reel || 0) + (stats.byType?.youtube || 0) + (stats.byType?.tiktok || 0);
  const docsCount = (stats.byType?.pdf || 0) + (stats.byType?.audio || 0) + (stats.byType?.article || 0);
  const favorites = stats.favorites || 0;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">🧠</div>
        <div>
          <div class="stat-label">Total no Cérebro</div>
          <div class="stat-value">${total}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(236, 72, 153, 0.15); color: #f472b6;">📱</div>
        <div>
          <div class="stat-label">Reels & Vídeos</div>
          <div class="stat-value">${videosCount}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">📄</div>
        <div>
          <div class="stat-label">Áudios & Documentos</div>
          <div class="stat-value">${docsCount}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">★</div>
        <div>
          <div class="stat-label">Favoritos</div>
          <div class="stat-value">${favorites}</div>
        </div>
      </div>
    </div>
  `;
}
