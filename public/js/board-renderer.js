// Scotland Yard - SVG Board Renderer
// Depends on globals: NODES, EDGES, DETECTIVE_COLORS (from graph-data.js)

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEWBOX_W = 1650;
  const VIEWBOX_H = 1250;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5;
  const ZOOM_STEP = 1.15;

  // Boat stations used to approximate Thames curve
  const THAMES_PATH_POINTS = [
    { x: 0, y: 550 },
    { x: 200, y: 570 },
    { x: 549, y: 533 },   // near 98
    { x: 972, y: 553 },   // near 115
    { x: 1077, y: 865 },  // curve down toward 157/158 area
    { x: 949, y: 917 },   // near 157
    { x: 534, y: 1128 },  // near 194
    { x: 300, y: 1200 },
  ];

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
      }
    }
    return el;
  }

  function buildThamesPath() {
    const pts = THAMES_PATH_POINTS;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 2; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x} ${pts[i].y} ${xc} ${yc}`;
    }
    const last = pts[pts.length - 2];
    const end = pts[pts.length - 1];
    d += ` Q ${last.x} ${last.y} ${end.x} ${end.y}`;
    return d;
  }

  // ── Styles ──────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('board-renderer-styles')) return;
    const style = document.createElement('style');
    style.id = 'board-renderer-styles';
    style.textContent = `
      @keyframes board-pulse {
        0%, 100% { opacity: 0.4; r: 16; }
        50%      { opacity: 1;   r: 22; }
      }
      .board-highlight {
        animation: board-pulse 1s ease-in-out infinite;
        fill: #FBBF24;
        pointer-events: none;
      }
      .board-node-interactive {
        cursor: pointer;
      }
      .board-node-interactive:hover circle.node-bg {
        fill: #FEF08A;
      }
    `;
    document.head.appendChild(style);
  }

  // ── BoardRenderer ──────────────────────────────────────────────────────

  class BoardRenderer {
    constructor(containerId) {
      this._container = document.getElementById(containerId);
      if (!this._container) throw new Error(`Container #${containerId} not found`);

      injectStyles();

      this._svg = svgEl('svg', {
        width: '100%',
        height: '100%',
        viewBox: `0 0 ${VIEWBOX_W} ${VIEWBOX_H}`,
        preserveAspectRatio: 'xMidYMid meet',
      });
      this._container.appendChild(this._svg);

      // Transform group for pan/zoom
      this._g = svgEl('g');
      this._svg.appendChild(this._g);

      // Layer groups (populated by render())
      this._layers = {};
      this._pawnGroup = null;
      this._highlightGroup = null;
      this._nodeGroups = {};      // nodeId -> <g> element
      this._interactiveSet = null; // Set of interactive node IDs (null = all)
      this._nodeClickCb = null;

      // Pan/zoom state
      this._zoom = 1;
      this._panX = 0;
      this._panY = 0;
      this._isPanning = false;
      this._panStart = { x: 0, y: 0 };
      this._lastPan = { x: 0, y: 0 };

      // Touch state
      this._lastPinchDist = 0;

      this._bindPanZoom();
    }

    // ── Rendering ──────────────────────────────────────────────────────

    render() {
      // Clear previous content
      while (this._g.firstChild) this._g.removeChild(this._g.firstChild);
      this._nodeGroups = {};

      // 1. Thames river
      const thamesLayer = svgEl('g', { class: 'layer-thames' });
      thamesLayer.appendChild(svgEl('path', {
        d: buildThamesPath(),
        fill: 'none',
        stroke: '#87CEEB',
        'stroke-width': '30',
        'stroke-opacity': '0.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }));
      this._g.appendChild(thamesLayer);

      // 2. Taxi edges
      const taxiLayer = svgEl('g', { class: 'layer-taxi' });
      this._drawEdges(taxiLayer, EDGES.taxi, '#D4A017', 1, 0.3);
      this._g.appendChild(taxiLayer);

      // 3. Bus edges
      const busLayer = svgEl('g', { class: 'layer-bus' });
      this._drawEdges(busLayer, EDGES.bus, '#16A34A', 2.5, 0.7);
      this._g.appendChild(busLayer);

      // 4. Underground edges
      const ugLayer = svgEl('g', { class: 'layer-underground' });
      this._drawEdges(ugLayer, EDGES.underground, '#DC2626', 3, 1, '8 4');
      this._g.appendChild(ugLayer);

      // 5. Boat edges
      const boatLayer = svgEl('g', { class: 'layer-boat' });
      this._drawEdges(boatLayer, EDGES.boat, '#1E3A5F', 2, 1);
      this._g.appendChild(boatLayer);

      // 6. Highlight layer (below nodes, above edges)
      this._highlightGroup = svgEl('g', { class: 'layer-highlights' });
      this._g.appendChild(this._highlightGroup);

      // 7. Nodes
      const nodeLayer = svgEl('g', { class: 'layer-nodes' });
      this._drawNodes(nodeLayer);
      this._g.appendChild(nodeLayer);

      // 8. Pawn layer (empty, populated by updatePawns)
      this._pawnGroup = svgEl('g', { class: 'layer-pawns' });
      this._g.appendChild(this._pawnGroup);

      this._layers = {
        thames: thamesLayer,
        taxi: taxiLayer,
        bus: busLayer,
        underground: ugLayer,
        boat: boatLayer,
        highlights: this._highlightGroup,
        nodes: nodeLayer,
        pawns: this._pawnGroup,
      };
    }

    _drawEdges(layer, pairs, color, width, opacity, dasharray) {
      for (const [a, b] of pairs) {
        const na = NODES[a];
        const nb = NODES[b];
        if (!na || !nb) continue;
        const attrs = {
          x1: na.x, y1: na.y,
          x2: nb.x, y2: nb.y,
          stroke: color,
          'stroke-width': width,
          'stroke-opacity': opacity,
        };
        if (dasharray) attrs['stroke-dasharray'] = dasharray;
        layer.appendChild(svgEl('line', attrs));
      }
    }

    _drawNodes(layer) {
      const ids = Object.keys(NODES).map(Number).sort((a, b) => a - b);
      for (const id of ids) {
        const n = NODES[id];
        const g = svgEl('g', {
          class: 'board-node',
          'data-node': id,
        });

        const types = n.types || [];

        // Outer ring for underground or bus-only
        if (types.includes('underground')) {
          g.appendChild(svgEl('circle', {
            cx: n.x, cy: n.y, r: 12,
            fill: '#DC2626', stroke: 'none',
          }));
        } else if (types.includes('bus') && !types.includes('underground')) {
          g.appendChild(svgEl('circle', {
            cx: n.x, cy: n.y, r: 11,
            fill: '#16A34A', stroke: 'none',
          }));
        }

        // White inner circle
        g.appendChild(svgEl('circle', {
          cx: n.x, cy: n.y, r: 9,
          fill: '#FFFFFF',
          stroke: '#333',
          'stroke-width': '0.5',
          class: 'node-bg',
        }));

        // Node number label
        const label = svgEl('text', {
          x: n.x,
          y: n.y + 2.5,
          'text-anchor': 'middle',
          'font-size': '7',
          'font-family': 'Arial, sans-serif',
          'font-weight': 'bold',
          fill: '#333',
          'pointer-events': 'none',
        });
        label.textContent = id;
        g.appendChild(label);

        // Click handler on the group
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._interactiveSet && !this._interactiveSet.has(id)) return;
          if (this._nodeClickCb) this._nodeClickCb(id);
        });

        this._nodeGroups[id] = g;
        layer.appendChild(g);
      }
    }

    // ── Highlights ─────────────────────────────────────────────────────

    highlightReachable(nodeIds) {
      this.clearHighlights();
      for (const id of nodeIds) {
        const n = NODES[id];
        if (!n) continue;
        const c = svgEl('circle', {
          cx: n.x, cy: n.y, r: 16,
          class: 'board-highlight',
          'data-highlight': id,
        });
        this._highlightGroup.appendChild(c);
      }
    }

    clearHighlights() {
      if (!this._highlightGroup) return;
      while (this._highlightGroup.firstChild) {
        this._highlightGroup.removeChild(this._highlightGroup.firstChild);
      }
    }

    // ── Pawns ──────────────────────────────────────────────────────────

    updatePawns(mrXState, detectives, showMrX) {
      if (!this._pawnGroup) return;
      while (this._pawnGroup.firstChild) {
        this._pawnGroup.removeChild(this._pawnGroup.firstChild);
      }

      // Mr. X
      if (mrXState) {
        if (showMrX && mrXState.position) {
          this._drawMrXPawn(mrXState.position, false);
        } else if (mrXState.lastKnown) {
          this._drawMrXPawn(mrXState.lastKnown, true);
        }
      }

      // Detectives
      if (detectives) {
        detectives.forEach((det, i) => {
          if (!det.position) return;
          const n = NODES[det.position];
          if (!n) return;
          const dc = DETECTIVE_COLORS[i] || { color: '#999' };
          const g = svgEl('g', { class: 'pawn-detective' });

          g.appendChild(svgEl('circle', {
            cx: n.x, cy: n.y, r: 10,
            fill: dc.color,
            stroke: '#FFF',
            'stroke-width': '2',
          }));

          const label = svgEl('text', {
            x: n.x,
            y: n.y + 3.5,
            'text-anchor': 'middle',
            'font-size': '9',
            'font-weight': 'bold',
            'font-family': 'Arial, sans-serif',
            fill: '#FFF',
            'pointer-events': 'none',
          });
          label.textContent = (i + 1).toString();
          g.appendChild(label);

          this._pawnGroup.appendChild(g);
        });
      }
    }

    _drawMrXPawn(nodeId, isGhost) {
      const n = NODES[nodeId];
      if (!n) return;
      const g = svgEl('g', { class: 'pawn-mrx' });

      const circleAttrs = {
        cx: n.x, cy: n.y, r: 12,
        fill: isGhost ? 'none' : '#111',
        stroke: isGhost ? '#666' : '#FFF',
        'stroke-width': isGhost ? '2' : '2',
      };
      if (isGhost) {
        circleAttrs['stroke-dasharray'] = '4 3';
        circleAttrs.fill = 'rgba(0,0,0,0.2)';
      }
      g.appendChild(svgEl('circle', circleAttrs));

      const label = svgEl('text', {
        x: n.x,
        y: n.y + 4,
        'text-anchor': 'middle',
        'font-size': '11',
        'font-weight': 'bold',
        'font-family': 'Arial, sans-serif',
        fill: isGhost ? '#888' : '#FFF',
        'pointer-events': 'none',
      });
      label.textContent = 'X';
      g.appendChild(label);

      this._pawnGroup.appendChild(g);
    }

    // ── Pan / Zoom ─────────────────────────────────────────────────────

    _applyTransform() {
      this._g.setAttribute('transform',
        `translate(${this._panX} ${this._panY}) scale(${this._zoom})`);
    }

    _clampZoom(z) {
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    }

    _svgPoint(clientX, clientY) {
      const pt = this._svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      return pt.matrixTransform(this._svg.getScreenCTM().inverse());
    }

    _zoomAtPoint(newZoom, clientX, clientY) {
      const oldZoom = this._zoom;
      newZoom = this._clampZoom(newZoom);
      if (newZoom === oldZoom) return;

      const pt = this._svgPoint(clientX, clientY);
      // Adjust pan so the point under the cursor stays fixed
      this._panX = pt.x - ((pt.x - this._panX) * newZoom / oldZoom);
      this._panY = pt.y - ((pt.y - this._panY) * newZoom / oldZoom);
      this._zoom = newZoom;
      this._applyTransform();
    }

    _bindPanZoom() {
      const svg = this._svg;

      // Mouse drag
      svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this._isPanning = true;
        this._panStart = { x: e.clientX, y: e.clientY };
        this._lastPan = { x: this._panX, y: this._panY };
        svg.style.cursor = 'grabbing';
      });

      window.addEventListener('mousemove', (e) => {
        if (!this._isPanning) return;
        const ctm = svg.getScreenCTM();
        const dx = (e.clientX - this._panStart.x) / ctm.a;
        const dy = (e.clientY - this._panStart.y) / ctm.d;
        this._panX = this._lastPan.x + dx;
        this._panY = this._lastPan.y + dy;
        this._applyTransform();
      });

      window.addEventListener('mouseup', () => {
        this._isPanning = false;
        svg.style.cursor = '';
      });

      // Mouse wheel zoom
      svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this._zoomAtPoint(this._zoom * dir, e.clientX, e.clientY);
      }, { passive: false });

      // Double-click zoom
      svg.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this._zoomAtPoint(this._zoom * ZOOM_STEP * ZOOM_STEP, e.clientX, e.clientY);
      });

      // Touch: drag + pinch
      svg.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          this._isPanning = true;
          this._panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          this._lastPan = { x: this._panX, y: this._panY };
        } else if (e.touches.length === 2) {
          this._isPanning = false;
          this._lastPinchDist = this._pinchDist(e.touches);
        }
      }, { passive: true });

      svg.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && this._isPanning) {
          const ctm = svg.getScreenCTM();
          const dx = (e.touches[0].clientX - this._panStart.x) / ctm.a;
          const dy = (e.touches[0].clientY - this._panStart.y) / ctm.d;
          this._panX = this._lastPan.x + dx;
          this._panY = this._lastPan.y + dy;
          this._applyTransform();
        } else if (e.touches.length === 2) {
          const dist = this._pinchDist(e.touches);
          const scale = dist / this._lastPinchDist;
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          this._zoomAtPoint(this._zoom * scale, mx, my);
          this._lastPinchDist = dist;
        }
      }, { passive: false });

      svg.addEventListener('touchend', () => {
        this._isPanning = false;
      }, { passive: true });
    }

    _pinchDist(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // ── Public API ─────────────────────────────────────────────────────

    centerOnNode(nodeId, zoom) {
      const n = NODES[nodeId];
      if (!n) return;

      const targetZoom = this._clampZoom(zoom || 2);
      const svgRect = this._svg.getBoundingClientRect();
      const vbW = VIEWBOX_W;
      const vbH = VIEWBOX_H;

      // SVG coordinate center of the viewport
      const centerX = vbW / 2;
      const centerY = vbH / 2;

      const targetPanX = centerX - n.x * targetZoom;
      const targetPanY = centerY - n.y * targetZoom;

      // Animate smoothly
      const startPanX = this._panX;
      const startPanY = this._panY;
      const startZoom = this._zoom;
      const duration = 400;
      const start = performance.now();

      const animate = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const ease = t < 0.5
          ? 2 * t * t
          : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad

        this._panX = startPanX + (targetPanX - startPanX) * ease;
        this._panY = startPanY + (targetPanY - startPanY) * ease;
        this._zoom = startZoom + (targetZoom - startZoom) * ease;
        this._applyTransform();

        if (t < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }

    onNodeClick(callback) {
      this._nodeClickCb = callback;
    }

    setNodeInteractive(nodeIds) {
      if (!nodeIds) {
        this._interactiveSet = null;
        // Make all nodes interactive
        for (const [id, g] of Object.entries(this._nodeGroups)) {
          g.classList.add('board-node-interactive');
          g.style.pointerEvents = '';
        }
        return;
      }

      this._interactiveSet = new Set(nodeIds);
      for (const [id, g] of Object.entries(this._nodeGroups)) {
        const nid = Number(id);
        if (this._interactiveSet.has(nid)) {
          g.classList.add('board-node-interactive');
          g.style.pointerEvents = '';
        } else {
          g.classList.remove('board-node-interactive');
          g.style.pointerEvents = 'none';
        }
      }
    }
  }

  window.BoardRenderer = BoardRenderer;
})();
