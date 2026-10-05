/*
 * Engine tests — run with:  node tests/run-tests.js
 * No dependencies. Loads the same browser script files into Node's global scope.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
[
  'js/core.js', 'js/data/tax-2026.js', 'js/engine/tax.js', 'js/engine/events.js',
  'js/engine/strategies.js', 'js/engine/projection.js', 'js/engine/scenarios.js',
  'js/engine/analysis.js', 'js/state/schema.js'
].forEach(function (f) { vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }); });

var RP = globalThis.RP;
var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

var d = RP.taxData['2026'];
function ctx(prov, age, settings) {
  return { age: age || 40, province: prov || 'ON', data: d, index: 1,
    settings: Object.assign({ mode: 'calculated', includePayroll: true, oasClawback: true }, settings || {}) };
}

console.log('Tax');
test('bracket tax federal at $100k', function () {
  // 58,523 * 14% + (100,000 - 58,523) * 20.5%
  near(RP.tax.bracketTax(100000, d.federal.brackets, 1), 58523 * 0.14 + 41477 * 0.205, 0.01);
});
test('zero income -> zero tax', function () {
  var r = RP.tax.compute({ employment: 0 }, ctx());
  near(r.totalWithPayroll, 0, 0.001);
});
test('income below BPA -> no federal income tax', function () {
  var r = RP.tax.compute({ other: 12000 }, ctx('ON', 40));
  near(r.federal, 0, 0.001);
  near(r.provincial, 0, 0.001);
});
test('ON $100k employment: plausible total income tax', function () {
  var r = RP.tax.compute({ employment: 100000 }, ctx('ON', 40));
  // Expect roughly $21–23k income tax (fed + ON incl. surtax/OHP) and ~$5.5k CPP+EI.
  ok(r.incomeTax > 19000 && r.incomeTax < 24000, 'income tax ' + r.incomeTax);
  ok(r.payroll.total > 5000 && r.payroll.total < 6500, 'payroll ' + r.payroll.total);
});
test('CPP max contributions 2026', function () {
  var p = RP.tax.payroll(200000, ctx('ON', 40));
  near(p.cpp, (74600 - 3500) * 0.0595, 0.5);
  near(p.cpp2, (85000 - 74600) * 0.04, 0.5);
  near(p.ei, 68900 * 0.0163, 0.5);
});
test('OAS clawback above threshold', function () {
  var r = RP.tax.compute({ other: 120000, oas: 8900 }, ctx('ON', 70));
  near(r.oasClawback, Math.min(8900, (128900 - 95323) * 0.15), 1);
});
test('Quebec abatement reduces federal tax', function () {
  var on = RP.tax.compute({ other: 80000 }, ctx('ON', 40));
  var qc = RP.tax.compute({ other: 80000 }, ctx('QC', 40));
  near(qc.federal, on.federal * (1 - 0.165), 1);
});
test('flat rate override', function () {
  var r = RP.tax.compute({ other: 100000 }, ctx('ON', 40, { mode: 'flat', flatRate: 0.25, includePayroll: false }));
  near(r.total, 25000, 0.01);
});
test('every province computes', function () {
  Object.keys(d.provinces).forEach(function (p) {
    var r = RP.tax.compute({ employment: 90000 }, ctx(p, 40));
    ok(r.incomeTax > 10000 && r.incomeTax < 30000, p + ' ' + r.incomeTax);
  });
});
test('marginal rate ON $250k ~ 48–54%', function () {
  var m = RP.tax.marginal({ other: 250000 }, ctx('ON', 40, { includePayroll: false }));
  ok(m > 0.47 && m < 0.55, 'marginal ' + m);
});

console.log('Projection');
var doc = RP.schema.newDocument();
var plan = RP.scenarios.effective(doc, 'base');
var res = RP.engine.project(plan);
test('one row per age', function () {
  ok(res.years.length === plan.profile.endAge - plan.profile.currentAge + 1);
  ok(res.years[0].age === plan.profile.currentAge);
});
test('accumulates before retirement', function () {
  var atRet = res.summary.atRetirement;
  ok(atRet > 125000 * 2, 'portfolio at retirement ' + atRet);
});
test('cash flow identity holds every year', function () {
  res.years.forEach(function (y) {
    var inflow = y.incomeTotal + y.withdrawals;
    var outflow = y.tax + y.spending + y.contributions + y.unallocated;
    near(inflow + y.shortfall, outflow, 2, 'age ' + y.age);
  });
});
test('balances never negative', function () {
  res.years.forEach(function (y) { Object.keys(y.balances).forEach(function (k) { ok(y.balances[k] >= 0); }); });
});
test('RRIF minimum applied at 72+', function () {
  var y = res.years.filter(function (r) { return r.age === 75; })[0];
  if (y && y.balances.rrsp > 0) ok(y.rrifMin > 0, 'rrif min');
});
test('expense event reduces ending balance', function () {
  var p2 = RP.util.clone(plan);
  p2.events = [RP.events.create('expense', 50, p2)];
  p2.events[0].amount = 100000;
  var r2 = RP.engine.project(p2);
  ok(r2.summary.ending < res.summary.ending, 'ending lower');
  ok(r2.years.filter(function (y) { return y.age === 50; })[0].eventExpenses > 100000);
});
test('step adjustment: sabbatical zeroes income', function () {
  var p2 = RP.util.clone(plan);
  var ev = RP.events.create('adjustment', 45, p2);
  Object.assign(ev, { target: 'income', kind: 'step', pct: -1, startAge: 45, endAge: 45 });
  p2.events = [ev];
  var r2 = RP.engine.project(p2);
  near(r2.years.filter(function (y) { return y.age === 45; })[0].employment, 0, 0.01);
  ok(r2.years.filter(function (y) { return y.age === 46; })[0].employment > 0);
});
test('return override crash lowers portfolio', function () {
  var p2 = RP.util.clone(plan);
  var ev = RP.events.create('returnOverride', 60, p2);
  p2.events = [ev];
  var r2 = RP.engine.project(p2);
  ok(r2.summary.ending < res.summary.ending);
});
test('fixed % strategy and % of balance run', function () {
  ['fixedReal', 'percentBalance'].forEach(function (s) {
    var p2 = RP.util.clone(plan); p2.retirement.strategy = s;
    var r2 = RP.engine.project(p2);
    ok(r2.years.length > 0);
  });
});
test('savings modes run', function () {
  ['percentGross', 'fixed'].forEach(function (m) {
    var p2 = RP.util.clone(plan); p2.savings.mode = m;
    var r2 = RP.engine.project(p2);
    ok(r2.summary.atRetirement > 0, m);
  });
});
test('huge spending -> shortfall detected', function () {
  var p2 = RP.util.clone(plan); p2.spending.total = 200000;
  var r2 = RP.engine.project(p2);
  ok(!r2.summary.success && r2.summary.firstShortfallAge != null);
});

console.log('Scenarios & analysis');
test('scenario override applies, base unchanged', function () {
  var d2 = RP.util.clone(doc);
  var s = RP.schema.newScenario(d2, 'Retire 55');
  s.overrides['profile.retirementAge'] = 55;
  d2.scenarios.push(s);
  ok(RP.scenarios.effective(d2, s.id).profile.retirementAge === 55);
  ok(RP.scenarios.effective(d2, 'base').profile.retirementAge === 60);
});
test('tornado returns sorted rows', function () {
  var t = RP.analysis.tornado(plan, 'endingReal');
  ok(t.rows.length >= 5 && t.rows[0].swing >= t.rows[t.rows.length - 1].swing);
});
test('max spending solver', function () {
  var m = RP.analysis.maxRetirementSpending(plan);
  ok(m.feasible && m.spendingReal > 0, JSON.stringify(m));
});
test('normalize fills new defaults into old documents', function () {
  var old = { app: 'canadian-retirement-planner', schemaVersion: 1, base: { profile: { currentAge: 50 } } };
  var n = RP.schema.normalize(old);
  ok(n.base.profile.currentAge === 50 && n.base.assumptions.inflation > 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
