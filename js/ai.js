// ai.js — heuristic AI opponents. Each AI takes at most config.aiActionsPerTurn
// actions per turn, in priority order: adjust fees (free) → drill wells →
// build/upgrade refineries → lay pipelines along its busiest truck route.
// All estimates reuse the shared RouteCache, so the same scoring powers the
// "suggested moves" onboarding hints for the human player.
(function (global) {
  'use strict';

  const { wellOpCost, refineryCapacity, actions } = global.GameState;

  let cache = null, cacheFor = null;
  function routes(state) {
    if (cacheFor !== state) { cache = new global.Pathfinding.RouteCache(state); cacheFor = state; }
    return cache;
  }

  // Estimated sale price at a demand node: last observed local price, else parity, else reference.
  function estPrice(node, config) {
    if (node.lastLocalPrice !== null) return node.lastLocalPrice;
    if (node.importParity !== null) return node.importParity;
    return config.referencePrice;
  }

  // Top demand nodes by base demand (bounded, for cheap scoring loops).
  function topDemandNodes(state, count) {
    return state.nodes
      .filter((n) => n.demandBase > 0)
      .sort((a, b) => b.demandBase - a.demandBase)
      .slice(0, count);
  }

  // Score building a well at production node w for `player`.
  // Considers routing through each existing refinery, or building a refinery
  // on the spot if none is reachable/available (comboCost covers both builds).
  // Returns { margin, perTurn, payback, comboRefinery } or null.
  function scoreWellSite(state, player, w, config) {
    const rc = routes(state);
    const dw = rc.get(w.id);
    const op = wellOpCost(w, config);
    const demand = topDemandNodes(state, 25);
    let best = null;

    const evalChain = (crudeLeg, refFee, refNodeId, comboRefinery) => {
      const dr = rc.get(refNodeId);
      for (const d of demand) {
        const cost = op + crudeLeg + config.refineryOpCost + refFee + dr.dist[d.id];
        const margin = estPrice(d, config) - cost;
        if (margin <= 0) continue;
        const perTurn = margin * Math.min(w.prodCapacity, d.demandBase);
        if (!best || perTurn > best.perTurn) best = { margin, perTurn, comboRefinery };
      }
    };

    for (const r of state.nodes) {
      if (!r.refinery) continue;
      const cap = refineryCapacity(r.refinery, config);
      if (r.refinery.usedThisTurn >= cap * 0.98) continue; // already saturated
      if (!isFinite(dw.dist[r.id])) continue;
      evalChain(dw.dist[r.id], r.refinery.fee, r.id, false);
    }
    // hypothetical refinery at the wellhead
    evalChain(0, config.refineryDefaultFee, w.id, true);

    if (!best) return null;
    const cost = config.wellBuildCost + (best.comboRefinery ? config.refineryBuildCost : 0);
    best.payback = cost / Math.max(1, best.perTurn);
    best.cost = cost;
    return best;
  }

  function takeActions(state, player) {
    const config = state.configStore.active;
    let budget = config.aiActionsPerTurn;
    if (budget <= 0) return;
    const reserve = config.aiCashReserve;
    const canAfford = (cost) => player.cash - cost >= reserve;

    // --- 0. fee upkeep (free, doesn't consume actions) ---
    for (const e of state.edges) {
      if (e.pipeline && e.pipeline.owner === player.id) {
        e.pipeline.fee = Math.min(e.pipeline.fee, 0.8 * config.truckCostPerEdge);
      }
    }
    for (const n of state.nodes) {
      if (n.refinery && n.refinery.owner === player.id) {
        const cap = refineryCapacity(n.refinery, config);
        const util = cap > 0 ? n.refinery.usedThisTurn / cap : 0;
        if (util > 0.95) n.refinery.fee *= 1.1;
        else if (util < 0.5) n.refinery.fee = Math.max(config.refineryDefaultFee * 0.5, n.refinery.fee * 0.9);
      }
    }

    // --- 1. drill the best well available ---
    while (budget > 0) {
      let bestSite = null;
      for (const w of state.nodes) {
        if (w.type !== 'production' || w.well) continue;
        if (!canAfford(config.wellBuildCost)) break;
        const s = scoreWellSite(state, player, w, config);
        if (!s || s.payback > config.aiPaybackTurns) continue;
        if (!canAfford(s.cost)) continue;
        if (!bestSite || s.payback < bestSite.score.payback) bestSite = { node: w, score: s };
      }
      if (!bestSite) break;
      const res = actions.buildWell(state, player.id, bestSite.node.id);
      if (!res.ok) break;
      budget--;
      if (bestSite.score.comboRefinery && budget > 0 && canAfford(config.refineryBuildCost)) {
        if (actions.buildRefinery(state, player.id, bestSite.node.id).ok) budget--;
      }
      break; // at most one well per turn keeps AIs watchable
    }

    // --- 2. refinery upgrades when running hot ---
    if (budget > 0) {
      for (const n of state.nodes) {
        if (!n.refinery || n.refinery.owner !== player.id) continue;
        const cap = refineryCapacity(n.refinery, config);
        const cost = global.GameState.upgradeCost(config);
        if (n.refinery.usedThisTurn >= 0.95 * cap && canAfford(cost)) {
          if (actions.upgradeRefinery(state, player.id, n.id).ok) { budget--; break; }
        }
      }
    }

    // --- 3. pipelines along busy owned routes (crude leg and refined leg) ---
    if (budget > 0) {
      const rc = routes(state);
      let bestPlan = null;
      const consider = (fromId, flow) => {
        if (flow <= 0) return;
        const dv = rc.get(fromId);
        // crude leg target: nearest refinery; refined leg target: best nearby market
        const targets = [];
        let nearRef = null;
        for (const r of state.nodes) {
          if (r.refinery && r.id !== fromId && isFinite(dv.dist[r.id]) && (!nearRef || dv.dist[r.id] < dv.dist[nearRef.id])) nearRef = r;
        }
        if (nearRef) targets.push(nearRef.id);
        let bestMarket = null, bestScore = 0;
        for (const d of topDemandNodes(state, 12)) {
          if (d.id === fromId || !isFinite(dv.dist[d.id]) || dv.dist[d.id] <= 0) continue;
          const score = Math.min(flow, d.demandBase) / dv.dist[d.id];
          if (score > bestScore) { bestScore = score; bestMarket = d; }
        }
        if (bestMarket) targets.push(bestMarket.id);

        for (const target of targets) {
          const path = global.Pathfinding.pathEdges(state, dv, fromId, target);
          if (!path) continue;
          const openEdges = path.filter((eid) => !state.edges[eid].pipeline);
          if (openEdges.length === 0) continue;
          const buildCost = openEdges.length * config.pipelineCostPerEdge;
          const shipped = Math.min(flow, config.pipelineCapacity);
          const savingPerTurn = shipped * (config.truckCostPerEdge - config.pipelineDefaultFee) * openEdges.length;
          if (savingPerTurn <= 0) continue;
          const payback = buildCost / savingPerTurn;
          if (payback > config.aiPaybackTurns || !canAfford(buildCost)) continue;
          if (!bestPlan || payback < bestPlan.payback) bestPlan = { edges: path, payback };
        }
      };
      for (const w of state.nodes) {
        if (w.well && w.well.owner === player.id) consider(w.id, w.well.producedThisTurn || 0);
      }
      for (const r of state.nodes) {
        if (r.refinery && r.refinery.owner === player.id) consider(r.id, r.refinery.usedThisTurn || 0);
      }
      if (bestPlan) {
        if (actions.buildPipeline(state, player.id, bestPlan.edges).ok) budget--;
      }
    }
  }

  const AI = { takeActions, scoreWellSite, topDemandNodes, estPrice };
  global.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
