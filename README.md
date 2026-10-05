# Canadian Retirement Planner

A private, browser-only retirement planning tool for Canadians. No server, no account, no build step. Open `index.html` and plan.

![Projection view](docs/screenshots/light-projection.png)

## Screenshots

The app follows your system's light/dark setting; you can also switch themes under **View › Theme**.

| View | |
|---|---|
| **Year-by-year table**: click any row to add an event at that age | [![](docs/screenshots/light-table-menu.png)](docs/screenshots/light-table-menu.png) |
| **Scenarios**: overlay and compare against the base plan | [![](docs/screenshots/light-scenarios.png)](docs/screenshots/light-scenarios.png) |
| **Sensitivity**: solvers, tornado chart, two-way grid | [![](docs/screenshots/light-sensitivity.png)](docs/screenshots/light-sensitivity.png) |
| **Monte Carlo**: probability of success and percentile bands | [![](docs/screenshots/light-montecarlo.png)](docs/screenshots/light-montecarlo.png) |
| **Tax**: full return-style breakdown for any year | [![](docs/screenshots/light-tax.png)](docs/screenshots/light-tax.png) |
| **Events**: timeline of life events across the plan | [![](docs/screenshots/light-events.png)](docs/screenshots/light-events.png) |

## Features

- **Tax engine.** Federal plus every province and territory, using 2026 brackets. It handles the basic personal amount (with phase-outs), age, pension and Canada employment amounts, and CPP/QPP, EI and QPIP. It also covers enhanced CPP deductions, the OAS clawback, the Ontario surtax and Health Premium, and the Quebec abatement. Brackets index forward with inflation. You can override with a flat rate or your own brackets.
- **Accounts.** RRSP/RRIF (deductible contributions, taxable withdrawals, RRIF minimums from 72), TFSA, non-registered (cost base tracked, capital gains taxed on withdrawal) and cash/HISA (interest taxed annually). Contribution and withdrawal orders are configurable, with per-account return overrides.
- **Contributions & room.** Each account takes savings up to its contribution room, a set annual amount, no limit, or nothing. RRSP room is 18% of the prior year's earned income up to the indexed maximum, with no contributions after 71. TFSA room uses the annual limit indexed in $500 steps, carries unused room forward and re-adds withdrawals the following year. You can enter your current unused room from CRA My Account or your Notice of Assessment. A *Contribution change* event overrides any account for a range of ages, for example maxing the TFSA from 40–50 or stopping RRSP contributions at 55.
- **Government benefits.** CPP with early/late adjustment and OAS with deferral, residency, the 10% boost at 75, and the clawback.
- **Spending.** One total, or itemised lines tagged "always", "working" or "retired". Includes a percentage change at retirement.
- **Savings.** Save the whole surplus, a percentage of salary, or a fixed amount.
- **Retirement drawdown.** Three strategies:
  - spending-based (grossed up for tax)
  - fixed rate on the starting balance (the 4% rule)
  - a percentage of the current balance
- **Life events.** Click any year in the table or chart to add one:
  - one-off or recurring expenses
  - income (part-time work, DB pension, rental)
  - lump sums
  - % adjustments to income, spending or savings (temporary steps, or extra compounding growth)
  - market-return overrides
- **Scenarios.** Each scenario stores only its differences from the base plan. Changes to the base flow through, and scenarios overlay on the charts with side-by-side metrics.
- **Analysis.** Tornado sensitivity, a two-way sensitivity heatmap, a "max sustainable spending" solver, an "earliest retirement age" solver and Monte Carlo simulation.
- **Output.** Year-by-year table with selectable columns, CSV export, print/PDF, and today's-dollars vs future-dollars views.
- **Saving.** Autosaves in your browser (localStorage). Export/import `.json` plan files, or drag a plan file onto the page. Undo/redo.

### On phones

