// Pathfinding - Floyd-Warshall for all-pairs shortest paths
class Pathfinder {
  constructor(nodes, edges) {
    this.nodes = nodes;
    this.edges = edges;
    this.dist = null;
    this.next = null;
    this.computeAllPaths(nodes, edges);
  }

  // Compute all-pairs shortest paths using Floyd-Warshall
  computeAllPaths(nodes, edges) {
    const n = nodes.length;

    // Initialize distance and next matrices
    this.dist = Array(n).fill(null).map(() => Array(n).fill(Infinity));
    this.next = Array(n).fill(null).map(() => Array(n).fill(null));

    // Distance from node to itself is 0
    for (let i = 0; i < n; i++) {
      this.dist[i][i] = 0;
      this.next[i][i] = i;
    }

    // Set initial edge costs (use minimum cost transportation available)
    for (const edge of edges) {
      const { node_a, node_b } = edge;
      const cost = this.getEdgeCost(edge);

      if (cost < this.dist[node_a][node_b]) {
        this.dist[node_a][node_b] = cost;
        this.dist[node_b][node_a] = cost;
        this.next[node_a][node_b] = node_b;
        this.next[node_b][node_a] = node_a;
      }
    }

    // Floyd-Warshall algorithm
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (this.dist[i][k] + this.dist[k][j] < this.dist[i][j]) {
            this.dist[i][j] = this.dist[i][k] + this.dist[k][j];
            this.next[i][j] = this.next[i][k];
          }
        }
      }
    }
  }

  // Get minimum transportation cost for an edge
  getEdgeCost(edge) {
    let minCost = edge.transportation.truck.cost;

    if (edge.transportation.rail.available) {
      minCost = Math.min(minCost, edge.transportation.rail.cost);
    }

    if (edge.transportation.pipeline.owner !== null) {
      minCost = Math.min(minCost, edge.transportation.pipeline.fee);
    }

    return minCost;
  }

  // Get shortest path between two nodes
  getPath(from, to) {
    if (this.next[from][to] === null) {
      return null;  // No path exists
    }

    const path = [from];
    let current = from;

    while (current !== to) {
      current = this.next[current][to];
      path.push(current);
    }

    return path;
  }

  // Get cost of shortest path
  getCost(from, to) {
    return this.dist[from][to];
  }

  // Get detailed route with edge information
  getDetailedRoute(from, to) {
    const nodePath = this.getPath(from, to);
    if (!nodePath) return null;

    const route = {
      nodes: nodePath,
      edges: [],
      totalCost: 0,
      breakdown: {
        truck: 0,
        rail: 0,
        pipeline: 0
      }
    };

    // Build edge list and cost breakdown
    for (let i = 0; i < nodePath.length - 1; i++) {
      const nodeA = nodePath[i];
      const nodeB = nodePath[i + 1];

      // Find the edge between these nodes
      const edge = this.findEdge(nodeA, nodeB);
      if (!edge) continue;

      route.edges.push(edge.id);

      // Determine which transportation method is used
      const { transportType, cost } = this.getEdgeTransportation(edge);
      route.totalCost += cost;
      route.breakdown[transportType] += cost;
    }

    return route;
  }

  // Find edge between two nodes
  findEdge(nodeA, nodeB) {
    for (const edge of this.edges) {
      if ((edge.node_a === nodeA && edge.node_b === nodeB) ||
          (edge.node_a === nodeB && edge.node_b === nodeA)) {
        return edge;
      }
    }
    return null;
  }

  // Get transportation method and cost for an edge
  getEdgeTransportation(edge) {
    let minCost = edge.transportation.truck.cost;
    let transportType = 'truck';

    if (edge.transportation.rail.available &&
        edge.transportation.rail.cost < minCost) {
      minCost = edge.transportation.rail.cost;
      transportType = 'rail';
    }

    if (edge.transportation.pipeline.owner !== null &&
        edge.transportation.pipeline.fee < minCost) {
      minCost = edge.transportation.pipeline.fee;
      transportType = 'pipeline';
    }

    return { transportType, cost: minCost };
  }

  // Find nearest refinery from a production node
  findNearestRefinery(productionNodeId, nodes) {
    let nearestRefinery = null;
    let minCost = Infinity;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.buildings.refinery && node.buildings.refinery.capacity > 0) {
        const cost = this.getCost(productionNodeId, i);
        if (cost < minCost) {
          minCost = cost;
          nearestRefinery = i;
        }
      }
    }

    return nearestRefinery;
  }

  // Find nearest import terminal from a node
  findNearestTerminal(nodeId, nodes) {
    let nearestTerminal = null;
    let minCost = Infinity;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.is_import_terminal) {
        const cost = this.getCost(nodeId, i);
        if (cost < minCost) {
          minCost = cost;
          nearestTerminal = i;
        }
      }
    }

    return nearestTerminal;
  }

  // Calculate local price at a demand node
  calculateLocalPrice(demandNodeId, globalPrice, terminalFee, nodes) {
    const terminalId = this.findNearestTerminal(demandNodeId, nodes);
    if (terminalId === null) return Infinity;

    const transportCost = this.getCost(terminalId, demandNodeId);
    return globalPrice + terminalFee + transportCost;
  }

  // Find cheapest supply route (production -> refinery -> demand)
  findCheapestSupply(demandNodeId, globalPrice, terminalFee, settings, nodes) {
    let cheapestCost = Infinity;
    let cheapestRoute = null;

    // Calculate import terminal price
    const importPrice = this.calculateLocalPrice(demandNodeId, globalPrice, terminalFee, nodes);

    // Check all production -> refinery -> demand routes
    for (let prodId = 0; prodId < nodes.length; prodId++) {
      const prodNode = nodes[prodId];
      if (!prodNode.has_well) continue;

      // Find all refineries
      for (let refId = 0; refId < nodes.length; refId++) {
        const refNode = nodes[refId];
        if (!refNode.buildings.refinery) continue;

        // Calculate total cost: production + transport to refinery + refining + transport to demand
        const transportToRef = this.getCost(prodId, refId);
        const transportToDemand = this.getCost(refId, demandNodeId);

        const totalCost = prodNode.operating_cost +
                         transportToRef +
                         settings.REFINERY_OPERATING_COST +
                         refNode.buildings.refinery.fee +
                         transportToDemand;

        if (totalCost < cheapestCost) {
          cheapestCost = totalCost;
          cheapestRoute = {
            production: prodId,
            refinery: refId,
            demand: demandNodeId,
            cost: totalCost
          };
        }
      }
    }

    // Compare with import price
    if (importPrice < cheapestCost) {
      return {
        type: 'import',
        cost: importPrice,
        terminal: this.findNearestTerminal(demandNodeId, nodes)
      };
    }

    if (cheapestRoute) {
      cheapestRoute.type = 'player_supply';
      return cheapestRoute;
    }

    // Fallback to import
    return {
      type: 'import',
      cost: importPrice,
      terminal: this.findNearestTerminal(demandNodeId, nodes)
    };
  }
}
