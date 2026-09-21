/**
 * "As first published": the same series, as it stood on a day in the past.
 *
 * A published economic statistic is an estimate, and it keeps moving after it
 * is announced. The advance estimate of US GDP for the second quarter of 2020
 * was an annualised fall of 32.9%; it now reads about 28%. Nothing was wrong
 * with either number -- the second one had more of the source data behind it --
 * but a chart drawn today shows only the second, and a decision taken in August
 * 2020 was taken on the first.
 *
 * ALFRED keeps every vintage of every FRED series: the numbers exactly as they
 * stood on a given day. The snapshot saves a fixed list of those vintages for
 * the five headline series, and this view replays them.
 *
 * The replay is the Data Router's own time travel, not a lookup. Each vintage
 * is pushed into the router as a batch of deltas stamped with that vintage's
 * date, and the router records them into its bounded buffer. Moving the slider
 * calls `scrubTo(date, { by: 'time' })`, and the router rebuilds the grid --
 * through the same keyed diff it uses live -- to exactly what had been
 * published by then. `live()` returns to the newest vintage.
 *
 * A classic script: it adds `buildVintages` to the `FredDemo` global.
 */
(function (root) {
  'use strict';

  /** Make an element with a class and optional text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** A date, written out. */
  function longDate(date) {
    if (!date) return '—';
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  }

  /** The vintage the view opens on: the first print of the 2020 collapse. */
  const OPENING_SERIES = 'A191RL1Q225SBEA';
  const OPENING_VINTAGE = '2020-08-01';

  /**
   * The columns of the revisions table.
   *
   * @param {string} units the series' units, for the column titles
   * @returns {object[]} the column definitions
   */
  function revisionColumns(units) {
    return [
      {
        id: 'd',
        field: 'd',
        title: 'Reading for',
        type: 'date',
        format: { type: 'date', pattern: 'MMM yyyy' },
        filter: { type: 'date' },
        layout: { width: 130, pin: 'start' },
      },
      {
        id: 'first',
        field: 'first',
        title: `First published (${units})`,
        type: 'number',
        format: { type: 'number', decimals: 2 },
        layout: { width: 200 },
      },
      {
        id: 'firstVintage',
        field: 'firstVintage',
        title: 'First published on',
        type: 'date',
        format: { type: 'date', pattern: 'd MMM yyyy' },
        layout: { width: 160 },
      },
      {
        id: 'latest',
        field: 'latest',
        title: `As it stands now (${units})`,
        type: 'number',
        format: { type: 'number', decimals: 2 },
        layout: { width: 200 },
      },
      {
        id: 'revision',
        field: 'revision',
        title: 'Revision',
        type: 'number',
        format: { type: 'number', decimals: 2, signed: true },
        layout: { width: 140 },
      },
      {
        id: 'revisionPct',
        field: 'revisionPct',
        title: 'Revision %',
        type: 'number',
        format: { type: 'number', decimals: 1, suffix: '%', signed: true },
        cell: { decoration: { type: 'bar', min: -20, max: 20, origin: 0 } },
        layout: { width: 160 },
      },
    ];
  }

  /**
   * Build the "as first published" view into `host`.
   *
   * @param {object} options everything it needs, handed in
   * @param {HTMLElement} options.root where to draw
   * @param {Function} options.createGrid the grid factory
   * @param {Function} options.createStat the statistic-tile factory
   * @param {Function} options.createChart the charts module's factory
   * @param {Function} options.createDataRouter the data router's factory
   * @param {object} options.snapshot the saved copy
   * @param {object} options.data the prepared catalogue and readings
   * @returns {object} the pieces that were built
   */
  function buildVintages(options) {
    const { root: host, createGrid, createStat, createChart, createDataRouter, snapshot, data } = options;
    const index = root.FredDemo.indexVintages(snapshot.vintages);

    const built = {
      index,
      series: OPENING_SERIES,
      vintage: null,
      router: null,
      asPublishedGrid: null,
      revisionsGrid: null,
      chart: null,
      stat: null,
      dates: [],
    };

    host.textContent = '';

    /* ---------------- the controls ---------------- */

    const bar = el('div', 'actions');
    bar.append(el('span', 'actions-label', 'Series:'));

    const picker = el('select', 'action');
    picker.setAttribute('aria-label', 'Which series to replay');
    for (const sid of index.series) {
      const entry = data.byId.get(sid);
      const option = el('option', null, entry ? entry.title : sid);
      option.value = sid;
      picker.append(option);
    }
    picker.value = OPENING_SERIES;
    bar.append(picker);

    bar.append(el('span', 'actions-label', 'As it stood on:'));
    const slider = el('input', 'vintage-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.step = '1';
    slider.setAttribute('aria-label', 'The date to rewind to');
    bar.append(slider);
    const readout = el('span', 'vintage-readout', '—');
    bar.append(readout);

    const liveButton = el('button', 'action', 'Back to today');
    liveButton.type = 'button';
    bar.append(liveButton);
    host.append(bar);

    const story = el('p', 'chart-note');
    host.append(story);

    /* ---------------- the pieces ---------------- */

    const split = el('div', 'vintage-split');
    const chartBox = el('div', 'chart-box tall');
    const statBox = el('div', 'stat-box');
    const right = el('div', 'vintage-side');
    right.append(statBox);
    split.append(chartBox, right);
    host.append(split);

    const revisionsPane = el('div', 'grid-pane');
    host.append(revisionsPane);

    /*
     * The grid the router drives. Two rows per reading of the chosen series --
     * the number published at the vintage being shown, and the number as it
     * stands today -- so one line chart draws them as two series over one
     * time axis.
     */
    const asPublishedGrid = createGrid(el('div', 'grid-pane hidden-grid'), {
      rowKey: 'id',
      theme: 'light',
      density: 'compact',
      columns: [
        { id: 'd', field: 'd', title: 'Reading for', type: 'date' },
        { id: 'which', field: 'which', title: 'Vintage' },
        { id: 'v', field: 'v', title: 'Value', type: 'number' },
      ],
      sort: [{ col: 'd', dir: 'asc' }],
    });
    built.asPublishedGrid = asPublishedGrid;

    const revisionsGrid = createGrid(revisionsPane, {
      rowKey: 'id',
      theme: 'light',
      density: 'compact',
      stripedRows: true,
      columnMenu: true,
      statusBar: true,
      find: true,
      title: 'Every reading, as first published and as it stands now',
      columns: revisionColumns(''),
      sort: [{ col: 'd', dir: 'desc' }],
    });
    built.revisionsGrid = revisionsGrid;

    /** The two lines the chart draws, named where the reader sees them. */
    const AS_PUBLISHED = 'As published then';
    const AS_IT_STANDS = 'As it stands now';

    /** The largest revision in the table, whichever way it went. */
    function largestRevision(grid) {
      let best = null;
      grid.rows.forEach((row) => {
        if (!row || !row.data || row.data.revision == null) return;
        if (!best || Math.abs(row.data.revision) > Math.abs(best.revision)) best = row.data;
      });
      return best;
    }

    built.stat = createStat({
      grid: revisionsGrid,
      container: statBox,
      title: 'Largest revision',
      value: (grid) => {
        const row = largestRevision(grid);
        return row ? row.revision : null;
      },
      format: (value) => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`),
      footer: (value, grid) => {
        const row = largestRevision(grid);
        if (!row) return 'No readings in view.';
        return (
          `${longDate(row.d)}: first published as ${row.first.toFixed(2)} on ${longDate(row.firstVintage)}, ` +
          `now ${row.latest.toFixed(2)}.`
        );
      },
    });

    /* ---------------- replaying a series ---------------- */

    /**
     * Load one series' vintages into a fresh router, and park it at a vintage.
     *
     * Each vintage is one batch of deltas, stamped with the vintage's own date.
     * A reading whose number has not moved since the vintage before is not
     * re-sent: the router's buffer then holds the actual revision history, one
     * delta per number that changed, which is what makes scrubbing meaningful
     * rather than a replay of identical snapshots.
     *
     * @param {string} sid the series to replay
     * @returns {void}
     */
    function loadSeries(sid) {
      if (built.router) built.router.destroy();
      asPublishedGrid.rows.load([]);

      built.series = sid;
      const entry = data.byId.get(sid);
      const units = entry ? entry.units : '';
      revisionsGrid.set('columns', revisionColumns(units));

      const dates = index.datesFor(sid);
      built.dates = dates;
      const newest = index.pointsFor(sid, dates[dates.length - 1]);

      const router = createDataRouter({ rowKey: 'id', time: 'vt' });
      router.attach(asPublishedGrid, () => true, { label: 'as published' });
      router.buffer({ max: 100000 });
      built.router = router;

      const applied = new Map();
      const seenToday = new Set();
      for (const vintage of dates) {
        const vt = Date.parse(`${vintage}T00:00:00Z`);
        const deltas = [];
        for (const [d, v] of index.pointsFor(sid, vintage)) {
          if (applied.get(d) !== v) {
            applied.set(d, v);
            deltas.push({ op: 'upsert', row: { id: `${d}|then`, d, vt, which: AS_PUBLISHED, v } });
          }
          /* Today's number for the same reading, entered the first time that
             reading appears, so rewinding hides it again with its twin. */
          if (!seenToday.has(d)) {
            seenToday.add(d);
            const now = newest.get(d);
            if (now !== undefined) {
              deltas.push({ op: 'upsert', row: { id: `${d}|now`, d, vt, which: AS_IT_STANDS, v: now } });
            }
          }
        }
        if (deltas.length) router.apply(deltas);
      }

      revisionsGrid.rows.load(root.FredDemo.revisionsFor(index, sid));

      const opening = sid === OPENING_SERIES && dates.includes(OPENING_VINTAGE)
        ? dates.indexOf(OPENING_VINTAGE)
        : dates.length - 1;
      slider.max = String(dates.length - 1);
      slider.value = String(opening);
      scrubTo(opening);
      drawChart();
    }

    /**
     * Rewind the grid to one vintage.
     *
     * @param {number} position the index of the vintage in the slider's list
     * @returns {void}
     */
    function scrubTo(position) {
      const dates = built.dates;
      const vintage = dates[Math.max(0, Math.min(dates.length - 1, position))];
      built.vintage = vintage;
      readout.textContent = longDate(vintage);
      if (position >= dates.length - 1) {
        built.router.live();
      } else {
        built.router.scrubTo(Date.parse(`${vintage}T23:59:59Z`), { by: 'time' });
      }
      tellTheStory();
      if (built.chart) built.chart.draw();
    }

    /** Say, in a sentence, what the two lines on the chart are. */
    function tellTheStory() {
      const entry = data.byId.get(built.series);
      const all = asPublishedGrid.rows.data();
      const rows = all.filter((row) => row.which === AS_PUBLISHED);
      const nowRows = all.filter((row) => row.which === AS_IT_STANDS);
      const last = rows.length ? rows.reduce((a, b) => (a.d > b.d ? a : b)) : null;
      const lastNow = last ? nowRows.find((row) => row.d === last.d) : null;
      const travelling = built.router && built.router.traveling;
      const held = built.router ? built.router.buffered : 0;
      if (!last) {
        story.textContent = 'Nothing had been published by then.';
        return;
      }
      const moved = lastNow ? lastNow.v - last.v : null;
      story.textContent =
        `${entry ? entry.title : built.series}, as it stood on ${longDate(built.vintage)}: ` +
        `${rows.length} readings, the newest of them ${longDate(last.d)} at ${last.v.toFixed(2)} ` +
        `${entry ? entry.units.toLowerCase() : ''}` +
        (moved == null
          ? '.'
          : `, which now reads ${lastNow.v.toFixed(2)} — a revision of ${moved > 0 ? '+' : ''}${moved.toFixed(2)}.`) +
        ` ${travelling ? 'Rewound' : 'At the newest vintage'}; ${held} changes held in the router’s buffer.`;
    }

    /** Draw, or redraw, the overlay chart. */
    function drawChart() {
      if (built.chart) { built.chart.destroy(); built.chart = null; }
      chartBox.textContent = '';
      const entry = data.byId.get(built.series);
      built.chart = createChart({
        grid: asPublishedGrid,
        container: chartBox,
        type: 'line',
        x: 'd',
        y: 'v',
        series: 'which',
        title: entry ? entry.title : built.series,
        subtitle: 'The numbers as they were announced, against the numbers as they stand today',
        axis: { x: { title: '' }, y: { title: entry ? entry.units : '' } },
        legend: { position: 'bottom' },
        scheme: 'colourblind',
        tooltip: true,
        footnote:
          'Both lines cover the readings that existed at the chosen vintage, so the comparison is like for like. ' +
          'A level series re-based at a benchmark revision (real GDP moved from 2012 to 2017 dollars) shifts as a ' +
          'whole: that is a change of units, not a change of view about the economy.',
      });
    }

    /* ---------------- wiring ---------------- */

    slider.addEventListener('input', () => scrubTo(Number(slider.value)));
    picker.addEventListener('change', () => loadSeries(picker.value));
    liveButton.addEventListener('click', () => {
      slider.value = slider.max;
      scrubTo(Number(slider.max));
    });

    loadSeries(OPENING_SERIES);

    built.reveal = () => {
      revisionsGrid.rows.refresh({ force: true });
      asPublishedGrid.rows.refresh({ force: true });
      if (built.chart) built.chart.draw();
    };
    built.scrubToIndex = (position) => {
      slider.value = String(position);
      scrubTo(position);
    };
    built.loadSeries = loadSeries;
    built.destroy = () => {
      if (built.chart) built.chart.destroy();
      if (built.stat) built.stat.destroy();
      if (built.router) built.router.destroy();
      asPublishedGrid.destroy();
      revisionsGrid.destroy();
    };

    return built;
  }

  root.FredDemo.buildVintages = buildVintages;
})(typeof globalThis !== 'undefined' ? globalThis : window);
