/*
 * Tax tab — full breakdown for any year, taxes over time, and the bracket data in use.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;
  var selectedAge = null;

  function line(label, v, opts) {
    opts = opts || {};
    return h('tr' + (opts.total ? '.total' : '') + (opts.sub ? '.sub' : ''), h('td.left', label), h('td', opts.pct ? fmt.pct(v) : fmt.money(v)));
  }

  RP.tabs.register({
    id: 'tax', label: 'Tax',
    render: function (host, args) {
      var store = RP.store;
      var res = store.activeResult().result;
      var plan = res.plan;
      if (args && args.age != null) selectedAge = args.age;
      if (selectedAge == null || !res.years.some(function (y) { return y.age === selectedAge; })) selectedAge = res.years[0].age;
      var y = res.years.filter(function (r) { return r.age === selectedAge; })[0];
      var d = y.taxDetail, inp = y.taxInputs;
      var marginal = RP.tax.marginal(inp, y.taxCtx, 'other');

      var ageSel = ui.input({ type: 'select', label: 'Age', options: res.years.map(function (r) { return { value: r.age, label: 'Age ' + r.age + ' (' + r.year + ')' }; }) },
        selectedAge, function (v) { selectedAge = Number(v); RP.app.renderTab(); });

      var rows = [
        line('Employment income', inp.employment),
        inp.cpp ? line('CPP / QPP', inp.cpp) : null,
        inp.oas ? line('OAS', inp.oas) : null,
        inp.pension ? line('Pension income (events)', inp.pension) : null,
        inp.other ? line('Other taxable income (events, interest)', inp.other) : null,
        inp.rrif ? line('RRSP / RRIF withdrawals', inp.rrif) : null,
        inp.capitalGains ? line('Taxable capital gains', inp.capitalGains) : null,
        line('Total income', d.grossIncome, { total: true }),
        inp.rrspDeduction ? line('RRSP deduction', -inp.rrspDeduction, { sub: true }) : null,
        d.payroll.deduction ? line('CPP enhanced deduction', -d.payroll.deduction, { sub: true }) : null,
        line('Net income', d.netIncome, { total: true }),
        d.oasClawback ? line('OAS repayment deduction', -d.oasClawback, { sub: true }) : null,
        line('Taxable income', d.taxableIncome, { total: true }),
        line('Federal tax', d.federal),
        line('Provincial tax', d.provincial),
        d.lines.map(function (l) { return line('   incl. ' + l.label, l.amount, { sub: true }); }),
        d.oasClawback ? line('OAS clawback', d.oasClawback) : null,
        d.payroll.total ? line('CPP / QPP contributions', d.payroll.cpp + d.payroll.cpp2) : null,
        d.payroll.ei ? line('EI premiums', d.payroll.ei) : null,
        d.payroll.qpip ? line('QPIP premiums', d.payroll.qpip) : null,
        line('Total tax & contributions', d.totalWithPayroll, { total: true }),
        line('Average rate (of total income)', d.averageRate, { pct: true }),
        line('Marginal rate (next $ of ordinary income)', marginal, { pct: true })
      ];

      var canvas = h('canvas', { role: 'img', 'aria-label': 'Tax by year chart' });
      host.appendChild(h('div.two-col',
        h('section.card',
          h('div.card-head', h('div', h('h3', 'Tax detail'), h('p.card-sub', plan.tax.mode === 'calculated' ? (RP.tax.dataFor(plan.tax.year).provinces[plan.profile.province].name + ' · ' + plan.tax.year + ' tables indexed to ' + y.year) : 'Override: ' + plan.tax.mode)),
            ageSel),
          h('table.grid.statement', h('tbody', rows)),
          plan.tax.mode === 'calculated' ? h('p.note', 'Credits claimed: federal ' + fmt.money(d.federalCredits) + ', provincial ' + fmt.money(d.provincialCredits) + ' (credit base before applying the lowest rate). Nominal dollars.') : null),
        h('section.card',
          h('div.card-head', h('div', h('h3', 'Tax by year'), h('p.card-sub', 'Click a bar to inspect that year'))),
          h('div.chart-box', canvas))));
      RP.charts.taxes(canvas, { result: res, real: store.doc.settings.realDollars, onClickAge: function (age) { selectedAge = age; RP.app.renderTab(); } });

      // Bracket data
      var data = RP.tax.dataFor(plan.tax.year);
      var prov = data.provinces[plan.profile.province];
      function bracketTable(title, brackets) {
        var lower = 0;
        return h('div', h('h4', title), h('table.grid.compact', h('thead', h('tr', h('th.left', 'Taxable income'), h('th', 'Rate'))),
          h('tbody', brackets.map(function (b) {
            var txt = b.upTo == null ? 'Over ' + fmt.money(lower) : fmt.money(lower) + ' – ' + fmt.money(b.upTo);
            lower = b.upTo;
            return h('tr', h('td.left', txt), h('td', fmt.pct(b.rate, 2)));
          }))));
      }
      var verify = [];
      if (data.federal.age.verify) verify.push('federal age amount');
      if (data.federal.canadaEmployment.verify) verify.push('Canada employment amount');
      if (data.oas.verify) verify.push('OAS amounts and clawback threshold');
      if (prov.age && prov.age.verify) verify.push(prov.name + ' age amount');
      if (prov.pension && prov.pension.verify) verify.push(prov.name + ' pension amount');
      if (prov.verify) verify.push(prov.name + ' upper brackets');
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Tax tables in use — ' + data.label), h('p.card-sub', data.sourceNote))),
        h('div.two-col.tight', bracketTable('Federal', data.federal.brackets), bracketTable(prov.name, prov.brackets)),
        h('p.note', 'Basic personal amount: federal ' + fmt.money(data.federal.bpa.max) + ', ' + prov.name + ' ' + fmt.money(prov.bpa.max) +
          '. Future years index these by the plan’s inflation rate' + (prov.indexed === false ? ' (' + prov.name + ' brackets are frozen)' : '') + '.'),
        verify.length ? h('div.callout', ui.icon('info'), h('span', 'Estimated values to verify: ' + verify.join(', ') + '. To correct them, edit js/data/tax-' + data.year + '.js.')) : null,
        h('p.note', 'Not modelled: pension income splitting, dividend tax credit, provincial low-income reductions (e.g. Ontario Tax Reduction), refundable credits, AMT and capital losses. Use a flat or custom rate if you need to approximate these.')));
    }
  });
})(globalThis.RP);
