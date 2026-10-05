/*
 * Projection tab — portfolio chart, cash-flow chart and the year-by-year table.
 *
 * Table columns are a registry (RP.tableColumns). Each column:
 *   { id, label, group, kind: 'flow'|'balance'|'none', get(y, plan), format?, default?: bool, title? }
 * `kind` controls today's-dollar conversion. Per-account balance columns are generated.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;
  var cols = RP.tableColumns = RP.createRegistry('tableColumns');
  var selectedAge = null;

  function c(def) { cols.register(def); }
  c({ id: 'age', label: 'Age', group: 'Timeline', kind: 'none', get: function (y) { return y.age; }, format: String, sticky: true, default: true });
  c({ id: 'year', label: 'Year', group: 'Timeline', kind: 'none', get: function (y) { return y.year; }, format: String, default: true });
  c({ id: 'employment', label: 'Employment', group: 'Income', kind: 'flow', get: function (y) { return y.employment; }, default: true });
  c({ id: 'cpp', label: 'CPP', group: 'Income', kind: 'flow', get: function (y) { return y.cpp; }, default: true });
  c({ id: 'oas', label: 'OAS', group: 'Income', kind: 'flow', get: function (y) { return y.oas; }, default: true });
  c({ id: 'otherIncome', label: 'Other income', group: 'Income', kind: 'flow', get: function (y) { return y.otherIncome; }, default: true, title: 'Income and lump-sum events' });
  c({ id: 'incomeTotal', label: 'Total income', group: 'Income', kind: 'flow', get: function (y) { return y.incomeTotal; }, default: false });
  c({ id: 'tax', label: 'Tax', group: 'Tax', kind: 'flow', get: function (y) { return y.tax; }, default: true, title: 'Income tax + CPP/EI + OAS clawback' });
  c({ id: 'incomeTax', label: 'Income tax', group: 'Tax', kind: 'flow', get: function (y) { return y.incomeTax; }, default: false });
  c({ id: 'payroll', label: 'CPP/EI contrib.', group: 'Tax', kind: 'flow', get: function (y) { return y.payroll; }, default: false });
  c({ id: 'oasClawback', label: 'OAS clawback', group: 'Tax', kind: 'flow', get: function (y) { return y.oasClawback; }, default: false });
  c({ id: 'avgRate', label: 'Avg tax rate', group: 'Tax', kind: 'none', get: function (y) { var g = y.taxDetail.grossIncome; return g > 0 ? y.tax / g : null; }, format: function (v) { return v == null ? '—' : fmt.pct(v); }, default: false });
  c({ id: 'spendingBase', label: 'Base spending', group: 'Spending', kind: 'flow', get: function (y) { return y.spendingBase; }, default: false });
  c({ id: 'eventExpenses', label: 'Event costs', group: 'Spending', kind: 'flow', get: function (y) { return y.eventExpenses; }, default: false });
  c({ id: 'spending', label: 'Spending', group: 'Spending', kind: 'flow', get: function (y) { return y.spending; }, default: true });
  c({ id: 'contributions', label: 'Saved', group: 'Cash flow', kind: 'flow', get: function (y) { return y.contributions; }, default: true });
  c({ id: 'contribAccounts', label: 'Contributions by account', group: 'Cash flow', kind: 'flow', expand: 'contrib', default: false });
  c({ id: 'roomAccounts', label: 'RRSP / TFSA room left', group: 'Cash flow', kind: 'flow', expand: 'room', default: false, title: 'Unused contribution room at year end' });
  c({ id: 'withdrawals', label: 'Withdrawn', group: 'Cash flow', kind: 'flow', get: function (y) { return y.withdrawals; }, default: true });
  c({ id: 'rrifMin', label: 'RRIF minimum', group: 'Cash flow', kind: 'flow', get: function (y) { return y.rrifMin; }, default: false });
  c({ id: 'unallocated', label: 'Unsaved surplus', group: 'Cash flow', kind: 'flow', get: function (y) { return y.unallocated; }, default: false, title: 'Cash left over in fixed / % savings modes (assumed spent)' });
  c({ id: 'shortfall', label: 'Shortfall', group: 'Cash flow', kind: 'flow', get: function (y) { return y.shortfall; }, default: true });
  c({ id: 'growth', label: 'Investment growth', group: 'Portfolio', kind: 'flow', get: function (y) { return y.growth; }, default: false });
  c({ id: 'accounts', label: 'Account balances', group: 'Portfolio', kind: 'balance', expand: true, default: true });
  c({ id: 'total', label: 'Portfolio', group: 'Portfolio', kind: 'balance', get: function (y) { return y.total; }, default: true, strong: true });
  c({ id: 'events', label: 'Events', group: 'Timeline', kind: 'none', get: function (y) { return y.activeEvents; }, default: true, isEvents: true });

  /** Resolve visible columns, expanding per-account balances. */
  RP.ui.visibleColumns = function (plan, hidden) {
    var out = [];
    cols.list().forEach(function (col) {
      var isHidden = hidden.indexOf(col.id) >= 0 || (col.default === false && hidden.indexOf('+' + col.id) < 0);
      if (isHidden) return;
      if (col.expand === 'contrib') {
        plan.accounts.forEach(function (a) {
          out.push({ id: 'con_' + a.id, label: '→ ' + a.name, group: 'Cash flow', kind: 'flow', title: 'Contributed to ' + a.name, get: function (y) { return y.contribByAccount[a.id] || 0; } });
        });
      } else if (col.expand === 'room') {
        plan.accounts.forEach(function (a) {
          if (a.type !== 'rrsp' && a.type !== 'tfsa') return;
          out.push({ id: 'room_' + a.id, label: a.name + ' room', group: 'Cash flow', kind: 'flow', title: 'Unused contribution room at year end', get: function (y) { return y.roomByAccount[a.id] || 0; } });
        });
      } else if (col.expand) {
        plan.accounts.forEach(function (a) {
          out.push({ id: 'bal_' + a.id, label: a.name, group: 'Portfolio', kind: 'balance', get: function (y) { return y.balances[a.id] || 0; } });
        });
      } else out.push(col);
    });
    return out;
  };
  function isVisible(col, hidden) {
    return !(hidden.indexOf(col.id) >= 0 || (col.default === false && hidden.indexOf('+' + col.id) < 0));
  }
  function toggleColumn(col) {
    var s = RP.store.doc.settings;
    var hidden = (s.hiddenColumns || []).slice();
    var vis = isVisible(col, hidden);
    hidden = hidden.filter(function (x) { return x !== col.id && x !== '+' + col.id; });
    if (vis && col.default !== false) hidden.push(col.id);
    if (!vis && col.default === false) hidden.push('+' + col.id);
    RP.store.updateSettings({ hiddenColumns: hidden });
  }

  function cellValue(col, y, real) {
    var v = col.get(y);
    if (col.kind === 'flow' || col.kind === 'balance') v = RP.charts.val(y, v, col.kind, real);
    return v;
  }

  function eventMarkers(res) {
    var list = RP.store.allEvents();
    var out = [];
    res.years.forEach(function (y) {
      y.activeEvents.forEach(function (id) {
        var e = list.filter(function (x) { return x.ev.id === id; })[0];
        if (!e) return;
        var def = RP.eventTypes.get(e.ev.type);
        if (RP.eventTypes.get(e.ev.type).isActive(e.ev, y.age) && (y.age === Number(e.ev.startAge) || e.ev.type === 'expense')) {
          out.push({ age: y.age, color: def.color.indexOf('var(') === 0 ? ui.cssVar(def.color.slice(4, -1)) : def.color });
        }
      });
    });
    return out;
  }

  function openAgeMenu(age, evt) {
    var x = evt && evt.clientX != null ? evt.clientX : 200, yy = evt && evt.clientY != null ? evt.clientY : 200;
    ui.addEventMenu(x, yy, age, [
      { label: 'Tax detail for age ' + age, onclick: function () { RP.app.showTab('tax', { age: age }); } }
    ]);
  }

  RP.tabs.register({
    id: 'projection', label: 'Projection',
    render: function (host) {
      var store = RP.store, settings = store.doc.settings;
      var active = store.activeResult();
      if (!active) return;
      var res = active.result, real = settings.realDollars;

      // --- Portfolio chart
      var canvas = h('canvas', { 'aria-label': 'Portfolio value by age chart', role: 'img' });
      var modeSeg = h('div.segmented.small', [{ v: 'stacked', l: 'By account' }, { v: 'total', l: 'Totals only' }].map(function (o) {
        return h('button' + (settings.chartMode === o.v ? '.active' : ''), { type: 'button', onclick: function () { store.updateSettings({ chartMode: o.v }); } }, o.l);
      }));
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Portfolio value by age'),
          h('p.card-sub', (real ? "Today's dollars" : 'Future (nominal) dollars') + ' · click any year to add an event' + (store.results.length > 1 ? ' · other visible scenarios shown as lines' : ''))), modeSeg),
        h('div.chart-box.tall', canvas)));
      RP.charts.portfolio(canvas, {
        results: store.results, activeId: active.id, mode: settings.chartMode, real: real,
        onClickAge: openAgeMenu, events: eventMarkers(res)
      });

      // --- Cash flow chart
      var cf = h('canvas', { 'aria-label': 'Cash flow by age chart', role: 'img' });
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Cash flow'), h('p.card-sub', 'Where each year’s cash comes from, against spending and tax'))),
        h('div.chart-box', cf)));
      RP.charts.cashflow(cf, { result: res, real: real, onClickAge: openAgeMenu });

      // --- Table
      var hidden = settings.hiddenColumns || [];
      var columns = RP.ui.visibleColumns(res.plan, hidden);
      var colBtn = ui.button('Columns', function (e) {
        var items = [];
        var lastGroup = null;
        cols.list().forEach(function (col) {
          if (col.sticky) return;
          if (col.group !== lastGroup) { items.push({ heading: col.group }); lastGroup = col.group; }
          items.push({ label: (isVisible(col, hidden) ? '✓ ' : '  ') + col.label, onclick: function () { toggleColumn(col); } });
        });
        ui.menu(e.clientX, e.clientY, items).classList.add('menu-tall');
      }, { icon: 'layers', cls: 'small' });
      var csvBtn = ui.button('Export CSV', function () { exportCsv(res, columns, real); }, { icon: 'download', cls: 'small', title: 'Download the table as CSV' });
      csvBtn.dataset.action = 'csv';

      var evList = RP.store.allEvents();
      var table = h('table.grid',
        h('thead', h('tr', columns.map(function (col) {
          return h('th' + (col.sticky ? '.sticky' : '') + (col.isEvents ? '.left' : ''), { title: col.title || null }, col.label);
        }))),
        h('tbody', res.years.map(function (y) {
          var cls = (y.retired ? '.retired' : '') + (y.age === res.plan.profile.retirementAge ? '.ret-start' : '') + (y.shortfall > 1 ? '.short' : '');
          var tr = h('tr' + cls + (y.age === selectedAge ? '.selected' : ''), { tabindex: 0, onclick: function (e) {
              selectedAge = y.age;
              table.querySelectorAll('tr.selected').forEach(function (r) { r.classList.remove('selected'); });
              tr.classList.add('selected');
              openAgeMenu(y.age, e);
            },
            onkeydown: function (e) { if (e.key === 'Enter') { var r = tr.getBoundingClientRect(); openAgeMenu(y.age, { clientX: r.left + 80, clientY: r.bottom }); } } },
          columns.map(function (col) {
            if (col.isEvents) {
              return h('td.left.ev-cell', y.activeEvents.map(function (id) {
                var e = evList.filter(function (x) { return x.ev.id === id; })[0];
                if (!e) return null;
                var def = RP.eventTypes.get(e.ev.type);
                return h('span.chip', { style: { '--chip': def.color }, title: RP.events.describe(e.ev),
                  onclick: function (ev) { ev.stopPropagation(); ui.editEvent(id); } }, e.ev.label || def.label);
              }));
            }
            var v = cellValue(col, y, real);
            var text = col.format ? col.format(v) : fmt.money(v);
            var neg = col.id === 'shortfall' && v > 1;
            return h('td' + (col.sticky ? '.sticky' : '') + (col.strong ? '.strong' : '') + (neg ? '.neg' : '') + (v === 0 && !col.format ? '.zero' : ''), text);
          }));
          return tr;
        })));

      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Year-by-year projection'),
          h('p.card-sub', 'Click a row to add an event at that age, change retirement age, or see the tax detail. Flows are annual; balances are year-end.')),
          h('div.btn-row', colBtn, csvBtn)),
        h('div.table-wrap', table)));
    }
  });

  function exportCsv(res, columns, real) {
    var cols2 = columns.filter(function (c) { return !c.isEvents; });
    var lines = [cols2.map(function (c) { return '"' + c.label + '"'; }).join(',') + ',Events'];
    var evList = RP.store.allEvents();
    res.years.forEach(function (y) {
      var row = cols2.map(function (c) { var v = cellValue(c, y, real); return typeof v === 'number' ? (Math.round(v * 100) / 100) : (v == null ? '' : v); });
      var evs = y.activeEvents.map(function (id) { var e = evList.filter(function (x) { return x.ev.id === id; })[0]; return e ? e.ev.label : ''; }).join('; ');
      lines.push(row.join(',') + ',"' + evs.replace(/"/g, '""') + '"');
    });
    ui.download(ui.slug(RP.store.doc.meta.name) + '-projection' + (real ? '-real' : '') + '.csv', lines.join('\n'), 'text/csv');
  }
})(globalThis.RP);
