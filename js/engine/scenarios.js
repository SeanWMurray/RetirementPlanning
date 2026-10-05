/*
 * scenarios.js — scenarios are *deltas* on top of the base plan.
 *
 * A scenario stores only what differs from the base:
 *   overrides:      { 'profile.retirementAge': 62, 'assumptions.returnPre': 0.05, ... }
 *   events:         extra events that exist only in this scenario
 *   disabledEvents: ids of base events switched off in this scenario
 *
 * So changing the base plan flows through to every scenario automatically,
 * except for the specific values a scenario has overridden.
 */
(function (RP) {
  'use strict';
  var U = RP.util;
  var sc = RP.scenarios = {};

  sc.find = function (doc, id) {
    return (doc.scenarios || []).filter(function (s) { return s.id === id; })[0] || null;
  };

  /** Effective plan inputs for the base (id null/'base') or a scenario. */
  sc.effective = function (doc, id) {
    var plan = U.clone(doc.base);
    var s = id && id !== 'base' ? sc.find(doc, id) : null;
    if (!s) return plan;
    Object.keys(s.overrides || {}).forEach(function (path) { U.setPath(plan, path, U.clone(s.overrides[path])); });
    var disabled = s.disabledEvents || [];
    plan.events = (plan.events || []).filter(function (e) { return disabled.indexOf(e.id) < 0; })
      .concat(U.clone(s.events || []));
    return plan;
  };

  /** Run base + every scenario. Returns [{ id, name, color, visible, result }]. */
  sc.runAll = function (doc) {
    var out = [{ id: 'base', name: 'Base plan', color: '#2f64a8', visible: true, result: RP.engine.project(sc.effective(doc, 'base')) }];
    (doc.scenarios || []).forEach(function (s) {
      out.push({ id: s.id, name: s.name, color: s.color, visible: s.visible !== false, result: RP.engine.project(sc.effective(doc, s.id)) });
    });
    return out;
  };
})(globalThis.RP);
