// Turn Resolver - Handles game simulation for each turn
class TurnResolver {
  constructor(gameState) {
    this.gameState = gameState;
  }

  // Process a complete turn
  processTurn() {
    console.log(`Processing turn ${this.gameState.turn + 1}`);

    // Reset player turn stats
    for (const player of this.gameState.players) {
      player.revenue_this_turn = 0;
      player.costs_this_turn = 0;
      player.profit_this_turn = 0;
      player.barrels_sold = 0;
    }

    // Reset refinery and pipeline utilization
    for (const node of this.gameState.nodes) {
      if (node.buildings.refinery) {
        node.buildings.refinery.utilization = 0;
        node.buildings.refinery.barrels_processed = 0;
      }
    }

    for (const edge of this.gameState.edges) {
      if (edge.transportation.pipeline.owner !== null) {
        edge.transportation.pipeline.utilization = 0;
      }
    }

    // 1. Update global oil price (random walk)
    this.updateGlobalPrice();

    // 2. Production phase - wells produce crude
    const production = this.productionPhase();

    // 3. Demand calculation with elasticity
    this.updateDemand();

    // 4. Route and satisfy demand
    this.routeAndSatisfyDemand(production);

    // 5. Update demand growth
    this.updateDemandGrowth();

    // 6. Calculate player profits
    this.calculatePlayerProfits();

    // 7. Calculate market share
    this.calculateMarketShare();

    // Save state
    this.gameState.saveState();

    // Increment turn
    this.gameState.turn++;

    console.log(`Turn ${this.gameState.turn} completed`);
  }

  // Update global oil price with random walk
  updateGlobalPrice() {
    this.gameState.global_oil_price = RandomUtils.randomWalk(
      this.gameState.global_oil_price,
      this.gameState.settings.PRICE_VOLATILITY
    );

    // Keep price in reasonable range
    this.gameState.global_oil_price = Math.max(50, Math.min(200, this.gameState.global_oil_price));
  }

  // Production phase - wells produce crude oil
  productionPhase() {
    const production = [];

    for (const node of this.gameState.nodes) {
      if (node.has_well && node.production_capacity) {
        production.push({
          nodeId: node.id,
          owner: node.well_owner,
          capacity: node.production_capacity,
          operating_cost: node.operating_cost
        });

        // Charge operating costs to well owner
        const player = this.gameState.players[node.well_owner];
        const operatingCost = node.production_capacity * node.operating_cost;
        player.costs_this_turn += operatingCost;
      }
    }

    return production;
  }

  // Update demand with elasticity
  updateDemand() {
    for (const node of this.gameState.nodes) {
      if (node.demand_base) {
        // Calculate local price
        const localPrice = this.gameState.pathfinder.calculateLocalPrice(
          node.id,
          this.gameState.global_oil_price,
          this.gameState.settings.TERMINAL_FEE,
          this.gameState.nodes
        );

        node.local_price = localPrice;

        // Apply demand elasticity: demand = base_demand × (100 / price)^elasticity
        const priceRatio = 100 / localPrice;
        const elasticity = this.gameState.settings.DEMAND_ELASTICITY;
        node.current_demand = node.demand_base * Math.pow(priceRatio, elasticity);
      }
    }
  }

