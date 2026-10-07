/*
 * projection.js — the year-by-year simulation.
 *
 * RP.engine.project(inputs, opts) -> { years: [...], summary: {...} }
 *
 * `inputs` is an *effective* plan (scenario overrides already applied — see
 * scenarios.js). All dollar inputs are in today's dollars unless stated.
 *
 * Each simulated year runs these stages in order:
 *   1. events        — registered event types modify the year (RP.eventTypes)
 *   2. income        — employment, CPP, OAS, event income
 *   3. spending      — base spending (total or itemised) + event expenses
 *   4. cash flow     — accumulation (savings mode) or drawdown (withdrawal strategy),
 *                      solving for tax because RRSP deductions/withdrawals change it
 *   5. growth        — each account grows at its return; mid-year contributions
 *   6. record        — the year row used by the table, charts and analysis
 *
 * Conventions / simplifications (documented in the About tab):
 *   - Flows are stated at each year's start-of-year prices. Withdrawals occur at the start of the year;
 *     contributions mid-year (half a year of growth and of inflation).
 *   - Non-registered growth is treated as deferred capital gains (taxed on withdrawal via ACB tracking).
 *   - Cash/HISA growth is treated as interest, taxed annually.
 *   - RRSP is converted to a RRIF with minimum withdrawals from age 72 (if enabled).
 *   - Tax thresholds are indexed with the plan's inflation rate.
 *   - Couples (plan.spouse.enabled): each person has their own salary, CPP/OAS, accounts (account.owner),
 *     RRSP room, RRIF minimums and tax return; spending, the timeline and the retirement phase are the
 *     household's, keyed to your age. Eligible pension income can be split (up to 50%) to lower the
 *     household's tax. Survivorship (one partner dying first) is not modelled.
 *
 * opts:
 *   returnShocks: number[] — per-year deviation added to market returns (Monte Carlo)
 *   lite: boolean          — keep only what analysis needs (faster, less memory)
 */
