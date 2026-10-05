/*
 * Scenarios tab — manage scenarios, compare key metrics side by side, overlay chart.
 *
 * Quick-start templates live in RP.scenarioTemplates:
 *   { id, label, description, init(scenario, basePlan) }  — set overrides/events on the new scenario.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt, U = RP.util, num = U.num;

  var T = RP.scenarioTemplates = RP.createRegistry('scenarioTemplates');
  T.register({ id: 'blank', label: 'Blank (same as base)', description: 'Start identical to the base plan and change what you like.', init: function () {} });
  T.register({ id: 'retireEarly', label: 'Retire 3 years earlier', init: function (s, p) { s.overrides['profile.retirementAge'] = num(p.profile.retirementAge) - 3; } });
  T.register({ id: 'retireLate', label: 'Work 3 years longer', init: function (s, p) { s.overrides['profile.retirementAge'] = num(p.profile.retirementAge) + 3; } });
  T.register({ id: 'lowReturns', label: 'Returns 1.5 pp lower', init: function (s, p) {
    s.overrides['assumptions.returnPre'] = num(p.assumptions.returnPre) - 0.015;
    s.overrides['assumptions.returnPost'] = num(p.assumptions.returnPost) - 0.015;
  } });
  T.register({ id: 'highInflation', label: 'Inflation 1 pp higher', init: function (s, p) { s.overrides['assumptions.inflation'] = num(p.assumptions.inflation) + 0.01; } });
  T.register({ id: 'crashAtRetirement', label: 'Market crash at retirement', description: '−30% the year you retire, then a weak year.', init: function (s, p) {
    var a = num(p.profile.retirementAge);
    var e1 = RP.events.create('returnOverride', a, p); e1.label = 'Crash at retirement'; e1.rate = -0.3;
    var e2 = RP.events.create('returnOverride', a + 1, p); e2.label = 'Weak recovery'; e2.rate = -0.05;
    s.events.push(e1, e2);
  } });
  T.register({ id: 'spendMore', label: 'Spend 15% more in retirement', init: function (s, p) {
    s.overrides['spending.retirementChange'] = (1 + num(p.spending.retirementChange)) * 1.15 - 1;
  } });
  T.register({ id: 'deferBenefits', label: 'Defer CPP & OAS to 70', init: function (s) {
    s.overrides['benefits.cppStartAge'] = 70; s.overrides['benefits.oasStartAge'] = 70;
  } });
  T.register({ id: 'earlyCpp', label: 'Take CPP at 60', init: function (s) { s.overrides['benefits.cppStartAge'] = 60; } });

  function describeOverride(path, value) {
    var label = path.split('.').map(function (p) { return p.replace(/([A-Z])/g, ' $1').toLowerCase(); }).join(' › ');
    var v;
    if (Array.isArray(value)) v = value.length + ' item(s)';
    else if (typeof value === 'number') v = Math.abs(value) < 1 && value !== 0 && !/age|year/i.test(path) ? fmt.pct(value) : (/age|year/i.test(path) ? String(value) : fmt.money(value));
    else v = String(value);
    return { label: label, value: v };
  }

  RP.ui.newScenarioMenu = function (x, y) {
    ui.menu(x, y, T.list().map(function (t) {
      return { label: t.label, onclick: function () {
        var base = RP.store.effective('base');
        RP.store.addScenario(t.id === 'blank' ? null : t.label, function (s) { t.init(s, base); });
      } };
    }), 'New scenario from…');
  };

  RP.tabs.register({
    id: 'scenarios', label: 'Scenarios',
    render: function (host) {
      var store = RP.store, doc = store.doc, results = store.results, real = doc.settings.realDollars;

      // --- Overlay chart
      var canvas = h('canvas', { role: 'img', 'aria-label': 'Scenario comparison chart' });
      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Scenario comparison'), h('p.card-sub', 'Total portfolio by age for every visible scenario' + (real ? " (today's dollars)" : ''))),
          ui.button('New scenario', function (e) { RP.ui.newScenarioMenu(e.clientX, e.clientY); }, { icon: 'plus', cls: 'primary small' })),
        h('div.chart-box.tall', canvas)));
      RP.charts.portfolio(canvas, { results: results, activeId: store.active, mode: 'total', real: real,
        onClickAge: null });

      // --- Comparison table
      var metrics = [
        { label: 'Retirement age', get: function (r) { return r.result.plan.profile.retirementAge; }, f: String },
        { label: 'Portfolio at retirement', get: function (r) { return real ? r.result.summary.atRetirementReal : r.result.summary.atRetirement; }, f: fmt.compact, better: 1 },
        { label: 'Peak portfolio', get: function (r) { var s = r.result.summary; var y = r.result.years.filter(function (x) { return x.age === s.peakAge; })[0]; return real && y ? s.peak / y.cpiEnd : s.peak; }, f: fmt.compact, better: 1 },
        { label: 'Ending portfolio', get: function (r) { return real ? r.result.summary.endingReal : r.result.summary.ending; }, f: fmt.compact, better: 1 },
        { label: 'Money lasts to', get: function (r) { var s = r.result.summary; return s.firstShortfallAge == null ? s.endAge + 1 : s.firstShortfallAge; },
          f: function (v, r) { var s = r.result.summary; return s.firstShortfallAge == null ? s.endAge + '+ ✓' : 'age ' + v; }, better: 1 },
        { label: 'Lifetime tax', get: function (r) { return real ? r.result.summary.lifetimeTaxReal : r.result.summary.lifetimeTax; }, f: fmt.compact, better: -1 },
        { label: 'First-year retirement spending', get: function (r) {
          var y = r.result.years.filter(function (x) { return x.retired; })[0]; return y ? (real ? y.spending / y.cpi : y.spending) : null; }, f: fmt.money }
      ];
      var baseR = results[0];
      var table = h('table.grid.compare',
        h('thead', h('tr', h('th.left', 'Metric'), results.map(function (r) {
          return h('th', h('span.swatch', { style: { background: r.color } }), ' ', r.name);
        }))),
        h('tbody', metrics.map(function (m) {
          var bv = m.get(baseR);
          return h('tr', h('td.left', m.label), results.map(function (r, i) {
            var v = m.get(r);
            var delta = null;
            if (i > 0 && m.better && typeof v === 'number' && typeof bv === 'number' && Math.abs(v - bv) > 0.5) {
              var good = (v - bv) * m.better > 0;
              var dtext = m.f === fmt.compact || m.f === fmt.money ? fmt.compact(v - bv) : (v - bv > 0 ? '+' : '') + Math.round(v - bv);
              if (dtext.charAt(0) !== '−' && dtext.charAt(0) !== '+') dtext = '+' + dtext;
              delta = h('span.delta' + (good ? '.good' : '.bad'), dtext);
            }
            return h('td', m.f(v, r), delta ? ' ' : null, delta);
          }));
        })));
      host.appendChild(h('section.card', h('div.card-head', h('div', h('h3', 'Key metrics'), h('p.card-sub', 'Differences shown against the base plan'))), h('div.table-wrap', table)));

      // --- Scenario cards
      var list = h('div.scenario-list');
      list.appendChild(h('div.scenario-card' + (store.active === 'base' ? '.active' : ''),
        h('div.scenario-head', h('span.swatch', { style: { background: '#2f64a8' } }), h('b', 'Base plan'),
          h('div.btn-row', store.active === 'base' ? h('span.pill', 'Editing') : ui.button('Edit', function () { store.setActive('base'); }, { cls: 'small' }),
            ui.button(null, function () { store.duplicateScenario('base'); }, { icon: 'copy', cls: 'ghost icon-only', aria: 'Duplicate as scenario', title: 'Duplicate as a new scenario' }))),
        h('p.muted', 'Your main plan. Scenarios inherit everything from it except what they override.')));

      doc.scenarios.forEach(function (s) {
        var overrides = Object.keys(s.overrides || {});
        var nameInput = ui.input({ type: 'text', label: 'Scenario name' }, s.name, function (v) { store.update(function () { s.name = v || s.name; }); });
        var colorInput = h('input.color', { type: 'color', value: s.color, title: 'Colour', onchange: function (e) { store.update(function () { s.color = e.target.value; }); } });
        list.appendChild(h('div.scenario-card' + (store.active === s.id ? '.active' : ''), { style: { '--sc': s.color } },
          h('div.scenario-head', colorInput, nameInput,
            h('div.btn-row',
              store.active === s.id ? h('span.pill', 'Editing') : ui.button('Edit', function () { store.setActive(s.id); }, { cls: 'small' }),
              ui.button(null, function () { store.update(function () { s.visible = s.visible === false; }, false); }, { icon: s.visible === false ? 'eyeOff' : 'eye', cls: 'ghost icon-only', aria: 'Toggle visibility on charts', title: s.visible === false ? 'Hidden on charts' : 'Shown on charts' }),
              ui.button(null, function () { store.duplicateScenario(s.id); }, { icon: 'copy', cls: 'ghost icon-only', aria: 'Duplicate', title: 'Duplicate' }),
              ui.button(null, function () {
                ui.confirm('Make this the base plan?', 'The base plan will be replaced by "' + s.name + '" (its overrides and events are folded in). Other scenarios will now be relative to it.', function () { store.promoteScenario(s.id); }, 'Promote');
              }, { icon: 'up', cls: 'ghost icon-only', aria: 'Promote to base', title: 'Promote to base plan' }),
              ui.button(null, function () { ui.confirm('Delete scenario', 'Delete "' + s.name + '"?', function () { store.removeScenario(s.id); }, 'Delete'); }, { icon: 'trash', cls: 'ghost icon-only', aria: 'Delete', title: 'Delete' }))),
          overrides.length || s.events.length || s.disabledEvents.length ? h('ul.override-list',
            overrides.map(function (k) {
              var d = describeOverride(k, s.overrides[k]);
              return h('li', h('span', d.label), h('b', d.value), ui.button(null, function () {
                store.update(function () { delete s.overrides[k]; });
              }, { icon: 'x', cls: 'ghost icon-only tiny', aria: 'Remove override', title: 'Remove override' }));
            }),
            s.events.map(function (e) {
              return h('li', h('span', 'Event: ' + (e.label || e.type)), h('b', RP.events.describe(e)), ui.button(null, function () { ui.editEvent(e.id); }, { icon: 'edit', cls: 'ghost icon-only tiny', aria: 'Edit event' }));
            }),
            s.disabledEvents.map(function (id) {
              var e = store.findEvent(id);
              return e ? h('li', h('span', 'Excludes base event'), h('b', e.label || e.type)) : null;
            })) : h('p.muted', 'No changes yet. Click Edit, then change any input on the left.')));
      });
      host.appendChild(h('section.card', h('div.card-head', h('div', h('h3', 'Scenarios'), h('p.card-sub', 'Each scenario stores only its differences from the base plan.'))), list));
    }
  });
})(globalThis.RP);
