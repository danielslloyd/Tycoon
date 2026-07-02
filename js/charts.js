// charts.js — minimal canvas line/sparkline charts for the sidebar
// (price history, cumulative profit). Thin 2px lines, recessive grid,
// hover crosshair with values, direct color chips handled by the caller's legend.
(function (global) {
  'use strict';

  const { clamp } = global.Util;

  const AXIS_COLOR = 'rgba(51,49,43,0.15)';
  const TEXT_COLOR = '#6f6c63';

  // series: [{ name, color, values: number[] }]; all series share the x index.
  class LineChart {
    constructor(canvas, { formatY = (v) => String(Math.round(v)), height = 110 } = {}) {
      this.canvas = canvas;
      this.formatY = formatY;
      this.height = height;
      this.series = [];
      this.hoverX = null; // fraction 0..1
      canvas.addEventListener('mousemove', (ev) => {
        const rect = canvas.getBoundingClientRect();
        this.hoverX = clamp((ev.clientX - rect.left - this.padL) / (rect.width - this.padL - this.padR), 0, 1);
        this.draw();
      });
      canvas.addEventListener('mouseleave', () => { this.hoverX = null; this.draw(); });
    }

    get padL() { return 8; }
    get padR() { return 8; }

    setData(series) {
      this.series = series.filter((s) => s.values.length > 0);
      this.draw();
    }

    draw() {
      const c = this.canvas;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const w = c.parentElement ? c.parentElement.clientWidth : c.clientWidth || 260;
      const h = this.height;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (this.series.length === 0) return;

      const padT = 14, padB = 14, padL = this.padL, padR = this.padR;
      const plotW = w - padL - padR, plotH = h - padT - padB;

      let min = Infinity, max = -Infinity, maxLen = 0;
      for (const s of this.series) {
        maxLen = Math.max(maxLen, s.values.length);
        for (const v of s.values) { min = Math.min(min, v); max = Math.max(max, v); }
      }
      if (min === max) { min -= 1; max += 1; }
      const pad = (max - min) * 0.06;
      min -= pad; max += pad;

      const xAt = (i) => padL + (maxLen > 1 ? (i / (maxLen - 1)) * plotW : plotW / 2);
      const yAt = (v) => padT + (1 - (v - min) / (max - min)) * plotH;

      // recessive grid: 3 horizontal lines + min/max labels
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      for (let g = 0; g <= 2; g++) {
        const y = padT + (g / 2) * plotH;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      }
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this.formatY(max - pad), padL + 2, padT - 3);
      ctx.fillText(this.formatY(min + pad), padL + 2, h - 3);

      // zero line when the range crosses zero
      if (min < 0 && max > 0) {
        ctx.strokeStyle = 'rgba(51,49,43,0.35)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(padL, yAt(0)); ctx.lineTo(w - padR, yAt(0)); ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const s of this.series) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        s.values.forEach((v, i) => {
          if (i === 0) ctx.moveTo(xAt(i), yAt(v));
          else ctx.lineTo(xAt(i), yAt(v));
        });
        ctx.stroke();
      }

      // hover crosshair + values
      if (this.hoverX !== null && maxLen > 1) {
        const i = Math.round(this.hoverX * (maxLen - 1));
        const x = xAt(i);
        ctx.strokeStyle = 'rgba(51,49,43,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
        let ty = padT + 2;
        ctx.textAlign = x > w / 2 ? 'right' : 'left';
        const tx = x > w / 2 ? x - 5 : x + 5;
        for (const s of this.series) {
          const v = s.values[Math.min(i, s.values.length - 1)];
          if (v === undefined) continue;
          ctx.beginPath();
          ctx.arc(x, yAt(v), 3, 0, 2 * Math.PI);
          ctx.fillStyle = s.color;
          ctx.fill();
          ctx.fillStyle = '#33312b';
          ctx.fillText(`${s.name}: ${this.formatY(v)}`, tx, ty + 9);
          ty += 12;
        }
      }
    }
  }

  // Tiny sparkline (no axes) for the top bar price.
  function sparkline(canvas, values, color, w = 72, h = 22) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (values.length < 2) return;
    const shown = values.slice(-60);
    let min = Math.min(...shown), max = Math.max(...shown);
    if (min === max) { min -= 1; max += 1; }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    shown.forEach((v, i) => {
      const x = (i / (shown.length - 1)) * (w - 2) + 1;
      const y = 1 + (1 - (v - min) / (max - min)) * (h - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  const Charts = { LineChart, sparkline };
  global.Charts = Charts;
  if (typeof module !== 'undefined' && module.exports) module.exports = Charts;
})(typeof globalThis !== 'undefined' ? globalThis : window);
