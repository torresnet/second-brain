import { APP_CONFIG } from '../shared/constants/config.js';

export function createGraphView(container, { onSelectNode }) {
  container.innerHTML = `
    <div style="background: var(--bg-card); backdrop-filter: blur(16px); border: 1px solid var(--border-color); border-radius: var(--radius-lg); overflow: hidden; display: flex; flex-direction: column; height: calc(100vh - 220px); min-height: 520px; position: relative;">
      
      <!-- Barra superior do Grafo -->
      <div style="padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.25); z-index: 10;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 36px; height: 36px; border-radius: 10px; background: var(--accent-gradient); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
            🕸️
          </div>
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 700;">Grafo de Conexões do Conhecimento</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Visualize como seus Reels, vídeos, tags e entidades se interconectam.</p>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #6366f1;"></span> Nota/Mídia
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #06b6d4; margin-left: 0.5rem;"></span> Tag/Entidade
          </span>
          <button id="graph-reset-btn" class="pill-btn" style="font-size: 0.8rem;">Centralizar</button>
        </div>
      </div>

      <!-- Canvas de Renderização -->
      <canvas id="brain-graph-canvas" style="flex: 1; width: 100%; height: 100%; display: block; cursor: grab;"></canvas>

      <!-- Tooltip Flutuante -->
      <div id="graph-tooltip" style="position: absolute; display: none; background: rgba(13, 18, 29, 0.95); border: 1px solid var(--border-glow); padding: 0.5rem 0.8rem; border-radius: var(--radius-sm); font-size: 0.85rem; color: #fff; pointer-events: none; z-index: 20; box-shadow: var(--shadow-md);"></div>
    </div>
  `;

  const canvas = container.querySelector('#brain-graph-canvas');
  const ctx = canvas.getContext('2d');
  const tooltip = container.querySelector('#graph-tooltip');
  const resetBtn = container.querySelector('#graph-reset-btn');

  let nodes = [];
  let links = [];
  let animationFrameId = null;
  let hoveredNode = null;
  let draggedNode = null;

  let transform = { x: 0, y: 0, k: 1 };
  let isPanning = false;
  let startPan = { x: 0, y: 0 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 50);

  function buildGraphData(items) {
    nodes = [];
    links = [];
    const nodeMap = new Map();

    // Adiciona nós das notas
    items.forEach(item => {
      const node = {
        id: 'item-' + item.id,
        rawItem: item,
        label: item.title.length > 22 ? item.title.slice(0, 20) + '...' : item.title,
        type: 'item',
        color: APP_CONFIG.mediaTypes[item.source_type]?.color || '#6366f1',
        radius: 12,
        x: (Math.random() - 0.5) * 400 + (canvas.width / 2 || 400),
        y: (Math.random() - 0.5) * 300 + (canvas.height / 2 || 250),
        vx: 0,
        vy: 0
      };
      nodes.push(node);
      nodeMap.set(node.id, node);

      // Conecta com tags
      (item.tags || []).forEach(tag => {
        const tagId = 'tag-' + tag.toLowerCase();
        let tagNode = nodeMap.get(tagId);
        if (!tagNode) {
          tagNode = {
            id: tagId,
            label: '#' + tag,
            type: 'tag',
            color: '#06b6d4',
            radius: 8,
            x: node.x + (Math.random() - 0.5) * 60,
            y: node.y + (Math.random() - 0.5) * 60,
            vx: 0,
            vy: 0
          };
          nodes.push(tagNode);
          nodeMap.set(tagId, tagNode);
        }
        links.push({ source: node, target: tagNode, length: 70 });
      });

      // Conecta com entidades ([[Wikilinks]])
      (item.entities || []).forEach(entity => {
        const entId = 'ent-' + entity.toLowerCase();
        let entNode = nodeMap.get(entId);
        if (!entNode) {
          entNode = {
            id: entId,
            label: '[[' + entity + ']]',
            type: 'entity',
            color: '#a855f7',
            radius: 9,
            x: node.x + (Math.random() - 0.5) * 80,
            y: node.y + (Math.random() - 0.5) * 80,
            vx: 0,
            vy: 0
          };
          nodes.push(entNode);
          nodeMap.set(entId, entNode);
        }
        links.push({ source: node, target: entNode, length: 85 });
      });
    });

    startSimulation();
  }

  function simulate() {
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const centerX = width / 2;
    const centerY = height / 2;

    // Força gravitacional ao centro
    nodes.forEach(n => {
      n.vx += (centerX - n.x) * 0.002;
      n.vy += (centerY - n.y) * 0.002;
    });

    // Repulsão entre nós
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 180) {
          const force = (180 - dist) / (dist * 12);
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
    }

    // Atração pelas arestas
    links.forEach(link => {
      const a = link.source;
      const b = link.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - link.length) * 0.035;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    // Amortecimento e atualização de posições
    nodes.forEach(n => {
      if (n !== draggedNode) {
        n.vx *= 0.88;
        n.vy *= 0.88;
        n.x += n.vx;
        n.y += n.vy;
      }
    });
  }

  function render() {
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Desenha Arestas
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    links.forEach(link => {
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      ctx.stroke();
    });

    // Desenha Nós
    nodes.forEach(n => {
      const isHovered = n === hoveredNode;

      // Glow effect
      if (isHovered) {
        ctx.shadowColor = n.color;
        ctx.shadowBlur = 15;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, isHovered ? n.radius + 3 : n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.fill();

      ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label do nó
      ctx.shadowBlur = 0;
      ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255, 255, 255, 0.7)';
      ctx.font = isHovered ? 'bold 11px Inter' : '10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + n.radius + 13);
    });

    ctx.restore();
  }

  function loop() {
    simulate();
    render();
    animationFrameId = requestAnimationFrame(loop);
  }

  function startSimulation() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    loop();
  }

  // Interações de Mouse e Toque
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
    return {
      x: (clientX - rect.left - transform.x) / transform.k,
      y: (clientY - rect.top - transform.y) / transform.k
    };
  }

  canvas.addEventListener('mousemove', (e) => {
    const pos = getMousePos(e);
    if (draggedNode) {
      draggedNode.x = pos.x;
      draggedNode.y = pos.y;
      return;
    }

    if (isPanning) {
      transform.x += e.movementX;
      transform.y += e.movementY;
      return;
    }

    // Hit-testing
    hoveredNode = nodes.find(n => {
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 4;
    });

    if (hoveredNode) {
      canvas.style.cursor = hoveredNode.type === 'item' ? 'pointer' : 'grab';
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX - canvas.getBoundingClientRect().left + 15) + 'px';
      tooltip.style.top = (e.clientY - canvas.getBoundingClientRect().top + 15) + 'px';
      tooltip.innerHTML = `<strong>${hoveredNode.label}</strong><br><span style="color: var(--text-muted); font-size: 0.75rem;">${hoveredNode.type.toUpperCase()}</span>`;
    } else {
      canvas.style.cursor = 'grab';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    const pos = getMousePos(e);
    if (hoveredNode) {
      draggedNode = hoveredNode;
      canvas.style.cursor = 'grabbing';
    } else {
      isPanning = true;
      startPan = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'move';
    }
  });

  window.addEventListener('mouseup', () => {
    if (draggedNode && hoveredNode && hoveredNode.type === 'item' && onSelectNode) {
      // Se clicou sem arrastar muito, abre o item
      onSelectNode(hoveredNode.rawItem);
    }
    draggedNode = null;
    isPanning = false;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    transform.k = Math.max(0.4, Math.min(3, transform.k * zoomFactor));
  }, { passive: false });

  resetBtn.addEventListener('click', () => {
    transform = { x: 0, y: 0, k: 1 };
  });

  return {
    update: (items) => {
      buildGraphData(items);
    }
  };
}
