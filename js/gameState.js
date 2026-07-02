// gameState.js — game creation, player factories, and validated build/fee actions.
// All mutation of player assets goes through GameActions so cash/validation
// rules live in one place. Derived values (op costs, capacities) are computed
// from the live config so tuning sliders affect existing assets next turn.
(function (global) {
  'use strict';

  const { mulberry32 } = global.Util;

  // CVD-safe categorical palette (validated: lightness band, chroma, ΔE, contrast)
  const PLAYER_COLORS = ['#e34948', '#2a78d6', '#eb6834', '#4a3aa7'];
  const AI_NAMES = ['Petrova Corp', 'Blackgold Ltd', 'Crescent Energy'];

  function makePlayer(id, name, color, isAI, cash) {
    return {
      id, name, color, isAI,
      cash,
      cumulativeProfit: 0,
      profitThisTurn: 0,
      barrelsSoldThisTurn: 0,
      marketShare: 0,
      // itemized per-turn P&L (rebuilt each resolution)
      revenue: null,   // { sales, exportSales, pipeTolls, refineryFees, storageSales }
      costs: null,     // { wellOps, refiningPaid, transport, pipeTollsPaid, terminalFees, storagePurchases, capex }
      history: []      // { turn, cash, profit, cumulativeProfit, barrelsSold, marketShare }
    };
  }

  function createGame(configStore, seed) {
    const config = configStore.active;
    const mapRng = mulberry32(seed);
    const econRng = mulberry32(seed ^ 0x9e3779b9);

    const map = global.MapGenerator.generateMap(config, mapRng);

    const players = [makePlayer(0, 'You', PLAYER_COLORS[0], false, config.startingCapital)];
    for (let i = 0; i < config.numAIOpponents; i++) {
      players.push(makePlayer(i + 1, AI_NAMES[i], PLAYER_COLORS[i + 1], true, config.startingCapital));
    }

    const state = {
      seed,
      turn: 1,
      gameOver: false,
      globalPrice: config.initialGlobalPrice,
      priceHistory: [config.initialGlobalPrice],
      players,
      nodes: map.nodes,
      edges: map.edges,
      mapWidth: map.width,
      mapHeight: map.height,
      econRng,
      configStore,
      // per-turn aggregates for the market panel
      totals: { production: 0, demand: 0, imports: 0, exports: 0, storageIn: 0, storageOut: 0 },
      routeVersion: 0,  // bumped on any build/fee change → invalidates UI route caches
      log: []           // recent events for toasts/history
    };
    return state;
  }

  // ---- Derived values (live-tunable via config) ----

  function wellOpCost(node, config) {
    return config.wellOpCostMax - node.quality * (config.wellOpCostMax - config.wellOpCostMin);
  }

  function refineryCapacity(refinery, config) {
    return config.refineryBaseCapacity * Math.pow(2, refinery.level - 1);
  }

  function upgradeCost(config) {
    return config.refineryBuildCost * config.refineryUpgradeMult;
  }

  // ---- Actions (return {ok} or {ok:false, reason}) ----

  // Deducts cash immediately; the expense hits this turn's P&L via costs.capex
  // (cumulativeProfit is updated once per turn by the turn engine).
  function spend(state, player, amount) {
    player.cash -= amount;
    if (!player.costs) player.costs = emptyCosts();
    player.costs.capex += amount;
  }

  function emptyCosts() {
    return { wellOps: 0, refiningPaid: 0, transport: 0, pipeTollsPaid: 0, terminalFees: 0, storagePurchases: 0, capex: 0 };
  }
  function emptyRevenue() {
    return { sales: 0, exportSales: 0, pipeTolls: 0, refineryFees: 0, storageSales: 0 };
  }

  function buildWell(state, playerId, nodeId) {
    const config = state.configStore.active;
    const player = state.players[playerId];
    const node = state.nodes[nodeId];
    if (!node || node.type !== 'production') return { ok: false, reason: 'Not an oil field' };
    if (node.well) return { ok: false, reason: 'A well is already drilled here' };
    if (player.cash < config.wellBuildCost) return { ok: false, reason: 'Not enough cash' };
    spend(state, player, config.wellBuildCost);
    node.well = { owner: playerId };
    state.routeVersion++;
    return { ok: true };
  }

  function buildRefinery(state, playerId, nodeId) {
    const config = state.configStore.active;
    const player = state.players[playerId];
    const node = state.nodes[nodeId];
    if (!node || node.type === 'terminal') return { ok: false, reason: 'Cannot build at a terminal' };
    if (node.refinery) return { ok: false, reason: 'A refinery already exists here' };
    if (player.cash < config.refineryBuildCost) return { ok: false, reason: 'Not enough cash' };
    spend(state, player, config.refineryBuildCost);
    node.refinery = { owner: playerId, level: 1, fee: config.refineryDefaultFee, usedThisTurn: 0 };
    state.routeVersion++;
    return { ok: true };
  }

  function upgradeRefinery(state, playerId, nodeId) {
    const config = state.configStore.active;
    const player = state.players[playerId];
    const node = state.nodes[nodeId];
    if (!node || !node.refinery) return { ok: false, reason: 'No refinery here' };
    if (node.refinery.owner !== playerId) return { ok: false, reason: 'Not your refinery' };
    const cost = upgradeCost(config);
    if (player.cash < cost) return { ok: false, reason: 'Not enough cash' };
    spend(state, player, cost);
    node.refinery.level++;
    state.routeVersion++;
    return { ok: true };
  }

  // edgeIds: one edge or a whole route (route-builder). All-or-nothing.
  function buildPipeline(state, playerId, edgeIds) {
    const config = state.configStore.active;
    const player = state.players[playerId];
    const toBuild = [];
    for (const eid of edgeIds) {
      const e = state.edges[eid];
      if (!e) return { ok: false, reason: 'Bad edge' };
      if (!e.pipeline) toBuild.push(e);
    }
    if (toBuild.length === 0) return { ok: false, reason: 'Pipeline already exists here' };
    const cost = toBuild.length * config.pipelineCostPerEdge;
    if (player.cash < cost) return { ok: false, reason: 'Not enough cash' };
    spend(state, player, cost);
    for (const e of toBuild) e.pipeline = { owner: playerId, fee: config.pipelineDefaultFee };
    state.routeVersion++;
    return { ok: true, built: toBuild.length, cost };
  }

  function buildStorage(state, playerId, nodeId, capacity) {
    const config = state.configStore.active;
    const player = state.players[playerId];
    const node = state.nodes[nodeId];
    if (!node || node.type === 'terminal') return { ok: false, reason: 'Cannot build at a terminal' };
    if (node.storage && node.storage.owner !== playerId) return { ok: false, reason: 'Another company owns tanks here' };
    const cost = capacity * config.storageCostPerBarrel;
    if (player.cash < cost) return { ok: false, reason: 'Not enough cash' };
    spend(state, player, cost);
    if (node.storage) node.storage.capacity += capacity;
    else node.storage = { owner: playerId, capacity, stock: 0, costBasis: 0 };
    return { ok: true };
  }

  function setPipelineFee(state, playerId, edgeId, fee) {
    const e = state.edges[edgeId];
    if (!e || !e.pipeline) return { ok: false, reason: 'No pipeline here' };
    if (e.pipeline.owner !== playerId) return { ok: false, reason: 'Not your pipeline' };
    e.pipeline.fee = Math.max(0, fee);
    state.routeVersion++;
    return { ok: true };
  }

  function setRefineryFee(state, playerId, nodeId, fee) {
    const n = state.nodes[nodeId];
    if (!n || !n.refinery) return { ok: false, reason: 'No refinery here' };
    if (n.refinery.owner !== playerId) return { ok: false, reason: 'Not your refinery' };
    n.refinery.fee = Math.max(0, fee);
    state.routeVersion++;
    return { ok: true };
  }

  const GameState = {
    createGame, makePlayer, PLAYER_COLORS,
    wellOpCost, refineryCapacity, upgradeCost,
    emptyCosts, emptyRevenue,
    actions: { buildWell, buildRefinery, upgradeRefinery, buildPipeline, buildStorage, setPipelineFee, setRefineryFee }
  };
  global.GameState = GameState;
  if (typeof module !== 'undefined' && module.exports) module.exports = GameState;
})(typeof globalThis !== 'undefined' ? globalThis : window);
