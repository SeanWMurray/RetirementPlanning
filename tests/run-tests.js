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
    p.accounts.forEach(function (a) { a.balance = between(0, 800000); a.contribLimit = pick(['legal', 'custom', 'unlimited', 'none']); a.contributionCap = between(0, 30000); a.startingRoom = rand() < 0.5 ? null : between(0, 100000); });
    p.savings.mode = pick(['surplus', 'percentGross', 'fixed']);
    p.retirement.strategy = pick(['needs', 'fixedReal', 'percentBalance']);
    p.tax.mode = pick(['calculated', 'calculated', 'flat', 'custom']); p.tax.selfEmployed = rand() < 0.2;
    for (var k = 0; k < 3; k++) {
      var t = pick(RP.eventTypes.ids()), e = RP.events.create(t, Math.round(between(a0, p.profile.endAge)), p);
      if (e.amount != null) e.amount = between(1000, 300000);
      if (t === 'contribution') e.accountId = pick(p.accounts).id;
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
