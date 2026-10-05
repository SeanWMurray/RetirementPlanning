/*
 * About / Methodology tab — plan notes, how the numbers are calculated, disclaimers.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h;

  RP.tabs.register({
    id: 'about', label: 'Notes & method',
    render: function (host) {
      var store = RP.store;
      var notes = ui.input({ type: 'textarea', label: 'Plan notes', rows: 5, placeholder: 'Assumptions, sources, things to revisit…' }, store.doc.meta.notes, function (v) {
        store.update(function (d) { d.meta.notes = v; }, false);
      });
      host.appendChild(h('section.card', h('div.card-head', h('h3', 'Plan notes')), notes,
        h('p.note', 'Saved with the plan and included in exports.')));

      host.appendChild(h('section.card.prose', h('div.card-head', h('h3', 'How the projection works')),
        h('ol',
          h('li', h('b', 'Timeline. '), 'One row per year of age, from your current age to the plan-to age. All inputs are entered in today’s dollars and inflate each year unless marked otherwise.'),
          h('li', h('b', 'Income. '), 'Salary grows at your raise rate until retirement. CPP is adjusted for the start age (−0.6%/month early, +0.7%/month late). OAS is adjusted for deferral (+0.6%/month), residency, and gets the 10% increase at 75. Income events are added on top.'),
          h('li', h('b', 'Spending. '), 'Base spending (single total, or the sum of itemised lines active that year) × inflation × any adjustment events, plus the change at retirement. Expense events are added on top.'),
          h('li', h('b', 'Tax. '), 'Federal and provincial tax are calculated on the year’s taxable income, including RRSP deductions, RRSP/RRIF withdrawals and taxable capital gains on non-registered withdrawals. Because contributions and withdrawals change the tax owed, the engine solves iteratively until the cash flow balances.'),
          h('li', h('b', 'Working years. '), 'In "save everything left over" mode, income − tax − spending is invested (RRSP refunds get reinvested too). In % or fixed modes, the target is contributed and leftover cash is treated as spent. Any deficit is withdrawn from savings.'),
          h('li', h('b', 'Retirement. '), 'RRIF minimums are taken first (age 72+). Then the selected strategy decides withdrawals; the spending-based strategy grosses up withdrawals for tax. Surpluses are reinvested in non-RRSP accounts.'),
          h('li', h('b', 'Growth. '), 'Withdrawals come out at the start of the year; contributions go in mid-year. Each account grows at its own return or the plan default. Non-registered growth is treated as deferred capital gains (taxed at 50% inclusion on withdrawal, using tracked cost base). Cash interest is taxed each year.'),
          h('li', h('b', 'Today’s dollars. '), 'With "Today’s $" on, flows are divided by the inflation index for that year and balances by the year-end index.'))));

      host.appendChild(h('section.card.prose', h('div.card-head', h('h3', 'Limitations')),
        h('ul',
          h('li', 'Single person. Spousal planning (pension splitting, survivor benefits, spousal RRSPs) is not modelled yet.'),
          h('li', 'RRSP/TFSA room is tracked, but RRSP room uses employment income only (no pension adjustment for workplace pension members) and the RRSP maximum is indexed with inflation. No Home Buyers’ Plan, LIRA unlocking rules or annuity products.'),
          h('li', 'Non-registered income is simplified (no dividends or annual distributions). Use a lower return or a flat tax rate if you want to approximate tax drag.'),
          h('li', 'CPP is indexed with inflation from today rather than modelled from your contribution history. Use your Service Canada estimate for the amount at 65.'),
          h('li', 'Some 2026 credit amounts are estimates; see the Tax tab for which ones to verify.'))),
        h('section.card.prose', h('div.card-head', h('h3', 'Privacy & saving')),
          h('p', 'Everything runs in your browser. Your plan is saved automatically in this browser’s local storage and is never sent anywhere. Use ', h('b', 'Export'), ' to save a .json file you can keep, email or re-import later (on any computer).')),
        h('section.card.prose', h('div.card-head', h('h3', 'Disclaimer')),
          h('p', 'This tool is for education and personal planning. It is not financial, tax or legal advice. Projections are estimates based on your assumptions and simplified rules, and real outcomes will differ.')));
    }
  });
})(globalThis.RP);
