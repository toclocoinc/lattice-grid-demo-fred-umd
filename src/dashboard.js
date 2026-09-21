/**
 * The dashboard: a catalogue of US economic series, and every view built from
 * whichever of them you pick.
 *
 * The shape of it is one stream and one Data Router. The saved copy is loaded
 * once, as a single array holding both the catalogue rows and every reading,
 * and the router partitions it:
 *
 *   'series' -> the catalogue grid, the table you choose from
 *   'obs'    -> the chart's grid (long form, one row per reading)
 *   'obs'    -> the observations grid, as a rollup by date, one column per series
 *   'obs'    -> a plain subscriber, which keeps the line under the chart honest
 *
 * Choosing rows in the catalogue does not reload anything. `router.link` makes
 * the catalogue's selection a filter on what the other three routes receive, so
 * the chart, the tiles and the observations table are re-pushed through the
 * same keyed diff and keep their scroll and their sort.
 *
 * Nothing here reaches for a global: every factory is handed in, so this file
 * would read the same if the library had arrived as an import.
 *
 * A classic script: it reads `FredDemo`, put there by `fred-data.js`, and adds
 * `buildDashboard` alongside it.
 */
(function (root) {
  'use strict';

  const { prepare } = root.FredDemo;

  /**
   * The transformations the chart offers.
   *
   * The two change transformations do not say "%": whether a change is a
   * percentage or a number of percentage points depends on the series, and
   * `isRateSeries` decides it per series. The axis says which.
   */
  const MODES = [
    { id: 'level', label: 'Level', field: 'v' },
    { id: 'pct', label: 'Change on the period before', field: 'pp' },
    { id: 'yoy', label: 'Change on a year earlier', field: 'yp' },
    { id: 'index', label: 'Index, 100 at', field: 'idx' },
  ];

  /** How many tiles a reader is asked to take in at once. */
  const MAX_TILES = 6;

  /** What a change in a rate series is measured in. */
  const POINTS = 'Percentage points';
  /** What a change in a level or an index is measured in. */
  const PER_CENT = 'Per cent';

  const FRED_SERIES_URL = 'https://fred.stlouisfed.org/series/';

  /** Make an element with a class and optional text, the long way round. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** A number with a sensible number of digits for its magnitude. */
  function readable(value) {
    if (value == null || !Number.isFinite(value)) return 'No data';
    const size = Math.abs(value);
    const digits = size >= 1000 ? 0 : size >= 100 ? 1 : size >= 1 ? 2 : 3;
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  }

  /** A date, written out. */
  function longDate(date) {
    if (!date) return 'no date';
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  }

  /* ------------------------------------------------------------------ */
  /* Columns                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * The catalogue's columns: one row per series, and the three numbers that
   * say where it stands.
   *
   * Every format is a FormatSpec object rather than a function, which is the
   * only shape a column format takes.
   *
   * @param {{points: number, percent: number}} bars the symmetric bar ranges
   * @returns {object[]} the column definitions
   */
  function catalogueColumns(bars) {
    return [
      {
        id: 'title',
        field: 'title',
        title: 'Series',
        cell: { render: 'twoline', props: { secondary: 'units' } },
        filter: { enabled: false },
        layout: fixedLayout({ width: 270, pin: 'start' }),
      },
      {
        id: 'sid',
        field: 'sid',
        title: 'FRED id',
        cell: {
          render: 'link',
          props: { href: `${FRED_SERIES_URL}{{value}}`, target: '_blank' },
        },
        filter: { enabled: false },
        layout: fixedLayout({ width: 130 }),
      },
      { id: 'category', field: 'category', title: 'Category', filter: { enabled: false }, layout: fixedLayout({ width: 150 }) },
      /*
       * The unit sits immediately before the two columns that are measured in
       * it, because "24,269.61" and "+498.64" are not numbers anyone can read
       * without knowing what they count. The heading of each of those two says
       * so as well, on a second line.
       */
      {
        id: 'units',
        field: 'units',
        title: 'Units',
        header: { render: twoLineHeading('Units', 'what the next two columns count') },
        /*
         * The full text on the cell, for a unit longer than the column is wide.
         * On the cell rather than the heading because a heading tooltip is the
         * one place it could not go: `header.tooltip` is declared but nothing
         * reads it, so it would have been a line of code that did nothing.
         */
        cell: { tooltip: (p) => String(p.value == null ? '' : p.value) },
        filter: { enabled: false },
        layout: fixedLayout({ width: 200 }),
      },
      {
        id: 'latestValue',
        field: 'latestValue',
        title: "Latest value, in the series' units",
        header: { render: twoLineHeading('Latest value', "in the series' units") },
        type: 'number',
        filter: { enabled: false },
        format: { type: 'number', decimals: 2 },
        layout: fixedLayout({ width: 150 }),
      },
      {
        id: 'change',
        field: 'change',
        title: "Change on the period before, in the series' units",
        header: { render: twoLineHeading('Change on the period before', "in the series' units") },
        type: 'number',
        filter: { enabled: false },
        format: { type: 'number', decimals: 2, signed: true },
        layout: fixedLayout({ width: 190 }),
      },
      /*
       * Two columns for the year-on-year movement, not one, because one column
       * could not say which unit a cell is in. A rate series fills the points
       * column and leaves the per-cent one empty; a level or an index does the
       * opposite. Each carries a bar scaled to its own column's real range, so
       * neither bar is ever a percentage of a percentage.
       */
      {
        id: 'yoyPoints',
        field: 'yoyPoints',
        title: 'On a year earlier, points',
        header: { render: twoLineHeading('On a year earlier', 'percentage points, for a rate') },
        type: 'number',
        filter: { enabled: false },
        format: { type: 'number', decimals: 2, suffix: ' pp', signed: true },
        cell: { decoration: { type: 'bar', min: -bars.points, max: bars.points, origin: 0 } },
        layout: fixedLayout({ width: 200 }),
      },
      {
        id: 'yoyPercent',
        field: 'yoyPercent',
        title: 'On a year earlier, %',
        header: { render: twoLineHeading('On a year earlier', 'per cent, for a level or an index') },
        type: 'number',
        filter: { enabled: false },
        format: { type: 'number', decimals: 1, suffix: '%', signed: true },
        cell: { decoration: { type: 'bar', min: -bars.percent, max: bars.percent, origin: 0 } },
        layout: fixedLayout({ width: 210 }),
      },
      { id: 'frequency', field: 'frequency', title: 'Frequency', filter: { enabled: false }, layout: fixedLayout({ width: 110 }) },
      { id: 'seasonal', field: 'seasonal', title: 'Seasonal adjustment', filter: { enabled: false }, layout: fixedLayout({ width: 220 }) },
      {
        id: 'latestDate',
        field: 'latestDate',
        title: 'Latest reading',
        type: 'date',
        format: { type: 'date', pattern: 'MMM yyyy' },
        filter: { enabled: false },
        layout: fixedLayout({ width: 130 }),
      },
      { id: 'source', field: 'source', title: 'Published by', filter: { enabled: false }, layout: fixedLayout({ width: 280 }) },
      {
        id: 'readings',
        field: 'readings',
        title: 'Readings held',
        type: 'number',
        filter: { enabled: false },
        format: { type: 'number', decimals: 0 },
        layout: fixedLayout({ width: 130, hidden: true }),
      },
    ];
  }

  /**
   * The observations grid's columns: a date, then one per catalogue series.
   *
   * Every series has a column from the start and all but the selected ones are
   * hidden, because the columns are what the router's rollup writes and that
   * roll-up is declared once. Choosing a different set of series changes which
   * columns are shown, not what the grid is.
   *
   * @param {object[]} catalogue the catalogue rows
   * @returns {object[]} the column definitions
   */
  function observationColumns(catalogue) {
    const columns = [
      {
        id: 'd',
        field: 'd',
        title: 'Month',
        type: 'date',
        format: { type: 'date', pattern: 'MMM yyyy' },
        filter: { enabled: false },
        /* A month is a month: it needs 120px and never more, so the width it
           does not need belongs to the series columns beside it. */
        layout: fixedLayout({ width: 120, pin: 'start', resizable: false }),
      },
    ];
    for (const row of catalogue) {
      columns.push({
        id: row.sid,
        field: row.sid,
        /*
         * The heading is the series' name. "A191RL1Q225SBEA" is FRED's filing
         * reference and tells a reader nothing; it goes on a second line
         * underneath, small, where it is there for anyone who wants to look the
         * series up and invisible to anyone who does not.
         */
        title: row.title,
        header: {
          /* The unit first, because "4.10" against "24,269.61" is the question
             a reader actually has; FRED's reference follows it. */
          render: twoLineHeading(row.title, `${row.units} \u00b7 ${row.sid}`),
        },
        type: 'number',
        filter: { enabled: false },
        format: { type: 'number', decimals: 2 },
        cell: {
          tooltip: `${row.officialTitle || row.title}. FRED id ${row.sid}. Measured in `
            + `${row.units.toLowerCase()}, published ${row.frequency.toLowerCase()}.`,
        },
        /*
         * The series columns share whatever the month column leaves, down to a
         * floor of 140px, which is what a two-line heading needs to be read
         * rather than ellipsised. Past six or so ticked series the floor wins
         * and the table scrolls sideways, which is the right answer: a heading
         * cut to "Real gross ..." tells a reader nothing.
         *
         * Declared rather than fitted. `columns.fit()` shares the spare width
         * in proportion to the widths the columns already have, which handed
         * almost all of it to whichever column started widest; `flex` is the
         * declarative form and does not need re-issuing every time a box is
         * ticked.
         */
        layout: fixedLayout({ width: 150, min: 140, flex: 1, hidden: true }),
      });
    }
    return columns;
  }

  /**
   * A two-line column heading: a name, and a smaller line under it.
   *
   * `header.render` is handed the label element and may return a node for the
   * grid to attach, which is what makes two lines possible without a heading
   * twice as wide as the numbers under it.
   *
   * @param {string} main the heading proper
   * @param {string} sub the second line
   * @returns {() => HTMLElement} the renderer
   */
  function twoLineHeading(main, sub) {
    return () => {
      const wrap = document.createElement('span');
      wrap.className = 'col-head';
      wrap.append(el('span', 'col-head-main', main));
      wrap.append(el('span', 'col-head-sub', sub));
      return wrap;
    };
  }

  /**
   * A column's layout, with the two things every column on this page agrees on.
   *
   * Nothing here is drag-reorderable. The columns are a designed order carrying
   * a designed meaning, and a heading that offers to be dragged "to reorder, or
   * onto the group bar" is offering something this page has no use for, on
   * every hover, in front of the heading itself.
   *
   * @param {object} [extra] the column's own layout
   * @returns {object} the layout to declare
   */
  function fixedLayout(extra) {
    return Object.assign({ movable: false }, extra || {});
  }

  /**
   * The shared grid settings.
   *
   * No right-hand tool rail, no column menu and no filter funnel: the heading
   * keeps the sort arrow and nothing else, because the rest is furniture a
   * reader did not ask for that trades places with the heading on hover.
   * Filtering and sorting are still there through the API and the keyboard.
   *
   * @param {string} title the grid's title
   * @param {object} [extra] the rest of the configuration
   * @returns {object} the configuration
   */
  function baseGridConfig(title, extra) {
    return Object.assign(
      {
        rowKey: 'id',
        theme: 'light',
        density: 'compact',
        stripedRows: true,
        columnMenu: false,
        statusBar: true,
        find: true,
        title,
      },
      extra || {},
    );
  }

  /* ------------------------------------------------------------------ */
  /* The dashboard                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Build the whole page into `host`.
   *
   * @param {object} options everything the page needs, all handed in
   * @param {HTMLElement} options.root where the dashboard is drawn
   * @param {Function} options.createGrid the grid factory
   * @param {Function} options.createStat the statistic-tile factory
   * @param {Function} options.createChart the charts module's factory
   * @param {Function} options.createKPI the KPI module's factory
   * @param {Function} options.createTabs the tabs module's factory
   * @param {Function} options.createDataRouter the data router's factory
   * @param {object} options.snapshot the saved copy, as read from disk
   * @returns {object} the pieces that were built, for a caller that wants them
   */
  function buildDashboard(options) {
    const {
      root: host, createGrid, createStat, createChart, createKPI, createTabs, createDataRouter, snapshot,
    } = options;
    const meta = snapshot.meta;

    host.textContent = '';

    const data = prepare(snapshot);
    const built = {
      data,
      meta,
      catalogueGrid: null,
      chartGrid: null,
      observationsGrid: null,
      kpi: null,
      chart: null,
      router: null,
      tabs: null,
      vintages: null,
      mode: 'level',
      unit: null,
      indexBase: '2019-12',
      routedCounts: { obs: 0 },
    };

    /* ---------------- the masthead ---------------- */

    const header = el('header', 'head');
    const heading = el('div', 'head-text');
    heading.append(el('h1', null, 'The US economy, as it was published'));
    heading.append(
      el(
        'p',
        'lede',
        `${meta.counts.series} headline series from FRED: output, prices, jobs, rates, housing, trade and ` +
          'the federal balance sheet, with the numbers as they were first announced set beside the numbers ' +
          'as they stand today. Built with Lattice Grid loaded by script tag: no install, no build step.',
      ),
    );
    header.append(heading);

    const provenance = el('div', 'head-note');
    const modePill = el('span', 'pill', 'Saved copy');
    provenance.append(modePill);
    const freshness = el('span', 'freshness', '');
    provenance.append(freshness);
    const backToToday = el('button', 'action', 'Back to today');
    backToToday.type = 'button';
    backToToday.hidden = true;
    backToToday.addEventListener('click', () => built.rewind && built.rewind.goTo(rewindDates.length - 1));
    provenance.append(backToToday);
    header.append(provenance);
    host.append(header);

    const takenOn = `FRED does not allow browser requests, so this page shows a saved copy refreshed `
      + `nightly. Taken ${new Date(meta.builtAt).toLocaleString('en-GB')}.`;

    /** Say whether the page is showing today or a day in the past. */
    function sayWhen(date, atEnd) {
      if (atEnd) {
        modePill.textContent = 'Saved copy';
        modePill.classList.remove('rewound');
        freshness.textContent = takenOn;
        backToToday.hidden = true;
        return;
      }
      modePill.textContent = 'Rewound';
      modePill.classList.add('rewound');
      freshness.textContent = `Showing the dashboard as it stood on ${longDate(date)} \u00b7 rewound. `
        + 'Every figure is the figure that had been published by then.';
      backToToday.hidden = false;
    }

    /* ---------------- the grids ---------------- */

    const cataloguePane = el('div', 'grid-pane');
    const catalogueGrid = createGrid(cataloguePane, baseGridConfig('Series in this dashboard', {
      columns: catalogueColumns(barRanges(data.catalogue)),
      /*
       * The checkbox is the only thing that selects. Clicking a cell used to
       * draw a focus ring, start a cell range and offer a fill handle to drag,
       * which is a spreadsheet's vocabulary offered on a table nobody is
       * editing: it looks like something is about to happen, and nothing is.
       */
      selection: {
        mode: 'multiple',
        checkbox: true,
        headerCheckbox: true,
        checkboxOnly: true,
        ranges: false,
        fillHandle: false,
      },
    }));
    built.catalogueGrid = catalogueGrid;

    /* The chart's own grid: one row per reading of a selected series, carrying
       every transformation as a column of its own, so switching between them
       is a change of which column the chart plots rather than a reload. */
    const chartGrid = createGrid(el('div', 'grid-pane'), baseGridConfig('Readings', {
      selection: 'none',
      columns: [
        { id: 's', field: 's', title: 'Series' },
        { id: 'd', field: 'd', title: 'Date', type: 'date' },
        { id: 'v', field: 'v', title: 'Level', type: 'number' },
        { id: 'pp', field: 'pp', title: 'Change on the period before', type: 'number' },
        { id: 'yp', field: 'yp', title: 'Change on a year earlier', type: 'number' },
        { id: 'idx', field: 'idx', title: 'Index', type: 'number' },
        { id: 'change', field: 'change', title: 'Change', type: 'number' },
      ],
      statusBar: false,
      find: false,
    }));
    built.chartGrid = chartGrid;

    /* The tiles' own grid. It holds the same slice the chart's does, but the
       chart narrows itself to one unit at a time and the tiles never should:
       two viewers of one partition, which is what `overlap` is for. */
    const tileGrid = createGrid(el('div', 'grid-pane hidden-grid'), baseGridConfig('Readings, for the tiles', {
      selection: 'none',
      columns: [
        { id: 's', field: 's', title: 'Series' },
        { id: 'd', field: 'd', title: 'Date', type: 'date' },
        { id: 'v', field: 'v', title: 'Level', type: 'number' },
        { id: 'yoy', field: 'yoy', title: 'On a year earlier, %', type: 'number' },
        { id: 'yoyChange', field: 'yoyChange', title: 'On a year earlier, points', type: 'number' },
        { id: 'rate', field: 'rate', title: 'Rate series' },
      ],
      statusBar: false,
      find: false,
    }));
    built.tileGrid = tileGrid;

    const observationsPane = el('div', 'grid-pane');
    const observationsGrid = createGrid(observationsPane, baseGridConfig('Every selected series, month by month', {
      rowKey: 'd',
      selection: 'none',
      columns: observationColumns(data.catalogue),
    }));
    built.observationsGrid = observationsGrid;

    /*
     * The order is asked for after the grids exist, not inside their
     * configuration. `sort` is not a configuration key: given one, the grid
     * says so in a `[lattice]` diagnostic and leaves the table in whatever
     * order the rows arrived in, which for the catalogue was the order the
     * snapshot happened to be written in.
     */
    catalogueGrid.sort.set([{ col: 'category', dir: 'asc' }, { col: 'title', dir: 'asc' }]);
    observationsGrid.sort.set([{ col: 'd', dir: 'desc' }]);

    /* ---------------- the router ---------------- */

    /*
     * The index transformation needs a base reading per series, which changes
     * when the reader picks a different base month. It is applied in the route's
     * own transform, so the chart's grid carries an `idx` column beside the
     * others and the chart never computes anything itself.
     */
    let indexBase = new Map();

    /** Recompute the base reading of every series for the chosen month. */
    function setIndexBase(month) {
      built.indexBase = month;
      indexBase = new Map();
      for (const row of data.catalogue) {
        /* The reading on or before the first of the chosen month: a quarterly
           series has no reading in two months out of three. */
        let best = null;
        for (const reading of data.readings) {
          if (reading.s !== row.sid) continue;
          if (reading.d > `${month}-31`) break;
          best = reading;
        }
        if (best && best.v !== 0) indexBase.set(row.sid, best.v);
      }
    }
    setIndexBase(built.indexBase);

    /** One reading, with its index value added. */
    const withIndex = (row) => {
      const base = indexBase.get(row.s);
      return { ...row, idx: base === undefined ? null : (row.v / base) * 100 };
    };

    /*
     * The stream, in publication order.
     *
     * Every reading the snapshot holds, stamped with the day FRED published
     * that value; a revision is simply a later delta for the same key. The
     * catalogue's own four computed numbers ride the same stream, because they
     * are read off the readings and would otherwise go on reporting today while
     * everything around them went back.
     */
    const rewindStart = (meta.realtime && meta.realtime.start) || meta.vintageStart;
    const stream = root.FredDemo.realtimeStream(data, snapshot.realtime, rewindStart);
    const catalogueDeltas = root.FredDemo.catalogueStream(data, stream.base, stream.deltas);
    const floor = root.FredDemo.catalogueAtFloor(data, stream.base);
    const rewindDates = root.FredDemo.rewindDates(rewindStart, data.lastDate);
    built.stream = {
      base: stream.base.length,
      deltas: stream.deltas.length,
      revisions: stream.revisions,
      catalogueDeltas: catalogueDeltas.length,
      days: stream.days.length,
      dates: rewindDates.length,
    };

    const router = createDataRouter({
      key: 'kind',
      rowKey: 'id',
      /* The day a value was published: the axis the whole page rewinds along. */
      time: 'pub',
      /* Three routes and a subscriber all want the same partition: without
         this, only the first of them would ever receive a row. */
      overlap: true,
      selectionDebounce: 0,
    });
    built.router = router;

    router.attach(catalogueGrid, 'series', { label: 'catalogue' });
    router.attach(chartGrid, 'obs', { label: 'chart', transform: withIndex });
    router.attach(tileGrid, 'obs', { label: 'tiles' });
    /*
     * The readings table is a pivot, and a pivot is not a slice: one row a date
     * with a column per series is a different shape from the rows the stream
     * carries. `subscribe` is the router's route for a viewer it cannot shape
     * itself -- the handler gets the same keyed diff a grid does, holds the
     * slice, and turns it into the shape the table wants.
     */
    const readingLine = el('p', 'chart-note');
    const routedReadings = new Map();
    let readingsPending = null;
    router.subscribe('obs', (change) => {
      for (const row of change.add || []) routedReadings.set(String(row.id), row);
      for (const row of change.update || []) routedReadings.set(String(row.id), row);
      for (const gone of change.remove || []) {
        routedReadings.delete(String(gone && gone.id !== undefined ? gone.id : gone));
      }
      built.routedCounts.obs = routedReadings.size;
      /* One rebuild a turn: a scrub delivers its whole diff in one call, but a
         selection change and a redraw can arrive together. */
      if (readingsPending) return;
      readingsPending = Promise.resolve().then(() => {
        readingsPending = null;
        rebuildReadings();
        describeSelection();
      });
    });

    /**
     * Turn the routed readings into one row a month, a column per series.
     *
     * @returns {void}
     */
    function rebuildReadings() {
      const chosen = new Set(selectedSeries());
      const byDate = new Map();
      for (const row of routedReadings.values()) {
        if (!chosen.has(row.s)) continue;
        let out = byDate.get(row.d);
        if (!out) { out = { d: row.d }; byDate.set(row.d, out); }
        out[row.s] = row.v;
      }
      const rows = [...byDate.values()].sort((a, b) => (a.d < b.d ? 1 : -1));
      observationsGrid.rows.load(rows);
    }
    built.rebuildReadings = rebuildReadings;

    /* The catalogue's selection filters what the other routes receive. */
    router.link(catalogueGrid, chartGrid, { from: 'sid', to: 's' });
    router.link(catalogueGrid, tileGrid, { from: 'sid', to: 's' });

    /*
     * The buffer has to be asked for before anything is applied, and asked for
     * by size: the router keeps ten thousand deltas by default and this stream
     * is longer than that, so the oldest would be folded into the base and the
     * early part of the timeline would have nothing to rewind to.
     */
    router.buffer({ max: 200000 });

    /*
     * The floor of the window first -- the catalogue and every reading
     * published before the timeline opens -- so the default selection can be
     * made before the rest arrives and every route is narrow from its first
     * paint. Then the whole stream in ONE apply: the router records each delta
     * in the buffer separately but settles the routes once, which is the
     * difference between a page that builds in under a second and one that
     * materialises a hundred and forty times.
     */
    /* A day before the window opens, so nothing in the base can be scrubbed
       away by a reader who winds the timeline all the way back. */
    const floorTime = root.FredDemo.toTime(rewindStart) - 86400000;
    router.apply([
      ...floor.map((row) => ({ op: 'upsert', row: { ...row, pub: floorTime } })),
      ...stream.base.map((row) => ({ op: 'upsert', row: { ...row, pub: floorTime } })),
    ]);
    catalogueGrid.selection.set(meta.defaultSelection.map((sid) => `S:${sid}`));
    const applyStarted = performance.now();
    router.apply([
      ...stream.deltas.map((row) => ({ op: 'upsert', row })),
      ...catalogueDeltas.map((row) => ({ op: 'upsert', row })),
    ].sort((a, b) => (a.row.pub === b.row.pub ? 0 : a.row.pub < b.row.pub ? -1 : 1)));
    built.stream.applyMs = Math.round(performance.now() - applyStarted);
    built.stream.buffered = router.buffered;

    /* ---------------- rewinding the whole dashboard ---------------- */

    /*
     * One timeline, and everything on the page moves with it. The router holds
     * the stream of every reading stamped with the day it was published, so
     * `scrubTo` rebuilds the world as it stood on a chosen day and pushes it to
     * every route at once: the catalogue, the chart, the tiles and the readings
     * table all go back together, through the keyed diff, without any of them
     * knowing that time is what moved.
     */
    const rewindHost = el('section', 'rewind');
    rewindHost.setAttribute('aria-label', 'Rewind the dashboard');
    const rewindNote = el('p', 'panel-caption');
    host.append(rewindHost);

    /** The day the rewind is parked on, as milliseconds. */
    function rewindTime(at) {
      const date = rewindDates[Math.max(0, Math.min(rewindDates.length - 1, at))];
      return root.FredDemo.toTime(date) + 86399000;
    }

    /**
     * Put the whole page back to one day, and tell it to redraw.
     *
     * @param {number} at the index into the timeline's dates
     * @param {boolean} [force] re-apply even at the end, to re-run the routes'
     *   own transforms after the index base has moved
     * @returns {void}
     */
    function applyRewind(at, force) {
      const atEnd = at >= rewindDates.length - 1;
      built.rewindAt = at;
      built.rewound = !atEnd;
      const started = performance.now();
      if (atEnd) router.live();
      else router.scrubTo(rewindTime(at), { by: 'time' });
      built.lastScrubMs = Math.round(performance.now() - started);
      if (force && atEnd) router.live();
      sayWhen(rewindDates[at], atEnd);
      rebuildTiles();
      rebuildReadings();
      /*
       * The chart is NOT rebuilt here. It is bound to its grid and redraws
       * itself once, on the next frame, with whatever the scrub left there --
       * and its spec has not changed, because a rewind moves the data and not
       * the transformation, the unit or the series. Rebuilding it as well drew
       * the same step twice, one frame apart: the line landed a few pixels low
       * and taller, then corrected. Measured at 1100px over a play-through,
       * every step showed the pair 18 to 20 ms apart with the plot rectangle
       * and the value axis identical in both, which is what "it jumps down
       * then back" was.
       */
      describeSelection();
    }

    const rewind = root.FredDemo.createTimeline({
      host: rewindHost,
      label: 'Show this dashboard as it stood on',
      unit: 'month',
      endLabel: 'Back to today',
      dates: rewindDates,
      onChange: (at) => applyRewind(at),
    });
    built.rewind = rewind;
    built.rewindAt = rewindDates.length - 1;

    /* The pandemic quarter, before it was revised: the reason this exists. */
    const tryChip = el('button', 'action chip', 'Try: 1 May 2020');
    tryChip.type = 'button';
    tryChip.addEventListener('click', () => rewind.goToDate('2020-05-01'));
    const chipRow = el('div', 'actions');
    chipRow.append(tryChip, rewindNote);
    rewindHost.append(chipRow);

    const without = (meta.realtime && meta.realtime.seriesWithoutHistory) || 0;
    rewindNote.textContent = without
      ? `${without} of ${meta.counts.series} series have no vintage history in this copy, so the rewind `
        + 'shows those at today\u2019s values. Readings from before '
        + `${longDate(rewindStart)} are shown at today\u2019s values throughout.`
      : `Every series carries its own revision history. Readings from before ${longDate(rewindStart)} `
        + 'are shown at today\u2019s values throughout.';

    /* ---------------- the tiles ---------------- */

    const kpiHost = el('section', 'kpi-host');
    kpiHost.setAttribute('aria-label', 'The selected series, latest');
    const kpiCaption = el('p', 'panel-caption');
    const kpiStrip = el('div', 'kpi-strip');
    kpiHost.append(kpiStrip, kpiCaption);
    host.append(kpiHost);

    /** The rows of one series, newest last, out of the chart grid's view. */
    function readingsOf(rows, sid) {
      const mine = [];
      for (const row of rows) if (row.s === sid) mine.push(row);
      mine.sort((a, b) => (a.d < b.d ? -1 : 1));
      return mine;
    }

    /**
     * Rebuild the tile panel for the current selection.
     *
     * Two tiles a series: the latest reading, with the reading before it as the
     * baseline so the panel draws the movement, and the change on a year
     * earlier. A series with only one reading in view gets no baseline, so no
     * arrow is drawn for a movement there is nothing to measure.
     *
     * @returns {void}
     */
    function rebuildTiles() {
      if (built.kpi) built.kpi.destroy();
      kpiStrip.textContent = '';
      const chosen = selectedSeries();
      if (!chosen.length) {
        kpiStrip.append(el('p', 'empty-note', 'Choose one or more series in the table below.'));
        built.kpi = null;
        return;
      }
      /*
       * One tile a series, and six at most. Two tiles each turned five series
       * into ten cards and a wall of numbers; the year-on-year figure belongs
       * under the figure it is a movement in, not beside it.
       */
      const shown = chosen.slice(0, MAX_TILES);
      kpiCaption.textContent = chosen.length > MAX_TILES
        ? `Tiles show the first six selected series, in catalogue order. `
          + `${chosen.length - MAX_TILES} more are on the chart and in the table below.`
        : 'Tiles show the first six selected series, in catalogue order.';
      const tiles = [];
      for (const sid of shown) {
        const entry = data.byId.get(sid);
        const mine = readingsOf(tileGrid.rows.data(), sid);
        const latest = mine.length ? mine[mine.length - 1] : null;
        const moved = latest && latest.yoyChange != null;
        /*
         * The movement line under a tile's figure is the panel's own, and it
         * draws the difference AND that difference as a percentage of the
         * baseline together, with no way to ask for one without the other.
         *
         * For a level, a count or an index that is exactly right, so the
         * baseline is the reading a year earlier and the panel writes the line.
         * For a series that is itself a rate a percentage of the rate is not a
         * reading anyone wants (see `isRateSeries`), so no baseline is given and
         * the movement is written into the tile's own second line, in points.
         */
        const points = moved && entry.rate
          ? `\n${latest.yoyChange > 0 ? '+' : ''}${latest.yoyChange.toFixed(2)} pp on a year earlier`
          : '';
        tiles.push({
          id: `${sid}__latest`,
          label: `${entry.title}: ${entry.units.toLowerCase()}${points}`,
          aggregation: 'custom',
          format: { type: 'compact', decimals: 2 },
          compute: (rows) => {
            const list = readingsOf(rows, sid);
            return list.length ? list[list.length - 1].v : null;
          },
          ...(!entry.rate && moved ? { baseline: latest.v - latest.yoyChange } : {}),
        });
      }
      built.kpi = createKPI(kpiStrip, {
        grid: tileGrid,
        rowKey: 'id',
        fields: ['s', 'd', 'v', 'yoy', 'yoyChange', 'rate'],
        columns: Math.min(MAX_TILES, tiles.length),
        ariaLabel: 'The selected series, latest',
        tiles,
      });
    }

    /* ---------------- the chart ---------------- */

    const chartSection = el('section', 'chart-section');
    chartSection.setAttribute('aria-label', 'The selected series over time');

    const toolbar = el('div', 'actions');
    toolbar.append(el('span', 'actions-label', 'Show:'));
    const modeButtons = new Map();
    for (const mode of MODES) {
      const button = el('button', 'action toggle', mode.label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(mode.id === built.mode));
      button.classList.toggle('on', mode.id === built.mode);
      button.addEventListener('click', () => setMode(mode.id));
      toolbar.append(button);
      modeButtons.set(mode.id, button);
    }
    const baseInput = el('input', 'action base-input');
    baseInput.type = 'month';
    baseInput.value = built.indexBase;
    baseInput.setAttribute('aria-label', 'The month the index is 100 at');
    baseInput.addEventListener('change', () => {
      if (!baseInput.value) return;
      setIndexBase(baseInput.value);
      /* The index is derived in the route's own transform, which runs when the
         router next settles a route, so the rewind is re-applied to make it. */
      applyRewind(built.rewindAt, true);
      if (built.mode === 'index') drawChart();
    });
    toolbar.append(baseInput);

    /*
     * Which unit the chart draws. One measure axis means one unit at a time;
     * this is how a reader chooses which. It appears only when the selection
     * actually spans more than one, which depends on the mode: a change chart
     * of a rate and a level spans percentage points and per cent.
     */
    const unitLabel = el('span', 'actions-label', 'Unit:');
    const unitPicker = el('select', 'action');
    unitPicker.setAttribute('aria-label', 'Which unit the chart draws');
    unitPicker.addEventListener('change', () => {
      built.unit = unitPicker.value;
      drawChart();
    });
    toolbar.append(unitLabel, unitPicker);
    chartSection.append(toolbar);

    /**
     * Fill the unit picker from the units the current mode would draw.
     *
     * @param {{group: string, ids: string[]}[]} groups the unit groups
     * @returns {void}
     */
    function rebuildUnitPicker(groups) {
      /* Shown in any mode whose selection spans more than one unit, which now
         includes a change chart mixing a rate with a level. */
      const show = groups.length > 1;
      unitLabel.hidden = !show;
      unitPicker.hidden = !show;
      if (!show) return;
      const wanted = groups.map((g) => `${g.group} (${g.ids.length})`).join('|');
      if (unitPicker.dataset.of !== wanted) {
        unitPicker.textContent = '';
        for (const group of groups) {
          const option = el('option', null, `${group.group} (${group.ids.length})`);
          option.value = group.group;
          unitPicker.append(option);
        }
        unitPicker.dataset.of = wanted;
      }
      unitPicker.value = built.unit;
    }

    const chartBox = el('div', 'chart-box tall');
    chartSection.append(chartBox);
    chartSection.append(readingLine);
    host.append(chartSection);

    /** The series ids selected in the catalogue, in catalogue order. */
    function selectedSeries() {
      const keys = new Set(catalogueGrid.selection.keys());
      return data.catalogue.filter((row) => keys.has(row.id)).map((row) => row.sid);
    }

    /**
     * The recession shading, as the chart's own annotation layer.
     *
     * Each NBER recession is a vertical band between two dates. The band's
     * edges are clipped to the readings on the chart, because a band that
     * starts before the first reading has no place on the axis to start at.
     *
     * @returns {object[]} the annotations
     */
    function recessionBands() {
      const first = data.firstDate;
      const last = data.lastDate;
      const bands = [];
      for (const span of data.recessions) {
        if (span.to < first || span.from > last) continue;
        bands.push({
          kind: 'band',
          orient: 'vertical',
          from: new Date(`${span.from < first ? first : span.from}T00:00:00Z`),
          to: new Date(`${span.to > last ? last : span.to}T00:00:00Z`),
          colour: '#123a6b',
          opacity: 0.08,
          className: 'recession-band',
        });
      }
      if (bands.length) bands[0].label = 'Recession';
      return bands;
    }

    /**
     * The decade marks the time axis is labelled at.
     *
     * Named rather than counted: `axis.x.ticks` takes either a count or the
     * exact values, and for fifty-odd years of monthly readings the values a
     * reader looks for are the decades, not five evenly spaced moments.
     *
     * @returns {number[]} the tick positions, in epoch milliseconds
     */
    function decadeTicks() {
      const from = Number(data.firstDate.slice(0, 4));
      const to = Number(data.lastDate.slice(0, 4));
      const out = [];
      for (let year = Math.ceil(from / 10) * 10; year <= to; year += 10) out.push(Date.UTC(year, 0, 1));
      return out;
    }

    /**
     * What the chart's value axis is measured in for one series, in one mode.
     *
     * A level chart reads the series' own unit. A change chart reads percentage
     * points for a series that is itself a rate and per cent for everything
     * else, which is the rule `isRateSeries` states. An index is an index.
     *
     * @param {string} sid the series id
     * @param {string} mode the transformation in force
     * @returns {string} the unit the axis would carry
     */
    function axisUnitOf(sid, mode) {
      const entry = data.byId.get(sid);
      if (mode === 'index') return 'Index, 100 at the base month';
      if (mode === 'level') return entry.unitGroup;
      return entry.rate ? POINTS : PER_CENT;
    }

    /**
     * Group the selected series by the unit the current mode would draw them in.
     *
     * @param {string[]} chosen the selected series ids
     * @param {string} mode the transformation in force
     * @returns {{group: string, ids: string[]}[]} the groups, largest first
     */
    function unitGroups(chosen, mode) {
      const groups = new Map();
      for (const sid of chosen) {
        const group = axisUnitOf(sid, mode);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(sid);
      }
      return [...groups].map(([group, ids]) => ({ group, ids })).sort((a, b) => b.ids.length - a.ids.length);
    }

    /** What the chart is about to draw, in one sentence. */
    function describeSelection() {
      const chosen = selectedSeries();
      if (!chosen.length) {
        readingLine.textContent = 'Nothing is selected, so there is nothing to draw.';
        return;
      }
      const mode = MODES.find((m) => m.id === built.mode);
      const window = `${longDate(data.firstDate)} to ${longDate(data.lastDate)}`;
      readingLine.textContent =
        `${chosen.length} series selected; ${chartGrid.rows.count().toLocaleString('en-GB')} readings on the chart, ` +
        `drawn as ${mode.label.toLowerCase()}${built.mode === 'index' ? ` ${built.indexBase}` : ''}. ` +
        `${window}. Daily and weekly series are shown at their last reading of each month. ` +
        'Shaded bands are NBER recessions.';
    }

    /**
     * Draw, or redraw, the main chart for the current mode and selection.
     *
     * One measure axis, always, and one unit on it. A level chart of series
     * measured in different units therefore draws one unit at a time, chosen in
     * the toolbar. So does a change chart whose selection mixes rate series
     * with levels, because the first move in percentage points and the second
     * in per cent, and putting both on one axis would be two units pretending
     * to be one.
     *
     * @returns {void}
     */
    function drawChart() {
      if (built.chart) { built.chart.destroy(); built.chart = null; }
      chartBox.textContent = '';
      const chosen = selectedSeries();
      if (!chosen.length) { describeSelection(); return; }

      const mode = MODES.find((m) => m.id === built.mode);
      const groups = unitGroups(chosen, built.mode);

      /* Only the series measured in the chosen unit are drawn, through a named
         row predicate on the chart's own grid. The tiles and the observations
         table are fed by their own routes and keep every series. */
      if (groups.length > 1) {
        if (!groups.some((g) => g.group === built.unit)) built.unit = groups[0].group;
        const wanted = new Set(groups.find((g) => g.group === built.unit).ids);
        chartGrid.filters.where('unit', (row) => wanted.has(row.s));
      } else {
        chartGrid.filters.where('unit', null);
        built.unit = groups.length ? groups[0].group : null;
      }
      rebuildUnitPicker(groups);
      describeSelection();

      const notDrawn = groups.filter((g) => g.group !== built.unit).flatMap((g) => g.ids);

      built.chart = createChart({
        grid: chartGrid,
        container: chartBox,
        type: 'line',
        x: 'd',
        y: mode.field,
        series: 's',
        annotations: recessionBands(),
        legend: { position: 'bottom', isolate: true },
        scheme: 'colourblind',
        tooltip: true,
        title: built.mode === 'index' ? `Index, 100 at ${built.indexBase}` : mode.label,
        axis: {
          x: { title: '', ticks: decadeTicks() },
          y: { title: built.mode === 'index' ? 'Index' : String(built.unit) },
        },
        footnote: `${
          notDrawn.length
            ? `Showing the ${chosen.length - notDrawn.length} of ${chosen.length} selected series measured in `
              + `${String(built.unit).toLowerCase()}. Not drawn here: `
              + `${notDrawn.map((sid) => data.byId.get(sid).title).join(', ')}. A different unit needs a `
              + 'different scale, so pick another unit above.'
            : `All ${String(built.unit).toLowerCase()}.`
        }${
          built.mode === 'pct' || built.mode === 'yoy'
            ? ' A series that is itself a rate moves in percentage points; a level, a count or an index '
              + 'moves in per cent.'
            : built.mode === 'index'
              ? ` Each series is set to 100 at ${built.indexBase}; a series with no reading by then is not drawn.`
              : ''
        }`,
      });
    }

    /** Switch transformation. */
    function setMode(id) {
      built.mode = id;
      for (const [key, button] of modeButtons) {
        const on = key === id;
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('on', on);
      }
      baseInput.hidden = id !== 'index';
      drawChart();
    }
    built.setMode = setMode;

    /* ---------------- the catalogue, and the tabs under it ---------------- */

    const cataloguePanel = el('section', 'panel primary-host');
    const catalogueBar = el('div', 'actions');
    catalogueBar.append(
      el('span', 'actions-label', 'Tick the series you want. Everything above and below follows the selection.'),
    );
    const groupButton = el('button', 'action toggle', 'Group by category');
    groupButton.type = 'button';
    groupButton.setAttribute('aria-pressed', 'false');
    groupButton.addEventListener('click', () => {
      const on = groupButton.getAttribute('aria-pressed') === 'true';
      catalogueGrid.columns.group(on ? [] : ['category']);
      groupButton.setAttribute('aria-pressed', String(!on));
      groupButton.classList.toggle('on', !on);
    });
    catalogueBar.append(groupButton);
    built.groupButton = groupButton;
    cataloguePanel.append(catalogueBar);
    cataloguePanel.append(cataloguePane);
    host.append(cataloguePanel);

    /*
     * The thing a reader would never guess is there. The second tab replays the
     * revisions one series at a time; this is the line that says so, on the tab
     * they land on.
     */
    const tabsHost = el('section', 'tabs-host');
    const callout = el('p', 'callout');
    callout.append(document.createTextNode(
      'Every number here has been revised since it was first announced. The ',
    ));
    const calloutLink = el('button', 'link-button', '\u201cAs first published\u201d tab');
    calloutLink.type = 'button';
    calloutLink.addEventListener('click', () => {
      if (built.tabs) built.tabs.activate('vintages');
      tabsHost.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    callout.append(calloutLink);
    callout.append(document.createTextNode(' replays the revisions.'));
    host.append(callout);
    host.append(tabsHost);

    const vintagePane = el('div', 'vintage-pane');
    const tabs = createTabs(tabsHost, {
      createGrid,
      tabs: [
        {
          id: 'observations',
          label: 'Readings by date',
          /* The body is a grid this page already built and routes rows to, so
             the factory mounts it rather than making a second one. */
          view: (element) => {
            /*
             * A wrapper with a height of its own. The tab module lays its
             * panels out absolutely, which gives a child no height to inherit,
             * so a grid put straight into one grows to the height of all 681 of
             * its rows and the panel scrolls instead of the table. A stated
             * height is what gives the grid a viewport to virtualise into and a
             * scrollbar of its own.
             */
            const pane = el('div', 'observations-tab');
            pane.append(
              el(
                'p',
                'panel-caption',
                'One row a month, newest first, and a column for each series you have ticked. '
                  + 'A quarterly series shows its value in the first month of each quarter, so a blank cell '
                  + 'is a month that series does not publish in, not a missing number.',
              ),
            );
            pane.append(observationsPane);
            element.append(pane);
            observationsGrid.rows.refresh({ force: true });
            return observationsGrid;
          },
          config: {},
        },
        {
          id: 'vintages',
          label: 'As first published',
          view: (element) => {
            element.append(vintagePane);
            if (built.vintages) built.vintages.reveal();
            return built.vintages || {};
          },
          config: {},
        },
      ],
      onTabChange: () => {
        /* A grid mounted while its panel was hidden measured a box of nothing.
           Asking it to lay out again once it is on screen is all it needs. */
        window.requestAnimationFrame(() => {
          observationsGrid.rows.refresh({ force: true });
          if (built.vintages) built.vintages.reveal();
        });
      },
    });
    built.tabs = tabs;

    built.vintages = root.FredDemo.buildVintages({
      root: vintagePane,
      createGrid,
      createStat,
      createChart,
      createDataRouter,
      snapshot,
      data,
    });

    /* ---------------- the footer ---------------- */

    const footer = el('footer', 'foot');
    const credit = el('p', null, meta.citation);
    footer.append(credit);
    footer.append(
      el(
        'p',
        null,
        'FRED does not allow browser requests, so this page shows a saved copy refreshed nightly. ' +
          'Every figure is a figure a US federal agency published; none of it is modelled here.',
      ),
    );
    host.append(footer);

    /* ---------------- keeping it all in step ---------------- */

    catalogueGrid.on('selection:changed', () => {
      rebuildTiles();
      showSelectedColumns();
      rebuildReadings();
      drawChart();
    });

    /** Show a column in the observations grid for each selected series. */
    function showSelectedColumns() {
      const chosen = new Set(selectedSeries());
      const show = [];
      const hide = [];
      for (const row of data.catalogue) (chosen.has(row.sid) ? show : hide).push(row.sid);
      if (hide.length) observationsGrid.columns.hide(hide);
      if (show.length) observationsGrid.columns.show(show);
    }

    rebuildTiles();
    showSelectedColumns();
    rebuildReadings();
    setMode('level');
    sayWhen(rewindDates[rewindDates.length - 1], true);
    built.applyRewind = applyRewind;

    built.selectedSeries = selectedSeries;
    built.drawChart = drawChart;
    built.rebuildTiles = rebuildTiles;
    built.setIndexBase = (month) => {
      baseInput.value = month;
      setIndexBase(month);
      applyRewind(built.rewindAt, true);
      if (built.mode === 'index') drawChart();
    };

    built.destroy = () => {
      rewind.destroy();
      if (built.chart) built.chart.destroy();
      if (built.kpi) built.kpi.destroy();
      if (built.vintages && built.vintages.destroy) built.vintages.destroy();
      tabs.destroy();
      router.destroy();
      catalogueGrid.destroy();
      chartGrid.destroy();
      tileGrid.destroy();
      observationsGrid.destroy();
    };

    return built;
  }

  /**
   * The symmetric range each year-on-year bar is drawn against.
   *
   * Taken from the data rather than guessed, so no bar is ever clipped at a
   * number somebody picked, and the two columns are scaled separately because
   * they are in different units.
   *
   * @param {object[]} catalogue the catalogue rows
   * @returns {{points: number, percent: number}} the two half-ranges
   */
  function barRanges(catalogue) {
    let points = 0;
    let percent = 0;
    for (const row of catalogue) {
      if (row.yoyPoints != null) points = Math.max(points, Math.abs(row.yoyPoints));
      if (row.yoyPercent != null) percent = Math.max(percent, Math.abs(row.yoyPercent));
    }
    return { points: points || 1, percent: percent || 1 };
  }

  root.FredDemo.buildDashboard = buildDashboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
