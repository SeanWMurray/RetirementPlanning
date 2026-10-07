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
  'js/engine/analysis.js', 'js/state/schema.js', 'js/data/examples.js'
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

console.log('Contributions & room');
function rowAt(r, age) { return r.years.filter(function (y) { return y.age === age; })[0]; }
test('TFSA limit indexes in $500 steps', function () {
  ok(RP.engine.tfsaLimit(2026, d, 0.02) === 7000);
  ok(RP.engine.tfsaLimit(2030, d, 0.02) === 7500, 'got ' + RP.engine.tfsaLimit(2030, d, 0.02));
  ok(RP.engine.tfsaLimit(2040, d, 0.02) % 500 === 0);
});
test('TFSA contributions never exceed cumulative room', function () {
  var r = RP.engine.project(plan);
  var room = 0, prevW = 0;
  r.years.forEach(function (y) {
    room += RP.engine.tfsaLimit(y.year, d, plan.assumptions.inflation) + prevW;
    ok(y.contribByAccount.tfsa <= room + 0.01, 'age ' + y.age);
    room -= y.contribByAccount.tfsa;
    near(y.roomByAccount.tfsa, room, 0.5, 'room age ' + y.age);
    prevW = y.withdrawByAccount.tfsa;
  });
});
test('starting TFSA room is used in year one', function () {
  var p2 = RP.util.clone(plan); p2.accounts[1].startingRoom = 50000;
  p2.savings.order = ['tfsa', 'rrsp', 'cash', 'nonreg'];
  var r = RP.engine.project(p2);
  var y0 = rowAt(r, 35);
  ok(y0.contribByAccount.tfsa > 15000, 'tfsa ' + y0.contribByAccount.tfsa);
  near(y0.contribByAccount.rrsp, 0, 0.01, 'rrsp');
  near(rowAt(r, 35).roomByAccount.tfsa, 50000 - rowAt(r, 35).contribByAccount.tfsa, 0.5);
});
test('RRSP room = 18% of prior-year earnings', function () {
  var p2 = RP.util.clone(plan); p2.accounts[0].startingRoom = 0;
  var r = RP.engine.project(p2);
  near(rowAt(r, 35).contribByAccount.rrsp, 0, 0.01);
  near(rowAt(r, 36).contribByAccount.rrsp, 0.18 * rowAt(r, 35).employment, 1);
});
test('custom amount and "none" modes', function () {
  var p2 = RP.util.clone(plan);
  p2.accounts[1].contribLimit = 'custom'; p2.accounts[1].contributionCap = 2000;
  p2.accounts[0].contribLimit = 'none';
  var r = RP.engine.project(p2);
  near(rowAt(r, 40).contribByAccount.tfsa, 2000 * rowAt(r, 40).cpi, 1);
  near(rowAt(r, 40).contribByAccount.rrsp, 0, 0.01);
});
test('contribution event overrides an account for an age range', function () {
  var p2 = RP.util.clone(plan);
  var ev = RP.events.create('contribution', 40, p2);
  Object.assign(ev, { accountId: 'rrsp', mode: 'none', startAge: 40, endAge: 44 });
  p2.events = [ev];
  var r = RP.engine.project(p2);
  near(rowAt(r, 42).contribByAccount.rrsp, 0, 0.01);
  ok(rowAt(r, 45).contribByAccount.rrsp > 0);
});
test('no RRSP contributions after 71', function () {
  var p2 = RP.util.clone(plan); p2.profile.retirementAge = 80;
  var r = RP.engine.project(p2);
  near(rowAt(r, 75).contribByAccount.rrsp, 0, 0.01);
});
test('surplus with no account able to take it is reported, not lost', function () {
  var p2 = RP.util.clone(plan);
  p2.accounts.forEach(function (a) { a.contribLimit = a.type === 'nonreg' ? 'none' : a.contribLimit; });
  var r = RP.engine.project(p2);
  ok(rowAt(r, 40).unallocated > 0);
  r.years.forEach(function (y) {
    near(y.incomeTotal + y.withdrawals + y.shortfall, y.tax + y.spending + y.contributions + y.unallocated, 2, 'age ' + y.age);
  });
});
test('v1 plan files migrate to explicit contribution modes', function () {
  var old = { app: 'canadian-retirement-planner', schemaVersion: 1, base: { accounts: [
    { id: 'a', type: 'tfsa', contributionCap: 7000 }, { id: 'b', type: 'nonreg', contributionCap: null }, { id: 'c', type: 'cash', contributionCap: 0 }] } };
  var n = RP.schema.normalize(old);
  ok(n.schemaVersion === 2);
  ok(n.base.accounts.map(function (a) { return a.contribLimit; }).join() === 'custom,unlimited,none');
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

console.log('Savings growth');
test('fixed savings grow by the annual increase (or inflation when blank)', function () {
  var p2 = RP.util.clone(plan); p2.savings.mode = 'fixed'; p2.savings.amount = 10000; p2.savings.amountGrowth = 0.05;
  p2.accounts.forEach(function (a) { a.contribLimit = 'unlimited'; }); p2.savings.enforceRoom = false;
  var r = RP.engine.project(p2);
  near(rowAt(r, 35).contributions, 10000, 1);
  near(rowAt(r, 36).contributions, 10500, 1);
  near(rowAt(r, 45).contributions, 10000 * Math.pow(1.05, 10), 1);
  p2.savings.amountGrowth = null;
  near(rowAt(RP.engine.project(p2), 45).contributions, 10000 * rowAt(r, 45).cpi, 1);
});
test('savings rate steps up each year and stops at the maximum', function () {
  var s = { rate: 0.10, rateStep: 0.005, rateMax: 0.15 };
  near(RP.savingsModes.rateFor(s, 0), 0.10, 1e-9);
  near(RP.savingsModes.rateFor(s, 4), 0.12, 1e-9);
  near(RP.savingsModes.rateFor(s, 30), 0.15, 1e-9);
  near(RP.savingsModes.rateFor({ rate: 0.2, rateStep: 0.01, rateMax: 0.15 }, 5), 0.2, 1e-9, 'start above max stays put');
  near(RP.savingsModes.rateFor({ rate: 0.1, rateStep: -0.01 }, 20), 0, 1e-9, 'never negative');
  var p2 = RP.util.clone(plan); p2.savings = Object.assign(p2.savings, { mode: 'percentGross', rate: 0.1, rateStep: 0.01, rateMax: 0.2, enforceRoom: false });
  p2.accounts.forEach(function (a) { a.contribLimit = 'unlimited'; });
  var r = RP.engine.project(p2), y = rowAt(r, 40);
  near(y.contributions, 0.15 * y.employment, 1);
});
test('validator catches a savings increase written as a percentage', function () {
  var n = RP.schema.normalize({ base: { savings: { amountGrowth: 5, rateStep: 0.5 } } });
  var msgs = RP.schema.validate(n).map(function (x) { return x.path; }).join(' ');
  ok(/savings\.amountGrowth/.test(msgs) && /savings\.rateStep/.test(msgs), msgs);
});

console.log('Spending growth');
test('blank spending growth = inflation (unchanged behaviour)', function () {
  var r = RP.engine.project(plan);
  near(rowAt(r, 50).spending, 55000 * rowAt(r, 50).cpi, 1);
});
test('spending grows at the working rate, then the retirement rate', function () {
  var p2 = RP.util.clone(plan); p2.spending.growthWorking = 0.04; p2.spending.growthRetired = 0.01;
  var r = RP.engine.project(p2);
  near(rowAt(r, 59).spending, 55000 * Math.pow(1.04, 24), 1);
  near(rowAt(r, 70).spending, 55000 * Math.pow(1.04, 24) * Math.pow(1.01, 11), 1);
});
test('spending growth applies to indexed items only; retirement change still applies', function () {
  var p2 = RP.util.clone(plan); p2.spending.mode = 'itemized'; p2.spending.growthWorking = 0.03; p2.spending.retirementChange = -0.1;
  p2.spending.items = [{ id: 'a', name: 'Indexed', amount: 10000, phase: 'all', indexed: true }, { id: 'b', name: 'Fixed', amount: 5000, phase: 'all', indexed: false }];
  var r = RP.engine.project(p2), inf = p2.assumptions.inflation;
  near(rowAt(r, 45).spending, 10000 * Math.pow(1.03, 10) + 5000, 1);
  near(rowAt(r, 61).spending, (10000 * Math.pow(1.03, 24) * Math.pow(1 + inf, 2) + 5000) * 0.9, 1);
});
test('validator catches spending growth written as a percentage', function () {
  var n = RP.schema.normalize({ base: { spending: { growthRetired: -1 } } });
  ok(RP.schema.validate(n).some(function (x) { return /growthRetired/.test(x.path); }), 'should flag -1 (−100%/yr)');
  var n2 = RP.schema.normalize({ base: { spending: { growthWorking: 3 } } });
  ok(RP.schema.validate(n2).some(function (x) { return /growthWorking.*percentage/.test(x.path + x.message); }));
});

console.log('Dollar adjustments');
function adj(p, patch) { var e = RP.events.create('adjustment', patch.startAge, p); return Object.assign(e, patch); }
test('permanent $ raise (doctor finishing residency) jumps and then grows with raises', function () {
  var p2 = RP.util.clone(plan); p2.profile.currentAge = 30; p2.income.salary = 75000; p2.income.growth = 0.03;
  p2.events = [adj(p2, { target: 'income', kind: 'growth', unit: 'dollars', amount: 250000, indexed: false, startAge: 33, endAge: 33 })];
  var r = RP.engine.project(p2);
  near(rowAt(r, 32).employment, 75000 * Math.pow(1.03, 2), 1);
  near(rowAt(r, 33).employment, 75000 * Math.pow(1.03, 3) + 250000, 1);
  near(rowAt(r, 40).employment, 75000 * Math.pow(1.03, 10) + 250000 * Math.pow(1.03, 7), 1);
  near(rowAt(r, 60).employment, 0, 0.01, 'still stops at retirement');
});
test('$ raise each year of a range accumulates', function () {
  var p2 = RP.util.clone(plan); p2.income.growth = 0;
  p2.events = [adj(p2, { target: 'income', kind: 'growth', unit: 'dollars', amount: 10000, indexed: false, startAge: 40, endAge: 42 })];
  var r = RP.engine.project(p2);
  near(rowAt(r, 42).employment - rowAt(r, 39).employment, 30000, 1);
  near(rowAt(r, 50).employment - rowAt(r, 39).employment, 30000, 1);
});
test('temporary $ spending cut applies only during the range (today\'s dollars)', function () {
  var p2 = RP.util.clone(plan), base = RP.engine.project(p2);
  p2.events = [adj(p2, { target: 'spending', kind: 'step', unit: 'dollars', amount: -24000, startAge: 56, endAge: 70 })];
  var r = RP.engine.project(p2);
  near(rowAt(base, 60).spending - rowAt(r, 60).spending, 24000 * rowAt(r, 60).cpi, 1);
  near(rowAt(base, 71).spending - rowAt(r, 71).spending, 0, 0.01);
});
test('a percentage sabbatical also removes a dollar raise that year', function () {
  var p2 = RP.util.clone(plan);
  p2.events = [adj(p2, { target: 'income', kind: 'growth', unit: 'dollars', amount: 100000, startAge: 40, endAge: 40 }),
               adj(p2, { target: 'income', kind: 'step', unit: 'percent', pct: -1, startAge: 45, endAge: 45 })];
  var r = RP.engine.project(p2);
  near(rowAt(r, 45).employment, 0, 0.01);
  ok(rowAt(r, 46).employment > 200000);
});
test('dollar adjustments: required fields, summary and backwards compatibility', function () {
  var n = RP.schema.normalize({ base: { events: [{ id: 'old', type: 'adjustment', target: 'spending', kind: 'step', pct: -0.1, startAge: 40, endAge: 50 },
    { id: 'd', type: 'adjustment', target: 'income', kind: 'growth', unit: 'dollars', startAge: 40 }] } });
  ok(n.base.events[0].unit === 'percent', 'old events default to percent');
  var issues = RP.schema.validate(n).map(function (x) { return x.path; }).join(' ');
  ok(/events\.1\.amount/.test(issues) && !/events\.1\.pct/.test(issues), issues);
  ok(/permanent/.test(RP.events.describe({ type: 'adjustment', target: 'income', kind: 'growth', unit: 'dollars', amount: 150000, startAge: 33, endAge: 33 })));
});

console.log('Inflation');
function neutralPlan(inf, extra) {
  var p = RP.scenarios.effective(RP.schema.newDocument(), 'base');
  function nom(r) { return (1 + r) * (1 + inf) - 1; }
  p.assumptions.inflation = inf; p.assumptions.returnPre = nom(0.035); p.assumptions.returnPost = nom(0.025);
  p.income.growth = nom(0.01);
  p.tax.mode = 'custom'; p.tax.includePayroll = false; p.savings.enforceRoom = false;   // only fully-indexed rules
  p.accounts = p.accounts.filter(function (a) { return a.type === 'rrsp' || a.type === 'tfsa'; });
  p.accounts.forEach(function (a) { a.contribLimit = 'unlimited'; });
  if (extra) extra(p, nom);
  return p;
}
test('inflation-neutral: with fully indexed rules, real results are identical at 0% and 3% inflation', function () {
  [null,
   function (p, nom) { p.spending.growthWorking = nom(0.01); p.spending.growthRetired = nom(-0.01); },
   function (p) { p.events = [Object.assign(RP.events.create('expense', 50, p), { amount: 40000, everyYears: 5, endAge: 80 }),
     Object.assign(RP.events.create('adjustment', 40, p), { target: 'income', kind: 'growth', unit: 'dollars', amount: 30000, endAge: 40 }),
     Object.assign(RP.events.create('adjustment', 56, p), { target: 'spending', kind: 'growth', unit: 'dollars', amount: -10000, endAge: 56 })]; },
   function (p) { p.savings.mode = 'fixed'; p.retirement.strategy = 'fixedReal'; }
  ].forEach(function (extra, k) {
    var a = RP.engine.project(neutralPlan(0, extra)), b = RP.engine.project(neutralPlan(0.03, extra));
    a.years.forEach(function (ya, i) {
      var yb = b.years[i];
      near(yb.total / yb.cpiEnd, ya.total, Math.max(5, ya.total * 1e-4), 'case ' + k + ' balance age ' + ya.age);
      ['spending', 'tax', 'contributions', 'withdrawals', 'employment', 'cpp', 'oas'].forEach(function (f) {
        near(yb[f] / yb.cpi, ya[f], Math.max(1, Math.abs(ya[f]) * 1e-4), 'case ' + k + ' ' + f + ' age ' + ya.age);
      });
    });
  });
});
test('mid-year contributions keep their real value (no half-year inflation leak)', function () {
  var p = neutralPlan(0.05); p.assumptions.returnPre = 0.05;   // zero real return
  p.accounts.forEach(function (a) { a.balance = 0; });
  var y = RP.engine.project(p).years[0];
  near(y.total / y.cpiEnd, y.contributions / y.cpi, 0.5);
});
test('permanent $ spending change follows the spending growth rate', function () {
  var p = RP.util.clone(plan); p.spending.growthRetired = 0.0;   // flat nominal spending in retirement
  p.events = [Object.assign(RP.events.create('adjustment', 60, p), { target: 'spending', kind: 'growth', unit: 'dollars', amount: -10000, indexed: false, endAge: 60 })];
  var r = RP.engine.project(p);
  near(rowAt(r, 70).spendingBase - rowAt(r, 60).spendingBase, 0, 0.5, 'both base and the cut stay flat');
});
test('fixed-in-law credits are not indexed (federal and most provincial pension amounts)', function () {
  var inc = { pension: 3000 }, c1 = ctx('BC', 70), c2 = ctx('BC', 70); c2.index = 1.5;
  var t1 = RP.tax.compute(inc, c1), t2 = RP.tax.compute(inc, c2);
  ok(t1.federalCredits > 0);
  // Pension amounts must not scale with the index (BPA/age amounts do).
  near(t2.federalCredits - t1.federalCredits, (d.federal.bpa.max + RP.tax.ageAmount(70, d.federal.age, 3000, 1, 70)) * 0.5, 1);
  near(t2.provincialCredits - t1.provincialCredits, (d.provinces.BC.bpa.max + RP.tax.ageAmount(70, d.provinces.BC.age, 3000, 1, 70)) * 0.5, 1);
});

console.log('Non-registered distributions');
test('eligible dividends: gross-up and dividend tax credits ($50k in Ontario ≈ no federal tax)', function () {
  var r = RP.tax.compute({ dividends: 50000 }, ctx('ON', 40, { includePayroll: false }));
  near(r.taxableIncome, 69000, 0.5, 'grossed up 38%');
  near(r.federal, 0, 0.5);
  ok(r.provincial < 1500, 'ON tax ' + r.provincial);
  var interest = RP.tax.compute({ other: 50000 }, ctx('ON', 40, { includePayroll: false }));
  ok(interest.total > r.total + 5000, 'interest is taxed far more than dividends');
});
test('distributions are taxed yearly, reinvested, and raise the cost base', function () {
  function only(yieldPct, type) {
    var p = RP.util.clone(plan);
    Object.assign(p.profile, { currentAge: 65, retirementAge: 65 });
    p.income.salary = 0; p.benefits.cppEnabled = false; p.benefits.oasEnabled = false; p.spending.total = 60000;
    p.accounts = [{ id: 'nr', name: 'NR', type: 'nonreg', balance: 2000000, costBase: 500000, distYield: yieldPct, distType: type, contribLimit: 'unlimited' }];
    p.savings.order = ['nr']; p.retirement.withdrawalOrder = ['nr'];
    return RP.engine.project(p);
  }
  var none = only(0, 'mix'), inter = only(0.03, 'interest'), div = only(0.03, 'dividends');
  near(inter.years[0].distributions, 60000, 0.5);
  ok(inter.years[0].tax > none.years[0].tax + 10000, 'interest distributions add tax: ' + inter.years[0].tax + ' vs ' + none.years[0].tax);
  ok(div.years[0].tax < inter.years[0].tax, 'dividends taxed less than interest');
  // Cost base rises by reinvested distributions, so later withdrawals realize a smaller share of gain.
  ok(inter.years[10].realizedGains / inter.years[10].withdrawByAccount.nr < none.years[10].realizedGains / none.years[10].withdrawByAccount.nr);
  near(inter.years[0].total, none.years[0].total - (inter.years[0].withdrawals - none.years[0].withdrawals) * (1 + 0.05), 1, 'distributions are part of the return, not extra');
});
test('validator flags a distribution yield written as a percentage', function () {
  var n = RP.schema.normalize({ base: { accounts: [{ id: 'n', type: 'nonreg', balance: 1, distYield: 2, distType: 'weird' }] } });
  var paths = RP.schema.validate(n).map(function (x) { return x.path; }).join(' ');
  ok(/distYield/.test(paths) && /distType/.test(paths), paths);
});

console.log('Couples');
function couplePlan(spouse) {
  var p = RP.util.clone(plan);
  p.spouse = Object.assign(RP.util.clone(p.spouse), { enabled: true, salary: 0, cppEnabled: false, oasEnabled: false }, spouse || {});
  return p;
}
function retiredRrifPlan(youAge, spAge, split) {
  var p = couplePlan({ currentAge: spAge, retirementAge: spAge });
  Object.assign(p.profile, { currentAge: youAge, retirementAge: youAge, endAge: youAge + 10 });
  p.income.salary = 0; p.benefits.cppEnabled = false; p.benefits.oasEnabled = false;
  p.spending.total = 50000; p.tax.pensionSplitting = split;
  p.accounts = [{ id: 'r', name: 'RRSP', type: 'rrsp', balance: 1000000, contribLimit: 'legal' }];
  p.savings.order = ['r']; p.retirement.withdrawalOrder = ['r'];
  return p;
}
test('a spouse with no income or accounts changes nothing (splitting off)', function () {
  var p = couplePlan(); p.tax.pensionSplitting = false;
  var r = RP.engine.project(p);
  r.years.forEach(function (y, i) {
    near(y.tax, res.years[i].tax, 0.01, 'tax at ' + y.age);
    near(y.total, res.years[i].total, 0.01, 'balance at ' + y.age);
  });
  ok(r.years[0].spouseAge === p.spouse.currentAge && r.years[5].spouseAge === p.spouse.currentAge + 5);
});
test('each spouse is taxed on their own salary (two returns, two sets of brackets)', function () {
  var p = couplePlan({ salary: 60000, growth: plan.income.growth }); p.income.salary = 60000;
  p.accounts = []; p.savings.order = []; p.retirement.withdrawalOrder = [];
  var y = RP.engine.project(p).years[0];
  near(y.employment, 120000, 0.01);
  var one = RP.tax.compute({ employment: 60000 }, y.taxCtx).totalWithPayroll;
  near(y.tax, 2 * one, 1, 'two equal returns');
  ok(y.tax < RP.tax.compute({ employment: 120000 }, y.taxCtx).totalWithPayroll, 'less than one person earning it all');
  near(y.taxPeople[0].detail.totalWithPayroll + y.taxPeople[1].detail.totalWithPayroll, y.tax, 0.01);
});
test('spouse salary stops at the spouse’s retirement age; CPP/OAS start at the spouse’s ages', function () {
  var p = couplePlan({ currentAge: 30, retirementAge: 55, salary: 50000, cppEnabled: true, cppAt65: 10000, cppStartAge: 65, oasEnabled: true, oasStartAge: 65 });
  p.profile.currentAge = 35; p.profile.retirementAge = 70; p.income.salary = 0;
  p.benefits.cppEnabled = false; p.benefits.oasEnabled = false;
  var r = RP.engine.project(p);
  ok(rowAt(r, 59).employment > 0 && rowAt(r, 60).employment === 0, 'spouse retires at their 55 = your 60');
  ok(rowAt(r, 69).cpp === 0 && rowAt(r, 70).cpp > 0, 'spouse CPP from their 65 = your 70');
});
test('spouse-owned RRSP: room from the spouse’s income, RRIF minimum at the spouse’s 72', function () {
  var p = couplePlan({ currentAge: 69, retirementAge: 60 });
  Object.assign(p.profile, { currentAge: 70, retirementAge: 70, endAge: 80 });
  p.income.salary = 0; p.spending.total = 30000; p.tax.pensionSplitting = false;
  p.accounts = [{ id: 'mine', name: 'Mine', type: 'rrsp', balance: 2000000, contribLimit: 'legal' },
    { id: 'sp', name: 'Spouse', type: 'rrsp', owner: 'spouse', balance: 100000, contribLimit: 'legal' }];
  p.savings.order = ['mine', 'sp']; p.retirement.withdrawalOrder = ['mine', 'sp'];
  var r = RP.engine.project(p);
  ok(rowAt(r, 72).withdrawByAccount.mine > 0, 'your RRIF minimum at 72');
  ok(!rowAt(r, 72).withdrawByAccount.sp, 'spouse is 71: no minimum yet');
  ok(rowAt(r, 73).withdrawByAccount.sp > 0 && rowAt(r, 73).taxPeople[1].inputs.rrif > 0, 'spouse RRIF minimum at their 72, on their return');
  var p2 = couplePlan({ currentAge: 40, retirementAge: 65, salary: 80000 });
  p2.income.salary = 0; p2.profile.retirementAge = 80;
  p2.accounts = [{ id: 'sp', name: 'Spouse RRSP', type: 'rrsp', owner: 'spouse', balance: 0, contribLimit: 'legal', startingRoom: 0 }];
  p2.savings.order = ['sp'];
  var y1 = RP.engine.project(p2).years[1];
  near(y1.roomByAccount.sp + y1.contribByAccount.sp, 0.18 * 80000, 1, 'room = 18% of the spouse’s prior-year salary');
  ok(y1.taxPeople[1].inputs.rrspDeduction > 0 && !y1.taxPeople[0].inputs.rrspDeduction, 'deduction on the spouse’s return');
});
test('pension splitting moves RRIF income to the lower-income spouse and lowers tax', function () {
  var on = RP.engine.project(retiredRrifPlan(72, 70, true)), off = RP.engine.project(retiredRrifPlan(72, 70, false));
  var y = on.years[0], z = off.years[0];
  ok(y.pensionSplit > 0, 'you → spouse: ' + y.pensionSplit);
  ok(y.pensionSplit <= 0.5 * z.taxInputs.rrif + 0.01, 'at most half');
  ok(y.tax < z.tax - 3000, 'tax ' + y.tax + ' vs ' + z.tax);
  near(y.taxPeople[0].inputs.rrif + y.taxPeople[1].inputs.rrif, y.withdrawals, 1, 'income is moved, not created');
  ok(on.summary.endingReal > off.summary.endingReal);
});
test('RRIF income cannot be split before the owner is 65', function () {
  var y = RP.engine.project(retiredRrifPlan(60, 60, true)).years[0];
  ok(y.taxInputs.rrif > 0 && y.pensionSplit === 0);
});
test('defined-benefit pension can be split at any age; split RRIF income only earns a 65+ spouse the pension credit', function () {
  var c = function (age) { return { age: age, province: 'ON', data: d, index: 1, settings: { mode: 'calculated', includePayroll: true, oasClawback: true } }; };
  var db = RP.engine.householdTax([{ pension: 80000 }, {}], [c(60), c(60)], true);
  ok(db.split > 0, 'DB pension split at 60');
  var rrif = RP.engine.householdTax([{ rrif: 80000 }, {}], [c(70), c(60)], true);
  ok(rrif.split > 0 && rrif.incs[1].rrif > 0 && !rrif.incs[1].pension, 'moved RRIF income stays RRIF income for the spouse');
});
test('income events can belong to the spouse', function () {
  var p = couplePlan();
  p.tax.pensionSplitting = false;
  p.events = [{ id: 'e1', type: 'income', label: 'Spouse pension', amount: 40000, startAge: 35, endAge: 40, taxType: 'pension', owner: 'spouse', indexed: true }];
  var y = RP.engine.project(p).years[0];
  near(y.taxPeople[1].inputs.pension, 40000, 0.01);
  ok(!y.taxPeople[0].inputs.pension);
});
test('validator: owner values and a spouse-owned account without a spouse', function () {
  var n = RP.schema.normalize({ base: { accounts: [{ id: 'a', type: 'tfsa', balance: 1, owner: 'spouse' }, { id: 'b', type: 'tfsa', balance: 1, owner: 'partner' }],
    spouse: { enabled: false } } });
  var v = RP.schema.validate(n);
  ok(v.some(function (x) { return x.level === 'warning' && /accounts\.0\.owner/.test(x.path); }), 'warns');
  ok(v.some(function (x) { return x.level === 'error' && /accounts\.1\.owner/.test(x.path); }), 'errors');
  var n2 = RP.schema.normalize({ base: { spouse: { enabled: true, currentAge: 'forty', salary: -1, growth: 3 } } });
  var paths = RP.schema.validate(n2).map(function (x) { return x.path; }).join(' ');
  ok(/spouse\.currentAge/.test(paths) && /spouse\.salary/.test(paths) && /spouse\.growth/.test(paths), paths);
});
test('fuzz: 120 random couples keep cash balanced, balances ≥ 0, and two returns that add up', function () {
  var rnd = RP.util.rng(7);
  for (var n = 0; n < 120; n++) {
    var p = couplePlan({ currentAge: 25 + Math.floor(rnd() * 40), retirementAge: 55 + Math.floor(rnd() * 12), salary: Math.round(rnd() * 150000),
      cppEnabled: rnd() > 0.2, cppAt65: Math.round(rnd() * 15000), oasEnabled: rnd() > 0.2 });
    p.profile.currentAge = 25 + Math.floor(rnd() * 40); p.profile.retirementAge = Math.max(p.profile.currentAge, 55 + Math.floor(rnd() * 12));
    p.income.salary = Math.round(rnd() * 200000); p.spending.total = 30000 + Math.round(rnd() * 90000);
    p.tax.pensionSplitting = rnd() > 0.3;
    p.accounts.forEach(function (a) { a.owner = rnd() > 0.5 ? 'spouse' : 'self'; a.balance = Math.round(rnd() * 500000); });
    p.retirement.strategy = ['needs', 'needs', 'fixedReal', 'percentBalance'][Math.floor(rnd() * 4)];
    var r = RP.engine.project(p);
    r.years.forEach(function (y) {
      near(y.incomeTotal + y.withdrawals + y.shortfall, y.tax + y.spending + y.contributions + y.unallocated, 2, 'plan ' + n + ' age ' + y.age);
      near(y.taxPeople[0].detail.totalWithPayroll + y.taxPeople[1].detail.totalWithPayroll, y.tax, 0.01);
      Object.keys(y.balances).forEach(function (k) { ok(y.balances[k] >= 0); });
      ok(y.taxPeople[0].inputs.rrif >= -0.01 && y.taxPeople[1].inputs.rrif >= -0.01, 'no negative RRIF income after a split');
    });
  }
});

console.log('Review fixes (regressions)');
test('OAS stays inflation-indexed when tax brackets are not', function () {
  var p2 = RP.util.clone(plan); p2.tax.indexBrackets = false; p2.profile.currentAge = 64; p2.profile.retirementAge = 64;
  var r = RP.engine.project(p2);
  var a = rowAt(r, 65), b = rowAt(r, 74);
  near(b.oas / a.oas, Math.pow(1 + p2.assumptions.inflation, 9), 0.001);
});
test('CPP/OAS start ages are clamped to their legal ranges', function () {
  var p2 = RP.util.clone(plan); p2.benefits.cppStartAge = 55; p2.benefits.oasStartAge = 75;
  var r = RP.engine.project(p2);
  near(rowAt(r, 59).cpp, 0, 0.01);
  near(rowAt(r, 60).cpp / rowAt(r, 60).cpi, p2.benefits.cppAt65 * (1 - 60 * 0.006), 1);
  ok(rowAt(r, 70).oas > 0 && rowAt(r, 69).oas === 0);
});
test('EI premiums continue after 70; CPP contributions stop', function () {
  var p70 = RP.tax.payroll(60000, ctx('ON', 71));
  near(p70.cpp + p70.cpp2, 0, 0.01);
  near(p70.ei, 60000 * 0.0163, 0.5);
});
test('files without accounts/items do not inherit sample balances', function () {
  var n = RP.schema.normalize({ app: 'canadian-retirement-planner', schemaVersion: 2, base: { profile: { currentAge: 40 }, spending: { mode: 'itemized' } } });
  ok(n.base.accounts.length === 0, 'accounts ' + n.base.accounts.length);
  ok(n.base.spending.items.length === 0, 'items ' + n.base.spending.items.length);
  ok(RP.schema.validate(n).some(function (x) { return x.path === 'base.accounts'; }));
});
test('events from files get the same optional defaults as events made in the app', function () {
  var n = RP.schema.normalize({ base: { events: [{ id: 'e1', type: 'lumpSum', amount: 50000, startAge: 50 },
    { id: 'e2', type: 'contribution', accountId: 'tfsa', mode: 'none', startAge: 40, endAge: 45 }] } });
  ok(n.base.events[0].taxType === 'nontaxable' && n.base.events[0].indexed === true);
  ok(!RP.schema.validate(n).some(function (x) { return /events\.1\.amount/.test(x.path); }), 'contribution "none" should not need an amount');
});

test('fuzz: 150 random plans keep cash balanced, balances ≥ 0 and room rules', function () {
  var rand = RP.util.rng(2026), pick = function (a) { return a[Math.floor(rand() * a.length)]; };
  function between(a, b) { return a + rand() * (b - a); }
  var provs = Object.keys(d.provinces);
  for (var n = 0; n < 150; n++) {
    var p = RP.scenarios.effective(RP.schema.newDocument(), 'base');
    var a0 = Math.round(between(25, 75));
    Object.assign(p.profile, { currentAge: a0, retirementAge: Math.round(between(a0 - 5, 72)), endAge: Math.round(between(Math.max(a0 + 5, 85), 100)), province: pick(provs) });
    p.income.salary = between(0, 350000); p.spending.total = between(20000, 180000); p.spending.retirementChange = between(-0.3, 0.2);
    p.accounts.forEach(function (a) { a.balance = between(0, 800000); a.contribLimit = pick(['legal', 'custom', 'unlimited', 'none']); a.contributionCap = between(0, 30000); a.startingRoom = rand() < 0.5 ? null : between(0, 100000);
      if (a.type === 'nonreg') { a.distYield = rand() < 0.3 ? 0 : between(0, 0.05); a.distType = pick(['mix', 'dividends', 'interest', 'gains']); a.costBase = a.balance * between(0.2, 1.2); } });
    p.savings.mode = pick(['surplus', 'percentGross', 'fixed']);
    p.retirement.strategy = pick(['needs', 'fixedReal', 'percentBalance']);
    p.tax.mode = pick(['calculated', 'calculated', 'flat', 'custom']); p.tax.selfEmployed = rand() < 0.2;
    for (var k = 0; k < 3; k++) {
      var t = pick(RP.eventTypes.ids()), e = RP.events.create(t, Math.round(between(a0, p.profile.endAge)), p);
      if (e.amount != null) e.amount = between(1000, 300000);
      if (t === 'contribution') e.accountId = pick(p.accounts).id;
      if (t === 'adjustment') { e.target = pick(['income', 'spending', 'savings']); e.kind = pick(['step', 'growth']); e.unit = pick(['percent', 'dollars']); e.amount = between(-150000, 300000); e.pct = between(-1, 0.3); }
      p.events.push(e);
    }
    RP.engine.project(p).years.forEach(function (y) {
      near(y.incomeTotal + y.withdrawals + y.shortfall, y.tax + y.spending + y.contributions + y.unallocated, 2, 'plan ' + n + ' age ' + y.age);
      Object.keys(y.balances).forEach(function (id) { ok(y.balances[id] >= 0, 'negative balance'); });
      p.accounts.forEach(function (a) {
        if (a.type === 'rrsp' && y.age > 71) ok(!(y.contribByAccount[a.id] > 0.01), 'RRSP contribution after 71');
        if (a.type === 'rrsp' || a.type === 'tfsa') ok(!(y.roomByAccount[a.id] < -0.01), 'negative room');
      });
    });
  }
});

console.log('Example plans');
test('every example plan loads and projects', function () {
  ok(RP.examples.length >= 6);
  RP.examples.forEach(function (ex) {
    var doc = RP.schema.normalize(JSON.parse(JSON.stringify(ex.doc)));
    var file = JSON.parse(fs.readFileSync(path.join(root, 'examples', ex.file), 'utf8'));
    ok(JSON.stringify(file) === JSON.stringify(ex.doc), ex.file + ' is out of sync with js/data/examples.js (run node tools/build-examples.js)');
    RP.scenarios.runAll(doc).forEach(function (r) { ok(r.result.years.length > 0, ex.slug + ' / ' + r.name); });
    ok(RP.scenarios.runAll(doc)[0].result.summary.success || ex.slug === 'late-starter-winnipeg', ex.slug + ' base plan should be funded');
  });
});

console.log('Plan file specification');
test('examples in docs/PLAN-FILE-SPEC.md import with no errors or warnings', function () {
  var md = fs.readFileSync(path.join(root, 'docs', 'PLAN-FILE-SPEC.md'), 'utf8');
  var blocks = [], re = /```json\n([\s\S]*?)```/g, m;
  while ((m = re.exec(md))) if (m[1].indexOf('"schemaVersion"') >= 0) blocks.push(m[1]);
  ok(blocks.length >= 2, 'expected the minimal and complete examples, found ' + blocks.length);
  blocks.forEach(function (b, i) {
    var raw = JSON.parse(b);
    ok(raw.schemaVersion === RP.schema.SCHEMA_VERSION, 'spec example ' + i + ' must use the current schema version');
    var doc = RP.schema.normalize(raw);
    var issues = RP.schema.validate(doc);
    ok(!issues.length, 'spec example ' + i + ': ' + issues.map(function (x) { return x.path + ' ' + x.message; }).join('; '));
    RP.scenarios.runAll(doc).forEach(function (r) { ok(r.result.years.length > 0); });
  });
});
test('validator flags common AI mistakes', function () {
  var doc = RP.schema.normalize({ base: { profile: { currentAge: 40, endAge: 95, retirementAge: 60, province: 'ON', startYear: 2026 },
    assumptions: { inflation: 2 }, accounts: [{ id: 'a', type: 'rrsp', balance: 1 }],
    events: [{ type: 'adjustment', target: 'spending', kind: 'step', pct: -20, startAge: 60, endAge: 70 }, { type: 'contribution', accountId: 'zzz', mode: 'none', startAge: 50, endAge: 55 }] },
    scenarios: [{ name: 'x', overrides: { 'accounts.0.balance': 5, 'profile.retireAge': 1 } }] });
  var msgs = RP.schema.validate(doc).map(function (x) { return x.path + ' ' + x.message; }).join('\n');
  ['assumptions.inflation looks like a percentage', 'pct looks like a percentage', 'unknown account id "zzz"', 'points inside an array', 'unknown path "profile.retireAge"']
    .forEach(function (frag) { ok(msgs.indexOf(frag) >= 0, 'missing: ' + frag + '\n' + msgs); });
});
test('parsePlan accepts JSON wrapped in an AI reply', function () {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'js/state/store.js'), 'utf8'));
  var reply = 'Here is your plan:\n```json\n' + JSON.stringify(RP.schema.newDocument('From AI')) + '\n```\nLet me know!';
  var r = RP.store.parsePlan(reply);
  ok(r.doc.meta.name === 'From AI' && r.issues.length === 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
