/*
 * Corporation tab — the CCPC year by year (business and investment tax, refunds, dividends and the
 * CDA/GRIP/ERDTOH/NERDTOH pools) and what you'd keep after all taxes if you extracted it.
 * Shown only when the plan has an account of type 'corp'.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;
  var selectedAge = null;
  var withOtherIncome = true;

  function hasCorp(plan) { return (plan.accounts || []).some(function (a) { return a.type === 'corp'; }); }

  RP.tabs.register({
    id: 'corporation', label: 'Corporation', when: hasCorp,
    render: function (host, args) {
      var store = RP.store;
      var res = store.activeResult().result, plan = res.plan;
      var real = store.doc.settings.realDollars;
      var years = res.years.filter(function (y) { return y.corp; });
      if (!years.length) { host.appendChild(h('div.empty', 'Add a corporation under Plan Inputs › Corporation.')); return; }
      if (args && args.age != null) selectedAge = args.age;
      if (selectedAge == null || !years.some(function (y) { return y.age === selectedAge; })) {
        var ret = years.filter(function (y) { return y.retired; })[0];
        selectedAge = (ret || years[years.length - 1]).age;
      }
      function F(y) { return real ? y.cpi : 1; }        // flows: start-of-year prices
      function B(y) { return real ? y.cpiEnd : 1; }     // balances: year-end prices
      var last = years[years.length - 1];
      var lifeCorpTax = 0, lifeDivs = 0;
      years.forEach(function (y) { lifeCorpTax += y.corp.tax / F(y); lifeDivs += (y.corp.dividendsPaid.capital + y.corp.dividendsPaid.eligible + y.corp.dividendsPaid.nonEligible) / F(y); });
      var basis = real ? "today's dollars" : 'future dollars';

      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Corporation'), h('p.card-sub', 'Totals in ' + basis + '. After-tax figures assume the corporation sells its investments and pays everything out over ' +
          last.corp.windUp.years + ' year' + (last.corp.windUp.years > 1 ? 's' : '') + ' (Plan Inputs › Corporation).'))),
        h('div.kpis.kpis-inline',
          kpi('Investments at ' + last.age, fmt.money(last.corp.balance / B(last)), 'held in the corporation'),
          kpi('After tax if extracted at ' + last.age, fmt.money(last.corp.windUp.net / B(last)), fmt.pct(last.corp.windUp.effectiveRate, 1) + ' total tax on extraction'),
          kpi('Corporate tax, lifetime', fmt.money(lifeCorpTax), 'net of dividend refunds'),
          kpi('Dividends paid to you', fmt.money(lifeDivs), 'capital, eligible and non-eligible'))));

      var c1 = h('canvas', { role: 'img', 'aria-label': 'Corporation value chart' });
      var c2 = h('canvas', { role: 'img', 'aria-label': 'Dividends and corporate tax chart' });
      var pick = function (age) { selectedAge = age; RP.app.renderTab(); };
      host.appendChild(h('div.two-col',
        h('section.card', h('div.card-head', h('div', h('h3', 'Value: before and after extraction tax'), h('p.card-sub', 'Click a year to see the extraction breakdown'))), h('div.chart-box', c1)),
        h('section.card', h('div.card-head', h('div', h('h3', 'Dividends to you and corporate tax'), h('p.card-sub', 'Capital dividends first, then eligible up to GRIP, then non-eligible'))), h('div.chart-box', c2))));
      RP.charts.corpValue(c1, { result: res, real: real, onClickAge: pick });
      RP.charts.corpFlows(c2, { result: res, real: real, onClickAge: pick });

      host.appendChild(extraction(years, plan, F, B, real));
      host.appendChild(yearTable(years, F, B, basis));
    }
  });

  function kpi(label, value, sub) {
    return h('div.kpi', h('div.kpi-label', label), h('div.kpi-value', value), h('div.kpi-sub', sub));
  }

  /** "If you extracted everything at age X": the full waterfall from corporate assets to cash in hand. */
  function extraction(years, plan, F, B, real) {
    var y = years.filter(function (r) { return r.age === selectedAge; })[0];
    var c = y.corp;
    var owner = (plan.accounts.filter(function (a) { return a.type === 'corp'; })[0] || {}).owner === 'spouse' && y.taxPeople ? 1 : 0;
    var person = y.taxPeople ? y.taxPeople[owner] : { inputs: y.taxInputs, ctx: y.taxCtx };
    var spread = RP.util.num(plan.corporation && plan.corporation.windUpYears, 5);
    var rates = RP.corp.rates(RP.tax.dataFor(plan.tax.year), plan.profile.province);
    var wu = RP.corp.windUp({ balance: c.balance, acb: c.acb, cda: c.cda, grip: c.grip, erdtoh: c.erdtoh, nerdtoh: c.nerdtoh },
      { rates: rates, years: spread, personalTax: RP.engine.extraTax(withOtherIncome ? person.inputs : {}, person.ctx) });
    var k = B(y);
    function row(label, v, opts) {
      opts = opts || {};
      return h('tr' + (opts.total ? '.total' : '') + (opts.sub ? '.sub' : ''), h('td.left', label), h('td', fmt.money(v / k)), h('td', real ? fmt.money(v) : fmt.money(v / y.cpiEnd)));
    }
    var ageSel = ui.input({ type: 'select', label: 'Extract at age', options: years.map(function (r) { return { value: r.age, label: 'End of age ' + r.age + ' (' + r.year + ')' }; }) },
      selectedAge, function (v) { selectedAge = Number(v); RP.app.renderTab(); });
    var yearsIn = ui.input({ type: 'number', label: 'Spread over years', min: 1, max: 30, integer: true }, spread, function (v) {
      RP.store.set('corporation.windUpYears', Math.max(1, Math.min(30, Math.round(RP.util.num(v, 1)))));
    });
    var otherTgl = h('label.check', h('input', { type: 'checkbox', checked: withOtherIncome, onchange: function (e) { withOtherIncome = e.target.checked; RP.app.renderTab(); } }),
      h('span', 'On top of that year’s other income'));
    var colA = real ? "Today's $" : 'Future $', colB = real ? 'Future $' : "Today's $";
    return h('section.card',
      h('div.card-head', h('div', h('h3', 'What you’d keep if you extracted it all'),
        h('p.card-sub', 'The corporation sells everything, pays tax on the gains, recovers its refundable tax by paying dividends, and you pay personal tax on them.')),
        h('div.btn-row', ageSel, h('label.inline-field', h('span.muted', 'Years'), yearsIn), otherTgl)),
      h('div.two-col.tight',
        h('table.grid.compact.statement',
          h('thead', h('tr', h('th.left', ''), h('th', colA), h('th', colB))),
          h('tbody',
            row('Investments at market value', wu.balance),
            row('   unrealized gain (half taxable in the corporation, half to CDA)', wu.gain, { sub: true }),
            row('Corporate tax on the taxable half of the gain', -wu.corpTax),
            row('Dividend refund recovered (ERDTOH / NERDTOH)', wu.refund),
            row('Dividends paid to you', wu.dividends, { total: true }),
            row('   capital dividends (tax-free, from CDA)', wu.capital, { sub: true }),
            row('   eligible dividends (up to GRIP)', wu.eligible, { sub: true }),
            row('   non-eligible dividends', wu.nonEligible, { sub: true }),
            row('Personal tax on the dividends' + (wu.years > 1 ? ' (' + wu.years + ' years)' : ''), -wu.personalTax),
            row('In your hands after all taxes', wu.net, { total: true }))),
        h('div',
          h('table.grid.compact.statement', h('tbody',
            h('tr', h('td.left', 'Total tax on extraction'), h('td', fmt.pct(wu.effectiveRate, 1) + ' of the investments')),
            h('tr', h('td.left', 'Pools before extraction'), h('td', '')),
            h('tr.sub', h('td.left', '   CDA'), h('td', fmt.money(c.cda / k))),
            h('tr.sub', h('td.left', '   GRIP'), h('td', fmt.money(c.grip / k))),
            h('tr.sub', h('td.left', '   ERDTOH'), h('td', fmt.money(c.erdtoh / k))),
            h('tr.sub', h('td.left', '   NERDTOH'), h('td', fmt.money(c.nerdtoh / k))),
            h('tr.sub', h('td.left', '   Adjusted cost base'), h('td', fmt.money(c.acb / k))))),
          h('p.note', 'Dividends are split evenly over the years chosen' + (withOtherIncome ? ', each taxed on top of your other income in ' + y.year : ', with no other income') +
            ', at ' + y.year + ' tax rates; growth during the payout is ignored. Capital dividends need a CDA election (T2054) before they are paid. Not modelled: safe income and section 55, TOSI, AMT, or using the corporation to buy a life insurance policy or an IPP.'))));
  }

  /** Year-by-year corporation table. */
  function yearTable(years, F, B, basis) {
    var cols = [
      ['Age', function (y) { return y.age; }, null],
      ['Business income', function (y) { return y.corp.revenue; }, 'f'],
      ['Salary + employer CPP', function (y) { return y.corp.salary + y.corp.employerCpp; }, 'f'],
      ['Business tax', function (y) { return y.corp.businessTax; }, 'f'],
      ['Invested', function (y) { return y.corp.invested; }, 'f'],
      ['Investment income (AAII)', function (y) { return y.corp.aaii; }, 'f'],
      ['Investment tax + Part IV', function (y) { return y.corp.investmentTax + y.corp.partIV; }, 'f'],
      ['Dividend refund', function (y) { return y.corp.refund; }, 'f'],
      ['Corporate tax (net)', function (y) { return y.corp.tax; }, 'f'],
      ['Capital div.', function (y) { return y.corp.dividendsPaid.capital; }, 'f'],
      ['Eligible div.', function (y) { return y.corp.dividendsPaid.eligible; }, 'f'],
      ['Non-eligible div.', function (y) { return y.corp.dividendsPaid.nonEligible; }, 'f'],
      ['Investments', function (y) { return y.corp.balance; }, 'b'],
      ['CDA', function (y) { return y.corp.cda; }, 'b'],
      ['GRIP', function (y) { return y.corp.grip; }, 'b'],
      ['ERDTOH', function (y) { return y.corp.erdtoh; }, 'b'],
      ['NERDTOH', function (y) { return y.corp.nerdtoh; }, 'b'],
      ['After tax if extracted', function (y) { return y.corp.windUp.net; }, 'b']
    ];
    return h('section.card',
      h('div.card-head', h('div', h('h3', 'Year by year'), h('p.card-sub', basis + '. Flows are for the year; investments and pools are at year end. Click a row for its extraction breakdown.'))),
      h('div.table-wrap', h('table.grid',
        h('thead', h('tr', cols.map(function (c, i) { return h('th' + (i === 0 ? '.sticky' : ''), c[0]); }))),
        h('tbody', years.map(function (y) {
          return h('tr' + (y.age === selectedAge ? '.selected' : '') + (y.retired ? '.retired' : ''), { onclick: function () { selectedAge = y.age; RP.app.renderTab(); } },
            cols.map(function (c, i) {
              var v = c[1](y);
              return h('td' + (i === 0 ? '.sticky' : ''), c[2] ? fmt.money(v / (c[2] === 'f' ? F(y) : B(y))) : String(v));
            }));
        })))));
  }
})(globalThis.RP);
