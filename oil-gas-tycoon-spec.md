# Oil & Gas Tycoon - Game Design Specification

## Overview
Turn-based economic strategy game where 4 players compete to build oil extraction, refining, and distribution networks. Most profit after a set number of turns wins.

## Configuration (settings.js)

All game parameters should be centralized in a settings file:

```javascript
GAME_SETTINGS = {
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
  INITIAL_OIL_PRICE: 100,  // $100/barrel
  PRICE_VOLATILITY: 0.02,  // ±2% per turn
  TERMINAL_FEE: 5,  // $ per barrel at import/export
  
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
}
```

## Map Generation

### Node Distribution (~500 nodes)
- **Coordinates**: 2D plane, distribute points with Poisson disk sampling or blue noise
- **Edge Generation**: Delaunay triangulation to ensure reasonable edge lengths
- **Node Types**:
  - **Production Nodes** (~10% = 50 nodes): Interior bias
    - Production capacity: Lognormal distribution (highly varied - few high producers, many low)
    - Each has: build cost ($5M) + operating cost ($20-60/barrel, inversely correlated with capacity)
  - **Demand Nodes** (all nodes): Exterior bias for high demand
    - Demand: Pareto distribution (few large cities, many small)
    - Each has unique growth rate (0.5% - 3% per turn) with random fluctuations (±10%)
  - **Import Terminals**: 10 outer nodes, evenly spaced around perimeter
    - Infinite supply at global_price + $5 terminal fee

### Initial Transportation Network
- **Rail Network**: Connects only the 5 largest demand nodes at game start
  - Cost: $1 per barrel per edge
  - Pre-existing infrastructure (no build cost)
- **Trucking**: Available on ALL edges
  - Cost: $3 per barrel per edge
  - Represents default transportation option

### Distance Calculation
- Graph edge count (not Euclidean) for transportation costs
- Each edge = 1 unit of distance for cost calculations

## Game Objects

### Wells (on Production Nodes)
- **Build Cost**: $5M (fixed)
- **Operating Cost**: $20-60/barrel (varies by node, lower for high-capacity nodes)
- **Capacity**: Barrels per turn (Lognormal: mean ~5k, some up to 50k)
- Once built, produces crude automatically each turn

### Pipelines (on Edges)
- **Build Cost**: $1M per edge
- **Capacity**: 20,000 barrels per turn (configurable in settings)
- **Shipping Fee**: Owner sets $/barrel/edge (default $0.50, applies to all players)
- **Construction Time**: Instant (built on turn of purchase)
- Bidirectional flow

### Refineries (on any Node)
- **Build Cost**: $10M (base)
- **Upgrade Cost**: $6M (60% of base cost) for capacity doubling
- **Capacity**: 10,000 barrels per turn (base, doubles with each upgrade)
- **Operating Cost**: $10/barrel refined
- **Processing Fee**: Owner sets $/barrel (applies to all players, default $5)
- Input: crude oil → Output: refined product (1:1 ratio)

### Storage Facilities (on any Node)
- **Build Cost**: $1,000 per barrel capacity
- **Marginal Storage Cost**: $0 for owner
- Allows buffering supply/demand mismatches across turns

### Terminals (Import/Export)
- **Pre-existing**: 10 import terminals at outer nodes
- **Function**: 
  - Import: Supply demand at global_price + $5 terminal fee + transportation cost to demand
  - Export: Absorb excess production when production > demand
  - Price for export: global_price - $5 terminal fee

## Economic Model

### Cost Calculation & Routing
Each barrel's cost = well operating cost + transportation costs + refinery cost

**Transportation cost calculation**:
- Sum of costs along path: Σ(cost_per_edge)
- Edge costs:
  - Trucking: $3/edge (available everywhere)
  - Rail: $1/edge (only on 5 largest demand nodes initially)
  - Pipeline: Owner-set fee/edge (default $0.50, player adjustable)

**Pathfinding**: 
- Use Dijkstra or Floyd-Warshall to find minimum cost route
- Priority: lowest total cost from production → refinery → demand
- Not time-critical, optimize for best solution