  // Route production to satisfy demand
  routeAndSatisfyDemand(production) {
    const settings = this.gameState.settings;
    const nodes = this.gameState.nodes;
    const pathfinder = this.gameState.pathfinder;

    // For each demand node, find cheapest supply
    for (const demandNode of nodes) {
      if (!demandNode.current_demand) continue;

      const supplyRoute = pathfinder.findCheapestSupply(
        demandNode.id,
        this.gameState.global_oil_price,
        settings.TERMINAL_FEE,
        settings,
        nodes
      );

      demandNode.supply_source = supplyRoute;

      if (supplyRoute.type === 'import') {
        // Demand satisfied by import terminal
        continue;
      }

      // Player supply route
      const prodNode = nodes[supplyRoute.production];
      const refNode = nodes[supplyRoute.refinery];
      const barrels = Math.min(
        demandNode.current_demand,
        prodNode.production_capacity,
        refNode.buildings.refinery.capacity
      );

      if (barrels <= 0) continue;

      // Calculate revenues and costs
      const salePrice = demandNode.local_price;
      const wellOwner = this.gameState.players[prodNode.well_owner];
      const refineryOwner = this.gameState.players[refNode.buildings.refinery.owner];

      // Well owner sells to refinery
      const crudePrice = prodNode.operating_cost +
                        pathfinder.getCost(supplyRoute.production, supplyRoute.refinery);

      // Refinery owner sells refined product to demand
      const refinedPrice = salePrice;
      const refineryCost = settings.REFINERY_OPERATING_COST +
                          refNode.buildings.refinery.fee +
                          pathfinder.getCost(supplyRoute.refinery, supplyRoute.demand);

      // Revenue to well owner
      wellOwner.revenue_this_turn += barrels * crudePrice;
      wellOwner.barrels_sold += barrels;

      // Revenue to refinery owner
      refineryOwner.revenue_this_turn += barrels * (refinedPrice - crudePrice);
      refineryOwner.costs_this_turn += barrels * refineryCost;
      refineryOwner.barrels_sold += barrels;

      // Track pipeline usage and fees
      this.trackInfrastructureUsage(supplyRoute, barrels);

      // Update refinery utilization
      refNode.buildings.refinery.barrels_processed += barrels;
      refNode.buildings.refinery.utilization = refNode.buildings.refinery.barrels_processed /
                                               refNode.buildings.refinery.capacity;
    }
  }

  // Track infrastructure usage and collect fees
  trackInfrastructureUsage(route, barrels) {
    // Route from production to refinery
    const prodToRefRoute = this.gameState.pathfinder.getDetailedRoute(
      route.production,
      route.refinery
    );

    if (prodToRefRoute) {
      this.trackRouteUsage(prodToRefRoute, barrels);
    }

    // Route from refinery to demand
    const refToDemandRoute = this.gameState.pathfinder.getDetailedRoute(
      route.refinery,
      route.demand
    );

    if (refToDemandRoute) {
      this.trackRouteUsage(refToDemandRoute, barrels);
    }
  }

  // Track usage on a specific route
  trackRouteUsage(route, barrels) {
    for (const edgeId of route.edges) {
      const edge = this.gameState.edges[edgeId];

      // Track pipeline usage and fees
      if (edge.transportation.pipeline.owner !== null) {
        edge.transportation.pipeline.utilization += barrels;

        // Pipeline owner earns fees
        const pipelineOwner = this.gameState.players[edge.transportation.pipeline.owner];
        const fee = barrels * edge.transportation.pipeline.fee;
        pipelineOwner.revenue_this_turn += fee;
      }
    }
  }

  // Update demand growth with fluctuations
  updateDemandGrowth() {
    for (const node of this.gameState.nodes) {
      if (node.demand_base) {
        // Apply growth rate with random fluctuation
        const growthRate = node.demand_growth_rate;
        const fluctuation = (Math.random() - 0.5) * 2 * this.gameState.settings.DEMAND_FLUCTUATION;
        const actualGrowth = growthRate + fluctuation;

        node.demand_base *= (1 + actualGrowth);
      }
    }
  }

  // Calculate player profits
  calculatePlayerProfits() {
    for (const player of this.gameState.players) {
      player.profit_this_turn = player.revenue_this_turn - player.costs_this_turn;
      player.cash += player.profit_this_turn;
      player.cumulative_profit += player.profit_this_turn;
      player.profit_history.push(player.profit_this_turn);
    }
  }

  // Calculate market share
  calculateMarketShare() {
    const totalBarrels = this.gameState.players.reduce((sum, p) => sum + p.barrels_sold, 0);

    if (totalBarrels > 0) {
      for (const player of this.gameState.players) {
        player.market_share = (player.barrels_sold / totalBarrels) * 100;
      }
    }
  }

  // Get winner
  getWinner() {
    let winner = this.gameState.players[0];

    for (const player of this.gameState.players) {
      if (player.cumulative_profit > winner.cumulative_profit) {
        winner = player;
      }
    }

    return winner;
  }

  // Check if game is over
  isGameOver() {
    return this.gameState.turn >= this.gameState.settings.GAME_LENGTH_TURNS;
  }
}
