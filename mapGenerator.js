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

    // Find exterior nodes (top 20% by distance from center)
    const sortedByEdge = [...pointsWithDistance].sort(
      (a, b) => b.distFromCenter - a.distFromCenter
    );

    const numExteriorNodes = Math.floor(points.length * 0.2);
    const exteriorNodeIndices = new Set(
      sortedByEdge.slice(0, numExteriorNodes).map(p => p.index)
    );

    // Select random subset of exterior nodes for import terminals
    const exteriorNodesArray = Array.from(exteriorNodeIndices);
    const numTerminals = Math.min(this.settings.NUM_IMPORT_TERMINALS, exteriorNodesArray.length);
    const importTerminalIndices = new Set();

    const shuffled = [...exteriorNodesArray].sort(() => Math.random() - 0.5);
    for (let i = 0; i < numTerminals; i++) {
      importTerminalIndices.add(shuffled[i]);
    }

    // Create nodes with basic properties first
    this.nodes = points.map((p, i) => {
      const isProduction = productionNodeIndices.has(i);
      const isTerminal = importTerminalIndices.has(i);

      let node = {
        id: i,
        x: p.x,
        y: p.y,
        connections: [],
        buildings: {},
        type: isTerminal ? 'terminal' : (isProduction ? 'production' : 'demand'),
        distFromCenter: pointsWithDistance[i].distFromCenter
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

      // Terminal properties
      if (isTerminal) {
        node.is_import_terminal = true;
      }

      // Calculated properties (demand will be set later)
      node.demand_base = 0;
      node.demand_growth_rate = 0;
      node.current_demand = 0;
      node.local_price = 0;
      node.supply_source = null;
      node.city_type = null;  // 'major', 'midsize', or null

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

    // Create edge objects with actual lengths
    const tempEdges = Array.from(edgeSet).map((edgeKey) => {
      const [a, b] = edgeKey.split('-').map(Number);
      const nodeA = this.nodes[a];
      const nodeB = this.nodes[b];

      const length = Math.sqrt(
        Math.pow(nodeA.x - nodeB.x, 2) + Math.pow(nodeA.y - nodeB.y, 2)
      );

      return {
        node_a: a,
        node_b: b,
        length: length
      };
    });

    // Calculate median edge length
    const edgeLengths = tempEdges.map(e => e.length).sort((a, b) => a - b);
    const medianLength = edgeLengths[Math.floor(edgeLengths.length / 2)];
    const maxLength = medianLength * 2;

    console.log(`Median edge length: ${medianLength.toFixed(2)}, Max allowed: ${maxLength.toFixed(2)}`);

    // Filter edges longer than 2x median
    const filteredEdges = tempEdges.filter(e => e.length <= maxLength);

    console.log(`Kept ${filteredEdges.length} of ${tempEdges.length} edges after trimming`);

    // Create final edge objects
    this.edges = filteredEdges.map((edge, i) => {
      const edgeObj = {
        id: i,
        node_a: edge.node_a,
        node_b: edge.node_b,
        length: edge.length,
        transportation: {
          truck: { available: true, cost: this.settings.TRUCK_COST_PER_EDGE },
          rail: { available: false, cost: this.settings.RAIL_COST_PER_EDGE },
          pipeline: { owner: null, capacity: 0, fee: 0, utilization: 0 }
        },
        flow_volume: 0  // Track oil flow for visualization
      };

      // Update node connections
      this.nodes[edge.node_a].connections.push(i);
      this.nodes[edge.node_b].connections.push(i);

      return edgeObj;
    });

    // Create sophisticated demand system
    this.createSophisticatedDemandSystem();

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

  createSophisticatedDemandSystem() {
    // 1. Select 4 random exterior nodes as major cities
    const exteriorNodes = this.nodes.filter(n =>
      !n.is_import_terminal &&
      n.type !== 'production' &&
      n.distFromCenter > 0
    ).sort((a, b) => b.distFromCenter - a.distFromCenter);

    const topExterior = exteriorNodes.slice(0, Math.min(100, exteriorNodes.length));
    const shuffled = [...topExterior].sort(() => Math.random() - 0.5);
    const majorCities = shuffled.slice(0, Math.min(4, shuffled.length));

    console.log(`Selected ${majorCities.length} major cities:`, majorCities.map(n => n.id));

    // Mark major cities and set high demand
    const majorCityIds = new Set();
    for (const city of majorCities) {
      city.city_type = 'major';
      city.demand_base = RandomUtils.range(50000, 100000);
      majorCityIds.add(city.id);
    }

    // 2. Create railroads on shortest paths between all major cities
    const railroadEdges = new Set();
    const nodeCrossings = new Map();  // Track how many railroads cross each node

    for (let i = 0; i < majorCities.length; i++) {
      for (let j = i + 1; j < majorCities.length; j++) {
        const path = this.findPath(majorCities[i].id, majorCities[j].id);
        if (path) {
          // Mark edges as railroad
          for (const edgeId of path) {
            railroadEdges.add(edgeId);
            this.edges[edgeId].transportation.rail.available = true;
          }

          // Track node crossings
          const nodePath = this.getNodePath(majorCities[i].id, majorCities[j].id, path);
          for (const nodeId of nodePath) {
            if (!majorCityIds.has(nodeId)) {
              nodeCrossings.set(nodeId, (nodeCrossings.get(nodeId) || 0) + 1);
            }
          }
        }
      }
    }

    console.log(`Created ${railroadEdges.size} railroad edges`);

    // 3. Identify midsize cities (nodes where railroads cross, min 2 crossings)
    const midsizeCityIds = new Set();
    for (const [nodeId, crossings] of nodeCrossings.entries()) {
      if (crossings >= 2) {
        const node = this.nodes[nodeId];
        if (!node.is_import_terminal && node.type !== 'production') {
          node.city_type = 'midsize';
          node.demand_base = RandomUtils.range(20000, 40000);
          midsizeCityIds.add(nodeId);
        }
      }
    }

    console.log(`Identified ${midsizeCityIds.size} midsize cities`);

    // 4. Set demand for remaining nodes based on distance from major/midsize cities
    const allCityNodes = [...majorCities, ...this.nodes.filter(n => midsizeCityIds.has(n.id))];

    for (const node of this.nodes) {
      // Skip if already assigned demand or is terminal/production
      if (node.demand_base > 0 || node.is_import_terminal) continue;

      // Calculate minimum distance to any major or midsize city
      let minDist = Infinity;
      for (const city of allCityNodes) {
        const dist = Math.sqrt(
          Math.pow(node.x - city.x, 2) + Math.pow(node.y - city.y, 2)
        );
        minDist = Math.min(minDist, dist);
      }

      // Demand decreases with distance from cities
      // Base demand inversely proportional to distance
      const maxDist = Math.sqrt(
        Math.pow(this.settings.MAP_WIDTH, 2) + Math.pow(this.settings.MAP_HEIGHT, 2)
      );
      const distanceRatio = 1 - (minDist / maxDist);
      const baseDemand = 1000 + distanceRatio * 15000;

      node.demand_base = Math.floor(baseDemand * (0.5 + Math.random() * 0.5));
    }

    // 5. Assign growth rates to all demand nodes (-2% to +5% with jitter)
    for (const node of this.nodes) {
      if (node.demand_base > 0) {
        node.demand_growth_rate = RandomUtils.range(-0.02, 0.05);
        node.current_demand = node.demand_base;
      }
    }

    console.log('Sophisticated demand system created');
  }

  // Get node path from edge path
  getNodePath(startId, endId, edgePath) {
    const nodePath = [startId];
    let currentNode = startId;

    for (const edgeId of edgePath) {
      const edge = this.edges[edgeId];
      const nextNode = edge.node_a === currentNode ? edge.node_b : edge.node_a;
      nodePath.push(nextNode);
      currentNode = nextNode;
    }

    return nodePath;
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
