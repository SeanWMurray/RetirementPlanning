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
  schema.SCHEMA_VERSION = 1;

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
      savings: { mode: 'surplus', rate: 0.15, amount: 15000, order: ['rrsp', 'tfsa', 'cash', 'nonreg'] },
      accounts: [
        { id: 'rrsp', name: 'RRSP / RRIF', type: 'rrsp', balance: 60000, contributionCap: 18000, returnRate: null },
        { id: 'tfsa', name: 'TFSA', type: 'tfsa', balance: 40000, contributionCap: 7000, returnRate: null },
        { id: 'cash', name: 'Cash / HISA', type: 'cash', balance: 10000, contributionCap: 0, returnRate: null },
        { id: 'nonreg', name: 'Non-registered', type: 'nonreg', balance: 15000, costBase: 12000, contributionCap: null, returnRate: null }
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
    1: function (doc) { return doc; }
  };

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
    return doc;
  };

  schema.ACCOUNT_TYPES = [
    { value: 'rrsp', label: 'RRSP / RRIF / LIRA (tax-deferred)' },
    { value: 'tfsa', label: 'TFSA (tax-free)' },
    { value: 'nonreg', label: 'Non-registered (capital gains)' },
    { value: 'cash', label: 'Cash / HISA (interest)' }
  ];
})(globalThis.RP);
