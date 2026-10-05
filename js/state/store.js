/*
 * store.js — application state, undo/redo, autosave, import/export.
 *
 * The store holds the plan document and which scenario is being edited.
 * UI code reads values with RP.store.get(path) and writes with
 * RP.store.set(path, value). Writes go to the base plan, or — when a scenario
 * is active — to that scenario's overrides.
 *
 * Change notifications:
 *   'data'       — a value changed; outputs (charts/tables) should refresh
 *   'structure'  — something structural changed (scenario switch, undo, list add/remove);
 *                  the input panel should re-render too
 *   'results'    — projection results recalculated
 */
(function (RP) {
  'use strict';
  var U = RP.util;
  var STORAGE_KEY = 'crp:document';
  var UI_KEY = 'crp:ui';

  var listeners = [];
  var undoStack = [], redoStack = [];
  var saveTimer = null, calcTimer = null;

  var store = RP.store = {
    doc: null,
    active: 'base',
    results: null,      // [{ id, name, color, visible, result }]
    ui: { theme: 'auto', collapsed: {} }
  };

  function emit(kind) { listeners.forEach(function (fn) { fn(kind); }); }
  store.subscribe = function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; };

  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, v) { try { localStorage.setItem(key, v); return true; } catch (e) { return false; } }

  store.init = function () {
    var raw = safeGet(STORAGE_KEY);
    var doc = null;
    if (raw) { try { doc = RP.schema.normalize(JSON.parse(raw)); } catch (e) { console.warn('Could not load saved plan', e); } }
    store.doc = doc || RP.schema.newDocument();
    try { store.ui = Object.assign(store.ui, JSON.parse(safeGet(UI_KEY) || '{}')); } catch (e) { /* ignore */ }
    store.recalc(true);
  };

  store.saveUi = function () { safeSet(UI_KEY, JSON.stringify(store.ui)); };

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    store.doc.meta.modified = new Date().toISOString();
    var ok = safeSet(STORAGE_KEY, JSON.stringify(store.doc));
    store.lastSaved = ok ? new Date() : null;
    store.saveFailed = !ok;
    emit('saved');
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  // Don't lose an edit made just before the tab is closed or backgrounded (phones).
  if (typeof window !== 'undefined') {
    var flush = function () { if (saveTimer && store.doc) saveNow(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  }

  /** Recalculate base + all scenarios. Debounced unless `now`. */
  store.recalc = function (now) {
    clearTimeout(calcTimer);
    var run = function () {
      try {
        store.results = RP.scenarios.runAll(store.doc);
        store.error = null;
      } catch (e) {
        console.error(e);
        store.error = e;
      }
      emit('results');
    };
    if (now) run(); else calcTimer = setTimeout(run, 60);
  };

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------
  store.scenario = function () { return store.active === 'base' ? null : RP.scenarios.find(store.doc, store.active); };
  store.effective = function (id) { return RP.scenarios.effective(store.doc, id || store.active); };
  store.get = function (path) { return U.getPath(store.effective(), path); };
  store.activeResult = function () {
    if (!store.results) return null;
    return store.results.filter(function (r) { return r.id === store.active; })[0] || store.results[0];
  };
  store.baseResult = function () { return store.results && store.results[0]; };

  /** Overrides are stored at the first array along a path (arrays are replaced whole). */
  function overrideKey(path) {
    var parts = path.split('.');
    for (var i = 1; i < parts.length; i++) {
      if (/^\d+$/.test(parts[i])) return parts.slice(0, i).join('.');
    }
    return path;
  }
  store.overrideKeyFor = overrideKey;

  store.isOverridden = function (path) {
    var s = store.scenario();
    if (!s) return false;
    var key = overrideKey(path);
    return Object.prototype.hasOwnProperty.call(s.overrides, key) ||
      Object.keys(s.overrides).some(function (k) { return path.indexOf(k + '.') === 0; });
  };

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------
  function snapshot() {
    undoStack.push(JSON.stringify({ doc: store.doc, active: store.active }));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }

  function changed(structural) {
    scheduleSave();
    store.recalc();
    emit(structural ? 'structure' : 'data');
  }

  /** Set a plan input at `path` (in the active context). */
  store.set = function (path, value, opts) {
    opts = opts || {};
    if (!opts.noUndo) snapshot();
    var s = store.scenario();
    if (!s) {
      U.setPath(store.doc.base, path, value);
    } else {
      var key = overrideKey(path);
      if (key === path) {
        s.overrides[key] = U.clone(value);
      } else {
        var eff = store.effective();
        U.setPath(eff, path, value);
        s.overrides[key] = U.clone(U.getPath(eff, key));
      }
    }
    changed(opts.structural);
  };

  /** Remove a scenario override so the value follows the base plan again. */
  store.resetOverride = function (path) {
    var s = store.scenario();
    if (!s) return;
    snapshot();
    var key = overrideKey(path);
    delete s.overrides[key];
    Object.keys(s.overrides).forEach(function (k) { if (k.indexOf(key + '.') === 0) delete s.overrides[k]; });
    changed(true);
  };

  /** Arbitrary document mutation with undo. fn(doc) mutates in place. */
  store.update = function (fn, structural) {
    snapshot();
    fn(store.doc);
    changed(structural !== false);
  };

  store.updateSettings = function (patch) {
    Object.assign(store.doc.settings, patch);
    scheduleSave();
    emit('settings');
  };

  store.setActive = function (id) {
    store.active = id === 'base' || RP.scenarios.find(store.doc, id) ? id : 'base';
    emit('structure');
    emit('results');
  };

  store.undo = function () {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify({ doc: store.doc, active: store.active }));
    var s = JSON.parse(undoStack.pop());
    store.doc = s.doc; store.active = s.active;
    changed(true);
  };
  store.redo = function () {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify({ doc: store.doc, active: store.active }));
    var s = JSON.parse(redoStack.pop());
    store.doc = s.doc; store.active = s.active;
    changed(true);
  };
  store.canUndo = function () { return undoStack.length > 0; };
  store.canRedo = function () { return redoStack.length > 0; };

  // ---------------------------------------------------------------------------
  // Events (context-aware: base events vs scenario-only events)
  // ---------------------------------------------------------------------------
  store.allEvents = function () {
    var s = store.scenario();
    var base = (store.doc.base.events || []).map(function (e) {
      return { ev: e, owner: 'base', enabled: !s || (s.disabledEvents || []).indexOf(e.id) < 0 };
    });
    var extra = s ? (s.events || []).map(function (e) { return { ev: e, owner: s.id, enabled: true }; }) : [];
    return base.concat(extra);
  };

  function findEvent(doc, id) {
    var i = doc.base.events.findIndex(function (e) { return e.id === id; });
    if (i >= 0) return { list: doc.base.events, index: i, owner: 'base' };
    for (var k = 0; k < doc.scenarios.length; k++) {
      var j = doc.scenarios[k].events.findIndex(function (e) { return e.id === id; });
      if (j >= 0) return { list: doc.scenarios[k].events, index: j, owner: doc.scenarios[k].id };
    }
    return null;
  }
  store.findEvent = function (id) { var f = findEvent(store.doc, id); return f ? f.list[f.index] : null; };
  store.eventOwner = function (id) { var f = findEvent(store.doc, id); return f ? f.owner : null; };

  store.addEvent = function (ev) {
    store.update(function (doc) {
      var s = store.scenario();
      (s ? s.events : doc.base.events).push(ev);
    });
  };
  store.updateEvent = function (id, patch) {
    store.update(function (doc) {
      var f = findEvent(doc, id);
      if (f) Object.assign(f.list[f.index], patch);
    });
  };
  store.removeEvent = function (id) {
    store.update(function (doc) {
      var f = findEvent(doc, id);
      if (f) f.list.splice(f.index, 1);
      doc.scenarios.forEach(function (s) { s.disabledEvents = (s.disabledEvents || []).filter(function (x) { return x !== id; }); });
    });
  };
  store.toggleEventInScenario = function (id) {
    var s = store.scenario();
    if (!s) return;
    store.update(function () {
      var i = s.disabledEvents.indexOf(id);
      if (i >= 0) s.disabledEvents.splice(i, 1); else s.disabledEvents.push(id);
    });
  };

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------
  store.addScenario = function (name, init) {
    var s = RP.schema.newScenario(store.doc, name);
    if (init) init(s);
    store.update(function (doc) { doc.scenarios.push(s); });
    store.setActive(s.id);
    return s;
  };
  store.duplicateScenario = function (id) {
    var src = RP.scenarios.find(store.doc, id);
    var s = RP.schema.newScenario(store.doc, (src ? src.name : 'Base plan') + ' (copy)');
    if (src) {
      s.overrides = U.clone(src.overrides);
      s.events = U.clone(src.events).map(function (e) { e.id = U.uid('ev'); return e; });
      s.disabledEvents = U.clone(src.disabledEvents);
    }
    store.update(function (doc) { doc.scenarios.push(s); });
    store.setActive(s.id);
  };
  store.removeScenario = function (id) {
    store.update(function (doc) { doc.scenarios = doc.scenarios.filter(function (s) { return s.id !== id; }); });
    if (store.active === id) store.setActive('base');
  };
  /** Fold a scenario's changes into the base plan. */
  store.promoteScenario = function (id) {
    var eff = RP.scenarios.effective(store.doc, id);
    store.update(function (doc) {
      doc.base = eff;
      doc.scenarios = doc.scenarios.filter(function (s) { return s.id !== id; });
    });
    store.setActive('base');
  };

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  store.exportJson = function () {
    var doc = U.clone(store.doc);
    doc.meta.exported = new Date().toISOString();
    doc.meta.appVersion = RP.version;
    return JSON.stringify(doc, null, 2);
  };

  /** Parse and check a plan file without loading it. Returns { doc, issues } or throws on unreadable files. */
  store.parsePlan = function (text) {
    var raw;
    try { raw = JSON.parse(text); }
    catch (e) {
      // Tolerate a file that is a Markdown code block (common when copied from an AI chat).
      var m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
      if (!m) throw new Error('Not valid JSON: ' + e.message);
      raw = JSON.parse(m[1]);
    }
    var doc = RP.schema.normalize(raw);
    return { doc: doc, issues: RP.schema.validate(doc) };
  };

  store.loadDocument = function (doc) {
    snapshot();
    store.doc = doc;
    store.active = 'base';
    changed(true);
    return doc;
  };

  store.importJson = function (text) {
    return store.loadDocument(store.parsePlan(text).doc);
  };

  store.reset = function () {
    snapshot();
    store.doc = RP.schema.newDocument();
    store.active = 'base';
    changed(true);
  };
})(globalThis.RP);