On a phone the app switches to a mobile layout: results first, a bottom bar to switch between **Inputs** and **Results**, a live summary while you edit, bottom-sheet menus, full-screen dialogs and touch-sized controls.

| Results | Inputs |
|---|---|
| <img src="docs/screenshots/mobile-light-results.png" width="240" alt="Phone: results"> | <img src="docs/screenshots/mobile-light-inputs.png" width="240" alt="Phone: inputs"> |

## Example plans

Six ready-made plans with scenarios ship with the app. Open them with **File › Open Example…**, or download them from [`examples/`](examples/):

| Example | Situation | Scenarios |
|---|---|---|
| [Early career renter — Toronto](examples/early-career-toronto.retirement-plan.json) | 28, ON, $72k, TFSA-first | Buy a condo · retire at 50 · promotion track |
| [Mid-career engineer — Calgary](examples/mid-career-calgary.retirement-plan.json) | 42, AB, $145k, RRSP-heavy | Retire at 55 · crash at retirement · CPP/OAS at 70 · 4% rule |
| [Teacher with a DB pension — Halifax](examples/teacher-db-pension-halifax.retirement-plan.json) | 50, NS, $98k, DB pension | Retire at 55 (reduced pension) · tutoring · long-term care |
| [Self-employed consultant — Montréal](examples/self-employed-montreal.retirement-plan.json) | 45, QC, $120k self-employed | Sell the business · sabbatical · lower returns |
| [Recently retired — Victoria](examples/retired-victoria.retirement-plan.json) | 67, BC, retired | 4% rule · RRIF meltdown · crash at 68 |
| [Late starter — Winnipeg](examples/late-starter-winnipeg.retirement-plan.json) | 52, MB, $68k, little saved | Work longer · spend less · inheritance · all three |

See [examples/README.md](examples/README.md) for each plan's story and results.

## Build your plan with an AI assistant

[`docs/PLAN-FILE-SPEC.md`](docs/PLAN-FILE-SPEC.md) is a complete specification of the plan file format, written for AI assistants.

1. **Upload it.** Download the file and upload it to ChatGPT, Claude, Gemini or similar, together with the suggested prompt at the top of the spec.
2. **Answer its questions.** The assistant interviews you about your situation and replies with a plan file that includes scenarios.
3. **Load the plan.** In the planner choose **File › Paste Plan…** and paste the reply. You can also save the reply as `.json` and use **File › Open Plan…**.
4. **Fix any problems.** Every opened file is validated: rates written as percentages, unknown fields or account ids, impossible ages and so on. If problems are found, **Copy list**, paste it back to the assistant, and ask for a corrected file.

The spec's two example plans are checked by the test suite, so the documentation can't drift from the code.

## Running it

**Locally:** download or zip this folder and double-click `index.html`. You don't need to run any commands.

**On a website:** upload the folder to any static host (your own site, GitHub Pages, Netlify, S3, etc.).

