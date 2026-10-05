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
 *   y.mods.incomeAdd / spendingAdd / savingsAdd        dollar amounts added to the baseline (default 0)
 *   y.mods.returnOverride  (number|null)  replaces the portfolio return this year
 *   y.mods.returnDelta     (number)       added to the portfolio return this year
 *   y.mods.contrib[accountId] = { mode: 'custom'|'legal'|'none', amount }  overrides an account's contribution limit
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
  var UNITS = [{ value: 'percent', label: 'Percent (%)' }, { value: 'dollars', label: 'Dollars ($)' }];
  function isDollars(ev) { return ev.unit === 'dollars'; }
  types.register({
    id: 'adjustment',
    label: 'Income / spending / savings adjustment',
    description: 'Change a baseline by a percentage or a dollar amount — temporarily (only during the ages chosen, e.g. sabbatical −100%, mortgage paid off −$24,000) or permanently (a raise that stays, e.g. +$150,000 when a doctor finishes residency, or +2%/yr extra growth on a promotion track).',
    color: 'var(--ev-adjust)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'target', label: 'Applies to', type: 'select', options: TARGETS },
      { key: 'kind', label: 'Kind', type: 'select', options: [
        { value: 'step', label: 'Temporary — only during the ages chosen' },
        { value: 'growth', label: 'Permanent — a raise/cut that stays afterwards' }
      ] },
      { key: 'unit', label: 'Amount in', type: 'select', options: UNITS },
      { key: 'pct', label: 'Percent', type: 'percent', showIf: function (e) { return !isDollars(e); },
        help: 'Negative to reduce. Temporary: −20% = 80% of normal during the range. Permanent: +2% = an extra 2% raise every year of the range, kept afterwards.' },
      { key: 'amount', label: 'Dollars per year', type: 'money', showIf: isDollars,
        help: 'Negative to reduce. Temporary: added every year of the range only. Permanent: added once for each year of the range and kept afterwards, growing with your normal raises (income) or inflation (spending/savings). Use the same From and To age for a one-time raise.' },
      { key: 'indexed', label: "In today's dollars (inflation-indexed)", type: 'toggle', showIf: isDollars },
      rangeFields[0], rangeFields[1]
    ],
    defaults: function (age, plan) {
      return { label: 'Adjustment', target: 'spending', kind: 'step', unit: 'percent', pct: -0.1, amount: 10000, indexed: true, startAge: age, endAge: plan ? plan.profile.endAge : age + 10 };
    },
    presets: [
      { label: 'Big raise ($, permanent)', values: { label: 'Big raise', target: 'income', kind: 'growth', unit: 'dollars', amount: 150000, endAgeOffset: 0 } },
      { label: 'Sabbatical (no income 1 yr)', values: { label: 'Sabbatical', target: 'income', kind: 'step', pct: -1, endAgeOffset: 0 } },
      { label: 'Go part-time (−40% income)', values: { label: 'Part-time', target: 'income', kind: 'step', pct: -0.4, endAgeOffset: 4 } },
      { label: 'Promotion track (+2%/yr)', values: { label: 'Promotion track', target: 'income', kind: 'growth', pct: 0.02, endAgeOffset: 4 } },
      { label: 'Mortgage paid off (−$ spending)', values: { label: 'Mortgage paid off', target: 'spending', kind: 'step', unit: 'dollars', amount: -24000, endAgeOffsetToEnd: true } },
      { label: 'Slow-go years (−20% spend)', values: { label: 'Slow-go years', target: 'spending', kind: 'step', pct: -0.2, endAgeOffsetToEnd: true } },
      { label: 'Boost savings (+25%)', values: { label: 'Boost savings', target: 'savings', kind: 'step', pct: 0.25, endAgeOffset: 4 } }
    ],
    isActive: function (ev, age) { return inRange(ev, age); },
    summary: function (ev) {
      var t = (TARGETS.filter(function (x) { return x.value === ev.target; })[0] || {}).label || ev.target;
      var oneYear = ev.endAge == null || ev.endAge === '' || num(ev.endAge) === num(ev.startAge);
      if (isDollars(ev)) {
        var a = num(ev.amount), d = (a >= 0 ? '+' : '−') + fmt.money(Math.abs(a)).replace('−', '');
        if (ev.kind === 'growth') return t + ' ' + d + (oneYear ? ' from age ' + num(ev.startAge) + ' (permanent)' : ' per year of ' + ageRangeText(ev) + ' (permanent)');
        return t + ' ' + d + '/yr, ' + ageRangeText(ev);
      }
      var p = (num(ev.pct) >= 0 ? '+' : '') + fmt.pct(num(ev.pct), 1);
      return t + ' ' + p + (ev.kind === 'growth' ? '/yr' : '') + ', ' + ageRangeText(ev);
    },
    apply: function (ev, y, ctx) {
      var key = ev.target === 'income' || ev.target === 'savings' ? ev.target : 'spending';
      var p = ctx.persist;
      if (isDollars(ev)) {
        // Dollar adjustments add to the baseline (before percentage adjustments are applied).
        var amt = num(ev.amount) * (ev.indexed === false ? 1 : ctx.cpi);
        if (ev.kind === 'growth') {
          // A permanent raise/cut: keeps growing like the baseline it is part of.
          var inf = num(ctx.plan.assumptions.inflation);
          var rate = key === 'income' ? num(ctx.plan.income.growth)
            : key === 'spending' ? RP.engine.spendingGrowth(ctx.plan.spending, ctx.age >= num(ctx.plan.profile.retirementAge), inf)
            : inf;
          p.level = p.level == null ? 0 : p.level * (1 + rate);
          if (inRange(ev, ctx.age)) p.level += amt;
          y.mods[key + 'Add'] += p.level;
        } else if (inRange(ev, ctx.age)) {
          y.mods[key + 'Add'] += amt;
        }
        return;
      }
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

  // ---------------------------------------------------------------------------
  function accountOptions() {
    var plan = RP.store ? RP.store.effective() : null;
    return (plan ? plan.accounts : []).map(function (a) { return { value: a.id, label: a.name }; });
  }
  function accountName(id) {
    var o = accountOptions().filter(function (x) { return x.value === id; })[0];
    return o ? o.label : id;
  }
  var CONTRIB_MODES = [
    { value: 'custom', label: "Contribute up to a set amount (today's $)" },
    { value: 'legal', label: 'Contribute up to available room / no limit' },
    { value: 'none', label: 'Stop contributing' }
  ];
  types.register({
    id: 'contribution',
    label: 'Contribution change',
    description: 'Override how much goes into one account for a range of ages, e.g. max the TFSA from 40–50, $10k/yr to the RRSP after a raise, or stop RRSP contributions at 55. Still subject to RRSP/TFSA room when room is enforced.',
    color: 'var(--ev-income)',
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'accountId', label: 'Account', type: 'select', options: accountOptions },
      { key: 'mode', label: 'Change', type: 'select', options: CONTRIB_MODES },
      { key: 'amount', label: "Annual amount (today's $)", type: 'money', help: 'Used with "up to a set amount".' },
      rangeFields[0], rangeFields[1]
    ],
    defaults: function (age, plan) {
      var acct = plan && plan.accounts.filter(function (a) { return a.type === 'tfsa'; })[0] || (plan && plan.accounts[0]);
      return { label: 'Contribution change', accountId: acct ? acct.id : null, mode: 'custom', amount: 10000, startAge: age, endAge: Math.min(age + 9, plan ? plan.profile.endAge : age + 9) };
    },
    presets: [
      { label: 'Max out TFSA', values: { label: 'Max TFSA', mode: 'legal', accountType: 'tfsa', endAgeOffset: 9 } },
      { label: 'Stop RRSP contributions', values: { label: 'Stop RRSP', mode: 'none', accountType: 'rrsp', endAgeOffsetToEnd: true } }
    ],
    isActive: function (ev, age) { return inRange(ev, age); },
    summary: function (ev) {
      var what = ev.mode === 'none' ? 'stop' : ev.mode === 'legal' ? 'max out' : fmt.money(num(ev.amount)) + '/yr';
      return accountName(ev.accountId) + ': ' + what + ', ' + ageRangeText(ev);
    },
    apply: function (ev, y, ctx) {
      if (!ev.accountId || !inRange(ev, ctx.age)) return;
      y.mods.contrib[ev.accountId] = { mode: ev.mode || 'custom', amount: num(ev.amount) };
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
      if (v.accountType) {
        var match = plan && plan.accounts.filter(function (a) { return a.type === v.accountType; })[0];
        if (match) ev.accountId = match.id;
        delete v.accountType;
      }
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
