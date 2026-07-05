// mapGenerator.js — Poisson disk sampling → Delaunay triangulation → node typing:
// oil fields (interior bias), evenly spaced perimeter import terminals, major cities
// linked by free rail, midsize cities at rail crossings, towns near cities.
// Deterministic for a given rng stream.
(function (global) {
  'use strict';

  const { RandomUtils } = global.Util;

  const MAP_W = 2000;
  const MAP_H = 2000;

  function poissonDisk(rng, width, height, radius, maxPoints, numSamples = 30) {
    const points = [];
    const cellSize = radius / Math.SQRT2;
    const gw = Math.ceil(width / cellSize);
    const gh = Math.ceil(height / cellSize);
    const grid = new Array(gw * gh).fill(null);

    const add = (x, y) => {
      const p = { x, y };
      points.push(p);
      grid[Math.floor(y / cellSize) * gw + Math.floor(x / cellSize)] = p;
      return p;
    };
    const valid = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const n = grid[ny * gw + nx];
          if (n && (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y) < radius * radius) return false;
        }
      }
      return true;
    };

    const active = [add(width / 2 + (rng() - 0.5) * radius, height / 2 + (rng() - 0.5) * radius)];
    while (active.length > 0 && points.length < maxPoints) {
      const idx = Math.floor(rng() * active.length);
      const p = active[idx];
      let found = false;
      for (let i = 0; i < numSamples; i++) {
        const ang = rng() * 2 * Math.PI;
        const d = radius * (1 + rng());
        const x = p.x + d * Math.cos(ang), y = p.y + d * Math.sin(ang);
        if (valid(x, y)) { active.push(add(x, y)); found = true; break; }
      }
      if (!found) active.splice(idx, 1);
    }
    return points;
  }

  function makeNode(id, x, y) {
    return {
      id, x, y,
      type: 'plain',            // 'plain' | 'production' | 'terminal'
      cityTier: null,           // 'major' | 'midsize' | 'town' | null
      edges: [],                // edge ids
      // production
      quality: 0,               // 0..1, 1 = best (cheapest per-barrel pumping); op cost derived live from config
      prodCapacity: 0,          // bbl/turn (0 unless production node)
      well: null,               // { owner }
      // demand
      demandBase: 0,            // bbl/turn at reference price
      demandGrowth: 0,          // per-turn growth rate
      // buildings (any node)
      refinery: null,           // { owner, level, fee, usedThisTurn }
      storage: null,            // { owner, capacity, stock, costBasis }
      // per-turn market results
      demandThisTurn: 0,
      localPrice: null,
      lastLocalPrice: null,
      importParity: null,
      breakdown: null,          // marginal offer cost stack for "why this price?"
      suppliedBy: null          // { players: bbl, imports: bbl, storage: bbl }
    };
  }

  function generateMap(config, rng) {
    // Radius derived from node count so one slider controls density.
    const radius = Math.sqrt(0.7 * MAP_W * MAP_H / config.numNodes);
    const points = poissonDisk(rng, MAP_W, MAP_H, radius, config.numNodes);
    const nodes = points.map((p, i) => makeNode(i, p.x, p.y));

    // --- Edges: Delaunay, then trim overlong edges, then repair connectivity ---
    const delaunay = global.Delaunator.from(points.map((p) => [p.x, p.y]));
    const seen = new Set();
    const rawEdges = [];
    const tri = delaunay.triangles;
    const pushEdge = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      if (seen.has(key)) return;
      seen.add(key);
      rawEdges.push({ a, b, len: Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) });
    };
    for (let i = 0; i < tri.length; i += 3) {
      pushEdge(tri[i], tri[i + 1]);
      pushEdge(tri[i + 1], tri[i + 2]);
      pushEdge(tri[i + 2], tri[i]);
    }
    rawEdges.sort((e1, e2) => e1.len - e2.len);
    const median = rawEdges[Math.floor(rawEdges.length / 2)].len;
    const kept = rawEdges.filter((e) => e.len <= 2 * median);
    const dropped = rawEdges.filter((e) => e.len > 2 * median);

    // Union-find: re-add shortest dropped edges until the graph is connected.
    const parent = nodes.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return false; parent[ra] = rb; return true; };
    let components = nodes.length;
    for (const e of kept) if (union(e.a, e.b)) components--;
    for (const e of dropped) {
      if (components === 1) break;
      if (union(e.a, e.b)) { components--; kept.push(e); }
    }

    const edges = kept.map((e, i) => ({
      id: i, a: e.a, b: e.b, length: e.len,
      rail: false,
      pipeline: null,           // { owner, fee }
      // per-turn market results
      flowCrude: 0, flowRefined: 0, pipeFlow: 0, congested: false
    }));
    for (const e of edges) {
      nodes[e.a].edges.push(e.id);
      nodes[e.b].edges.push(e.id);
    }

    const cx = MAP_W / 2, cy = MAP_H / 2;
    const distC = nodes.map((n) => Math.hypot(n.x - cx, n.y - cy));
    const maxDistC = Math.max(...distC);

    // --- Import terminals: evenly spaced around the perimeter ---
    // For each of numImportTerminals evenly spaced angles, pick the most exterior
    // unclaimed node within the angular sector.
    const terminalIds = new Set();
    const angleOffset = rng() * 2 * Math.PI;
    for (let t = 0; t < config.numImportTerminals; t++) {
      const target = angleOffset + (t / config.numImportTerminals) * 2 * Math.PI;
      let best = -1, bestScore = -Infinity;
      for (const n of nodes) {
        if (terminalIds.has(n.id)) continue;
        const ang = Math.atan2(n.y - cy, n.x - cx);
        let dAng = Math.abs(ang - target) % (2 * Math.PI);
        if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
        if (dAng > Math.PI / config.numImportTerminals) continue; // stay in this sector
        const score = distC[n.id] - dAng * 100;
        if (score > bestScore) { bestScore = score; best = n.id; }
      }
      if (best >= 0) { terminalIds.add(best); nodes[best].type = 'terminal'; }
    }

    // --- Production nodes: interior bias with noise ---
    const numProduction = Math.floor(nodes.length * config.productionNodePct);
    const prodCandidates = nodes
      .filter((n) => n.type === 'plain')
      .map((n) => ({ id: n.id, score: distC[n.id] / maxDistC + rng() * 0.6 }))
      .sort((a, b) => a.score - b.score)
      .slice(0, numProduction);
    for (const c of prodCandidates) {
      const n = nodes[c.id];
      n.type = 'production';
      const cap = RandomUtils.lognormal(rng, config.wellCapacityMean, 1.0);
      n.prodCapacity = Math.round(Util.clamp(cap, 500, config.wellCapacityMax));
      // quality 0..1 from log-position in the capacity range (big fields pump cheap)
      const lo = Math.log(500), hi = Math.log(config.wellCapacityMax);
      const q = (Math.log(n.prodCapacity) - lo) / (hi - lo);
      n.quality = Util.clamp(q + RandomUtils.normal(rng, 0, 0.08), 0, 1);
    }

    // --- Major cities: exterior-biased demand centers, spread apart ---
    const cityCandidates = nodes
      .filter((n) => n.type === 'plain')
      .sort((a, b) => distC[b.id] - distC[a.id])
      .slice(0, Math.max(40, Math.floor(nodes.length * 0.25)));
    RandomUtils.shuffle(rng, cityCandidates);
    const majors = [];
    const minCityDist = Math.min(MAP_W, MAP_H) / (config.numMajorCities * 0.9);
    for (const cand of cityCandidates) {
      if (majors.length >= config.numMajorCities) break;
      if (majors.every((m) => Math.hypot(m.x - cand.x, m.y - cand.y) >= minCityDist)) majors.push(cand);
    }
    // relax spacing if we couldn't place enough
    for (const cand of cityCandidates) {
      if (majors.length >= config.numMajorCities) break;
      if (!majors.includes(cand)) majors.push(cand);
    }
    for (const m of majors) {
      m.cityTier = 'major';
      m.demandBase = Math.round(config.majorCityDemand * RandomUtils.range(rng, 0.67, 1.33));
    }

    // --- Rail: BFS shortest path between every pair of major cities ---
    const crossings = new Map(); // nodeId → number of city-pair paths through it
    for (let i = 0; i < majors.length; i++) {
      for (let j = i + 1; j < majors.length; j++) {
        const path = bfsPath(nodes, edges, majors[i].id, majors[j].id);
        if (!path) continue;
        for (const eid of path.edgeIds) edges[eid].rail = true;
        for (const nid of path.nodeIds) {
          if (nodes[nid].cityTier !== 'major') crossings.set(nid, (crossings.get(nid) || 0) + 1);
        }
      }
    }

    // --- Midsize cities at rail junctions (≥2 city-pair paths cross) ---
    for (const [nid, count] of crossings) {
      const n = nodes[nid];
      if (count >= 2 && n.type === 'plain' && !n.cityTier) {
        n.cityTier = 'midsize';
        n.demandBase = Math.round(config.midsizeCityDemand * RandomUtils.range(rng, 0.67, 1.33));
      }
    }

    // --- Towns: fill remaining demand slots, larger near cities ---
    const cities = nodes.filter((n) => n.cityTier);
    const targetDemandNodes = Math.floor(nodes.length * config.demandNodePct);
    const townSlots = Math.max(0, targetDemandNodes - cities.length);
    const townCandidates = nodes.filter((n) => n.type === 'plain' && !n.cityTier);
    RandomUtils.shuffle(rng, townCandidates);
    const maxDiag = Math.hypot(MAP_W, MAP_H);
    for (const n of townCandidates.slice(0, townSlots)) {
      let nearest = Infinity;
      for (const c of cities) nearest = Math.min(nearest, Math.hypot(n.x - c.x, n.y - c.y));
      const proximity = 1 - nearest / maxDiag; // 0..1, ~1 next to a city
      n.cityTier = 'town';
      n.demandBase = Math.round(config.townDemand * (0.25 + 1.5 * proximity * proximity) * RandomUtils.range(rng, 0.6, 1.4));
    }

    // --- Growth rates for every demand node ---
    for (const n of nodes) {
      if (n.demandBase > 0) {
        n.demandGrowth = RandomUtils.range(rng, config.demandGrowthMin, config.demandGrowthMax);
      }
    }

    return { nodes, edges, width: MAP_W, height: MAP_H };
  }

  // BFS shortest path by edge count. Returns { nodeIds, edgeIds } or null.
  function bfsPath(nodes, edges, startId, endId) {
    const prev = new Map([[startId, null]]);
    const queue = [startId];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === endId) break;
      for (const eid of nodes[cur].edges) {
        const e = edges[eid];
        const next = e.a === cur ? e.b : e.a;
        if (!prev.has(next)) { prev.set(next, { node: cur, edge: eid }); queue.push(next); }
      }
    }
    if (!prev.has(endId)) return null;
    const nodeIds = [], edgeIds = [];
    let cur = endId;
    while (cur !== startId) {
      const step = prev.get(cur);
      nodeIds.push(cur);
      edgeIds.push(step.edge);
      cur = step.node;
    }
    nodeIds.push(startId);
    return { nodeIds: nodeIds.reverse(), edgeIds: edgeIds.reverse() };
  }

  const MapGenerator = { generateMap, MAP_W, MAP_H };
  global.MapGenerator = MapGenerator;
  if (typeof module !== 'undefined' && module.exports) module.exports = MapGenerator;
})(typeof globalThis !== 'undefined' ? globalThis : window);
