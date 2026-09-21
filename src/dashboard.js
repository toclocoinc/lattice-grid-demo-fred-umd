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
        filter: { type: 'text', enabled: false },
        layout: fixedLayout({ width: 300, pin: 'start' }),
      },
      {
        id: 'sid',
        field: 'sid',
        title: 'FRED id',
        cell: {
          render: 'link',
          props: { href: `${FRED_SERIES_URL}{{value}}`, target: '_blank' },
        },
        filter: { type: 'text', enabled: false },
        layout: fixedLayout({ width: 150 }),
      },
      { id: 'category', field: 'category', title: 'Category', filter: { type: 'set', enabled: false }, layout: fixedLayout({ width: 170 }) },
      { id: 'units', field: 'units', title: 'Units', filter: { type: 'set', enabled: false }, layout: fixedLayout({ width: 210 }) },
      { id: 'frequency', field: 'frequency', title: 'Frequency', filter: { type: 'set', enabled: false }, layout: fixedLayout({ width: 110 }) },
      { id: 'seasonal', field: 'seasonal', title: 'Seasonal adjustment', filter: { type: 'set', enabled: false }, layout: fixedLayout({ width: 220 }) },
      {
        id: 'latestDate',
        field: 'latestDate',
        title: 'Latest reading',
        type: 'date',
        format: { type: 'date', pattern: 'MMM yyyy' },
        filter: { type: 'date', enabled: false },
        layout: fixedLayout({ width: 130 }),
      },
      {
        id: 'latestValue',
        field: 'latestValue',
        title: 'Latest value',
        type: 'number',
        format: { type: 'number', decimals: 2 },
        layout: fixedLayout({ width: 140 }),
      },
      {
        id: 'change',
        field: 'change',
        title: 'Change on the period before',
        headerTooltip: "In the series' own units. For a series that is itself a rate, that is percentage points.",
        type: 'number',
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
        headerTooltip: 'For a series that is itself a rate: the change in percentage points.',
        type: 'number',
        format: { type: 'number', decimals: 2, suffix: ' pp', signed: true },
        cell: { decoration: { type: 'bar', min: -bars.points, max: bars.points, origin: 0 } },
        layout: fixedLayout({ width: 180 }),
      },
      {
        id: 'yoyPercent',
        field: 'yoyPercent',
        title: 'On a year earlier, %',
        headerTooltip: 'For a level, a count or an index: the change as a percentage.',
        type: 'number',
        format: { type: 'number', decimals: 1, suffix: '%', signed: true },
        cell: { decoration: { type: 'bar', min: -bars.percent, max: bars.percent, origin: 0 } },
        layout: fixedLayout({ width: 170 }),
      },
      { id: 'source', field: 'source', title: 'Published by', filter: { type: 'set', enabled: false }, layout: fixedLayout({ width: 280 }) },
      {
        id: 'readings',
        field: 'readings',
        title: 'Readings held',
        type: 'number',
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
        filter: { type: 'date', enabled: false },
        layout: fixedLayout({ width: 120, pin: 'start' }),
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
          render: () => {
            const wrap = document.createElement('span');
            wrap.className = 'obs-head';
            wrap.append(el('span', 'obs-head-title', row.title));
            wrap.append(el('span', 'obs-head-id', row.sid));
            return wrap;
          },
          tooltip: `${row.title}. FRED id ${row.sid}. Measured in ${row.units.toLowerCase()}, published ${row.frequency.toLowerCase()}.`,
        },
        type: 'number',
        format: { type: 'number', decimals: 2 },
        layout: fixedLayout({ width: 150, hidden: true }),
      });
    }
    return columns;
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
    provenance.append(el('span', 'pill', 'Saved copy'));
    const freshness = el(
      'span',
      'freshness',
      `FRED does not allow browser requests, so this page shows a saved copy refreshed nightly. ` +
        `Taken ${new Date(meta.builtAt).toLocaleString('en-GB')}.`,
    );
    provenance.append(freshness);
    header.append(provenance);
    host.append(header);

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
      sort: [{ col: 'category', dir: 'asc' }, { col: 'title', dir: 'asc' }],
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
      sort: [{ col: 'd', dir: 'desc' }],
    }));
    built.observationsGrid = observationsGrid;

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
     * The observations grid is a rollup route: one summary row per date, and
     * one aggregate per catalogue series that picks that series' reading out of
     * the date's rows. Every series has an aggregate whether or not it is
     * selected, because the link below means an unselected series' rows never
     * reach the route at all -- its aggregate simply sees nothing and answers
     * null, and its column is hidden.
     */
    const aggregates = {};
    for (const row of data.catalogue) {
      const sid = row.sid;
      aggregates[sid] = (rows) => {
        for (const reading of rows) if (reading.s === sid) return reading.v;
        return null;
      };
    }

    const router = createDataRouter({
      key: 'kind',
      rowKey: 'id',
      /* Three routes and a subscriber all want the same partition: without
         this, only the first of them would ever receive a row. */
      overlap: true,
      selectionDebounce: 0,
    });
    built.router = router;

    router.attach(catalogueGrid, 'series', { label: 'catalogue' });
    router.attach(chartGrid, 'obs', { label: 'chart', transform: withIndex });
    router.attach(tileGrid, 'obs', { label: 'tiles' });
    router.attach(observationsGrid, 'obs', {
      label: 'observations',
      rollup: { groupBy: 'd', aggregate: aggregates },
      sort: { key: 'd', dir: 'desc' },
    });

    /* A fourth viewer of the same partition that is not a grid at all: it keeps
       the count under the chart, off the same keyed diff the grids get. */
    const readingLine = el('p', 'chart-note');
    router.subscribe('obs', (change) => {
      built.routedCounts.obs += (change.add ? change.add.length : 0) - (change.remove ? change.remove.length : 0);
      describeSelection();
    });

    /* The catalogue's selection filters what the other routes receive. */
    router.link(catalogueGrid, chartGrid, { from: 'sid', to: 's' });
    router.link(catalogueGrid, tileGrid, { from: 'sid', to: 's' });
    router.link(catalogueGrid, observationsGrid, { from: 'sid', to: 's' });

    /* The catalogue first, so the default selection can be made before the
       24,000 readings arrive and every route is narrow from its first paint. */
    router.load(data.catalogue);
    catalogueGrid.selection.set(meta.defaultSelection.map((sid) => `S:${sid}`));
    router.load(data.stream);

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
      /* Re-running the whole snapshot through the router is a keyed diff, so
         only the numbers that actually changed reach a grid. */
      router.load(data.stream);
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

    const tabsHost = el('section', 'tabs-host');
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
            observationsGrid.columns.fit();
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
          observationsGrid.columns.fit();
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
      /* A handful of columns in a wide panel leaves most of it blank, and the
         set changes every time the reader ticks a box, so the fit is asked for
         again each time rather than once at build. */
      if (observationsGrid.element && observationsGrid.element.isConnected) observationsGrid.columns.fit();
    }

    rebuildTiles();
    showSelectedColumns();
    setMode('level');

    built.selectedSeries = selectedSeries;
    built.drawChart = drawChart;
    built.rebuildTiles = rebuildTiles;
    built.setIndexBase = (month) => {
      baseInput.value = month;
      setIndexBase(month);
      router.load(data.stream);
      if (built.mode === 'index') drawChart();
    };

    built.destroy = () => {
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
