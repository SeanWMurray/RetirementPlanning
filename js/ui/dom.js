/*
 * dom.js — tiny DOM helpers (no framework).
 *
 *   h('div.card#main', { onclick: fn, title: 'x' }, child, [children], 'text')
 */
(function (RP) {
  'use strict';
  var ui = RP.ui = RP.ui || {};

  /** Main-area tabs: { id, label, render(host, args) }. Panels register themselves. */
  RP.tabs = RP.createRegistry('tabs');

  function h(sel, attrs) {
    var m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
    var el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, t, v) {
      if (t === '.') el.classList.add(v); else el.id = v;
    });
    var start = 1;
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      start = 2;
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(function (c) { el.classList.add(c); });
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k in el && k !== 'list' && k !== 'type' && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = start; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  ui.h = h;
  ui.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /** Inline SVG icons (Lucide-style strokes). */
  var ICONS = {
    plus: 'M12 5v14M5 12h14',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
    edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
    redo: 'M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
    file: 'M14 3H6v18h12V7zM14 3v4h4',
    print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
    up: 'M18 15l-6-6-6 6',
    down: 'M6 9l6 6 6-6',
    reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
    sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
    x: 'M18 6L6 18M6 6l12 12',
    check: 'M20 6L9 17l-5-5',
    alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    info: 'M12 16v-4M12 8h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
    play: 'M6 4l14 8-14 8z',
    layers: 'M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
    csv: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16'
  };
  ui.icon = function (name, size) {
    var s = size || 14;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', s); svg.setAttribute('height', s);
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || ICONS.info);
    svg.appendChild(p);
    return svg;
  };

  ui.button = function (label, onclick, opts) {
    opts = opts || {};
    return h('button.btn' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''),
      { type: 'button', onclick: onclick, title: opts.title || (typeof label === 'string' ? null : opts.title), disabled: opts.disabled, 'aria-label': opts.aria || null },
      opts.icon ? ui.icon(opts.icon, opts.iconSize) : null, label ? h('span', label) : null);
  };

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  ui.modal = function (title, body, actions, opts) {
    opts = opts || {};
    var back = h('div.modal-backdrop');
    function close() { back.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    var dlg = h('div.modal' + (opts.wide ? '.modal-wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.modal-head', h('h2', title), ui.button(null, close, { icon: 'x', cls: 'ghost icon-only', aria: 'Close' })),
      h('div.modal-body', body),
      actions && actions.length ? h('div.modal-foot', actions.map(function (a) {
        return ui.button(a.label, function () { if (a.onclick() !== false) close(); }, { cls: a.primary ? 'primary' : (a.danger ? 'danger' : '') });
      })) : null);
    back.appendChild(dlg);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    var first = dlg.querySelector('input,select,textarea');
    if (first) setTimeout(function () { first.focus(); }, 0);
    return { close: close, el: dlg };
  };

  ui.confirm = function (title, message, onYes, yesLabel) {
    ui.modal(title, h('p', message), [
      { label: 'Cancel', onclick: function () {} },
      { label: yesLabel || 'Confirm', danger: true, onclick: onYes }
    ]);
  };

  // ---------------------------------------------------------------------------
  // Popup menu positioned at a point
  // ---------------------------------------------------------------------------
  var openMenu = null, openMenuClose = null;
  ui.closeMenu = function () {
    if (openMenu) { openMenu.remove(); openMenu = null; }
    if (openMenuClose) { var f = openMenuClose; openMenuClose = null; f(); }
  };
  /**
   * items: [{ label, onclick, hint?, checked?, disabled?, swatch? } | { separator: true } | { heading: 'text' }]
   * opts:  { onClose }
   */
  ui.menu = function (x, y, items, header, opts) {
    ui.closeMenu();
    var m = h('div.menu', { role: 'menu' }, header ? h('div.menu-header', header) : null,
      items.map(function (it) {
        if (it.separator) return h('div.menu-sep');
        if (it.heading) return h('div.menu-heading', it.heading);
        return h('button.menu-item', { type: 'button', role: it.checked != null ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked != null ? String(!!it.checked) : null,
          disabled: it.disabled, onclick: function () { ui.closeMenu(); it.onclick(); } },
          h('span.menu-check', it.checked ? '\u2713' : (it.swatch ? h('span.swatch', { style: { background: it.swatch } }) : '')),
          h('span.menu-label', it.label), it.hint ? h('span.menu-hint', it.hint) : null);
      }));
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    m.style.left = Math.max(0, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(0, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    openMenu = m;
    openMenuClose = opts && opts.onClose || null;
    setTimeout(function () {
      document.addEventListener('mousedown', function off(e) {
        if (!m.contains(e.target)) { if (openMenu === m) ui.closeMenu(); document.removeEventListener('mousedown', off); }
      });
    }, 0);
    return m;
  };
  ui.menuOpen = function () { return !!openMenu; };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') ui.closeMenu(); });

  /** Transient messages go to the status bar (falls back to the console). */
  ui.toast = function (msg, kind) {
    if (RP.app && RP.app.status) RP.app.status(msg, kind);
    else console.log(msg);
  };

  ui.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  };

  ui.pickFile = function (accept, cb) {
    var inp = h('input', { type: 'file', accept: accept, style: { display: 'none' } });
    inp.addEventListener('change', function () {
      var f = inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { cb(r.result, f); inp.remove(); };
      r.readAsText(f);
    });
    document.body.appendChild(inp);
    inp.click();
  };

  ui.slug = function (s) { return String(s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'; };

  /** Read a CSS custom property from :root (for Chart.js colours). */
  ui.cssVar = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };
})(globalThis.RP);
