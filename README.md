# The US economy, as it was published

Forty-seven headline US economic series from FRED — output, prices, jobs,
interest rates, housing, trade, energy and the federal balance sheet — with one
thing most charting demos do not have: the numbers **as they were first
announced**, set beside the numbers as they stand today.

Built on Lattice Grid loaded by `<script>` tag: no npm install, no bundler, no
build step, no `type="module"`.

| | |
| --- | --- |
| Grid on npm | [@toclocoinc/lattice-grid](https://www.npmjs.com/package/@toclocoinc/lattice-grid) |
| Grid repository | [toclocoinc/latticegrid](https://github.com/toclocoinc/latticegrid) |
| Product site | [latticegrid.dev](https://www.latticegrid.dev) |

A published economic statistic is an estimate, and it keeps moving after it is
announced. The advance estimate of US real GDP for the second quarter of 2020
was an annualised fall of **32.9%**. It now reads about **28%**. Nothing was
wrong with either number — the second one has more of the source data behind it
— but a chart drawn today shows only the second, and every decision taken in
August 2020 was taken on the first.

ALFRED, the archive beside FRED, keeps every vintage of every series: the
numbers exactly as they stood on a given day. This demo replays them.

## A note on the data, up front

**FRED does not allow browser requests.** Neither `api.stlouisfed.org` nor
`fred.stlouisfed.org/graph/fredgraph.csv` sends a cross-origin header, so no
page served from any other address can read FRED in a browser — not this one,
and not any other. Everything this page draws is a **saved copy** in
`data/snapshot/`, built in Node (where that rule does not apply) by
`tools/build-snapshot.mjs` and refreshed nightly by a scheduled workflow.

The page says so on screen. It does not offer to "try again": there is nothing
to try.

## How the grid gets onto the page

Six tags in `index.html`, and that is the whole of the library setup:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.css">

<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/lattice-grid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/charts.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/data-router.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/kpi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.66.0/modules/tabs.min.js"></script>
```

Each file is the package's UMD build (`*.min.js`, beside the `*.esm.min.js` the
ESM edition imports) and leaves a global behind:

| File | Global | Used here for |
| --- | --- | --- |
| `lattice-grid.min.js` | `LatticeGrid` | `createGrid`, `createStat`, `setLicence` |
| `modules/charts.min.js` | extends `LatticeGrid` | `LatticeGrid.createChart` |
| `modules/data-router.min.js` | `LatticeGridDataRouter` | `createDataRouter` |
| `modules/kpi.min.js` | `LatticeGridKPI` | `createKPI` |
| `modules/tabs.min.js` | `LatticeGridTabs` | `createTabs` |

The charts module folds its exports into the core global rather than defining
one of its own, so its tag must come after the core's. The other three are
self-contained and can go in any order. `main.js` checks that every factory it
needs is actually there before it draws anything, so a tag that did not load is
reported as a sentence rather than as an error from inside the grid.

Every address names the exact release, `1.66.0`, and every tag carries the
`integrity` hash of the file it expects, so the page cannot quietly pick up a
different build than the one it was checked against.

The demo's own code is five classic scripts, loaded in order after the library:
`src/licence.js`, `src/fred-data.js`, `src/vintages.js`, `src/dashboard.js`,
`main.js`. Each wraps itself in a function and puts what it offers on one plain
object, `FredDemo`, for the next file to read. `src/dashboard.js` is handed the
grid's factories as arguments and never touches a global itself.

## Running it

You need nothing but a browser and a way to serve the folder, because the page
reads its data with `fetch()` and browsers will not do that from `file://`. Any
static server will do; one is included:

```
node tools/serve.mjs
```

That prints an address. Open it.

Running a copy on your own machine needs no licence key. Publishing it on a web
address does.

## What it shows

**One stream, one router, four viewers.** The saved copy is loaded once, as a
single array carrying both the catalogue rows and every reading, and handed to
one `createDataRouter`. A `kind` property partitions it, and four routes take
their slices:

| Route | What it gets | What it drives |
| --- | --- | --- |
| `catalogue` | the `series` rows | the main grid, the table you choose from |
| `chart` | the `obs` rows, with an index column derived per route | the time-series chart |
| `tiles` | the same `obs` rows | the KPI tiles |
| `observations` | the same rows, **rolled up by date** | the readings table, a column per series |

plus a `subscribe` handler — a viewer that is not a grid at all — which keeps
the count under the chart honest off the same keyed diff the grids get.

**Ticking a series reloads nothing.** `router.link(catalogue, …)` makes the
main grid's selection a filter on what the other three routes receive. The
chart, the tiles and the readings table are re-pushed through the same keyed
diff the router uses for a live feed, so only rows that actually changed
repaint, and scroll and sort survive.

**The readings table is a router roll-up, not a second load.** The
`observations` route declares `rollup: { groupBy: 'd', aggregate: … }` with one
aggregate per catalogue series, so the long-form stream becomes one row per date
with a column per series. Every series has an aggregate from the start; the link
means an unselected series' rows never reach the route, so its aggregate sees
nothing and its column is hidden.

**Four transformations.** Level, percent change on the period before, percent
change on a year earlier, and an index set to 100 at a month you choose (1970-01
onwards; 2019-12 by default). The first three are columns the page computes once
when the snapshot is read; the index is computed in the route's own `transform`,
so changing the base month re-runs the transform and the keyed diff carries only
the numbers that moved.

**Recession shading.** The NBER recession indicator (`USREC`) is fetched and
turned into vertical bands through the charts module's declarative annotation
layer. It is never a row in the catalogue — it is shading, and nothing else.

**One measure axis, deliberately.** A level chart of series measured in
different units draws one unit at a time, chosen in the toolbar, and names the
series it is not drawing in the footnote. Percent change and the index put every
series into the same unit, which is what they are for.

**"As first published".** The second tab is the demo's reason for existing. Pick
one of the five headline series — real GDP growth, real GDP, nonfarm payrolls,
the unemployment rate, the CPI — and a vintage date, and the chart overlays the
numbers as announced on that day against the numbers as they stand now. A table
lists every reading's first print, its current value and the revision in both
absolute and percentage terms, and a tile reports the largest revision.

The rewind is the Data Router's own **time travel**, not a lookup. Each vintage
is pushed into the router as a batch of deltas stamped with that vintage's date,
and only the numbers that actually changed are re-sent — so the router's bounded
buffer holds the real revision history, one delta per revision. Moving the
slider calls `scrubTo(date, { by: 'time' })` and the router rebuilds the grid,
through the same keyed diff, to exactly what had been published by then.
`live()` returns to the newest vintage.

It opens on real GDP growth as it stood on **1 August 2020**, which is the
advance estimate of the second quarter of 2020.

## The data

Everything comes from FRED and ALFRED, the Federal Reserve Bank of St. Louis:

> Source: FRED®, Federal Reserve Bank of St. Louis; <https://fred.stlouisfed.org>.
> Series are U.S. government data (BEA, BLS, Board of Governors, Census,
> Treasury, EIA).

Every series in `tools/series.mjs` is published by a US federal agency and is in
the public domain, which is what makes it possible to save the values into this
repository and serve them from it. Series FRED redistributes under someone
else's licence are deliberately absent, and the snapshot tool refuses to write
any series whose FRED notes carry a copyright or permission line.

A few things worth knowing about the data:

- **Daily and weekly series are reduced to one reading a month** — the last
  reading of the month, stamped on the first of it, which is where FRED stamps a
  monthly series. Nothing is averaged or interpolated: each kept number is a
  number FRED published on a day. It is what lets every series line up on one
  date column.
- **Readings start at 1970-01-01**; vintage records start at 2015-01-01.
- **"Change on a year earlier" is a percentage of the series' own values.** For
  a series whose values are themselves a rate — the unemployment rate, a
  Treasury yield — that is the change in the rate, not the change in percentage
  points, and the page says so where the numbers are shown.
- **A level series is re-based at a comprehensive revision.** Real GDP moved
  from chained 2012 dollars to chained 2017 dollars, so its whole history shifts
  between vintages. That is a change of units, not a change of view about the
  economy, and the vintages chart says so in its footnote. Real GDP *growth*
  (`A191RL1Q225SBEA`) is base-independent, which is why the demo opens on it.
- **FRED will return a ZIP archive** rather than a CSV if one request asks for
  several ids whose publication frequencies differ (a "weekly, ending Saturday"
  series beside a "weekly, as of Wednesday" one). The snapshot tool therefore
  asks for one series per request and refuses an answer that is not a CSV.
- **`cosd`/`coed` are ignored** by the graph endpoints when more than one id is
  asked for.
- **ALFRED pairs `id` and `vintage_date` positionally**, so `id=GDP,GDP,GDP` with
  three vintage dates returns three columns — one per vintage — in one request.

## Files

```
index.html                page shell, and the six library tags
main.js                   reads the saved copy, then starts
src/licence.js            the key for this demo's own published address
src/fred-data.js          reading the snapshot and everything derived from it
src/dashboard.js          the catalogue, the router, the tiles, the chart, the tabs
src/vintages.js           "as first published": the time-travel replay
styles.css                the page around the grid
tools/series.mjs          the curated series list and the vintage dates
tools/build-snapshot.mjs  build data/snapshot from FRED, keyed or keyless
tools/serve.mjs           a small static file server
tools/verify.mjs          open it in a real browser and check it
data/snapshot/            the saved copy the page draws
```

There is no `package.json` and no `node_modules`. The tools need Node 22 or
newer and nothing else.

## Building the saved copy

```
node tools/build-snapshot.mjs
```

It works two ways, and writes the same four files either way, so the page cannot
tell which one built them:

| Mode | When | Where the metadata and vintages come from |
| --- | --- | --- |
| keyless | no `FRED_API_KEY` in the environment | values from the CSV graph endpoints; titles, units and frequency from `tools/series.mjs`; vintages from ALFRED's CSV endpoint at the fixed dates in that file |
| keyed | `FRED_API_KEY` is set | values the same; title, units, frequency, seasonal adjustment, last-updated stamp and notes from `fred/series`; every vintage date FRED holds since 2015 from `fred/series/vintagedates`; vintage values from `fred/series/observations` with a real-time range |

The four files:

| File | What it holds |
| --- | --- |
| `series.json` | one row per catalogue series: what it is and where from |
| `observations.json` | every reading, long form, `{ s, d, v }` |
| `vintages.json` | the five headline series as they stood on each vintage date |
| `meta.json` | when it was built, which way, the citation, and the counts |

The build fails loudly rather than writing a half-built copy: a series FRED
returns nothing for, a series whose vintages all hold the same numbers, or (in
keyed mode) a series carrying a copyright line in its notes all stop the run.

`.github/workflows/refresh.yml` runs it nightly at 09:30 UTC and on demand, and
commits `data/snapshot/` when it changed. It passes `FRED_API_KEY` from the
repository secrets; with no secret set it simply runs in the keyless mode and
still succeeds.

## Checking it

```
node tools/verify.mjs
node tools/verify.mjs --shots ./shots     # and save screenshots
```

`tools/verify.mjs` is not a smoke test. It first insists on how the library
arrived: no `type="module"` script anywhere on the page, five script tags
pointing at the pinned release on the CDN, each with an integrity hash, and each
leaving the global it documents. It then, in a real browser:

- recomputes every tile's figure from the saved files in Node and compares it
  with the tile, and insists no tile figure is cut short by an ellipsis, that
  every tile is a white card, and that they are all the same height;
- insists the main grid paints data rows, that its FRED ids are real links, and
  that no grid on the page shows the right-hand tool rail;
- checks the chart draws a time axis (not a row of labels), a line per selected
  series, and the recession shading, and that each of the four transformations
  redraws it with readings rather than empty axes;
- proves the index really is exactly 100 at the base month;
- ticks a series in the catalogue and insists the tiles, the chart route, the
  tile route and the readings table all moved — by exactly that series' readings
  and no others — then unticks it and insists everything went back;
- opens the vintages tab and insists the overlay chart draws two series, the
  revisions table paints rows, the router's buffer holds the revision history,
  the view opens rewound, the number on screen is the number ALFRED holds for
  that day, and that it has actually been revised since;
- rewinds to the earliest vintage and insists readings published later really
  disappear, then returns to today;
- checks nothing anywhere on the page reads "NaN";
- reloads at 400px wide and insists the page does not scroll sideways, the main
  grid still paints rows, and the vintages tab still draws both lines.

The GitHub Pages workflow runs it before every publish.

## Licence

The demo code is MIT. See `LICENSE`.

The data is from FRED® and ALFRED®, Federal Reserve Bank of St. Louis, and every
series shown is US federal government data in the public domain.

Lattice Grid itself is a separate commercial product with its own terms. It is
free to use on localhost, with no key and no watermark, so a copy of this
repository runs unrestricted on your own machine. This demo carries a key for
its own published address only, which is why you will find one in the source.
Keys for your own sites come from [latticegrid.dev](https://www.latticegrid.dev).

---
Built with [Lattice Grid](https://www.latticegrid.dev), a JavaScript data grid with a Data Router: one live feed keeps grids, charts, boards, Gantt and KPI tiles in step. [Documentation](https://www.latticegrid.dev/docs/) · [Demos](https://www.latticegrid.dev/demos/) · [Licence](https://www.latticegrid.dev/licence/)
