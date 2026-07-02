// ui.js — DOM panels and canvas interaction: top bar (turn/price/cash/controls),
// sidebar (dashboard, market, inspector), tooltips, toasts, pipeline
// route-builder, and the new-game modal. Talks to the game through the `game`
// facade created in main.js.
(function (global) {
  'use strict';

  const { formatCurrency, formatNumber, formatPrice, clamp } = global.Util;
  const { wellOpCost, refineryCapacity, upgradeCost, actions } = global.GameState;

  const HUMAN = 0;

  class UIController {
    constructor(game) {
      this.game = game;
      this.$ = (id) => document.getElementById(id);
      this.autoTimer = null;
      this.routeBuilder = null; // { start: nodeId|null }
      this.profitChart = new global.Charts.LineChart(this.$('chart-profit'), { formatY: formatCurrency });
      this.priceChart = new global.Charts.LineChart(this.$('chart-price'), { formatY: (v) => formatPrice(v), height: 90 });
      this.bindTopBar();
      this.bindCanvas();
      window.addEventListener('resize', () => game.renderer.resize());
    }

    get state() { return this.game.state; }
    get renderer() { return this.game.renderer; }

    // ---------------- top bar ----------------

    bindTopBar() {
      this.$('btn-next').addEventListener('click', () => this.game.nextTurn());
      document.addEventListener('keydown', (ev) => {
        if (ev.code === 'Space' && !ev.target.closest('input, textarea, select')) {
          ev.preventDefault();
          this.game.nextTurn();
        }
        if (ev.key === 'Escape') this.cancelRouteBuilder();
      });
      this.$('btn-auto').addEventListener('click', () => this.toggleAuto());
      this.$('sel-speed').addEventListener('change', () => { if (this.autoTimer) { this.toggleAuto(); this.toggleAuto(); } });
      for (const btn of document.querySelectorAll('#overlay-seg button')) {
        btn.addEventListener('click', () => this.setOverlay(btn.dataset.overlay));
      }
      this.$('btn-tuning').addEventListener('click', () => this.game.tuning.toggle());
      this.$('btn-newgame').addEventListener('click', () => this.showNewGameModal());
      this.$('btn-legend').addEventListener('click', () => this.game.onboarding.showLegend());
    }

    setOverlay(mode) {
      this.renderer.overlay = mode;
      this.renderer.dirty = true;
      for (const btn of document.querySelectorAll('#overlay-seg button')) {
        btn.classList.toggle('active', btn.dataset.overlay === mode);
      }
      this.$('overlay-legend').innerHTML = this.overlayLegendHTML(mode);
    }

    overlayLegendHTML(mode) {
      if (mode === 'price') {
        const range = this.renderer.priceRange();
        const lo = range ? formatPrice(range.min) : '–';
        const hi = range ? formatPrice(range.max) : '–';
        return `<span class="chip"><span class="ramp"></span> local fuel price: ${lo} → ${hi}</span>`;
      }
      if (mode === 'flow') {
        return `<span class="chip"><i class="sw" style="background:#4d3f2f"></i> crude</span>
                <span class="chip"><i class="sw" style="background:#a3652a"></i> refined fuel</span>
                <span class="chip">width = barrels moved last turn</span>`;
      }
      if (mode === 'congestion') {
        return `<span class="chip"><i class="sw" style="background:#a3c9a8"></i> pipe idle</span>
                <span class="chip"><i class="sw" style="background:#145a32"></i> busy</span>
                <span class="chip"><i class="sw" style="background:#c22f2e"></i> FULL — overflow trucks</span>`;
      }
      return '';
    }

    toggleAuto() {
      if (this.autoTimer) {
        clearInterval(this.autoTimer);
        this.autoTimer = null;
        this.$('btn-auto').textContent = '▶▶ Auto';
        this.$('btn-auto').classList.remove('active');
      } else {
        const tps = Number(this.$('sel-speed').value);
        this.autoTimer = setInterval(() => {
          if (this.state.gameOver) { this.toggleAuto(); return; }
          this.game.nextTurn();
        }, 1000 / tps);
        this.$('btn-auto').textContent = '❚❚ Stop';
        this.$('btn-auto').classList.add('active');
      }
    }

    // ---------------- canvas interaction ----------------

    bindCanvas() {
      const fx = this.renderer.fxCanvas;
      let dragging = false, dragMoved = false, lastX = 0, lastY = 0;

      fx.addEventListener('mousedown', (ev) => {
        dragging = true; dragMoved = false;
        lastX = ev.clientX; lastY = ev.clientY;
      });
      window.addEventListener('mouseup', () => { dragging = false; });
      fx.addEventListener('mousemove', (ev) => {
        const rect = fx.getBoundingClientRect();
        const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
        if (dragging) {
          const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
          if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
          this.renderer.camera.panBy(dx, dy);
          lastX = ev.clientX; lastY = ev.clientY;
          this.renderer.dirty = true;
          return;
        }
        this.updateHover(sx, sy, ev.clientX, ev.clientY);
      });
      fx.addEventListener('mouseleave', () => {
        this.renderer.hoverNode = this.renderer.hoverEdge = null;
        this.hideTooltip();
      });
      fx.addEventListener('click', (ev) => {
        if (dragMoved) return;
        const rect = fx.getBoundingClientRect();
        this.handleClick(ev.clientX - rect.left, ev.clientY - rect.top);
      });
      fx.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const rect = fx.getBoundingClientRect();
        const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.renderer.camera.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, factor, this.renderer.viewW, this.renderer.viewH);
        this.renderer.dirty = true;
      }, { passive: false });
    }

    updateHover(sx, sy, clientX, clientY) {
      const r = this.renderer;
      const node = global.CameraModule.pickNode(this.state, r.camera, sx, sy, r.viewW, r.viewH);
      const edge = node ? null : global.CameraModule.pickEdge(this.state, r.camera, sx, sy, r.viewW, r.viewH);
      r.hoverNode = node;
      r.hoverEdge = edge;

      if (this.routeBuilder && this.routeBuilder.start !== null && node) {
        const cache = this.game.routes;
        const res = cache.get(this.routeBuilder.start);
        const path = global.Pathfinding.pathEdges(this.state, res, this.routeBuilder.start, node.id);
        r.routePreview = path && path.length ? { edgeIds: path } : null;
      }

      if (node) this.showTooltip(this.game.onboarding.nodeTooltipHTML(node), clientX, clientY);
      else if (edge) this.showTooltip(this.game.onboarding.edgeTooltipHTML(edge), clientX, clientY);
      else this.hideTooltip();
    }

    handleClick(sx, sy) {
      const r = this.renderer;
      const node = global.CameraModule.pickNode(this.state, r.camera, sx, sy, r.viewW, r.viewH);
      const edge = node ? null : global.CameraModule.pickEdge(this.state, r.camera, sx, sy, r.viewW, r.viewH);

      if (this.routeBuilder) {
        if (node) {
          if (this.routeBuilder.start === null) {
            this.routeBuilder.start = node.id;
            this.toast('Route start set. Click the destination node.');
          } else {
            this.confirmRouteBuild(node.id);
          }
        }
        return;
      }

      r.selectedNode = node;
      r.selectedEdge = edge;
      r.dirty = true;
      this.renderInspector();
    }

    // ---------------- pipeline route builder ----------------

    startRouteBuilder(fromNodeId) {
      this.routeBuilder = { start: fromNodeId !== undefined ? fromNodeId : null };
      this.renderer.fxCanvas.style.cursor = 'crosshair';
      this.toast(fromNodeId !== undefined
        ? 'Pipeline route: click the destination node. (Esc to cancel)'
        : 'Pipeline route: click the start node. (Esc to cancel)');
    }

    cancelRouteBuilder() {
      if (!this.routeBuilder) return;
      this.routeBuilder = null;
      this.renderer.routePreview = null;
      this.renderer.fxCanvas.style.cursor = 'grab';
    }

    confirmRouteBuild(endNodeId) {
      const start = this.routeBuilder.start;
      const res = this.game.routes.get(start);
      const path = global.Pathfinding.pathEdges(this.state, res, start, endNodeId);
      this.cancelRouteBuilder();
      if (!path || path.length === 0) { this.toast('No route found.', 'warn'); return; }
      const config = this.state.configStore.active;
      const open = path.filter((eid) => !this.state.edges[eid].pipeline);
      if (open.length === 0) { this.toast('That whole route already has pipelines.', 'warn'); return; }
      const cost = open.length * config.pipelineCostPerEdge;
      const result = actions.buildPipeline(this.state, HUMAN, path);
      if (result.ok) {
        this.toast(`Built pipeline: ${result.built} segments for ${formatCurrency(result.cost)}.`, 'good');
        this.refresh();
      } else {
        this.toast(`${result.reason} (needs ${formatCurrency(cost)})`, 'warn');
      }
    }

    // ---------------- tooltip / toasts ----------------

    showTooltip(html, clientX, clientY) {
      const tip = this.$('tooltip');
      tip.innerHTML = html;
      tip.classList.remove('hidden');
      const pad = 14;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = clientX + pad, y = clientY + pad;
      if (x + w > window.innerWidth - 8) x = clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = clientY - h - pad;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }

    hideTooltip() { this.$('tooltip').classList.add('hidden'); }

    toast(msg, kind = 'info', ms = 3500) {
      const el = document.createElement('div');
      el.className = `toast ${kind}`;
      el.innerHTML = msg;
      this.$('toasts').appendChild(el);
      setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, ms);
    }

    // ---------------- sidebar rendering ----------------

    refresh() {
      this.renderTopBar();
      this.renderDashboard();
      this.renderMarket();
      this.renderInspector();
      this.renderer.dirty = true;
      if (this.renderer.overlay === 'price') this.$('overlay-legend').innerHTML = this.overlayLegendHTML('price');
    }

    renderTopBar() {
      const s = this.state;
      const config = s.configStore.active;
      this.$('turn-label').textContent = s.gameOver ? `Game over — ${config.gameLength} turns` : `Turn ${s.turn} / ${config.gameLength}`;
      this.$('price-label').textContent = formatPrice(s.globalPrice);
      global.Charts.sparkline(this.$('price-spark'), s.priceHistory, '#6f6c63');
      this.$('cash-label').textContent = formatCurrency(s.players[HUMAN].cash);
    }

    renderDashboard() {
      const s = this.state;
      const you = s.players[HUMAN];
      const last = you.history[you.history.length - 1];
      const rows = [];
      rows.push(`<div class="stat-row"><span>Cash</span><b>${formatCurrency(you.cash)}</b></div>`);
      rows.push(`<div class="stat-row"><span>Cumulative profit</span><b class="${you.cumulativeProfit >= 0 ? 'pos' : 'neg'}">${formatCurrency(you.cumulativeProfit)}</b></div>`);
      if (last) {
        rows.push(`<div class="stat-row"><span>Profit last turn</span><b class="${last.profit >= 0 ? 'pos' : 'neg'}">${formatCurrency(last.profit)}</b></div>`);
        rows.push(`<div class="stat-row"><span>Barrels sold</span><b>${formatNumber(last.barrelsSold)}</b></div>`);
        rows.push(`<div class="stat-row"><span>Market share</span><b>${(last.marketShare * 100).toFixed(1)}%</b></div>`);
        rows.push(this.pnlHTML(last));
      }
      // rivals
      if (s.players.length > 1) {
        const maxAbs = Math.max(1, ...s.players.map((p) => Math.abs(p.cumulativeProfit)));
        rows.push('<div class="subhead">Standings</div>');
        const ranked = [...s.players].sort((a, b) => b.cumulativeProfit - a.cumulativeProfit);
        for (const p of ranked) {
          const w = Math.abs(p.cumulativeProfit) / maxAbs * 100;
          rows.push(`<div class="rival"><i class="sw" style="background:${p.color}"></i>
            <span class="rname">${p.name}</span>
            <span class="rbar"><span style="width:${w.toFixed(0)}%;background:${p.color};opacity:${p.cumulativeProfit >= 0 ? 1 : 0.35}"></span></span>
            <b>${formatCurrency(p.cumulativeProfit)}</b></div>`);
        }
      }
      this.$('dash-body').innerHTML = rows.join('');
      this.profitChart.setData(s.players.map((p) => ({
        name: p.name, color: p.color, values: p.history.map((h) => h.cumulativeProfit)
      })));
    }

    pnlHTML(last) {
      const r = last.revenue, c = last.costs;
      const line = (label, v, sign) => v > 0.5 ? `<div class="stat-row small"><span>${label}</span><b>${sign}${formatCurrency(v)}</b></div>` : '';
      return `<details class="pnl"><summary>P&amp;L detail</summary>
        ${line('Fuel sales', r.sales, '+')}${line('Export sales', r.exportSales, '+')}
        ${line('Pipeline tolls earned', r.pipeTolls, '+')}${line('Refining fees earned', r.refineryFees, '+')}
        ${line('Storage sales', r.storageSales, '+')}
        ${line('Pumping costs', c.wellOps, '−')}${line('Refining paid', c.refiningPaid, '−')}
        ${line('Truck / rail', c.transport, '−')}${line('Pipeline tolls paid', c.pipeTollsPaid, '−')}
        ${line('Terminal fees', c.terminalFees, '−')}${line('Storage purchases', c.storagePurchases, '−')}
        ${line('Construction', c.capex, '−')}
      </details>`;
    }

    renderMarket() {
      const t = this.state.totals;
      // before the first turn resolves, show base demand so the panel isn't empty
      const demand = t.demand > 0 ? t.demand
        : this.state.nodes.reduce((sum, n) => sum + n.demandBase, 0);
      const rows = [
        `<div class="stat-row"><span>World fuel price</span><b>${formatPrice(this.state.globalPrice)}</b></div>`,
        `<div class="stat-row"><span>Total demand</span><b>${formatNumber(demand)} bbl</b></div>`,
        `<div class="stat-row"><span>Domestic production</span><b>${formatNumber(t.production)} bbl</b></div>`,
        `<div class="stat-row"><span>Imports</span><b>${formatNumber(t.imports)} bbl</b></div>`,
        `<div class="stat-row"><span>Exports</span><b>${formatNumber(t.exports)} bbl</b></div>`
      ];
      if (t.storageIn > 0.5 || t.storageOut > 0.5) {
        rows.push(`<div class="stat-row"><span>Into / out of tanks</span><b>${formatNumber(t.storageIn)} / ${formatNumber(t.storageOut)}</b></div>`);
      }
      this.$('market-body').innerHTML = rows.join('');
      this.priceChart.setData([{ name: 'World price', color: '#6f6c63', values: this.state.priceHistory }]);
    }

    // ---------------- inspector ----------------

    renderInspector() {
      const el = this.$('inspector-body');
      const node = this.renderer.selectedNode;
      const edge = this.renderer.selectedEdge;
      if (node) el.innerHTML = this.nodeInspectorHTML(node);
      else if (edge) el.innerHTML = this.edgeInspectorHTML(edge);
      else { el.innerHTML = '<p class="hint">Click a node or edge on the map to inspect it and build.</p>'; return; }
      this.bindInspectorActions(node, edge);
    }

    nodeInspectorHTML(n) {
      const s = this.state;
      const config = s.configStore.active;
      const you = s.players[HUMAN];
      const rows = [];
      rows.push(`<div class="subhead">${this.game.onboarding.nodeTitle(n)} <span class="muted">#${n.id}</span></div>`);

      if (n.type === 'production') {
        rows.push(`<div class="stat-row"><span>Field size</span><b>${formatNumber(n.prodCapacity)} bbl/turn</b></div>`);
        rows.push(`<div class="stat-row"><span>Pumping cost</span><b>${formatPrice(wellOpCost(n, config))}/bbl</b></div>`);
        if (n.well) {
          const owner = s.players[n.well.owner];
          rows.push(`<div class="stat-row"><span>Well</span><b style="color:${owner.color}">${owner.name}</b></div>`);
          rows.push(`<div class="stat-row"><span>Pumped last turn</span><b>${formatNumber(n.well.producedThisTurn || 0)} bbl</b></div>`);
        } else {
          rows.push(this.actionBtn('act-well', `Drill well — ${formatCurrency(config.wellBuildCost)}`, you.cash >= config.wellBuildCost));
        }
      }

      if (n.demandBase > 0) {
        rows.push(`<div class="stat-row"><span>Demand</span><b>${formatNumber(n.demandThisTurn || n.demandBase)} bbl/turn</b></div>`);
        rows.push(`<div class="stat-row"><span>Growth</span><b>${(n.demandGrowth * 100).toFixed(1)}%/turn</b></div>`);
        if (n.localPrice !== null) {
          rows.push(`<div class="stat-row"><span>Local price</span><b>${formatPrice(n.localPrice)}</b></div>`);
          rows.push(`<div class="price-why">${this.game.onboarding.priceBreakdownHTML(n)}</div>`);
        }
      }

      if (n.type === 'terminal') {
        rows.push(`<div class="stat-row"><span>Imports at</span><b>${formatPrice(s.globalPrice + config.terminalFee)}/bbl</b></div>`);
        rows.push(`<div class="stat-row"><span>Exports at</span><b>${formatPrice(s.globalPrice - config.terminalFee)}/bbl</b></div>`);
      }

      if (n.refinery) {
        const owner = s.players[n.refinery.owner];
        const cap = refineryCapacity(n.refinery, config);
        rows.push(`<div class="subhead">Refinery <b style="color:${owner.color}">${owner.name}</b></div>`);
        rows.push(`<div class="stat-row"><span>Capacity (level ${n.refinery.level})</span><b>${formatNumber(cap)} bbl/turn</b></div>`);
        rows.push(`<div class="stat-row"><span>Used last turn</span><b>${formatNumber(n.refinery.usedThisTurn)} (${cap > 0 ? Math.round(100 * n.refinery.usedThisTurn / cap) : 0}%)</b></div>`);
        rows.push(`<div class="stat-row"><span>Fee</span><b>${formatPrice(n.refinery.fee)}/bbl</b></div>`);
        if (n.refinery.owner === HUMAN) {
          rows.push(this.feeSliderHTML('fee-ref', n.refinery.fee, 0, 30, 0.5));
          rows.push(this.actionBtn('act-upgrade', `Upgrade (×2 capacity) — ${formatCurrency(upgradeCost(config))}`, you.cash >= upgradeCost(config)));
        }
      } else if (n.type !== 'terminal') {
        rows.push(this.actionBtn('act-refinery', `Build refinery — ${formatCurrency(config.refineryBuildCost)}`, you.cash >= config.refineryBuildCost));
      }

      if (n.storage) {
        const owner = s.players[n.storage.owner];
        rows.push(`<div class="subhead">Tank farm <b style="color:${owner.color}">${owner.name}</b></div>`);
        rows.push(`<div class="stat-row"><span>Stock</span><b>${formatNumber(n.storage.stock)} / ${formatNumber(n.storage.capacity)} bbl</b></div>`);
        if (n.storage.stock > 0) rows.push(`<div class="stat-row"><span>Cost basis</span><b>${formatPrice(n.storage.costBasis)}/bbl</b></div>`);
      }
      if (n.type !== 'terminal' && (!n.storage || n.storage.owner === HUMAN)) {
        const stepCap = 10000;
        const cost = stepCap * config.storageCostPerBarrel;
        rows.push(this.actionBtn('act-storage', `${n.storage ? 'Expand' : 'Build'} tanks +${formatNumber(stepCap)} bbl — ${formatCurrency(cost)}`, you.cash >= cost));
      }

      rows.push(this.actionBtn('act-route', 'Build pipeline route from here…', true, 'secondary'));
      return rows.join('');
    }

    edgeInspectorHTML(e) {
      const s = this.state;
      const config = s.configStore.active;
      const rows = [`<div class="subhead">Edge <span class="muted">#${e.id}</span></div>`];
      rows.push(`<div class="stat-row"><span>Trucking</span><b>${formatPrice(config.truckCostPerEdge)}/bbl</b></div>`);
      if (e.rail) rows.push(`<div class="stat-row"><span>Rail</span><b>${formatPrice(config.railCostPerEdge)}/bbl</b></div>`);
      if (e.flowCrude + e.flowRefined > 0) {
        rows.push(`<div class="stat-row"><span>Flow last turn</span><b>${formatNumber(e.flowCrude + e.flowRefined)} bbl</b></div>`);
      }
      if (e.pipeline) {
        const owner = s.players[e.pipeline.owner];
        rows.push(`<div class="subhead">Pipeline <b style="color:${owner.color}">${owner.name}</b></div>`);
        rows.push(`<div class="stat-row"><span>Toll</span><b>${formatPrice(e.pipeline.fee)}/bbl</b></div>`);
        rows.push(`<div class="stat-row"><span>Used last turn</span><b>${formatNumber(e.pipeFlow)} / ${formatNumber(config.pipelineCapacity)} bbl</b></div>`);
        if (e.congested) rows.push(`<div class="warnnote">FULL last turn — overflow paid trucking rates.</div>`);
        if (e.pipeline.owner === HUMAN) rows.push(this.feeSliderHTML('fee-pipe', e.pipeline.fee, 0, Math.max(5, config.truckCostPerEdge * 2), 0.05));
      } else {
        const you = s.players[HUMAN];
        rows.push(this.actionBtn('act-pipe', `Lay pipeline here — ${formatCurrency(config.pipelineCostPerEdge)}`, you.cash >= config.pipelineCostPerEdge));
        rows.push(`<p class="hint">Pipelines cost ${formatPrice(config.pipelineDefaultFee)}/bbl to use vs ${formatPrice(config.truckCostPerEdge)} trucking — they pay off on busy routes.</p>`);
      }
      return rows.join('');
    }

    actionBtn(id, label, enabled, cls = 'primary') {
      return `<button id="${id}" class="action ${cls}" ${enabled ? '' : 'disabled'}>${label}</button>`;
    }

    feeSliderHTML(id, value, min, max, step) {
      return `<div class="fee-row"><span>Your fee</span>
        <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        <b id="${id}-val">${formatPrice(value)}</b></div>`;
    }

    bindInspectorActions(node, edge) {
      const act = (id, fn) => {
        const el = this.$(id);
        if (el) el.addEventListener('click', fn);
      };
      const doAction = (fn, successMsg) => {
        const res = fn();
        if (res.ok) { this.toast(successMsg, 'good'); this.refresh(); }
        else this.toast(res.reason, 'warn');
      };
      if (node) {
        act('act-well', () => doAction(() => actions.buildWell(this.state, HUMAN, node.id), 'Well drilled. It sells automatically when it can beat the market.'));
        act('act-refinery', () => doAction(() => actions.buildRefinery(this.state, HUMAN, node.id), 'Refinery built. Crude routes here for processing.'));
        act('act-upgrade', () => doAction(() => actions.upgradeRefinery(this.state, HUMAN, node.id), 'Refinery upgraded — capacity doubled.'));
        act('act-storage', () => doAction(() => actions.buildStorage(this.state, HUMAN, node.id, 10000), 'Tanks built. They buy when the world price dips and sell when it pays.'));
        act('act-route', () => this.startRouteBuilder(node.id));
        const feeRef = this.$('fee-ref');
        if (feeRef) feeRef.addEventListener('input', () => {
          actions.setRefineryFee(this.state, HUMAN, node.id, Number(feeRef.value));
          this.$('fee-ref-val').textContent = formatPrice(Number(feeRef.value));
        });
      }
      if (edge) {
        act('act-pipe', () => doAction(() => actions.buildPipeline(this.state, HUMAN, [edge.id]), 'Pipeline laid.'));
        const feePipe = this.$('fee-pipe');
        if (feePipe) feePipe.addEventListener('input', () => {
          actions.setPipelineFee(this.state, HUMAN, edge.id, Number(feePipe.value));
          this.$('fee-pipe-val').textContent = formatPrice(Number(feePipe.value));
        });
      }
    }

    // ---------------- modals ----------------

    showNewGameModal() {
      const store = this.state.configStore;
      const root = this.$('modal-root');
      root.innerHTML = `<div class="modal-back"><div class="modal">
        <h2>New game</h2>
        <label>AI opponents
          <select id="ng-ai">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${store.edited.numAIOpponents === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label>Map size (nodes)
          <select id="ng-nodes">${[200, 300, 400, 500, 600].map((n) => `<option value="${n}" ${store.edited.numNodes === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </label>
        <label>Map seed <input id="ng-seed" type="text" placeholder="random" value=""></label>
        <p class="hint">All other parameters come from the Tuning menu (⚙).</p>
        <div class="row">
          <button id="ng-start" class="primary">Start game</button>
          <button id="ng-cancel">Cancel</button>
        </div>
      </div></div>`;
      root.querySelector('#ng-cancel').addEventListener('click', () => { root.innerHTML = ''; });
      root.querySelector('#ng-start').addEventListener('click', () => {
        store.set('numAIOpponents', Number(root.querySelector('#ng-ai').value));
        store.set('numNodes', Number(root.querySelector('#ng-nodes').value));
        const seedText = root.querySelector('#ng-seed').value.trim();
        const seed = seedText === '' ? Math.floor(Math.random() * 2 ** 31) : hashSeed(seedText);
        root.innerHTML = '';
        this.game.newGame(seed);
      });
    }

    showGameOver() {
      const s = this.state;
      const ranked = [...s.players].sort((a, b) => b.cumulativeProfit - a.cumulativeProfit);
      const winner = ranked[0];
      const root = this.$('modal-root');
      root.innerHTML = `<div class="modal-back"><div class="modal">
        <h2>${winner.id === HUMAN ? '🏆 You win!' : `${winner.name} wins`}</h2>
        <ol class="standings">${ranked.map((p) =>
          `<li><i class="sw" style="background:${p.color}"></i> ${p.name} — <b>${formatCurrency(p.cumulativeProfit)}</b></li>`).join('')}
        </ol>
        <div class="row">
          <button id="go-new" class="primary">New game</button>
          <button id="go-close">Keep looking at the map</button>
        </div>
      </div></div>`;
      root.querySelector('#go-new').addEventListener('click', () => { root.innerHTML = ''; this.showNewGameModal(); });
      root.querySelector('#go-close').addEventListener('click', () => { root.innerHTML = ''; });
    }
  }

  function hashSeed(text) {
    if (/^\d+$/.test(text)) return Number(text) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  global.UIController = UIController;
  if (typeof module !== 'undefined' && module.exports) module.exports = UIController;
})(typeof globalThis !== 'undefined' ? globalThis : window);
