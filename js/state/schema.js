/*
 * schema.js — the plan document format, defaults and migrations.
 *
 * A saved/exported plan is a JSON "document":
 *   {
 *     app: 'canadian-retirement-planner', schemaVersion: N,
 *     meta: { name, notes, created, modified },
 *     base: { ...plan inputs... },
 *     scenarios: [ { id, name, color, visible, overrides: { 'dotted.path': value }, events: [], disabledEvents: [] } ],
 *     settings: { ...display preferences... }
 *   }
 *
 * Future-proofing:
 *   - normalize() deep-merges defaults underneath any loaded document, so new
 *     fields added in later versions get sensible values in old files.
 *   - When a change can't be expressed as "new field with a default" (renames,
 *     restructures), bump SCHEMA_VERSION and add a migration step below.
 */
(function (RP) {
  'use strict';
  var U = RP.util;

  var schema = RP.schema = {};
  schema.APP_ID = 'canadian-retirement-planner';
  schema.SCHEMA_VERSION = 2;

  schema.SCENARIO_COLORS = ['#e0812f', '#239c8f', '#8b5ca8', '#c2416f', '#c49a1c', '#3f8f3a', '#5a86cf'];

  schema.defaultBase = function () {
    return {
      profile: { currentAge: 35, retirementAge: 60, endAge: 95, province: 'ON', startYear: new Date().getFullYear() },
      income: { salary: 100000, growth: 0.03 },
      tax: {
        year: RP.taxData.latest, mode: 'calculated', flatRate: 0.30,
        customBrackets: [{ upTo: 50000, rate: 0.20 }, { upTo: 100000, rate: 0.30 }, { upTo: 200000, rate: 0.40 }, { upTo: null, rate: 0.50 }],
        customCredit: 15000, indexBrackets: true, includePayroll: true, selfEmployed: false, oasClawback: true
      },
      spending: {
        mode: 'total', total: 55000, retirementChange: 0,
        items: [
          { id: 'sp_housing', name: 'Housing (rent/mortgage, tax, maintenance)', amount: 24000, phase: 'all', indexed: true },
          { id: 'sp_food', name: 'Groceries & dining', amount: 10000, phase: 'all', indexed: true },
          { id: 'sp_transport', name: 'Transportation', amount: 7000, phase: 'all', indexed: true },
          { id: 'sp_utilities', name: 'Utilities & phone', amount: 4000, phase: 'all', indexed: true },
          { id: 'sp_insurance', name: 'Insurance & health', amount: 3000, phase: 'all', indexed: true },
          { id: 'sp_personal', name: 'Personal & discretionary', amount: 7000, phase: 'all', indexed: true },
          { id: 'sp_travel', name: 'Travel', amount: 8000, phase: 'retired', indexed: true }
        ]
      },
      savings: { mode: 'surplus', rate: 0.15, amount: 15000, enforceRoom: true, order: ['rrsp', 'tfsa', 'cash', 'nonreg'] },
      accounts: [
        { id: 'rrsp', name: 'RRSP / RRIF', type: 'rrsp', balance: 60000, contribLimit: 'legal', contributionCap: 18000, startingRoom: null, returnRate: null },
        { id: 'tfsa', name: 'TFSA', type: 'tfsa', balance: 40000, contribLimit: 'legal', contributionCap: 7000, startingRoom: null, returnRate: null },
        { id: 'cash', name: 'Cash / HISA', type: 'cash', balance: 10000, contribLimit: 'none', contributionCap: 0, returnRate: null },
        { id: 'nonreg', name: 'Non-registered', type: 'nonreg', balance: 15000, costBase: 12000, contribLimit: 'unlimited', contributionCap: null, returnRate: null }
      ],
      assumptions: { inflation: 0.021, returnPre: 0.06, returnPost: 0.05, cashReturn: 0.025, volatility: 0.11 },
      benefits: { cppEnabled: true, cppAt65: 13000, cppStartAge: 65, oasEnabled: true, oasStartAge: 65, oasResidency: 1 },
      retirement: { strategy: 'needs', withdrawalRate: 0.04, withdrawalOrder: ['cash', 'nonreg', 'rrsp', 'tfsa'], rrifMinimums: true },
      events: []
    };
  };

  schema.defaultSettings = function () {
    return {
      realDollars: true,
      chartMode: 'stacked',          // 'stacked' | 'total'
      hiddenColumns: [],
      activeTab: 'projection',
      sensitivity: { metric: 'endingReal', gridX: 'returns', gridY: 'retirementAge' },
      monteCarlo: { runs: 500, seed: 42 }
    };
  };

  schema.newDocument = function (name) {
    var now = new Date().toISOString();
    return {
      app: schema.APP_ID,
      schemaVersion: schema.SCHEMA_VERSION,
      meta: { name: name || 'My retirement plan', notes: '', created: now, modified: now },
      base: schema.defaultBase(),
      scenarios: [],
      settings: schema.defaultSettings()
    };
  };

  schema.newScenario = function (doc, name) {
    var used = (doc.scenarios || []).map(function (s) { return s.color; });
    var color = schema.SCENARIO_COLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || schema.SCENARIO_COLORS[(doc.scenarios || []).length % schema.SCENARIO_COLORS.length];
    return { id: U.uid('sc'), name: name || 'Scenario ' + ((doc.scenarios || []).length + 1), color: color, visible: true, notes: '', overrides: {}, events: [], disabledEvents: [] };
  };

  // Migration steps: migrations[n] upgrades a document from version n-1 to n.
  schema.migrations = {
    1: function (doc) { return doc; },
    // v2: accounts get an explicit contribution limit mode (previously implied by contributionCap).
    2: function (doc) {
      function upgrade(accounts) {
        (accounts || []).forEach(function (a) {
          if (a.contribLimit) return;
          a.contribLimit = a.contributionCap === '' || a.contributionCap == null ? 'unlimited'
            : Number(a.contributionCap) === 0 ? 'none' : 'custom';
        });
      }
      if (doc.base) upgrade(doc.base.accounts);
      (doc.scenarios || []).forEach(function (s) { if (s.overrides && s.overrides.accounts) upgrade(s.overrides.accounts); });
      return doc;
    }
  };

  schema.CONTRIBUTION_LIMITS = [
    { value: 'legal', label: 'Up to contribution room' },
    { value: 'custom', label: "Up to a set amount (today's $)" },
    { value: 'unlimited', label: 'No limit' },
    { value: 'none', label: "Don't contribute" }
  ];

  /** Bring any loaded document up to the current schema and fill defaults. */
  schema.normalize = function (raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Not a plan file.');
    if (raw.app && raw.app !== schema.APP_ID) throw new Error('This file was not created by this planner.');
    var doc = U.clone(raw);
    var v = doc.schemaVersion || 0;
    if (v > schema.SCHEMA_VERSION) throw new Error('This plan was saved by a newer version of the planner (schema ' + v + ').');
    while (v < schema.SCHEMA_VERSION) { v++; doc = schema.migrations[v](doc); }
    doc.schemaVersion = schema.SCHEMA_VERSION;
    doc.app = schema.APP_ID;

    var fresh = schema.newDocument();
    doc.meta = U.merge(fresh.meta, doc.meta || {});
    doc.base = U.merge(schema.defaultBase(), doc.base || {});
    doc.settings = U.merge(fresh.settings, doc.settings || {});
    doc.scenarios = (doc.scenarios || []).map(function (s) {
      return Object.assign({ id: U.uid('sc'), name: 'Scenario', color: schema.SCENARIO_COLORS[0], visible: true, notes: '', overrides: {}, events: [], disabledEvents: [] }, s);
    });
    // Ensure every event/item/account has an id.
    (doc.base.events || []).forEach(function (e) { if (!e.id) e.id = U.uid('ev'); });
    (doc.base.spending.items || []).forEach(function (e) { if (!e.id) e.id = U.uid('sp'); });
    (doc.base.accounts || []).forEach(function (a) { if (!a.id) a.id = U.uid('acct'); });
    // Drop order entries that don't match an account (e.g. default ids when a file defines its own accounts).
    var acctIds = (doc.base.accounts || []).map(function (a) { return a.id; });
    ['savings.order', 'retirement.withdrawalOrder'].forEach(function (k) {
      var arr = U.getPath(doc.base, k);
      if (Array.isArray(arr)) U.setPath(doc.base, k, arr.filter(function (id) { return acctIds.indexOf(id) >= 0; }));
    });
    (doc.base.events || []).forEach(function (e) { if (e.enabled == null) e.enabled = true; });
    doc.scenarios.forEach(function (s) { (s.events || []).forEach(function (e) { if (!e.id) e.id = U.uid('ev'); if (e.enabled == null) e.enabled = true; }); });
    return doc;
  };

  schema.ACCOUNT_TYPES = [
    { value: 'rrsp', label: 'RRSP / RRIF / LIRA (tax-deferred)' },
    { value: 'tfsa', label: 'TFSA (tax-free)' },
    { value: 'nonreg', label: 'Non-registered (capital gains)' },
    { value: 'cash', label: 'Cash / HISA (interest)' }
  ];

  // ---------------------------------------------------------------------------
  // Validation. Used when a file is opened (especially files written by hand or
  // by an AI assistant from docs/PLAN-FILE-SPEC.md). normalize() fills missing
  // fields; validate() reports values that are present but wrong.
  //   returns [{ level: 'error'|'warning', path, message }]
  // ---------------------------------------------------------------------------
  var ENUMS = {
    'tax.mode': ['calculated', 'flat', 'custom'],
    'spending.mode': ['total', 'itemized'],
    'account.type': ['rrsp', 'tfsa', 'nonreg', 'cash'],
    'account.contribLimit': ['legal', 'custom', 'unlimited', 'none'],
    'item.phase': ['all', 'working', 'retired'],
    taxType: ['other', 'pension', 'nontaxable'],
    'adjustment.target': ['income', 'spending', 'savings'],
    'adjustment.kind': ['step', 'growth'],
    'returnOverride.mode': ['set', 'add'],
    'contribution.mode': ['custom', 'legal', 'none']
  };
  schema.ENUMS = ENUMS;

  // Decimal-rate fields: [path, min, max]. A value like 5 for 5% is the most common mistake.
  var RATES = [
    ['income.growth', -0.2, 0.3], ['assumptions.inflation', -0.05, 0.2], ['assumptions.returnPre', -0.5, 0.3],
    ['assumptions.returnPost', -0.5, 0.3], ['assumptions.cashReturn', -0.1, 0.2], ['assumptions.volatility', 0, 0.6],
    ['spending.retirementChange', -1, 2], ['savings.rate', 0, 1], ['retirement.withdrawalRate', 0, 0.5],
    ['tax.flatRate', 0, 0.9], ['benefits.oasResidency', 0, 1]
  ];

  schema.validate = function (doc) {
    var out = [];
    function err(path, msg) { out.push({ level: 'error', path: path, message: msg }); }
    function warn(path, msg) { out.push({ level: 'warning', path: path, message: msg }); }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function oneOf(path, v, list) { if (list.indexOf(v) < 0) err(path, 'must be one of ' + list.map(function (x) { return '"' + x + '"'; }).join(', ') + ' (got ' + JSON.stringify(v) + ')'); }

    function checkPlan(p, prefix) {
      var pr = p.profile || {};
      ['currentAge', 'retirementAge', 'endAge'].forEach(function (k) {
        if (!isNum(pr[k]) || pr[k] !== Math.round(pr[k])) err(prefix + 'profile.' + k, 'must be a whole number of years');
      });
      if (isNum(pr.currentAge) && (pr.currentAge < 16 || pr.currentAge > 110)) err(prefix + 'profile.currentAge', 'must be between 16 and 110');
      if (isNum(pr.endAge) && isNum(pr.currentAge) && pr.endAge <= pr.currentAge) err(prefix + 'profile.endAge', 'must be greater than currentAge');
      if (isNum(pr.retirementAge) && isNum(pr.endAge) && pr.retirementAge > pr.endAge) warn(prefix + 'profile.retirementAge', 'is after endAge, so the plan never reaches retirement');
      var data = RP.taxData[p.tax && p.tax.year];
      if (!data) err(prefix + 'tax.year', 'unknown tax table year ' + JSON.stringify(p.tax && p.tax.year) + '; available: ' + RP.tax.availableYears().join(', '));
      else if (!data.provinces[pr.province]) err(prefix + 'profile.province', 'unknown province code ' + JSON.stringify(pr.province) + '; use one of ' + Object.keys(data.provinces).join(', '));
      if (!isNum(pr.startYear)) err(prefix + 'profile.startYear', 'must be a calendar year, e.g. 2026');

      RATES.forEach(function (r) {
        var v = RP.util.getPath(p, r[0]);
        if (v == null) return;
        if (!isNum(v)) err(prefix + r[0], 'must be a number');
        else if (v > r[2] && v <= 100 && r[2] < 1.5) err(prefix + r[0], 'looks like a percentage (' + v + '); rates are decimals, e.g. 0.05 for 5%');
        else if (v < r[1] || v > r[2]) err(prefix + r[0], 'must be between ' + r[1] + ' and ' + r[2] + ' (decimal rate)');
      });
      if (p.income && (!isNum(p.income.salary) || p.income.salary < 0)) err(prefix + 'income.salary', 'must be a number ≥ 0 (annual gross, today’s dollars)');

      if (p.tax) {
        oneOf(prefix + 'tax.mode', p.tax.mode, ENUMS['tax.mode']);
        if (p.tax.mode === 'custom') {
          var br = p.tax.customBrackets || [];
          if (!br.length) err(prefix + 'tax.customBrackets', 'needs at least one bracket');
          br.forEach(function (b, i) {
            if (!isNum(b.rate) || b.rate < 0 || b.rate > 1) err(prefix + 'tax.customBrackets.' + i + '.rate', 'must be a decimal between 0 and 1');
            if (i < br.length - 1 && !isNum(b.upTo)) err(prefix + 'tax.customBrackets.' + i + '.upTo', 'must be a number (only the last bracket uses null)');
            if (i > 0 && i < br.length - 1 && isNum(br[i - 1].upTo) && b.upTo <= br[i - 1].upTo) err(prefix + 'tax.customBrackets.' + i + '.upTo', 'thresholds must increase');
          });
          if (br.length && br[br.length - 1].upTo != null) warn(prefix + 'tax.customBrackets', 'the last bracket should have upTo: null (no upper limit)');
        }
      }

      if (p.spending) {
        oneOf(prefix + 'spending.mode', p.spending.mode, ENUMS['spending.mode']);
        if (p.spending.mode === 'total' && (!isNum(p.spending.total) || p.spending.total < 0)) err(prefix + 'spending.total', 'must be a number ≥ 0');
        (p.spending.items || []).forEach(function (it, i) {
          if (!isNum(it.amount)) err(prefix + 'spending.items.' + i + '.amount', 'must be a number');
          if (it.phase != null) oneOf(prefix + 'spending.items.' + i + '.phase', it.phase, ENUMS['item.phase']);
        });
      }

      var ids = {};
      (p.accounts || []).forEach(function (a, i) {
        var ap = prefix + 'accounts.' + i;
        if (!a.id) err(ap + '.id', 'is required'); else if (ids[a.id]) err(ap + '.id', 'duplicate account id "' + a.id + '"'); else ids[a.id] = a;
        oneOf(ap + '.type', a.type, ENUMS['account.type']);
        if (!isNum(a.balance) || a.balance < 0) err(ap + '.balance', 'must be a number ≥ 0');
        if (a.contribLimit != null) oneOf(ap + '.contribLimit', a.contribLimit, ENUMS['account.contribLimit']);
        if (a.contribLimit === 'custom' && !isNum(a.contributionCap)) err(ap + '.contributionCap', 'is required when contribLimit is "custom"');
        if (a.contribLimit === 'legal' && a.type !== 'rrsp' && a.type !== 'tfsa') warn(ap + '.contribLimit', '"legal" only tracks room for rrsp/tfsa; for ' + a.type + ' it means no limit');
        if (a.returnRate != null && isNum(a.returnRate) && a.returnRate > 0.5 && a.returnRate <= 100) err(ap + '.returnRate', 'looks like a percentage; use a decimal, e.g. 0.05');
        if (a.type === 'nonreg' && a.costBase != null && isNum(a.costBase) && isNum(a.balance) && a.costBase > a.balance * 3) warn(ap + '.costBase', 'is much larger than the balance; check it is the adjusted cost base');
      });
      if (!(p.accounts || []).length) warn(prefix + 'accounts', 'no accounts: savings have nowhere to go');
      [['savings.order', p.savings && p.savings.order], ['retirement.withdrawalOrder', p.retirement && p.retirement.withdrawalOrder]].forEach(function (o) {
        (o[1] || []).forEach(function (id) { if (!ids[id]) warn(prefix + o[0], 'refers to unknown account id "' + id + '"'); });
      });
      if (p.savings && !RP.savingsModes.has(p.savings.mode)) err(prefix + 'savings.mode', 'must be one of ' + RP.savingsModes.ids().join(', '));
      if (p.retirement && !RP.withdrawalStrategies.has(p.retirement.strategy)) err(prefix + 'retirement.strategy', 'must be one of ' + RP.withdrawalStrategies.ids().join(', '));
      if (p.benefits) {
        if (isNum(p.benefits.cppStartAge) && (p.benefits.cppStartAge < 60 || p.benefits.cppStartAge > 70)) err(prefix + 'benefits.cppStartAge', 'must be between 60 and 70');
        if (isNum(p.benefits.oasStartAge) && (p.benefits.oasStartAge < 65 || p.benefits.oasStartAge > 70)) err(prefix + 'benefits.oasStartAge', 'must be between 65 and 70');
        if (isNum(p.benefits.cppAt65) && p.benefits.cppAt65 > 25000) warn(prefix + 'benefits.cppAt65', 'is above the maximum CPP (~$18,100/yr in 2026); check it is an annual amount at 65');
      }
      return ids;
    }

    function checkEvents(list, path, ids, plan) {
      (list || []).forEach(function (e, i) {
        var ep = path + '.' + i;
        var def = RP.eventTypes.get(e.type);
        if (!def) { err(ep + '.type', 'unknown event type ' + JSON.stringify(e.type) + '; use one of ' + RP.eventTypes.ids().join(', ')); return; }
        def.fields.forEach(function (f) {
          var v = e[f.key];
          if (f.key === 'label') return;
          if (v == null || v === '') { if (f.key !== 'endAge' && f.key !== 'everyYears' && f.key !== 'indexed') err(ep + '.' + f.key, 'is required for ' + e.type + ' events'); return; }
          if (f.type === 'select' && !(typeof f.options === 'function')) oneOf(ep + '.' + f.key, v, f.options.map(function (o) { return o.value; }));
          if ((f.type === 'money' || f.type === 'age' || f.type === 'number' || f.type === 'percent') && !isNum(v)) err(ep + '.' + f.key, 'must be a number');
          if (f.type === 'percent' && isNum(v) && Math.abs(v) > 1.5 && Math.abs(v) <= 100) err(ep + '.' + f.key, 'looks like a percentage; use a decimal, e.g. -0.2 for −20%');
        });
        if (isNum(e.startAge) && plan.profile && (e.startAge < plan.profile.currentAge || e.startAge > plan.profile.endAge)) warn(ep + '.startAge', 'age ' + e.startAge + ' is outside the plan (' + plan.profile.currentAge + '–' + plan.profile.endAge + ')');
        if (isNum(e.endAge) && isNum(e.startAge) && e.endAge < e.startAge) err(ep + '.endAge', 'must be ≥ startAge');
        if (e.type === 'contribution' && e.accountId && !ids[e.accountId]) err(ep + '.accountId', 'refers to unknown account id "' + e.accountId + '"');
      });
    }

    if (!doc || typeof doc !== 'object') { err('', 'not a JSON object'); return out; }
    if (!doc.base) { err('base', 'is required'); return out; }
    var baseIds = checkPlan(doc.base, 'base.');
    checkEvents(doc.base.events, 'base.events', baseIds, doc.base);
    var eventIds = {};
    (doc.base.events || []).forEach(function (e) { if (e.id) { if (eventIds[e.id]) err('base.events', 'duplicate event id "' + e.id + '"'); eventIds[e.id] = 1; } });

    var known = schema.defaultBase();
    (doc.scenarios || []).forEach(function (s, i) {
      var sp = 'scenarios.' + i;
      if (!s.name) warn(sp + '.name', 'scenario has no name');
      Object.keys(s.overrides || {}).forEach(function (k) {
        var parts = k.split('.');
        if (RP.util.getPath(known, parts[0]) === undefined) err(sp + '.overrides', 'unknown path "' + k + '"');
        else if (parts.length > 1 && RP.util.getPath(known, parts.slice(0, 2).join('.')) === undefined && !/^\d+$/.test(parts[1])) err(sp + '.overrides', 'unknown path "' + k + '"');
        if (/\.\d+(\.|$)/.test(k)) warn(sp + '.overrides', '"' + k + '" points inside an array; override the whole array instead (e.g. "accounts")');
      });
      var eff;
      try { eff = RP.scenarios.effective(doc, s.id); } catch (e) { err(sp, 'could not be applied: ' + e.message); return; }
      var baseKeys = {};
      out.forEach(function (x) { baseKeys[x.path.replace(/^base\./, '') + '|' + x.message] = 1; });
      var issues = schema.validate({ base: eff, scenarios: [] }).filter(function (x) {
        return x.level === 'error' && !/^base\.events/.test(x.path) && !baseKeys[x.path.replace(/^base\./, '') + '|' + x.message];
      });
      issues.forEach(function (x) { err(sp + ' (' + (s.name || s.id) + ')', x.path.replace(/^base\./, '') + ' ' + x.message); });
      checkEvents(s.events, sp + '.events', (function () { var m = {}; (eff.accounts || []).forEach(function (a) { m[a.id] = a; }); return m; })(), eff);
      (s.disabledEvents || []).forEach(function (id) { if (!eventIds[id]) warn(sp + '.disabledEvents', 'unknown base event id "' + id + '"'); });
    });
    return out;
  };
})(globalThis.RP);
