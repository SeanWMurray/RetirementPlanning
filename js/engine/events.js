/*
 * events.js — life events / plan modifiers.
 *
 * An event is a plain object stored in the plan: { id, type, label, enabled, ...fields }.
 * Its behaviour lives in a registered *event type*. To add a new kind of event,
 * register a type here (or in a new file loaded after this one):
 *
 *   RP.eventTypes.register({
 *     id: 'myType',
 *     label: 'Human name',
 *     description: 'Shown in the add-event menu',
 *     fields: [ { key, label, type: 'money'|'percent'|'age'|'number'|'select'|'toggle'|'text', options?, help? } ],
 *     defaults: function (age, plan) { return { ...field values } },
 *     presets: [ { label, values } ],          // optional quick-starts in the menu
 *     isActive: function (ev, age) { ... },    // used for table/chart markers
 *     summary: function (ev) { return 'short text' },
 *     apply: function (ev, y, ctx) { ... }     // mutate the year being simulated
 *   });
 *
 * The year object `y` passed to apply() exposes these hooks:
 *   y.mods.income / y.mods.spending / y.mods.savings   multiplicative factors (default 1)
 *   y.mods.returnOverride  (number|null)  replaces the portfolio return this year
 *   y.mods.returnDelta     (number)       added to the portfolio return this year
 *   y.extraIncome.push({ label, amount, taxType: 'other'|'pension'|'nontaxable' })
 *   y.extraExpenses.push({ label, amount })
 * `ctx` = { plan, t, age, cpi, persist } where persist is a per-event scratch object
 * that survives across years (for cumulative effects).
 */
