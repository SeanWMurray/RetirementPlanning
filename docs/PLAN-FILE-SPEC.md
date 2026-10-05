# Canadian Retirement Planner: Plan File Specification

**Format:** `canadian-retirement-planner` plan file, **schema version 2**
**File type:** JSON (UTF-8), conventionally named `something.retirement-plan.json`

This document fully describes the plan file used by the Canadian Retirement Planner. It is written so a person can upload it to an AI assistant (ChatGPT, Claude, Gemini, etc.), describe their situation, and get back a plan file to import with **File › Paste Plan…** or **File › Open Plan…**.

---

## Part 1: For the person using this file

1. Upload this file to your AI assistant.
2. Paste the prompt below (edit the last line), then answer its questions.
3. Copy the AI's reply. In the planner choose **File › Paste Plan…** and paste it, or save it as a `.json` file and use **File › Open Plan…**.
4. If the planner lists problems, click **Copy list**, paste the list back to the AI and ask for a corrected file.

Suggested prompt:

> Using the attached plan file specification, interview me about my finances and then produce a plan file I can import into the Canadian Retirement Planner. Ask me questions in small groups, use sensible Canadian defaults for anything I don't know (and tell me which defaults you used), include two or three useful scenarios for my situation, and reply with the final file as a single JSON code block.
> My situation: *(describe yourself here: age, province, income, savings, spending, plans…)*

**Privacy:** the planner never sends your data anywhere, but the AI service receives whatever you type. You don't need your name, employer, SIN or account numbers: ages and dollar amounts are enough.

---

## Part 2: Instructions for the AI assistant

You are generating a JSON plan file for a deterministic Canadian retirement projection tool. Follow these rules exactly.