**Local Price at Demand Node**:
- Option 1: Nearest import terminal: global_price + $5 + path_cost
- Option 2: Player supply: well_operating_cost + transport_to_refinery + refinery_operating_cost + refinery_fee + transport_to_demand + pipeline_fees
- Demand satisfied by lowest cost option

### Global Oil Price
- **Starting Price**: $100/barrel
- **Evolution**: Random walk each turn (±2% with optional drift)
- Affects all import/export terminal prices

### Supply & Demand
- **Demand Elasticity**: demand_actual = base_demand × (100 / local_price)^0.3
- **Economy Growth**: Each demand node grows at unique rate (0.5-3%/turn) ± 10% fluctuation
- **Net Import/Export**: 
  - If total production < total demand: Import terminals fill gap
  - If total production > total demand: Export terminals absorb excess at global_price - $5

### Revenue & Costs
- **Revenue Sources**:
  - Selling refined product to demand nodes
  - Pipeline shipping fees (from other players)
  - Refinery processing fees (from other players)
- **Costs**:
  - Well operating costs ($/barrel produced)
  - Refinery operating costs ($/barrel refined)
  - Construction (wells, pipelines, refineries, storage)
  - Using other players' infrastructure
  - Rail/trucking shipping costs

## Turn Structure

### Starting Phase
- **Auction**: Players bid for starting positions, OR
- **Equal Start**: All players start with $50M cash, no assets
- **Initial State**: 
  - No wells built
  - No player-owned pipelines
  - Rail connects 5 largest demand nodes
  - Trucking available on all edges

### Turn Sequence (Simultaneous)
1. **Player Action Phase**: All players simultaneously:
   - Build wells, pipelines, refineries, storage
   - Upgrade refineries
   - Set pipeline/refinery fees
   - (Routing is automatic based on cost minimization)
   
2. **Resolution Phase** (automated):
   - Global price update (random walk ±2%)
   - Wells produce crude
   - **Flow routing**: For each barrel of crude:
     - Find minimum cost path: production → any refinery → any demand
     - Consider all transportation options (truck/rail/pipeline)
     - Route automatically uses cheapest available path
   - Refining (crude → refined product)
   - **Demand satisfaction**: 
     - Calculate local price at each demand node
     - Apply elasticity: demand_actual = base × (100/price)^0.3
     - Consume refined product
   - Import/export balancing (terminals fill shortfalls or absorb excess)
   - Revenue/cost settlement for all players
   - Demand growth update (apply growth rates + fluctuations)

3. **Status Display**:
   - Profit this turn
   - Cumulative profit
   - Market share
   - Asset utilization

4. **Next Turn**: Repeat

## Technical Requirements

### Rendering (Three.js)
- **Scene Setup**: 
  - Orthographic or perspective camera
  - 2D graph rendered in 3D space (z=0 plane)
- **Nodes**: 
  - Spheres or circles, colored by type
  - Size scaled by production capacity or demand
  - Highlight player-owned buildings
- **Edges**: 
  - Lines between connected nodes
  - Color-coded by transportation type:
    - Gray: truck-only
    - Brown: rail available
    - Player color: pipeline (thickness = utilization)
- **Overlays**:
  - Local price heatmap (color gradient)
  - Flow visualization (animated particles along edges)
- **UI Elements**: 
  - Build menus (HTML overlay)
  - Financial dashboard
  - Turn counter
  - Player stats panel

### Data Structures
```javascript
Node {
  id, x, y, type,
  // Production nodes
  production_capacity, well_build_cost, operating_cost,
  has_well, well_owner,
  // Demand nodes
  demand_base, demand_growth_rate, current_demand,
  // All nodes
  buildings: {refinery: {owner, capacity, fee}, storage: {owner, capacity}},
  connections: [edge_ids],
  // Calculated
  local_price, supply_source
}

Edge {
  id, node_a, node_b, length: 1,
  transportation: {
    truck: {available: true, cost: 3},
    rail: {available: boolean, cost: 1},
    pipeline: {owner: player_id | null, capacity, fee}
  }
}

Player {
  id, name, color,
  cash, 
  assets: {wells: [], refineries: [], pipelines: [], storage: []},
  revenue_this_turn, costs_this_turn,
  profit_history: []
}

GameState {
  turn, global_oil_price,
  players: [],
  nodes: [],
  edges: [],
  settings: GAME_SETTINGS
}
```

