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

  RP.savingsModes.register({
    id: 'percentGross',
    label: '% of gross employment income',
    description: 'Contribute a fixed % of salary. Anything left over after spending is treated as spent (not invested); a deficit is drawn from savings.',
    fields: ['savings.rate'],
    target: function (y, plan) { return num(plan.savings.rate) * y.employment * y.mods.savings; }
  });

  RP.savingsModes.register({
    id: 'fixed',
    label: "Fixed amount (today's $)",
    description: 'Contribute a fixed inflation-indexed amount each working year. Leftover cash is treated as spent; a deficit is drawn from savings.',
    fields: ['savings.amount'],
    target: function (y, plan) { return num(plan.savings.amount) * y.cpi * y.mods.savings; }
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
