// camera.js — world↔screen transform with drag-pan and cursor-centered wheel
// zoom, plus node/edge hit-testing. Node counts are small (≤800), so linear
// scans with early rejection are plenty fast for hover picking.
(function (global) {
  'use strict';

  const { clamp } = global.Util;

  class Camera {
    constructor(canvas, worldW, worldH) {
      this.canvas = canvas;
      this.worldW = worldW;
      this.worldH = worldH;
      this.x = worldW / 2;   // world point at canvas center
      this.y = worldH / 2;
      this.zoom = 1;
      this.minZoom = 0.15;
      this.maxZoom = 8;
    }

    fit(viewW, viewH, pad = 40) {
      this.zoom = Math.min((viewW - pad * 2) / this.worldW, (viewH - pad * 2) / this.worldH);
      this.minZoom = this.zoom * 0.5;
      this.x = this.worldW / 2;
      this.y = this.worldH / 2;
    }

    toScreen(wx, wy, viewW, viewH) {
      return {
        x: (wx - this.x) * this.zoom + viewW / 2,
        y: (wy - this.y) * this.zoom + viewH / 2
      };
    }

    toWorld(sx, sy, viewW, viewH) {
      return {
        x: (sx - viewW / 2) / this.zoom + this.x,
        y: (sy - viewH / 2) / this.zoom + this.y
      };
    }

    panBy(dxScreen, dyScreen) {
      this.x -= dxScreen / this.zoom;
      this.y -= dyScreen / this.zoom;
      this.clampPan();
    }

    zoomAt(sx, sy, factor, viewW, viewH) {
      const before = this.toWorld(sx, sy, viewW, viewH);
      this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
      const after = this.toWorld(sx, sy, viewW, viewH);
      this.x += before.x - after.x;
      this.y += before.y - after.y;
      this.clampPan();
    }

    clampPan() {
      const m = 300; // world-units margin allowed beyond the map
      this.x = clamp(this.x, -m, this.worldW + m);
      this.y = clamp(this.y, -m, this.worldH + m);
    }

    centerOn(wx, wy) {
      this.x = wx;
      this.y = wy;
      this.clampPan();
    }
  }

  // Nearest node within pickRadius (screen px). Returns node or null.
  function pickNode(state, camera, sx, sy, viewW, viewH, pickRadius = 14) {
    const w = camera.toWorld(sx, sy, viewW, viewH);
    const r = pickRadius / camera.zoom;
    let best = null, bestD = r * r;
    for (const n of state.nodes) {
      const dx = n.x - w.x, dy = n.y - w.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // Nearest edge within pickRadius (screen px) by point-segment distance.
  function pickEdge(state, camera, sx, sy, viewW, viewH, pickRadius = 8) {
    const w = camera.toWorld(sx, sy, viewW, viewH);
    const r = pickRadius / camera.zoom;
    let best = null, bestD = r * r;
    for (const e of state.edges) {
      const a = state.nodes[e.a], b = state.nodes[e.b];
      // bbox early reject
      if (w.x < Math.min(a.x, b.x) - r || w.x > Math.max(a.x, b.x) + r ||
          w.y < Math.min(a.y, b.y) - r || w.y > Math.max(a.y, b.y) + r) continue;
      const d = pointSegDist2(w.x, w.y, a.x, a.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function pointSegDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    return (px - cx) * (px - cx) + (py - cy) * (py - cy);
  }

  const CameraModule = { Camera, pickNode, pickEdge };
  global.CameraModule = CameraModule;
  if (typeof module !== 'undefined' && module.exports) module.exports = CameraModule;
})(typeof globalThis !== 'undefined' ? globalThis : window);
