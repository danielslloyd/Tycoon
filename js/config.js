// config.js — CONFIG_SCHEMA (single source of truth for every tunable number),
// DEFAULT_CONFIG derived from it, and ConfigStore (persistence + live-apply).
(function (global) {
  'use strict';

  // Every economic/gameplay parameter lives here. format: 'currency' | 'number' | 'percent'.
  // requiresNewGame: true → only applied when a new game starts (map/setup params).
  const CONFIG_SCHEMA = [
    {
      id: 'setup', label: 'Game Setup', params: [
        { key: 'numAIOpponents', label: 'AI opponents', default: 3, min: 0, max: 3, step: 1, format: 'number', requiresNewGame: true,
          help: 'Rival companies run by the computer. Set to 0 for a solo sandbox against the import market.' },
        { key: 'gameLength', label: 'Game length (turns)', default: 150, min: 30, max: 500, step: 10, format: 'number', requiresNewGame: true,
          help: 'Highest cumulative profit when the last turn ends wins.' },
        { key: 'startingCapital', label: 'Starting capital', default: 50e6, min: 10e6, max: 200e6, step: 5e6, format: 'currency', requiresNewGame: true,
          help: 'Cash each company starts with.' }
      ]
    },
    {
      id: 'map', label: 'Map Generation', params: [
        { key: 'numNodes', label: 'Map nodes', default: 500, min: 100, max: 800, step: 50, format: 'number', requiresNewGame: true,
          help: 'Total sites on the map. More nodes = bigger world, slower turns.' },
        { key: 'productionNodePct', label: 'Oil field share', default: 0.10, min: 0.03, max: 0.30, step: 0.01, format: 'percent', requiresNewGame: true,
          help: 'Fraction of nodes that are drillable oil fields (interior bias).' },
        { key: 'demandNodePct', label: 'Demand node share', default: 0.25, min: 0.05, max: 0.60, step: 0.05, format: 'percent', requiresNewGame: true,
          help: 'Fraction of nodes that consume fuel (cities and towns).' },
        { key: 'numImportTerminals', label: 'Import terminals', default: 10, min: 2, max: 20, step: 1, format: 'number', requiresNewGame: true,
          help: 'Coastal terminals that import/export at the world price. More terminals = tougher competition.' },
        { key: 'numMajorCities', label: 'Major cities', default: 4, min: 2, max: 8, step: 1, format: 'number', requiresNewGame: true,
          help: 'Big demand centers, connected to each other by free rail.' },
        { key: 'majorCityDemand', label: 'Major city demand (avg bbl/turn)', default: 75000, min: 10000, max: 300000, step: 5000, format: 'number', requiresNewGame: true,
          help: 'Average fuel demand of a major city (actual is ±33%).' },
        { key: 'midsizeCityDemand', label: 'Midsize city demand (avg bbl/turn)', default: 30000, min: 5000, max: 100000, step: 2500, format: 'number', requiresNewGame: true,
          help: 'Average demand of rail-junction cities (actual is ±33%).' },
        { key: 'townDemand', label: 'Town demand (avg bbl/turn)', default: 8000, min: 500, max: 40000, step: 500, format: 'number', requiresNewGame: true,
          help: 'Average demand of small towns; towns near cities skew larger.' },
        { key: 'wellCapacityMean', label: 'Field size (avg bbl/turn)', default: 8000, min: 1000, max: 40000, step: 500, format: 'number', requiresNewGame: true,
          help: 'Average size of oil fields (lognormal: many small, a few giants).' },
        { key: 'wellCapacityMax', label: 'Field size cap (bbl/turn)', default: 50000, min: 5000, max: 200000, step: 5000, format: 'number', requiresNewGame: true,
          help: 'Upper bound on any single field’s output per turn.' }
      ]
    },
    {
      id: 'costs', label: 'Build & Operating Costs', params: [
        { key: 'wellBuildCost', label: 'Well build cost', default: 5e6, min: 0.5e6, max: 30e6, step: 0.5e6, format: 'currency',
          help: 'One-time cost to drill a well on an oil field.' },
        { key: 'wellOpCostMin', label: 'Best pumping cost ($/bbl)', default: 20, min: 1, max: 100, step: 1, format: 'number',
          help: 'Per-barrel pumping cost of the biggest, cheapest fields.' },
        { key: 'wellOpCostMax', label: 'Worst pumping cost ($/bbl)', default: 60, min: 1, max: 150, step: 1, format: 'number',
          help: 'Per-barrel pumping cost of the smallest, most expensive fields.' },
        { key: 'refineryBuildCost', label: 'Refinery build cost', default: 10e6, min: 1e6, max: 60e6, step: 1e6, format: 'currency',
          help: 'One-time cost to build a refinery (crude in, fuel out).' },
        { key: 'refineryUpgradeMult', label: 'Refinery upgrade cost (× base)', default: 0.6, min: 0.1, max: 2, step: 0.05, format: 'number',
          help: 'Upgrade doubles a refinery’s capacity for this fraction of the build cost.' },
        { key: 'refineryOpCost', label: 'Refining cost ($/bbl)', default: 10, min: 0, max: 60, step: 1, format: 'number',
          help: 'Per-barrel cost of refining, paid by whoever ships the barrel.' },
        { key: 'pipelineCostPerEdge', label: 'Pipeline cost per edge', default: 1e6, min: 0.1e6, max: 10e6, step: 0.1e6, format: 'currency',
          help: 'One-time cost to lay pipe along one map edge.' },
        { key: 'storageCostPerBarrel', label: 'Storage cost ($/bbl capacity)', default: 30, min: 5, max: 2000, step: 5, format: 'number',
          help: 'One-time cost per barrel of tank capacity.' }
      ]
    },
    {
      id: 'transport', label: 'Transportation', params: [
        { key: 'truckCostPerEdge', label: 'Trucking ($/bbl/edge)', default: 3, min: 0.5, max: 20, step: 0.25, format: 'number',
          help: 'Works on every edge, no build cost, but expensive per barrel.' },
        { key: 'railCostPerEdge', label: 'Rail ($/bbl/edge)', default: 1, min: 0.1, max: 10, step: 0.1, format: 'number',
          help: 'Cheap, but only on the pre-existing rail lines between major cities.' },
        { key: 'pipelineDefaultFee', label: 'Default pipeline fee ($/bbl/edge)', default: 0.5, min: 0, max: 10, step: 0.1, format: 'number',
          help: 'Starting toll on new pipelines. Owners can change it; everyone (owner included) pays the posted toll.' },
        { key: 'pipelineCapacity', label: 'Pipeline capacity (bbl/turn/edge)', default: 20000, min: 1000, max: 200000, step: 1000, format: 'number',
          help: 'Max barrels per turn through one pipeline edge. Overflow moves by truck/rail.' }
      ]
    },
    {
      id: 'capacity', label: 'Refining Capacity', params: [
        { key: 'refineryBaseCapacity', label: 'Refinery base capacity (bbl/turn)', default: 10000, min: 1000, max: 100000, step: 1000, format: 'number',
          help: 'Throughput of a new refinery. Each upgrade doubles it.' },
        { key: 'refineryDefaultFee', label: 'Default refinery fee ($/bbl)', default: 5, min: 0, max: 50, step: 0.5, format: 'number',
          help: 'Starting margin a refinery charges on top of refining cost. Owners can change it.' }
      ]
    },
    {
      id: 'market', label: 'Prices & Market', params: [
        { key: 'initialGlobalPrice', label: 'Initial world fuel price ($/bbl)', default: 100, min: 20, max: 300, step: 5, format: 'number', requiresNewGame: true,
          help: 'World market price of refined fuel at the start.' },
        { key: 'priceVolatility', label: 'Price volatility (±/turn)', default: 0.02, min: 0, max: 0.15, step: 0.005, format: 'percent',
          help: 'Size of the world price’s random walk each turn.' },
        { key: 'priceMin', label: 'World price floor ($/bbl)', default: 40, min: 5, max: 150, step: 5, format: 'number',
          help: 'The world price never falls below this.' },
        { key: 'priceMax', label: 'World price ceiling ($/bbl)', default: 200, min: 60, max: 500, step: 10, format: 'number',
          help: 'The world price never rises above this.' },
        { key: 'terminalFee', label: 'Terminal fee ($/bbl)', default: 5, min: 0, max: 40, step: 0.5, format: 'number',
          help: 'Handling fee at import/export terminals, added to imports and subtracted from exports.' },
        { key: 'demandElasticity', label: 'Demand elasticity', default: 0.3, min: 0, max: 1.5, step: 0.05, format: 'number',
          help: 'How strongly demand reacts to local prices. 0 = fixed demand.' },
        { key: 'referencePrice', label: 'Reference price ($/bbl)', default: 100, min: 20, max: 300, step: 5, format: 'number',
          help: 'Price at which demand equals its base level (anchor for elasticity).' },
        { key: 'demandGrowthMin', label: 'Demand growth min (/turn)', default: -0.005, min: -0.05, max: 0.05, step: 0.005, format: 'percent', requiresNewGame: true,
          help: 'Slowest-growing towns (negative = declining).' },
        { key: 'demandGrowthMax', label: 'Demand growth max (/turn)', default: 0.01, min: -0.05, max: 0.10, step: 0.005, format: 'percent', requiresNewGame: true,
          help: 'Fastest-growing towns. 1%/turn quadruples demand over 150 turns.' },
        { key: 'demandJitter', label: 'Demand jitter (σ/turn)', default: 0.02, min: 0, max: 0.2, step: 0.01, format: 'percent',
          help: 'Random turn-to-turn wobble on each town’s demand.' }
      ]
    },
    {
      id: 'storage', label: 'Storage Behavior', params: [
        { key: 'storageChargeThreshold', label: 'Buy when price below (× reference)', default: 0.95, min: 0.5, max: 1.2, step: 0.01, format: 'number',
          help: 'Tanks automatically fill when the world price dips below this fraction of the reference price.' },
        { key: 'storageMinMargin', label: 'Sell margin (× cost basis)', default: 0.05, min: 0, max: 0.5, step: 0.01, format: 'percent',
          help: 'Tanks release fuel only when the local market pays at least cost basis × (1 + margin).' }
      ]
    },
    {
      id: 'ai', label: 'AI Behavior', params: [
        { key: 'aiPaybackTurns', label: 'AI max payback (turns)', default: 20, min: 3, max: 80, step: 1, format: 'number',
          help: 'AI only builds when it expects to earn the cost back within this many turns.' },
        { key: 'aiCashReserve', label: 'AI cash reserve', default: 5e6, min: 0, max: 50e6, step: 1e6, format: 'currency',
          help: 'Cash the AI keeps aside and never spends on construction.' },
        { key: 'aiActionsPerTurn', label: 'AI actions per turn', default: 2, min: 0, max: 5, step: 1, format: 'number',
          help: 'How many builds/changes each AI may make per turn. 0 freezes the AIs.' }
      ]
    }
  ];

  const DEFAULT_CONFIG = {};
  const PARAM_INDEX = {}; // key → param meta (with group id)
  for (const group of CONFIG_SCHEMA) {
    for (const p of group.params) {
      DEFAULT_CONFIG[p.key] = p.default;
      PARAM_INDEX[p.key] = Object.assign({ group: group.id }, p);
    }
  }

  const STORAGE_KEY = 'ogt.config.v1';

  // ConfigStore: `edited` = what the sliders show (persisted), `active` = what the
  // running simulation uses. Non-requiresNewGame edits copy edited→active at the
  // top of each turn resolution; requiresNewGame params only copy on new game.
  class ConfigStore {
    constructor() {
      this.edited = Object.assign({}, DEFAULT_CONFIG);
      this.active = Object.assign({}, DEFAULT_CONFIG);
      this._storage = (typeof localStorage !== 'undefined') ? localStorage : null;
      this.load();
    }

    validate(key, value) {
      const p = PARAM_INDEX[key];
      if (!p) return null;
      let v = Number(value);
      if (!isFinite(v)) return p.default;
      v = Util.clamp(v, p.min, p.max);
      // snap to step grid anchored at min
      v = p.min + Math.round((v - p.min) / p.step) * p.step;
      // kill float dust (0.30000000000000004)
      const decimals = (String(p.step).split('.')[1] || '').length;
      return Number(v.toFixed(decimals));
    }

    set(key, value) {
      const v = this.validate(key, value);
      if (v === null) return;
      this.edited[key] = v;
      this.save();
    }

    reset(key) { this.set(key, DEFAULT_CONFIG[key]); }

    resetAll() {
      this.edited = Object.assign({}, DEFAULT_CONFIG);
      this.save();
    }

    // Copy live-tunable (non-requiresNewGame) edits into the active config.
    applyLive() {
      for (const key of Object.keys(this.edited)) {
        if (!PARAM_INDEX[key].requiresNewGame) this.active[key] = this.edited[key];
      }
    }

    // Copy everything (used when starting a new game).
    applyAll() {
      this.active = Object.assign({}, this.edited);
    }

    // True if any requiresNewGame param differs between edited and active.
    needsNewGame() {
      return Object.keys(this.edited).some(
        (k) => PARAM_INDEX[k].requiresNewGame && this.edited[k] !== this.active[k]
      );
    }

    exportJSON() { return JSON.stringify(this.edited, null, 2); }

    // Returns {applied, ignored} counts.
    importJSON(text) {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return { error: 'Invalid JSON' }; }
      if (!obj || typeof obj !== 'object') return { error: 'Invalid JSON' };
      let applied = 0, ignored = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (PARAM_INDEX[k] !== undefined) { this.edited[k] = this.validate(k, v); applied++; }
        else ignored++;
      }
      this.save();
      return { applied, ignored };
    }

    save() {
      if (this._storage) {
        try { this._storage.setItem(STORAGE_KEY, JSON.stringify(this.edited)); } catch (e) { /* quota/denied */ }
      }
    }

    load() {
      if (!this._storage) return;
      try {
        const raw = this._storage.getItem(STORAGE_KEY);
        if (raw) this.importJSON(raw);
      } catch (e) { /* corrupt store: keep defaults */ }
      this.active = Object.assign({}, this.edited);
    }
  }

  const Config = { CONFIG_SCHEMA, DEFAULT_CONFIG, PARAM_INDEX, ConfigStore, STORAGE_KEY };
  global.Config = Config;
  if (typeof module !== 'undefined' && module.exports) module.exports = Config;
})(typeof globalThis !== 'undefined' ? globalThis : window);