### Pathfinding Algorithm
- **Algorithm**: Dijkstra or Floyd-Warshall (pre-compute all pairs)
- **Graph**: Weighted directed graph where edge weight = transportation cost
- **Optimization**: Since graph is small (~500 nodes), prioritize finding optimal solution
- **Two-stage routing**:
  1. Production node → Refinery (crude transport)
  2. Refinery → Demand node (refined product transport)
- Each barrel independently finds minimum cost path

### Game Flow
```
Initialize Game
├─ Generate map (Poisson disk + Delaunay)
├─ Assign node types and parameters
├─ Create initial rail network (5 largest demand nodes)
├─ Initialize players ($50M each)
└─ Set global oil price ($100)

Game Loop (each turn):
├─ Player Action Phase (simultaneous)
│  ├─ Build/upgrade infrastructure
│  └─ Set fees
├─ Resolution Phase
│  ├─ Update global oil price (random walk)
│  ├─ Production (wells → crude)
│  ├─ Pathfinding (minimize cost for each barrel)
│  ├─ Flow & refining
│  ├─ Demand satisfaction (with elasticity)
│  ├─ Import/export balancing
│  ├─ Calculate revenues & costs
│  └─ Update demand growth
└─ Check win condition (turn limit reached)

End Game: Declare winner (highest cumulative profit)
```

## Win Condition
**Highest cumulative profit** (total revenue - total costs) after 150 turns

---

## Implementation Notes for Claude Code

1. **Start with map generation**: Poisson disk sampling → Delaunay triangulation → assign node types
2. **Build game state manager**: Centralized state with immutable updates
3. **Implement pathfinding**: Floyd-Warshall for all-pairs shortest paths (recompute when pipelines built)
4. **Create Three.js renderer**: Simple node/edge visualization first, add overlays later
5. **Build turn resolution engine**: Step through production → routing → demand satisfaction
6. **Add UI controls**: Click nodes to build, buttons for infrastructure, player dashboard
7. **Test with simplified parameters**: Start with fewer nodes to verify logic

**Key files**:
- `settings.js` - All configurable parameters
- `mapGenerator.js` - Node/edge generation
- `gameState.js` - State management
- `pathfinding.js` - Dijkstra/Floyd-Warshall
- `turnResolver.js` - Simulation logic
- `renderer.js` - Three.js visualization
- `ui.js` - Player controls and dashboards

---

## Game Balance Considerations

### Starting Strategy
Players must decide early:
- Invest in production (wells) vs. infrastructure (pipelines/refineries)?
- Build own refinery or use competitors' for fees?
- Focus on high-demand nodes or build production empire?

### Economic Tradeoffs
- **Pipelines**: High upfront ($1M/edge) but low operating cost ($0.50/barrel/edge default)
- **Trucking**: Zero upfront, expensive operating cost ($3/barrel/edge)
- **Rail**: Zero upfront, moderate operating cost ($1/barrel/edge), limited availability
- **Wells**: $5M upfront, $20-60/barrel operating (vary by node quality)
- **Refineries**: $10M upfront, $10/barrel operating, earn fees from other players

### Competitive Dynamics
- Players can undercut import terminals by building efficient infrastructure
- Pipeline owners control key routes and can set monopolistic fees
- Refinery owners can create bottlenecks or offer competitive rates
- Storage enables buying low/selling high based on price fluctuations

### Victory Path Examples
1. **Production Mogul**: Build many wells, use others' infrastructure, profit on supply
2. **Infrastructure Baron**: Build key pipelines/refineries, earn fees from all players
3. **Integrated Giant**: Vertical integration from well → pipeline → refinery → demand
4. **Opportunist**: Exploit price swings with storage, arbitrage between nodes

---

**Ready for implementation in Claude Code!**
