# Oil & Gas Tycoon

A turn-based strategy game about the **geo-spatial and supply-demand reasoning** of the
oil industry: find cheap crude, get it refined, and move it to the towns that pay —
cheaper than the world market can ship it in.

No build step, no dependencies to install: **open `index.html` in a browser and play.**
(Everything, including the Delaunay library, is vendored locally.)

## The one idea that matters

Every city buys from its cheapest suppliers, and the **local price equals the cost of the
most expensive supply actually used** (the marginal barrel). Imported fuel — world price +
terminal fee + transport — is always available, so it sets the ceiling everywhere. If you
can deliver fuel *under* that ceiling (good field + short route + your own refinery), you
pocket the difference on every barrel. Geography is the whole game.

## How to play

- **Goal**: highest cumulative profit when the turns run out (default 150).
- **Click** any node or edge to inspect it and build; **Space** or *Next turn* resolves a turn.
- **Oil fields** (triangles): drill a well. Bigger fields pump cheaper.
- **Refineries** (square badge): turn crude into fuel; charge everyone else your fee.
- **Pipelines** (double lines): cheapest transport, but cost money to lay and have
  **limited capacity** — when one runs full, overflow moves by truck and you'll see it
  in the *Congestion* overlay. Everyone (you included) pays the posted toll.
- **Tank farms**: buy fuel automatically when the world price dips, release it when the
  local market beats their cost basis — hands-free buy-low/sell-high.
- **Terminals** (blue squares): the world market. It undercuts you near the coast and
  buys your surplus (exports) at world price − fee.
- Overlays (top right): **Prices** heatmap, **Flows** (crude vs fuel, width = volume),
  **Congestion** (pipe utilization). Hover any demand node and open *"Why this price?"*
  in the inspector for the full cost stack of the marginal barrel.

## Tuning menu (⚙)

Every dollar value in the game is a slider — nothing is hardcoded. This is a
balancing sandbox by design:

- **Live values** (costs, fees, capacities, market behavior) apply at the start of the
  next turn — no restart.
- **"new game" badged values** (map shape, starting cash, player count) apply when you
  press *Regenerate map / start new game*.
- Settings persist in `localStorage`, and **Export/Import JSON** lets you save and share
  balance presets. *Reset all* returns to the defaults in `js/config.js`.

## Development

```
index.html, styles.css     shell + styling (classic script tags, works from file://)
vendor/delaunator.min.js   vendored triangulation (MIT)
js/config.js               CONFIG_SCHEMA — single source of truth for every tunable
js/mapGenerator.js         Poisson disk → Delaunay → cities, rail, fields, terminals
js/gameState.js            game creation + validated build/fee actions
js/pathfinding.js          binary-heap Dijkstra + route cache
js/market.js               capacity-constrained market clearing (the core)
js/turnEngine.js           turn orchestration + invariant checker
js/ai.js                   AI opponents (0–3, tunable)
js/camera.js, renderer.js  pan/zoom camera + two-layer canvas renderer & overlays
js/charts.js               sidebar line charts / sparklines
js/tuningMenu.js           slider drawer generated from CONFIG_SCHEMA
js/ui.js, onboarding.js    panels, inspector, route builder, legend, hints
js/main.js                 bootstrap + window.debug API
```

### Headless simulation & tests

The simulation runs in Node with no browser:

```bash
node tools/headless.js --seed 42 --turns 150            # full game, invariant checks
node tools/headless.js --seed 7 --ai 0 --set truckCostPerEdge=5
NODE_PATH=/opt/node22/lib/node_modules node tools/e2e.js  # Playwright UI test
tools/screenshot.sh out.png "seed=42&turns=40&overlay=flow"
```

Invariants checked every turn: barrel conservation, capacity limits, cash ledger
(cash − starting capital = cumulative profit), local price ≤ import parity, no NaNs.
The same checks are available in the browser console: `debug.verify()`, plus
`debug.runTurns(n)` and `debug.dump()`.

### Market model (summary)

Per turn: world price random-walks (clamped) → demand per town follows lagged
elasticity `base × (refPrice/lastLocalPrice)^ε` → all supply offers
(well→refinery→town chains, imports, storage releases) are sorted by delivered cost
and filled cheapest-first against well/refinery/pipeline capacities. Saturated pipes
freeze and the next round reprices them at truck/rail rates, so congestion is a visible
cost step. Local price = the most expensive offer used; every supplier at that town is
paid it. Then profitable exports, then storage charging while prices are low.
Tariffs are posted: every barrel pays the pipeline toll and refinery fee regardless of
owner (payments to yourself cancel out).
