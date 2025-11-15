// Map Generator - Creates nodes and edges using Poisson disk sampling and Delaunay triangulation
class MapGenerator {
  constructor(settings) {
    this.settings = settings;
    this.nodes = [];
    this.edges = [];
  }

  // Poisson disk sampling for evenly distributed points
  poissonDiskSampling(width, height, radius, numSamples = 30) {
    const points = [];
    const cellSize = radius / Math.sqrt(2);
    const gridWidth = Math.ceil(width / cellSize);
    const gridHeight = Math.ceil(height / cellSize);
    const grid = new Array(gridWidth * gridHeight).fill(null);

    const addPoint = (x, y) => {
      const gridX = Math.floor(x / cellSize);
      const gridY = Math.floor(y / cellSize);
      const gridIndex = gridY * gridWidth + gridX;

      const point = { x, y };
      points.push(point);
      grid[gridIndex] = point;
      return point;
    };

    const isValidPoint = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;

      const gridX = Math.floor(x / cellSize);
      const gridY = Math.floor(y / cellSize);

      const searchRadius = 2;
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const gx = gridX + dx;
          const gy = gridY + dy;

          if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridHeight) {
            const gridIndex = gy * gridWidth + gx;
            const neighbor = grid[gridIndex];

            if (neighbor) {
              const dist = Math.sqrt(
                Math.pow(neighbor.x - x, 2) + Math.pow(neighbor.y - y, 2)
              );
              if (dist < radius) return false;
            }
          }
        }
      }
      return true;
    };

    // Start with a random point
    const initialX = Math.random() * width;
    const initialY = Math.random() * height;
    const activeList = [addPoint(initialX, initialY)];

    while (activeList.length > 0 && points.length < this.settings.NUM_NODES) {
      const index = Math.floor(Math.random() * activeList.length);
      const point = activeList[index];
      let found = false;

      for (let i = 0; i < numSamples; i++) {
        const angle = Math.random() * 2 * Math.PI;
        const distance = radius + Math.random() * radius;
        const newX = point.x + distance * Math.cos(angle);
        const newY = point.y + distance * Math.sin(angle);

        if (isValidPoint(newX, newY)) {
          activeList.push(addPoint(newX, newY));
          found = true;
          break;
        }
      }

      if (!found) {
        activeList.splice(index, 1);
      }
    }

    return points;
  }

  // Generate nodes with Delaunay triangulation for edges
  generateMap() {
    console.log('Generating map with Poisson disk sampling...');

    // Generate points using Poisson disk sampling
    const points = this.poissonDiskSampling(
      this.settings.MAP_WIDTH,
      this.settings.MAP_HEIGHT,
      this.settings.POISSON_RADIUS
    );

    console.log(`Generated ${points.length} points`);

    // Create Delaunay triangulation
    const delaunay = d3.Delaunay.from(points.map(p => [p.x, p.y]));

    // Determine node types and properties
    const numProductionNodes = Math.floor(
      points.length * this.settings.PRODUCTION_NODE_PERCENTAGE
    );

    // Calculate distance from center for bias
    const centerX = this.settings.MAP_WIDTH / 2;
    const centerY = this.settings.MAP_HEIGHT / 2;

    const pointsWithDistance = points.map((p, i) => ({
      index: i,
      x: p.x,
      y: p.y,
      distFromCenter: Math.sqrt(
        Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2)
      )
    }));

    // Sort by distance from center for production node selection (interior bias)
    const sortedByCenter = [...pointsWithDistance].sort(
      (a, b) => a.distFromCenter - b.distFromCenter
    );

    // Select production nodes (interior bias)
    const productionNodeIndices = new Set(
      sortedByCenter.slice(0, numProductionNodes).map(p => p.index)
    );

    // Find perimeter nodes for import terminals
    const sortedByEdge = [...pointsWithDistance].sort(
      (a, b) => b.distFromCenter - a.distFromCenter
    );

    const importTerminalIndices = new Set();
    const numTerminals = this.settings.NUM_IMPORT_TERMINALS;
    const angleStep = (2 * Math.PI) / numTerminals;

    // Distribute terminals evenly around perimeter
    for (let i = 0; i < numTerminals; i++) {
      const targetAngle = i * angleStep;
      const targetX = centerX + Math.cos(targetAngle) * (this.settings.MAP_WIDTH / 2);
      const targetY = centerY + Math.sin(targetAngle) * (this.settings.MAP_HEIGHT / 2);

      // Find closest outer node to target angle
      let closestNode = null;
      let closestDist = Infinity;

      for (const node of sortedByEdge.slice(0, 50)) {
        if (importTerminalIndices.has(node.index)) continue;
        const dist = Math.sqrt(
          Math.pow(node.x - targetX, 2) + Math.pow(node.y - targetY, 2)
        );
        if (dist < closestDist) {
          closestDist = dist;
          closestNode = node;
        }
      }

      if (closestNode) {
        importTerminalIndices.add(closestNode.index);
      }
    }

    // Create nodes with properties
    this.nodes = points.map((p, i) => {
      const isProduction = productionNodeIndices.has(i);
      const isTerminal = importTerminalIndices.has(i);

      let node = {
        id: i,
        x: p.x,
        y: p.y,
        connections: [],
        buildings: {},
        type: isTerminal ? 'terminal' : (isProduction ? 'production' : 'demand')
      };

      // Production node properties
      if (isProduction) {
        const capacity = Math.max(
          this.settings.WELL_CAPACITY_MIN,
          Math.min(
            this.settings.WELL_CAPACITY_MAX,
            RandomUtils.lognormal(5000, 1.5)
          )
        );

        node.production_capacity = Math.floor(capacity);
        node.well_build_cost = this.settings.WELL_BUILD_COST;

        // Operating cost inversely correlated with capacity
        const normalizedCapacity = (capacity - this.settings.WELL_CAPACITY_MIN) /
                                    (this.settings.WELL_CAPACITY_MAX - this.settings.WELL_CAPACITY_MIN);
        node.operating_cost = this.settings.WELL_OPERATING_COST_MAX -
                             normalizedCapacity * (this.settings.WELL_OPERATING_COST_MAX - this.settings.WELL_OPERATING_COST_MIN);

        node.has_well = false;
        node.well_owner = null;
      }

      // Demand properties (all nodes have demand)
      if (!isTerminal) {
        // Exterior bias for high demand (inverse of distance from center)
        const distanceNormalized = p.distFromCenter / Math.sqrt(
          Math.pow(this.settings.MAP_WIDTH / 2, 2) + Math.pow(this.settings.MAP_HEIGHT / 2, 2)
        );

        const demandBase = RandomUtils.pareto(1000, 2) * (1 + distanceNormalized);
        node.demand_base = Math.floor(demandBase);
        node.demand_growth_rate = RandomUtils.range(
          this.settings.DEMAND_GROWTH_MIN,
          this.settings.DEMAND_GROWTH_MAX
        );
        node.current_demand = node.demand_base;
      }

      // Terminal properties
      if (isTerminal) {
        node.is_import_terminal = true;
      }

      // Calculated properties
      node.local_price = 0;
      node.supply_source = null;

      return node;
    });

    // Generate edges from Delaunay triangulation
    const edgeSet = new Set();
    const triangles = delaunay.triangles;

    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i];
      const b = triangles[i + 1];
      const c = triangles[i + 2];

      // Add three edges of the triangle
      this.addEdge(edgeSet, a, b);
      this.addEdge(edgeSet, b, c);
      this.addEdge(edgeSet, c, a);
    }

    // Create edge objects
    this.edges = Array.from(edgeSet).map((edgeKey, i) => {
      const [a, b] = edgeKey.split('-').map(Number);

      const edge = {
        id: i,
        node_a: a,
        node_b: b,
        length: 1,  // Each edge = 1 unit distance
        transportation: {
          truck: { available: true, cost: this.settings.TRUCK_COST_PER_EDGE },
          rail: { available: false, cost: this.settings.RAIL_COST_PER_EDGE },
          pipeline: { owner: null, capacity: 0, fee: 0, utilization: 0 }
        }
      };

      // Update node connections
      this.nodes[a].connections.push(i);
      this.nodes[b].connections.push(i);

      return edge;
    });

    // Create initial rail network connecting 5 largest demand nodes
    this.createRailNetwork();

    console.log(`Created ${this.nodes.length} nodes and ${this.edges.length} edges`);

    return {
      nodes: this.nodes,
      edges: this.edges
    };
  }

  addEdge(edgeSet, a, b) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    edgeSet.add(key);
  }

  createRailNetwork() {
    // Find 5 largest demand nodes
    const demandNodes = this.nodes
      .filter(n => n.demand_base)
      .sort((a, b) => b.demand_base - a.demand_base)
      .slice(0, 5);

    if (demandNodes.length < 2) return;

    // Use pathfinding to connect them (simple BFS for now)
    const connected = new Set([demandNodes[0].id]);

    while (connected.size < demandNodes.length) {
      let bestEdges = [];
      let shortestPath = Infinity;

      // Find shortest path from any connected node to any unconnected node
      for (const connectedNode of connected) {
        for (const targetNode of demandNodes) {
          if (connected.has(targetNode.id)) continue;

          const path = this.findPath(connectedNode, targetNode.id);
          if (path && path.length < shortestPath) {
            shortestPath = path.length;
            bestEdges = path;
          }
        }
      }

      // Add rail to these edges
      for (const edgeId of bestEdges) {
        this.edges[edgeId].transportation.rail.available = true;
      }

      // Mark target as connected
      if (bestEdges.length > 0) {
        const lastEdge = this.edges[bestEdges[bestEdges.length - 1]];
        const newNode = connected.has(lastEdge.node_a) ? lastEdge.node_b : lastEdge.node_a;
        connected.add(newNode);
      }
    }
  }

  // Simple BFS pathfinding
  findPath(startId, endId) {
    const queue = [[startId, []]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const [currentId, path] = queue.shift();

      if (currentId === endId) {
        return path;
      }

      const currentNode = this.nodes[currentId];
      for (const edgeId of currentNode.connections) {
        const edge = this.edges[edgeId];
        const nextId = edge.node_a === currentId ? edge.node_b : edge.node_a;

        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push([nextId, [...path, edgeId]]);
        }
      }
    }

    return null;
  }
}
