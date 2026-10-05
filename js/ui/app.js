/*
 * app.js — wires the store to the page: header, scenario bar, KPI strip, tabs.
 *
 * KPI tiles are a registry too (RP.kpis): { id, label, value(result, real) -> number|string, format, sub?, better? }
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;
  var app = RP.app = {};
  var els = {};
  var tabArgs = null;

  // ---------------------------------------------------------------------------
  var K = RP.kpis = RP.createRegistry('kpis');
  K.register({ id: 'atRet', label: 'Portfolio at retirement', better: 1, format: fmt.compact,
    value: function (r, real) { return real ? r.summary.atRetirementReal : r.summary.atRetirement; },
    sub: function (r) { return 'age ' + r.plan.profile.retirementAge; } });
  K.register({ id: 'lasts', label: 'Money lasts to', better: 1,
    value: function (r) { var s = r.summary; return s.firstShortfallAge == null ? s.endAge + 1 : s.firstShortfallAge; },
    format: function (v, r) { return r.summary.firstShortfallAge == null ? 'Age ' + r.summary.endAge + '+' : 'Age ' + v; },
    status: function (r) { return r.summary.firstShortfallAge == null ? 'good' : 'critical'; },
    sub: function (r) { return r.summary.firstShortfallAge == null ? 'fully funded' : r.summary.shortfallYears + ' yrs short'; } });
  K.register({ id: 'ending', label: 'Ending portfolio', better: 1, format: fmt.compact,
    value: function (r, real) { return real ? r.summary.endingReal : r.summary.ending; },
    sub: function (r) { return 'at age ' + r.summary.endAge; } });
  K.register({ id: 'retSpend', label: 'Retirement spending', format: fmt.money,
    value: function (r, real) { var y = r.years.filter(function (x) { return x.retired; })[0]; return y ? (real ? y.spending / y.cpi : y.spending) : null; },
    sub: function () { return 'first year, per year'; } });
  K.register({ id: 'tax', label: 'Lifetime tax', better: -1, format: fmt.compact,
    value: function (r, real) { return real ? r.summary.lifetimeTaxReal : r.summary.lifetimeTax; },
    sub: function () { return 'incl. CPP/EI & clawback'; } });

  // ---------------------------------------------------------------------------
  app.init = function () {
    RP.store.init();
    applyTheme();
    buildShell();
    RP.store.subscribe(onStore);
    renderAll();
    document.addEventListener('keydown', function (e) {
      var inField = /input|textarea|select/i.test(document.activeElement && document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && !inField && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) RP.store.redo(); else RP.store.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); exportPlan(); }
    });
    window.addEventListener('beforeprint', function () { document.body.classList.add('printing'); });
    window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });
  };

  function onStore(kind) {
    if (kind === 'structure') { renderInputs(); renderScenarioBar(); renderHeaderState(); }
    else if (kind === 'data') { ui.refreshFieldStates(els.inputs); ui.refreshSummaries(els.inputs); renderHeaderState(); }
    else if (kind === 'results') { renderKpis(); app.renderTab(); renderScenarioBar(); }
    else if (kind === 'settings') { renderKpis(); app.renderTab(); renderHeaderState(); }
    else if (kind === 'saved') renderSaved();
  }

  function renderAll() { renderInputs(); renderScenarioBar(); renderKpis(); renderTabs(); app.renderTab(); renderHeaderState(); }

  // ---------------------------------------------------------------------------
  function buildShell() {
    var root = document.getElementById('app');
    ui.clear(root);

    els.name = h('input.plan-name', { type: 'text', 'aria-label': 'Plan name', value: RP.store.doc.meta.name,
      onchange: function (e) { RP.store.update(function (d) { d.meta.name = e.target.value || 'Untitled plan'; }, false); } });
    els.saved = h('span.saved-state');
    els.undo = ui.button(null, function () { RP.store.undo(); }, { icon: 'undo', cls: 'ghost icon-only', aria: 'Undo', title: 'Undo (Ctrl+Z)' });
    els.redo = ui.button(null, function () { RP.store.redo(); }, { icon: 'redo', cls: 'ghost icon-only', aria: 'Redo', title: 'Redo (Ctrl+Shift+Z)' });
    els.real = h('div.segmented.small', { role: 'radiogroup', 'aria-label': 'Dollar basis' });
    els.theme = ui.button(null, cycleTheme, { icon: 'moon', cls: 'ghost icon-only', aria: 'Toggle theme', title: 'Theme' });

    var fileBtn = ui.button('File', function (e) {
      var r = e.currentTarget.getBoundingClientRect();
      ui.menu(r.left, r.bottom + 4, [
        { label: 'Export plan (.json)', hint: 'Ctrl+S', onclick: exportPlan },
        { label: 'Import plan…', onclick: importPlan },
        { separator: true },
        { label: 'Export table (.csv)', onclick: function () { app.showTab('projection'); setTimeout(function () { var b = document.querySelector('.card .btn-row button[title^="Download"]'); if (b) b.click(); }, 50); } },
        { label: 'Print / save as PDF', onclick: function () { app.showTab('projection'); setTimeout(function () { window.print(); }, 300); } },
        { separator: true },
        { label: 'New plan (start over)', onclick: function () {
          ui.confirm('Start a new plan?', 'This replaces the plan in this browser with the defaults. Export first if you want to keep it. (You can undo.)', function () { RP.store.reset(); els.name.value = RP.store.doc.meta.name; }, 'Start over');
        } }
      ]);
    }, { icon: 'file', cls: 'ghost' });

    var header = h('header.topbar',
      h('div.brand', h('span.logo', { 'aria-hidden': 'true' }, h('span'), h('span'), h('span')), h('span.brand-name', 'Retirement Planner'), h('span.brand-tag', 'Canada')),
      h('div.plan-meta', els.name, els.saved),
      h('div.spacer'),
      els.real, h('div.divider'), els.undo, els.redo, fileBtn, els.theme);

    els.scenarioBar = h('div.scenario-bar');
    els.inputs = h('div.inputs');
    els.kpis = h('div.kpis');
    els.tabs = h('nav.tabs', { role: 'tablist' });
    els.tab = h('div.tab-host', { role: 'tabpanel' });
    els.main = h('main.main', els.kpis, els.tabs, els.tab);

    root.appendChild(header);
    root.appendChild(h('div.layout',
      h('aside.sidebar', { 'aria-label': 'Plan inputs' }, els.scenarioBar, els.inputs),
      els.main));
    root.appendChild(h('footer.print-footer', 'Generated ' + new Date().toLocaleDateString('en-CA') + ' · Canadian Retirement Planner · estimates only, not financial advice'));
  }

  function renderHeaderState() {
    var real = RP.store.doc.settings.realDollars;
    ui.clear(els.real);
    [{ v: true, l: "Today's $" }, { v: false, l: 'Future $' }].forEach(function (o) {
      els.real.appendChild(h('button' + (real === o.v ? '.active' : ''), {
        type: 'button', role: 'radio', 'aria-checked': String(real === o.v),
        title: o.v ? 'Show amounts in today’s purchasing power' : 'Show nominal amounts (what the numbers will actually read in that year)',
        onclick: function () { RP.store.updateSettings({ realDollars: o.v }); }
      }, o.l));
    });
    els.undo.disabled = !RP.store.canUndo();
    els.redo.disabled = !RP.store.canRedo();
    if (document.activeElement !== els.name) els.name.value = RP.store.doc.meta.name;
  }

  function renderSaved() {
    var t = RP.store.lastSaved;
    els.saved.textContent = t ? 'Saved in browser ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not saved (storage unavailable — use Export)';
  }

  function renderInputs() {
    var scroll = els.inputs.parentNode ? els.inputs.parentNode.scrollTop : 0;
    ui.renderInputs(els.inputs);
    if (els.inputs.parentNode) els.inputs.parentNode.scrollTop = scroll;
  }

  function renderScenarioBar() {
    var store = RP.store;
    ui.clear(els.scenarioBar);
    var items = [{ id: 'base', name: 'Base plan', color: '#2a78d6' }].concat(store.doc.scenarios);
    els.scenarioBar.appendChild(h('div.scenario-tabs', { role: 'tablist', 'aria-label': 'Scenario being edited' },
      items.map(function (s) {
        return h('button.sc-tab' + (store.active === s.id ? '.active' : ''), {
          type: 'button', role: 'tab', 'aria-selected': String(store.active === s.id), style: { '--sc': s.color },
          onclick: function () { store.setActive(s.id); }, title: 'Edit ' + s.name
        }, h('span.swatch', { style: { background: s.color } }), s.name);
      }),
      h('button.sc-tab.sc-add', { type: 'button', title: 'New scenario', onclick: function (e) { RP.ui.newScenarioMenu(e.clientX, e.clientY); } }, ui.icon('plus', 14), 'Scenario')));
  }

  function renderKpis() {
    var store = RP.store;
    ui.clear(els.kpis);
    if (store.error) {
      els.kpis.appendChild(h('div.callout.callout-error', ui.icon('alert'), h('span', 'Calculation error: ' + store.error.message)));
      return;
    }
    var act = store.activeResult(), base = store.baseResult();
    if (!act) return;
    var real = store.doc.settings.realDollars;
    var isSc = act.id !== 'base';
    K.list().forEach(function (k) {
      var v = k.value(act.result, real);
      var delta = null;
      if (isSc && k.better && typeof v === 'number') {
        var bv = k.value(base.result, real);
        if (Math.abs(v - bv) > 0.5) {
          var good = (v - bv) * k.better > 0;
          var txt = k.format === fmt.compact || k.format === fmt.money ? fmt.compact(v - bv) : (v - bv > 0 ? '+' : '') + Math.round(v - bv) + ' yrs';
          if (txt.charAt(0) !== '−' && txt.charAt(0) !== '+') txt = '+' + txt;
          delta = h('span.delta' + (good ? '.good' : '.bad'), txt + ' vs base');
        }
      }
      var status = k.status ? k.status(act.result) : null;
      els.kpis.appendChild(h('div.kpi',
        h('div.kpi-label', k.label),
        h('div.kpi-value' + (status ? '.status-' + status : ''), status ? ui.icon(status === 'good' ? 'check' : 'alert', 18) : null, status ? ' ' : null, k.format(v, act.result)),
        h('div.kpi-sub', k.sub ? k.sub(act.result) : '', delta ? ' · ' : null, delta)));
    });
    els.kpis.appendChild(h('div.kpi.kpi-context',
      h('div.kpi-label', 'Showing'),
      h('div.kpi-value.small', h('span.swatch', { style: { background: act.color } }), ' ', act.name),
      h('div.kpi-sub', real ? "today's dollars" : 'future dollars')));
  }

  function renderTabs() {
    ui.clear(els.tabs);
    var cur = RP.store.doc.settings.activeTab;
    RP.tabs.list().forEach(function (t) {
      els.tabs.appendChild(h('button.tab' + (t.id === cur ? '.active' : ''), {
        type: 'button', role: 'tab', 'aria-selected': String(t.id === cur), onclick: function () { app.showTab(t.id); }
      }, t.label));
    });
  }

  app.showTab = function (id, args) {
    tabArgs = args || null;
    RP.store.doc.settings.activeTab = id;
    renderTabs();
    app.renderTab();
    els.main.scrollTop = 0;
  };

  app.renderTab = function () {
    var id = RP.store.doc.settings.activeTab;
    var tab = RP.tabs.get(id) || RP.tabs.list()[0];
    if (!RP.store.results) return;
    var scroll = els.main.scrollTop;
    var wraps = Array.prototype.map.call(els.tab.querySelectorAll('.table-wrap'), function (w) { return [w.scrollTop, w.scrollLeft]; });
    els.tab.style.minHeight = els.tab.offsetHeight + 'px';
    ui.clear(els.tab);
    try {
      tab.render(els.tab, tabArgs);
    } catch (e) {
      console.error(e);
      els.tab.appendChild(h('div.callout.callout-error', ui.icon('alert'), h('span', 'Could not render this tab: ' + e.message)));
    }
    tabArgs = null;
    Array.prototype.forEach.call(els.tab.querySelectorAll('.table-wrap'), function (w, i) { if (wraps[i]) { w.scrollTop = wraps[i][0]; w.scrollLeft = wraps[i][1]; } });
    els.tab.style.minHeight = '';
    els.main.scrollTop = scroll;
  };

  // ---------------------------------------------------------------------------
  function exportPlan() {
    ui.download(ui.slug(RP.store.doc.meta.name) + '.retirement-plan.json', RP.store.exportJson());
    ui.toast('Plan exported');
  }
  function importPlan() {
    ui.pickFile('.json,application/json', function (text, file) {
      try {
        RP.store.importJson(text);
        els.name.value = RP.store.doc.meta.name;
        ui.toast('Imported ' + file.name);
      } catch (e) {
        ui.toast('Import failed: ' + e.message, 'error');
      }
    });
  }
  app.exportPlan = exportPlan;
  app.importPlan = importPlan;

  // ---------------------------------------------------------------------------
  function applyTheme() {
    var t = RP.store.ui.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  function cycleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    RP.store.ui.theme = dark ? 'light' : 'dark';
    RP.store.saveUi();
    applyTheme();
    app.renderTab();
  }

  // Drag & drop a plan file anywhere to import it.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { RP.store.importJson(r.result); els.name.value = RP.store.doc.meta.name; ui.toast('Imported ' + f.name); }
      catch (err) { ui.toast('Import failed: ' + err.message, 'error'); }
    };
    r.readAsText(f);
  });

  document.addEventListener('DOMContentLoaded', app.init);
})(globalThis.RP);
