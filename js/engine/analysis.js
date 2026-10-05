/*
 * analysis.js — sensitivity analysis, solvers and Monte Carlo simulation.
 *
 * Built on two registries so new analyses are one entry each:
 *   RP.metrics              — outputs we can measure from a projection summary
 *   RP.sensitivityVariables — inputs we can flex, with sensible low/high values
 */
(function (RP) {
  'use strict';
  var U = RP.util, num = U.num, fmt = RP.fmt;
  var A = RP.analysis = {};

  // ---------------------------------------------------------------------------
  RP.metrics = RP.createRegistry('metrics');
  RP.metrics.register({ id: 'endingReal', label: "Ending portfolio (today's $)", format: fmt.compact, higherIsBetter: true,
    get: function (s) { return s.endingReal; } });
  RP.metrics.register({ id: 'atRetirementReal', label: "Portfolio at retirement (today's $)", format: fmt.compact, higherIsBetter: true,
    get: function (s) { return s.atRetirementReal; } });
  RP.metrics.register({ id: 'fundedTo', label: 'Money lasts to age', format: function (v, s) { return v > (s && s.endAge || 200) ? (s ? s.endAge + '+' : 'never runs out') : String(v); }, higherIsBetter: true,
    get: function (s) { return s.firstShortfallAge == null ? s.endAge + 1 : s.firstShortfallAge; } });
  RP.metrics.register({ id: 'lifetimeTaxReal', label: "Lifetime tax (today's $)", format: fmt.compact, higherIsBetter: false,
    get: function (s) { return s.lifetimeTaxReal; } });

  // ---------------------------------------------------------------------------
  RP.sensitivityVariables = RP.createRegistry('sensitivityVariables');
  function reg(def) { RP.sensitivityVariables.register(def); }

  reg({ id: 'returns', label: 'Investment returns', unit: 'pp', deltas: [-0.01, 0.01],
    gridValues: [-0.02, -0.01, 0, 0.01, 0.02],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pp'; },
    apply: function (p, d) { p.assumptions.returnPre = num(p.assumptions.returnPre) + d; p.assumptions.returnPost = num(p.assumptions.returnPost) + d; } });
  reg({ id: 'inflation', label: 'Inflation', unit: 'pp', deltas: [-0.01, 0.01], gridValues: [-0.01, -0.005, 0, 0.005, 0.01],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pp'; },
    apply: function (p, d) { p.assumptions.inflation = num(p.assumptions.inflation) + d; } });
  reg({ id: 'spending', label: 'Spending', unit: '%', deltas: [-0.1, 0.1], gridValues: [-0.2, -0.1, 0, 0.1, 0.2],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + Math.round(d * 100) + '%'; },
    apply: function (p, d) {
      p.spending.total = num(p.spending.total) * (1 + d);
      (p.spending.items || []).forEach(function (it) { it.amount = num(it.amount) * (1 + d); });
    } });
  reg({ id: 'retirementAge', label: 'Retirement age', unit: 'yrs', deltas: [-2, 2], gridValues: [-4, -2, 0, 2, 4],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + d + ' yrs'; },
    apply: function (p, d) { p.profile.retirementAge = U.clamp(num(p.profile.retirementAge) + d, num(p.profile.currentAge), num(p.profile.endAge)); } });
  reg({ id: 'salaryGrowth', label: 'Salary growth', unit: 'pp', deltas: [-0.01, 0.01], gridValues: [-0.02, -0.01, 0, 0.01, 0.02],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' pp'; },
    apply: function (p, d) { p.income.growth = num(p.income.growth) + d; } });
  reg({ id: 'salary', label: 'Salary', unit: '%', deltas: [-0.1, 0.1], gridValues: [-0.2, -0.1, 0, 0.1, 0.2],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + Math.round(d * 100) + '%'; },
    apply: function (p, d) { p.income.salary = num(p.income.salary) * (1 + d); } });
  reg({ id: 'longevity', label: 'Life expectancy', unit: 'yrs', deltas: [-5, 5], gridValues: [-10, -5, 0, 5, 10],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + d + ' yrs'; },
    apply: function (p, d) { p.profile.endAge = Math.max(num(p.profile.retirementAge) + 1, num(p.profile.endAge) + d); } });
  reg({ id: 'cppStart', label: 'CPP start age', unit: 'age', deltas: [-5, 5], gridValues: [-5, -2, 0, 2, 5],
    fmtDelta: function (d) { return (d >= 0 ? '+' : '') + d + ' yrs'; },
    apply: function (p, d) { p.benefits.cppStartAge = U.clamp(num(p.benefits.cppStartAge) + d, 60, 70); } });

  function runWith(plan, fn) {
    var p = U.clone(plan);
    fn(p);
    return RP.engine.project(p, { lite: true }).summary;
  }

  /** Tornado: for each variable, metric at low and high values. Sorted by swing. */
  A.tornado = function (plan, metricId) {
    var m = RP.metrics.get(metricId);
    var baseS = RP.engine.project(plan, { lite: true }).summary;
    var base = m.get(baseS);
    var rows = RP.sensitivityVariables.list().map(function (v) {
      var lo = m.get(runWith(plan, function (p) { v.apply(p, v.deltas[0]); }));
      var hi = m.get(runWith(plan, function (p) { v.apply(p, v.deltas[1]); }));
      return { id: v.id, label: v.label, lowLabel: v.fmtDelta(v.deltas[0]), highLabel: v.fmtDelta(v.deltas[1]), low: lo, high: hi, swing: Math.abs(hi - lo) };
    });
    rows.sort(function (a, b) { return b.swing - a.swing; });
    return { base: base, baseSummary: baseS, rows: rows, metric: m };
  };

  /** Two-way grid of a metric across two variables. */
  A.grid = function (plan, xId, yId, metricId) {
    var vx = RP.sensitivityVariables.get(xId), vy = RP.sensitivityVariables.get(yId), m = RP.metrics.get(metricId);
    var cells = vy.gridValues.map(function (dy) {
      return vx.gridValues.map(function (dx) {
        var s = runWith(plan, function (p) { vx.apply(p, dx); vy.apply(p, dy); });
        return { value: m.get(s), summary: s };
      });
    });
    return { x: vx, y: vy, metric: m, cells: cells };
  };

  /** Largest retirement spending (today's $, first retirement year) the plan can sustain to endAge. */
  A.maxRetirementSpending = function (plan) {
    var rc = num(plan.spending.retirementChange);
    function ok(mult) {
      return runWith(plan, function (p) { p.spending.retirementChange = (1 + rc) * mult - 1; }).success;
    }
    var lo = 0, hi = 1;
    if (!ok(0)) return { feasible: false };
    while (ok(hi) && hi < 64) { lo = hi; hi *= 2; }
    for (var i = 0; i < 30; i++) {
      var mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid; else hi = mid;
    }
    var p = U.clone(plan);
    p.spending.retirementChange = (1 + rc) * lo - 1;
    var res = RP.engine.project(p);
    var retRow = res.years.filter(function (y) { return y.retired; })[0];
    return {
      feasible: true, multiplier: lo,
      spendingReal: retRow ? retRow.spendingBase / retRow.cpi : null
    };
  };

  /** Earliest retirement age where the plan never runs short. */
  A.earliestRetirement = function (plan) {
    var start = Math.round(num(plan.profile.currentAge)), end = Math.round(num(plan.profile.endAge));
    for (var age = start; age <= end; age++) {
      var s = runWith(plan, function (p) { p.profile.retirementAge = age; });
      if (s.success) return { age: age };
    }
    return { age: null };
  };

  /**
   * Monte Carlo: random annual market returns around the plan's expected return.
   * The return you enter is treated as a compound (geometric) rate, so each
   * year's growth factor is (1 + r)·e^(σz): lognormal with its median at the
   * plan's rate. The median simulation therefore tracks the deterministic
   * projection, and the spread comes from volatility and sequence risk.
   * Runs in chunks so the UI stays responsive.
   */
  A.monteCarlo = function (plan, cfg, onProgress, onDone) {
    var runs = Math.max(10, Math.round(num(cfg.runs, 500)));
    var sigma = num(cfg.volatility, num(plan.assumptions.volatility, 0.1));
    var rand = U.rng(num(cfg.seed, 42));
    var nYears = Math.round(num(plan.profile.endAge)) - Math.round(num(plan.profile.currentAge)) + 1;
    var paths = [], successes = 0, depletion = [];
    var cancelled = false;
    var i = 0;
    function chunk() {
      if (cancelled) return;
      var stop = Math.min(runs, i + 25);
      for (; i < stop; i++) {
        var shocks = new Array(nYears);
        for (var t = 0; t < nYears; t++) shocks[t] = Math.exp(sigma * U.gaussian(rand)) - 1;
        var res = RP.engine.project(plan, { lite: true, returnShocks: shocks });
        paths.push(res.years.map(function (y) { return y.real; }));
        if (res.summary.success) successes++;
        else depletion.push(res.summary.firstShortfallAge);
      }
      if (onProgress) onProgress(i / runs);
      if (i < runs) setTimeout(chunk, 0);
      else onDone(summarize());
    }
    function summarize() {
      var ages = [], startAge = Math.round(num(plan.profile.currentAge));
      var bands = { p10: [], p25: [], p50: [], p75: [], p90: [] };
      for (var t = 0; t < nYears; t++) {
        ages.push(startAge + t);
        var col = paths.map(function (p) { return p[t]; }).sort(function (a, b) { return a - b; });
        bands.p10.push(U.percentile(col, 0.10));
        bands.p25.push(U.percentile(col, 0.25));
        bands.p50.push(U.percentile(col, 0.50));
        bands.p75.push(U.percentile(col, 0.75));
        bands.p90.push(U.percentile(col, 0.90));
      }
      depletion.sort(function (a, b) { return a - b; });
      return { runs: runs, sigma: sigma, successRate: successes / runs, ages: ages, bands: bands,
        depletionMedian: depletion.length ? U.percentile(depletion, 0.5) : null, depletionCount: depletion.length };
    }
    setTimeout(chunk, 0);
    return { cancel: function () { cancelled = true; } };
  };
})(globalThis.RP);
