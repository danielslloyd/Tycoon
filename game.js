// Main Game Controller
class Game {
  constructor() {
    this.gameState = null;
    this.turnResolver = null;
    this.renderer = null;
    this.uiController = null;

    this.init();
  }

  // Initialize the game
  async init() {
    console.log('Initializing Oil & Gas Tycoon...');

    try {
      // Create game state
      this.gameState = new GameState(GAME_SETTINGS);

      // Initialize game state (generate map, create players)
      this.gameState.initialize();

      // Create turn resolver
      this.turnResolver = new TurnResolver(this.gameState);

      // Create UI controller
      this.uiController = new UIController(this.gameState);

      // Create renderer
      const container = document.getElementById('canvas-container');
      this.renderer = new Renderer(this.gameState, container);

      // Create map visualization
      this.renderer.createMap();

      // Update UI
      this.uiController.updateUI();

      // Hide loading screen
      this.uiController.hideLoading();

      console.log('Game initialized successfully!');
    } catch (error) {
      console.error('Error initializing game:', error);
      alert('Error initializing game. Check console for details.');
    }
  }

  // Process next turn
  nextTurn() {
    if (this.turnResolver.isGameOver()) {
      const winner = this.turnResolver.getWinner();
      this.uiController.showGameOver(winner);
      return;
    }

    // Process turn
    this.turnResolver.processTurn();

    // Update visualization
    this.renderer.update();

    // Update UI
    this.uiController.updateUI();

    // Check for game over
    if (this.turnResolver.isGameOver()) {
      const winner = this.turnResolver.getWinner();
      this.uiController.showGameOver(winner);
    }
  }

  // Handle node selection
  onNodeSelected(nodeId) {
    this.uiController.showNodeDetails(nodeId);
  }

  // Reset game
  reset() {
    // Clear renderer
    if (this.renderer) {
      this.renderer.clearMap();
    }

    // Re-initialize
    this.init();
  }

  // AI player actions (simple AI)
  aiPlayerAction(playerId) {
    const player = this.gameState.players[playerId];

    // Simple AI strategy:
    // 1. Build wells on high-capacity production nodes
    // 2. Build refineries near production clusters
    // 3. Build pipelines on profitable routes

    // Find best production node to build well
    let bestWellNode = null;
    let bestWellValue = 0;

    for (const node of this.gameState.nodes) {
      if (node.type === 'production' && !node.has_well) {
        // Value = capacity / operating_cost
        const value = node.production_capacity / node.operating_cost;

        if (value > bestWellValue && player.cash >= node.well_build_cost) {
          bestWellValue = value;
          bestWellNode = node.id;
        }
      }
    }

    if (bestWellNode !== null && Math.random() > 0.3) {
      this.gameState.buildWell(playerId, bestWellNode);
      console.log(`AI Player ${playerId} built well at node ${bestWellNode}`);
    }

    // Find best node to build refinery
    let bestRefineryNode = null;
    let bestRefineryValue = 0;

    for (const node of this.gameState.nodes) {
      if (!node.buildings.refinery) {
        // Value based on nearby demand
        let nearbyDemand = 0;

        for (const otherNode of this.gameState.nodes) {
          if (otherNode.demand_base) {
            const dist = this.gameState.pathfinder.getCost(node.id, otherNode.id);
            if (dist < 5) {
              nearbyDemand += otherNode.demand_base / (dist + 1);
            }
          }
        }

        if (nearbyDemand > bestRefineryValue && player.cash >= GAME_SETTINGS.REFINERY_BUILD_COST) {
          bestRefineryValue = nearbyDemand;
          bestRefineryNode = node.id;
        }
      }
    }

    if (bestRefineryNode !== null && Math.random() > 0.7) {
      this.gameState.buildRefinery(playerId, bestRefineryNode);
      console.log(`AI Player ${playerId} built refinery at node ${bestRefineryNode}`);
    }

    // Occasionally upgrade refineries
    for (const refineryId of player.assets.refineries) {
      const node = this.gameState.nodes[refineryId];
      if (node.buildings.refinery && Math.random() > 0.9) {
        const cost = GAME_SETTINGS.REFINERY_BUILD_COST * GAME_SETTINGS.REFINERY_UPGRADE_COST_MULTIPLIER;
        if (player.cash >= cost) {
          this.gameState.upgradeRefinery(playerId, refineryId);
          console.log(`AI Player ${playerId} upgraded refinery at node ${refineryId}`);
        }
      }
    }

    // Build pipelines on high-traffic routes
    if (player.cash >= GAME_SETTINGS.PIPELINE_COST_PER_EDGE && Math.random() > 0.8) {
      // Find edges with no pipeline that connect player assets
      for (const edge of this.gameState.edges) {
        if (edge.transportation.pipeline.owner === null) {
          const nodeA = this.gameState.nodes[edge.node_a];
          const nodeB = this.gameState.nodes[edge.node_b];

          // Check if this edge connects interesting nodes
          const isInteresting = (nodeA.has_well && nodeA.well_owner === playerId) ||
                               (nodeB.has_well && nodeB.well_owner === playerId) ||
                               (nodeA.buildings.refinery && nodeA.buildings.refinery.owner === playerId) ||
                               (nodeB.buildings.refinery && nodeB.buildings.refinery.owner === playerId);

          if (isInteresting && Math.random() > 0.5) {
            this.gameState.buildPipeline(playerId, edge.id);
            console.log(`AI Player ${playerId} built pipeline on edge ${edge.id}`);
            break;
          }
        }
      }
    }
  }
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();

  // Add keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      window.game.nextTurn();
    }
  });

  // Process AI players every turn
  const originalNextTurn = window.game.nextTurn.bind(window.game);
  window.game.nextTurn = function() {
    // AI players make moves (players 1-3, player 0 is human)
    for (let i = 1; i < GAME_SETTINGS.NUM_PLAYERS; i++) {
      window.game.aiPlayerAction(i);
    }

    // Process turn
    originalNextTurn();
  };
});
