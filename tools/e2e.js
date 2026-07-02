#!/usr/bin/env node
// e2e.js — drives the real UI in headless Chromium via Playwright:
// select a suggested field, drill a well + refinery through the inspector,
// run turns, verify profit; open the tuning drawer, move a slider, verify
// live-apply + localStorage persistence across reload; exercise overlays.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tools/e2e.js
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const URL = 'file://' + path.join(__dirname, '..', 'index.html') + '?seed=42&notips=1';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL);
  await page.waitForFunction(() => window.debug && window.debug.game.state);

  // 1. suggestions present, click "Show me" on the first
  await page.waitForSelector('#suggest-body button[data-node]');
  const fieldId = await page.getAttribute('#suggest-body button[data-node]', 'data-node');
  await page.click('#suggest-body button[data-node]');
  check('suggestion selects a field in the inspector',
    await page.locator('#inspector-body').textContent().then((t) => t.includes('Oil field')));

  // 2. drill a well + refinery through the inspector buttons
  await page.click('#act-well');
  await page.waitForSelector('#act-refinery');
  await page.click('#act-refinery');
  const cashAfterBuild = await page.evaluate(() => window.debug.game.state.players[0].cash);
  check('well + refinery deducted cash', cashAfterBuild < 50e6 - 14e6, `cash=${cashAfterBuild}`);

  // 3. run 10 turns via the real Next-turn button, then check profit
  for (let i = 0; i < 10; i++) await page.click('#btn-next');
  const you = await page.evaluate(() => {
    const p = window.debug.game.state.players[0];
    return { profit: p.cumulativeProfit, sold: p.history[p.history.length - 1].barrelsSold, cash: p.cash };
  });
  check('human sells barrels after building', you.sold > 0, JSON.stringify(you));
  const opProfit = await page.evaluate(() => {
    const p = window.debug.game.state.players[0];
    const h = p.history[p.history.length - 1];
    return h.profit + h.costs.capex;
  });
  check('operating profit positive on latest turn', opProfit > 0, `opProfit=${opProfit}`);

  // 4. invariants clean via in-page debug API
  const problems = await page.evaluate(() => window.debug.verify());
  check('in-page invariants clean', problems.length === 0, problems.join('; '));

  // 5. tuning drawer: change truck cost, verify live-apply next turn
  await page.click('#btn-tuning');
  await page.waitForSelector('#tuning-drawer.open');
  const slider = page.locator('.tune-row', { hasText: 'Trucking' }).locator('input[type=range]');
  await slider.fill('6');
  const edited = await page.evaluate(() => window.debug.game.state.configStore.edited.truckCostPerEdge);
  check('slider writes edited config', edited === 6, `edited=${edited}`);
  await page.click('#btn-next');
  const active = await page.evaluate(() => window.debug.game.state.configStore.active.truckCostPerEdge);
  check('live-apply on next turn', active === 6, `active=${active}`);

  // 6. persistence across reload
  await page.reload();
  await page.waitForFunction(() => window.debug && window.debug.game.state);
  const persisted = await page.evaluate(() => window.debug.game.state.configStore.edited.truckCostPerEdge);
  check('tuning persists across reload (localStorage)', persisted === 6, `persisted=${persisted}`);
  await page.evaluate(() => window.debug.game.state.configStore.resetAll());

  // 7. overlays switch without errors
  for (const mode of ['price', 'flow', 'congestion', 'none']) {
    await page.click(`#overlay-seg button[data-overlay=${mode}]`);
  }

  // 8. new-game modal starts a fresh game with chosen AI count
  await page.click('#btn-newgame');
  await page.selectOption('#ng-ai', '0');
  await page.fill('#ng-seed', '777');
  await page.click('#ng-start');
  await page.waitForFunction(() => window.debug.game.state.seed === 777);
  const players = await page.evaluate(() => window.debug.game.state.players.length);
  check('new game honors AI count 0', players === 1, `players=${players}`);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\nE2E: all checks passed' : `\nE2E: ${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
