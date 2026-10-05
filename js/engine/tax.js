/*
 * tax.js — Canadian personal income tax calculator (pure functions, no DOM).
 *
 * RP.tax.compute(income, ctx) returns a full breakdown for one person-year.
 *
 *   income = {
 *     employment,      // T4 employment income
 *     other,           // other fully-taxable income (rental, part-time, interest, etc.)
 *     pension,         // pension income eligible for the pension credit at any age (e.g. DB pension)
 *     rrif,            // RRSP/RRIF withdrawals (pension-credit eligible at 65+)
 *     cpp, oas,        // government benefits (gross)
 *     capitalGains,    // TAXABLE portion of capital gains (already multiplied by inclusion rate)
 *     rrspDeduction    // RRSP contributions deducted this year
 *   }
 *   ctx = {
 *     age, province, data (RP.taxData[year]), index (inflation factor vs data year),
 *     settings: plan.tax  (mode, flatRate, customBrackets, customCredit,
 *                          includePayroll, selfEmployed, oasClawback)
 *   }
 *
 * Province-specific quirks are implemented as named "rules" in RP.taxRules so
 * new ones can be added without touching the core calculation.
 */
(function (RP) {
  'use strict';
  var num = RP.util.num;

  var tax = RP.tax = {};

  /** Progressive tax on `income` given brackets [{upTo, rate}] with thresholds scaled by `idx`. */
  tax.bracketTax = function (income, brackets, idx) {
    var t = 0, lower = 0;
    idx = idx || 1;
    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      var upper = b.upTo == null ? Infinity : b.upTo * idx;
      if (income <= lower) break;
      t += (Math.min(income, upper) - lower) * b.rate;
      lower = upper;
    }
    return t;
  };

  /** Rate applying to the next dollar of income. */
  tax.bracketRate = function (income, brackets, idx) {
    idx = idx || 1;
    for (var i = 0; i < brackets.length; i++) {
      var b = brackets[i];
      if (b.upTo == null || income < b.upTo * idx) return b.rate;
    }
    return brackets[brackets.length - 1].rate;
  };

  /** Basic personal amount, honouring an optional phase-out. */
  tax.bpaAmount = function (bpa, incomeForPhase, idx) {
    if (!bpa) return 0;
    var max = bpa.max * idx;
    if (bpa.phaseStart == null) return max;
    var min = (bpa.min || 0) * idx;
    var start = bpa.phaseStart * idx, end = bpa.phaseEnd * idx;
    if (incomeForPhase <= start) return max;
    if (incomeForPhase >= end) return min;
    return max - (max - min) * (incomeForPhase - start) / (end - start);
  };

  tax.ageAmount = function (age, ageDef, netIncome, idx, personAge) {
    if (!ageDef || personAge < 65) return 0;
    var amt = ageDef.amount * idx - Math.max(0, netIncome - ageDef.threshold * idx) * ageDef.reductionRate;
    return Math.max(0, amt);
  };

  /** CPP/QPP, EI and QPIP on employment income. */
  tax.payroll = function (employment, ctx) {
    var d = ctx.data.payroll, idx = ctx.index, s = ctx.settings || {};
    var prov = ctx.data.provinces[ctx.province] || {};
    var out = { cpp: 0, cpp2: 0, ei: 0, qpip: 0, baseCredit: 0, deduction: 0, total: 0 };
    if (!s.includePayroll || employment <= 0) return out;

    // CPP/QPP contributions stop at 70; EI and QPIP premiums apply at any age.
    var cppApplies = ctx.age < d.stopAge;
    var p = prov.usesQPP ? d.qpp : d.cpp;
    var ympe = p.ympe * idx, yampe = p.yampe * idx;
    var pensionable = cppApplies ? Math.max(0, Math.min(employment, ympe) - p.exemption) : 0;
    var base = pensionable * p.baseRate;
    var enh = pensionable * p.firstEnhancedRate;
    var tier2 = cppApplies ? Math.max(0, Math.min(employment, yampe) - ympe) * p.cpp2Rate : 0;

    if (s.selfEmployed) {
      // Pays both halves. Employee base portion -> credit; employer half + enhanced portions -> deduction.
      out.cpp = 2 * (base + enh);
      out.cpp2 = 2 * tier2;
      out.baseCredit = base;
      out.deduction = base + enh + enh + tier2 + tier2;
    } else {
      out.cpp = base + enh;
      out.cpp2 = tier2;
      out.baseCredit = base;
      out.deduction = enh + tier2;
      var eiRate = prov.usesQPP ? d.ei.rateQC : d.ei.rate;
      out.ei = Math.min(employment, d.ei.maxInsurable * idx) * eiRate;
      if (prov.usesQPP) out.qpip = Math.min(employment, d.qpip.maxInsurable * idx) * d.qpip.rate;
    }
    out.total = out.cpp + out.cpp2 + out.ei + out.qpip;
    return out;
  };

  // ---------------------------------------------------------------------------
  // Province-specific rules. Each receives (state, ctx, provDef) and may adjust
  // state.provincial and add itemised lines to state.lines.
  // ---------------------------------------------------------------------------
  RP.taxRules = RP.createRegistry('taxRules');

  RP.taxRules.register({
    id: 'ontarioSurtax',
    label: 'Ontario surtax',
    apply: function (st, ctx, prov) {
      var basic = st.provincial;
      var idx = prov.indexed === false ? 1 : ctx.index;
      var sur = 0;
      prov.surtax.forEach(function (s) { sur += Math.max(0, basic - s.threshold * idx) * s.rate; });
      st.provincial += sur;
      st.lines.push({ label: 'Ontario surtax', amount: sur });
    }
  });

  RP.taxRules.register({
    id: 'ontarioHealthPremium',
    label: 'Ontario Health Premium',
    apply: function (st, ctx, prov) {
      var ti = st.taxableIncome, prem = 0;
      prov.healthPremium.forEach(function (tier) {
        if (ti > tier.from) prem = Math.min(tier.cap, tier.base + (ti - tier.from) * tier.rate);
      });
      st.provincial += prem;
      st.lines.push({ label: 'Ontario Health Premium', amount: prem });
    }
  });

  /** Full calculation. */
  tax.compute = function (inc, ctx) {
    var s = ctx.settings || {};
    var d = ctx.data;
    var idx = ctx.index || 1;
    var prov = d.provinces[ctx.province] || d.provinces.ON;
    var pIdx = prov.indexed === false ? 1 : idx;

    var employment = num(inc.employment), other = num(inc.other), pension = num(inc.pension),
        rrif = num(inc.rrif), cpp = num(inc.cpp), oas = num(inc.oas),
        cg = num(inc.capitalGains), rrspDed = num(inc.rrspDeduction);

    var payroll = tax.payroll(employment, ctx);
    var gross = employment + other + pension + rrif + cpp + oas + cg;
    var netIncome = Math.max(0, gross - rrspDed - payroll.deduction);

    var clawback = 0;
    if (s.oasClawback !== false && oas > 0) {
      clawback = Math.min(oas, Math.max(0, netIncome - d.oas.clawbackThreshold * idx) * d.oas.clawbackRate);
    }
    var taxable = Math.max(0, netIncome - clawback);

    var st = {
      grossIncome: gross, netIncome: netIncome, taxableIncome: taxable,
      federal: 0, provincial: 0, federalCredits: 0, provincialCredits: 0,
      oasClawback: clawback, payroll: payroll, lines: []
    };

    var mode = s.mode || 'calculated';
    if (mode === 'flat') {
      st.federal = taxable * num(s.flatRate);
      st.lines.push({ label: 'Flat rate ' + RP.fmt.pct(num(s.flatRate)), amount: st.federal });
    } else if (mode === 'custom') {
      var cb = (s.customBrackets && s.customBrackets.length) ? s.customBrackets : [{ upTo: null, rate: 0.3 }];
      var ci = s.indexBrackets === false ? 1 : idx;
      st.federal = Math.max(0, tax.bracketTax(taxable, cb, ci) - num(s.customCredit) * ci * cb[0].rate);
      st.lines.push({ label: 'Custom brackets', amount: st.federal });
    } else {
      // ---- Federal ----
      var f = d.federal;
      var pensionEligible = Math.min(pension + (ctx.age >= 65 ? rrif : 0), f.pension.amount);
      var fCredits =
        tax.bpaAmount(f.bpa, netIncome, idx) +
        tax.ageAmount(ctx.age, f.age, netIncome, idx, ctx.age) +
        pensionEligible +
        Math.min(employment, f.canadaEmployment.amount * idx) +
        payroll.baseCredit + payroll.ei + payroll.qpip;
      var fGross = tax.bracketTax(taxable, f.brackets, idx);
      var fed = Math.max(0, fGross - fCredits * f.creditRate);
      if (prov.federalAbatement) {
        var abate = fed * f.quebecAbatement;
        st.lines.push({ label: 'Quebec abatement', amount: -abate });
        fed -= abate;
      }
      st.federal = fed;
      st.federalCredits = fCredits;

      // ---- Provincial ----
      var pRate = prov.brackets[0].rate;
      var provPension = prov.pension ? Math.min(pension + (ctx.age >= 65 ? rrif : 0), prov.pension.amount * (prov.pension.indexed === false ? 1 : pIdx)) : 0;
      var pCredits =
        tax.bpaAmount(prov.bpa, netIncome, pIdx) +
        tax.ageAmount(ctx.age, prov.age, netIncome, pIdx, ctx.age) +
        provPension +
        payroll.baseCredit + payroll.ei + payroll.qpip;
      st.provincial = Math.max(0, tax.bracketTax(taxable, prov.brackets, pIdx) - pCredits * pRate);
      st.provincialCredits = pCredits;

      (prov.rules || []).forEach(function (rid) {
        var rule = RP.taxRules.get(rid);
        if (rule) rule.apply(st, ctx, prov);
      });
    }

    st.incomeTax = st.federal + st.provincial;
    st.total = st.incomeTax + clawback;                // income tax + OAS recovery
    st.totalWithPayroll = st.total + payroll.total;
    st.averageRate = gross > 0 ? st.totalWithPayroll / gross : 0;
    return st;
  };

  /** Marginal rate on an extra $ of `field` income (finite difference). */
  tax.marginal = function (inc, ctx, field, delta) {
    field = field || 'other';
    delta = delta || 100;
    var a = tax.compute(inc, ctx).totalWithPayroll;
    var inc2 = Object.assign({}, inc);
    inc2[field] = num(inc2[field]) + delta;
    var b = tax.compute(inc2, ctx).totalWithPayroll;
    return (b - a) / delta;
  };

  /** Resolve the tax data table for a plan (falls back to latest). */
  tax.dataFor = function (yearKey) {
    return RP.taxData[yearKey] || RP.taxData[RP.taxData.latest];
  };

  tax.availableYears = function () {
    return Object.keys(RP.taxData).filter(function (k) { return /^\d{4}$/.test(k); }).sort();
  };
})(globalThis.RP);