(function (RP) {
  'use strict';
  var num = RP.util.num;
  var fmt = RP.fmt;

  var types = RP.eventTypes = RP.createRegistry('eventTypes');

  function inRange(ev, age) {
    var s = num(ev.startAge), e = ev.endAge == null || ev.endAge === '' ? s : num(ev.endAge);
    return age >= s && age <= e;
  }
  function ageRangeText(ev) {
    var s = num(ev.startAge), e = ev.endAge == null || ev.endAge === '' ? s : num(ev.endAge);
    return s === e ? 'age ' + s : 'ages ' + s + '–' + e;
  }
  function amountAt(ev, ctx) {
    return num(ev.amount) * (ev.indexed === false ? 1 : ctx.cpi);
  }
  RP.events = { inRange: inRange, ageRangeText: ageRangeText };

  var rangeFields = [
    { key: 'startAge', label: 'From age', type: 'age' },
    { key: 'endAge', label: 'To age', type: 'age', help: 'Inclusive. Same as start for a one-year event.' }
  ];
  var TAX_TYPES = [
    { value: 'other', label: 'Taxable (ordinary income)' },
    { value: 'pension', label: 'Taxable pension (pension credit eligible)' },
    { value: 'nontaxable', label: 'Non-taxable' }
  ];

  // ---------------------------------------------------------------------------
  types.register({
    id: 'expense',
    label: 'Expense',
    description: 'Extra spending for a year or a range of years (optionally repeating every N years).',
    color: 'var(--ev-expense)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'amount', label: 'Amount per occurrence', type: 'money' },
      rangeFields[0], rangeFields[1],
      { key: 'everyYears', label: 'Repeat every (years)', type: 'number', min: 1, step: 1, help: '1 = every year in range' },
      { key: 'indexed', label: "In today's dollars (inflation-indexed)", type: 'toggle' }
    ],
    defaults: function (age) {
      return { label: 'Expense', amount: 10000, startAge: age, endAge: age, everyYears: 1, indexed: true };
    },
    presets: [
      { label: 'One-time purchase', values: { label: 'Large purchase', amount: 25000 } },
      { label: 'Vehicle every 8 years', values: { label: 'Vehicle replacement', amount: 40000, everyYears: 8, endAgeOffset: 32 } },
      { label: 'Travel (first 10 yrs)', values: { label: 'Travel', amount: 12000, endAgeOffset: 9 } },
      { label: 'Child costs (18 yrs)', values: { label: 'Child', amount: 15000, endAgeOffset: 17 } },
      { label: 'Long-term care', values: { label: 'Long-term care', amount: 60000, endAgeOffset: 5 } }
    ],
    isActive: function (ev, age) {
      if (!inRange(ev, age)) return false;
      var every = Math.max(1, Math.round(num(ev.everyYears, 1)));
      return (age - num(ev.startAge)) % every === 0;
    },
    summary: function (ev) {
      var every = Math.max(1, Math.round(num(ev.everyYears, 1)));
      return fmt.money(num(ev.amount)) + (every > 1 ? ' every ' + every + ' yrs, ' : ', ') + ageRangeText(ev);
    },
    apply: function (ev, y, ctx) {
      if (this.isActive(ev, ctx.age)) y.extraExpenses.push({ id: ev.id, label: ev.label || 'Expense', amount: amountAt(ev, ctx) });
    }
  });

  // ---------------------------------------------------------------------------
  types.register({
    id: 'income',
    label: 'Income',
    description: 'Additional income: part-time work, rental, defined-benefit pension, annuity, etc.',
    color: 'var(--ev-income)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'amount', label: 'Annual amount', type: 'money' },
      rangeFields[0], rangeFields[1],
      { key: 'taxType', label: 'Tax treatment', type: 'select', options: TAX_TYPES },
      { key: 'indexed', label: "In today's dollars (inflation-indexed)", type: 'toggle' }
    ],
    defaults: function (age, plan) {
      return { label: 'Income', amount: 20000, startAge: age, endAge: Math.min(age + 4, plan ? plan.profile.endAge : age + 4), taxType: 'other', indexed: true };
    },
    presets: [
      { label: 'Part-time work', values: { label: 'Part-time work', amount: 25000, endAgeOffset: 4 } },
      { label: 'Defined-benefit pension', values: { label: 'DB pension', amount: 30000, taxType: 'pension', endAgeOffset: 60 } },
      { label: 'Rental income', values: { label: 'Rental income (net)', amount: 12000, endAgeOffset: 20 } }
    ],
    isActive: function (ev, age) { return inRange(ev, age); },
    summary: function (ev) { return fmt.money(num(ev.amount)) + '/yr, ' + ageRangeText(ev); },
    apply: function (ev, y, ctx) {
      if (inRange(ev, ctx.age)) y.extraIncome.push({ id: ev.id, label: ev.label || 'Income', amount: amountAt(ev, ctx), taxType: ev.taxType || 'other' });
    }
  });

  // ---------------------------------------------------------------------------
  types.register({
    id: 'lumpSum',
    label: 'Lump sum inflow',
    description: 'One-time cash in: inheritance, home downsizing, business sale, insurance payout.',
    color: 'var(--ev-income)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'startAge', label: 'At age', type: 'age' },
      { key: 'taxType', label: 'Tax treatment', type: 'select', options: TAX_TYPES },
      { key: 'indexed', label: "In today's dollars (inflation-indexed)", type: 'toggle' }
    ],
    defaults: function (age) { return { label: 'Inheritance', amount: 100000, startAge: age, taxType: 'nontaxable', indexed: true }; },
    presets: [
      { label: 'Inheritance', values: { label: 'Inheritance', amount: 150000 } },
      { label: 'Downsize home', values: { label: 'Home downsizing', amount: 300000 } }
    ],
    isActive: function (ev, age) { return age === num(ev.startAge); },
    summary: function (ev) { return fmt.money(num(ev.amount)) + ' at age ' + num(ev.startAge); },
    apply: function (ev, y, ctx) {
      if (ctx.age === num(ev.startAge)) y.extraIncome.push({ id: ev.id, label: ev.label || 'Lump sum', amount: amountAt(ev, ctx), taxType: ev.taxType || 'nontaxable' });
    }
  });

  // ---------------------------------------------------------------------------
  var TARGETS = [
    { value: 'income', label: 'Employment income' },
    { value: 'spending', label: 'Base spending' },
    { value: 'savings', label: 'Savings contributions' }
  ];
  types.register({
    id: 'adjustment',
    label: 'Adjust income / spending / savings',
    description: 'Change a baseline by a percentage — either a temporary step (e.g. sabbatical −50%) or extra annual growth that compounds (e.g. promotion track +2%/yr).',
    color: 'var(--ev-adjust)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'target', label: 'Applies to', type: 'select', options: TARGETS },
      { key: 'kind', label: 'Kind', type: 'select', options: [
        { value: 'step', label: 'Step change during range (temporary)' },
        { value: 'growth', label: 'Extra annual growth during range (permanent)' }
      ] },
      { key: 'pct', label: 'Percent', type: 'percent', help: 'Negative to reduce. Step: −20% = 80% of baseline. Growth: +2% = compounding 2%/yr on top of normal growth.' },
      rangeFields[0], rangeFields[1]
    ],
    defaults: function (age, plan) {
      return { label: 'Adjustment', target: 'spending', kind: 'step', pct: -0.1, startAge: age, endAge: plan ? plan.profile.endAge : age + 10 };
    },
    presets: [
      { label: 'Sabbatical (no income 1 yr)', values: { label: 'Sabbatical', target: 'income', kind: 'step', pct: -1, endAgeOffset: 0 } },
      { label: 'Go part-time (−40% income)', values: { label: 'Part-time', target: 'income', kind: 'step', pct: -0.4, endAgeOffset: 4 } },
      { label: 'Promotion track (+2%/yr)', values: { label: 'Promotion track', target: 'income', kind: 'growth', pct: 0.02, endAgeOffset: 4 } },
      { label: 'Slow-go years (−20% spend)', values: { label: 'Slow-go years', target: 'spending', kind: 'step', pct: -0.2, endAgeOffsetToEnd: true } },
      { label: 'Boost savings (+25%)', values: { label: 'Boost savings', target: 'savings', kind: 'step', pct: 0.25, endAgeOffset: 4 } }
    ],
    isActive: function (ev, age) { return inRange(ev, age); },
    summary: function (ev) {
      var t = (TARGETS.filter(function (x) { return x.value === ev.target; })[0] || {}).label || ev.target;
      var p = (num(ev.pct) >= 0 ? '+' : '') + fmt.pct(num(ev.pct), 1);
      return t + ' ' + p + (ev.kind === 'growth' ? '/yr' : '') + ', ' + ageRangeText(ev);
    },
    apply: function (ev, y, ctx) {
      var key = ev.target in y.mods ? ev.target : 'spending';
      var p = ctx.persist;
      if (ev.kind === 'growth') {
        if (p.factor == null) p.factor = 1;
        if (inRange(ev, ctx.age)) p.factor *= 1 + num(ev.pct);
        y.mods[key] *= p.factor;
      } else if (inRange(ev, ctx.age)) {
        y.mods[key] *= Math.max(0, 1 + num(ev.pct));
      }
    }
  });

  // ---------------------------------------------------------------------------
  types.register({
    id: 'returnOverride',
    label: 'Market return override',
    description: 'Force the portfolio return for specific years — model a crash, a bad sequence early in retirement, or a strong run.',
    color: 'var(--ev-market)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'set', label: 'Set return to' },
        { value: 'add', label: 'Add to normal return' }
      ] },
      { key: 'rate', label: 'Return', type: 'percent' },
      rangeFields[0], rangeFields[1]
    ],
    defaults: function (age) { return { label: 'Market crash', mode: 'set', rate: -0.25, startAge: age, endAge: age }; },
    presets: [
      { label: 'Crash −30% (1 yr)', values: { label: 'Crash', rate: -0.3 } },
      { label: 'Bear market (3 yrs, −10%/yr)', values: { label: 'Bear market', rate: -0.1, endAgeOffset: 2 } },
      { label: 'Lost decade (−3% vs normal)', values: { label: 'Lost decade', mode: 'add', rate: -0.03, endAgeOffset: 9 } }
    ],
    isActive: function (ev, age) { return inRange(ev, age); },
    summary: function (ev) {
      return (ev.mode === 'add' ? 'Return ' + (num(ev.rate) >= 0 ? '+' : '') + fmt.pct(num(ev.rate)) : 'Return = ' + fmt.pct(num(ev.rate))) + ', ' + ageRangeText(ev);
    },
    apply: function (ev, y, ctx) {
      if (!inRange(ev, ctx.age)) return;
      if (ev.mode === 'add') y.mods.returnDelta += num(ev.rate);
      else y.mods.returnOverride = num(ev.rate);
    }
  });

  /** Build a new event of `typeId` at `age`, optionally applying a preset. */
  RP.events.create = function (typeId, age, plan, preset) {
    var def = types.get(typeId);
    if (!def) throw new Error('Unknown event type ' + typeId);
    var ev = Object.assign({ id: RP.util.uid('ev'), type: typeId, enabled: true }, def.defaults(age, plan));
    if (preset) {
      var v = Object.assign({}, preset.values);
      if (v.endAgeOffset != null) { ev.endAge = age + v.endAgeOffset; delete v.endAgeOffset; }
      if (v.endAgeOffsetToEnd) { ev.endAge = plan ? plan.profile.endAge : age + 20; delete v.endAgeOffsetToEnd; }
      Object.assign(ev, v);
    }
    if (ev.endAge != null && plan) ev.endAge = Math.min(ev.endAge, plan.profile.endAge);
    return ev;
  };

  RP.events.describe = function (ev) {
    var def = types.get(ev.type);
    return def ? def.summary(ev) : ev.type;
  };
})(globalThis.RP);