The only external resource is [Chart.js](https://www.chartjs.org/), loaded from cdnjs. Without an internet connection the calculations, tables and inputs still work and the charts show a notice. To make it fully offline, download `chart.umd.min.js` into the folder and point the `<script>` tag in `index.html` at it.

## Privacy

Everything runs in the browser. Plans are stored in that browser's localStorage and are never transmitted. Use **File → Export** to keep a copy or move it to another computer.

## Project layout

```
index.html                 entry point; loads the scripts below in order
css/app.css                all styles (light + dark tokens at the top)
js/core.js                 RP namespace, registries, utilities, formatting
js/data/tax-2026.js        tax brackets, credits, CPP/EI/OAS parameters, RRIF factors
js/engine/                 pure calculation code, no DOM; also runs in Node
  tax.js                   income tax + payroll + province rules (RP.taxRules)
  events.js                life-event types (RP.eventTypes)
  strategies.js            savings modes + withdrawal strategies
  projection.js            the year-by-year simulation
  scenarios.js             base plan + scenario overrides -> effective plan
  analysis.js              sensitivity, solvers, Monte Carlo (RP.metrics, RP.sensitivityVariables)
js/state/
  schema.js                plan file format, defaults, migrations
  store.js                 app state, undo/redo, autosave, import/export
js/ui/                     interface (plain DOM + Chart.js)
  inputs.js                left panel sections (RP.inputSections)
  panels/*.js              one file per tab (RP.tabs)
tests/run-tests.js         engine tests: `node tests/run-tests.js`
docs/screenshots/          images used in this README (regenerate: node tools/screenshots.js)
examples/                  example plan files (generated: node tools/build-examples.js)
docs/PLAN-FILE-SPEC.md     plan file format specification (also for AI assistants)
js/data/examples.js        the same examples bundled for File › Open Example (generated)
```

Files are plain `<script>`s, not ES modules, because browsers block modules on `file://`. Each file attaches what it defines to one global, `RP`.

## Extending it

Nearly everything is a **registry**. Adding a feature usually means registering one more entry; you rarely need to edit the engine.

| To add… | Register in | Where |
|---|---|---|
| A new kind of life event | `RP.eventTypes` | `js/engine/events.js` (its fields auto-generate the edit form) |
| A withdrawal strategy | `RP.withdrawalStrategies` | `js/engine/strategies.js` |
| A savings mode | `RP.savingsModes` | `js/engine/strategies.js` |
| A province-specific tax rule | `RP.taxRules` + `rules: [...]` on the province | `js/engine/tax.js`, `js/data/tax-*.js` |
| A sensitivity variable | `RP.sensitivityVariables` | `js/engine/analysis.js` |
| An output metric | `RP.metrics` | `js/engine/analysis.js` |
| A table column | `RP.tableColumns` | `js/ui/panels/projection.js` |
| A KPI tile | `RP.kpis` | `js/ui/app.js` |
| A scenario template | `RP.scenarioTemplates` | `js/ui/panels/scenarios.js` |
| A section in the input panel | `RP.inputSections` | `js/ui/inputs.js` |
| A whole new tab | `RP.tabs` | new file in `js/ui/panels/` + a `<script>` tag |

**New plan inputs:** add the field with a default in `schema.defaultBase()`, document it in `docs/PLAN-FILE-SPEC.md`, and add any checks to `schema.validate()`. Old saved plans automatically get the default when loaded, because loading deep-merges defaults underneath the file. If you ever need to rename or restructure stored data, bump `SCHEMA_VERSION` and add a step to `schema.migrations`.

**New tax year:** copy `js/data/tax-2026.js` to `tax-2027.js`, update the numbers, and add a `<script>` tag. It then appears in the "Tax table year" picker. Values marked `verify: true` are estimates and are listed in the Tax tab.

## Tests

```
node tests/run-tests.js
```

The tests cover bracket math, CPP/EI maximums, the OAS clawback, the Quebec abatement, every province, the cash-flow identity (income + withdrawals = tax + spending + savings, every year), events, strategies, scenarios and normalisation of old files. Node is only needed for the tests, not for using the app.

## Method & limitations

See the **Notes & method** tab in the app for the full methodology. In brief:
- Single person (no spousal planning or pension splitting yet).
- Contributions are made mid-year and withdrawals at the start of the year.
- Non-registered growth is treated as deferred capital gains at 50% inclusion.
- CPP is indexed from your entered estimate rather than modelled from your earnings history.
- No dividend tax credit, AMT or low-income provincial reductions.
- Contribution room is tracked but simplified: RRSP room uses employment income only (no pension adjustment), and the RRSP maximum is indexed with inflation rather than average wage growth.

Ideas for later: spouse/household modelling with pension splitting; guardrail withdrawal strategies; RRSP meltdown/CPP-timing optimisers; pension adjustments; dividend and distribution modelling; shareable plan links.

## Disclaimer

For education and personal planning only. This is not financial, tax or legal advice. Verify tax figures against CRA and provincial sources.
