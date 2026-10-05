/*
 * charts.js — Chart.js wrappers (Chart.js is loaded from a CDN in index.html).
 *
 * Every chart function takes a <canvas> and data, and returns the Chart instance.
 * Colours come from CSS variables so light/dark themes stay consistent.
 * If Chart.js failed to load (offline), charts degrade to a message and the
 * rest of the app keeps working.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, fmt = RP.fmt;
  var charts = RP.charts = {};
  var instances = new WeakMap();

  charts.available = function () { return typeof window.Chart !== 'undefined'; };

  function series(i) { return ui.cssVar('--series-' + ((i % 8) + 1)); }
  charts.series = series;

  function base() {
    return {
      text: ui.cssVar('--text-2'), muted: ui.cssVar('--text-3'), grid: ui.cssVar('--grid'),
      axis: ui.cssVar('--axis'), surface: ui.cssVar('--surface'), ink: ui.cssVar('--text-1')
    };
  }

  function make(canvas, config) {
    if (!charts.available()) {
      var p = canvas.parentNode;
      if (p && !p.querySelector('.chart-offline')) p.appendChild(ui.h('div.chart-offline', 'Charts need an internet connection to load Chart.js from the CDN. Tables and calculations still work.'));
      return null;
    }
    var C = window.Chart;
    C.defaults.font.family = getComputedStyle(document.body).fontFamily;
    C.defaults.font.size = 11;
    C.defaults.color = ui.cssVar('--text-2');
    C.defaults.elements.bar.borderRadius = 0;
    var old = instances.get(canvas);
    if (old) old.destroy();
    var c = new window.Chart(canvas, config);
    instances.set(canvas, c);
    return c;
  }

  function moneyAxis(c, stacked) {
    return {
      stacked: !!stacked,
      grid: { color: c.grid, drawTicks: false },
      border: { display: true, color: c.axis },
      ticks: { color: c.muted, padding: 6, callback: function (v) { return fmt.compact(v); } }
    };
  }
  function ageAxis(c, stacked) {
    return {
      stacked: !!stacked,
      grid: { display: false },
      border: { color: c.axis },
      ticks: { color: c.muted, autoSkip: true, maxRotation: 0 },
      title: { display: true, text: 'Age', color: c.muted }
    };
  }
  function legend(c) {
    return { position: 'top', align: 'start', labels: { color: c.text, boxWidth: 12, boxHeight: 8, padding: 12, font: { size: 11 } } };
  }
  function tooltip(c, title) {
    return {
      mode: 'index', intersect: false, backgroundColor: c.surface, titleColor: c.ink, bodyColor: c.text,
      borderColor: c.axis, borderWidth: 1, padding: 6, boxPadding: 3, cornerRadius: 0, caretSize: 0,
      titleFont: { size: 11, weight: '600' }, bodyFont: { size: 11 }, boxWidth: 8, boxHeight: 8,
      callbacks: {
        title: title || function (items) { return items.length ? 'Age ' + items[0].label : ''; },
        label: function (it) { return ' ' + it.dataset.label + ': ' + fmt.money(it.parsed.y != null ? it.parsed.y : it.raw); }
      },
      itemSort: function (a, b) { return a.datasetIndex - b.datasetIndex; }
    };
  }

  /** Plugin: vertical crosshair, retirement marker and event ticks. */
  var markers = {
    id: 'rpMarkers',
    afterDatasetsDraw: function (chart, args, opts) {
      var ctx = chart.ctx, x = chart.scales.x, y = chart.scales.y;
      if (!x || !y) return;
      var c = base();
      ctx.save();
      (opts.lines || []).forEach(function (m) {
        var idx = chart.data.labels.indexOf(m.age);
        if (idx < 0) return;
        var px = x.getPixelForValue(idx);
        ctx.strokeStyle = m.color || c.muted;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = c.text;
        ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'left';
        ctx.fillText(m.label, px + 4, y.top + 12);
      });
      (opts.ticks || []).forEach(function (m) {
        var idx = chart.data.labels.indexOf(m.age);
        if (idx < 0) return;
        var px = x.getPixelForValue(idx);
        ctx.fillStyle = m.color || c.muted;
        ctx.beginPath(); ctx.moveTo(px, y.bottom - 1); ctx.lineTo(px - 4, y.bottom - 8); ctx.lineTo(px + 4, y.bottom - 8); ctx.closePath(); ctx.fill();
      });
      var act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (act.length) {
        var ax = act[0].element.x;
        ctx.strokeStyle = c.axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax, y.top); ctx.lineTo(ax, y.bottom); ctx.stroke();
      }
      ctx.restore();
    }
  };

  function clickAge(cb) {
    return function (evt, els, chart) {
      if (!cb) return;
      var x = chart.scales.x;
      var idx = Math.round(x.getValueForPixel(evt.x));
      var age = chart.data.labels[idx];
      if (age != null) cb(age, evt.native);
    };
  }

  function val(y, v, kind, real) {
    if (!real) return v;
    return v / (kind === 'balance' ? y.cpiEnd : y.cpi);
  }
  charts.val = val;

  /**
   * Portfolio chart. opts = { results, activeId, mode: 'stacked'|'total', real, onClickAge, events }
   */
  charts.portfolio = function (canvas, opts) {
    var c = base();
    var active = opts.results.filter(function (r) { return r.id === opts.activeId; })[0] || opts.results[0];
    var years = active.result.years;
    var labels = years.map(function (y) { return y.age; });
    var datasets = [];
    var plan = active.result.plan;

    if (opts.mode === 'stacked') {
      plan.accounts.forEach(function (a, i) {
        var col = series(i);
        datasets.push({
          label: a.name, stack: 'accounts', fill: i === 0 ? 'origin' : '-1', borderWidth: 1.5, order: 2, pointRadius: 0, tension: 0.15,
          borderColor: col, backgroundColor: col + 'b3',
          data: years.map(function (y) { return val(y, y.balances[a.id] || 0, 'balance', opts.real); })
        });
      });
    }
    opts.results.forEach(function (r) {
      if (!r.visible && r.id !== active.id) return;
      if (opts.mode === 'stacked' && r.id === active.id) return;
      var byAge = {};
      r.result.years.forEach(function (y) { byAge[y.age] = val(y, y.total, 'balance', opts.real); });
      datasets.push({
        label: r.name + (opts.mode === 'stacked' ? ' (total)' : ''), stack: 'sc_' + r.id, fill: false, order: 0,
        borderColor: r.color, backgroundColor: r.color, borderWidth: r.id === active.id ? 2.5 : 2,
        borderDash: r.id === active.id || opts.mode !== 'stacked' ? [] : [6, 4],
        pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
        data: labels.map(function (a) { return byAge[a] != null ? byAge[a] : null; })
      });
    });

    var lines = [{ age: plan.profile.retirementAge, label: 'Retire ' + plan.profile.retirementAge, color: c.muted }];
    var firstShort = active.result.summary.firstShortfallAge;
    if (firstShort != null) lines.push({ age: firstShort, label: 'Shortfall', color: ui.cssVar('--critical') });

    return make(canvas, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x: ageAxis(c), y: Object.assign(moneyAxis(c, true), { beginAtZero: true }) },
        plugins: { legend: legend(c), tooltip: tooltip(c), rpMarkers: { lines: lines, ticks: opts.events || [] } },
        onClick: clickAge(opts.onClickAge),
        onHover: function (e, els, chart) { chart.canvas.style.cursor = opts.onClickAge ? 'pointer' : 'default'; }
      },
      plugins: [markers]
    });
  };

  /** Cash flow: stacked sources of cash (bars) vs spending and spending + tax (lines). */
  charts.cashflow = function (canvas, opts) {
    var c = base();
    var years = opts.result.years;
    var labels = years.map(function (y) { return y.age; });
    var R = opts.real;
    function ds(label, i, fn) {
      return { type: 'bar', label: label, stack: 'in', order: 2, backgroundColor: series(i), borderColor: c.surface, borderWidth: { top: 1 }, borderRadius: 0,
        data: years.map(function (y) { return val(y, fn(y), 'flow', R); }) };
    }
    var datasets = [
      ds('Employment', 0, function (y) { return y.employment; }),
      ds('CPP', 1, function (y) { return y.cpp; }),
      ds('OAS', 2, function (y) { return y.oas; }),
      ds('Other income', 4, function (y) { return y.otherIncome; }),
      ds('Withdrawals', 3, function (y) { return y.withdrawals; }),
      { type: 'line', label: 'Spending', order: 0, borderColor: c.ink, backgroundColor: c.ink, borderWidth: 2, pointRadius: 0, tension: 0.1,
        data: years.map(function (y) { return val(y, y.spending, 'flow', R); }) },
      { type: 'line', label: 'Spending + tax', order: 0, borderColor: ui.cssVar('--critical'), backgroundColor: ui.cssVar('--critical'), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0.1,
        data: years.map(function (y) { return val(y, y.spending + y.tax, 'flow', R); }) }
    ];
    return make(canvas, {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        datasets: { bar: { categoryPercentage: 0.9, barPercentage: 0.95 } },
        scales: { x: ageAxis(c, true), y: moneyAxis(c, true) },
        plugins: { legend: legend(c), tooltip: tooltip(c), rpMarkers: { lines: [{ age: opts.result.plan.profile.retirementAge, label: 'Retire' }] } },
        onClick: clickAge(opts.onClickAge)
      },
      plugins: [markers]
    });
  };

  /** Tax by year: stacked federal / provincial / payroll / OAS clawback. */
  charts.taxes = function (canvas, opts) {
    var c = base();
    var years = opts.result.years, R = opts.real;
    function ds(label, i, fn) {
      return { label: label, backgroundColor: series(i), borderColor: c.surface, borderWidth: { top: 1 },
        data: years.map(function (y) { return val(y, fn(y), 'flow', R); }) };
    }
    return make(canvas, {
      type: 'bar',
      data: { labels: years.map(function (y) { return y.age; }), datasets: [
        ds('Federal', 0, function (y) { return y.taxDetail.federal; }),
        ds('Provincial', 1, function (y) { return y.taxDetail.provincial; }),
        ds('CPP / EI', 2, function (y) { return y.payroll; }),
        ds('OAS clawback', 7, function (y) { return y.oasClawback; })
      ] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x: ageAxis(c, true), y: moneyAxis(c, true) },
        plugins: { legend: legend(c), tooltip: tooltip(c) },
        onClick: clickAge(opts.onClickAge)
      }
    });
  };

  /** Tornado chart: horizontal floating bars around the base value. */
  charts.tornado = function (canvas, t) {
    var c = base();
    var m = t.metric;
    var labels = t.rows.map(function (r) { return r.label; });
    return make(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Low input', backgroundColor: series(1), borderRadius: 0, borderSkipped: false,
            data: t.rows.map(function (r) { return [t.base, r.low]; }) },
          { label: 'High input', backgroundColor: series(0), borderRadius: 0, borderSkipped: false,
            data: t.rows.map(function (r) { return [t.base, r.high]; }) }
        ]
      },
      options: {
        indexAxis: 'y', animation: false, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: c.grid }, border: { display: false }, ticks: { color: c.muted, callback: function (v) { return m.format(v, t.baseSummary); } } },
          y: { stacked: true, grid: { display: false }, ticks: { color: c.text } }
        },
        plugins: {
          legend: legend(c),
          tooltip: Object.assign(tooltip(c), {
            mode: 'nearest', intersect: true,
            callbacks: {
              title: function (items) { return items[0].label; },
              label: function (it) {
                var r = t.rows[it.dataIndex];
                var lab = it.datasetIndex === 0 ? r.lowLabel : r.highLabel;
                return ' ' + lab + ': ' + m.format(it.raw[1], t.baseSummary);
              }
            }
          }),
          rpBase: { value: t.base }
        }
      },
      plugins: [{
        id: 'rpBase',
        afterDatasetsDraw: function (chart, a, o) {
          var x = chart.scales.x, y = chart.scales.y, ctx = chart.ctx, px = x.getPixelForValue(o.value);
          ctx.save(); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom); ctx.stroke(); ctx.restore();
        }
      }]
    });
  };

  /** Monte Carlo fan chart. */
  charts.fan = function (canvas, mc, deterministic) {
    var c = base();
    var col = series(0);
    var b = mc.bands;
    function band(label, data, fill, alpha) {
      return { label: label, data: data, fill: fill, borderWidth: 0, pointRadius: 0, tension: 0.2, backgroundColor: col + alpha, borderColor: 'transparent' };
    }
    var datasets = [
      band('90th percentile', b.p90, false, '00'),
      band('10th–90th', b.p10, '-1', '3d'),
      band('75th percentile', b.p75, false, '00'),
      band('25th–75th', b.p25, '-1', '70'),
      { label: 'Median', data: b.p50, borderColor: col, backgroundColor: col, borderWidth: 2.5, pointRadius: 0, tension: 0.2, fill: false }
    ];
    if (deterministic) datasets.push({ label: 'Deterministic plan', data: deterministic, borderColor: c.ink, backgroundColor: c.ink, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
    return make(canvas, {
      type: 'line',
      data: { labels: mc.ages, datasets: datasets },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x: ageAxis(c), y: Object.assign(moneyAxis(c), { beginAtZero: true }) },
        plugins: {
          legend: Object.assign(legend(c), { labels: Object.assign(legend(c).labels, { filter: function (it) { return it.text.indexOf('percentile') < 0; } }) }),
          tooltip: Object.assign(tooltip(c), {
            filter: function (it) { return it.dataset.label.indexOf('–') < 0; },
            callbacks: Object.assign(tooltip(c).callbacks, {
              label: function (it) {
                var l = it.dataset.label;
                if (l === '90th percentile') l = '90th pct';
                if (l === '75th percentile') l = '75th pct';
                return ' ' + l + ': ' + fmt.money(it.parsed.y);
              },
              afterBody: function (items) {
                var i = items[0].dataIndex;
                return ['25th pct: ' + fmt.money(b.p25[i]), '10th pct: ' + fmt.money(b.p10[i])];
              }
            })
          })
        }
      },
      plugins: [markers]
    });
  };
})(globalThis.RP);
