/*
 * fields.js — form inputs.
 *
 *   RP.ui.input(def, value, onCommit)  — an unbound input (used by event editors)
 *   RP.ui.field(def)                    — an input bound to a plan path in the store
 *
 * def = { path?, key?, label, type, options?, help?, min?, max?, step?, placeholder?, nullable? }
 * types: money | percent | number | age | text | textarea | select | toggle
 *
 * Values are stored in natural units (percent as a decimal: 0.05 = 5%).
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, U = RP.util;

  var moneyFmt = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 });

  function parseNumber(str) {
    if (str == null) return null;
    var s = String(str).replace(/[$,\s%]/g, '').replace(/−/g, '-');
    if (s === '' || s === '-') return null;
    var mult = 1;
    if (/k$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    else if (/m$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
    var n = parseFloat(s);
    return isFinite(n) ? n * mult : null;
  }
  ui.parseNumber = parseNumber;

  function display(type, v) {
    if (v == null || v === '') return '';
    if (type === 'money') return moneyFmt.format(v);
    if (type === 'percent') return String(Math.round(v * 100000) / 1000);
    return String(v);
  }

  /** Build an input element. onCommit(value) is called with the parsed value. */
  ui.input = function (def, value, onCommit) {
    var type = def.type || 'text';
    var el, timer;

    if (type === 'select') {
      el = h('select.input', { 'aria-label': def.label },
        (typeof def.options === 'function' ? def.options() : def.options).map(function (o) {
          return h('option', { value: String(o.value) }, o.label);
        }));
      el.value = value == null ? '' : String(value);
      el.addEventListener('change', function () {
        var opts = typeof def.options === 'function' ? def.options() : def.options;
        var match = opts.filter(function (o) { return String(o.value) === el.value; })[0];
        onCommit(match ? match.value : el.value);
      });
      return el;
    }

    if (type === 'toggle') {
      var cb = h('input', { type: 'checkbox', 'aria-label': def.label });
      cb.checked = !!value;
      cb.addEventListener('change', function () { onCommit(cb.checked); });
      return h('span.check', cb);
    }

    if (type === 'textarea') {
      el = h('textarea.input', { rows: def.rows || 3, placeholder: def.placeholder || '', 'aria-label': def.label });
      el.value = value || '';
      el.addEventListener('change', function () { onCommit(el.value); });
      return el;
    }

    if (type === 'text') {
      el = h('input.input', { type: 'text', placeholder: def.placeholder || '', 'aria-label': def.label });
      el.value = value == null ? '' : value;
      el.addEventListener('change', function () { onCommit(el.value); });
      return el;
    }

    // numeric types
    el = h('input.input.num', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off',
      placeholder: def.placeholder || (def.nullable ? 'default' : ''), 'aria-label': def.label
    });
    el.value = display(type, value);
    var last = el.value;
    function commit() {
      clearTimeout(timer);
      if (el.value === last) return;
      var n = parseNumber(el.value);
      if (n == null) {
        if (def.nullable) { last = el.value = ''; onCommit(null); return; }
        el.value = last; return;
      }
      if (type === 'percent') n = n / 100;
      if (type === 'age' || def.integer) n = Math.round(n);
      if (def.min != null) n = Math.max(def.min, n);
      if (def.max != null) n = Math.min(def.max, n);
      last = el.value = display(type, n);
      onCommit(n);
    }
    el.addEventListener('change', commit);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { commit(); el.select(); }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && type !== 'money') {
        var n = parseNumber(el.value) || 0;
        var step = def.step || (type === 'percent' ? 0.1 : 1);
        el.value = String(Math.round((n + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000);
        commit();
        e.preventDefault();
      }
    });
    el.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(commit, 700); });
    el.addEventListener('focus', function () { setTimeout(function () { el.select(); }, 0); });
    var wrap = h('div.input-wrap' + (type === 'money' ? '.prefix' : '') + (type === 'percent' ? '.suffix' : '') + (type === 'age' ? '.suffix-age' : ''), el);
    wrap.dataset.affix = type === 'money' ? '$' : type === 'percent' ? '%' : type === 'age' ? 'yrs' : '';
    return wrap;
  };

  /** A labelled input bound to a store path, with scenario-override indicator. */
  ui.field = function (def) {
    var store = RP.store;
    var value = store.get(def.path);
    var input = ui.input(def, value, function (v) { store.set(def.path, v, { structural: def.structural || def.type === 'select' || def.type === 'toggle' }); });
    var reset = h('button.override-reset', {
      type: 'button', title: 'Overridden in this scenario — click to revert to the base plan value',
      onclick: function () { store.resetOverride(def.path); }
    }, ui.icon('reset', 12));
    var row = h('div.field' + (def.type === 'toggle' ? '.field-toggle' : '') + (def.wide ? '.field-wide' : ''), { dataset: { path: def.path } },
      h('label.field-label', h('span', def.label), reset, def.help ? h('span.help', { tabindex: 0, 'data-tip': def.help }, ui.icon('info', 12)) : null),
      input);
    if (store.isOverridden(def.path)) row.classList.add('overridden');
    return linkLabel(row);
  };

  /** Clicking a checkbox's label text toggles it, as in native dialogs. */
  function linkLabel(row) {
    var cb = row.querySelector('input[type=checkbox]'), lab = row.querySelector('label.field-label');
    if (cb && lab) { cb.id = U.uid('cb'); lab.htmlFor = cb.id; }
    return row;
  }

  /** Update override markers without re-rendering inputs (keeps focus). */
  ui.refreshFieldStates = function (root) {
    (root || document).querySelectorAll('.field[data-path]').forEach(function (el) {
      el.classList.toggle('overridden', RP.store.isOverridden(el.dataset.path));
    });
  };

  /** Grid of fields. */
  ui.fields = function (defs, cols) {
    return h('div.field-grid' + (cols === 1 ? '.cols-1' : ''), defs.filter(Boolean).map(function (d) { return d instanceof Node ? d : ui.field(d); }));
  };

  /** Segmented control bound to a path. */
  ui.segmented = function (path, options, label) {
    var cur = RP.store.get(path);
    var row = h('div.field.field-wide', { dataset: { path: path } },
      label ? h('label.field-label', h('span', label), h('button.override-reset', { type: 'button', title: 'Revert to base plan', onclick: function () { RP.store.resetOverride(path); } }, ui.icon('reset', 12))) : null,
      h('div.segmented', { role: 'radiogroup' }, options.map(function (o) {
        return h('button' + (String(o.value) === String(cur) ? '.active' : ''), {
          type: 'button', role: 'radio', 'aria-checked': String(String(o.value) === String(cur)),
          onclick: function () { RP.store.set(path, o.value, { structural: true }); }
        }, o.label);
      })));
    if (RP.store.isOverridden(path)) row.classList.add('overridden');
    return row;
  };

  /** Build a form for an object (e.g. an event) from field defs. Mutates `obj`. */
  ui.objectForm = function (defs, obj, onChange) {
    return h('div.field-grid', defs.map(function (d) {
      var row = h('div.field' + (d.type === 'toggle' ? '.field-toggle' : '') + (d.type === 'text' || d.wide ? '.field-wide' : ''),
        h('label.field-label', h('span', d.label), d.help ? h('span.help', { tabindex: 0, 'data-tip': d.help }, ui.icon('info', 12)) : null),
        ui.input(d, obj[d.key], function (v) { obj[d.key] = v; if (onChange) onChange(obj, d.key); }));
      return linkLabel(row);
    }));
  };

  ui.PROVINCES = function () {
    var d = RP.tax.dataFor(RP.store ? RP.store.get('tax.year') : null);
    return Object.keys(d.provinces).sort(function (a, b) { return d.provinces[a].name.localeCompare(d.provinces[b].name); })
      .map(function (k) { return { value: k, label: d.provinces[k].name }; });
  };

  U.noop = function () {};
})(globalThis.RP);
