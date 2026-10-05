/*
 * Monte Carlo tab — probability of success under random market returns.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;
  var last = null, running = null;

  RP.tabs.register({
    id: 'montecarlo', label: 'Monte Carlo',
    render: function (host) {
      var store = RP.store, cfg = store.doc.settings.monteCarlo;
      var plan = store.effective();
      var stale = last && last.key !== JSON.stringify(plan) + cfg.runs + cfg.seed;

      var runsIn = ui.input({ type: 'number', label: 'Runs', min: 50, max: 5000, integer: true }, cfg.runs, function (v) { store.updateSettings({ monteCarlo: Object.assign({}, cfg, { runs: v }) }); });
      var seedIn = ui.input({ type: 'number', label: 'Seed', integer: true }, cfg.seed, function (v) { store.updateSettings({ monteCarlo: Object.assign({}, cfg, { seed: v }) }); });
      var progress = h('div.progress', h('div.progress-bar'));
      var runBtn = ui.button(running ? 'Running…' : 'Run simulation', run, { icon: 'play', cls: 'primary small', disabled: !!running });

      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Monte Carlo simulation'),
          h('p.card-sub', 'Re-runs the plan with random yearly market returns (volatility ' + fmt.pct(plan.assumptions.volatility) + ', set under Returns & inflation). Success = never running short of money.')),
          h('div.btn-row',
            h('label.inline-field', h('span.muted', 'Runs'), runsIn),
            h('label.inline-field', h('span.muted', 'Seed'), seedIn),
            runBtn)),
        running ? progress : null,
        stale ? h('div.callout', ui.icon('alert'), h('span', 'Inputs changed since this simulation ran. Run it again to update.')) : null,
        last ? renderResult(last) : h('div.empty', 'Run the simulation to see the range of outcomes.')));

      function run() {
        if (running) return;
        var key = JSON.stringify(plan) + cfg.runs + cfg.seed;
        running = RP.analysis.monteCarlo(plan, { runs: cfg.runs, seed: cfg.seed, volatility: plan.assumptions.volatility },
          function (p) { var b = host.querySelector('.progress-bar'); if (b) b.style.width = Math.round(p * 100) + '%'; },
          function (result) {
            running = null;
            var det = store.activeResult().result.years.map(function (y) { return y.total / y.cpiEnd; });
            last = { key: key, mc: result, det: det, endAge: plan.profile.endAge, retAge: plan.profile.retirementAge };
            RP.app.renderTab();
          });
        RP.app.renderTab();
      }
    }
  });

  function renderResult(r) {
    var mc = r.mc;
    var canvas = h('canvas', { role: 'img', 'aria-label': 'Monte Carlo fan chart' });
    var rate = mc.successRate;
    var status = rate >= 0.85 ? 'good' : rate >= 0.7 ? 'warning' : 'critical';
    var milestones = [r.retAge, r.retAge + 10, r.retAge + 20, r.endAge].filter(function (a, i, arr) { return mc.ages.indexOf(a) >= 0 && arr.indexOf(a) === i; });
    var wrap = h('div',
      h('div.kpis.kpis-inline',
        h('div.kpi', h('div.kpi-label', 'Probability of success'),
          h('div.kpi-value.status-' + status, ui.icon(status === 'good' ? 'check' : 'alert', 20), ' ', fmt.pct(rate, 0)),
          h('div.kpi-sub', mc.runs + ' simulations · ' + (status === 'good' ? 'robust' : status === 'warning' ? 'some risk' : 'high risk'))),
        h('div.kpi', h('div.kpi-label', 'Median ending portfolio'), h('div.kpi-value', fmt.compact(mc.bands.p50[mc.bands.p50.length - 1])), h('div.kpi-sub', "today's $")),
        h('div.kpi', h('div.kpi-label', 'Bad case (10th pct) at end'), h('div.kpi-value', fmt.compact(mc.bands.p10[mc.bands.p10.length - 1])), h('div.kpi-sub', "today's $")),
        h('div.kpi', h('div.kpi-label', 'When it fails'), h('div.kpi-value', mc.depletionMedian == null ? '—' : 'Age ' + Math.round(mc.depletionMedian)), h('div.kpi-sub', mc.depletionCount ? 'median first shortfall in failing runs' : 'no failing runs'))),
      h('div.chart-box.tall', canvas),
      h('div.table-wrap', h('table.grid.compact',
        h('thead', h('tr', h('th.left', "Portfolio (today's $)"), milestones.map(function (a) { return h('th', 'Age ' + a); }))),
        h('tbody', [['90th percentile', 'p90'], ['75th percentile', 'p75'], ['Median', 'p50'], ['25th percentile', 'p25'], ['10th percentile', 'p10']].map(function (row) {
          return h('tr', h('td.left', row[0]), milestones.map(function (a) { return h('td', fmt.compact(mc.bands[row[1]][mc.ages.indexOf(a)])); }));
        })))));
    setTimeout(function () { RP.charts.fan(canvas, mc, r.det); }, 0);
    return wrap;
  }
})(globalThis.RP);
