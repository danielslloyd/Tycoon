// UI Controller - Manages user interface
class UIController {
  constructor(gameState) {
    this.gameState = gameState;
    this.currentPlayer = 0;
    this.autoPlay = false;
    this.autoPlayInterval = null;

    this.initEventListeners();
  }

  initEventListeners() {
    // Next turn button
    document.getElementById('next-turn-btn').addEventListener('click', () => {
      if (window.game) {
        window.game.nextTurn();
      }
    });

    // Auto play button
    document.getElementById('auto-play-btn').addEventListener('click', () => {
      this.toggleAutoPlay();
    });

    // Flow map toggle button
    document.getElementById('flow-map-btn').addEventListener('click', () => {
      this.toggleFlowMap();
    });

    // Flow mode toggle button
    document.getElementById('flow-mode-btn').addEventListener('click', () => {
      this.toggleFlowMode();
    });

    // Reset game button
    document.getElementById('reset-game-btn').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset the game?')) {
        if (window.game) {
          window.game.reset();
        }
      }
    });
  }

  // Update all UI elements
  updateUI() {
    this.updateTurnInfo();
    this.updatePlayersList();
    this.updateMarketInfo();
  }

  // Update turn information
  updateTurnInfo() {
    document.getElementById('current-turn').textContent =
      `${this.gameState.turn} / ${this.gameState.settings.GAME_LENGTH_TURNS}`;
    document.getElementById('crude-price').textContent =
      `$${this.gameState.global_crude_price.toFixed(2)}`;
    document.getElementById('refined-price').textContent =
      `$${this.gameState.global_refined_price.toFixed(2)}`;
  }

  // Update players list
  updatePlayersList() {
    const container = document.getElementById('players-list');
    container.innerHTML = '';

    // Sort players by cumulative profit
    const sortedPlayers = [...this.gameState.players].sort(
      (a, b) => b.cumulative_profit - a.cumulative_profit
    );

    for (const player of sortedPlayers) {
      const card = document.createElement('div');
      card.className = 'player-card';
      card.style.borderColor = player.color;

      const profitClass = player.profit_this_turn >= 0 ? 'positive' : 'negative';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: ${player.color}; font-size: 16px;">${player.name}</strong>
          <span class="stat-value ${profitClass}">${formatCurrency(player.profit_this_turn)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Cash:</span>
          <span class="stat-value">${formatCurrency(player.cash)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Total Profit:</span>
          <span class="stat-value ${player.cumulative_profit >= 0 ? 'positive' : 'negative'}">
            ${formatCurrency(player.cumulative_profit)}
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Market Share:</span>
          <span class="stat-value">${player.market_share.toFixed(1)}%</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Assets:</span>
          <span class="stat-value">
            ${player.assets.wells.length}W / ${player.assets.refineries.length}R / ${player.assets.pipelines.length}P
          </span>
        </div>
      `;

      container.appendChild(card);
    }
  }

  // Update market information
  updateMarketInfo() {
    const stats = this.gameState.getMarketStats();

    document.getElementById('total-production').textContent = formatNumber(stats.totalProduction);
    document.getElementById('total-demand').textContent = formatNumber(Math.floor(stats.totalDemand));

    const netImportEl = document.getElementById('net-import');
    netImportEl.textContent = formatNumber(Math.floor(Math.abs(stats.netImport)));
    netImportEl.className = 'stat-value';

    if (stats.netImport > 0) {
      netImportEl.textContent += ' (Import)';
      netImportEl.classList.add('negative');
    } else if (stats.netImport < 0) {
      netImportEl.textContent += ' (Export)';
      netImportEl.classList.add('positive');
    }
  }

  // Show node details
  showNodeDetails(nodeId) {
    const node = this.gameState.nodes[nodeId];
    const section = document.getElementById('selected-node-section');
    const infoContainer = document.getElementById('selected-node-info');
    const actionsContainer = document.getElementById('node-actions');

    section.style.display = 'block';

    let info = `<h3>Node #${nodeId}</h3>`;

    // City type info
    if (node.city_type === 'major') {
      info += `<div class="stat-row">
        <span class="stat-label">City Type:</span>
        <span class="stat-value" style="color: #ffd700">Major City</span>
      </div>`;
    } else if (node.city_type === 'midsize') {
      info += `<div class="stat-row">
        <span class="stat-label">City Type:</span>
        <span class="stat-value" style="color: #ffa500">Midsize City</span>
      </div>`;
    }

    // Production node info
    if (node.type === 'production' || node.production_capacity) {
      info += `<h3 style="color: #4caf50; margin-top: 15px;">Production</h3>`;
      info += `<div class="stat-row">
        <span class="stat-label">Capacity:</span>
        <span class="stat-value">${formatNumber(node.production_capacity)} bbl/turn</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Operating Cost:</span>
        <span class="stat-value">$${node.operating_cost.toFixed(2)}/bbl</span>
      </div>`;

      if (node.has_well) {
        const owner = this.gameState.players[node.well_owner];
        info += `<div class="stat-row">
          <span class="stat-label">Well Owner:</span>
          <span class="stat-value" style="color: ${owner.color}">${owner.name}</span>
        </div>`;
      }
    }

    // Demand info
    if (node.demand_base) {
      info += `<h3 style="color: #2196f3; margin-top: 15px;">Demand</h3>`;
      info += `<div class="stat-row">
        <span class="stat-label">Base Demand:</span>
        <span class="stat-value">${formatNumber(Math.floor(node.demand_base))} bbl/turn</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Current Demand:</span>
        <span class="stat-value">${formatNumber(Math.floor(node.current_demand))} bbl/turn</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Local Price:</span>
        <span class="stat-value">$${node.local_price.toFixed(2)}/bbl</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Growth Rate:</span>
        <span class="stat-value">${(node.demand_growth_rate * 100).toFixed(2)}%/turn</span>
      </div>`;
    }

    // Terminal info
    if (node.type === 'terminal') {
      info += `<div class="stat-row">
        <span class="stat-label">Type:</span>
        <span class="stat-value">Import Terminal</span>
      </div>`;
    }

    // Refinery info
    if (node.buildings.refinery) {
      const ref = node.buildings.refinery;
      const owner = this.gameState.players[ref.owner];
      info += `<h3 style="color: #ffa500; margin-top: 15px;">Refinery</h3>`;
      info += `<div class="stat-row">
        <span class="stat-label">Owner:</span>
        <span class="stat-value" style="color: ${owner.color}">${owner.name}</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Capacity:</span>
        <span class="stat-value">${formatNumber(ref.capacity)} bbl/turn</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Processing Fee:</span>
        <span class="stat-value">$${ref.fee.toFixed(2)}/bbl</span>
      </div>`;
      info += `<div class="stat-row">
        <span class="stat-label">Utilization:</span>
        <span class="stat-value">${(ref.utilization * 100).toFixed(1)}%</span>
      </div>`;
    }

    // Show connected edges and pipeline building options
    info += `<h3 style="color: #9c27b0; margin-top: 15px;">Connected Edges</h3>`;

    const connectedEdges = node.connections.slice(0, 5);  // Show first 5 edges
    for (const edgeId of connectedEdges) {
      const edge = this.gameState.edges[edgeId];
      const otherNodeId = edge.node_a === nodeId ? edge.node_b : edge.node_a;

      info += `<div class="stat-row">
        <span class="stat-label">To Node ${otherNodeId}:</span>`;

      if (edge.transportation.pipeline.owner === null) {
        info += `<span class="stat-value" style="cursor: pointer; text-decoration: underline; color: #4caf50;" onclick="window.game.uiController.buildPipelineOnEdge(${edgeId})">Build Pipeline ($${(this.gameState.settings.PIPELINE_COST_PER_EDGE / 1000000).toFixed(1)}M)</span>`;
      } else {
        const owner = this.gameState.players[edge.transportation.pipeline.owner];
        info += `<span class="stat-value" style="color: ${owner.color}">${owner.name}'s Pipeline</span>`;
      }

      info += `</div>`;
    }

    if (node.connections.length > 5) {
      info += `<div class="stat-row"><span class="stat-label">... and ${node.connections.length - 5} more edges</span></div>`;
    }

    infoContainer.innerHTML = info;

    // Build action buttons
    actionsContainer.innerHTML = '';

    // Build well button
    if (node.type === 'production' && !node.has_well) {
      const btn = document.createElement('button');
      btn.textContent = `Build Well ($${(node.well_build_cost / 1000000).toFixed(1)}M)`;
      btn.onclick = () => this.buildWell(nodeId);
      actionsContainer.appendChild(btn);
    }

    // Build refinery button
    if (!node.buildings.refinery) {
      const btn = document.createElement('button');
      btn.textContent = `Build Refinery ($${(this.gameState.settings.REFINERY_BUILD_COST / 1000000).toFixed(0)}M)`;
      btn.onclick = () => this.buildRefinery(nodeId);
      actionsContainer.appendChild(btn);
    }

    // Upgrade refinery button
    if (node.buildings.refinery && node.buildings.refinery.owner === this.currentPlayer) {
      const btn = document.createElement('button');
      const cost = this.gameState.settings.REFINERY_BUILD_COST *
                   this.gameState.settings.REFINERY_UPGRADE_COST_MULTIPLIER;
      btn.textContent = `Upgrade Refinery ($${(cost / 1000000).toFixed(1)}M)`;
      btn.onclick = () => this.upgradeRefinery(nodeId);
      actionsContainer.appendChild(btn);
    }
  }

  // Build pipeline on edge
  buildPipelineOnEdge(edgeId) {
    const result = this.gameState.buildPipeline(this.currentPlayer, edgeId);

    if (result.success) {
      this.showToast('Pipeline built successfully!');
      this.updateUI();
      if (window.game && window.game.renderer) {
        window.game.renderer.update();
      }
      // Refresh the selected node details
      if (this.gameState.selectedNode !== null) {
        this.showNodeDetails(this.gameState.selectedNode);
      }
    } else {
      this.showToast(result.error, true);
    }
  }

  // Build well action
  buildWell(nodeId) {
    const result = this.gameState.buildWell(this.currentPlayer, nodeId);

    if (result.success) {
      this.showToast('Well built successfully!');
      this.updateUI();
      this.showNodeDetails(nodeId);
      if (window.game && window.game.renderer) {
        window.game.renderer.update();
      }
    } else {
      this.showToast(result.error, true);
    }
  }

  // Build refinery action
  buildRefinery(nodeId) {
    const result = this.gameState.buildRefinery(this.currentPlayer, nodeId);

    if (result.success) {
      this.showToast('Refinery built successfully!');
      this.updateUI();
      this.showNodeDetails(nodeId);
      if (window.game && window.game.renderer) {
        window.game.renderer.update();
      }
    } else {
      this.showToast(result.error, true);
    }
  }

  // Upgrade refinery action
  upgradeRefinery(nodeId) {
    const result = this.gameState.upgradeRefinery(this.currentPlayer, nodeId);

    if (result.success) {
      this.showToast('Refinery upgraded successfully!');
      this.updateUI();
      this.showNodeDetails(nodeId);
    } else {
      this.showToast(result.error, true);
    }
  }

  // Show toast notification
  showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#e94560' : '#4caf50';
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // Toggle auto play
  toggleAutoPlay() {
    this.autoPlay = !this.autoPlay;
    const btn = document.getElementById('auto-play-btn');

    if (this.autoPlay) {
      btn.textContent = 'Stop Auto Play';
      btn.style.background = '#e94560';
      this.autoPlayInterval = setInterval(() => {
        if (window.game) {
          window.game.nextTurn();
        }
      }, 1000);
    } else {
      btn.textContent = 'Auto Play';
      btn.style.background = '#0f3460';
      if (this.autoPlayInterval) {
        clearInterval(this.autoPlayInterval);
        this.autoPlayInterval = null;
      }
    }
  }

  // Show game over screen
  showGameOver(winner) {
    this.autoPlay = false;
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
    }

    const message = `Game Over!\n\nWinner: ${winner.name}\nTotal Profit: ${formatCurrency(winner.cumulative_profit)}`;
    alert(message);
  }

  // Hide loading screen
  hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.style.display = 'none';
    }
  }

  // Toggle flow map visualization
  toggleFlowMap() {
    this.gameState.showFlowMap = !this.gameState.showFlowMap;
    const btn = document.getElementById('flow-map-btn');

    if (this.gameState.showFlowMap) {
      btn.style.background = '#e94560';
      btn.textContent = 'Hide Flow Map';
      this.showToast('Flow map enabled - edges show oil flow volume');
    } else {
      btn.style.background = '#0f3460';
      btn.textContent = 'Toggle Flow Map';
      this.showToast('Flow map disabled');
    }

    // Update renderer
    if (window.game && window.game.renderer) {
      window.game.renderer.update();
    }
  }

  // Toggle flow map mode between crude and refined
  toggleFlowMode() {
    if (window.game && window.game.renderer) {
      window.game.renderer.toggleFlowMapMode();
      const btn = document.getElementById('flow-mode-btn');
      const mode = window.game.renderer.flowMapMode;
      btn.textContent = `Flow Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
      this.showToast(`Flow map mode: ${mode}`);
    }
  }
}
