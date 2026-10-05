/*
 * Events tab — a timeline (Gantt-style) of all life events across the plan horizon.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, U = RP.util;

  RP.tabs.register({
    id: 'events', label: 'Events',
    render: function (host) {
      var store = RP.store, plan = store.effective();
      var start = Number(plan.profile.currentAge), end = Number(plan.profile.endAge), span = Math.max(1, end - start + 1);
      var list = store.allEvents();
      var sc = store.scenario();

      function pct(age) { return ((age - start) / span * 100) + '%'; }
      function retMark() { return h('span.tl-ret', { style: { left: pct(Number(plan.profile.retirementAge)) }, title: 'Retirement at ' + plan.profile.retirementAge }); }
      var ticks = [];
      for (var a = Math.ceil(start / 5) * 5; a <= end; a += 5) ticks.push(a);

      var add = ui.button('Add event', function (e) { ui.addEventMenu(e.clientX, e.clientY, Number(plan.profile.retirementAge)); }, { icon: 'plus', cls: 'primary small' });

      var rows = list.map(function (x) {
        var ev = x.ev, def = RP.eventTypes.get(ev.type);
        var s = U.num(ev.startAge), e = ev.endAge == null || ev.endAge === '' ? s : U.num(ev.endAge);
        if (ev.type === 'lumpSum') e = s;
        var on = x.enabled && ev.enabled !== false;
        var bar;
        if (ev.type === 'expense' && U.num(ev.everyYears, 1) > 1) {
          var dots = [];
          for (var k = s; k <= e; k += Math.max(1, Math.round(U.num(ev.everyYears, 1)))) dots.push(h('span.tl-dot', { style: { left: 'calc(' + pct(k) + ' + ' + (50 / span) + '%)', background: def.color } }));
          bar = dots;
        } else {
          bar = h('span.tl-bar', { style: { left: pct(s), width: ((e - s + 1) / span * 100) + '%', background: def.color } });
        }
        return h('div.tl-row' + (on ? '' : '.disabled'),
          h('div.tl-label',
            h('button.linklike', { type: 'button', onclick: function () { ui.editEvent(ev.id); } }, ev.label || def.label),
            h('span.muted', RP.events.describe(ev)),
            sc ? h('span.pill' + (x.owner === 'base' ? '' : '.pill-sc'), x.owner === 'base' ? 'base' : sc.name) : null,
            sc && x.owner === 'base' ? ui.button(on ? 'Exclude' : 'Include', function () { store.toggleEventInScenario(ev.id); }, { cls: 'ghost tiny' }) : null),
          h('div.tl-track', { onclick: function () { ui.editEvent(ev.id); } }, bar, retMark()));
      });

      host.appendChild(h('section.card',
        h('div.card-head', h('div', h('h3', 'Life events timeline'),
          h('p.card-sub', sc ? 'Base events can be excluded from "' + sc.name + '"; new events added now belong only to this scenario.' : 'Events apply to the base plan and every scenario (scenarios can exclude them).')), add),
        list.length ? h('div.timeline',
          h('div.tl-row.tl-axis', h('div.tl-label'), h('div.tl-track',
            ticks.map(function (t) { return h('span.tl-tick', { style: { left: 'calc(' + pct(t) + ' + ' + (50 / span) + '%)' } }, String(t)); }),
            retMark())),
          rows) : h('div.empty', 'No events yet. Add one here, or click a year in the projection table or chart.')));

      // Event type reference
      host.appendChild(h('section.card', h('div.card-head', h('h3', 'Event types')),
        h('div.type-grid', RP.eventTypes.list().map(function (def) {
          return h('button.type-card', { type: 'button', onclick: function () { ui.newEventModal(def.id, Number(plan.profile.retirementAge)); } },
            h('span.swatch', { style: { background: def.color } }), h('b', def.label), h('span.muted', def.description));
        }))));
    }
  });
})(globalThis.RP);
