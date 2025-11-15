# Oil & Gas Tycoon

A turn-based economic strategy game where 4 players compete to build oil extraction, refining, and distribution networks. The player with the most profit after 150 turns wins!

## Game Overview

Build an oil empire by:
- **Building Wells** on production nodes to extract crude oil
- **Constructing Refineries** to process crude into refined products
- **Laying Pipelines** for efficient transportation
- **Managing Infrastructure** to maximize profits

## How to Play

### Starting the Game

1. Open `index.html` in a web browser
2. The game will automatically generate a map with 500 nodes
3. You are Player 1 (red), competing against 3 AI players

### Controls

- **Click on nodes** to select them and view details
- **Next Turn** button: Process one turn
- **Auto Play** button: Automatically advance turns
- **Space bar**: Quick shortcut to advance turn
- **Reset Game**: Start a new game

### Building Infrastructure

When you select a node, you can:

1. **Build a Well** (Production nodes only)
   - Cost: $5M
   - Produces crude oil each turn
   - Operating cost varies by node ($20-60/barrel)

2. **Build a Refinery** (Any node)
   - Cost: $10M
   - Processes crude into refined products
   - Can be upgraded to double capacity ($6M)

3. **Build Pipelines** (On edges between nodes)
   - Cost: $1M per edge
   - Lower transportation costs than trucks/rail

### Game Mechanics

#### Transportation
- **Trucks**: Available everywhere, $3/barrel/edge
- **Rail**: Connects 5 largest cities, $1/barrel/edge
- **Pipelines**: Player-built, ~$0.50/barrel/edge (adjustable)

#### Economics
- **Global Oil Price**: Starts at $100/barrel, fluctuates ±2% per turn
- **Demand Elasticity**: Higher prices reduce demand
- **Demand Growth**: Each node grows 0.5-3% per turn
- **Local Prices**: Import cost + transportation cost

#### Revenue Sources
- Selling refined products to demand nodes
- Pipeline fees (when other players use your pipelines)
- Refinery fees (when other players use your refineries)

#### Strategy Tips
1. **Early Game**: Build wells on high-capacity, low-cost nodes
2. **Mid Game**: Construct refineries near production clusters
3. **Late Game**: Build pipelines for long-term cost savings
4. **Always**: Watch your cash flow and competitor movements

## File Structure

```
├── index.html          # Main HTML file
├── settings.js         # Game configuration parameters
├── mapGenerator.js     # Poisson disk sampling + Delaunay triangulation
├── gameState.js        # State management
├── pathfinding.js      # Floyd-Warshall pathfinding algorithm
├── turnResolver.js     # Turn simulation logic
├── renderer.js         # Three.js visualization
├── ui.js              # UI controls and dashboards
├── game.js            # Main game controller
└── README.md          # This file
```

## Technical Details

### Map Generation
- **Poisson Disk Sampling**: Evenly distributes 500 nodes
- **Delaunay Triangulation**: Creates realistic edge connections
- **Node Types**:
  - Production nodes (10%): Interior bias, lognormal capacity distribution
  - Demand nodes (all nodes): Exterior bias, Pareto distribution
  - Import terminals (10): Evenly spaced around perimeter

### Pathfinding
- **Floyd-Warshall Algorithm**: Computes all-pairs shortest paths
- Recomputed when new infrastructure is built
- Considers all transportation options (truck/rail/pipeline)

### Turn Resolution
1. Update global oil price (random walk)
2. Wells produce crude oil
3. Calculate demand with price elasticity
4. Route production through refineries to demand
5. Apply demand growth rates
6. Calculate player profits
7. Update market statistics

## Technologies Used

- **Three.js**: 3D visualization engine
- **d3-delaunay**: Delaunay triangulation library
- **Vanilla JavaScript**: Core game logic
- **HTML5 Canvas**: Rendering

## Game Balance

### Victory Paths
1. **Production Mogul**: Build many wells, maximize output
2. **Infrastructure Baron**: Build pipelines/refineries, earn fees
3. **Integrated Giant**: Vertical integration from well to customer
4. **Opportunist**: Exploit market inefficiencies

### Starting Capital
Each player starts with $50M cash

### Game Length
150 turns (can be adjusted in settings.js)

## Customization

Edit `settings.js` to modify:
- Number of nodes
- Build costs
- Operating costs
- Transportation costs
- Oil price volatility
- Demand parameters
- Game length

## Browser Requirements

- Modern browser with WebGL support
- Recommended: Chrome, Firefox, Safari, Edge
- Internet connection (for CDN libraries)

## Credits

Based on the Oil & Gas Tycoon game design specification.

Enjoy building your oil empire!
