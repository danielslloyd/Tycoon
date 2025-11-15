// Game State Manager - Centralized state management
class GameState {
  constructor(settings) {
    this.settings = settings;
    this.turn = 0;
    this.global_oil_price = settings.INITIAL_OIL_PRICE;
    this.players = [];
    this.nodes = [];
    this.edges = [];
    this.currentPlayer = 0;
    this.selectedNode = null;
    this.pathfinder = null;
    this.turnHistory = [];
  }

  // Initialize game
  initialize() {
    console.log('Initializing game state...');

    // Create players
    this.players = [];
    for (let i = 0; i < this.settings.NUM_PLAYERS; i++) {
      this.players.push({
        id: i,
        name: `Player ${i + 1}`,
        color: this.settings.PLAYER_COLORS[i],
        cash: this.settings.STARTING_CAPITAL,
        assets: {
          wells: [],
          refineries: [],
          pipelines: [],
          storage: []
        },
        revenue_this_turn: 0,
        costs_this_turn: 0,
        profit_this_turn: 0,
        profit_history: [],
        cumulative_profit: 0,
        barrels_sold: 0,
        market_share: 0
      });
    }

    // Generate map
    const mapGen = new MapGenerator(this.settings);
    const { nodes, edges } = mapGen.generateMap();
    this.nodes = nodes;
    this.edges = edges;

    // Initialize pathfinder
    this.pathfinder = new Pathfinder(this.nodes, this.edges);

    console.log('Game state initialized');
  }

  // Build a well on a production node
  buildWell(playerId, nodeId) {
    const player = this.players[playerId];
    const node = this.nodes[nodeId];

    if (!node.production_capacity) {
      return { success: false, error: 'Not a production node' };
    }

    if (node.has_well) {
      return { success: false, error: 'Well already exists' };
    }

    if (player.cash < node.well_build_cost) {
      return { success: false, error: 'Insufficient funds' };
    }

    // Build well
    player.cash -= node.well_build_cost;
    node.has_well = true;
    node.well_owner = playerId;
    player.assets.wells.push(nodeId);

    return { success: true };
  }

  // Build a pipeline on an edge
  buildPipeline(playerId, edgeId) {
    const player = this.players[playerId];
    const edge = this.edges[edgeId];

    if (edge.transportation.pipeline.owner !== null) {
      return { success: false, error: 'Pipeline already exists' };
    }

    const cost = this.settings.PIPELINE_COST_PER_EDGE;
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient funds' };
    }

    // Build pipeline
    player.cash -= cost;
    edge.transportation.pipeline.owner = playerId;
    edge.transportation.pipeline.capacity = this.settings.PIPELINE_BASE_CAPACITY;
    edge.transportation.pipeline.fee = this.settings.PIPELINE_DEFAULT_FEE;
    edge.transportation.pipeline.utilization = 0;
    player.assets.pipelines.push(edgeId);

    // Recompute paths
    this.pathfinder.computeAllPaths(this.nodes, this.edges);

    return { success: true };
  }

  // Build a refinery on any node
  buildRefinery(playerId, nodeId) {
    const player = this.players[playerId];
    const node = this.nodes[nodeId];

    if (node.buildings.refinery) {
      return { success: false, error: 'Refinery already exists' };
    }

    const cost = this.settings.REFINERY_BUILD_COST;
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient funds' };
    }

    // Build refinery
    player.cash -= cost;
    node.buildings.refinery = {
      owner: playerId,
      capacity: this.settings.REFINERY_BASE_CAPACITY,
      fee: 5,  // Default $5/barrel processing fee
      upgrade_level: 0,
      utilization: 0,
      barrels_processed: 0
    };
    player.assets.refineries.push(nodeId);

    // Recompute paths
    this.pathfinder.computeAllPaths(this.nodes, this.edges);

    return { success: true };
  }

  // Upgrade refinery capacity
  upgradeRefinery(playerId, nodeId) {
    const player = this.players[playerId];
    const node = this.nodes[nodeId];

    if (!node.buildings.refinery) {
      return { success: false, error: 'No refinery exists' };
    }

    if (node.buildings.refinery.owner !== playerId) {
      return { success: false, error: 'Not your refinery' };
    }

    const cost = this.settings.REFINERY_BUILD_COST * this.settings.REFINERY_UPGRADE_COST_MULTIPLIER;
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient funds' };
    }

    // Upgrade refinery
    player.cash -= cost;
    node.buildings.refinery.capacity *= 2;
    node.buildings.refinery.upgrade_level += 1;

    return { success: true };
  }

  // Build storage
  buildStorage(playerId, nodeId, capacity) {
    const player = this.players[playerId];
    const node = this.nodes[nodeId];

    const cost = capacity * this.settings.STORAGE_COST_PER_BARREL;
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient funds' };
    }

    // Build storage
    player.cash -= cost;
    if (!node.buildings.storage) {
      node.buildings.storage = {
        owner: playerId,
        capacity: capacity,
        crude_stored: 0,
        refined_stored: 0
      };
      player.assets.storage.push(nodeId);
    } else {
      node.buildings.storage.capacity += capacity;
    }

    return { success: true };
  }

  // Set pipeline fee
  setPipelineFee(playerId, edgeId, fee) {
    const edge = this.edges[edgeId];

    if (edge.transportation.pipeline.owner !== playerId) {
      return { success: false, error: 'Not your pipeline' };
    }

    edge.transportation.pipeline.fee = fee;

    // Recompute paths
    this.pathfinder.computeAllPaths(this.nodes, this.edges);

    return { success: true };
  }

  // Set refinery fee
  setRefineryFee(playerId, nodeId, fee) {
    const node = this.nodes[nodeId];

    if (!node.buildings.refinery || node.buildings.refinery.owner !== playerId) {
      return { success: false, error: 'Not your refinery' };
    }

    node.buildings.refinery.fee = fee;

    // Recompute paths
    this.pathfinder.computeAllPaths(this.nodes, this.edges);

    return { success: true };
  }

  // Get player statistics
  getPlayerStats(playerId) {
    const player = this.players[playerId];

    return {
      cash: player.cash,
      cumulative_profit: player.cumulative_profit,
      profit_this_turn: player.profit_this_turn,
      revenue_this_turn: player.revenue_this_turn,
      costs_this_turn: player.costs_this_turn,
      num_wells: player.assets.wells.length,
      num_refineries: player.assets.refineries.length,
      num_pipelines: player.assets.pipelines.length,
      market_share: player.market_share,
      barrels_sold: player.barrels_sold
    };
  }

  // Get market statistics
  getMarketStats() {
    let totalProduction = 0;
    let totalDemand = 0;

    for (const node of this.nodes) {
      if (node.has_well) {
        totalProduction += node.production_capacity;
      }
      if (node.current_demand) {
        totalDemand += node.current_demand;
      }
    }

    return {
      totalProduction,
      totalDemand,
      netImport: totalDemand - totalProduction,
      globalPrice: this.global_oil_price
    };
  }

  // Get node info
  getNodeInfo(nodeId) {
    return this.nodes[nodeId];
  }

  // Get edge info
  getEdgeInfo(edgeId) {
    return this.edges[edgeId];
  }

  // Save state for history
  saveState() {
    this.turnHistory.push({
      turn: this.turn,
      globalPrice: this.global_oil_price,
      players: this.players.map(p => ({
        id: p.id,
        cash: p.cash,
        profit: p.profit_this_turn,
        cumulative_profit: p.cumulative_profit
      }))
    });
  }
}
