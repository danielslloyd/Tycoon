// Game Settings - All configurable parameters
const GAME_SETTINGS = {
  // Starting conditions
  STARTING_CAPITAL: 50_000_000,  // $50M per player
  NUM_PLAYERS: 4,
  GAME_LENGTH_TURNS: 150,

  // Map generation
  NUM_NODES: 500,
  PRODUCTION_NODE_PERCENTAGE: 0.10,  // 10% are production nodes
  NUM_IMPORT_TERMINALS: 10,

  // Build costs
  WELL_BUILD_COST: 5_000_000,  // $5M
  REFINERY_BUILD_COST: 10_000_000,  // $10M
  REFINERY_UPGRADE_COST_MULTIPLIER: 0.6,  // 60% of base cost
  PIPELINE_COST_PER_EDGE: 1_000_000,  // $1M per edge
  STORAGE_COST_PER_BARREL: 1000,  // $1k per barrel capacity

  // Operating costs
  WELL_OPERATING_COST_MIN: 20,  // $ per barrel
  WELL_OPERATING_COST_MAX: 60,  // $ per barrel
  REFINERY_OPERATING_COST: 10,  // $ per barrel

  // Transportation costs (per barrel per edge)
  RAIL_COST_PER_EDGE: 1,  // $1/barrel/edge
  TRUCK_COST_PER_EDGE: 3,  // $3/barrel/edge
  PIPELINE_DEFAULT_FEE: 0.5,  // $0.50/barrel/edge (player adjustable)

  // Oil pricing
  INITIAL_CRUDE_PRICE: 70,  // $70/barrel for crude
  INITIAL_REFINED_PRICE: 100,  // $100/barrel for refined
  PRICE_VOLATILITY: 0.02,  // ±2% per turn
  TERMINAL_FEE: 5,  // $ per barrel at import/export

  // Price-driven demand parameters
  BASE_TOTAL_DEMAND: 500000,  // Base total demand at reference price
  REFERENCE_PRICE: 100,  // Reference price for demand calculation

  // Demand parameters
  DEMAND_ELASTICITY: 0.3,
  DEMAND_GROWTH_MIN: 0.005,  // 0.5% per turn
  DEMAND_GROWTH_MAX: 0.03,   // 3% per turn
  DEMAND_FLUCTUATION: 0.1,   // ±10% random variation

  // Capacities (barrels per turn)
  WELL_CAPACITY_MIN: 1000,
  WELL_CAPACITY_MAX: 50000,
  REFINERY_BASE_CAPACITY: 10000,
  PIPELINE_BASE_CAPACITY: 20000,

  // Map generation parameters
  MAP_WIDTH: 2000,
  MAP_HEIGHT: 2000,
  POISSON_RADIUS: 60,  // Minimum distance between points

  // Player colors
  PLAYER_COLORS: [
    '#e94560',  // Red
    '#4caf50',  // Green
    '#2196f3',  // Blue
    '#ffa500'   // Orange
  ]
};

// Utility functions for random distributions
const RandomUtils = {
  // Lognormal distribution for production capacity
  lognormal(mean, stddev) {
    const mu = Math.log(mean);
    const sigma = stddev;
    const u = Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.exp(mu + sigma * z);
  },

  // Pareto distribution for demand
  pareto(scale, alpha) {
    const u = Math.random();
    return scale / Math.pow(u, 1 / alpha);
  },

  // Random in range
  range(min, max) {
    return min + Math.random() * (max - min);
  },

  // Random walk for oil price
  randomWalk(current, volatility) {
    const change = (Math.random() - 0.5) * 2 * volatility;
    return current * (1 + change);
  },

  // Box-Muller transform for normal distribution
  normal(mean = 0, stddev = 1) {
    const u = Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stddev;
  }
};

// Format currency
function formatCurrency(amount) {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  } else if (Math.abs(amount) >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  return `$${amount.toFixed(2)}`;
}

// Format number with commas
function formatNumber(num) {
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
