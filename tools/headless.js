#!/usr/bin/env node
// headless.js — run the simulation without a browser and assert invariants.
//
//   node tools/headless.js --seed 42 --turns 150 [--ai 3] [--quiet] [--every 10]
//   node tools/headless.js --seed 42 --turns 150 --set wellBuildCost=2000000 --set truckCostPerEdge=5
//
// Exits nonzero if any invariant is violated on any turn.
'use strict';

const path = require('path');

// The game files attach themselves to globalThis (same objects the browser uses).
global.Delaunator = require(path.join(__dirname, '..', 'vendor', 'delaunator.min.js'));
require(path.join(__dirname, '..', 'js', 'util.js'));
require(path.join(__dirname, '..', 'js', 'config.js'));
require(path.join(__dirname, '..', 'js', 'mapGenerator.js'));
require(path.join(__dirname, '..', 'js', 'gameState.js'));
require(path.join(__dirname, '..', 'js', 'pathfinding.js'));
require(path.join(__dirname, '..', 'js', 'market.js'));
require(path.join(__dirname, '..', 'js', 'turnEngine.js'));
require(path.join(__dirname, '..', 'js', 'ai.js'));

function parseArgs(argv) {
  const args = { seed: 42, turns: 150, ai: null, quiet: false, every: 10, set: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--turns') args.turns = Number(argv[++i]);
    else if (a === '--ai') args.ai = Number(argv[++i]);
    else if (a === '--every') args.every = Number(argv[++i]);
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--set') args.set.push(argv[++i]);
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const configStore = new Config.ConfigStore(); // no localStorage in node → pure defaults
  if (args.ai !== null) configStore.set('numAIOpponents', args.ai);
  for (const kv of args.set) {
    const [k, v] = kv.split('=');
    if (!(k in Config.DEFAULT_CONFIG)) { console.error(`Unknown config key: ${k}`); process.exit(2); }
    configStore.set(k, Number(v));
  }
  configStore.applyAll();

  const state = GameState.createGame(configStore, args.seed);
  state.debugChecks = true;

  const wells = state.nodes.filter((n) => n.type === 'production').length;
  const demand = state.nodes.filter((n) => n.demandBase > 0).length;
  const terminals = state.nodes.filter((n) => n.type === 'terminal').length;
  console.log(`map: ${state.nodes.length} nodes, ${state.edges.length} edges | ` +
    `${wells} oil fields, ${demand} demand nodes, ${terminals} terminals | ` +
    `players: ${state.players.length} (${state.players.filter((p) => p.isAI).length} AI) | seed ${args.seed}`);

  const t0 = Date.now();
  let failed = false;
  const header = 'turn  price   demand    prod     imports  exports  storIn  storOut | ' +
    state.players.map((p) => p.name.padStart(14)).join(' ');
  if (!args.quiet) console.log(header);

  for (let i = 0; i < args.turns && !state.gameOver; i++) {
    try {
      TurnEngine.resolveTurn(state);
    } catch (err) {
      console.error(`\nFAILED on turn ${state.turn}:\n${err.message}`);
      failed = true;
      break;
    }
    const t = state.totals;
    if (!args.quiet && ((state.turn - 1) % args.every === 0 || state.gameOver)) {
      const row = [
        String(state.turn - 1).padStart(4),
        state.globalPrice.toFixed(1).padStart(6),
        fmt(t.demand), fmt(t.production), fmt(t.imports), fmt(t.exports), fmt(t.storageIn, 7), fmt(t.storageOut, 7)
      ].join(' ') + ' | ' + state.players.map((p) => Util.formatCurrency(p.cumulativeProfit).padStart(14)).join(' ');
      console.log(row);
    }
  }

  const ms = Date.now() - t0;
  const done = state.turn - 1;
  console.log(`\n${done} turns in ${ms} ms (${(ms / Math.max(1, done)).toFixed(1)} ms/turn)`);

  if (!failed) {
    const problems = TurnEngine.verifyInvariants(state);
    // note: P&L was reset after the last turn, so only structural checks remain meaningful here
    const structural = problems.filter((p) => !p.includes('cash drift'));
    if (structural.length) {
      console.error('Post-run invariant problems:\n' + structural.join('\n'));
      failed = true;
    }
  }

  if (!failed) {
    const winner = TurnEngine.getWinner(state);
    console.log(`winner: ${winner.name} with ${Util.formatCurrency(winner.cumulativeProfit)} cumulative profit`);
    const assets = state.players.map((p) => {
      const w = state.nodes.filter((n) => n.well && n.well.owner === p.id).length;
      const r = state.nodes.filter((n) => n.refinery && n.refinery.owner === p.id).length;
      const pl = state.edges.filter((e) => e.pipeline && e.pipeline.owner === p.id).length;
      return `${p.name}: ${w}W ${r}R ${pl}P cash=${Util.formatCurrency(p.cash)}`;
    });
    console.log(assets.join(' | '));
    console.log('invariants: OK');
  }
  process.exit(failed ? 1 : 0);
}

function fmt(v, w = 8) {
  return Util.formatNumber(v).padStart(w);
}

main();
