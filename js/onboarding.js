// onboarding.js — everything that teaches the game: map legend, plain-language
// hover tooltips, the "why is this price?" cost-stack breakdown, suggested
// first moves (reusing the AI's own well scorer, so the advice is honest),
// and one-shot event hints.
(function (global) {
  'use strict';

  const { formatCurrency, formatNumber, formatPrice } = global.Util;
  const { wellOpCost, refineryCapacity } = global.GameState;

  const SEEN_KEY = 'ogt.seen.v1';

  class Onboarding {
    constructor(game) {
      this.game = game;
      this.seen = this.loadSeen();
    }

    loadSeen() {
      try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { return {}; }
    }
    markSeen(key) {
      this.seen[key] = true;
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(this.seen)); } catch (e) { /* ok */ }
    }

    get state() { return this.game.state; }
    get config() { return this.state.configStore.active; }

    // ---------------- names & tooltips ----------------

    nodeTitle(n) {
      if (n.type === 'terminal') return '🚢 Import/export terminal';
      if (n.type === 'production') return n.well ? '🛢️ Oil field (drilled)' : '🛢️ Oil field';
      if (n.cityTier === 'major') return '🏙️ Major city';
      if (n.cityTier === 'midsize') return '🏘️ Midsize city';
      if (n.cityTier === 'town') return '🏠 Town';
      return 'Empty land';
    }

    nodeTooltipHTML(n) {
      const c = this.config;
      const bits = [`<b>${this.nodeTitle(n)}</b>`];
      if (n.type === 'production') {
        const op = wellOpCost(n, c);
        const grade = op <= c.wellOpCostMin + (c.wellOpCostMax - c.wellOpCostMin) * 0.33 ? 'cheap'
          : op >= c.wellOpCostMin + (c.wellOpCostMax - c.wellOpCostMin) * 0.66 ? 'expensive' : 'average';
        bits.push(`${formatNumber(n.prodCapacity)} bbl/turn · pumps at ${formatPrice(op)}/bbl (${grade})`);
        if (n.well) {
          const owner = this.state.players[n.well.owner];
          bits.push(`<span style="color:${owner.color}">${owner.name}</span> · pumped ${formatNumber(n.well.producedThisTurn || 0)} bbl last turn`);
        }
      }
      if (n.demandBase > 0) {
        bits.push(`needs ${formatNumber(n.demandThisTurn || n.demandBase)} bbl/turn`);
        if (n.localPrice !== null) bits.push(`local price <b>${formatPrice(n.localPrice)}</b> (hover the inspector for the cost stack)`);
      }
      if (n.type === 'terminal') {
        bits.push(`world market: imports ${formatPrice(this.state.globalPrice + c.terminalFee)}, exports ${formatPrice(this.state.globalPrice - c.terminalFee)}`);
      }
      if (n.refinery) {
        const owner = this.state.players[n.refinery.owner];
        bits.push(`refinery (<span style="color:${owner.color}">${owner.name}</span>), ${formatNumber(refineryCapacity(n.refinery, c))} bbl/turn, fee ${formatPrice(n.refinery.fee)}`);
      }
      if (n.storage) {
        bits.push(`tanks: ${formatNumber(n.storage.stock)}/${formatNumber(n.storage.capacity)} bbl`);
      }
      return bits.join('<br>');
    }

    edgeTooltipHTML(e) {
      const c = this.config;
      const bits = [];
      if (e.pipeline) {
        const owner = this.state.players[e.pipeline.owner];
        bits.push(`<b>Pipeline</b> (<span style="color:${owner.color}">${owner.name}</span>) · toll ${formatPrice(e.pipeline.fee)}/bbl`);
        bits.push(`${formatNumber(e.pipeFlow)}/${formatNumber(c.pipelineCapacity)} bbl used last turn${e.congested ? ' · <b>FULL</b>' : ''}`);
      } else if (e.rail) {
        bits.push(`<b>Rail line</b> · ${formatPrice(c.railCostPerEdge)}/bbl (trucking ${formatPrice(c.truckCostPerEdge)})`);
      } else {
        bits.push(`<b>Road</b> · trucking ${formatPrice(c.truckCostPerEdge)}/bbl`);
      }
      const flow = e.flowCrude + e.flowRefined;
      if (flow > 0) bits.push(`${formatNumber(flow)} bbl moved last turn`);
      return bits.join('<br>');
    }

    // "Why is this price?" — the marginal offer's cost stack vs import parity.
    priceBreakdownHTML(n) {
      if (!n.breakdown) return '';
      const b = n.breakdown;
      const p = b.parts || {};
      const li = (label, v) => (v !== undefined && v > 0.004) ? `<li><span>${label}</span><b>${formatPrice(v)}</b></li>` : '';
      let items = '', headline = '';
      if (b.kind === 'import') {
        headline = 'Set by <b>imported fuel</b> (the most expensive supply used here):';
        items = li('world price', p.importBase) + li('terminal fee', p.terminalFee) + li('transport', p.transportB);
      } else if (b.kind === 'well') {
        headline = 'Set by <b>domestic supply</b> (the most expensive barrel used here):';
        items = li('pumping', p.wellOp) + li('crude transport', p.transportA) +
          li('refining', p.refOp) + li('refinery fee', p.refFee) + li('fuel transport', p.transportB);
      } else {
        headline = 'Set by <b>fuel released from tanks</b>:';
        items = li('stored cost basis', p.storageBasis) + li('margin', p.storageBasis * (p.margin || 0)) + li('transport', p.transportB);
      }
      const parity = n.importParity !== null
        ? `<div class="parity">Trucked-in imports would cost <b>${formatPrice(n.importParity)}</b> — local price can never exceed that.</div>` : '';
      return `<details class="why"><summary>Why ${formatPrice(n.localPrice)}?</summary>
        ${headline}<ul class="stack">${items}<li class="total"><span>local price</span><b>${formatPrice(b.unitCost)}</b></li></ul>${parity}</details>`;
    }

    // ---------------- legend ----------------

    showLegend() {
      const root = document.getElementById('modal-root');
      root.innerHTML = `<div class="modal-back"><div class="modal legend">
        <h2>How to read the map</h2>
        <div class="legend-grid">
          <span class="lg-mark"><svg width="22" height="20"><polygon points="11,3 20,17 2,17" fill="rgba(122,106,81,0.15)" stroke="#7a6a51" stroke-width="1.5"/></svg></span>
          <span><b>Oil field</b> — drill a well here ($). Bigger triangle = bigger field. Each field has its own pumping cost per barrel.</span>
          <span class="lg-mark"><svg width="22" height="20"><circle cx="11" cy="10" r="8" fill="#3c3a33"/></svg></span>
          <span><b>Cities & towns</b> — they buy refined fuel every turn, always from the cheapest source. Bigger circle = more demand.</span>
          <span class="lg-mark"><svg width="22" height="20"><rect x="3" y="3" width="14" height="14" fill="#1f6f8b" stroke="#fff" stroke-width="1.5"/></svg></span>
          <span><b>Terminal</b> — the world market. It imports fuel at world price + fee (your competition!) and buys exports at world price − fee.</span>
          <span class="lg-mark"><svg width="22" height="20"><line x1="1" y1="10" x2="21" y2="10" stroke="#c9c5b6" stroke-width="1.5"/></svg></span>
          <span><b>Road</b> — trucking works everywhere, no build cost, but is the priciest way to move a barrel.</span>
          <span class="lg-mark"><svg width="22" height="20"><line x1="1" y1="10" x2="21" y2="10" stroke="#6b675c" stroke-width="2" stroke-dasharray="5,3"/></svg></span>
          <span><b>Rail</b> — cheap, but only on the lines connecting major cities.</span>
          <span class="lg-mark"><svg width="22" height="20"><line x1="1" y1="7" x2="21" y2="7" stroke="#e34948" stroke-width="2.4"/><line x1="1" y1="13" x2="21" y2="13" stroke="#e34948" stroke-width="2.4"/></svg></span>
          <span><b>Pipeline</b> — cheapest per barrel but costs $ to lay and has limited capacity. Everyone pays the owner's toll — including the owner's rivals.</span>
        </div>
        <h3>The one idea that matters</h3>
        <p>Every city pays the price of its <b>most expensive supplier</b>. If you can deliver fuel cheaper than imports —
        good field + short route + your own refinery — you pocket the difference on every barrel. Geography is the whole game.</p>
        <div class="row"><button id="legend-close" class="primary">Got it</button></div>
      </div></div>`;
      root.querySelector('#legend-close').addEventListener('click', () => {
        root.innerHTML = '';
        this.markSeen('legend');
      });
    }

    // ---------------- suggested first moves ----------------

    // Reuses the AI's well scorer so the suggestions are exactly what a
    // competent player would consider.
    suggestions() {
      const state = this.state;
      const config = this.config;
      const scored = [];
      for (const w of state.nodes) {
        if (w.type !== 'production' || w.well) continue;
        const s = global.AI.scoreWellSite(state, state.players[0], w, config);
        if (s) scored.push({ node: w, score: s });
      }
      scored.sort((a, b) => a.score.payback - b.score.payback);
      return scored.slice(0, 3);
    }

    renderSuggestions() {
      const el = document.getElementById('suggest-body');
      if (!el) return;
      const state = this.state;
      if (state.turn > 3 || state.players[0].cumulativeProfit !== 0 || this.seen.suggestDismissed) {
        el.parentElement.classList.add('hidden');
        return;
      }
      const sug = this.suggestions();
      if (sug.length === 0) { el.parentElement.classList.add('hidden'); return; }
      el.parentElement.classList.remove('hidden');
      el.innerHTML = sug.map((s, i) => {
        const combo = s.score.comboRefinery ? ' (+ refinery on site)' : '';
        return `<div class="suggest-row">
          <span>${i + 1}. Field #${s.node.id}${combo} — ~${formatCurrency(s.score.perTurn)}/turn, pays back in ~${Math.ceil(s.score.payback)} turns</span>
          <button class="mini" data-node="${s.node.id}">Show me</button>
        </div>`;
      }).join('') + `<button id="suggest-dismiss" class="mini muted">Hide tips</button>`;
      for (const btn of el.querySelectorAll('button[data-node]')) {
        btn.addEventListener('click', () => {
          const n = state.nodes[Number(btn.dataset.node)];
          this.game.renderer.camera.centerOn(n.x, n.y);
          this.game.renderer.camera.zoom = Math.max(this.game.renderer.camera.zoom, 1.2);
          this.game.renderer.selectedNode = n;
          this.game.renderer.dirty = true;
          this.game.ui.renderInspector();
        });
      }
      el.querySelector('#suggest-dismiss').addEventListener('click', () => {
        this.markSeen('suggestDismissed');
        el.parentElement.classList.add('hidden');
      });
    }

    // ---------------- one-shot event hints ----------------

    afterTurn() {
      const state = this.state;
      const ui = this.game.ui;
      if (!this.seen.firstCongestion) {
        const hit = state.edges.find((e) => e.congested && e.pipeline && e.pipeline.owner === 0);
        if (hit) {
          this.markSeen('firstCongestion');
          ui.toast('🚧 One of your pipelines ran <b>full</b> — overflow moved by truck at truck rates. Consider a parallel line or higher toll.', 'info', 7000);
        }
      }
      if (!this.seen.firstProfit) {
        const you = state.players[0];
        const last = you.history[you.history.length - 1];
        if (last && last.revenue && last.revenue.sales > 0) {
          this.markSeen('firstProfit');
          ui.toast('💰 First sale! You earn each city\'s <b>local price</b> — the cheaper your supply chain, the fatter the margin.', 'good', 7000);
        }
      }
      if (!this.seen.storageTip && state.globalPrice < this.config.referencePrice * 0.9 && state.turn > 5) {
        this.markSeen('storageTip');
        ui.toast('📉 World price is low. Tank farms buy cheap automatically and sell when prices recover.', 'info', 7000);
      }
      this.renderSuggestions();
    }

    maybeShowFirstRun() {
      if (!this.seen.legend) this.showLegend();
      this.renderSuggestions();
    }
  }

  global.Onboarding = Onboarding;
  if (typeof module !== 'undefined' && module.exports) module.exports = Onboarding;
})(typeof globalThis !== 'undefined' ? globalThis : window);
