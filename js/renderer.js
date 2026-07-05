// renderer.js — two-layer Canvas 2D renderer.
//   #world: map base + overlays, redrawn only when dirty (camera, turn, selection).
//   #fx:    hover halo, selection ring, animated flow dashes, route preview —
//           redrawn per frame only while something animated/interactive is live.
// Overlay modes: 'none' | 'price' | 'flow' | 'congestion'.
(function (global) {
  'use strict';

  const { clamp, formatNumber, formatPrice } = global.Util;

  const COLORS = {
    background: '#f2efe6',
    mapEdge: '#d6d2c4',
    edge: '#c9c5b6',
    rail: '#6b675c',
    plainNode: '#b5b1a3',
    town: '#8d8a7e',
    midsize: '#5f5c52',
    major: '#3c3a33',
    terminal: '#1f6f8b',
    production: '#7a6a51',
    productionOutline: '#9a8a6b',
    crudeFlow: '#4d3f2f',
    refinedFlow: '#a3652a',
    text: '#33312b'
  };

  // Sequential single-hue ramp (light → dark orange-brown), cheap → expensive.
  function priceColor(t) {
    t = clamp(t, 0, 1);
    const stops = [
      [255, 240, 219], // light peach
      [244, 189, 122],
      [222, 132, 60],
      [178, 80, 24],
      [117, 44, 5]     // deep brown
    ];
    const x = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // Utilization ramp for congestion (single hue teal→dark; red pulse handled separately).
  function utilizationColor(t) {
    t = clamp(t, 0, 1);
    if (t >= 0.999) return '#c22f2e';
    const from = [163, 201, 168], to = [20, 90, 50];
    const c = from.map((v, k) => Math.round(v + (to[k] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  class Renderer {
    constructor(worldCanvas, fxCanvas, state) {
      this.worldCanvas = worldCanvas;
      this.fxCanvas = fxCanvas;
      this.state = state;
      this.camera = new global.CameraModule.Camera(worldCanvas, state.mapWidth, state.mapHeight);
      this.overlay = 'none';
      this.hoverNode = null;
      this.hoverEdge = null;
      this.selectedNode = null;
      this.selectedEdge = null;
      this.routePreview = null;   // { edgeIds } for pipeline route-builder
      this.dirty = true;
      this.animTime = 0;
      this._raf = null;
      this.resize();
    }

    setState(state) {
      this.state = state;
      this.camera = new global.CameraModule.Camera(this.worldCanvas, state.mapWidth, state.mapHeight);
      this.hoverNode = this.hoverEdge = this.selectedNode = this.selectedEdge = this.routePreview = null;
      this.fitView();
    }

    resize() {
      const wrap = this.worldCanvas.parentElement;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this.viewW = wrap.clientWidth;
      this.viewH = wrap.clientHeight;
      for (const c of [this.worldCanvas, this.fxCanvas]) {
        c.width = Math.round(this.viewW * dpr);
        c.height = Math.round(this.viewH * dpr);
        c.style.width = this.viewW + 'px';
        c.style.height = this.viewH + 'px';
        c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this.dirty = true;
    }

    fitView() {
      this.camera.fit(this.viewW, this.viewH);
      this.dirty = true;
    }

    start() {
      const loop = (t) => {
        this.animTime = t;
        if (this.dirty) {
          this.drawWorld();
          this.dirty = false;
        }
        this.drawFx();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    // World-space size of a node for drawing & halo purposes.
    nodeRadius(n) {
      if (n.type === 'terminal') return 10;
      if (n.type === 'production') return 8 + 8 * Math.sqrt(n.prodCapacity / 50000);
      if (n.cityTier === 'major') return 16;
      if (n.cityTier === 'midsize') return 11;
      if (n.cityTier === 'town') return 5 + 4 * Math.sqrt(Math.min(1, n.demandBase / 20000));
      return 3.5;
    }

    // ---------------- world layer ----------------

    drawWorld() {
      const ctx = this.worldCanvas.getContext('2d');
      const { viewW, viewH } = this;
      const cam = this.camera;
      const state = this.state;
      ctx.save();
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, viewW, viewH);

      // world transform
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      const z = cam.zoom;

      // map border
      ctx.strokeStyle = COLORS.mapEdge;
      ctx.lineWidth = 2 / z;
      ctx.strokeRect(0, 0, state.mapWidth, state.mapHeight);

      // --- edges ---
      for (const e of state.edges) {
        const a = state.nodes[e.a], b = state.nodes[e.b];
        if (e.pipeline) {
          // double line in owner color
          const color = state.players[e.pipeline.owner] ? state.players[e.pipeline.owner].color : '#888';
          this.drawDoubleLine(ctx, a, b, color, 2.4 / z, 2.2 / z);
        } else if (e.rail) {
          ctx.strokeStyle = COLORS.rail;
          ctx.lineWidth = 1.6 / z;
          ctx.setLineDash([7 / z, 4 / z]);
          this.line(ctx, a, b);
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = COLORS.edge;
          ctx.lineWidth = 1 / z;
          this.line(ctx, a, b);
        }
      }

      // --- overlays under nodes ---
      if (this.overlay === 'price') this.drawPriceOverlay(ctx);
      if (this.overlay === 'flow') this.drawFlowOverlay(ctx);
      if (this.overlay === 'congestion') this.drawCongestionOverlay(ctx);

      // --- nodes ---
      for (const n of state.nodes) this.drawNode(ctx, n);

      // city labels at readable zoom
      if (z > 0.35) {
        ctx.fillStyle = COLORS.text;
        ctx.font = `${12 / z}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        for (const n of state.nodes) {
          if (n.cityTier === 'major') ctx.fillText(`City ${n.id}`, n.x, n.y - this.nodeRadius(n) - 6 / z);
        }
      }

      ctx.restore();
    }

    line(ctx, a, b) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    drawDoubleLine(ctx, a, b, color, width, gap) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * gap, oy = (dx / len) * gap;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x + ox, a.y + oy); ctx.lineTo(b.x + ox, b.y + oy);
      ctx.moveTo(a.x - ox, a.y - oy); ctx.lineTo(b.x - ox, b.y - oy);
      ctx.stroke();
    }

    drawNode(ctx, n) {
      const z = this.camera.zoom;
      const r = this.nodeRadius(n);

      if (n.type === 'terminal') {
        ctx.fillStyle = COLORS.terminal;
        ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / z;
        ctx.strokeRect(n.x - r, n.y - r, r * 2, r * 2);
        // anchor glyph: ship channel
        ctx.beginPath();
        ctx.moveTo(n.x - r * 0.5, n.y);
        ctx.lineTo(n.x + r * 0.5, n.y);
        ctx.moveTo(n.x, n.y - r * 0.5);
        ctx.lineTo(n.x, n.y + r * 0.5);
        ctx.stroke();
      } else if (n.type === 'production') {
        // triangle; filled with owner color when a well exists
        ctx.beginPath();
        ctx.moveTo(n.x, n.y - r);
        ctx.lineTo(n.x + r * 0.87, n.y + r * 0.5);
        ctx.lineTo(n.x - r * 0.87, n.y + r * 0.5);
        ctx.closePath();
        if (n.well) {
          ctx.fillStyle = this.state.players[n.well.owner].color;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.2 / z;
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(122,106,81,0.15)';
          ctx.fill();
          ctx.strokeStyle = COLORS.production;
          ctx.lineWidth = 1.4 / z;
          ctx.stroke();
        }
      } else if (n.demandBase > 0) {
        const color = n.cityTier === 'major' ? COLORS.major : n.cityTier === 'midsize' ? COLORS.midsize : COLORS.town;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, this.nodeRadius(n), 0, 2 * Math.PI);
        ctx.fillStyle = COLORS.plainNode;
        ctx.fill();
      }

      // building badges
      const bx = n.x + this.nodeRadius(n) * 0.9;
      if (n.refinery) {
        const owner = this.state.players[n.refinery.owner];
        const s = 8;
        ctx.fillStyle = owner ? owner.color : '#888';
        ctx.fillRect(bx, n.y - s, s, s);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1 / z;
        ctx.strokeRect(bx, n.y - s, s, s);
        // chimney tick to distinguish from terminals
        ctx.beginPath();
        ctx.moveTo(bx + s * 0.7, n.y - s);
        ctx.lineTo(bx + s * 0.7, n.y - s * 1.6);
        ctx.strokeStyle = owner ? owner.color : '#888';
        ctx.lineWidth = 2 / z;
        ctx.stroke();
      }
      if (n.storage) {
        const owner = this.state.players[n.storage.owner];
        ctx.beginPath();
        ctx.arc(bx + 4, n.y + 7, 4.5, 0, 2 * Math.PI);
        const frac = n.storage.capacity > 0 ? n.storage.stock / n.storage.capacity : 0;
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx + 4, n.y + 7);
        ctx.arc(bx + 4, n.y + 7, 4.5, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI);
        ctx.closePath();
        ctx.fillStyle = owner ? owner.color : '#888';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx + 4, n.y + 7, 4.5, 0, 2 * Math.PI);
        ctx.strokeStyle = owner ? owner.color : '#888';
        ctx.lineWidth = 1.2 / z;
        ctx.stroke();
      }
    }

    // ---------------- overlays ----------------

    priceRange() {
      let min = Infinity, max = -Infinity;
      for (const n of this.state.nodes) {
        if (n.localPrice !== null && n.demandBase > 0) {
          min = Math.min(min, n.localPrice);
          max = Math.max(max, n.localPrice);
        }
      }
      if (!isFinite(min)) return null;
      if (max - min < 1) max = min + 1;
      return { min, max };
    }

    drawPriceOverlay(ctx) {
      const range = this.priceRange();
      if (!range) return;
      for (const n of this.state.nodes) {
        if (n.localPrice === null || n.demandBase <= 0) continue;
        const t = (n.localPrice - range.min) / (range.max - range.min);
        const r = this.nodeRadius(n) + 26;
        const g = ctx.createRadialGradient(n.x, n.y, 2, n.x, n.y, r);
        const c = priceColor(t);
        g.addColorStop(0, c.replace('rgb', 'rgba').replace(')', ',0.75)'));
        g.addColorStop(1, c.replace('rgb', 'rgba').replace(')', ',0)'));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    flowScale() {
      let max = 0;
      for (const e of this.state.edges) max = Math.max(max, e.flowCrude + e.flowRefined);
      return max;
    }

    drawFlowOverlay(ctx) {
      const z = this.camera.zoom;
      const max = this.flowScale();
      if (max <= 0) return;
      for (const e of this.state.edges) {
        const total = e.flowCrude + e.flowRefined;
        if (total <= 0) continue;
        const a = this.state.nodes[e.a], b = this.state.nodes[e.b];
        const w = (1.5 + 9 * Math.sqrt(total / max)) / z;
        // crude and refined drawn side by side when both present
        if (e.flowCrude > 0 && e.flowRefined > 0) {
          const wc = w * e.flowCrude / total, wr = w * e.flowRefined / total;
          this.offsetLine(ctx, a, b, COLORS.crudeFlow, wc, w / 2);
          this.offsetLine(ctx, a, b, COLORS.refinedFlow, wr, -w / 2);
        } else {
          ctx.strokeStyle = e.flowCrude > 0 ? COLORS.crudeFlow : COLORS.refinedFlow;
          ctx.lineWidth = w;
          ctx.globalAlpha = 0.8;
          this.line(ctx, a, b);
          ctx.globalAlpha = 1;
        }
      }
    }

    offsetLine(ctx, a, b, color, width, offset) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * offset / this.camera.zoom, oy = (dx / len) * offset / this.camera.zoom;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(a.x + ox, a.y + oy);
      ctx.lineTo(b.x + ox, b.y + oy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawCongestionOverlay(ctx) {
      const z = this.camera.zoom;
      const config = this.state.configStore.active;
      for (const e of this.state.edges) {
        if (!e.pipeline) continue;
        const a = this.state.nodes[e.a], b = this.state.nodes[e.b];
        const util = config.pipelineCapacity > 0 ? e.pipeFlow / config.pipelineCapacity : 0;
        ctx.strokeStyle = utilizationColor(util);
        ctx.lineWidth = 6 / z;
        ctx.globalAlpha = 0.85;
        this.line(ctx, a, b);
        ctx.globalAlpha = 1;
      }
    }

    // ---------------- fx layer ----------------

    fxNeedsFrame() {
      return this.hoverNode || this.hoverEdge || this.selectedNode || this.selectedEdge ||
        this.routePreview || this.overlay === 'flow' || this.overlay === 'congestion';
    }

    drawFx() {
      const ctx = this.fxCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.viewW, this.viewH);
      if (!this.fxNeedsFrame()) return;
      const cam = this.camera;
      ctx.save();
      ctx.translate(this.viewW / 2, this.viewH / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      const z = cam.zoom;

      // marching ants along flowing edges
      if (this.overlay === 'flow') {
        const max = this.flowScale();
        if (max > 0) {
          const dash = 10 / z;
          ctx.setLineDash([dash, dash * 1.6]);
          ctx.lineDashOffset = -(this.animTime / 40) / z;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          for (const e of this.state.edges) {
            const total = e.flowCrude + e.flowRefined;
            if (total <= 0) continue;
            ctx.lineWidth = clamp(3 * Math.sqrt(total / max), 0.8, 3) / z;
            this.line(ctx, this.state.nodes[e.a], this.state.nodes[e.b]);
          }
          ctx.setLineDash([]);
        }
      }

      // congested pipes pulse
      if (this.overlay === 'congestion') {
        const pulse = 0.5 + 0.5 * Math.sin(this.animTime / 250);
        ctx.strokeStyle = `rgba(194,47,46,${0.25 + 0.55 * pulse})`;
        for (const e of this.state.edges) {
          if (!e.congested) continue;
          ctx.lineWidth = 10 / z;
          this.line(ctx, this.state.nodes[e.a], this.state.nodes[e.b]);
        }
      }

      // route-builder preview
      if (this.routePreview) {
        ctx.setLineDash([8 / z, 5 / z]);
        ctx.strokeStyle = this.state.players[0].color;
        ctx.lineWidth = 4 / z;
        for (const eid of this.routePreview.edgeIds) {
          const e = this.state.edges[eid];
          this.line(ctx, this.state.nodes[e.a], this.state.nodes[e.b]);
        }
        ctx.setLineDash([]);
      }

      // hover / selection halos
      const halo = (n, color, width) => {
        ctx.beginPath();
        ctx.arc(n.x, n.y, this.nodeRadius(n) + 5 / z, 0, 2 * Math.PI);
        ctx.strokeStyle = color;
        ctx.lineWidth = width / z;
        ctx.stroke();
      };
      const edgeHalo = (e, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width / z;
        this.line(ctx, this.state.nodes[e.a], this.state.nodes[e.b]);
      };
      if (this.hoverEdge && this.hoverEdge !== this.selectedEdge) edgeHalo(this.hoverEdge, 'rgba(51,49,43,0.35)', 5);
      if (this.selectedEdge) edgeHalo(this.selectedEdge, 'rgba(42,120,214,0.8)', 5);
      if (this.hoverNode && this.hoverNode !== this.selectedNode) halo(this.hoverNode, 'rgba(51,49,43,0.5)', 2);
      if (this.selectedNode) halo(this.selectedNode, '#2a78d6', 3);

      ctx.restore();
    }
  }

  const RendererModule = { Renderer, priceColor, utilizationColor, COLORS };
  global.RendererModule = RendererModule;
  if (typeof module !== 'undefined' && module.exports) module.exports = RendererModule;
})(typeof globalThis !== 'undefined' ? globalThis : window);
