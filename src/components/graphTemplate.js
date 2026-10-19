import { SIMILARITY_FLOOR, SIMILARITY_MAX } from '../shared/utils/graphModel.js';

export const GRAPH_TEMPLATE = `
  <div class="graph-card">
    <div class="graph-bar">
      <div class="section-heading">
        <h1>Conexões</h1>
        <p id="graph-summary">Como suas notas se conectam.</p>
      </div>
      <div class="graph-controls">
        <button id="graph-fit-btn" class="chip-btn" type="button" title="Ajusta o zoom para caber todas as notas">Enquadrar tudo</button>
      </div>
    </div>
    <div id="graph-toolbar" class="graph-toolbar" data-open="false">
      <div class="graph-search">
        <input id="graph-search" type="search" placeholder="Buscar nota, tag ou entidade" autocomplete="off"
          role="combobox" aria-label="Buscar no grafo" aria-expanded="false" aria-controls="graph-search-results" aria-autocomplete="list">
        <ul id="graph-search-results" class="graph-search-results" role="listbox" hidden></ul>
      </div>
      <button id="graph-filters-btn" class="chip-btn graph-filters-btn" type="button" aria-expanded="false" aria-controls="graph-filters">Filtros <span id="graph-filters-count" class="chip-count"></span></button>
      <div id="graph-filters" class="graph-filters">
      <button id="graph-toggle-hubs" class="chip-btn" type="button" title="Mostrar tags e entidades">Tags e entidades</button>
      <button id="graph-toggle-similar" class="chip-btn" type="button" title="Mostrar notas de assunto parecido">Assunto parecido</button>
      <button id="graph-toggle-loose" class="chip-btn" type="button" title="Esconde notas sem ligação com nenhuma outra">Ocultar soltas</button>
      <button id="graph-toggle-filters" class="chip-btn" type="button" title="Mostra só as notas do filtro ou da busca do Acervo">Só filtro do Acervo</button>
      <label class="graph-slider" title="Quanto mais alto, mais parecidas as notas precisam ser (até 2 por nota)">
        <span>Semelhança mín. <output id="graph-sim-value"></output></span>
        <input id="graph-sim" type="range" min="${Math.round(SIMILARITY_FLOOR * 100)}" max="${Math.round(SIMILARITY_MAX * 100)}" step="1">
      </label>
      </div>
    </div>
    <div id="graph-notice" class="graph-notice" role="status" hidden></div>
    <div id="graph-local" class="graph-local" hidden></div>
    <div id="graph-legend" class="graph-legend"></div>
    <div class="graph-stage">
      <div class="graph-main">
        <canvas id="brain-graph-canvas" tabindex="0" role="img"></canvas>
        <div class="graph-zoom" role="group" aria-label="Zoom">
          <button id="graph-zoom-in" class="icon-btn" type="button" aria-label="Aproximar">+</button>
          <button id="graph-zoom-out" class="icon-btn" type="button" aria-label="Afastar">−</button>
        </div>
        <div id="graph-empty" class="graph-empty" hidden></div>
        <div id="graph-tooltip" class="graph-tooltip" hidden></div>
      </div>
      <aside id="graph-panel" class="graph-panel" aria-live="polite" data-state="closed"></aside>
    </div>
  </div>
`;
