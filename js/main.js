// main.js — bootstrap and wiring. Creates the game facade that the UI,
// renderer, tuning menu and onboarding all talk to, plus the window.debug API
// (same invariant code path as tools/headless.js) and ?debug= query handling.
(function (global) {
  'use strict';

  const Game = {
    state: null,
    renderer: null,
    ui: null,
    tuning: null,
    onboarding: null,
    routes: null, // shared RouteCache for UI previews & suggestions

    newGame(seed) {
      const store = this.state ? this.state.configStore : new global.Config.ConfigStore();
      store.applyAll();
      this.state = global.GameState.createGame(store, seed);
      this.routes = new global.Pathfinding.RouteCache(this.state);
      if (this.renderer) {
        this.renderer.setState(this.state);
      } else {
        this.renderer = new global.RendererModule.Renderer(
          document.getElementById('world'), document.getElementById('fx'), this.state);
        this.renderer.start();
      }
      if (!this.ui) {
        this.ui = new global.UIController(this);
        this.onboarding = new global.Onboarding(this);
        this.tuning = new global.TuningMenu(document.getElementById('tuning-drawer'), store, {
          onLiveChange: () => { /* applies at next resolveTurn */ },
          onNewGameRequested: () => this.newGame(Math.floor(Math.random() * 2 ** 31)),
          onToast: (msg, kind) => this.ui.toast(msg, kind)
        });
      } else {
        this.tuning.refresh();
      }
      this.renderer.fitView();
      this.ui.refresh();
      this.onboarding.maybeShowFirstRun();
      this.ui.toast(`New game — seed ${this.state.seed}. Good luck!`);
    },

    nextTurn() {
      if (this.state.gameOver) return;
      global.TurnEngine.resolveTurn(this.state);
      this.state.routeVersion++; // fees/flows changed → refresh UI route previews
      this.ui.refresh();
      this.onboarding.afterTurn();
      if (this.state.gameOver) this.ui.showGameOver();
    }
  };

  function parseQuery() {
    const out = {};
    const q = (typeof location !== 'undefined' ? location.search : '').replace(/^\?/, '');
    for (const pair of q.split('&')) {
      if (!pair) continue;
      const [k, v] = pair.split('=');
      out[decodeURIComponent(k)] = v === undefined ? true : decodeURIComponent(v);
    }
    return out;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const q = parseQuery();
    const seed = q.seed !== undefined ? Number(q.seed) >>> 0 : Math.floor(Math.random() * 2 ** 31);
    Game.newGame(seed);

    // debug/query hooks for screenshots & scripted checks:
    //   ?seed=42&turns=30&overlay=flow&notips=1
    if (q.notips) document.getElementById('modal-root').innerHTML = '';
    if (q.turns) {
      const n = Number(q.turns);
      for (let i = 0; i < n && !Game.state.gameOver; i++) global.TurnEngine.resolveTurn(Game.state);
      Game.ui.refresh();
      Game.onboarding.renderSuggestions();
    }
    if (q.overlay) Game.ui.setOverlay(q.overlay);

    global.debug = {
      game: Game,
      runTurns(n) {
        for (let i = 0; i < n && !Game.state.gameOver; i++) global.TurnEngine.resolveTurn(Game.state);
        Game.ui.refresh();
        return Game.state.totals;
      },
      verify() { return global.TurnEngine.verifyInvariants(Game.state); },
      dump() {
        const s = Game.state;
        return {
          turn: s.turn, price: s.globalPrice, totals: s.totals,
          players: s.players.map((p) => ({ name: p.name, cash: p.cash, profit: p.cumulativeProfit }))
        };
      },
      newGame(seed) { Game.newGame(seed >>> 0); }
    };
  });

  global.Game = Game;
})(typeof globalThis !== 'undefined' ? globalThis : window);
