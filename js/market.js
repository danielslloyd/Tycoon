// market.js — capacity-constrained market clearing. Pure simulation, no DOM.
//
// Model summary:
// - Posted tariffs: every barrel pays the posted pipeline toll and refinery
//   (operating cost + fee), no matter who ships it. Payments to yourself cancel.
// - Merchants: the well owner owns the barrel end-to-end — collects the sale,
//   pays pumping, transport, tolls and refining. Storage owners are merchants
//   for barrels released from their tanks. Imports are handled by the world
//   market (NPC) but still pay pipeline tolls to pipe owners.
// - Clearing: offers (well→refinery→demand chains, imports, storage releases)
//   are sorted by delivered cost and filled cheapest-first against well,
//   refinery and pipeline capacities. Saturated pipes freeze; the next round
//   reprices them at the truck/rail fallback so overflow visibly moves by road.
// - Local price at each demand node = cost of the most expensive offer used
//   there (uniform clearing price). Imports are unlimited, so the local price
//   never exceeds import parity.
(function (global) {
  'use strict';

  const { clamp, RandomUtils } = global.Util;
  const { makeWeightFn, edgeMode, dijkstra, pathEdges } = global.Pathfinding;
  const { wellOpCost, refineryCapacity } = global.GameState;

  const EPS = 1e-6;
  const MAX_ROUNDS = 3;

  function clearMarket(state, config, rng) {
    // --- reset per-turn results ---
    for (const e of state.edges) {
      e.flowCrude = 0; e.flowRefined = 0; e.pipeFlow = 0; e.congested = false;
    }
    for (const n of state.nodes) {
      n.demandThisTurn = 0; n.localPrice = null; n.importParity = null;
      n.breakdown = null; n.suppliedBy = null;
      if (n.refinery) n.refinery.usedThisTurn = 0;
      if (n.well) n.well.producedThisTurn = 0;
    }
    for (const p of state.players) {
      if (!p.revenue) p.revenue = global.GameState.emptyRevenue();
      if (!p.costs) p.costs = global.GameState.emptyCosts();
      p.barrelsSoldThisTurn = 0;
    }

    // --- demand with lagged elasticity + jitter ---
    const demandNodes = [];
    for (const n of state.nodes) {
      if (n.demandBase <= 0) continue;
      const anchor = n.lastLocalPrice !== null ? Math.max(1, n.lastLocalPrice) : config.referencePrice;
      let q = n.demandBase * Math.pow(config.referencePrice / anchor, config.demandElasticity);
      if (config.demandJitter > 0) q *= Math.max(0.2, 1 + RandomUtils.normal(rng, 0, config.demandJitter));
      n.demandThisTurn = q;
      n.suppliedBy = { players: 0, imports: 0, storage: 0 };
      demandNodes.push(n);
    }

    // --- capacity ledgers ---
    const wells = state.nodes.filter((n) => n.well);
    const refineries = state.nodes.filter((n) => n.refinery);
    const terminals = state.nodes.filter((n) => n.type === 'terminal');
    const storages = state.nodes.filter((n) => n.storage);

    const wellRem = new Map(wells.map((n) => [n.id, n.prodCapacity]));
    const refRem = new Map(refineries.map((n) => [n.id, refineryCapacity(n.refinery, config)]));
    const pipeRem = new Map();
    for (const e of state.edges) if (e.pipeline) pipeRem.set(e.id, config.pipelineCapacity);
    const demandRem = new Map(demandNodes.map((n) => [n.id, n.demandThisTurn]));

    const frozen = new Set();       // saturated pipeline edge ids
    const accepted = [];            // flow records, settled after prices are known
    const acceptedByNode = new Map(); // demand node id → max accepted unit cost + breakdown

    // Truck/rail-only routing from terminals: imports can ALWAYS move by road,
    // consuming no pipeline capacity. This is the hard price ceiling everywhere
    // (import parity), guaranteed available in every round.
    const frozenAll = new Set(state.edges.filter((e) => e.pipeline).map((e) => e.id));
    const truckWeightFn = makeWeightFn(state, config, frozenAll);
    const truckDij = new Map(terminals.map((t) => [t.id, dijkstra(state, t.id, truckWeightFn)]));
    for (const d of demandNodes) {
      let parity = Infinity;
      for (const t of terminals) {
        parity = Math.min(parity, state.globalPrice + config.terminalFee + truckDij.get(t.id).dist[d.id]);
      }
      d.importParity = parity;
    }

    // Shared allocator helpers ------------------------------------------------

    // Bottleneck capacity of pipeline-mode edges across one or more path legs.
    // Counts multiplicity: if both legs cross the same pipe edge, each barrel
    // consumes that edge's capacity twice.
    function pipeBottleneck(paths, config, frozenSet) {
      const counts = new Map();
      for (const path of paths) {
        if (!path) continue;
        for (const eid of path) {
          const e = state.edges[eid];
          if (edgeMode(e, config, frozenSet) === 'pipeline') {
            counts.set(eid, (counts.get(eid) || 0) + 1);
          }
        }
      }
      let cap = Infinity;
      for (const [eid, c] of counts) cap = Math.min(cap, (pipeRem.get(eid) || 0) / c);
      return cap;
    }

    // Commit qty barrels along a path; splits money into truck/rail vs tolls.
    // Returns { truckRail, tolls: [{owner, amount}] } per barrel × qty accounted.
    function commitPath(path, qty, product, frozenSet) {
      let truckRail = 0;
      const tolls = [];
      for (const eid of path) {
        const e = state.edges[eid];
        const mode = edgeMode(e, config, frozenSet);
        if (product === 'crude') e.flowCrude += qty; else e.flowRefined += qty;
        if (mode === 'pipeline') {
          e.pipeFlow += qty;
          pipeRem.set(eid, (pipeRem.get(eid) || 0) - qty);
          if ((pipeRem.get(eid) || 0) <= EPS) frozen.add(eid);
          tolls.push({ owner: e.pipeline.owner, amount: qty * e.pipeline.fee });
        } else if (mode === 'truck') {
          truckRail += qty * config.truckCostPerEdge;
        } else {
          truckRail += qty * config.railCostPerEdge;
        }
      }
      return { truckRail, tolls };
    }

    // --- demand clearing in congestion rounds ---
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const frozenSet = round === MAX_ROUNDS
        ? new Set(state.edges.filter((e) => e.pipeline).map((e) => e.id)) // final round: pure truck/rail
        : new Set(frozen);
      const weightFn = makeWeightFn(state, config, frozenSet);

      // Dijkstra from every active source
      const dij = new Map();
      const need = (id) => {
        if (!dij.has(id)) dij.set(id, dijkstra(state, id, weightFn));
        return dij.get(id);
      };

      // Offer enumeration
      const offers = [];
      for (const w of wells) {
        if ((wellRem.get(w.id) || 0) <= EPS) continue;
        const dw = need(w.id);
        const op = wellOpCost(w, config);
        for (const r of refineries) {
          if ((refRem.get(r.id) || 0) <= EPS) continue;
          const toRef = dw.dist[r.id];
          if (!isFinite(toRef)) continue;
          const dr = need(r.id);
          const refCost = config.refineryOpCost + r.refinery.fee;
          for (const d of demandNodes) {
            if ((demandRem.get(d.id) || 0) <= EPS) continue;
            const toDem = dr.dist[d.id];
            if (!isFinite(toDem)) continue;
            offers.push({ kind: 'well', cost: op + toRef + refCost + toDem, w, r, d });
          }
        }
      }
      for (const t of terminals) {
        const dt = need(t.id);
        const dtTruck = truckDij.get(t.id);
        for (const d of demandNodes) {
          if ((demandRem.get(d.id) || 0) <= EPS) continue;
          const cost = state.globalPrice + config.terminalFee + dt.dist[d.id];
          offers.push({ kind: 'import', cost, t, d, viaPipes: true });
          // truck/rail fallback offer: pricier but can never be blocked
          const truckCost = state.globalPrice + config.terminalFee + dtTruck.dist[d.id];
          if (truckCost > cost + EPS) offers.push({ kind: 'import', cost: truckCost, t, d, viaPipes: false });
        }
      }
      for (const s of storages) {
        if (s.storage.stock <= EPS) continue;
        const ds = need(s.id);
        const floor = s.storage.costBasis * (1 + config.storageMinMargin);
        for (const d of demandNodes) {
          if ((demandRem.get(d.id) || 0) <= EPS) continue;
          offers.push({ kind: 'storage', cost: floor + ds.dist[d.id], s, d });
        }
      }

      offers.sort((a, b) => a.cost - b.cost);

      // Greedy fill
      for (const o of offers) {
        let qty = demandRem.get(o.d.id) || 0;
        if (qty <= EPS) continue;
        if (o.kind === 'well') {
          qty = Math.min(qty, wellRem.get(o.w.id) || 0, refRem.get(o.r.id) || 0);
        } else if (o.kind === 'storage') {
          qty = Math.min(qty, o.s.storage.stock);
        }
        if (qty <= EPS) continue;

        // reconstruct path(s) and apply pipeline bottleneck
        let pathA = null, pathB = null;
        let fz = frozenSet; // frozen set governing edge modes for this offer's paths
        if (o.kind === 'well') {
          pathA = pathEdges(state, dij.get(o.w.id), o.w.id, o.r.id);
          pathB = pathEdges(state, dij.get(o.r.id), o.r.id, o.d.id);
          qty = Math.min(qty, pipeBottleneck([pathA, pathB], config, fz));
        } else if (o.kind === 'import') {
          if (o.viaPipes) {
            pathB = pathEdges(state, dij.get(o.t.id), o.t.id, o.d.id);
          } else {
            fz = frozenAll; // road-only fallback: ignores pipes, consumes no pipe capacity
            pathB = pathEdges(state, truckDij.get(o.t.id), o.t.id, o.d.id);
          }
          qty = Math.min(qty, pipeBottleneck([pathB], config, fz));
        } else {
          pathB = pathEdges(state, dij.get(o.s.id), o.s.id, o.d.id);
          qty = Math.min(qty, pipeBottleneck([pathB], config, fz));
        }
        if (qty <= EPS) continue; // blocked by a saturated pipe; may clear next round

        // commit
        demandRem.set(o.d.id, (demandRem.get(o.d.id) || 0) - qty);
        const rec = { kind: o.kind, qty, d: o.d, unitCost: o.cost, truckRail: 0, tolls: [] };
        if (o.kind === 'well') {
          wellRem.set(o.w.id, wellRem.get(o.w.id) - qty);
          refRem.set(o.r.id, refRem.get(o.r.id) - qty);
          o.w.well.producedThisTurn += qty;
          o.r.refinery.usedThisTurn += qty;
          const cA = commitPath(pathA, qty, 'crude', frozenSet);
          const cB = commitPath(pathB, qty, 'refined', frozenSet);
          rec.truckRail = cA.truckRail + cB.truckRail;
          rec.tolls = cA.tolls.concat(cB.tolls);
          rec.w = o.w; rec.r = o.r;
          rec.parts = {
            wellOp: wellOpCost(o.w, config),
            transportA: dij.get(o.w.id).dist[o.r.id],
            refOp: config.refineryOpCost, refFee: o.r.refinery.fee,
            transportB: dij.get(o.r.id).dist[o.d.id]
          };
        } else if (o.kind === 'import') {
          const cB = commitPath(pathB, qty, 'refined', fz);
          rec.truckRail = cB.truckRail; rec.tolls = cB.tolls;
          rec.t = o.t;
          const transB = o.viaPipes ? dij.get(o.t.id).dist[o.d.id] : truckDij.get(o.t.id).dist[o.d.id];
          rec.parts = { importBase: state.globalPrice, terminalFee: config.terminalFee, transportB: transB };
        } else {
          o.s.storage.stock -= qty;
          const cB = commitPath(pathB, qty, 'refined', frozenSet);
          rec.truckRail = cB.truckRail; rec.tolls = cB.tolls;
          rec.s = o.s;
          rec.parts = { storageBasis: o.s.storage.costBasis, margin: config.storageMinMargin, transportB: dij.get(o.s.id).dist[o.d.id] };
        }
        accepted.push(rec);
        const cur = acceptedByNode.get(o.d.id);
        if (!cur || o.cost > cur.unitCost) acceptedByNode.set(o.d.id, rec);
      }

      let unmet = 0;
      for (const q of demandRem.values()) unmet += q;
      if (unmet <= EPS * demandNodes.length) break;
    }

    // --- local prices (marginal accepted offer) & settlement of demand flows ---
    for (const n of demandNodes) {
      const marginal = acceptedByNode.get(n.id);
      if (marginal) {
        n.localPrice = marginal.unitCost;
        n.breakdown = { kind: marginal.kind, unitCost: marginal.unitCost, parts: marginal.parts };
      } else {
        n.localPrice = n.importParity; // zero demand this turn: display parity
      }
      if (n.localPrice !== null) n.lastLocalPrice = n.localPrice;
    }

    let totalImports = 0, totalProduction = 0, totalStorageOut = 0, totalPlayerSales = 0;
    for (const rec of accepted) {
      const price = rec.d.localPrice;
      const revenue = rec.qty * price;
      payTolls(state, rec.tolls);
      if (rec.kind === 'well') {
        const m = state.players[rec.w.well.owner];
        m.revenue.sales += revenue;
        m.costs.wellOps += rec.qty * rec.parts.wellOp;
        m.costs.transport += rec.truckRail;
        m.costs.pipeTollsPaid += sumTolls(rec.tolls);
        m.costs.refiningPaid += rec.qty * (config.refineryOpCost + rec.r.refinery.fee);
        state.players[rec.r.refinery.owner].revenue.refineryFees += rec.qty * rec.r.refinery.fee;
        m.barrelsSoldThisTurn += rec.qty;
        totalProduction += rec.qty;
        totalPlayerSales += rec.qty;
        rec.d.suppliedBy.players += rec.qty;
      } else if (rec.kind === 'import') {
        totalImports += rec.qty;
        rec.d.suppliedBy.imports += rec.qty;
      } else {
        const m = state.players[rec.s.storage.owner];
        m.revenue.storageSales += revenue;
        m.costs.transport += rec.truckRail;
        m.costs.pipeTollsPaid += sumTolls(rec.tolls);
        m.barrelsSoldThisTurn += rec.qty;
        totalStorageOut += rec.qty;
        rec.d.suppliedBy.storage += rec.qty;
      }
    }

    // --- exports: remaining well+refinery capacity sold to the world if profitable ---
    const exportPrice = state.globalPrice - config.terminalFee;
    let totalExports = 0;
    {
      const frozenSet = new Set(frozen);
      const weightFn = makeWeightFn(state, config, frozenSet);
      const dij = new Map();
      const need = (id) => {
        if (!dij.has(id)) dij.set(id, dijkstra(state, id, weightFn));
        return dij.get(id);
      };
      const exOffers = [];
      for (const w of wells) {
        if ((wellRem.get(w.id) || 0) <= EPS) continue;
        const dw = need(w.id);
        const op = wellOpCost(w, config);
        for (const r of refineries) {
          if ((refRem.get(r.id) || 0) <= EPS) continue;
          if (!isFinite(dw.dist[r.id])) continue;
          const dr = need(r.id);
          const refCost = config.refineryOpCost + r.refinery.fee;
          for (const t of terminals) {
            const cost = op + dw.dist[r.id] + refCost + dr.dist[t.id];
            const netback = exportPrice - cost;
            if (netback > EPS) exOffers.push({ netback, cost, w, r, t });
          }
        }
      }
      exOffers.sort((a, b) => b.netback - a.netback);
      for (const o of exOffers) {
        let qty = Math.min(wellRem.get(o.w.id) || 0, refRem.get(o.r.id) || 0);
        if (qty <= EPS) continue;
        const pathA = pathEdges(state, dij.get(o.w.id), o.w.id, o.r.id);
        const pathB = pathEdges(state, dij.get(o.r.id), o.r.id, o.t.id);
        qty = Math.min(qty, pipeBottleneck([pathA, pathB], config, frozenSet));
        if (qty <= EPS) continue;
        wellRem.set(o.w.id, wellRem.get(o.w.id) - qty);
        refRem.set(o.r.id, refRem.get(o.r.id) - qty);
        o.w.well.producedThisTurn += qty;
        o.r.refinery.usedThisTurn += qty;
        const cA = commitPath(pathA, qty, 'crude', frozenSet);
        const cB = commitPath(pathB, qty, 'refined', frozenSet);
        const m = state.players[o.w.well.owner];
        m.revenue.exportSales += qty * state.globalPrice;
        m.costs.terminalFees += qty * config.terminalFee;
        m.costs.wellOps += qty * wellOpCost(o.w, config);
        m.costs.transport += cA.truckRail + cB.truckRail;
        const tolls = cA.tolls.concat(cB.tolls);
        payTolls(state, tolls);
        m.costs.pipeTollsPaid += sumTolls(tolls);
        m.costs.refiningPaid += qty * (config.refineryOpCost + o.r.refinery.fee);
        state.players[o.r.refinery.owner].revenue.refineryFees += qty * o.r.refinery.fee;
        totalProduction += qty;
        totalExports += qty;
      }
    }

    // --- storage charging: tanks buy cheap fuel when the world price is low ---
    let totalStorageIn = 0;
    if (state.globalPrice < config.referencePrice * config.storageChargeThreshold) {
      const frozenSet = new Set(frozen);
      const weightFn = makeWeightFn(state, config, frozenSet);
      const dij = new Map();
      const need = (id) => {
        if (!dij.has(id)) dij.set(id, dijkstra(state, id, weightFn));
        return dij.get(id);
      };
      // conservative per-owner spending budget (current cash, ignoring this turn's revenue)
      const budget = new Map(state.players.map((p) => [p.id, Math.max(0, p.cash)]));
      for (const s of storages) {
        const st = s.storage;
        let space = st.capacity - st.stock;
        if (space <= EPS) continue;
        const owner = state.players[st.owner];
        // candidate supply chains: the owner's own wells (via any refinery) or imports
        const chains = [];
        for (const t of terminals) {
          const dt = need(t.id);
          chains.push({ kind: 'import', cost: state.globalPrice + config.terminalFee + dt.dist[s.id], t });
        }
        for (const w of wells) {
          if (w.well.owner !== st.owner) continue;
          if ((wellRem.get(w.id) || 0) <= EPS) continue;
          const dw = need(w.id);
          const op = wellOpCost(w, config);
          for (const r of refineries) {
            if ((refRem.get(r.id) || 0) <= EPS) continue;
            if (!isFinite(dw.dist[r.id])) continue;
            const dr = need(r.id);
            chains.push({ kind: 'well', cost: op + dw.dist[r.id] + config.refineryOpCost + r.refinery.fee + dr.dist[s.id], w, r });
          }
        }
        chains.sort((a, b) => a.cost - b.cost);
        for (const c of chains) {
          if (space <= EPS) break;
          let qty = space;
          let pathA = null, pathB = null;
          if (c.kind === 'well') {
            qty = Math.min(qty, wellRem.get(c.w.id) || 0, refRem.get(c.r.id) || 0);
            if (qty <= EPS) continue;
            pathA = pathEdges(state, dij.get(c.w.id), c.w.id, c.r.id);
            pathB = pathEdges(state, dij.get(c.r.id), c.r.id, s.id);
            qty = Math.min(qty, pipeBottleneck([pathA, pathB], config, frozenSet));
          } else {
            pathB = pathEdges(state, dij.get(c.t.id), c.t.id, s.id);
            qty = Math.min(qty, pipeBottleneck([pathB], config, frozenSet));
          }
          if (qty <= EPS) continue;
          // affordability: don't spend below zero cash
          const remaining = budget.get(st.owner) || 0;
          qty = Math.min(qty, c.cost > 0 ? remaining / c.cost : qty);
          if (qty <= EPS) continue;

          let truckRail = 0, tolls = [];
          if (c.kind === 'well') {
            wellRem.set(c.w.id, wellRem.get(c.w.id) - qty);
            refRem.set(c.r.id, refRem.get(c.r.id) - qty);
            c.w.well.producedThisTurn += qty;
            c.r.refinery.usedThisTurn += qty;
            const cA = commitPath(pathA, qty, 'crude', frozenSet);
            const cB = commitPath(pathB, qty, 'refined', frozenSet);
            truckRail = cA.truckRail + cB.truckRail; tolls = cA.tolls.concat(cB.tolls);
            owner.costs.wellOps += qty * wellOpCost(c.w, config);
            owner.costs.refiningPaid += qty * (config.refineryOpCost + c.r.refinery.fee);
            state.players[c.r.refinery.owner].revenue.refineryFees += qty * c.r.refinery.fee;
            totalProduction += qty;
          } else {
            const cB = commitPath(pathB, qty, 'refined', frozenSet);
            truckRail = cB.truckRail; tolls = cB.tolls;
            owner.costs.storagePurchases += qty * (state.globalPrice + config.terminalFee);
            totalImports += qty;
          }
          payTolls(state, tolls);
          owner.costs.pipeTollsPaid += sumTolls(tolls);
          owner.costs.transport += truckRail;
          // volume-weighted cost basis of everything in the tank
          st.costBasis = (st.costBasis * st.stock + c.cost * qty) / (st.stock + qty);
          st.stock += qty;
          space -= qty;
          totalStorageIn += qty;
          budget.set(st.owner, (budget.get(st.owner) || 0) - qty * c.cost);
        }
      }
    }

    // --- congestion flags for rendering/AI ---
    for (const e of state.edges) {
      if (e.pipeline && e.pipeFlow >= config.pipelineCapacity - EPS) e.congested = true;
    }

    // --- totals ---
    let totalDemand = 0, demandSatisfied = 0;
    for (const n of demandNodes) {
      totalDemand += n.demandThisTurn;
      demandSatisfied += n.suppliedBy.players + n.suppliedBy.imports + n.suppliedBy.storage;
    }
    state.totals = {
      production: totalProduction,
      demand: totalDemand,
      demandSatisfied,
      imports: totalImports,
      exports: totalExports,
      storageIn: totalStorageIn,
      storageOut: totalStorageOut,
      playerSales: totalPlayerSales
    };

    return { accepted };
  }

  function payTolls(state, tolls) {
    for (const t of tolls) state.players[t.owner].revenue.pipeTolls += t.amount;
  }
  function sumTolls(tolls) {
    let s = 0;
    for (const t of tolls) s += t.amount;
    return s;
  }

  const Market = { clearMarket };
  global.Market = Market;
  if (typeof module !== 'undefined' && module.exports) module.exports = Market;
})(typeof globalThis !== 'undefined' ? globalThis : window);
