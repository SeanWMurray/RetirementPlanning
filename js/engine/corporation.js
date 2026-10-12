/*
 * corporation.js — Canadian-controlled private corporation (CCPC) tax: pure functions, no DOM.
 *
 * The projection (projection.js) runs one corporation alongside the person's accounts. Each year:
 *   - active business income (after the owner's salary and the employer's CPP) is taxed at the
 *     small-business rate up to the business limit and the general rate above it. The federal limit
 *     shrinks by $5 for every $1 of the previous year's adjusted aggregate investment income (AAII)
 *     over $50,000 (Ontario and New Brunswick don't apply this grind to their provincial limit);
 *   - what's left after tax and any dividends is invested inside the corporation;
 *   - investment income is AAII: interest and foreign income in full, plus the taxable half of
 *     capital gains. It is taxed at the high investment rate, 30⅔% of it is refundable (NERDTOH),
 *     and the other half of each gain goes to the capital dividend account (CDA);
 *   - Canadian portfolio dividends received pay Part IV tax (38⅓%, refundable, to ERDTOH) and add to GRIP;
 *   - dividends paid come out as capital dividends (tax-free, from the CDA) first, then eligible
 *     dividends up to GRIP, then non-eligible dividends. Taxable dividends recover 38⅓% of their amount
 *     from RDTOH: eligible dividends from ERDTOH only, non-eligible from NERDTOH and then ERDTOH.
 *
 * Pools (all in dollars): { cda, grip, erdtoh, nerdtoh }.
 */
(function (RP) {
  'use strict';
  var num = RP.util.num;
  var corp = RP.corp = {};

  /** Federal + provincial rates for a province. */
  corp.rates = function (d, province) {
    var fed = d.corporate;
    var prov = (d.provinces[province] || d.provinces.ON).corporate || { small: 0.03, general: 0.12, businessLimit: 500000 };
    return {
      fed: fed, prov: prov,
      investment: fed.investmentRate + prov.general,          // combined rate on AAII
      smallCombined: fed.small + prov.small, generalCombined: fed.general + prov.general,
      cgInc: d.capitalGainsInclusion == null ? 0.5 : d.capitalGainsInclusion
    };
  };

  /** Business limits after the passive-income grind, from the previous year's AAII. */
  corp.businessLimits = function (rates, prevAAII) {
    var f = rates.fed;
    var cut = Math.max(0, num(prevAAII) - f.passiveThreshold) * f.grindPerDollar;
    var provLimit = rates.prov.businessLimit != null ? rates.prov.businessLimit : f.businessLimit;
    return {
      fed: Math.max(0, f.businessLimit - cut),
      prov: rates.prov.passiveGrind === false ? provLimit : Math.max(0, provLimit - cut)
    };
  };

  /** Tax on active business income. GRIP grows by 72% of the income taxed at the federal general rate. */
  corp.businessTax = function (abi, rates, prevAAII) {
    abi = Math.max(0, num(abi));
    var L = corp.businessLimits(rates, prevAAII);
    var fedSmall = Math.min(abi, L.fed), provSmall = Math.min(abi, L.prov);
    var fedTax = fedSmall * rates.fed.small + (abi - fedSmall) * rates.fed.general;
    var provTax = provSmall * rates.prov.small + (abi - provSmall) * rates.prov.general;
    return {
      income: abi, fedTax: fedTax, provTax: provTax, tax: fedTax + provTax,
      atSmallRate: fedSmall, atGeneralRate: abi - fedSmall, limits: L,
      gripAdd: (abi - fedSmall) * rates.fed.gripRate
    };
  };

  /** Tax on investment income: Part I on AAII (part refundable) and Part IV on portfolio dividends. */
  corp.investmentTax = function (aaii, eligibleReceived, rates) {
    aaii = Math.max(0, num(aaii)); eligibleReceived = Math.max(0, num(eligibleReceived));
    return {
      aaii: aaii, aaiiTax: aaii * rates.investment, nerdtohAdd: aaii * rates.fed.refundableAAII,
      partIV: eligibleReceived * rates.fed.partIV, erdtohAdd: eligibleReceived * rates.fed.partIV,
      gripAdd: eligibleReceived
    };
  };

  /** How a dividend of `amount` is paid: capital (CDA) first, then eligible up to GRIP, then non-eligible. */
  corp.splitDividend = function (amount, pools) {
    amount = Math.max(0, num(amount));
    var capital = Math.min(amount, Math.max(0, num(pools.cda)));
    var eligible = Math.min(amount - capital, Math.max(0, num(pools.grip)));
    return { capital: capital, eligible: eligible, nonEligible: amount - capital - eligible, total: amount };
  };

  /** Dividend refund on taxable dividends paid, given year-end RDTOH balances. */
  corp.dividendRefund = function (split, pools, rates) {
    var r = rates.fed.dividendRefund;
    var e = Math.max(0, num(pools.erdtoh)), n = Math.max(0, num(pools.nerdtoh));
    var fromE = Math.min(e, r * split.eligible);
    var fromN = Math.min(n, r * split.nonEligible);
    var fromE2 = Math.min(e - fromE, r * split.nonEligible - fromN);
    return { fromErdtoh: fromE + fromE2, fromNerdtoh: fromN, total: fromE + fromN + fromE2 };
  };

  /**
   * What the shareholder keeps if the corporation sells everything and pays it all out.
   *   state: { balance, acb, cda, grip, erdtoh, nerdtoh }   (dollars of the extraction year)
   *   opts:  { rates, years (spread the dividends over this many years, default 1),
   *            personalTax(extraIncome) -> tax on that extra income in one year (the caller's baseline is already netted out) }
   * The dividends are split into equal yearly amounts; growth during the spread is ignored.
   */
  corp.windUp = function (state, opts) {
    var rates = opts.rates, years = Math.max(1, Math.round(num(opts.years, 1)));
    var bal = Math.max(0, num(state.balance)), acb = Math.min(bal, Math.max(0, num(state.acb)));
    var gain = Math.max(0, bal - acb);
    var taxable = gain * rates.cgInc;
    var inv = corp.investmentTax(taxable, 0, rates);
    var pools = { cda: num(state.cda) + gain - taxable, grip: num(state.grip), erdtoh: num(state.erdtoh), nerdtoh: num(state.nerdtoh) + inv.nerdtohAdd };
    var cash = bal - inv.aaiiTax;
    // Dividends paid = cash on hand + the refund those dividends trigger (solved by iteration).
    var D = Math.max(0, cash), split = corp.splitDividend(D, pools), ref = corp.dividendRefund(split, pools, rates);
    for (var k = 0; k < 50; k++) {
      var next = Math.max(0, cash + ref.total);
      if (Math.abs(next - D) < 0.01) break;
      D = next; split = corp.splitDividend(D, pools); ref = corp.dividendRefund(split, pools, rates);
    }
    var perYear = opts.personalTax ? opts.personalTax({ dividends: split.eligible / years, dividendsNE: split.nonEligible / years }) : 0;
    var personal = perYear * years;
    return {
      balance: bal, gain: gain, taxableGain: taxable, corpTax: inv.aaiiTax, refund: ref.total,
      capital: split.capital, eligible: split.eligible, nonEligible: split.nonEligible, dividends: D,
      personalTax: personal, net: D - personal, years: years,
      effectiveRate: bal > 0 ? 1 - (D - personal) / bal : 0
    };
  };
})(globalThis.RP);
