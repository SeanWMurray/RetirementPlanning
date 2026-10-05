/*
 * Analysis tab — solvers, tornado sensitivity and a two-way sensitivity grid.
 * Works on whichever scenario is active.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;

  function select(options, value, onchange) {
    return ui.input({ type: 'select', label: 'select', options: options }, value, onchange);
  }

  RP.tabs.register({
    id: 'analysis', label: 'Sensitivity',
    render: function (host) {
      var store = RP.store, settings = store.doc.settings.sensitivity;
      var plan = store.effective();
      var metricOpts = RP.metrics.list().map(function (m) { return { value: m.id, label: m.label }; });
      var varOpts = RP.sensitivityVariables.list().map(function (v) { return { value: v.id, label: v.label }; });
      function setS(patch) { store.updateSettings({ sensitivity: Object.assign({}, settings, patch) }); }

      // --- Solvers
      var maxSp = RP.analysis.maxRetirementSpending(plan);
      var early = RP.analysis.earliestRetirement(plan);
      var res = store.activeResult().result;
      var firstRet = res.years.filter(function (y) { return y.retired; })[0];
      var curSpend = firstRet ? firstRet.spendingBase / firstRet.cpi : null;
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'What can this plan support?'), h('p.card-sub', 'Solved by re-running the projection; everything else held constant'))),
        h('div.kpis.kpis-inline',
          h('div.kpi', h('div.kpi-label', "Max sustainable retirement spending"),
            h('div.kpi-value', maxSp.feasible ? fmt.money(maxSp.spendingReal) : 'Not feasible'),
            h('div.kpi-sub', maxSp.feasible ? "per year, today's $ (current: " + fmt.money(curSpend) + ')' : 'Even zero spending runs short')),
          h('div.kpi', h('div.kpi-label', 'Earliest retirement age'),
            h('div.kpi-value', early.age == null ? 'None' : String(early.age)),
            h('div.kpi-sub', early.age == null ? 'No age works with current spending' : 'Money lasts to ' + plan.profile.endAge + ' (current: ' + plan.profile.retirementAge + ')')))));

      // --- Tornado
      var tor = RP.analysis.tornado(plan, settings.metric);
      var torCanvas = h('canvas', { role: 'img', 'aria-label': 'Tornado sensitivity chart' });
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Which assumptions matter most?'), h('p.card-sub', 'Each input flexed low/high on its own. Base: ' + tor.metric.format(tor.base, tor.baseSummary))),
          h('div.inline-field', h('span.muted', 'Metric'), select(metricOpts, settings.metric, function (v) { setS({ metric: v }); }))),
        h('div.chart-box', { style: { height: (60 + tor.rows.length * 34) + 'px' } }, torCanvas),
        h('div.table-wrap', h('table.grid.compact',
          h('thead', h('tr', h('th.left', 'Input'), h('th', 'Low'), h('th', 'Result'), h('th', 'High'), h('th', 'Result'), h('th', 'Swing'))),
          h('tbody', tor.rows.map(function (r) {
            return h('tr', h('td.left', r.label), h('td.muted', r.lowLabel), h('td', tor.metric.format(r.low, tor.baseSummary)),
              h('td.muted', r.highLabel), h('td', tor.metric.format(r.high, tor.baseSummary)),
              h('td.strong', tor.metric.format === fmt.compact ? fmt.compact(r.swing) : String(r.swing)));
          }))))));
      RP.charts.tornado(torCanvas, tor);

      // --- Grid
      var g = RP.analysis.grid(plan, settings.gridX, settings.gridY, settings.metric);
      var all = [];
      g.cells.forEach(function (row) { row.forEach(function (c) { all.push(c.value); }); });
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      function shade(v) {
        var t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
        if (!g.metric.higherIsBetter) t = 1 - t;
        return 'color-mix(in oklab, var(--seq-hi) ' + Math.round(t * 100) + '%, var(--seq-lo))';
      }
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Two-way sensitivity'), h('p.card-sub', g.metric.label + ' — darker is better')),
          h('div.btn-row',
            h('div.inline-field', h('span.muted', 'Rows'), select(varOpts, settings.gridY, function (v) { setS({ gridY: v }); })),
            h('div.inline-field', h('span.muted', 'Columns'), select(varOpts, settings.gridX, function (v) { setS({ gridX: v }); })))),
        h('div.table-wrap', h('table.grid.heat',
          h('thead', h('tr', h('th.left', g.y.label + ' ↓ / ' + g.x.label + ' →'), g.x.gridValues.map(function (d) { return h('th', d === 0 ? 'Base' : g.x.fmtDelta(d)); }))),
          h('tbody', g.cells.map(function (row, i) {
            var dy = g.y.gridValues[i];
            return h('tr', h('th.left', dy === 0 ? 'Base' : g.y.fmtDelta(dy)), row.map(function (c, j) {
              var isBase = dy === 0 && g.x.gridValues[j] === 0;
              var t = hi > lo ? (c.value - lo) / (hi - lo) : 0.5;
              if (!g.metric.higherIsBetter) t = 1 - t;
              return h('td.heat-cell' + (isBase ? '.base' : '') + (t > 0.55 ? '.on-dark' : ''), { style: { background: shade(c.value) } }, g.metric.format(c.value, c.summary));
            }));
          }))))));
    }
  });
})(globalThis.RP);
