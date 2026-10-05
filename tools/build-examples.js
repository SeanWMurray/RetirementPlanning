/*
 * Builds the example plans in examples/*.retirement-plan.json and the bundle
 * js/data/examples.js (so File › Open Example works from file:// without fetch).
 *
 *   node tools/build-examples.js
 *
 * Plans are built with the real engine/schema code, then each base plan and
 * scenario is projected and summarised as a sanity check. IDs are deterministic
 * so regenerating gives clean diffs. To add an example, add an entry to EXAMPLES.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
[
  'js/core.js', 'js/data/tax-2026.js', 'js/engine/tax.js', 'js/engine/events.js',
  'js/engine/strategies.js', 'js/engine/projection.js', 'js/engine/scenarios.js', 'js/state/schema.js'
].forEach(function (f) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); });
var RP = globalThis.RP;

// Deterministic ids
var counter = 0;
var currentSlug = 'x';
RP.util.uid = function (prefix) { counter++; return (prefix || 'id') + '_' + currentSlug + '_' + counter; };

var STAMP = '2026-01-01T00:00:00.000Z';

function ev(base, type, age, patch) {
  return Object.assign(RP.events.create(type, age, base), patch);
}
function account(id, name, type, balance, extra) {
  return Object.assign({ id: id, name: name, type: type, balance: balance, contribLimit: 'unlimited', contributionCap: null, startingRoom: null, returnRate: null }, extra || {});
}

// ---------------------------------------------------------------------------
var EXAMPLES = [
  {
    slug: 'early-career-toronto',
    name: 'Early career renter — Toronto',
    summary: '28, Ontario, $72k salary, renting. TFSA-first saving; what buying a condo or retiring early would cost.',
    notes: 'A 28-year-old renting in Toronto, saving whatever is left after spending. Lower income, so the TFSA is filled before the RRSP. ' +
      'Scenarios compare buying a condo at 35 (down payment plus higher housing costs until the mortgage is paid), an aggressive savings plan to retire at 50, and a faster promotion track.',
    build: function (b) {
      Object.assign(b.profile, { currentAge: 28, retirementAge: 60, endAge: 95, province: 'ON' });
      Object.assign(b.income, { salary: 72000, growth: 0.035 });
      Object.assign(b.spending, { mode: 'total', total: 42000, retirementChange: 0 });
      b.accounts = [
        account('tfsa', 'TFSA', 'tfsa', 21000, { contribLimit: 'legal', startingRoom: 45000 }),
        account('rrsp', 'RRSP', 'rrsp', 8000, { contribLimit: 'legal', startingRoom: 22000 }),
        account('cash', 'Emergency fund (HISA)', 'cash', 6000, { contribLimit: 'none', contributionCap: 0 }),
        account('nonreg', 'Non-registered', 'nonreg', 0, { costBase: 0 })
      ];
      b.savings.order = ['tfsa', 'rrsp', 'cash', 'nonreg'];
      b.retirement.withdrawalOrder = ['cash', 'nonreg', 'rrsp', 'tfsa'];
      Object.assign(b.benefits, { cppAt65: 10500, cppStartAge: 65, oasStartAge: 65 });
      b.events = [
        ev(b, 'expense', 31, { label: 'Wedding', amount: 30000, endAge: 31 }),
        ev(b, 'expense', 30, { label: 'Car every 10 years', amount: 30000, endAge: 80, everyYears: 10 })
      ];
    },
    scenarios: [
      { name: 'Buy a condo at 35', notes: '$70k down payment, ownership costs ~15% above renting until the mortgage is paid at 60, downsize at 80.',
        build: function (s, b) {
          s.events.push(
            ev(b, 'expense', 35, { label: 'Condo down payment + closing', amount: 70000, endAge: 35 }),
            ev(b, 'adjustment', 35, { label: 'Mortgage + condo fees vs rent', target: 'spending', kind: 'step', pct: 0.15, endAge: 59 }),
            ev(b, 'lumpSum', 80, { label: 'Sell condo (net)', amount: 300000, taxType: 'nontaxable' }));
        } },
      { name: 'Aggressive saver — retire at 50', notes: 'Spend $36k instead of $42k and retire at 50.',
        build: function (s) { s.overrides['profile.retirementAge'] = 50; s.overrides['spending.total'] = 36000; } },
      { name: 'Promotion track', notes: 'An extra 2%/yr of raises from 30 to 40.',
        build: function (s, b) { s.events.push(ev(b, 'adjustment', 30, { label: 'Promotion track', target: 'income', kind: 'growth', pct: 0.02, endAge: 40 })); } }
    ]
  },

  {
    slug: 'mid-career-calgary',
    name: 'Mid-career engineer — Calgary',
    summary: '42, Alberta, $145k salary, RRSP-heavy. Retiring at 55, a crash at retirement, deferring CPP/OAS, the 4% rule.',
    notes: 'A 42-year-old engineer in Alberta with sizeable RRSP savings, two kids heading to university, and plans to travel early in retirement. ' +
      'Scenarios test retiring at 55 (with and without a market crash right at retirement), deferring CPP and OAS to 70, and switching to the 4% rule.',
    build: function (b) {
      Object.assign(b.profile, { currentAge: 42, retirementAge: 60, endAge: 95, province: 'AB' });
      Object.assign(b.income, { salary: 145000, growth: 0.025 });
      Object.assign(b.spending, { mode: 'total', total: 70000, retirementChange: -0.05 });
      b.accounts = [
        account('rrsp', 'RRSP', 'rrsp', 310000, { contribLimit: 'legal', startingRoom: 15000 }),
        account('tfsa', 'TFSA', 'tfsa', 95000, { contribLimit: 'legal', startingRoom: 20000 }),
        account('cash', 'Cash', 'cash', 25000, { contribLimit: 'none', contributionCap: 0 }),
        account('nonreg', 'Non-registered', 'nonreg', 60000, { costBase: 45000 })
      ];
      b.savings.order = ['rrsp', 'tfsa', 'cash', 'nonreg'];
      Object.assign(b.benefits, { cppAt65: 16000, cppStartAge: 65, oasStartAge: 65 });
      b.events = [
        ev(b, 'expense', 50, { label: "Kids' university", amount: 25000, endAge: 57 }),
        ev(b, 'expense', 45, { label: 'Vehicle every 8 years', amount: 45000, endAge: 85, everyYears: 8 }),
        ev(b, 'expense', 60, { label: 'Travel', amount: 15000, endAge: 70 })
      ];
    },
    scenarios: [
      { name: 'Retire at 55', build: function (s) { s.overrides['profile.retirementAge'] = 55; } },
      { name: 'Retire at 55 + crash', notes: '−30% the year of retirement, then −5%.',
        build: function (s, b) {
          s.overrides['profile.retirementAge'] = 55;
          s.events.push(ev(b, 'returnOverride', 55, { label: 'Crash at retirement', mode: 'set', rate: -0.30, endAge: 55 }),
            ev(b, 'returnOverride', 56, { label: 'Weak recovery', mode: 'set', rate: -0.05, endAge: 56 }));
        } },
      { name: 'Defer CPP & OAS to 70', build: function (s) { s.overrides['benefits.cppStartAge'] = 70; s.overrides['benefits.oasStartAge'] = 70; } },
      { name: '4% rule drawdown', notes: 'Under the 4% rule spending is not guaranteed: a shortfall here means the fixed withdrawal did not cover planned spending that year, even though money remains.', build: function (s) { s.overrides['retirement.strategy'] = 'fixedReal'; s.overrides['retirement.withdrawalRate'] = 0.04; } }
    ]
  },

  {
    slug: 'teacher-db-pension-halifax',
    name: 'Teacher with a DB pension — Halifax',
    summary: '50, Nova Scotia, $98k salary, defined-benefit pension at 58. Retiring early with a reduced pension, tutoring, long-term care.',
    notes: 'A 50-year-old teacher with a defined-benefit pension (modelled as pension-income events) and a bridge benefit until 65. ' +
      'Because the pension adjustment uses up most RRSP room, RRSP contributions are set to a fixed $3,000/yr. ' +
      'Scenarios: retire at 55 on a reduced pension, part-time tutoring after retiring, and long-term care costs late in life.',
    build: function (b) {
      Object.assign(b.profile, { currentAge: 50, retirementAge: 58, endAge: 95, province: 'NS' });
      Object.assign(b.income, { salary: 98000, growth: 0.025 });
      Object.assign(b.spending, { mode: 'total', total: 62000, retirementChange: 0 });
      b.accounts = [
        account('rrsp', 'RRSP', 'rrsp', 45000, { contribLimit: 'custom', contributionCap: 3000 }),
        account('tfsa', 'TFSA', 'tfsa', 60000, { contribLimit: 'legal', startingRoom: 35000 }),
        account('cash', 'Cash', 'cash', 15000, { contribLimit: 'none', contributionCap: 0 }),
        account('nonreg', 'Non-registered', 'nonreg', 0, { costBase: 0 })
      ];
      b.savings.order = ['tfsa', 'rrsp', 'cash', 'nonreg'];
      Object.assign(b.benefits, { cppAt65: 12000, cppStartAge: 65, oasStartAge: 65 });
      b.events = [
        ev(b, 'income', 58, { id: 'ev_teacher_db', label: 'Teachers’ pension (DB)', amount: 52000, endAge: 95, taxType: 'pension' }),
        ev(b, 'income', 58, { id: 'ev_teacher_bridge', label: 'Bridge benefit to 65', amount: 9000, endAge: 64, taxType: 'pension' })
      ];
    },
    scenarios: [
      { name: 'Retire at 55 (reduced pension)', notes: 'Pension drops to about $40k with an early-retirement reduction.',
        build: function (s, b) {
          s.overrides['profile.retirementAge'] = 55;
          s.disabledEvents.push('ev_teacher_db', 'ev_teacher_bridge');
          s.events.push(ev(b, 'income', 55, { label: 'Reduced DB pension', amount: 40000, endAge: 95, taxType: 'pension' }),
            ev(b, 'income', 55, { label: 'Bridge benefit to 65', amount: 8000, endAge: 64, taxType: 'pension' }));
        } },
      { name: 'Part-time tutoring', build: function (s, b) { s.events.push(ev(b, 'income', 58, { label: 'Tutoring', amount: 15000, endAge: 65, taxType: 'other' })); } },
      { name: 'Long-term care at 85', build: function (s, b) { s.events.push(ev(b, 'expense', 85, { label: 'Long-term care', amount: 70000, endAge: 90 })); } }
    ]
  },

  {
    slug: 'self-employed-montreal',
    name: 'Self-employed consultant — Montréal',
    summary: '45, Quebec, $120k self-employment income (QPP both halves, no EI). Selling the business, a sabbatical, lower returns.',
    notes: 'A 45-year-old self-employed consultant in Quebec. Tax uses Quebec brackets, the federal abatement, and QPP on both the employee and employer side (Income tax › Self-employed). ' +
      'The business sale is entered as a non-taxable lump sum on the assumption that it is sheltered by the lifetime capital gains exemption; adjust if that does not apply.',
    build: function (b) {
      Object.assign(b.profile, { currentAge: 45, retirementAge: 62, endAge: 95, province: 'QC' });
      Object.assign(b.income, { salary: 120000, growth: 0.02 });
      Object.assign(b.tax, { selfEmployed: true });
      Object.assign(b.spending, { mode: 'total', total: 60000, retirementChange: 0 });
      b.accounts = [
        account('rrsp', 'RRSP', 'rrsp', 180000, { contribLimit: 'legal', startingRoom: 40000 }),
        account('tfsa', 'TFSA', 'tfsa', 70000, { contribLimit: 'legal', startingRoom: 25000 }),
        account('cash', 'Business cash reserve', 'cash', 40000, { contribLimit: 'none', contributionCap: 0 }),
        account('nonreg', 'Non-registered', 'nonreg', 120000, { costBase: 90000 })
      ];
      Object.assign(b.benefits, { cppAt65: 13500, cppStartAge: 65, oasStartAge: 65 });
      b.events = [
        ev(b, 'adjustment', 48, { label: 'Slow years', target: 'income', kind: 'step', pct: -0.3, endAge: 49 })
      ];
    },
    scenarios: [
      { name: 'Sell the business at 60', notes: '$350k net, assumed sheltered by the LCGE.',
        build: function (s, b) {
          s.overrides['profile.retirementAge'] = 60;
          s.events.push(ev(b, 'lumpSum', 60, { label: 'Business sale (net)', amount: 350000, taxType: 'nontaxable' }));
        } },
      { name: 'Sabbatical at 50', build: function (s, b) {
        s.events.push(ev(b, 'adjustment', 50, { label: 'Sabbatical', target: 'income', kind: 'step', pct: -1, endAge: 50 }),
          ev(b, 'expense', 50, { label: 'Sabbatical travel', amount: 25000, endAge: 50 }));
      } },
      { name: 'Returns 1.5 pp lower', build: function (s, b) {
        s.overrides['assumptions.returnPre'] = b.assumptions.returnPre - 0.015;
        s.overrides['assumptions.returnPost'] = b.assumptions.returnPost - 0.015;
      } }
    ]
  },

  {
    slug: 'retired-victoria',
    name: 'Recently retired — Victoria',
    summary: '67, British Columbia, already retired. RRIF drawdown order, the 4% rule, a bad sequence of returns, downsizing and care costs.',
    notes: 'A 67-year-old who retired at 65, now drawing on a RRIF, TFSA and non-registered account alongside CPP and OAS. ' +
      'Watch the OAS clawback and RRIF minimums in the Tax tab. Scenarios compare the 4% rule, drawing the RRIF first ("RRIF meltdown") to smooth taxable income, and a market crash early in retirement.',
    build: function (b) {
      Object.assign(b.profile, { currentAge: 67, retirementAge: 65, endAge: 95, province: 'BC' });
      Object.assign(b.income, { salary: 0, growth: 0 });
      Object.assign(b.spending, { mode: 'total', total: 55000, retirementChange: 0 });
      b.accounts = [
        account('rrsp', 'RRIF', 'rrsp', 620000, { contribLimit: 'none', contributionCap: 0 }),
        account('tfsa', 'TFSA', 'tfsa', 145000, { contribLimit: 'legal', startingRoom: 7000 }),
        account('cash', 'Cash', 'cash', 40000, { contribLimit: 'none', contributionCap: 0 }),
        account('nonreg', 'Non-registered', 'nonreg', 210000, { costBase: 150000 })
      ];
      b.savings.order = ['tfsa', 'nonreg', 'cash', 'rrsp'];
      b.retirement.withdrawalOrder = ['cash', 'nonreg', 'rrsp', 'tfsa'];
      Object.assign(b.assumptions, { returnPost: 0.045 });
      Object.assign(b.benefits, { cppAt65: 13800, cppStartAge: 65, oasStartAge: 65 });
      b.events = [
        ev(b, 'expense', 67, { label: 'Travel', amount: 20000, endAge: 75 }),
        ev(b, 'lumpSum', 76, { label: 'Downsize home (net)', amount: 250000, taxType: 'nontaxable' }),
        ev(b, 'expense', 88, { label: 'Long-term care', amount: 60000, endAge: 92 })
      ];
    },
    scenarios: [
      { name: '4% rule', notes: 'Under the 4% rule spending is not guaranteed: a shortfall here means the fixed withdrawal did not cover planned spending that year, even though money remains.', build: function (s) { s.overrides['retirement.strategy'] = 'fixedReal'; s.overrides['retirement.withdrawalRate'] = 0.04; } },
      { name: 'RRIF meltdown (draw RRIF first)', build: function (s) { s.overrides['retirement.withdrawalOrder'] = ['rrsp', 'cash', 'nonreg', 'tfsa']; } },
      { name: 'Crash at 68', build: function (s, b) {
        s.events.push(ev(b, 'returnOverride', 68, { label: 'Crash', mode: 'set', rate: -0.25, endAge: 68 }),
          ev(b, 'returnOverride', 69, { label: 'Bear market', mode: 'set', rate: -0.10, endAge: 69 }));
      } }
    ]
  },

  {
    slug: 'late-starter-winnipeg',
    name: 'Late starter — Winnipeg',
    summary: '52, Manitoba, $68k salary, modest savings and lots of unused RRSP/TFSA room. Working longer, cutting spending, an inheritance.',
    notes: 'A 52-year-old who started saving late and has a lot of unused RRSP and TFSA room. The base plan runs short in the late 70s; ' +
      'the scenarios show how much each lever helps: working to 67 and deferring CPP, cutting spending 15%, receiving an inheritance, or all three together.',
    build: function (b) {
      Object.assign(b.profile, { currentAge: 52, retirementAge: 65, endAge: 92, province: 'MB' });
      Object.assign(b.income, { salary: 68000, growth: 0.02 });
      Object.assign(b.spending, { mode: 'total', total: 44000, retirementChange: -0.05 });
      b.accounts = [
        account('rrsp', 'RRSP', 'rrsp', 40000, { contribLimit: 'legal', startingRoom: 60000 }),
        account('tfsa', 'TFSA', 'tfsa', 12000, { contribLimit: 'legal', startingRoom: 90000 }),
        account('cash', 'Cash', 'cash', 5000, { contribLimit: 'none', contributionCap: 0 }),
        account('nonreg', 'Non-registered', 'nonreg', 0, { costBase: 0 })
      ];
      Object.assign(b.benefits, { cppAt65: 11000, cppStartAge: 65, oasStartAge: 65 });
      b.events = [
        ev(b, 'expense', 55, { label: 'Car every 10 years', amount: 30000, endAge: 85, everyYears: 10 })
      ];
    },
    scenarios: [
      { name: 'Work to 67, CPP at 70', build: function (s) { s.overrides['profile.retirementAge'] = 67; s.overrides['benefits.cppStartAge'] = 70; } },
      { name: 'Cut spending 15%', build: function (s) { s.overrides['spending.total'] = 37400; } },
      { name: 'Inheritance at 60', build: function (s, b) { s.events.push(ev(b, 'lumpSum', 60, { label: 'Inheritance', amount: 120000, taxType: 'nontaxable' })); } },
      { name: 'All three: work to 67, spend less, inheritance', build: function (s, b) {
        s.overrides['profile.retirementAge'] = 67; s.overrides['benefits.cppStartAge'] = 70; s.overrides['spending.total'] = 37400;
        s.events.push(ev(b, 'lumpSum', 60, { label: 'Inheritance', amount: 120000, taxType: 'nontaxable' }));
      } }
    ]
  }
];

// ---------------------------------------------------------------------------
var outDir = path.join(ROOT, 'examples');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
var bundle = [];
var fmt = RP.fmt;
var md = ['# Example plans', '',
  'Ready-made plans with scenarios, for learning the planner or as a starting point for your own.', '',
  '**To use one:** in the app choose **File › Open Example…**, or download a `.json` file below and use **File › Open Plan…** (or drag it onto the window).', '',
  'The people are fictional, and the numbers are illustrative assumptions, not advice. Results below are from the bundled 2026 tax tables, in today’s dollars.', '',
  '_Generated by `node tools/build-examples.js`; edit that script rather than the files here._', ''];

EXAMPLES.forEach(function (ex) {
  counter = 0;
  currentSlug = ex.slug.split('-')[0];
  var doc = RP.schema.newDocument(ex.name);
  doc.meta = { name: ex.name, notes: ex.notes, created: STAMP, modified: STAMP, example: true };
  doc.base.profile.startYear = 2026;
  ex.build(doc.base);
  ex.scenarios.forEach(function (sd) {
    var s = RP.schema.newScenario(doc, sd.name);
    s.notes = sd.notes || '';
    sd.build(s, doc.base);
    doc.scenarios.push(s);
  });
  doc = RP.schema.normalize(doc);

  // Sanity check: every scenario must project without error.
  console.log('\n' + ex.name);
  var file0 = ex.slug + '.retirement-plan.json';
  var P = doc.base.profile;
  md.push('## ' + ex.name, '', ex.notes, '',
    '- **Profile:** age ' + P.currentAge + ', retiring at ' + P.retirementAge + ', planning to ' + P.endAge + ', ' + RP.taxData['2026'].provinces[P.province].name,
    '- **File:** [`' + file0 + '`](' + file0 + ')', '',
    '| Scenario | Portfolio at retirement | Ending portfolio | Money lasts |', '|---|--:|--:|---|');
  RP.scenarios.runAll(doc).forEach(function (r) {
    var sm = r.result.summary;
    md.push('| ' + r.name + ' | ' + fmt.compact(sm.atRetirementReal) + ' | ' + fmt.compact(sm.endingReal) + ' | ' +
      (sm.success ? 'to ' + sm.endAge + ' ✓' : (r.result.plan.retirement.strategy === 'needs' ? 'runs short at ' : 'spending not met from ') + sm.firstShortfallAge) + ' |');
  });
  md.push('');
  RP.scenarios.runAll(doc).forEach(function (r) {
    var s = r.result.summary;
    console.log('  ' + (r.name + '                                   ').slice(0, 34) +
      ' at retirement ' + fmt.compact(s.atRetirementReal).padStart(7) +
      '  ending ' + fmt.compact(s.endingReal).padStart(7) +
      '  ' + (s.success ? 'funded to ' + s.endAge : 'short from ' + s.firstShortfallAge));
  });

  var file = ex.slug + '.retirement-plan.json';
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(doc, null, 2) + '\n');
  bundle.push({ slug: ex.slug, name: ex.name, summary: ex.summary, file: file, doc: doc });
});

var js = '/*\n * GENERATED by tools/build-examples.js — do not edit by hand.\n' +
  ' * Example plans for File › Open Example. The same plans are in examples/*.retirement-plan.json.\n */\n' +
  '(function (RP) {\n  \'use strict\';\n  RP.examples = ' + JSON.stringify(bundle) + ';\n})(globalThis.RP);\n';
fs.writeFileSync(path.join(ROOT, 'js', 'data', 'examples.js'), js);
fs.writeFileSync(path.join(outDir, 'README.md'), md.join('\n'));
console.log('\nWrote ' + bundle.length + ' examples to examples/ and js/data/examples.js');
