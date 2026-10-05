/*
 * Regenerates the README screenshots (light + dark) from a demo plan.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tools/screenshots.js
 *
 * Optional: CHARTJS_PATH=/path/to/chart.umd.js serves Chart.js locally if the CDN is unreachable.
 * Development tooling only; the app itself needs none of this.
 */
const path = require('path');
const { chromium, devices } = require('playwright');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots') + path.sep;
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    if (process.env.CHARTJS_PATH) await page.route('**/chart.umd.min.js', r => r.fulfill({ path: process.env.CHARTJS_PATH, contentType: 'application/javascript' }));
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      localStorage.clear();
      const s = RP.store; s.reset();
      s.update(d => {
        d.meta.name = 'Demo plan';
        const p = d.base;
        const mk = (type, age, patch) => Object.assign(RP.events.create(type, age, p), patch);
        p.events.push(mk('expense', 65, { label: 'Vehicle replacement', amount: 40000, everyYears: 8, endAge: 89 }));
        p.events.push(mk('expense', 60, { label: 'Travel', amount: 12000, endAge: 69 }));
        p.events.push(mk('income', 60, { label: 'Consulting', amount: 30000, endAge: 63 }));
        p.events.push(mk('lumpSum', 72, { label: 'Home downsizing', amount: 250000 }));
        p.events.push(mk('adjustment', 45, { label: 'Sabbatical', target: 'income', kind: 'step', pct: -1, endAge: 45 }));
      });
      const base = s.effective('base');
      s.addScenario('Retire at 57', sc => { sc.overrides['profile.retirementAge'] = 57; });
      s.addScenario('Crash at retirement', sc => RP.scenarioTemplates.get('crashAtRetirement').init(sc, base));
      s.setActive('base');
      s.ui.collapsed = { accounts: true, savings: true, assumptions: true, benefits: true, retirement: true, tax: true, events: false };
      document.querySelectorAll('details.section').forEach(d => { const id = RP.inputSections.list()[[...d.parentNode.children].filter(x => x.tagName === 'DETAILS').indexOf(d)].id; d.open = !s.ui.collapsed[id]; });
    });
    await page.waitForTimeout(500);
    const shot = async (name, tab, before) => {
      if (tab) await page.click(`.tab:has-text("${tab}")`);
      if (before) await before();
      await page.waitForTimeout(700);
      await page.evaluate(() => document.querySelector('.tab-host').scrollTop = 0);
      await page.screenshot({ path: OUT + scheme + '-' + name + '.png' });
    };
    await shot('projection', 'Projection');
    await shot('scenarios', 'Scenarios');
    await shot('sensitivity', 'Sensitivity');
    await shot('montecarlo', 'Monte Carlo', async () => { await page.click('button:has-text("Run simulation")'); await page.waitForTimeout(2500); });
    await shot('tax', 'Tax', async () => { await page.selectOption('.card-head select', '65'); });
    await shot('events', 'Events');
    // Table + row menu
    await page.click('.tab:has-text("Projection")'); await page.waitForTimeout(500);
    await page.evaluate(() => { const w = document.querySelector('.tab-host'); w.scrollTop = w.scrollHeight; });
    await page.waitForTimeout(300);
    const row = page.locator('table.grid tbody tr').nth(25);
    await row.scrollIntoViewIfNeeded(); await row.click(); await page.waitForTimeout(400);
    await page.screenshot({ path: OUT + scheme + '-table-menu.png' });
    console.log(scheme, errors.length ? errors : 'ok');
    await page.close();
  }
  // Phone screenshots (iPhone-sized, 2x to keep files small)
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    if (process.env.CHARTJS_PATH) await page.route('**/chart.umd.min.js', r => r.fulfill({ path: process.env.CHARTJS_PATH, contentType: 'application/javascript' }));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForTimeout(800);
    await page.evaluate(() => { localStorage.clear(); RP.store.importJson(JSON.stringify(RP.examples[1].doc)); RP.store.setActive('base'); });
    await page.evaluate(() => RP.app.setMobileView('results'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: OUT + 'mobile-' + scheme + '-results.png' });
    await page.evaluate(() => RP.app.setMobileView('inputs'));
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + 'mobile-' + scheme + '-inputs.png' });
    console.log('mobile ' + scheme + ' ok');
    await ctx.close();
  }
  await browser.close();
})();