1. **Interview first.** Ask for what you need (see the *Interview checklist*), a few questions at a time. Don't invent personal facts. When the user doesn't know something, use the defaults in this spec and list the assumptions you made in `meta.notes`.
2. **Output one JSON object** in a single fenced ```` ```json ```` code block. No comments, no trailing commas, no `NaN`/`Infinity`, no placeholder text like `"..."`.
3. **Rates are decimals**: 5% is `0.05`, −20% is `-0.2`. Never write `5` for 5%.
4. **Dollar amounts are plain numbers** with no `$` or commas (`72000`, not `"$72,000"`). Unless a field says otherwise, amounts are **annual** and in **today's dollars** (the engine inflates them).
5. **Ages are whole numbers.** Event ages must fall between `profile.currentAge` and `profile.endAge`.
6. **Use only the fields and enum values in this document.** Unknown fields are ignored; wrong enum values are rejected.
7. **IDs:** give every account, spending item, event and scenario a unique, short, lowercase id (e.g. `"rrsp"`, `"ev_condo"`, `"sc_retire55"`). Lists that reference accounts (`savings.order`, `retirement.withdrawalOrder`, contribution events) must use those exact account ids.
8. **Scenarios store differences only** (see *Scenarios*). Never copy the whole base plan into a scenario.
9. **Omitted fields get defaults**, so you can leave out anything not relevant. Always include `app`, `schemaVersion`, `meta.name`, `base.profile`, `base.income`, `base.spending`, `base.accounts` and `base.benefits`.
10. **Model what the tool supports** (see *Modelling recipes* and *Limitations*). If something can't be represented, approximate it with events and say so in `meta.notes`.
11. Before replying, **check your output against the *Validation rules***.

### Interview checklist

| Topic | Ask for | Default if unknown |
|---|---|---|
| Basics | Current age, target retirement age, province/territory | plan to age 95 |
| Income | Gross annual employment income; expected raises; self-employed? | raises 2.5–3%/yr nominal |
| Spending | Annual spending now (or a breakdown); change expected in retirement | about 55–65% of gross income; no change |
| Accounts | Balances of RRSP/RRIF/LIRA, TFSA, non-registered (and its cost base), cash | non-reg cost base = 80% of balance |
| Room | Unused TFSA room; RRSP deduction limit (Notice of Assessment) | leave `null` (estimated) |
| Saving style | Save whatever is left, a % of salary, or a fixed amount; which accounts first | "save everything left over", RRSP → TFSA → non-registered |
| Pensions | Workplace pension (DB amount and start age, bridge); CPP estimate; years in Canada | CPP $13,000/yr at 65 (adjust to income); full OAS |
| Big events | Home purchase/sale, kids, education, cars, travel, inheritance, care, part-time work | none |
| Assumptions | Risk level/return expectations, inflation | returns 6% before / 5% in retirement, inflation 2.1% |
| Scenarios | What they want to compare | 2–3 relevant ones (retire earlier/later, market crash, spending change, CPP timing) |

---

## Part 3: Conventions

| Topic | Rule |
|---|---|
| Rates | Decimal fractions: `0.05` = 5%. Negative allowed where noted. |
| Money | Numbers in Canadian dollars. Annual unless stated. |
| Today's dollars | Base spending, salary, account caps, CPP amount and events marked `"indexed": true` are in today's (start-year) dollars and grow with `assumptions.inflation`. Events with `"indexed": false` are fixed nominal amounts. |
| Ages | Whole years. The projection runs one row per age from `profile.currentAge` to `profile.endAge` inclusive. Age ranges in events are inclusive (`startAge` to `endAge`). |
| Year | `profile.startYear` is the calendar year of the first row. |
| `null` | Means "not set / use the default" where a field allows it. |
| Timing | Withdrawals at the start of the year, contributions mid-year, balances reported at year end. |

---

## Part 4: Top-level structure

```text
{
  "app": "canadian-retirement-planner",   required, exactly this string
  "schemaVersion": 2,                     required, this document describes version 2
  "meta": { ... },                        plan name and notes
  "base": { ... },                        the main plan (all inputs)
  "scenarios": [ ... ],                   optional alternatives, stored as differences from base
  "settings": { ... }                     optional display preferences
}
```

### `meta`

| Field | Type | Description |
|---|---|---|
| `name` | string | Plan name shown in the toolbar. |
| `notes` | string | Free text shown on the *Notes & method* tab. Put your assumptions here. |
| `created`, `modified` | string | ISO-8601 timestamps (optional). |

### `settings` (optional; omit unless asked)

| Field | Type | Default | Description |
|---|---|---|---|
| `realDollars` | boolean | `true` | Show values in today's dollars (`true`) or future dollars (`false`). |
| `chartMode` | `"stacked"` \| `"total"` | `"stacked"` | Portfolio chart style. |
| `activeTab` | string | `"projection"` | One of `projection`, `scenarios`, `analysis`, `montecarlo`, `tax`, `events`, `about`. |

---

## Part 5: `base`: the plan

### `base.profile`

| Field | Type | Default | Description |
|---|---|---|---|
| `currentAge` | integer 16–110 | 35 | Age in the first projection year. |
| `retirementAge` | integer | 60 | Employment income stops at this age. May be ≤ `currentAge` for someone already retired. |
| `endAge` | integer > currentAge | 95 | Last age projected ("plan to age"). |
| `province` | enum | `"ON"` | `AB`, `BC`, `MB`, `NB`, `NL`, `NS`, `NT`, `NU`, `ON`, `PE`, `QC`, `SK`, `YT`. |
| `startYear` | integer | current year | Calendar year of the first row, e.g. `2026`. |

### `base.income`

| Field | Type | Default | Description |
|---|---|---|---|
| `salary` | number ≥ 0 | 100000 | Gross annual employment (or self-employment) income now. Use `0` if retired. |
| `growth` | rate | 0.03 | Annual raise, **nominal** (includes inflation). |

### `base.spending`

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `"total"` \| `"itemized"` | `"total"` | Use one total, or sum the `items`. |
| `total` | number | 55000 | Annual spending in today's dollars (used when `mode` is `"total"`). Exclude savings, income tax and payroll deductions. |
| `retirementChange` | rate | 0 | Change applied to base spending from retirement onward, e.g. `-0.2` = 20% less. |
| `growthWorking` | rate or null | `null` | Yearly increase of base spending before retirement, **including inflation** (e.g. `0.03`). `null` = grow with inflation (constant lifestyle in today's dollars). |
| `growthRetired` | rate or null | `null` | Yearly increase of base spending in retirement, including inflation. E.g. `0.01` with 2.1% inflation is a gradual real decline, common as retirees age. `null` = inflation. |
| `items` | array | 7 sample lines | Used when `mode` is `"itemized"`. See below. |

Spending item:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique id. |
| `name` | string | Label. |
| `amount` | number | Annual amount. |
| `phase` | `"all"` \| `"working"` \| `"retired"` | When it applies. Default `"all"`. |
| `indexed` | boolean | Default `true` (today's dollars). |
| `startAge`, `endAge` | integer or null | Optional age window. |
| `enabled` | boolean | Optional, default `true`. |

One-off or temporary costs (a car, a wedding, kids) are better modelled as **events** than as spending items.

### `base.accounts` (array)

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique id, referenced by `savings.order`, `retirement.withdrawalOrder` and contribution events. |
| `name` | string | Label. |
| `type` | enum | `"rrsp"`: RRSP/RRIF/LIRA/spousal RRSP (tax-deductible contributions, fully taxable withdrawals, RRIF minimums from 72). `"tfsa"`: tax-free. `"nonreg"`: non-registered (growth taxed as capital gains on withdrawal, 50% inclusion). `"cash"`: savings/HISA/GIC (interest taxed every year). |
| `balance` | number ≥ 0 | Current balance. |
| `costBase` | number | `nonreg` only: adjusted cost base (ACB). Default = balance. |
| `contribLimit` | enum | How much of each year's savings this account can take: `"legal"` = up to available contribution room (RRSP/TFSA only; tracked automatically), `"custom"` = up to `contributionCap` per year, `"unlimited"` = no limit, `"none"` = never contribute. |
| `contributionCap` | number or null | Annual amount in today's dollars, used when `contribLimit` is `"custom"`. |
| `startingRoom` | number or null | `rrsp`/`tfsa` only. TFSA: unused contribution room on January 1 of `startYear` (CRA My Account). RRSP: "RRSP deduction limit" from the latest Notice of Assessment. `null` = estimate (TFSA: this year's limit only; RRSP: 18% of last year's salary). |
| `returnRate` | rate or null | Override this account's annual return. `null` = use `assumptions` (cash uses `assumptions.cashReturn`). |

Room rules applied when `savings.enforceRoom` is `true`:
- **TFSA:** room grows each January by the annual limit ($7,000 in 2026, indexed and rounded to the nearest $500). Unused room carries forward, and withdrawals are added back the next year.
- **RRSP:** room grows by 18% of the prior year's employment income, up to the yearly maximum ($33,810 in 2026, indexed). No contributions after age 71.

Typical setup: RRSP `"legal"`, TFSA `"legal"`, non-registered `"unlimited"`, cash `"none"`. Include at least one `"unlimited"` account so surplus savings always have somewhere to go. Members of workplace pension plans should use `"custom"` for the RRSP, because the pension adjustment isn't modelled.

### `base.savings`

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | enum | `"surplus"` | `"surplus"` = invest everything left after tax and spending. `"percentGross"` = contribute a % of salary; leftover cash is assumed spent. `"fixed"` = contribute a set amount that increases every year; leftover cash is assumed spent. |
| `rate` | rate | 0.15 | For `percentGross`: savings rate in the first year. |
| `rateStep` | rate | 0 | For `percentGross`: added to the rate each year, in percentage points as a decimal (`0.005` = +0.5 points/yr, so 10% → 10.5% → 11%). Negative values lower it (never below 0). |
| `rateMax` | rate or null | 0.3 | For `percentGross`: the rate stops rising at this level. |
| `amount` | number | 15000 | For `fixed`: amount saved in the first year. |
| `amountGrowth` | rate or null | `null` | For `fixed`: annual increase of the amount, e.g. `0.05` = +5%/yr. `null` = grow with inflation (constant in today's dollars). |
| `order` | array of account ids | | Order in which savings fill accounts, each up to its limit. |
| `enforceRoom` | boolean | `true` | Cap RRSP/TFSA contributions at available room. |

If spending exceeds after-tax income in a working year, the shortfall is withdrawn from savings using `retirement.withdrawalOrder`.

### `base.retirement`

| Field | Type | Default | Description |
|---|---|---|---|
| `strategy` | enum | `"needs"` | `"needs"` = withdraw exactly what spending requires, grossed up for tax. `"fixedReal"` = withdraw `withdrawalRate` × the portfolio at retirement, then the same amount indexed to inflation (the "4% rule"). `"percentBalance"` = withdraw `withdrawalRate` × the current portfolio each year. With the last two, spending isn't guaranteed: shortfalls are flagged and surpluses reinvested. |
| `withdrawalRate` | rate | 0.04 | For `fixedReal` and `percentBalance`. |
| `withdrawalOrder` | array of account ids | | Order in which accounts are drawn. RRIF minimums are always taken first. |
| `rrifMinimums` | boolean | `true` | Apply RRIF minimum withdrawals from age 72. |

### `base.assumptions`

| Field | Type | Default | Description |
|---|---|---|---|
| `inflation` | rate | 0.021 | Also indexes tax brackets, credits, OAS, contribution limits and indexed amounts. |
| `returnPre` | rate | 0.06 | Annual compound return before retirement, after fees, nominal. |
| `returnPost` | rate | 0.05 | Annual compound return in retirement. |
| `cashReturn` | rate | 0.025 | Interest on `cash` accounts. |
| `volatility` | rate | 0.11 | Standard deviation of annual returns (Monte Carlo only). Typical values are 0.08–0.15. |

### `base.benefits`

| Field | Type | Default | Description |
|---|---|---|---|
| `cppEnabled` | boolean | `true` | Include CPP/QPP. |
| `cppAt65` | number | 13000 | Annual CPP/QPP pension **if started at 65**, in today's dollars (from the My Service Canada statement). The 2026 maximum is about 18,100; many people get 9,000–14,000. |
| `cppStartAge` | integer 60–70 | 65 | The amount is adjusted −0.6%/month before 65 and +0.7%/month after. |
| `oasEnabled` | boolean | `true` | Include Old Age Security. |
| `oasStartAge` | integer 65–70 | 65 | The amount is increased 0.6%/month for deferral. The 10% boost at 75 and the clawback are applied automatically. |
| `oasResidency` | rate 0–1 | 1 | Years lived in Canada after 18, divided by 40 (capped at 1). |

### `base.tax`

| Field | Type | Default | Description |
|---|---|---|---|
| `year` | string | `"2026"` | Tax table year. Currently only `"2026"`. |
| `mode` | enum | `"calculated"` | `"calculated"` = full federal and provincial calculation. `"flat"` = `flatRate` × taxable income. `"custom"` = `customBrackets`. Use `"calculated"` unless the user asks otherwise. |
| `flatRate` | rate | 0.30 | For `"flat"`. |
| `customBrackets` | array | | For `"custom"`: `[{ "upTo": 50000, "rate": 0.2 }, …, { "upTo": null, "rate": 0.5 }]`. Thresholds increase, and the last `upTo` is `null`. |
| `customCredit` | number | 15000 | For `"custom"`: tax-free amount credited at the first bracket's rate. |
| `indexBrackets` | boolean | `true` | Index thresholds with inflation. |
| `includePayroll` | boolean | `true` | Deduct CPP/QPP, EI and QPIP from employment income. |
| `selfEmployed` | boolean | `false` | Self-employed: pays both CPP halves and no EI. |
| `oasClawback` | boolean | `true` | Apply the OAS recovery tax. |

### `base.events` (array)

Events change the plan at specific ages. Every event has:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique id (unique across base and all scenarios). |
| `type` | enum | One of the types below. |
| `label` | string | Short name shown in tables and charts. |
| `enabled` | boolean | Default `true`. |

Ranges are inclusive. If `endAge` is omitted or equals `startAge`, the event lasts one year.

**`expense`**: extra spending.

| Field | Type | Description |
|---|---|---|
| `amount` | number | Amount per occurrence. |
| `startAge`, `endAge` | integer | Range. |
| `everyYears` | integer ≥ 1 | Default 1. For example, 8 = every 8 years starting at `startAge` (a car). |
| `indexed` | boolean | Default `true`. |

**`income`**: extra income for a range of ages (part-time work, DB pension, rental, annuity).

| Field | Type | Description |
|---|---|---|
| `amount` | number | Annual amount. |
| `startAge`, `endAge` | integer | Range. |
| `taxType` | enum | `"other"` = fully taxable. `"pension"` = taxable and eligible for the pension credit (DB pensions, annuities). `"nontaxable"`. |
| `indexed` | boolean | Default `true`. For a pension without indexation, use `false` and enter the amount in the dollars of the year it starts. |

**`lumpSum`**: a one-time inflow (inheritance, home sale, business sale, insurance).

| Field | Type | Description |
|---|---|---|
| `amount` | number | Amount. |
| `startAge` | integer | Age received. |
| `taxType` | enum | Usually `"nontaxable"`. Use `"other"` if taxable. |
| `indexed` | boolean | Default `true`. |

Surplus cash is invested following `savings.order` (excluding the RRSP once retired).

**`adjustment`**: change a baseline by a percentage or a dollar amount.

| Field | Type | Description |
|---|---|---|
| `target` | enum | `"income"` (salary), `"spending"` (base spending) or `"savings"` (the `percentGross`/`fixed` savings target; no effect in `surplus` mode). |
| `kind` | enum | `"step"` = **temporary**: applies only during the range. `"growth"` = **permanent**: applied for each year of the range and kept afterwards. |
| `unit` | enum | `"percent"` (default) or `"dollars"`. |
| `pct` | rate | When `unit` is `"percent"`. `step`: the baseline × (1 + `pct`) during the range (`-1` = zero, a sabbatical). `growth`: an extra `pct` raise compounding each year of the range (a promotion track). |
| `amount` | number | When `unit` is `"dollars"`, per year, negative to reduce. `step`: added each year of the range only (e.g. `-24000` spending after the mortgage is paid off). `growth`: added once for each year of the range and kept afterwards, then growing with `income.growth` (income) or inflation (spending/savings). Use `startAge` = `endAge` for a one-time permanent raise (e.g. `+250000` when a doctor finishes residency). |
| `indexed` | boolean | When `unit` is `"dollars"`: `true` (default) = today's dollars. |
| `startAge`, `endAge` | integer | Range. |

Dollar adjustments are added to the baseline first, and percentage adjustments then scale the result, so a later −100% sabbatical still zeroes a raised salary.

**`returnOverride`**: force market returns for certain years. This doesn't affect `cash` accounts.

| Field | Type | Description |
|---|---|---|
| `mode` | enum | `"set"` = the return becomes `rate`. `"add"` = `rate` is added to the normal return. |
| `rate` | rate | For example `-0.3` for a crash. |
| `startAge`, `endAge` | integer | Range. |

**`contribution`**: change one account's contribution limit for a range of ages.

| Field | Type | Description |
|---|---|---|
| `accountId` | string | An account id. |
| `mode` | enum | `"custom"` = up to `amount` per year (today's $). `"legal"` = up to available room (`"unlimited"` for non-registered). `"none"` = stop contributing. |
| `amount` | number | For `"custom"`. |
| `startAge`, `endAge` | integer | Range. |

---

## Part 6: Scenarios

A scenario is a named alternative. It stores **only what differs** from `base`:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique id. |
| `name` | string | Short name, e.g. "Retire at 55". |
| `color` | string | Hex colour for charts (optional), e.g. `"#e0812f"`, `"#239c8f"`, `"#8b5ca8"`, `"#c2416f"`, `"#c49a1c"`. |
| `visible` | boolean | Show on charts. Default `true`. |
| `notes` | string | One or two sentences explaining the scenario. |
| `overrides` | object | Map of **dotted path → new value**, applied to a copy of `base`. |
| `events` | array | Extra events that exist only in this scenario (same format as base events, with unique ids). |
| `disabledEvents` | array of ids | Base events switched off in this scenario. |

Override paths use the field names above, relative to `base`:

```text
"profile.retirementAge": 55
"spending.total": 48000
"spending.retirementChange": -0.15
"assumptions.returnPre": 0.045
"benefits.cppStartAge": 70
"retirement.strategy": "fixedReal"
"accounts": [ ...the complete accounts array... ]
```

**Arrays are replaced whole.** To change anything inside `accounts`, `spending.items`, `savings.order`, `retirement.withdrawalOrder` or `tax.customBrackets`, override the entire array (for example `"accounts": [...]`). Never use paths like `"accounts.0.balance"`. Don't override `events`: use the scenario's `events` and `disabledEvents` instead.

To *replace* a base event in a scenario (for example a smaller pension when retiring early), put the base event's id in `disabledEvents` and add the replacement to `events`.

---

## Part 7: Validation rules

The planner checks every file it opens. Errors are shown with the field path. Make sure that:

- `app` is `"canadian-retirement-planner"` and `schemaVersion` is `2`.
- Ages are integers, `16 ≤ currentAge ≤ 110`, `endAge > currentAge`, `cppStartAge` is 60–70 and `oasStartAge` is 65–70.
- `province` is a valid two-letter code and `tax.year` is `"2026"`.
- Every rate is a decimal in a sensible range (inflation −0.05–0.2; `spending.growthWorking`/`growthRetired` −0.2–0.2; returns −0.5–0.3; `savings.rate`, `savings.rateMax`, `oasResidency` and `flatRate` 0–1; `savings.rateStep` −0.1–0.1; `savings.amountGrowth` −0.5–0.5; `withdrawalRate` 0–0.5). A value like `5` for 5% is an error.
- Account ids are unique; `type` and `contribLimit` use the listed values; balances are ≥ 0; `contributionCap` is set when `contribLimit` is `"custom"`.
- Every event has a valid `type` and all its required fields, `endAge ≥ startAge`, and ages within the plan. A `contribution` event's `accountId` must exist.
- Scenario override paths exist in `base`, and the scenario's resulting plan also passes these checks. `disabledEvents` ids exist in `base.events`.
- The output is valid JSON: double quotes, no comments, no trailing commas.

---

## Part 8: Modelling recipes

| Situation | How to model it |
|---|---|
| Defined-benefit pension | `income` event, `taxType: "pension"`, from pension start to `endAge`. Add a second event for a bridge benefit ending at 64. Set the RRSP to `contribLimit: "custom"` with a small amount, because pension adjustments reduce RRSP room. |
| Buying a home | `expense` for the down payment and closing costs at the purchase age, plus a `spending` `adjustment` for the change in housing costs. |
| Selling or downsizing a home | `lumpSum`, `taxType: "nontaxable"` (principal residence), net of costs. |
| Children | `expense` with an age range (e.g. $15,000/yr for 18 years). RESP contributions can be an `expense` too. |
| Post-secondary costs | `expense` over the study years. |
| Car every N years | `expense` with `everyYears`. |
| Spending that rises or falls over time | `spending.growthWorking` / `spending.growthRetired` (nominal, including inflation). For a one-off change at a certain age use an `adjustment` event instead. |
| Travel early in retirement | `expense` from retirement for 10 years, or a `retired`-phase spending item. |
| Part-time work / consulting in retirement | `income`, `taxType: "other"`. |
| Rental property | `income` (net rental income, `taxType: "other"`). Model a later sale as a `lumpSum` (use `"other"` for the taxable portion if you want to approximate capital gains tax). |
| Inheritance | `lumpSum`, `taxType: "nontaxable"`. |
| Sabbatical / parental leave | `adjustment` on `income`, `kind: "step"`, `pct: -1` (or a partial value), plus an `income` event for EI/top-up if relevant. |
| Career growth spurt | `adjustment` on `income`, `kind: "growth"`, e.g. `pct: 0.02` for ages 30–40. |
| Known big raise (residency → staff physician, partnership, promotion) | `adjustment` on `income`, `kind: "growth"`, `unit: "dollars"`, `amount` = the raise, `startAge` = `endAge` = the age it starts. |
| Mortgage paid off | `adjustment` on `spending`, `kind: "step"`, `unit: "dollars"`, `amount` = −annual payments, from the payoff age to `endAge`. Or keep the mortgage out of `spending.total` and add an `expense` event for the payments until payoff. |
| Max out the TFSA for a decade | `contribution` event, `mode: "legal"`, on the TFSA account. |
| Stop RRSP contributions at 55 | `contribution` event, `mode: "none"`, on the RRSP account, from 55 to `endAge`. |
| Already retired | `salary: 0`, `retirementAge` ≤ `currentAge`, `cppStartAge`/`oasStartAge` = the ages they started, RRSP account holds the RRIF balance with `contribLimit: "none"`. |
| Self-employed | `tax.selfEmployed: true`. `salary` = net business income. |
| Quebec | `province: "QC"`. QPP, QPIP and the federal abatement are applied automatically. `cppAt65` holds the QPP estimate. |
| Market crash test | Scenario with `returnOverride` events (e.g. −30% at retirement age, −5% the next year). |
| Couples | The tool models **one person**. Either build one plan per spouse, or combine household income and spending in one plan and say in `meta.notes` that tax is approximated as if one person earned everything (this overstates tax). |
| Long-term care | `expense` late in life (e.g. $60,000–$90,000/yr for several years). |
| Annuity purchase | `expense` for the premium at purchase age, plus an `income` event with `taxType: "pension"` for the payments. |

---

## Part 9: Limitations (tell the user when relevant)

- One person only: no spousal pension splitting, survivor benefits or spousal RRSP attribution.
- Non-registered growth is treated as deferred capital gains. Dividends and annual distributions aren't modelled separately.
- RRSP room ignores pension adjustments. The RRSP maximum is indexed with inflation.
- Not modelled: the dividend tax credit, AMT, provincial low-income reductions, refundable credits, capital losses, the Home Buyers' Plan, LIRA unlocking rules, GIS.
- CPP is the user's estimate at 65, indexed with inflation, not computed from their contribution history.
- Some 2026 credit amounts are estimates (see the planner's Tax tab).

---

## Part 10: Minimal example

Everything not listed falls back to defaults.

```json
{
  "app": "canadian-retirement-planner",
  "schemaVersion": 2,
  "meta": { "name": "Simple plan", "notes": "Defaults used for returns and inflation." },
  "base": {
    "profile": { "currentAge": 40, "retirementAge": 62, "endAge": 95, "province": "SK", "startYear": 2026 },
    "income": { "salary": 85000, "growth": 0.025 },
    "spending": { "mode": "total", "total": 52000, "retirementChange": -0.1 },
    "accounts": [
      { "id": "rrsp", "name": "RRSP", "type": "rrsp", "balance": 90000, "contribLimit": "legal", "startingRoom": 20000 },
      { "id": "tfsa", "name": "TFSA", "type": "tfsa", "balance": 35000, "contribLimit": "legal", "startingRoom": 40000 },
      { "id": "nonreg", "name": "Non-registered", "type": "nonreg", "balance": 0, "costBase": 0, "contribLimit": "unlimited" }
    ],
    "savings": { "mode": "surplus", "order": ["rrsp", "tfsa", "nonreg"] },
    "retirement": { "strategy": "needs", "withdrawalOrder": ["nonreg", "rrsp", "tfsa"] },
    "benefits": { "cppEnabled": true, "cppAt65": 12000, "cppStartAge": 65, "oasEnabled": true, "oasStartAge": 65, "oasResidency": 1 }
  },
  "scenarios": []
}
```

---

## Part 11: Complete example

A 44-year-old in British Columbia with a DB pension at their current job, a planned home renovation, kids' university and three scenarios.

```json
{
  "app": "canadian-retirement-planner",
  "schemaVersion": 2,
  "meta": {
    "name": "Alex — Vancouver",
    "notes": "Assumptions: returns 6.0% before and 5.0% after retirement (balanced portfolio), inflation 2.1%, CPP estimate from the Service Canada statement. Spending excludes the mortgage, which is modelled as an expense until it is paid off at 56. DB pension figures from the 2025 pension statement."
  },
  "base": {
    "profile": { "currentAge": 44, "retirementAge": 62, "endAge": 95, "province": "BC", "startYear": 2026 },
    "income": { "salary": 118000, "growth": 0.03 },
    "tax": { "year": "2026", "mode": "calculated", "indexBrackets": true, "includePayroll": true, "selfEmployed": false, "oasClawback": true },
    "spending": {
      "mode": "itemized",
      "retirementChange": 0,
      "items": [
        { "id": "sp_home", "name": "Property tax, strata, insurance, upkeep", "amount": 14000, "phase": "all", "indexed": true },
        { "id": "sp_food", "name": "Groceries & dining", "amount": 13000, "phase": "all", "indexed": true },
        { "id": "sp_transport", "name": "Transportation", "amount": 8000, "phase": "all", "indexed": true },
        { "id": "sp_bills", "name": "Utilities, phone, internet", "amount": 4500, "phase": "all", "indexed": true },
        { "id": "sp_personal", "name": "Personal & discretionary", "amount": 9000, "phase": "all", "indexed": true },
        { "id": "sp_kids", "name": "Kids' activities", "amount": 6000, "phase": "all", "indexed": true, "startAge": 44, "endAge": 52 },
        { "id": "sp_travel", "name": "Travel", "amount": 10000, "phase": "retired", "indexed": true }
      ]
    },
    "accounts": [
      { "id": "rrsp", "name": "RRSP", "type": "rrsp", "balance": 140000, "contribLimit": "custom", "contributionCap": 6000, "startingRoom": 9000, "returnRate": null },
      { "id": "tfsa", "name": "TFSA", "type": "tfsa", "balance": 72000, "contribLimit": "legal", "startingRoom": 30000, "returnRate": null },
      { "id": "nonreg", "name": "Non-registered", "type": "nonreg", "balance": 25000, "costBase": 21000, "contribLimit": "unlimited", "returnRate": null },
      { "id": "cash", "name": "Emergency fund", "type": "cash", "balance": 20000, "contribLimit": "none", "returnRate": null }
    ],
    "savings": { "mode": "surplus", "enforceRoom": true, "order": ["tfsa", "rrsp", "nonreg", "cash"] },
    "retirement": { "strategy": "needs", "withdrawalRate": 0.04, "withdrawalOrder": ["cash", "nonreg", "rrsp", "tfsa"], "rrifMinimums": true },
    "assumptions": { "inflation": 0.021, "returnPre": 0.06, "returnPost": 0.05, "cashReturn": 0.025, "volatility": 0.1 },
    "benefits": { "cppEnabled": true, "cppAt65": 14500, "cppStartAge": 65, "oasEnabled": true, "oasStartAge": 65, "oasResidency": 1 },
    "events": [
      { "id": "ev_mortgage", "type": "expense", "label": "Mortgage payments", "amount": 26000, "startAge": 44, "endAge": 56, "everyYears": 1, "indexed": false, "enabled": true },
      { "id": "ev_reno", "type": "expense", "label": "Kitchen renovation", "amount": 45000, "startAge": 47, "endAge": 47, "everyYears": 1, "indexed": true, "enabled": true },
      { "id": "ev_university", "type": "expense", "label": "Kids' university", "amount": 18000, "startAge": 51, "endAge": 58, "everyYears": 1, "indexed": true, "enabled": true },
      { "id": "ev_car", "type": "expense", "label": "Car every 9 years", "amount": 38000, "startAge": 48, "endAge": 84, "everyYears": 9, "indexed": true, "enabled": true },
      { "id": "ev_db", "type": "income", "label": "DB pension", "amount": 24000, "startAge": 62, "endAge": 95, "taxType": "pension", "indexed": true, "enabled": true },
      { "id": "ev_tfsa_max", "type": "contribution", "label": "Max TFSA after mortgage", "accountId": "tfsa", "mode": "legal", "amount": 0, "startAge": 57, "endAge": 61, "enabled": true }
    ]
  },
  "scenarios": [
    {
      "id": "sc_retire58",
      "name": "Retire at 58",
      "color": "#e0812f",
      "visible": true,
      "notes": "Leave work at 58 with a reduced pension (about 15% less).",
      "overrides": { "profile.retirementAge": 58 },
      "events": [
        { "id": "ev_db_early", "type": "income", "label": "DB pension (reduced)", "amount": 17500, "startAge": 58, "endAge": 95, "taxType": "pension", "indexed": true, "enabled": true }
      ],
      "disabledEvents": ["ev_db"]
    },
    {
      "id": "sc_crash",
      "name": "Crash at retirement",
      "color": "#c2416f",
      "visible": true,
      "notes": "A 30% market drop the year of retirement, then a flat year.",
      "overrides": {},
      "events": [
        { "id": "ev_crash1", "type": "returnOverride", "label": "Crash", "mode": "set", "rate": -0.3, "startAge": 62, "endAge": 62, "enabled": true },
        { "id": "ev_crash2", "type": "returnOverride", "label": "Flat year", "mode": "set", "rate": 0, "startAge": 63, "endAge": 63, "enabled": true }
      ],
      "disabledEvents": []
    },
    {
      "id": "sc_cpp70",
      "name": "Defer CPP & OAS to 70, spend less",
      "color": "#239c8f",
      "visible": true,
      "notes": "Bigger lifelong benefits, bridged by savings; 10% lower spending in retirement.",
      "overrides": { "benefits.cppStartAge": 70, "benefits.oasStartAge": 70, "spending.retirementChange": -0.1 },
      "events": [],
      "disabledEvents": []
    }
  ]
}
```

---

*Specification for schema version 2. If the planner's schema changes, this document and its examples are updated together; the project's tests check that the examples above import without errors.*
