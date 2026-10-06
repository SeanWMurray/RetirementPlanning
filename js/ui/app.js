/*
 * app.js — the application shell: menu bar, toolbar, resizable panes,
 * summary strip, document tabs and status bar.
 *
 * Extension points:
 *   RP.kpis     — summary-strip cells: { id, label, value(result, real), format, sub?, better?, status? }
 *   RP.menubar  — top-level menus:     { id, label, items() -> menu item array (see ui.menu) }
 */
(function (RP) {
  'use strict';
  var ui = RP.ui, h = ui.h, fmt = RP.fmt;
  var app = RP.app = {};
  var els = {};
  var tabArgs = null;
  var statusTimer = null;

  // ---------------------------------------------------------------------------
  // Summary strip
  // ---------------------------------------------------------------------------
  var K = RP.kpis = RP.createRegistry('kpis');
  K.register({ id: 'atRet', label: 'Portfolio at retirement', better: 1, format: fmt.compact,
    value: function (r, real) { return real ? r.summary.atRetirementReal : r.summary.atRetirement; },
    sub: function (r) { return 'age ' + r.plan.profile.retirementAge; } });
  K.register({ id: 'lasts', label: 'Money lasts to', better: 1,
    value: function (r) { var s = r.summary; return s.firstShortfallAge == null ? s.endAge + 1 : s.firstShortfallAge; },
    format: function (v, r) { return r.summary.firstShortfallAge == null ? 'Age ' + r.summary.endAge + '+' : 'Age ' + v; },
    status: function (r) { return r.summary.firstShortfallAge == null ? 'good' : 'critical'; },
    sub: function (r) { return r.summary.firstShortfallAge == null ? 'Fully funded' : r.summary.shortfallYears + ' year(s) short'; } });
  K.register({ id: 'ending', label: 'Ending portfolio', better: 1, format: fmt.compact,
    value: function (r, real) { return real ? r.summary.endingReal : r.summary.ending; },
    sub: function (r) { return 'age ' + r.summary.endAge; } });
  K.register({ id: 'retSpend', label: 'Retirement spending', format: fmt.money,
    value: function (r, real) { var y = r.years.filter(function (x) { return x.retired; })[0]; return y ? (real ? y.spending / y.cpi : y.spending) : null; },
    sub: function () { return 'first year'; } });
  K.register({ id: 'tax', label: 'Lifetime tax', better: -1, format: fmt.compact,
    value: function (r, real) { return real ? r.summary.lifetimeTaxReal : r.summary.lifetimeTax; },
    sub: function () { return 'incl. CPP/EI, clawback'; } });

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------
  var M = RP.menubar = RP.createRegistry('menubar');
  function S() { return RP.store; }

  M.register({ id: 'file', label: 'File', items: function () {
    return [
      { label: 'New Plan', onclick: newPlan },
      { label: 'Open Plan…', hint: 'Ctrl+O', onclick: importPlan },
      { label: 'Paste Plan…', onclick: pastePlan },
      { label: 'Open Example…', disabled: !(RP.examples && RP.examples.length), onclick: openExample },
      { label: 'Save Plan As…', hint: 'Ctrl+S', onclick: exportPlan },
      { separator: true },
      { label: 'Export Table to CSV…', onclick: function () { app.showTab('projection'); setTimeout(function () { var b = document.querySelector('[data-action="csv"]'); if (b) b.click(); }, 50); } },
      { label: 'Print…', hint: 'Ctrl+P', onclick: printPlan },
      { separator: true },
      { label: 'Plan Notes', onclick: function () { app.showTab('about'); } }
    ];
  } });
  M.register({ id: 'edit', label: 'Edit', items: function () {
    var sc = S().scenario();
    return [
      { label: 'Undo', hint: 'Ctrl+Z', disabled: !S().canUndo(), onclick: function () { S().undo(); } },
      { label: 'Redo', hint: 'Ctrl+Y', disabled: !S().canRedo(), onclick: function () { S().redo(); } },
      { separator: true },
      { label: 'Add Event…', onclick: function () { var r = els.tabs.getBoundingClientRect(); ui.addEventMenu(r.left + 40, r.top + 10, Number(S().get('profile.retirementAge'))); } },
      { label: 'Clear Scenario Overrides', disabled: !sc || !Object.keys(sc.overrides).length, onclick: function () {
        ui.confirm('Clear overrides', 'Remove every override in "' + sc.name + '" so it matches the base plan again? Scenario-only events are kept.', function () {
          S().update(function () { sc.overrides = {}; });
        }, 'Clear');
      } }
    ];
  } });
  M.register({ id: 'view', label: 'View', items: function () {
    var st = S().doc.settings, theme = S().ui.theme || 'auto', layout = S().ui.layout || 'auto';
    var items = [
      { label: "Today's Dollars", checked: st.realDollars, onclick: function () { S().updateSettings({ realDollars: true }); } },
      { label: 'Future (Nominal) Dollars', checked: !st.realDollars, onclick: function () { S().updateSettings({ realDollars: false }); } },
      { separator: true },
      { label: 'Chart: Stacked by Account', checked: st.chartMode === 'stacked', onclick: function () { S().updateSettings({ chartMode: 'stacked' }); } },
      { label: 'Chart: Totals Only', checked: st.chartMode === 'total', onclick: function () { S().updateSettings({ chartMode: 'total' }); } },
      { separator: true },
      { label: 'Input Panel', checked: !S().ui.sidebarHidden, hint: 'Ctrl+B', onclick: toggleSidebar },
      { label: 'Expand All Inputs', onclick: function () { setAllSections(true); } },
      { label: 'Collapse All Inputs', onclick: function () { setAllSections(false); } },
      { separator: true },
      { label: 'Theme: System', checked: theme === 'auto', onclick: function () { setTheme('auto'); } },
      { label: 'Theme: Light', checked: theme === 'light', onclick: function () { setTheme('light'); } },
      { label: 'Theme: Dark', checked: theme === 'dark', onclick: function () { setTheme('dark'); } },
      { separator: true },
      { label: 'Layout: Automatic', checked: layout === 'auto', onclick: function () { setLayout('auto'); } },
      { label: 'Layout: Desktop', checked: layout === 'desktop', onclick: function () { setLayout('desktop'); } },
      { label: 'Layout: Phone', checked: layout === 'phone', onclick: function () { setLayout('phone'); } },
      { separator: true }
    ];
    RP.tabs.list().forEach(function (t, i) {
      items.push({ label: t.label, hint: 'Alt+' + (i + 1), checked: st.activeTab === t.id, onclick: function () { app.showTab(t.id); } });
    });
    return items;
  } });
  M.register({ id: 'scenario', label: 'Scenario', items: function () {
    var store = S(), sc = store.scenario();
    var items = [{ label: 'Base Plan', checked: store.active === 'base', swatch: RP.ui.cssVar('--series-1'), onclick: function () { store.setActive('base'); } }];
    store.doc.scenarios.forEach(function (s) { items.push({ label: s.name, checked: store.active === s.id, swatch: s.color, onclick: function () { store.setActive(s.id); } }); });
    items.push({ separator: true }, { heading: 'New scenario' });
    RP.scenarioTemplates.list().forEach(function (t) {
      items.push({ label: t.label, onclick: function () { store.addScenario(t.id === 'blank' ? null : t.label, function (s) { t.init(s, store.effective('base')); }); } });
    });
    items.push({ separator: true },
      { label: 'Duplicate Current', onclick: function () { store.duplicateScenario(store.active); } },
      { label: 'Rename Current…', disabled: !sc, onclick: function () { renameScenario(sc); } },
      { label: 'Promote Current to Base Plan…', disabled: !sc, onclick: function () {
        ui.confirm('Promote to base plan', 'Replace the base plan with "' + sc.name + '"? Other scenarios become relative to it.', function () { store.promoteScenario(sc.id); }, 'Promote');
      } },
      { label: 'Delete Current…', disabled: !sc, onclick: function () { ui.confirm('Delete scenario', 'Delete "' + sc.name + '"?', function () { store.removeScenario(sc.id); }, 'Delete'); } },
      { separator: true },
      { label: 'Compare Scenarios', onclick: function () { app.showTab('scenarios'); } });
    return items;
  } });
  M.register({ id: 'insert', label: 'Insert', items: function () {
    var age = Number(S().get('profile.retirementAge'));
    return [{ heading: 'Add an event (edit the age in the dialog)' }].concat(RP.eventTypes.list().map(function (def) {
      return { label: def.label + '…', swatch: def.color, onclick: function () { ui.newEventModal(def.id, age); } };
    }));
  } });
  M.register({ id: 'tools', label: 'Tools', items: function () {
    return [
      { label: 'Sensitivity Analysis', onclick: function () { app.showTab('analysis'); } },
      { label: 'Monte Carlo Simulation', onclick: function () { app.showTab('montecarlo'); } },
      { label: 'Tax Detail', onclick: function () { app.showTab('tax'); } },
      { label: 'Events Timeline', onclick: function () { app.showTab('events'); } }
    ];
  } });
  M.register({ id: 'help', label: 'Help', items: function () {
    return [
      { label: 'Methodology & Limitations', onclick: function () { app.showTab('about'); } },
      { label: 'Plan File Specification (for AI)…', onclick: showSpec },
      { label: 'Keyboard Shortcuts', onclick: showShortcuts },
      { separator: true },
      { label: 'About Retirement Planner', onclick: showAbout }
    ];
  } });

  // ---------------------------------------------------------------------------
  app.init = function () {
    RP.store.init();
    applyTheme();
    buildShell();
    RP.store.subscribe(onStore);
    renderAll();
    app.status('Ready');
    document.addEventListener('keydown', onKey);
    setMobileView(RP.store.ui.mview || 'results', true);
    applyLayout();
    var t;
    var relayout = function () { clearTimeout(t); t = setTimeout(function () { if (applyLayout()) app.renderTab(); }, 150); };
    window.addEventListener('resize', relayout);
    window.addEventListener('load', relayout);
    window.addEventListener('orientationchange', relayout);
  };

  // ---------------------------------------------------------------------------
  // Phone layout: a compact header, one pane at a time (Inputs or Results),
  // and a bottom navigation bar. Desktop layout is unchanged.
  // ---------------------------------------------------------------------------
  // The phone layout is a body class rather than a CSS media query so it also applies when a
  // phone lays the page out at desktop width (Chrome's "Desktop site", or an embed in a page
  // without a mobile viewport tag). View > Layout can force either layout.
  var MOBILE_QUERY = '(max-width: 820px)';
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  /** Shortest side of the physical screen in CSS px, or 0 if unknown. */
  function screenShort() { var sc = window.screen; return sc && sc.width && sc.height ? Math.min(sc.width, sc.height) : 0; }
  function isPhoneScreen() { var s = screenShort(); return s > 0 && s <= 600 && mq('(pointer: coarse)'); }
  function wantMobile() {
    var pref = RP.store.ui.layout || 'auto';
    if (pref === 'phone') return true;
    if (pref === 'desktop') return false;
    return mq(MOBILE_QUERY) || isPhoneScreen();
  }
  app.isMobile = function () { return document.body.classList.contains('is-mobile'); };

  /**
   * Toggle the phone layout and, when a phone has laid the page out much wider than its screen,
   * zoom the page so the phone layout fills the screen at a readable size.
   * Returns true when the layout changed.
   */
  function applyLayout() {
    var root = document.documentElement, was = app.isMobile(), wasZoom = root.style.zoom;
    var mobile = wantMobile();
    root.style.zoom = '';
    var zoom = 1, layoutH = 0;
    if (mobile && isPhoneScreen()) {
      var sc = window.screen;
      var screenW = mq('(orientation: landscape)') ? Math.max(sc.width, sc.height) : Math.min(sc.width, sc.height);
      var layoutW = root.clientWidth || window.innerWidth;
      layoutH = root.clientHeight || window.innerHeight;
      if (screenW > 0 && layoutW > screenW * 1.25) zoom = Math.round(layoutW / screenW * 100) / 100;
    }
    if (zoom !== 1) root.style.zoom = String(zoom);
    root.style.setProperty('--app-h', zoom !== 1 ? (layoutH / zoom) + 'px' : '');
    document.body.classList.toggle('is-mobile', mobile);
    return was !== mobile || wasZoom !== root.style.zoom;
  }
  function setLayout(v) {
    RP.store.ui.layout = v; RP.store.saveUi();
    applyLayout(); app.renderTab();
  }

  function setMobileView(v, initial) {
    document.body.dataset.mview = v;
    if (els.mnav) els.mnav.querySelectorAll('button[data-view]').forEach(function (b) {
      var on = b.dataset.view === v;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
    });
    RP.store.ui.mview = v; RP.store.saveUi();
    if (!initial && app.isMobile()) {
      window.scrollTo(0, 0);
      if (els.main) els.main.scrollTop = 0;
      if (els.sidebar) els.sidebar.querySelector('.sidebar-scroll').scrollTop = 0;
      if (v === 'results') app.renderTab();   // charts need a visible container to size themselves
    }
  }
  app.setMobileView = setMobileView;

  /** All menu-bar menus in one bottom sheet (phones). */
  function openMobileMenu() {
    var items = [];
    M.list().forEach(function (def, i) {
      if (i) items.push({ separator: true });
      items.push({ heading: def.label });
      def.items().forEach(function (it) { if (!it.heading) items.push(it); });
    });
    ui.menu(0, 0, items);
  }

  function onKey(e) {
    var mod = e.ctrlKey || e.metaKey;
    var inField = /input|textarea|select/i.test(document.activeElement && document.activeElement.tagName);
    var k = e.key.toLowerCase();
    if (mod && !inField && k === 'z') { e.preventDefault(); if (e.shiftKey) RP.store.redo(); else RP.store.undo(); }
    else if (mod && !inField && k === 'y') { e.preventDefault(); RP.store.redo(); }
    else if (mod && k === 's') { e.preventDefault(); exportPlan(); }
    else if (mod && k === 'o') { e.preventDefault(); importPlan(); }
    else if (mod && k === 'p') { e.preventDefault(); printPlan(); }
    else if (mod && k === 'b') { e.preventDefault(); toggleSidebar(); }
    else if (e.altKey && /^[1-9]$/.test(e.key)) {
      var t = RP.tabs.list()[Number(e.key) - 1];
      if (t) { e.preventDefault(); app.showTab(t.id); }
    }
  }

  function onStore(kind) {
    if (kind === 'structure') { renderInputs(); renderToolbarState(); renderStatus(); }
    else if (kind === 'data') { ui.refreshFieldStates(els.inputs); ui.refreshSummaries(els.inputs); renderToolbarState(); }
    else if (kind === 'results') { renderKpis(); app.renderTab(); renderToolbarState(); renderStatus(); }
    else if (kind === 'settings') { renderKpis(); app.renderTab(); renderToolbarState(); renderStatus(); }
    else if (kind === 'saved') renderStatus();
  }

  function renderAll() { renderInputs(); renderToolbarState(); renderKpis(); renderTabs(); app.renderTab(); renderStatus(); }

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  function appIcon() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', 16); svg.setAttribute('height', 16);
    svg.innerHTML = '<rect x="1" y="9" width="3" height="6" fill="#2f64a8"/><rect x="6" y="5" width="3" height="10" fill="#2f64a8"/><rect x="11" y="1" width="3" height="14" fill="#e0812f"/>';
    return svg;
  }

  function buildShell() {
    var root = document.getElementById('app');
    ui.clear(root);

    // Menu bar
    var openId = null;
    function openMenu(def, btn) {
      var r = btn.getBoundingClientRect();
      els.menubar.querySelectorAll('.menubar-item').forEach(function (b) { b.classList.toggle('open', b === btn); });
      openId = def.id;
      ui.menu(r.left, r.bottom, def.items(), null, { onClose: function () { openId = null; btn.classList.remove('open'); } });
    }
    els.menubar = h('div.menubar', { role: 'menubar' },
      h('span.app-icon', appIcon()),
      M.list().map(function (def) {
        var btn = h('button.menubar-item', { type: 'button', role: 'menuitem' }, def.label);
        btn.addEventListener('mousedown', function (e) {
          e.stopPropagation();
          if (openId === def.id) { ui.closeMenu(); return; }
          openMenu(def, btn);
        });
        btn.addEventListener('mouseenter', function () { if (openId && openId !== def.id) openMenu(def, btn); });
        btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openMenu(def, btn); } });
        return btn;
      }),
      els.title = h('span.app-title'));

    // Toolbar
    els.name = h('input.input.plan-name', { type: 'text', 'aria-label': 'Plan name', value: RP.store.doc.meta.name,
      onchange: function (e) { RP.store.update(function (d) { d.meta.name = e.target.value || 'Untitled plan'; }, false); } });
    els.undo = ui.button(null, function () { RP.store.undo(); }, { icon: 'undo', cls: 'tool', aria: 'Undo', title: 'Undo (Ctrl+Z)' });
    els.redo = ui.button(null, function () { RP.store.redo(); }, { icon: 'redo', cls: 'tool', aria: 'Redo', title: 'Redo (Ctrl+Y)' });
    els.scChip = h('span.swatch.sc-chip');
    els.scSelect = h('select.input.scenario-select', { 'aria-label': 'Scenario being edited', onchange: function (e) {
      if (e.target.value === '__new') { var r = e.target.getBoundingClientRect(); renderToolbarState(); RP.ui.newScenarioMenu(r.left, r.bottom); }
      else RP.store.setActive(e.target.value);
    } });
    els.real = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Dollar basis' });

    els.toolbar = h('div.toolbar', { role: 'toolbar' },
      ui.button(null, newPlan, { icon: 'file', cls: 'tool', aria: 'New plan', title: 'New plan' }),
      ui.button(null, importPlan, { icon: 'upload', cls: 'tool', aria: 'Open plan', title: 'Open plan file (Ctrl+O)' }),
      ui.button(null, exportPlan, { icon: 'download', cls: 'tool', aria: 'Save plan', title: 'Save plan file (Ctrl+S)' }),
      ui.button(null, printPlan, { icon: 'print', cls: 'tool', aria: 'Print', title: 'Print / PDF (Ctrl+P)' }),
      h('span.sep'), els.undo, els.redo, h('span.sep'),
      h('label.tb-label', 'Plan'), els.name,
      h('span.sep'),
      h('label.tb-label', 'Scenario'), els.scChip, els.scSelect,
      ui.button(null, function (e) { var r = e.currentTarget.getBoundingClientRect(); RP.ui.newScenarioMenu(r.left, r.bottom); }, { icon: 'plus', cls: 'tool', aria: 'New scenario', title: 'New scenario' }),
      h('span.sep'),
      h('label.tb-label', 'Show'), els.real);

    // Workspace
    els.inputs = h('div.inputs');
    els.sidebar = h('aside.sidebar', { 'aria-label': 'Plan inputs' },
      h('div.sidebar-title', h('span', 'Plan Inputs'),
        h('span.btn-row',
          ui.button(null, function () { setAllSections(true); }, { icon: 'down', cls: 'ghost icon-only small', aria: 'Expand all', title: 'Expand all' }),
          ui.button(null, function () { setAllSections(false); }, { icon: 'up', cls: 'ghost icon-only small', aria: 'Collapse all', title: 'Collapse all' }))),
      h('div.sidebar-scroll', els.inputs));
    if (RP.store.ui.sidebarWidth) els.sidebar.style.width = RP.store.ui.sidebarWidth + 'px';
    els.splitter = h('div.splitter', { role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize' });
    els.splitter.addEventListener('mousedown', startResize);
    els.kpis = h('div.kpis');
    els.tabs = h('nav.tabs', { role: 'tablist' });
    els.tab = h('div.tab-host', { role: 'tabpanel' });
    els.main = h('main.main', els.kpis, els.tabs, els.tab);
    if (RP.store.ui.sidebarHidden) { els.sidebar.style.display = 'none'; els.splitter.style.display = 'none'; }

    // Status bar
    els.msg = h('span.status-msg', 'Ready');
    els.stEditing = h('span');
    els.stTax = h('span');
    els.stSaved = h('span');
    els.stBasis = h('span');

    // Phone chrome (hidden on desktop by CSS)
    els.mtitle = h('span.m-title');
    els.mbar = h('div.m-header', h('span.app-icon', appIcon()), els.mtitle);
    els.msum = h('button.m-summary', { type: 'button', onclick: function () { setMobileView('results'); } });
    els.sidebar.insertBefore(els.msum, els.sidebar.firstChild);
    function navBtn(view, label, icon) {
      return h('button', { type: 'button', role: 'tab', dataset: { view: view }, onclick: function () { setMobileView(view); } }, ui.icon(icon, 20), h('span', label));
    }
    els.mnav = h('nav.m-nav', { role: 'tablist', 'aria-label': 'View' },
      navBtn('inputs', 'Inputs', 'edit'), navBtn('results', 'Results', 'csv'),
      h('button', { type: 'button', onclick: openMobileMenu }, ui.icon('layers', 20), h('span', 'Menu')));

    root.appendChild(els.mbar);
    root.appendChild(els.menubar);
    root.appendChild(els.toolbar);
    root.appendChild(h('div.workspace', els.sidebar, els.splitter, els.main));
    root.appendChild(h('footer.statusbar', els.msg, els.stEditing, els.stTax, els.stBasis, els.stSaved));
    root.appendChild(els.mnav);
    root.appendChild(h('div.print-footer', 'Generated ' + new Date().toLocaleDateString('en-CA') + ' · Canadian Retirement Planner · estimates only, not financial advice'));
  }

  function startResize(e) {
    e.preventDefault();
    var startX = e.clientX, startW = els.sidebar.getBoundingClientRect().width;
    els.splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    function move(ev) { els.sidebar.style.width = Math.max(260, Math.min(window.innerWidth * 0.6, startW + ev.clientX - startX)) + 'px'; }
    function up() {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      els.splitter.classList.remove('dragging'); document.body.style.cursor = '';
      RP.store.ui.sidebarWidth = Math.round(els.sidebar.getBoundingClientRect().width); RP.store.saveUi();
    }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  function toggleSidebar() {
    var hide = els.sidebar.style.display !== 'none';
    els.sidebar.style.display = hide ? 'none' : '';
    els.splitter.style.display = hide ? 'none' : '';
    RP.store.ui.sidebarHidden = hide; RP.store.saveUi();
  }

  function setAllSections(open) {
    els.inputs.querySelectorAll('details.section').forEach(function (d) { d.open = open; });
  }

  function renderToolbarState() {
    var store = RP.store, real = store.doc.settings.realDollars;
    ui.clear(els.real);
    [{ v: true, l: "Today's $" }, { v: false, l: 'Future $' }].forEach(function (o) {
      els.real.appendChild(h('button' + (real === o.v ? '.active' : ''), {
        type: 'button', role: 'radio', 'aria-checked': String(real === o.v),
        title: o.v ? 'Amounts in today’s purchasing power' : 'Nominal amounts as they will appear in that year',
        onclick: function () { store.updateSettings({ realDollars: o.v }); }
      }, o.l));
    });
    ui.clear(els.scSelect);
    els.scSelect.appendChild(h('option', { value: 'base' }, 'Base plan'));
    store.doc.scenarios.forEach(function (s) { els.scSelect.appendChild(h('option', { value: s.id }, s.name)); });
    els.scSelect.appendChild(h('option', { value: '__new' }, 'New scenario…'));
    els.scSelect.value = store.active;
    var sc = store.scenario();
    els.scChip.style.background = sc ? sc.color : RP.ui.cssVar('--series-1');
    els.undo.disabled = !store.canUndo();
    els.redo.disabled = !store.canRedo();
    if (document.activeElement !== els.name) els.name.value = store.doc.meta.name;
    els.title.textContent = store.doc.meta.name + ' — Canadian Retirement Planner';
    if (els.mtitle) els.mtitle.textContent = store.doc.meta.name;
    document.title = store.doc.meta.name + ' — Retirement Planner';
  }

  function renderStatus() {
    var store = RP.store, p = store.effective(), sc = store.scenario();
    var d = RP.tax.dataFor(p.tax.year);
    els.stEditing.textContent = 'Editing: ' + (sc ? sc.name : 'Base plan');
    els.stTax.textContent = (d.provinces[p.profile.province] || {}).name + ' · ' + (p.tax.mode === 'calculated' ? d.label + ' tax tables' : p.tax.mode === 'flat' ? 'flat ' + fmt.pct(p.tax.flatRate) + ' tax' : 'custom brackets');
    els.stBasis.textContent = store.doc.settings.realDollars ? "Today's dollars" : 'Future dollars';
    var t = store.lastSaved;
    els.stSaved.textContent = store.saveFailed ? 'Not saved (browser storage blocked — use Save Plan As)' : t ? 'Autosaved ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Autosave on';
  }

  /** Show a transient message in the status bar. */
  app.status = function (msg, kind) {
    if (!els.msg) return;
    els.msg.textContent = msg;
    els.msg.classList.toggle('error', kind === 'error');
    clearTimeout(statusTimer);
    if (msg !== 'Ready') statusTimer = setTimeout(function () { els.msg.textContent = 'Ready'; els.msg.classList.remove('error'); }, 5000);
  };

  function renderInputs() {
    var scroller = els.inputs.parentNode;
    var scroll = scroller ? scroller.scrollTop : 0;
    ui.renderInputs(els.inputs);
    if (scroller) scroller.scrollTop = scroll;
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
          if (txt.charAt(0) !== '−' && txt.charAt(0) !== '-' && txt.charAt(0) !== '+') txt = '+' + txt;
          delta = h('span.delta' + (good ? '.good' : '.bad'), txt);
        }
      }
      var status = k.status ? k.status(act.result) : null;
      els.kpis.appendChild(h('div.kpi',
        h('div.kpi-label', k.label),
        h('div.kpi-value' + (status ? '.status-' + status : ''), k.format(v, act.result)),
        h('div.kpi-sub', k.sub ? k.sub(act.result) : '', delta ? ' · vs base ' : null, delta)));
    });
    renderMobileSummary(act.result, real);
    els.kpis.appendChild(h('div.kpi.kpi-context',
      h('div.kpi-label', 'Scenario'),
      h('div.kpi-value.small', h('span.swatch', { style: { background: act.color } }), act.name),
      h('div.kpi-sub', real ? "Today's dollars" : 'Future dollars')));
  }

  function renderMobileSummary(r, real) {
    if (!els.msum) return;
    var lasts = K.get('lasts'), atRet = K.get('atRet');
    var st = lasts.status(r);
    ui.clear(els.msum);
    els.msum.appendChild(h('span.m-sum-item', h('span.muted', 'Money lasts to'), h('b.status-' + st, lasts.format(lasts.value(r, real), r))));
    els.msum.appendChild(h('span.m-sum-item', h('span.muted', 'At retirement'), h('b', atRet.format(atRet.value(r, real), r))));
    els.msum.appendChild(h('span.m-sum-go', 'Results ›'));
  }

  function renderTabs() {
    ui.clear(els.tabs);
    var cur = RP.store.doc.settings.activeTab;
    RP.tabs.list().forEach(function (t) {
      els.tabs.appendChild(h('button.tab' + (t.id === cur ? '.active' : ''), {
        type: 'button', role: 'tab', 'aria-selected': String(t.id === cur), onclick: function () { app.showTab(t.id); }
      }, t.label));
    });
    var act = els.tabs.querySelector('.tab.active');
    if (act && els.tabs.scrollWidth > els.tabs.clientWidth) {
      els.tabs.scrollLeft = act.offsetLeft - (els.tabs.clientWidth - act.offsetWidth) / 2;
    }
  }

  app.showTab = function (id, args) {
    tabArgs = args || null;
    if (app.isMobile() && document.body.dataset.mview !== 'results') setMobileView('results', true);
    RP.store.doc.settings.activeTab = id;
    renderTabs();
    app.renderTab();
    els.tab.scrollTop = 0;
  };

  app.renderTab = function () {
    var id = RP.store.doc.settings.activeTab;
    var tab = RP.tabs.get(id) || RP.tabs.list()[0];
    if (!RP.store.results) return;
    var scroll = els.tab.scrollTop;
    var wraps = Array.prototype.map.call(els.tab.querySelectorAll('.table-wrap'), function (w) { return [w.scrollTop, w.scrollLeft]; });
    ui.clear(els.tab);
    try {
      tab.render(els.tab, tabArgs);
    } catch (e) {
      console.error(e);
      els.tab.appendChild(h('div.callout.callout-error', ui.icon('alert'), h('span', 'Could not render this tab: ' + e.message)));
    }
    tabArgs = null;
    Array.prototype.forEach.call(els.tab.querySelectorAll('.table-wrap'), function (w, i) { if (wraps[i]) { w.scrollTop = wraps[i][0]; w.scrollLeft = wraps[i][1]; } });
    els.tab.scrollTop = scroll;
  };

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  function newPlan() {
    ui.confirm('New plan', 'Replace the current plan with a new one using the default values? Save it first if you want to keep it. (Edit › Undo can restore it.)', function () {
      RP.store.reset(); app.status('New plan created');
    }, 'New Plan');
  }
  function exportPlan() {
    ui.download(ui.slug(RP.store.doc.meta.name) + '.retirement-plan.json', RP.store.exportJson());
    app.status('Plan saved to ' + ui.slug(RP.store.doc.meta.name) + '.retirement-plan.json');
  }
  function importPlan() {
    ui.pickFile('.json,.txt,.md,application/json,text/plain,text/markdown', function (text, file) { loadText(text, file.name); });
  }
  function loadText(text, name) {
    var parsed;
    try { parsed = RP.store.parsePlan(text); }
    catch (e) {
      app.status('Could not open ' + name + ': ' + e.message, 'error');
      ui.modal('Open plan', h('p', 'Could not open ' + name + ': ' + e.message), [{ label: 'OK', primary: true, onclick: function () {} }]);
      return;
    }
    var errors = parsed.issues.filter(function (x) { return x.level === 'error'; });
    function open() {
      RP.store.loadDocument(parsed.doc);
      app.status('Opened ' + name + (parsed.issues.length ? ' (' + parsed.issues.length + ' issue' + (parsed.issues.length > 1 ? 's' : '') + ')' : ''));
    }
    if (!parsed.issues.length) { open(); return; }
    var list = h('div.table-wrap', h('table.grid.compact.issues',
      h('thead', h('tr', h('th.left', ''), h('th.left', 'Field'), h('th.left', 'Problem'))),
      h('tbody', parsed.issues.map(function (x) {
        return h('tr', h('td.left' + (x.level === 'error' ? '.neg' : ''), x.level === 'error' ? 'Error' : 'Warning'), h('td.left', h('code', x.path)), h('td.left', x.message));
      }))));
    if (errors.length) {
      ui.modal('Problems in ' + name, h('div',
        h('p', errors.length + ' error(s) found. The plan may calculate incorrectly. If an AI assistant wrote this file, paste this list back to it and ask for a corrected file.'),
        list), [
        { label: 'Copy list', onclick: function () { copyIssues(parsed.issues); return false; } },
        { label: 'Cancel', onclick: function () {} },
        { label: 'Open anyway', primary: true, onclick: open }
      ], { wide: true });
    } else {
      open();
      ui.modal('Opened with warnings', h('div', h('p', name + ' was opened. Please review:'), list), [{ label: 'OK', primary: true, onclick: function () {} }], { wide: true });
    }
  }
  /** Paste plan JSON (e.g. an AI assistant's reply; surrounding text and ``` fences are fine). */
  function pastePlan() {
    var ta = h('textarea.input.mono', { rows: 16, placeholder: 'Paste the plan here — the whole AI reply is fine, as long as it contains the JSON.' });
    ui.modal('Paste Plan', h('div',
      h('p.note', 'For plans written by an AI assistant from the plan file specification (Help › Plan File Specification). The current plan is replaced; Edit › Undo brings it back.'),
      ta), [
      { label: 'Cancel', onclick: function () {} },
      { label: 'Open', primary: true, onclick: function () {
        var t = ta.value.trim();
        if (!t) return false;
        var start = t.indexOf('{'), end = t.lastIndexOf('}');
        if (!/```/.test(t) && start > 0 && end > start) t = t.slice(start, end + 1);
        setTimeout(function () { loadText(t, 'pasted plan'); }, 0);
      } }
    ], { wide: true });
  }
  function copyIssues(issues) {
    var text = issues.map(function (x) { return x.level.toUpperCase() + ' ' + x.path + ': ' + x.message; }).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { app.status('Problem list copied'); }, function () { app.status('Could not copy'); });
  }
  function printPlan() {
    if (RP.store.doc.settings.activeTab !== 'projection') app.showTab('projection');
    setTimeout(function () { window.print(); }, 300);
  }
  function renameScenario(sc) {
    var inp = h('input.input', { type: 'text', value: sc.name });
    ui.modal('Rename scenario', h('div.field-grid', h('div.field', h('label.field-label', 'Name'), inp)), [
      { label: 'Cancel', onclick: function () {} },
      { label: 'OK', primary: true, onclick: function () { RP.store.update(function () { sc.name = inp.value || sc.name; }); } }
    ]);
  }
  function showSpec() {
    ui.modal('Plan File Specification', h('div.prose',
      h('p', 'The plan file format is documented in ', h('code', 'docs/PLAN-FILE-SPEC.md'), '. You can give that file to an AI assistant (ChatGPT, Claude, Gemini, …) and ask it to build a plan for your situation:'),
      h('ol',
        h('li', h('a', { href: 'docs/PLAN-FILE-SPEC.md', download: 'PLAN-FILE-SPEC.md' }, 'Download the specification'), ' (or get it from the project’s GitHub page).'),
        h('li', 'Upload it to the AI and describe your situation. It will ask follow-up questions, then reply with a plan in JSON.'),
        h('li', 'Use File › Paste Plan… and paste the reply, or save it as a .json file and use File › Open Plan….'),
        h('li', 'If the planner reports problems, copy the list back to the AI and ask for a corrected file.')),
      h('p.note', 'Avoid sharing details you consider private (names, account numbers, SIN). The planner itself never sends your data anywhere, but an AI service will receive whatever you type.')),
      [{ label: 'OK', primary: true, onclick: function () {} }]);
  }
  function showShortcuts() {
    var rows = [['Ctrl+S', 'Save plan to file'], ['Ctrl+O', 'Open plan file'], ['Ctrl+P', 'Print'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+B', 'Show/hide input panel'], ['Alt+1 … Alt+7', 'Switch tab'], ['Enter (in a field)', 'Apply value'], ['↑ / ↓ (in a number)', 'Step value'],
      ['Enter (on a table row)', 'Open the year menu'], ['Esc', 'Close menu or dialog']];
    ui.modal('Keyboard Shortcuts', h('table.grid.compact', h('tbody', rows.map(function (r) { return h('tr', h('td.left', h('b', r[0])), h('td.left', r[1])); }))), [{ label: 'OK', primary: true, onclick: function () {} }]);
  }
  /** Pick one of the bundled example plans (js/data/examples.js, built by tools/build-examples.js). */
  function openExample() {
    var dlg;
    var rows = (RP.examples || []).map(function (ex) {
      var d = ex.doc, p = d.base.profile, prov = RP.tax.dataFor(d.base.tax.year).provinces[p.province];
      return h('tr',
        h('td.left', h('b', ex.name), h('span.muted', ex.summary)),
        h('td.left', prov ? prov.name : p.province),
        h('td', String(p.currentAge)),
        h('td', String(d.scenarios.length)),
        h('td', ui.button('Open', function () {
          dlg.close();
          RP.store.importJson(JSON.stringify(d));
          app.showTab('scenarios');
          app.status('Opened example: ' + ex.name + ' (Edit › Undo returns to your previous plan)');
        }, { cls: 'small' })));
    });
    dlg = ui.modal('Open Example Plan', h('div.example-list',
      h('p.note', 'Ready-made plans with scenarios to explore. Opening one replaces the plan currently in the window; save yours first (File › Save Plan As), or use Edit › Undo afterwards.'),
      h('div.table-wrap', h('table.grid',
        h('thead', h('tr', h('th.left', 'Example'), h('th.left', 'Province'), h('th', 'Age'), h('th', 'Scenarios'), h('th', ''))),
        h('tbody', rows)))), [{ label: 'Cancel', onclick: function () {} }], { wide: true });
  }

  function showAbout() {
    ui.modal('About', h('div',
      h('p', h('b', 'Canadian Retirement Planner'), ' version ' + RP.version),
      h('p.note', 'Runs entirely in your browser. Plans are stored locally and in files you save. Tax tables: ' + RP.tax.availableYears().join(', ') + '.'),
      h('p.note', 'For education and personal planning only — not financial, tax or legal advice.')), [{ label: 'OK', primary: true, onclick: function () {} }]);
  }

  // ---------------------------------------------------------------------------
  function applyTheme() {
    var t = RP.store.ui.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  function setTheme(t) {
    RP.store.ui.theme = t;
    RP.store.saveUi();
    applyTheme();
    renderToolbarState();
    app.renderTab();
  }

  // Drag & drop a plan file anywhere to open it.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { loadText(r.result, f.name); };
    r.readAsText(f);
  });

  app.exportPlan = exportPlan;
  app.importPlan = importPlan;
  document.addEventListener('DOMContentLoaded', app.init);
})(globalThis.RP);
