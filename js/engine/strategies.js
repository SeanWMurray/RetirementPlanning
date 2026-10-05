/*
 * strategies.js — pluggable savings modes and retirement withdrawal strategies.
 *
 * Savings mode:   target(y, plan, ctx) -> desired annual contribution in $, or null = "save all surplus".
 * Withdrawal:     grossTarget(y, plan, ctx) -> gross $ to withdraw this year, or null = "needs-based"
 *                 (withdraw exactly what is needed to fund spending after tax).
 *
 * `fields` lists plan paths the UI should show when the mode is selected.
 */
(function (RP) {
  'use strict';
  var num = RP.util.num;

  RP.savingsModes = RP.createRegistry('savingsModes');

  RP.savingsModes.register({
    id: 'surplus',
    label: 'Save everything left over',
    description: 'Income − tax − spending is invested each year (spending is the driver).',
    fields: [],
    target: function () { return null; }
  });

  /** Savings rate for year t: starting rate, stepped up (or down) each year, capped at rateMax. */
  RP.savingsModes.rateFor = function (savings, t) {
    var rate = num(savings.rate), step = num(savings.rateStep, 0);
    if (step > 0) {
      var cap = savings.rateMax == null || savings.rateMax === '' ? 1 : num(savings.rateMax);
      return Math.min(rate + step * t, Math.max(rate, cap));
    }
    return Math.max(0, rate + step * t);
  };

  /** Fixed savings amount for year t: grows at amountGrowth, or with inflation when that is blank. */
  RP.savingsModes.amountFor = function (savings, t, cpi) {
    var g = savings.amountGrowth;
    var factor = g == null || g === '' ? cpi : Math.pow(1 + num(g), t);
    return num(savings.amount) * factor;
  };

  RP.savingsModes.register({
    id: 'percentGross',
    label: '% of gross employment income',
    description: 'Contribute a % of salary (so savings rise with your raises). Optionally raise the rate each year up to a maximum. Leftover cash is treated as spent; a deficit is drawn from savings.',
    fields: ['savings.rate', 'savings.rateStep', 'savings.rateMax'],
    target: function (y, plan) { return RP.savingsModes.rateFor(plan.savings, y.t) * y.employment * y.mods.savings; }
  });

  RP.savingsModes.register({
    id: 'fixed',
    label: 'Fixed amount, increasing yearly',
    description: 'Contribute a set amount in the first year, increasing each year by the annual increase (or with inflation if left blank). Leftover cash is treated as spent; a deficit is drawn from savings.',
    fields: ['savings.amount', 'savings.amountGrowth'],
    target: function (y, plan) { return RP.savingsModes.amountFor(plan.savings, y.t, y.cpi) * y.mods.savings; }
  });

  RP.withdrawalStrategies = RP.createRegistry('withdrawalStrategies');

  RP.withdrawalStrategies.register({
    id: 'needs',
    label: 'Spending-based (withdraw what you need)',
    description: 'Each year, withdraw exactly enough (grossed up for tax) to cover spending not met by other income.',
    fields: [],
    grossTarget: function () { return null; }
  });

  RP.withdrawalStrategies.register({
    id: 'fixedReal',
    label: 'Fixed rate on starting balance (4% rule)',
    description: 'Withdraw X% of the portfolio at retirement, then the same amount indexed to inflation. Spending is not guaranteed — shortfalls are flagged, surpluses reinvested.',
    fields: ['retirement.withdrawalRate'],
    grossTarget: function (y, plan, ctx) {
      var s = ctx.state;
      if (s.retirementPortfolio == null) { s.retirementPortfolio = ctx.startTotal; s.retirementCpi = y.cpi; }
      return num(plan.retirement.withdrawalRate) * s.retirementPortfolio * (y.cpi / s.retirementCpi);
    }
  });

  RP.withdrawalStrategies.register({
    id: 'percentBalance',
    label: '% of current balance',
    description: 'Withdraw X% of whatever the portfolio is worth each year. Never depletes, but income varies.',
    fields: ['retirement.withdrawalRate'],
    grossTarget: function (y, plan, ctx) { return num(plan.retirement.withdrawalRate) * ctx.startTotal; }
  });
})(globalThis.RP);
