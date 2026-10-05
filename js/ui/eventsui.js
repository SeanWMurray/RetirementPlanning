/*
 * eventsui.js — add/edit event dialogs and the "what happens at age X" menu.
 * Forms are generated from each event type's `fields`, so new event types get
 * a UI for free.
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, U = RP.util;

  function eventForm(ev) {
    var def = RP.eventTypes.get(ev.type);
    return h('div',
      def.description ? h('p.note', def.description) : null,
      ui.objectForm(def.fields, ev),
      ui.objectForm([{ key: 'enabled', label: 'Enabled (include in projection)', type: 'toggle' }], Object.defineProperty({}, 'enabled', {
        get: function () { return ev.enabled !== false; }, set: function (v) { ev.enabled = v; }, enumerable: true })));
  }

  /** Dialog for a brand-new event (not saved until "Add"). */
  ui.newEventModal = function (typeId, age, preset) {
    var plan = RP.store.effective();
    var ev = RP.events.create(typeId, age, plan, preset);
    var def = RP.eventTypes.get(typeId);
    var sc = RP.store.scenario();
    ui.modal('Add ' + def.label.toLowerCase() + (sc ? ' — ' + sc.name : ''), eventForm(ev), [
      { label: 'Cancel', onclick: function () {} },
      { label: 'Add event', primary: true, onclick: function () { RP.store.addEvent(ev); ui.toast('Event added' + (sc ? ' to ' + sc.name : '')); } }
    ]);
  };

  /** Dialog to edit an existing event. */
  ui.editEvent = function (id) {
    var orig = RP.store.findEvent(id);
    if (!orig) return;
    var owner = RP.store.eventOwner(id);
    var sc = RP.store.scenario();
    var draft = U.clone(orig);
    var def = RP.eventTypes.get(draft.type);
    var body = eventForm(draft);
    var actions = [
      { label: 'Delete', danger: true, onclick: function () { RP.store.removeEvent(id); ui.toast('Event deleted'); } },
      { label: 'Duplicate', onclick: function () { var c = U.clone(draft); c.id = U.uid('ev'); c.label = (c.label || '') + ' (copy)'; RP.store.addEvent(c); } },
      { label: 'Cancel', onclick: function () {} },
      { label: 'Save', primary: true, onclick: function () { RP.store.updateEvent(id, draft); } }
    ];
    if (sc && owner === 'base') {
      body.insertBefore(h('div.callout',
        ui.icon('info'), h('span', 'This event belongs to the base plan, so edits apply to every scenario. To change it only in "' + sc.name + '", switch it off here and add a scenario-specific copy.'),
        ui.button(RP.store.allEvents().some(function (x) { return x.ev.id === id && !x.enabled; }) ? 'Include in this scenario' : 'Exclude from this scenario',
          function () { RP.store.toggleEventInScenario(id); document.querySelector('.modal-backdrop').remove(); }, { cls: 'small' })), body.firstChild);
    }
    ui.modal('Edit ' + (def ? def.label.toLowerCase() : 'event'), body, actions);
  };

  /** Context menu offering every event type + presets at an age. */
  ui.addEventMenu = function (x, y, age, extra) {
    var items = [];
    var plan = RP.store.effective();
    var res = RP.store.activeResult();
    var row = res && res.result.years.filter(function (r) { return r.age === age; })[0];

    // Events already active this year
    var active = row ? RP.store.allEvents().filter(function (e) { return row.activeEvents.indexOf(e.ev.id) >= 0; }) : [];
    if (active.length) {
      items.push({ heading: 'Active at age ' + age });
      active.forEach(function (e) {
        var def = RP.eventTypes.get(e.ev.type);
        items.push({ label: e.ev.label || def.label, hint: 'edit', swatch: def.color, onclick: function () { ui.editEvent(e.ev.id); } });
      });
      items.push({ separator: true });
    }

    items.push({ heading: 'Add at age ' + age });
    RP.eventTypes.list().forEach(function (def) {
      items.push({ label: def.label + '…', swatch: def.color, onclick: function () { ui.newEventModal(def.id, age); } });
      (def.presets || []).forEach(function (p) {
        items.push({ label: '   ' + p.label, hint: 'preset', onclick: function () { ui.newEventModal(def.id, age, p); } });
      });
    });
    items.push({ separator: true });
    items.push({ label: 'Retire at ' + age, disabled: age === plan.profile.retirementAge, onclick: function () { RP.store.set('profile.retirementAge', age, { structural: true }); } });
    if (extra) items = items.concat(extra);
    var m = ui.menu(x, y, items, null);
    m.classList.add('menu-tall');
  };
})(globalThis.RP);