(function (RP) {
  'use strict';
  var num = RP.util.num;
  var engine = RP.engine = RP.engine || {};

  function cppFactor(startAge, d) {
    var months = (startAge - 65) * 12;
    return months < 0 ? 1 + months * d.cpp.earlyPerMonth : 1 + months * d.cpp.latePerMonth;
  }
  function oasFactor(startAge, d) {
    var months = Math.min(Math.max(0, (startAge - 65) * 12), d.oas.maxDeferralMonths);
    return 1 + months * d.oas.deferralPerMonth;
  }
  function rrifFactor(age, d) {
    if (age >= 95) return d.rrifFactors[95];
    if (d.rrifFactors[age] != null) return d.rrifFactors[age];
    return 1 / (90 - age);
  }

  /** How each non-registered distribution type splits between interest, eligible dividends and capital gains. */
  var DIST_MIX = engine.DIST_MIX = {
    mix: { interest: 1 / 3, dividends: 1 / 3, gains: 1 / 3 },
    dividends: { interest: 0, dividends: 1, gains: 0 },
    interest: { interest: 1, dividends: 0, gains: 0 },
    gains: { interest: 0, dividends: 0, gains: 1 }
  };

  /** Contribution limit mode for an account (older plans only had a numeric cap). */
  engine.limitMode = function (a) {
    if (a.contribLimit) return a.contribLimit;
    if (a.contributionCap === '' || a.contributionCap == null) return 'unlimited';
    return num(a.contributionCap) === 0 ? 'none' : 'custom';
  };

  /** TFSA annual limit: indexed to inflation, rounded to the nearest $500 (CRA rule). */
  engine.tfsaLimit = function (year, d, inf) {
    var L = d.limits || {};
    var base = num(L.tfsaAnnual, 7000);
    if (year <= d.year) return base;
    var step = num(L.tfsaRounding, 500);
    return Math.max(base, Math.round(base * Math.pow(1 + inf, year - d.year) / step) * step);
  };

  /** RRSP dollar maximum for a year (indexed; CRA indexes to average wage growth, approximated by inflation). */
  engine.rrspMax = function (year, d, inf) {
    var L = d.limits || {};
    var base = num(L.rrspMax, 33810);
    return year <= d.year ? base : Math.round(base * Math.pow(1 + inf, year - d.year) / 10) * 10;
  };

  /**
   * Yearly growth of base spending for a phase: spending.growthWorking / growthRetired (nominal,
   * i.e. including inflation). Blank means "grow with inflation" (constant in today's dollars).
   */
  engine.spendingGrowth = function (S, retired, inf) {
    var g = retired ? S.growthRetired : S.growthWorking;
    return g == null || g === '' ? inf : num(g);
  };

  /** Element p of an optional per-person array. */
  function at(arr, p) { return arr ? arr[p] || 0 : 0; }

  /** Pension income that can be split with a spouse: pension-type income at any age, RRIF/RRSP income at 65+. */
  function splittable(inc, age) { return num(inc.pension) + (age >= 65 ? num(inc.rrif) : 0); }

  /** Rough net income, used only to aim the pension split. */
  function roughNet(inc) {
    return num(inc.employment) + num(inc.other) + num(inc.pension) + num(inc.rrif) + num(inc.cpp) + num(inc.oas) +
      num(inc.capitalGains) + num(inc.dividends) * 1.38 - num(inc.rrspDeduction);
  }

  /**
   * Move `s` of eligible pension income between spouses (s > 0: you → spouse; s < 0: spouse → you).
   * The moved amount keeps its character: the defined-benefit part stays pension-credit eligible at any
   * age, the RRIF part only if the receiving spouse is 65+ (as on the T1032 election).
   */
  function movePension(incs, ctxs, s) {
    if (!s) return incs;
    var from = s > 0 ? 0 : 1, to = 1 - from, amt = Math.abs(s);
    var E = splittable(incs[from], ctxs[from].age);
    var pensionShare = E > 0 ? num(incs[from].pension) / E : 1;
    var out = [Object.assign({}, incs[0]), Object.assign({}, incs[1])];
    out[from].pension = num(out[from].pension) - amt * pensionShare; out[from].rrif = num(out[from].rrif) - amt * (1 - pensionShare);
    out[to].pension = num(out[to].pension) + amt * pensionShare; out[to].rrif = num(out[to].rrif) + amt * (1 - pensionShare);
    return out;
  }

  /**
   * Household tax for a couple: each person files their own return. With `splitting`, up to half of
   * either spouse's eligible pension income is allocated to the other. The split is chosen by checking
   * a few candidates (none, the maximums, halfway, and the split that evens out the two incomes), then
   * refining around the best with a short golden-section search. Total tax is piecewise linear in the
   * split, so this lands on (or within a few dollars of) the lowest combined tax.
   */
  engine.householdTax = function (incs, ctxs, splitting) {
    var cache = {};
    function evaluate(s) {
      var key = Math.round(s * 100);
      if (cache[key]) return cache[key];
      var m = movePension(incs, ctxs, s);
      var r0 = RP.tax.compute(m[0], ctxs[0]), r1 = RP.tax.compute(m[1], ctxs[1]);
      return (cache[key] = { totalWithPayroll: r0.totalWithPayroll + r1.totalWithPayroll, people: [r0, r1], incs: m, split: s });
    }
    var none = evaluate(0);
    if (!splitting) return none;
    var hi = 0.5 * splittable(incs[0], ctxs[0].age), lo = -0.5 * splittable(incs[1], ctxs[1].age);
    if (hi - lo < 1) return none;
    var even = RP.util.clamp((roughNet(incs[0]) - roughNet(incs[1])) / 2, lo, hi);
    var pts = [lo, lo / 2, 0, even, hi / 2, hi].sort(function (a, b) { return a - b; })
      .filter(function (v, i, arr) { return i === 0 || v - arr[i - 1] > 1; });
    var best = none;
    pts.forEach(function (sp) { var c = evaluate(sp); if (c.totalWithPayroll < best.totalWithPayroll - 0.005) best = c; });
    var bi = pts.indexOf(best.split);
    if (bi < 0) bi = pts.indexOf(0);
    var a = pts[Math.max(0, bi - 1)], b = pts[Math.min(pts.length - 1, bi + 1)];
    var g = 0.381966, x1 = a + g * (b - a), x2 = b - g * (b - a), f1 = evaluate(x1), f2 = evaluate(x2);
    for (var k = 0; k < 10 && b - a > 20; k++) {
      if (f1.totalWithPayroll <= f2.totalWithPayroll) { b = x2; x2 = x1; f2 = f1; x1 = a + g * (b - a); f1 = evaluate(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = b - g * (b - a); f2 = evaluate(x2); }
    }
    [f1, f2].forEach(function (c) { if (c.totalWithPayroll < best.totalWithPayroll - 0.005) best = c; });
    return best;
  };

  /** Prior-year earned income used for the first year's RRSP room estimate. */
  function salary0Initial(plan) {
    return num(plan.income.salary) / (1 + num(plan.income.growth));
  }

  engine.project = function (plan, opts) {
    opts = opts || {};
    var lite = !!opts.lite;
    var d = RP.tax.dataFor(plan.tax.year);
    var prof = plan.profile;
    var A = plan.assumptions;
    var inf = num(A.inflation);
    var startAge = Math.round(num(prof.currentAge));
    var endAge = Math.max(startAge, Math.round(num(prof.endAge)));
    var retAge = Math.round(num(prof.retirementAge));
    var startYear = Math.round(num(prof.startYear, new Date().getFullYear()));
    var cgInc = d.capitalGainsInclusion == null ? 0.5 : d.capitalGainsInclusion;

    // Couple: person 0 is you, person 1 your spouse/partner.
    var SP = plan.spouse || {};
    var couple = !!SP.enabled;
    var spAge0 = Math.round(num(SP.currentAge, startAge));
    var spRetAge = Math.round(num(SP.retirementAge, retAge));
    var spSalary0 = couple ? num(SP.salary) : 0, spGrowth = num(SP.growth);
    var splitting = couple && plan.tax.pensionSplitting !== false;

    var savingsMode = RP.savingsModes.get(plan.savings.mode) || RP.savingsModes.get('surplus');
    var strategy = RP.withdrawalStrategies.get(plan.retirement.strategy) || RP.withdrawalStrategies.get('needs');

    // Account state
    var accts = (plan.accounts || []).map(function (a) {
      return {
        id: a.id, name: a.name, type: a.type, owner: couple && a.owner === 'spouse' ? 1 : 0,
        bal: Math.max(0, num(a.balance)),
        acb: a.type === 'nonreg' ? Math.max(0, num(a.costBase, num(a.balance))) : 0,
        returnRate: a.returnRate === '' || a.returnRate == null ? null : num(a.returnRate),
        cap: a.contributionCap === '' || a.contributionCap == null ? null : num(a.contributionCap),
        limitMode: engine.limitMode(a),
        startingRoom: a.startingRoom === '' || a.startingRoom == null ? null : Math.max(0, num(a.startingRoom)),
        distYield: a.type === 'nonreg' ? Math.max(0, num(a.distYield, 0)) : 0,
        distType: a.distType || 'mix', dist: 0,
        room: null, wPrev: 0
      };
    });
    var enforceRoom = plan.savings.enforceRoom !== false;
    var limits = d.limits || {};
    var prevEmp = [salary0Initial(plan), spSalary0 / (1 + spGrowth)];   // last year's employment income, per person
    var byId = {};
    accts.forEach(function (a) { byId[a.id] = a; });
    function ordered(list) {
      var seen = {}, out = [];
      (list || []).forEach(function (id) { if (byId[id] && !seen[id]) { seen[id] = 1; out.push(byId[id]); } });
      accts.forEach(function (a) { if (!seen[a.id]) out.push(a); });
      return out;
    }
    var contribOrder = ordered(plan.savings.order);
    var withdrawOrder = ordered(plan.retirement.withdrawalOrder);

    var events = (plan.events || []).filter(function (e) { return e.enabled !== false && RP.eventTypes.has(e.type); });
    var persist = {};
    events.forEach(function (e) { persist[e.id] = {}; });

    var stratState = {};
    var years = [];
    var salary0 = num(plan.income.salary);
    var growth = num(plan.income.growth);
    var shocks = opts.returnShocks;
    var spendIdx = 1;   // growth index for base spending (equals cpi unless spending growth is set)

    for (var age = startAge, t = 0; age <= endAge; age++, t++) {
      var year = startYear + t;
      var cpi = Math.pow(1 + inf, t);
      var taxIdx = plan.tax.indexBrackets === false ? 1 : Math.pow(1 + inf, year - d.year);
      var retired = age >= retAge;
      var ages = [age, spAge0 + t];

      var y = {
        t: t, age: age, year: year, cpi: cpi, cpiEnd: cpi * (1 + inf), retired: retired,
        mods: { income: 1, spending: 1, savings: 1, incomeAdd: 0, spendingAdd: 0, savingsAdd: 0, spouseIncome: 1, spouseIncomeAdd: 0, returnOverride: null, returnDelta: 0, contrib: {} },
        extraIncome: [], extraExpenses: [], activeEvents: []
      };

      // 1. Events
      for (var ei = 0; ei < events.length; ei++) {
        var ev = events[ei], def = RP.eventTypes.get(ev.type);
        def.apply(ev, y, { plan: plan, t: t, age: age, cpi: cpi, persist: persist[ev.id] });
        if (!lite && def.isActive && def.isActive(ev, age)) y.activeEvents.push(ev.id);
      }

      // 2. Income
      // Dollar adjustments join the salary first, so percentage adjustments (e.g. a sabbatical) scale them too.
      var emp = [
        retired ? 0 : Math.max(0, (salary0 * Math.pow(1 + growth, t) + y.mods.incomeAdd) * y.mods.income),
        couple && ages[1] < spRetAge ? Math.max(0, (spSalary0 * Math.pow(1 + spGrowth, t) + y.mods.spouseIncomeAdd) * y.mods.spouseIncome) : 0
      ];
      y.employment = emp[0] + emp[1];
      var oasIdx = Math.pow(1 + inf, year - d.year);   // OAS is CPI-indexed whether or not tax brackets are
      var benefitsFor = function (B, a) {
        var cppStart = RP.util.clamp(Math.round(num(B.cppStartAge, 65)), 60, 70);
        var oasStart = RP.util.clamp(Math.round(num(B.oasStartAge, 65)), 65, 70);
        return {
          cpp: B.cppEnabled && a >= cppStart ? num(B.cppAt65) * cpi * cppFactor(cppStart, d) : 0,
          oas: B.oasEnabled && a >= oasStart
            ? d.oas.maxAnnual65 * oasIdx * RP.util.clamp(num(B.oasResidency, 1), 0, 1) * oasFactor(oasStart, d) * (a >= 75 ? 1 + d.oas.age75Boost : 1)
            : 0
        };
      };
      var ben = [benefitsFor(plan.benefits, ages[0]), couple ? benefitsFor(SP, ages[1]) : { cpp: 0, oas: 0 }];
      y.cpp = ben[0].cpp + ben[1].cpp;
      y.oas = ben[0].oas + ben[1].oas;
      var exOther = [0, 0], exPension = [0, 0], exNonTax = 0;
      y.extraIncome.forEach(function (x) {
        var p = couple && x.owner === 'spouse' ? 1 : 0;
        if (x.taxType === 'pension') exPension[p] += x.amount;
        else if (x.taxType === 'nontaxable') exNonTax += x.amount;
        else exOther[p] += x.amount;
      });
      y.otherIncome = exOther[0] + exOther[1] + exPension[0] + exPension[1] + exNonTax;

      // Registered contribution room (RRSP / TFSA) available this year
      accts.forEach(function (a) {
        if (a.type === 'tfsa') {
          var newRoom = engine.tfsaLimit(year, d, inf);
          if (t === 0) a.room = a.startingRoom != null ? a.startingRoom : newRoom;
          else a.room += newRoom + a.wPrev;          // withdrawals are re-added the following year
        } else if (a.type === 'rrsp') {
          var earned = Math.min(num(limits.rrspPct, 0.18) * prevEmp[a.owner], engine.rrspMax(year, d, inf));
          if (t === 0) a.room = a.startingRoom != null ? a.startingRoom : earned;
          else a.room += earned;
        }
      });

      // 3. Spending — base amounts are today's dollars grown by the spending index for each year's phase.
      var S = plan.spending, base;
      if (t > 0) spendIdx *= 1 + engine.spendingGrowth(S, retired, inf);
      if (S.mode === 'itemized') {
        base = 0;
        (S.items || []).forEach(function (it) {
          if (it.enabled === false) return;
          var s0 = it.startAge === '' || it.startAge == null ? -Infinity : num(it.startAge);
          var e0 = it.endAge === '' || it.endAge == null ? Infinity : num(it.endAge);
          if (age < s0 || age > e0) return;
          if (it.phase === 'working' && retired) return;
          if (it.phase === 'retired' && !retired) return;
          base += num(it.amount) * (it.indexed === false ? 1 : spendIdx);
        });
      } else {
        base = num(S.total) * spendIdx;
      }
      if (retired) base *= 1 + num(S.retirementChange);
      base = Math.max(0, (base + y.mods.spendingAdd) * y.mods.spending);
      y.spendingBase = base;
      y.eventExpenses = RP.util.sum(y.extraExpenses, function (x) { return x.amount; });
      y.spending = base + y.eventExpenses;

      // Account returns this year
      var startTotal = 0;
      accts.forEach(function (a) {
        var r;
        if (a.returnRate != null) r = a.returnRate;
        else if (a.type === 'cash') r = num(A.cashReturn, 0.02);
        else r = retired ? num(A.returnPost) : num(A.returnPre);
        if (a.type !== 'cash') {
          if (y.mods.returnOverride != null) r = y.mods.returnOverride;
          r += y.mods.returnDelta;
          if (shocks) r += shocks[t] || 0;
        }
        a.r = Math.max(-0.99, r);
        a.start = a.bal;
        a.w = 0; a.c = 0;
        startTotal += a.bal;
      });

      // Interest on cash accounts is taxable annually (stays in the account).
      var interestBy = [0, 0];
      accts.forEach(function (a) { if (a.type === 'cash' && a.r > 0) interestBy[a.owner] += a.start * a.r; });
      var interest = interestBy[0] + interestBy[1];

      // Non-registered distributions (dividends, interest, capital-gain distributions) are part of the
      // account's total return, taxed in the year received and reinvested (which adds to the cost base).
      var distI = [0, 0], distD = [0, 0], distG = [0, 0];
      accts.forEach(function (a) {
        a.dist = a.distYield > 0 ? a.start * a.distYield : 0;
        if (!a.dist) return;
        var mix = DIST_MIX[a.distType] || DIST_MIX.mix;
        distI[a.owner] += a.dist * mix.interest; distD[a.owner] += a.dist * mix.dividends; distG[a.owner] += a.dist * mix.gains;
      });
      var distInterest = distI[0] + distI[1], distDividends = distD[0] + distD[1], distGains = distG[0] + distG[1];

      // RRIF minimum
      // RRIF minimums, by the account owner's age
      var rrifBy = [0, 0];
      if (plan.retirement.rrifMinimums !== false) {
        accts.forEach(function (a) {
          if (a.type === 'rrsp' && ages[a.owner] >= 72) {
            var m = Math.min(a.bal, a.bal * rrifFactor(ages[a.owner], d));
            a.w += m; rrifBy[a.owner] += m;
          }
        });
      }
      var rrifMin = rrifBy[0] + rrifBy[1];

      var taxCtxs = [0, 1].map(function (p) { return { age: ages[p], province: prof.province, data: d, index: taxIdx, settings: plan.tax }; });
      var inc0 = [0, 1].map(function (p) {
        return {
          employment: emp[p], other: exOther[p] + interestBy[p] + distI[p], pension: exPension[p],
          cpp: ben[p].cpp, oas: ben[p].oas, rrif: rrifBy[p], capitalGains: distG[p] * cgInc, dividends: distD[p], rrspDeduction: 0
        };
      });
      var cashIn = y.employment + y.cpp + y.oas + exOther[0] + exOther[1] + exPension[0] + exPension[1] + exNonTax + rrifMin;

      // Tax for the household. `extra` holds per-person arrays [you, spouse] of rrif, capitalGains and
      // rrspDeduction on top of the year's base income. Returns { totalWithPayroll, people, incs, split }.
      function taxWith(extra) {
        var incs = inc0.map(function (b, p) {
          return {
            employment: b.employment, other: b.other, pension: b.pension, cpp: b.cpp, oas: b.oas,
            rrif: b.rrif + at(extra.rrif, p), capitalGains: b.capitalGains + at(extra.capitalGains, p),
            dividends: b.dividends, rrspDeduction: at(extra.rrspDeduction, p)
          };
        });
        if (!couple) {
          var one = RP.tax.compute(incs[0], taxCtxs[0]);
          return { totalWithPayroll: one.totalWithPayroll, people: [one], incs: incs, split: 0 };
        }
        return engine.householdTax(incs, taxCtxs, splitting);
      }

      // How much each account can take this year: limit mode (or a contribution event), capped by room.
      function capacity(a, allowRRSP) {
        if (a.type === 'rrsp' && (!allowRRSP || ages[a.owner] > 71)) return 0;   // no RRSP contributions after 71
        var ov = y.mods.contrib[a.id];
        var mode = ov ? ov.mode : a.limitMode;
        var amt;
        if (mode === 'none') return 0;
        if (mode === 'custom') amt = (ov ? ov.amount : num(a.cap)) * cpi;
        else if (mode === 'legal') amt = a.room != null ? a.room : Infinity;
        else amt = Infinity;
        if (enforceRoom && a.room != null) amt = Math.min(amt, a.room);
        return Math.max(0, amt);
      }

      // Allocate contribution C across accounts in contribution order. Anything no account can take stays unallocated.
      function allocate(C, allowRRSP) {
        var res = { map: {}, rrsp: 0, rrspBy: [0, 0], total: 0 };
        var left = C;
        for (var i = 0; i < contribOrder.length && left > 0.005; i++) {
          var a = contribOrder[i];
          var amt = Math.min(left, capacity(a, allowRRSP));
          if (amt > 0) { res.map[a.id] = amt; left -= amt; res.total += amt; if (a.type === 'rrsp') { res.rrsp += amt; res.rrspBy[a.owner] += amt; } }
        }
        return res;
      }
      function totalCapacity(allowRRSP) {
        var s2 = 0;
        contribOrder.forEach(function (a) { s2 += capacity(a, allowRRSP); });
        return s2;
      }

      // Draw gross G from accounts in withdrawal order. Returns taxable pieces.
      function draws(G) {
        var res = { map: {}, rrif: 0, capitalGains: 0, rrifBy: [0, 0], cgBy: [0, 0], total: 0 };
        var left = G;
        for (var i = 0; i < withdrawOrder.length && left > 0.005; i++) {
          var a = withdrawOrder[i];
          var avail = Math.max(0, a.start - a.w);
          var amt = Math.min(left, avail);
          if (amt <= 0) continue;
          res.map[a.id] = amt; left -= amt; res.total += amt;
          if (a.type === 'rrsp') { res.rrif += amt; res.rrifBy[a.owner] += amt; }
          else if (a.type === 'nonreg' && a.start > 0) {
            var g = amt * Math.max(0, 1 - a.acb / a.start) * cgInc;
            res.capitalGains += g; res.cgBy[a.owner] += g;
          }
        }
        return res;
      }
      function available() {
        var s = 0;
        accts.forEach(function (a) { s += Math.max(0, a.start - a.w); });
        return s;
      }

      // Solve for gross withdrawal giving net cash `need` (after the extra tax it causes).
      function solveWithdrawal(need, baseTax) {
        var maxG = available();
        function net(G) { var dr = draws(G); return { n: G - (taxWith({ rrif: dr.rrifBy, capitalGains: dr.cgBy }).totalWithPayroll - baseTax), dr: dr }; }
        var top = net(maxG);
        if (top.n <= need + 0.5) return { dr: top.dr, shortfall: Math.max(0, need - top.n) };
        var G = Math.min(maxG, need / 0.75), prevG = 0, prevN = 0, cur;
        for (var k = 0; k < 25; k++) {
          cur = net(G);
          var err = need - cur.n;
          if (Math.abs(err) < 0.5) break;
          var slope = G !== prevG ? (cur.n - prevN) / (G - prevG) : 0.7;
          if (!(slope > 0.05) || slope > 1.0001) slope = 0.7;
          prevG = G; prevN = cur.n;
          G = Math.min(maxG, Math.max(need, G + err / slope));
        }
        return { dr: cur.dr, shortfall: 0 };
      }

      var contrib = { map: {}, rrsp: 0, rrspBy: [0, 0] }, wd = { map: {}, rrif: 0, capitalGains: 0, rrifBy: [0, 0], cgBy: [0, 0], total: 0 };
      var taxRes, C = 0, unallocated = 0, shortfall = 0;
      var target = retired ? strategy.grossTarget(y, plan, { state: stratState, startTotal: startTotal }) : savingsMode.target(y, plan);
      if (!retired && target != null && y.mods.savingsAdd) target = Math.max(0, target + y.mods.savingsAdd);

      if (!retired) {
        // ---- Accumulation ----
        var cap = Math.min(target == null ? Infinity : Math.max(0, target), totalCapacity(true));
        var X = function (Cc) {
          var al = allocate(Cc, true);
          var tr = taxWith({ rrspDeduction: al.rrspBy });
          return { x: cashIn - tr.totalWithPayroll - y.spending, al: al, tr: tr };
        };
        var r0 = X(0);
        if (r0.x < 0 && target == null) {
          C = 0; contrib = r0.al; taxRes = r0.tr;
        } else {
          C = Math.min(cap, Math.max(0, r0.x));
          var rr = r0;
          for (var it = 0; it < 30; it++) {
            rr = X(C);
            var nextC = Math.min(cap, Math.max(0, rr.x));
            if (Math.abs(nextC - C) < 0.5) { C = nextC; rr = X(C); break; }
            C = nextC;
          }
          contrib = rr.al; taxRes = rr.tr;
        }
        var leftover = cashIn - taxRes.totalWithPayroll - y.spending - C;
        if (leftover < -0.5) {
          // Deficit: draw from savings (C is 0 here).
          var sol = solveWithdrawal(-leftover, taxRes.totalWithPayroll);
          wd = sol.dr;
          taxRes = taxWith({ rrspDeduction: contrib.rrspBy, rrif: wd.rrifBy, capitalGains: wd.cgBy });
          // Reconcile against the final tax so cash always balances (covers any solver tolerance).
          var after = cashIn + wd.total - taxRes.totalWithPayroll - y.spending - C;
          if (after < -0.5) shortfall = -after; else unallocated = Math.max(0, after);
        } else {
          unallocated = Math.max(0, leftover);
        }
      } else {
        // ---- Drawdown ----
        var baseTax = taxWith({}).totalWithPayroll;
        if (target == null) {
          var need = y.spending + baseTax - cashIn;
          if (need > 0.5) {
            var sol2 = solveWithdrawal(need, baseTax);
            wd = sol2.dr; shortfall = sol2.shortfall;
          }
        } else {
          var extraG = Math.max(0, target - rrifMin);
          wd = draws(extraG);
        }
        taxRes = taxWith({ rrif: wd.rrifBy, capitalGains: wd.cgBy });
        var cashNet = cashIn + wd.total - taxRes.totalWithPayroll - y.spending;
        if (cashNet > 0.5) {
          contrib = allocate(cashNet, false);   // reinvest surplus outside the RRSP
          C = contrib.total;
          unallocated = cashNet - C;
        } else if (cashNet < -0.5) {
          shortfall = -cashNet;   // spending not covered (fixed-rate strategies, depleted accounts, or solver tolerance)
        }
      }

      // 5. Growth
      var endTotal = 0, growthAmt = 0;
      accts.forEach(function (a) {
        var w = a.w + (wd.map[a.id] || 0);
        var c = contrib.map[a.id] || 0;
        if (a.type === 'nonreg' && a.start > 0 && w > 0) a.acb -= a.acb * Math.min(1, w / a.start);
        if (a.type === 'nonreg') a.acb += c + a.dist;   // reinvested distributions were already taxed
        var after = Math.max(0, a.start - w);
        // Each year's flows are stated at start-of-year prices (cpi). A contribution invested mid-year
        // therefore carries half a year of inflation as well as half a year of compound growth;
        // without the inflation half, savings would leak ~inf/2 in real terms every year.
        var end = after * (1 + a.r) + c * Math.sqrt((1 + a.r) * (1 + inf));
        growthAmt += end - after - c;
        a.bal = Math.max(0, end);
        a.wTotal = w; a.cTotal = c;
        if (a.room != null) a.room = Math.max(0, a.room - c);
        a.wPrev = a.type === 'tfsa' ? w : 0;
        endTotal += a.bal;
      });
      prevEmp = emp;

      // 6. Record
      var totalW = rrifMin + wd.total;
      if (lite) {
        years.push({ age: age, startTotal: startTotal, total: endTotal, real: endTotal / y.cpiEnd, shortfall: shortfall, tax: taxRes.totalWithPayroll, spending: y.spending, cpi: cpi, cpiEnd: y.cpiEnd });
        continue;
      }
      var balances = {}, contribs = {}, withdrawals = {}, room = {};
      accts.forEach(function (a) { balances[a.id] = a.bal; contribs[a.id] = a.cTotal; withdrawals[a.id] = a.wTotal; if (a.room != null) room[a.id] = a.room; });
      var people = taxRes.people;
      function sumP(f) { return people.reduce(function (s2, r) { return s2 + f(r); }, 0); }
      years.push({
        t: t, age: age, year: year, cpi: cpi, cpiEnd: y.cpiEnd, retired: retired,
        spouseAge: couple ? ages[1] : null,
        employment: y.employment, cpp: y.cpp, oas: y.oas, otherIncome: y.otherIncome, interest: interest,
        incomeTotal: y.employment + y.cpp + y.oas + y.otherIncome,
        spendingBase: y.spendingBase, eventExpenses: y.eventExpenses, spending: y.spending,
        extraIncome: y.extraIncome, extraExpenses: y.extraExpenses,
        tax: taxRes.totalWithPayroll, incomeTax: sumP(function (r) { return r.incomeTax; }), payroll: sumP(function (r) { return r.payroll.total; }),
        oasClawback: sumP(function (r) { return r.oasClawback; }), grossIncome: sumP(function (r) { return r.grossIncome; }),
        federalTax: sumP(function (r) { return r.federal; }), provincialTax: sumP(function (r) { return r.provincial; }),
        // Per-person tax: [0] is you, [1] your spouse (couples only). taxDetail/taxInputs/taxCtx are yours.
        taxDetail: people[0], taxInputs: taxRes.incs[0], taxCtx: taxCtxs[0],
        taxPeople: couple ? [0, 1].map(function (p) { return { detail: people[p], inputs: taxRes.incs[p], ctx: taxCtxs[p] }; }) : null,
        pensionSplit: taxRes.split,
        distributions: distInterest + distDividends + distGains, realizedGains: wd.capitalGains,
        contributions: C, contribByAccount: contribs, roomByAccount: room, rrspContribution: contrib.rrsp,
        withdrawals: totalW, withdrawByAccount: withdrawals, rrifMin: rrifMin,
        unallocated: unallocated, shortfall: shortfall, growth: growthAmt,
        balances: balances, startTotal: startTotal, total: endTotal,
        portfolioReturn: startTotal > 0 ? growthAmt / Math.max(1, startTotal - totalW + C / 2) : 0,
        activeEvents: y.activeEvents, mods: y.mods
      });
    }

    return { years: years, summary: engine.summarize(years, plan), plan: plan };
  };

  /** Key metrics for KPI tiles, scenario comparison and sensitivity analysis. */
  engine.summarize = function (years, plan) {
    var retAge = Math.round(num(plan.profile.retirementAge));
    var s = {
      atRetirement: 0, atRetirementReal: 0, peak: 0, peakAge: null,
      ending: 0, endingReal: 0, depletionAge: null, firstShortfallAge: null,
      shortfallYears: 0, lifetimeTax: 0, lifetimeTaxReal: 0, success: true,
      endAge: years.length ? years[years.length - 1].age : null
    };
    var prevTotal = null, prevReal = null;
    years.forEach(function (y, i) {
      if (y.age === retAge) {
        s.atRetirement = i === 0 ? (y.startTotal != null ? y.startTotal : y.total) : prevTotal;
        s.atRetirementReal = i === 0 ? s.atRetirement / y.cpi : prevReal;
      }
      if (y.total > s.peak) { s.peak = y.total; s.peakAge = y.age; }
      s.lifetimeTax += y.tax;
      s.lifetimeTaxReal += y.tax / y.cpi;
      if (y.shortfall > 1) {
        s.shortfallYears++;
        s.success = false;
        if (s.firstShortfallAge == null) s.firstShortfallAge = y.age;
        if (s.depletionAge == null && y.total < 1) s.depletionAge = y.age;
      }
      prevTotal = y.total; prevReal = y.total / y.cpiEnd;
    });
    if (years.length) {
      var last = years[years.length - 1];
      s.ending = last.total;
      s.endingReal = last.total / last.cpiEnd;
    }
    if (retAge <= (years[0] && years[0].age)) { s.atRetirement = years[0] ? (years[0].startTotal || 0) : 0; s.atRetirementReal = s.atRetirement; }
    return s;
  };
})(globalThis.RP);
