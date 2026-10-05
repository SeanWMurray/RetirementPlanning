/*
 * core.js — shared namespace and small utilities.
 *
 * Every file in this project is a plain <script> (no modules, no build step) so
 * the app runs straight from disk (file://) or any static host. Each file
 * attaches what it defines to the single global namespace `RP`.
 *
 * Load order matters: core -> data -> engine -> state -> ui. See index.html.
 */
(function (root) {
  'use strict';

  var RP = root.RP = root.RP || {};
  RP.version = '1.0.0';

  // ---------------------------------------------------------------------------
  // Registry: the extension mechanism used throughout the app.
  // Event types, withdrawal strategies, savings modes, table columns, sensitivity
  // variables, tabs and tax rules are all registries. Adding a feature usually
  // means registering one more entry rather than editing the engine.
  // ---------------------------------------------------------------------------
  RP.createRegistry = function (name) {
    var items = {};
    var order = [];
    return {
      name: name,
      register: function (def) {
        if (!def || !def.id) throw new Error(name + ': definition needs an id');
        if (!items[def.id]) order.push(def.id);
        items[def.id] = def;
        return def;
      },
      get: function (id) { return items[id]; },
      has: function (id) { return !!items[id]; },
      list: function () { return order.map(function (id) { return items[id]; }); },
      ids: function () { return order.slice(); }
    };
  };

  var util = RP.util = {};

  util.clone = function (v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  };

  util.isObject = function (v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  };

  /** Deep merge `patch` into a clone of `base`. Arrays are replaced, not merged. */
  util.merge = function (base, patch) {
    var out = util.clone(base);
    (function walk(target, src) {
      Object.keys(src || {}).forEach(function (k) {
        if (util.isObject(src[k]) && util.isObject(target[k])) walk(target[k], src[k]);
        else target[k] = util.clone(src[k]);
      });
    })(out, patch);
    return out;
  };

  /** Read a dotted path, e.g. getPath(plan, 'profile.retirementAge'). */
  util.getPath = function (obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  };

  /** Set a dotted path in place, creating intermediate objects. */
  util.setPath = function (obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  };

  util.uid = function (prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  };

  util.clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  util.sum = function (arr, fn) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += fn ? fn(arr[i], i) : arr[i];
    return s;
  };

  util.num = function (v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  };

  /** Deterministic PRNG (mulberry32) so Monte Carlo runs are reproducible. */
  util.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** Standard normal from a uniform RNG (Box–Muller). */
  util.gaussian = function (rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  util.percentile = function (sorted, p) {
    if (!sorted.length) return 0;
    var idx = (sorted.length - 1) * p;
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  var fmt = RP.fmt = {};
  var nf0 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  fmt.money = function (v) {
    if (v == null || !isFinite(v)) return '—';
    var r = Math.round(v);
    if (r === 0) return '$0';
    return (r < 0 ? '−$' : '$') + nf0.format(Math.abs(r));
  };
  fmt.compact = function (v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 1e9) return s + '$' + nf2.format(a / 1e9) + 'B';
    if (a >= 1e6) return s + '$' + nf2.format(a / 1e6) + 'M';
    if (a >= 1e4) return s + '$' + nf0.format(a / 1e3) + 'k';
    if (a >= 1e3) return s + '$' + nf1.format(a / 1e3) + 'k';
    return s + '$' + nf0.format(a);
  };
  fmt.pct = function (v, digits) {
    if (v == null || !isFinite(v)) return '—';
    return (v * 100).toFixed(digits == null ? 1 : digits) + '%';
  };
  fmt.num = function (v) { return v == null || !isFinite(v) ? '—' : nf0.format(v); };
})(globalThis);
