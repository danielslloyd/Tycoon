// turnEngine.js — orchestrates one turn: live-apply tuning → AI actions →
// world price walk → market clearing → cash settlement → demand growth →
// history. Also hosts the invariant checker shared by the headless harness
// and the in-browser debug API.
(function (global) {
  'use strict';

  const { clamp, RandomUtils } = global.Util;

  function sumValues(obj) {
    let s = 0;
    for (const v of Object.values(obj)) s += v;
    return s;
  }

  function resolveTurn(state) {
    if (state.gameOver) return null;
    const configStore = state.configStore;
    configStore.applyLive();
    const config = configStore.active;
    const rng = state.econRng;

    // ensure P&L objects exist (human capex since last turn may already be booked)
    for (const p of state.players) {
      if (!p.revenue) p.revenue = global.GameState.emptyRevenue();
      if (!p.costs) p.costs = global.GameState.emptyCosts();
    }

    // AI action phase
    if (global.AI) {
      for (const p of state.players) {
        if (p.isAI) global.AI.takeActions(state, p);
      }
    }

    // world price random walk
    state.globalPrice = clamp(
      RandomUtils.randomWalk(rng, state.globalPrice, config.priceVolatility),
      config.priceMin, config.priceMax
    );

    // market clearing
    global.Market.clearMarket(state, config, rng);

    // cash settlement: capex cash was deducted at build time, so exclude it here
    const totalDemandSatisfied = state.totals.demandSatisfied;
    for (const p of state.players) {
      const revenue = sumValues(p.revenue);
      const costs = sumValues(p.costs);
      const profit = revenue - costs;
      p.profitThisTurn = profit;
      p.cash += revenue - (costs - p.costs.capex);
      p.cumulativeProfit += profit;
      p.marketShare = totalDemandSatisfied > 0 ? p.barrelsSoldThisTurn / totalDemandSatisfied : 0;
      p.history.push({
        turn: state.turn,
        cash: p.cash,
        profit,
        cumulativeProfit: p.cumulativeProfit,
        revenue: Object.assign({}, p.revenue),
        costs: Object.assign({}, p.costs),
        barrelsSold: p.barrelsSoldThisTurn,
        marketShare: p.marketShare
      });
    }
    state.priceHistory.push(state.globalPrice);

    if (state.debugChecks) {
      const problems = verifyInvariants(state);
      if (problems.length) throw new Error('Invariant violations on turn ' + state.turn + ':\n' + problems.join('\n'));
    }

    // demand growth
    for (const n of state.nodes) {
      if (n.demandBase > 0) n.demandBase *= 1 + n.demandGrowth;
    }

    // fresh P&L for the next action phase (human builds land in next turn's books)
    for (const p of state.players) {
      p.revenue = global.GameState.emptyRevenue();
      p.costs = global.GameState.emptyCosts();
    }

    state.turn++;
    if (state.turn > config.gameLength) state.gameOver = true;
    return state.totals;
  }

  function getWinner(state) {
    return state.players.reduce((best, p) => (p.cumulativeProfit > best.cumulativeProfit ? p : best), state.players[0]);
  }

  // Returns a list of human-readable problem strings (empty = all good).
  // Must run after clearMarket and before P&L reset (debugChecks does this),
  // or standalone right after resolveTurn for the money checks only.
  function verifyInvariants(state) {
    const config = state.configStore.active;
    const problems = [];
    const t = state.totals;

    // 1. numeric sanity
    if (!isFinite(state.globalPrice)) problems.push('globalPrice is not finite');
    for (const p of state.players) {
      if (!isFinite(p.cash)) problems.push(`${p.name}: cash is not finite`);
      if (!isFinite(p.cumulativeProfit)) problems.push(`${p.name}: cumulativeProfit is not finite`);
    }
    for (const [k, v] of Object.entries(t)) {
      if (!isFinite(v) || v < -1e-3) problems.push(`totals.${k} = ${v}`);
    }

    // 2. cash ledger: cash − startingCapital should equal cumulative profit
    for (const p of state.players) {
      const pending = sumValues(p.revenue) - sumValues(p.costs); // this turn, already applied
      const drift = Math.abs(p.cash - config.startingCapital - p.cumulativeProfit);
      if (drift > 1) problems.push(`${p.name}: cash drift $${drift.toFixed(2)} vs cumulative profit (pending=${pending.toFixed(2)})`);
    }

    // 3. capacities
    for (const e of state.edges) {
      if (e.pipeline && e.pipeFlow > config.pipelineCapacity + 1e-3) {
        problems.push(`edge ${e.id}: pipeline flow ${e.pipeFlow.toFixed(1)} > capacity ${config.pipelineCapacity}`);
      }
    }
    for (const n of state.nodes) {
      if (n.well && n.well.producedThisTurn > n.prodCapacity + 1e-3) {
        problems.push(`node ${n.id}: well produced ${n.well.producedThisTurn.toFixed(1)} > capacity ${n.prodCapacity}`);
      }
      if (n.refinery) {
        const cap = global.GameState.refineryCapacity(n.refinery, config);
        if (n.refinery.usedThisTurn > cap + 1e-3) {
          problems.push(`node ${n.id}: refinery used ${n.refinery.usedThisTurn.toFixed(1)} > capacity ${cap}`);
        }
      }
      if (n.storage && (n.storage.stock < -1e-3 || n.storage.stock > n.storage.capacity + 1e-3)) {
        problems.push(`node ${n.id}: storage stock ${n.storage.stock.toFixed(1)} out of [0, ${n.storage.capacity}]`);
      }
    }

    // 4. barrel conservation:
    //    production + imports + storageOut === demandSatisfied + exports + storageIn
    let demandSatisfied = 0, unmet = 0;
    for (const n of state.nodes) {
      if (n.suppliedBy) {
        const supplied = n.suppliedBy.players + n.suppliedBy.imports + n.suppliedBy.storage;
        demandSatisfied += supplied;
        if (supplied > n.demandThisTurn + 1e-3) {
          problems.push(`node ${n.id}: supplied ${supplied.toFixed(1)} > demand ${n.demandThisTurn.toFixed(1)}`);
        }
        unmet += Math.max(0, n.demandThisTurn - supplied);
      }
    }
    const lhs = t.production + t.imports + t.storageOut;
    const rhs = demandSatisfied + t.exports + t.storageIn;
    if (Math.abs(lhs - rhs) > 1) problems.push(`barrel conservation: sources ${lhs.toFixed(1)} ≠ sinks ${rhs.toFixed(1)}`);
    if (unmet > 1) problems.push(`unmet demand ${unmet.toFixed(1)} bbl (imports should always fill)`);

    // 5. local prices never exceed import parity
    for (const n of state.nodes) {
      if (n.localPrice !== null && n.importParity !== null && n.localPrice > n.importParity + 1e-6) {
        problems.push(`node ${n.id}: local price ${n.localPrice.toFixed(2)} > import parity ${n.importParity.toFixed(2)}`);
      }
    }

    return problems;
  }

  const TurnEngine = { resolveTurn, verifyInvariants, getWinner };
  global.TurnEngine = TurnEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = TurnEngine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
