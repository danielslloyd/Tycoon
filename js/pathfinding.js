// pathfinding.js — binary-heap Dijkstra per source over the edge graph.
// Edge weights come from a weight function (cheapest available transport mode),
// so the same machinery serves market clearing (with congestion repricing),
// UI route previews, and AI estimates.
(function (global) {
  'use strict';

  // Array-backed binary min-heap of node ids keyed by dist[].
  class MinHeap {
    constructor(dist) { this.dist = dist; this.items = []; }
    push(id) {
      const a = this.items, d = this.dist;
      a.push(id);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (d[a[p]] <= d[a[i]]) break;
        const t = a[p]; a[p] = a[i]; a[i] = t;
        i = p;
      }
    }
    pop() {
      const a = this.items, d = this.dist;
      const top = a[0];
      const last = a.pop();
      if (a.length > 0) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let s = i;
          if (l < a.length && d[a[l]] < d[a[s]]) s = l;
          if (r < a.length && d[a[r]] < d[a[s]]) s = r;
          if (s === i) break;
          const t = a[s]; a[s] = a[i]; a[i] = t;
          i = s;
        }
      }
      return top;
    }
    get size() { return this.items.length; }
  }

  // Standard transport weight: cheapest of truck / rail / pipeline posted fee.
  // frozenPipes (Set of edge ids) reprices saturated pipes at their truck/rail
  // fallback so overflow routes around (or over, by truck) full pipelines.
  function makeWeightFn(state, config, frozenPipes) {
    return function (edge) {
      let w = config.truckCostPerEdge;
      if (edge.rail && config.railCostPerEdge < w) w = config.railCostPerEdge;
      if (edge.pipeline && (!frozenPipes || !frozenPipes.has(edge.id)) && edge.pipeline.fee < w) {
        w = edge.pipeline.fee;
      }
      return w;
    };
  }

  // Which mode does a barrel actually take on this edge, given the weight rules?
  function edgeMode(edge, config, frozenPipes) {
    let w = config.truckCostPerEdge, mode = 'truck';
    if (edge.rail && config.railCostPerEdge < w) { w = config.railCostPerEdge; mode = 'rail'; }
    if (edge.pipeline && (!frozenPipes || !frozenPipes.has(edge.id)) && edge.pipeline.fee < w) {
      mode = 'pipeline';
    }
    return mode;
  }

  // Dijkstra from sourceId. Returns { dist: Float64Array, prevEdge: Int32Array }.
  function dijkstra(state, sourceId, weightFn) {
    const n = state.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[sourceId] = 0;
    const heap = new MinHeap(dist);
    heap.push(sourceId);
    while (heap.size > 0) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      const node = state.nodes[u];
      for (const eid of node.edges) {
        const e = state.edges[eid];
        const v = e.a === u ? e.b : e.a;
        if (done[v]) continue;
        const nd = dist[u] + weightFn(e);
        if (nd < dist[v]) {
          dist[v] = nd;
          prevEdge[v] = eid;
          heap.push(v);
        }
      }
    }
    return { dist, prevEdge };
  }

  // Reconstruct source→target as an ordered list of edge ids (empty if same node).
  function pathEdges(state, result, sourceId, targetId) {
    const out = [];
    let cur = targetId;
    while (cur !== sourceId) {
      const eid = result.prevEdge[cur];
      if (eid < 0) return null; // unreachable
      out.push(eid);
      const e = state.edges[eid];
      cur = e.a === cur ? e.b : e.a;
    }
    return out.reverse();
  }

  // Lazy per-source cache, invalidated when state.routeVersion changes.
  // Used by UI previews and AI scoring; the market builds its own per-round caches.
  class RouteCache {
    constructor(state) { this.state = state; this.version = -1; this.results = new Map(); }
    get(sourceId) {
      if (this.version !== this.state.routeVersion) {
        this.results.clear();
        this.version = this.state.routeVersion;
      }
      let r = this.results.get(sourceId);
      if (!r) {
        const config = this.state.configStore.active;
        r = dijkstra(this.state, sourceId, makeWeightFn(this.state, config, null));
        this.results.set(sourceId, r);
      }
      return r;
    }
  }

  const Pathfinding = { MinHeap, makeWeightFn, edgeMode, dijkstra, pathEdges, RouteCache };
  global.Pathfinding = Pathfinding;
  if (typeof module !== 'undefined' && module.exports) module.exports = Pathfinding;
})(typeof globalThis !== 'undefined' ? globalThis : window);
