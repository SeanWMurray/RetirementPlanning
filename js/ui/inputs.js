/*
 * inputs.js — the left-hand input panel.
 *
 * Each collapsible section is registered in RP.inputSections:
 *   { id, title, summary(plan) -> short text shown when collapsed, render(plan) -> Node, advanced?: bool }
 * Add a section by registering one more entry.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, U = RP.util, fmt = RP.fmt, num = U.num;
  var sections = RP.inputSections = RP.createRegistry('inputSections');
  var store = function () { return RP.store; };

  function note(text) { return h('p.note', text); }

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'profile', title: 'Profile',
    summary: function (p) { return 'Age ' + p.profile.currentAge + ' → retire ' + p.profile.retirementAge + ' → plan to ' + p.profile.endAge + ' · ' + p.profile.province; },
    render: function () {
      return ui.fields([
        { path: 'profile.currentAge', label: 'Current age', type: 'age', min: 16, max: 100 },
        { path: 'profile.retirementAge', label: 'Retirement age', type: 'age', min: 16, max: 110 },
        { path: 'profile.endAge', label: 'Plan to age', type: 'age', min: 50, max: 115, help: 'Life expectancy for planning. Many planners use 95.' },
        { path: 'profile.startYear', label: 'Start year', type: 'number', integer: true, min: 2000, max: 2100 },
        { path: 'profile.province', label: 'Province / territory', type: 'select', options: ui.PROVINCES, wide: true }
      ]);
    }
  });

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'income', title: 'Employment income',
    summary: function (p) { return fmt.money(p.income.salary) + '/yr · +' + fmt.pct(p.income.growth) + '/yr'; },
    render: function () {
      return h('div', ui.fields([
        { path: 'income.salary', label: 'Gross salary (before tax)', type: 'money', min: 0 },
        { path: 'income.growth', label: 'Annual raise (nominal)', type: 'percent', help: 'Includes inflation. 3% with 2% inflation ≈ 1% real raise.' }
      ]), note('Salary stops at retirement. Use events for part-time work, bonuses, sabbaticals, or a pension.'));
    }
  });

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'spending', title: 'Spending',
    summary: function (p) {
      var total = p.spending.mode === 'itemized'
        ? U.sum(p.spending.items.filter(function (i) { return i.enabled !== false && i.phase !== 'retired'; }), function (i) { return num(i.amount); })
        : num(p.spending.total);
      return fmt.money(total) + '/yr' + (p.spending.mode === 'itemized' ? ' (itemized)' : '') +
        (num(p.spending.retirementChange) ? ' · ' + (p.spending.retirementChange > 0 ? '+' : '') + fmt.pct(p.spending.retirementChange, 0) + ' in retirement' : '');
    },
    render: function (p) {
      var wrap = h('div');
      wrap.appendChild(ui.segmented('spending.mode', [{ value: 'total', label: 'Single total' }, { value: 'itemized', label: 'Itemized' }], 'Enter spending as'));
      if (p.spending.mode === 'itemized') wrap.appendChild(itemsEditor(p));
      else wrap.appendChild(ui.fields([{ path: 'spending.total', label: "Annual spending (today's $)", type: 'money', min: 0, wide: true }]));
      wrap.appendChild(ui.fields([
        { path: 'spending.retirementChange', label: 'Change at retirement', type: 'percent', wide: true,
          help: 'Applied to base spending from retirement on. E.g. −20% if the mortgage is paid off and work costs end.' }
      ]));
      wrap.appendChild(note("All amounts are in today's dollars and grow with inflation. Add one-off or temporary costs as events (click any row in the table)."));
      return wrap;
    }
  });

  function itemsEditor(p) {
    var items = p.spending.items || [];
    var PHASES = [{ value: 'all', label: 'Always' }, { value: 'working', label: 'Working' }, { value: 'retired', label: 'Retired' }];
    var total = { working: 0, retired: 0 };
    items.forEach(function (it) {
      if (it.enabled === false) return;
      if (it.phase !== 'retired') total.working += num(it.amount);
      if (it.phase !== 'working') total.retired += num(it.amount);
    });
    var table = h('div.items',
      h('div.items-head', h('span', 'Item'), h('span', 'Annual $'), h('span', 'When'), h('span')),
      items.map(function (it, i) {
        var base = 'spending.items.' + i + '.';
        return h('div.items-row',
          ui.input({ type: 'text', label: 'Item name' }, it.name, function (v) { store().set(base + 'name', v); }),
          ui.input({ type: 'money', label: 'Amount' }, it.amount, function (v) { store().set(base + 'amount', v); }),
          ui.input({ type: 'select', label: 'When', options: PHASES }, it.phase || 'all', function (v) { store().set(base + 'phase', v); }),
          ui.button(null, function () {
            var arr = U.clone(store().get('spending.items')); arr.splice(i, 1);
            store().set('spending.items', arr, { structural: true });
          }, { icon: 'trash', cls: 'ghost icon-only', aria: 'Remove item' }));
      }),
      h('div.items-foot',
        ui.button('Add item', function () {
          var arr = U.clone(store().get('spending.items') || []);
          arr.push({ id: U.uid('sp'), name: 'New item', amount: 1000, phase: 'all', indexed: true });
          store().set('spending.items', arr, { structural: true });
        }, { icon: 'plus', cls: 'ghost small' }),
        h('span.items-total', 'Working ', h('b', fmt.money(total.working)), ' · Retired ', h('b', fmt.money(total.retired)))));
    var row = h('div.field.field-wide', { dataset: { path: 'spending.items' } }, h('label.field-label', h('span', 'Spending items'),
      h('button.override-reset', { type: 'button', title: 'Revert to base plan', onclick: function () { store().resetOverride('spending.items'); } }, ui.icon('reset', 12))), table);
    if (store().isOverridden('spending.items')) row.classList.add('overridden');
    return row;
  }

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'accounts', title: 'Accounts & balances',
    summary: function (p) { return fmt.money(U.sum(p.accounts, function (a) { return num(a.balance); })) + ' across ' + p.accounts.length + ' accounts'; },
    render: function (p) {
      var wrap = h('div.accounts');
      p.accounts.forEach(function (a, i) {
        var base = 'accounts.' + i + '.';
        var defs = [
          { path: base + 'name', label: 'Name', type: 'text' },
          { path: base + 'type', label: 'Type', type: 'select', options: RP.schema.ACCOUNT_TYPES },
          { path: base + 'balance', label: 'Current balance', type: 'money', min: 0 },
          { path: base + 'contributionCap', label: "Annual contribution cap (today's $)", type: 'money', nullable: true, placeholder: 'no cap', help: 'Leave blank for no cap. RRSP: 18% of income to the annual maximum. TFSA: $7,000/yr plus unused room.' },
          a.type === 'nonreg' ? { path: base + 'costBase', label: 'Adjusted cost base', type: 'money', min: 0, help: 'Used to work out the taxable capital gain on withdrawals.' } : null,
          { path: base + 'returnRate', label: 'Return override', type: 'percent', nullable: true, placeholder: 'plan default', help: 'Leave blank to use the plan’s return assumptions.' }
        ];
        wrap.appendChild(h('div.account-card',
          h('div.account-head', h('span.badge.badge-' + a.type, a.type.toUpperCase()), h('b', a.name),
            ui.button(null, function () {
              ui.confirm('Remove account', 'Remove "' + a.name + '"? Its balance will be dropped from the plan.', function () {
                var arr = U.clone(store().get('accounts')); arr.splice(i, 1);
                store().set('accounts', arr, { structural: true });
              }, 'Remove');
            }, { icon: 'trash', cls: 'ghost icon-only', aria: 'Remove account' })),
          ui.fields(defs)));
      });
      wrap.appendChild(ui.button('Add account', function () {
        var arr = U.clone(store().get('accounts'));
        arr.push({ id: U.uid('acct'), name: 'New account', type: 'tfsa', balance: 0, contributionCap: null, returnRate: null });
        store().set('accounts', arr, { structural: true });
      }, { icon: 'plus', cls: 'ghost small' }));
      return wrap;
    }
  });

  /** Re-orderable list of account ids bound to a path. */
  function orderList(path, label, help) {
    var p = store().effective();
    var ids = (U.getPath(p, path) || []).filter(function (id) { return p.accounts.some(function (a) { return a.id === id; }); });
    p.accounts.forEach(function (a) { if (ids.indexOf(a.id) < 0) ids.push(a.id); });
    function move(i, d) {
      var arr = ids.slice(), j = i + d;
      if (j < 0 || j >= arr.length) return;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      store().set(path, arr, { structural: true });
    }
    var row = h('div.field.field-wide', { dataset: { path: path } },
      h('label.field-label', h('span', label), h('button.override-reset', { type: 'button', title: 'Revert to base plan', onclick: function () { store().resetOverride(path); } }, ui.icon('reset', 12)),
        help ? h('span.help', { tabindex: 0, 'data-tip': help }, ui.icon('info', 12)) : null),
      h('ol.order-list', ids.map(function (id, i) {
        var a = p.accounts.filter(function (x) { return x.id === id; })[0];
        return h('li', h('span.order-n', String(i + 1)), h('span.badge.badge-' + a.type, a.type.toUpperCase()), h('span.order-name', a.name),
          ui.button(null, function () { move(i, -1); }, { icon: 'up', cls: 'ghost icon-only tiny', aria: 'Move up', disabled: i === 0 }),
          ui.button(null, function () { move(i, 1); }, { icon: 'down', cls: 'ghost icon-only tiny', aria: 'Move down', disabled: i === ids.length - 1 }));
      })));
    if (store().isOverridden(path)) row.classList.add('overridden');
    return row;
  }

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'savings', title: 'Savings',
    summary: function (p) {
      var m = RP.savingsModes.get(p.savings.mode);
      if (p.savings.mode === 'percentGross') return fmt.pct(p.savings.rate) + ' of salary';
      if (p.savings.mode === 'fixed') return fmt.money(p.savings.amount) + '/yr';
      return m ? m.label : '';
    },
    render: function (p) {
      var mode = RP.savingsModes.get(p.savings.mode) || RP.savingsModes.list()[0];
      var defs = { 'savings.rate': { path: 'savings.rate', label: 'Savings rate (% of gross)', type: 'percent' },
                   'savings.amount': { path: 'savings.amount', label: "Annual savings (today's $)", type: 'money' } };
      return h('div',
        ui.fields([{ path: 'savings.mode', label: 'How much do you save?', type: 'select', wide: true,
          options: RP.savingsModes.list().map(function (m) { return { value: m.id, label: m.label }; }) }]),
        note(mode.description),
        ui.fields(mode.fields.map(function (f) { return defs[f]; })),
        orderList('savings.order', 'Contribution order', 'Savings fill accounts top to bottom, up to each account’s annual cap. The last account takes any overflow.'));
    }
  });

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'assumptions', title: 'Returns & inflation',
    summary: function (p) { var a = p.assumptions; return fmt.pct(a.returnPre) + ' / ' + fmt.pct(a.returnPost) + ' returns · ' + fmt.pct(a.inflation) + ' inflation'; },
    render: function () {
      return h('div', ui.fields([
        { path: 'assumptions.returnPre', label: 'Return before retirement', type: 'percent', help: 'Expected annual compound return (nominal, after fees).' },
        { path: 'assumptions.returnPost', label: 'Return in retirement', type: 'percent', help: 'Often lower, reflecting a more conservative mix.' },
        { path: 'assumptions.inflation', label: 'Inflation', type: 'percent', help: 'Bank of Canada target is 2%. Also indexes tax brackets, CPP and OAS.' },
        { path: 'assumptions.cashReturn', label: 'Cash / HISA interest', type: 'percent' },
        { path: 'assumptions.volatility', label: 'Volatility (std dev)', type: 'percent', help: 'Only used by the Monte Carlo simulation. A balanced portfolio is roughly 8–12%.' }
      ]));
    }
  });

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'benefits', title: 'CPP & OAS',
    summary: function (p) {
      var b = p.benefits, parts = [];
      if (b.cppEnabled) parts.push('CPP ' + fmt.money(b.cppAt65) + ' @' + b.cppStartAge);
      if (b.oasEnabled) parts.push('OAS @' + b.oasStartAge);
      return parts.join(' · ') || 'Not included';
    },
    render: function (p) {
      var b = p.benefits;
      return h('div',
        ui.fields([
          { path: 'benefits.cppEnabled', label: 'Include CPP / QPP', type: 'toggle', wide: true },
          b.cppEnabled ? { path: 'benefits.cppAt65', label: "CPP at 65 (annual, today's $)", type: 'money', help: 'From your My Service Canada statement. 2026 maximum is about $18,100/yr; the average new pension is far lower.' } : null,
          b.cppEnabled ? { path: 'benefits.cppStartAge', label: 'CPP start age', type: 'age', min: 60, max: 70, help: '−0.6% per month before 65, +0.7% per month after (up to 70).' } : null,
          { path: 'benefits.oasEnabled', label: 'Include OAS', type: 'toggle', wide: true },
          b.oasEnabled ? { path: 'benefits.oasStartAge', label: 'OAS start age', type: 'age', min: 65, max: 70, help: '+0.6% per month deferred past 65 (up to 70). Includes the 10% boost at 75 and the clawback.' } : null,
          b.oasEnabled ? { path: 'benefits.oasResidency', label: 'OAS residency fraction', type: 'percent', min: 0, max: 1, help: 'Years in Canada after 18, divided by 40 (max 100%).' } : null
        ]));
    }
  });

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'retirement', title: 'Retirement drawdown',
    summary: function (p) {
      var s = RP.withdrawalStrategies.get(p.retirement.strategy);
      return s ? s.label.replace(/ \(.*\)$/, '') + (s.fields.length ? ' ' + fmt.pct(p.retirement.withdrawalRate) : '') : '';
    },
    render: function (p) {
      var strat = RP.withdrawalStrategies.get(p.retirement.strategy) || RP.withdrawalStrategies.list()[0];
      return h('div',
        ui.fields([{ path: 'retirement.strategy', label: 'Withdrawal strategy', type: 'select', wide: true,
          options: RP.withdrawalStrategies.list().map(function (s) { return { value: s.id, label: s.label }; }) }]),
        note(strat.description),
        strat.fields.indexOf('retirement.withdrawalRate') >= 0 ? ui.fields([{ path: 'retirement.withdrawalRate', label: 'Withdrawal rate', type: 'percent' }]) : null,
        ui.fields([{ path: 'retirement.rrifMinimums', label: 'Convert RRSP to RRIF (minimum withdrawals from 72)', type: 'toggle', wide: true }]),
        orderList('retirement.withdrawalOrder', 'Withdrawal order', 'Accounts are drawn top to bottom when you need money. RRIF minimums are always taken first.'));
    }
  });

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'tax', title: 'Income tax',
    summary: function (p) {
      var t = p.tax;
      if (t.mode === 'flat') return 'Flat ' + fmt.pct(t.flatRate);
      if (t.mode === 'custom') return 'Custom brackets';
      return 'Calculated · ' + t.year + ' tables';
    },
    render: function (p) {
      var t = p.tax;
      var wrap = h('div');
      wrap.appendChild(ui.segmented('tax.mode', [
        { value: 'calculated', label: 'Calculated' }, { value: 'flat', label: 'Flat rate' }, { value: 'custom', label: 'Custom brackets' }
      ], 'Tax method'));
      if (t.mode === 'calculated') {
        wrap.appendChild(ui.fields([
          { path: 'tax.year', label: 'Tax table year', type: 'select', options: RP.tax.availableYears().map(function (y) { return { value: y, label: y }; }) }
        ]));
        wrap.appendChild(note('Federal + provincial brackets, basic personal, age, pension and Canada employment amounts, CPP/EI credits, Ontario surtax and health premium, and the Quebec abatement.'));
      } else if (t.mode === 'flat') {
        wrap.appendChild(ui.fields([{ path: 'tax.flatRate', label: 'Effective tax rate', type: 'percent', help: 'Applied to taxable income (after RRSP deductions).' }]));
      } else {
        wrap.appendChild(bracketEditor(p));
      }
      wrap.appendChild(ui.fields([
        { path: 'tax.indexBrackets', label: 'Index brackets to inflation', type: 'toggle', wide: true },
        { path: 'tax.includePayroll', label: 'Include CPP/EI contributions', type: 'toggle', wide: true },
        { path: 'tax.selfEmployed', label: 'Self-employed (both CPP halves, no EI)', type: 'toggle', wide: true },
        { path: 'tax.oasClawback', label: 'Apply OAS clawback', type: 'toggle', wide: true }
      ]));
      return wrap;
    }
  });

  function bracketEditor(p) {
    var br = p.tax.customBrackets || [];
    function setBr(arr) { store().set('tax.customBrackets', arr, { structural: true }); }
    var row = h('div.field.field-wide', { dataset: { path: 'tax.customBrackets' } },
      h('label.field-label', h('span', 'Combined brackets (federal + provincial)'),
        h('button.override-reset', { type: 'button', title: 'Revert', onclick: function () { store().resetOverride('tax.customBrackets'); } }, ui.icon('reset', 12))),
      h('div.items',
        h('div.items-head.cols-3', h('span', 'Income up to'), h('span', 'Rate'), h('span')),
        br.map(function (b, i) {
          var last = i === br.length - 1;
          return h('div.items-row.cols-3',
            last ? h('span.muted', 'and above') : ui.input({ type: 'money', label: 'Up to' }, b.upTo, function (v) {
              var arr = U.clone(store().get('tax.customBrackets')); arr[i].upTo = v; setBr(arr);
            }),
            ui.input({ type: 'percent', label: 'Rate' }, b.rate, function (v) { var arr = U.clone(store().get('tax.customBrackets')); arr[i].rate = v; setBr(arr); }),
            br.length > 1 ? ui.button(null, function () {
              var arr = U.clone(store().get('tax.customBrackets')); arr.splice(i, 1); arr[arr.length - 1].upTo = null; setBr(arr);
            }, { icon: 'trash', cls: 'ghost icon-only', aria: 'Remove bracket' }) : h('span'));
        }),
        h('div.items-foot', ui.button('Add bracket', function () {
          var arr = U.clone(store().get('tax.customBrackets'));
          var prevTop = arr.length > 1 ? num(arr[arr.length - 2].upTo) : 0;
          arr.splice(arr.length - 1, 0, { upTo: prevTop + 50000, rate: arr[arr.length - 1].rate });
          setBr(arr);
        }, { icon: 'plus', cls: 'ghost small' }))));
    if (store().isOverridden('tax.customBrackets')) row.classList.add('overridden');
    return h('div', row, ui.fields([{ path: 'tax.customCredit', label: 'Tax-free amount (credit base)', type: 'money', help: 'Credited at the lowest bracket rate, like the basic personal amount.' }]));
  }

  // ---------------------------------------------------------------------------
  sections.register({
    id: 'events', title: 'Life events',
    summary: function (p) { var n = (p.events || []).length; return n ? n + ' event' + (n > 1 ? 's' : '') : 'None yet'; },
    render: function () {
      var list = store().allEvents();
      return h('div',
        list.length ? h('ul.event-mini', list.map(function (x) {
          var def = RP.eventTypes.get(x.ev.type);
          return h('li' + (x.enabled && x.ev.enabled !== false ? '' : '.disabled'),
            h('span.swatch', { style: { background: def ? def.color : '#888' } }),
            h('button.linklike', { type: 'button', onclick: function () { RP.ui.editEvent(x.ev.id); } }, x.ev.label || (def && def.label)),
            h('span.muted', RP.events.describe(x.ev)));
        })) : note('No events yet. Click any year in the projection table or chart to add one.'),
        h('div.btn-row', ui.button('Add event', function (e) { RP.ui.addEventMenu(e.clientX, e.clientY, store().get('profile.retirementAge')); }, { icon: 'plus', cls: 'ghost small' })));
    }
  });

  // ---------------------------------------------------------------------------
  /** Render the whole panel. */
  ui.renderInputs = function (host) {
    var s = store();
    var plan = s.effective();
    var sc = s.scenario();
    ui.clear(host);
    if (sc) {
      host.appendChild(h('div.scenario-banner', { style: { borderColor: sc.color } },
        h('span.swatch', { style: { background: sc.color } }),
        h('div', h('b', 'Editing scenario: ' + sc.name),
          h('div.muted', 'Changes here only affect this scenario. Overridden values are marked; click ', ui.icon('reset', 11), ' to follow the base plan again.')),
        ui.button('Back to base', function () { s.setActive('base'); }, { cls: 'ghost small' })));
    }
    sections.list().forEach(function (sec) {
      var collapsed = s.ui.collapsed[sec.id];
      if (collapsed === undefined) collapsed = !!sec.collapsedByDefault;
      var det = h('details.section', { open: !collapsed },
        h('summary', h('span.section-title', sec.title), h('span.section-summary', sec.summary(plan))),
        h('div.section-body', sec.render(plan)));
      det.addEventListener('toggle', function () { s.ui.collapsed[sec.id] = !det.open; s.saveUi(); });
      host.appendChild(det);
    });
  };

  ui.refreshSummaries = function (host) {
    var plan = store().effective();
    host.querySelectorAll('details.section').forEach(function (det, i) {
      var sec = sections.list()[i];
      var el = det.querySelector('.section-summary');
      if (sec && el) el.textContent = sec.summary(plan);
    });
  };
})(globalThis.RP);
