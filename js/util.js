// util.js — seeded RNG, random distributions, formatters, EventBus.
(function (global) {
  'use strict';

  // mulberry32: small fast seeded PRNG. Returns a function () => [0,1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Random distribution helpers. Every function takes an rng stream (() => [0,1)).
  const RandomUtils = {
    range(rng, min, max) {
      return min + rng() * (max - min);
    },
    int(rng, min, max) { // inclusive
      return min + Math.floor(rng() * (max - min + 1));
    },
    normal(rng, mean = 0, stddev = 1) {
      let u = 0, v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return mean + z * stddev;
    },
    lognormal(rng, mean, sigma) {
      const mu = Math.log(mean);
      return Math.exp(mu + sigma * RandomUtils.normal(rng, 0, 1));
    },
    pareto(rng, scale, alpha) {
      let u = 0;
      while (u === 0) u = rng();
      return scale / Math.pow(u, 1 / alpha);
    },
    randomWalk(rng, current, volatility) {
      const change = (rng() - 0.5) * 2 * volatility;
      return current * (1 + change);
    },
    shuffle(rng, arr) { // in-place Fisher-Yates
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    pick(rng, arr) {
      return arr[Math.floor(rng() * arr.length)];
    }
  };

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  function formatCurrency(amount) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(2)}`;
  }

  function formatNumber(num) {
    if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (Math.abs(num) >= 1e4) return `${(num / 1e3).toFixed(0)}K`;
    return Math.round(num).toLocaleString('en-US');
  }

  // Price / per-barrel money: always 2 decimals with $ prefix.
  function formatPrice(v) {
    return `$${v.toFixed(2)}`;
  }

  class EventBus {
    constructor() { this.listeners = new Map(); }
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
      return () => this.off(event, fn);
    }
    off(event, fn) {
      const list = this.listeners.get(event);
      if (list) {
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      }
    }
    emit(event, payload) {
      const list = this.listeners.get(event);
      if (list) for (const fn of list.slice()) fn(payload);
    }
  }

  const Util = { mulberry32, RandomUtils, clamp, formatCurrency, formatNumber, formatPrice, EventBus };
  global.Util = Util;
  if (typeof module !== 'undefined' && module.exports) module.exports = Util;
})(typeof globalThis !== 'undefined' ? globalThis : window);
