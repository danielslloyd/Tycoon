// tuningMenu.js — the balance-tuning drawer. Every control is generated from
// CONFIG_SCHEMA, so adding a parameter there automatically adds its slider.
// Live params apply at the start of the next turn; map/setup params show a
// "new game" badge and light up the regenerate button when changed.
(function (global) {
  'use strict';

  const { formatCurrency, formatNumber } = global.Util;

  function fmtValue(param, v) {
    if (param.format === 'currency') return formatCurrency(v);
    if (param.format === 'percent') return `${(v * 100).toFixed(1)}%`;
    if (Math.abs(v) >= 10000) return formatNumber(v);
    return String(v);
  }

  class TuningMenu {
    // hooks: { onLiveChange(), onNewGameRequested() }
    constructor(drawerEl, configStore, hooks) {
      this.el = drawerEl;
      this.store = configStore;
      this.hooks = hooks;
      this.controls = new Map(); // key → {slider, valueEl}
      this.build();
    }

    build() {
      const s = this.store;
      this.el.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'drawer-head';
      head.innerHTML = `<h2>Tuning</h2>
        <p class="hint">Live values apply next turn. <span class="badge">new game</span> values apply when you regenerate.</p>
        <button class="drawer-close" title="Close">✕</button>`;
      head.querySelector('.drawer-close').addEventListener('click', () => this.toggle(false));
      this.el.appendChild(head);

      const body = document.createElement('div');
      body.className = 'drawer-body';
      this.el.appendChild(body);

      for (const group of global.Config.CONFIG_SCHEMA) {
        const details = document.createElement('details');
        details.open = group.id === 'costs' || group.id === 'transport';
        const summary = document.createElement('summary');
        summary.textContent = group.label;
        details.appendChild(summary);

        for (const p of group.params) {
          const row = document.createElement('div');
          row.className = 'tune-row';
          row.title = p.help || '';
          const badge = p.requiresNewGame ? '<span class="badge">new game</span>' : '';
          row.innerHTML = `
            <div class="tune-label">${p.label} ${badge}</div>
            <div class="tune-control">
              <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${s.edited[p.key]}">
              <span class="tune-value"></span>
              <button class="tune-reset" title="Reset to default (${fmtValue(p, p.default)})">↺</button>
            </div>`;
          const slider = row.querySelector('input');
          const valueEl = row.querySelector('.tune-value');
          valueEl.textContent = fmtValue(p, s.edited[p.key]);
          slider.addEventListener('input', () => {
            s.set(p.key, Number(slider.value));
            valueEl.textContent = fmtValue(p, s.edited[p.key]);
            this.afterChange(p);
          });
          row.querySelector('.tune-reset').addEventListener('click', () => {
            s.reset(p.key);
            slider.value = s.edited[p.key];
            valueEl.textContent = fmtValue(p, s.edited[p.key]);
            this.afterChange(p);
          });
          this.controls.set(p.key, { slider, valueEl, param: p });
          details.appendChild(row);
        }
        body.appendChild(details);
      }

      // footer
      const foot = document.createElement('div');
      foot.className = 'drawer-foot';
      foot.innerHTML = `
        <button id="tune-newgame" class="primary hidden">Regenerate map / start new game</button>
        <div class="row">
          <button id="tune-export">Export JSON</button>
          <button id="tune-import">Import JSON</button>
          <button id="tune-resetall">Reset all</button>
        </div>
        <textarea id="tune-json" class="hidden" rows="8" spellcheck="false"></textarea>
        <div id="tune-json-actions" class="row hidden">
          <button id="tune-json-apply">Apply pasted JSON</button>
          <button id="tune-json-download">Download file</button>
          <button id="tune-json-close">Close</button>
        </div>`;
      this.el.appendChild(foot);

      this.newGameBtn = foot.querySelector('#tune-newgame');
      this.newGameBtn.addEventListener('click', () => this.hooks.onNewGameRequested());
      foot.querySelector('#tune-resetall').addEventListener('click', () => {
        this.store.resetAll();
        this.refresh();
        this.afterChange(null);
      });

      const jsonArea = foot.querySelector('#tune-json');
      const jsonActions = foot.querySelector('#tune-json-actions');
      const showJson = (text) => {
        jsonArea.value = text;
        jsonArea.classList.remove('hidden');
        jsonActions.classList.remove('hidden');
      };
      foot.querySelector('#tune-export').addEventListener('click', () => showJson(this.store.exportJSON()));
      foot.querySelector('#tune-import').addEventListener('click', () => showJson(''));
      foot.querySelector('#tune-json-close').addEventListener('click', () => {
        jsonArea.classList.add('hidden');
        jsonActions.classList.add('hidden');
      });
      foot.querySelector('#tune-json-download').addEventListener('click', () => {
        const blob = new Blob([this.store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'oil-gas-tycoon-tuning.json';
        a.click();
        URL.revokeObjectURL(a.href);
      });
      foot.querySelector('#tune-json-apply').addEventListener('click', () => {
        const res = this.store.importJSON(jsonArea.value);
        if (res.error) { this.hooks.onToast && this.hooks.onToast(res.error, 'warn'); return; }
        this.refresh();
        this.afterChange(null);
        this.hooks.onToast && this.hooks.onToast(`Imported ${res.applied} values (${res.ignored} unknown ignored)`);
      });
    }

    afterChange(param) {
      this.updateNewGameButton();
      if (!param || !param.requiresNewGame) this.hooks.onLiveChange && this.hooks.onLiveChange();
    }

    updateNewGameButton() {
      this.newGameBtn.classList.toggle('hidden', !this.store.needsNewGame());
    }

    // Re-read all slider positions from the store (after import/reset-all).
    refresh() {
      for (const [key, c] of this.controls) {
        c.slider.value = this.store.edited[key];
        c.valueEl.textContent = fmtValue(c.param, this.store.edited[key]);
      }
      this.updateNewGameButton();
    }

    toggle(open) {
      const want = open !== undefined ? open : !this.el.classList.contains('open');
      this.el.classList.toggle('open', want);
    }
  }

  global.TuningMenu = TuningMenu;
  if (typeof module !== 'undefined' && module.exports) module.exports = TuningMenu;
})(typeof globalThis !== 'undefined' ? globalThis : window);
