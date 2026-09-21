/**
 * Reading the saved copy, and working out everything derived from it.
 *
 * FRED sends no cross-origin headers, so a browser cannot read it directly from
 * a page served from anywhere else. Everything this page draws therefore comes
 * from the four files in `data/snapshot/`, which a scheduled job rebuilds and
 * commits. This file fetches them and turns them into the two row sets the rest
 * of the page works from:
 *
 *   catalogue   one row per series: what it is, its latest reading, how that
 *               compares with the reading before it and with a year earlier
 *   readings    one row per observation, carrying its level, its change on the
 *               period before, and its change on the same period a year earlier
 *
 * Both are handed to one Data Router as a single stream: a `kind` property says
 * which is which, and the router partitions them. Nothing here touches the DOM
 * or the grid.
 *
 * A classic script: it defines the global `FredDemo` for the files that follow.
 */
(function (root) {
  'use strict';

  const SNAPSHOT = 'data/snapshot';

  /**
   * Read the four snapshot files.
   *
   * @param {(text: string, fraction: number) => void} [onProgress] progress sink
   * @returns {Promise<{series: object[], observations: object[], vintages: object[], meta: object}>}
   */
  async function readSnapshot(onProgress) {
    const names = ['meta', 'series', 'observations', 'vintages'];
    const out = {};
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (onProgress) onProgress(`Reading the saved copy (${name})...`, i / names.length);
      const response = await fetch(`${SNAPSHOT}/${name}.json`, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`The saved copy could not be read: ${SNAPSHOT}/${name}.json answered ${response.status}.`);
      }
      out[name] = await response.json();
    }
    return { meta: out.meta, series: out.series, observations: out.observations, vintages: out.vintages };
  }

  /**
   * Is this series measured as a rate?
   *
   * THE RULE, IN ONE PLACE. A change in a series whose values are themselves a
   * rate -- the unemployment rate, a Treasury yield, a growth rate, debt as a
   * share of GDP -- belongs in PERCENTAGE POINTS, never as a percentage of the
   * rate. "The unemployment rate fell 4.7 per cent" is a sentence about a
   * number, not about the labour market; "it fell 0.20 percentage points" is
   * the fact. An index, a level and a count are not rates, and a percentage
   * change of one of those is exactly the right reading.
   *
   * Everything that computes a change asks this first: the catalogue columns,
   * the tiles, the chart's transformations and the revisions table.
   *
   * @param {string} units the series' units, as FRED states them
   * @returns {boolean} true when a change in it is measured in points
   */
  function isRateSeries(units) {
    return /percent/i.test(String(units || ''));
  }

  /**
   * The ISO date one year before another.
   *
   * Calendar arithmetic rather than a fixed number of days, so a monthly series
   * lands on the same month and a quarterly one on the same quarter.
   *
   * @param {string} date a `YYYY-MM-DD` date
   * @returns {string} the same day, a year earlier
   */
  function yearBefore(date) {
    return `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  }

  /** Milliseconds at UTC midnight on an ISO date. */
  function toTime(date) {
    return Date.parse(`${date}T00:00:00Z`);
  }

  /**
   * Turn the snapshot into the rows the router is fed.
   *
   * Every reading gains its movement, computed here once rather than in a chart
   * binding that would redo them on every redraw:
   *
   *   `change`      the change on the reading before it, in the series' own units
   *   `yoyChange`   the same against the reading a calendar year earlier
   *   `pct` / `yoy` those two as a percentage -- for a LEVEL series only
   *   `pp` / `yp`   what to draw: points for a rate series, per cent otherwise
   *
   * A rate series carries no `pct` or `yoy` at all, because a percentage of a
   * percentage is not a reading anyone wants. See `isRateSeries`.
   *
   * @param {{series: object[], observations: object[], meta: object}} snapshot the saved copy
   * @returns {{catalogue: object[], readings: object[], stream: object[],
   *   recessions: {from: string, to: string}[], byId: Map<string, object>,
   *   valueAt: (series: string, date: string) => number|null}} the prepared rows
   */
  function prepare(snapshot) {
    const { series, observations, meta } = snapshot;
    const known = new Map(series.map((row) => [row.id, row]));

    /* Group the readings by series, in date order. The snapshot is written in
       date order across every series, so one pass is enough. */
    const bySeries = new Map();
    for (const row of observations) {
      let list = bySeries.get(row.s);
      if (!list) { list = []; bySeries.set(row.s, list); }
      list.push(row);
    }

    /* A value lookup per series, for the year-ago comparison and the index. */
    const lookup = new Map();
    for (const [id, list] of bySeries) {
      const map = new Map();
      for (const point of list) map.set(point.d, point.v);
      lookup.set(id, map);
    }

    /** The reading a series held on an exact date, or null. */
    const valueAt = (id, date) => {
      const map = lookup.get(id);
      const value = map ? map.get(date) : undefined;
      return value === undefined ? null : value;
    };

    const readings = [];
    for (const [id, list] of bySeries) {
      if (!known.has(id)) continue;
      const rate = isRateSeries(known.get(id).units);
      for (let i = 0; i < list.length; i += 1) {
        const point = list[i];
        const previous = i > 0 ? list[i - 1] : null;
        const ago = valueAt(id, yearBefore(point.d));
        const change = previous ? point.v - previous.v : null;
        const yoyChange = ago === null ? null : point.v - ago;
        const pct = !rate && previous && previous.v !== 0 ? (change / Math.abs(previous.v)) * 100 : null;
        const yoy = !rate && ago !== null && ago !== 0 ? (yoyChange / Math.abs(ago)) * 100 : null;
        readings.push({
          kind: 'obs',
          id: `${id}@${point.d}`,
          s: id,
          d: point.d,
          t: toTime(point.d),
          v: point.v,
          rate,
          change,
          yoyChange,
          pct,
          yoy,
          /* What the chart plots for the two change transformations: points for
             a rate series, per cent for a level or an index. */
          pp: rate ? change : pct,
          yp: rate ? yoyChange : yoy,
        });
      }
    }

    /* One catalogue row per series, carrying the three headline numbers. */
    const catalogue = [];
    for (const row of series) {
      const list = bySeries.get(row.id) || [];
      const rate = isRateSeries(row.units);
      const latest = list.length ? list[list.length - 1] : null;
      const previous = list.length > 1 ? list[list.length - 2] : null;
      const ago = latest ? valueAt(row.id, yearBefore(latest.d)) : null;
      const change = latest && previous ? latest.v - previous.v : null;
      const yoyChange = latest && ago !== null ? latest.v - ago : null;
      catalogue.push({
        kind: 'series',
        id: `S:${row.id}`,
        sid: row.id,
        title: row.title,
        officialTitle: row.officialTitle || null,
        category: row.category,
        units: row.units,
        unitGroup: row.unitGroup,
        frequency: row.frequency,
        seasonal: row.seasonal,
        source: row.source,
        notes: row.notes || null,
        lastUpdated: row.lastUpdated || null,
        rate,
        latestDate: latest ? latest.d : null,
        latestValue: latest ? latest.v : null,
        /* In the series' own units, always: for a rate series that IS points. */
        change,
        yoyChange,
        /* One column each, so a cell is never ambiguous about its unit: a rate
           series fills the points column and leaves the per-cent one blank. */
        yoyPoints: rate ? yoyChange : null,
        yoyPercent: !rate && yoyChange !== null && ago !== 0 ? (yoyChange / Math.abs(ago)) * 100 : null,
        readings: list.length,
      });
    }

    /* The recession indicator is shading, never a row: read the runs of 1 out
       of it and throw the series itself away. */
    const recessions = [];
    const flags = bySeries.get(meta.recessionSeries) || [];
    let open = null;
    for (let i = 0; i < flags.length; i += 1) {
      const point = flags[i];
      if (point.v === 1 && open === null) open = point.d;
      if (point.v !== 1 && open !== null) {
        recessions.push({ from: open, to: flags[i - 1].d });
        open = null;
      }
    }
    if (open !== null) recessions.push({ from: open, to: flags[flags.length - 1].d });

    return {
      catalogue,
      readings,
      stream: catalogue.concat(readings),
      recessions,
      byId: new Map(catalogue.map((row) => [row.sid, row])),
      valueAt,
      firstDate: readings.length ? readings.reduce((a, b) => (a.d < b.d ? a : b)).d : null,
      lastDate: readings.length ? readings.reduce((a, b) => (a.d > b.d ? a : b)).d : null,
    };
  }

  /**
   * The vintages, indexed for the "as first published" view.
   *
   * @param {object[]} vintages the saved vintage records
   * @returns {{series: string[], datesFor: (id: string) => string[],
   *   pointsFor: (id: string, date: string) => Map<string, number>}} the index
   */
  function indexVintages(vintages) {
    const bySeries = new Map();
    for (const record of vintages) {
      let mine = bySeries.get(record.series);
      if (!mine) { mine = new Map(); bySeries.set(record.series, mine); }
      mine.set(record.vintageDate, new Map(record.observations.map((o) => [o.d, o.v])));
    }
    return {
      series: [...bySeries.keys()],
      datesFor: (id) => [...(bySeries.get(id) || new Map()).keys()].sort(),
      pointsFor: (id, date) => (bySeries.get(id) || new Map()).get(date) || new Map(),
    };
  }

  /**
   * What each observation of a series was revised from and to.
   *
   * The first print is the value in the earliest saved vintage that carried
   * that observation at all -- which for a recent observation is the number the
   * agency announced on the day. The latest is the value in the newest saved
   * vintage. The revision is the difference between them.
   *
   * A revision to a rate series is stated in percentage points and carries no
   * percentage at all, for the reason `isRateSeries` gives.
   *
   * @param {ReturnType<typeof indexVintages>} index the vintage index
   * @param {string} id the series
   * @param {boolean} [rate] true when the series is measured as a rate
   * @returns {{d: string, first: number, firstVintage: string, latest: number,
   *   revision: number, revisionPct: number|null}[]} one row per observation
   */
  function revisionsFor(index, id, rate) {
    const dates = index.datesFor(id);
    if (!dates.length) return [];
    const newest = index.pointsFor(id, dates[dates.length - 1]);

    const first = new Map();
    const firstVintage = new Map();
    for (const vintage of dates) {
      for (const [d, v] of index.pointsFor(id, vintage)) {
        if (!first.has(d)) { first.set(d, v); firstVintage.set(d, vintage); }
      }
    }

    const rows = [];
    for (const [d, latest] of newest) {
      if (!first.has(d)) continue;
      const before = first.get(d);
      rows.push({
        id: `${id}@${d}`,
        d,
        first: before,
        firstVintage: firstVintage.get(d),
        latest,
        revision: latest - before,
        revisionPct: rate || before === 0 ? null : ((latest - before) / Math.abs(before)) * 100,
      });
    }
    rows.sort((a, b) => (a.d < b.d ? 1 : -1));
    return rows;
  }

  root.FredDemo = {
    SNAPSHOT,
    isRateSeries,
    readSnapshot,
    prepare,
    indexVintages,
    revisionsFor,
    toTime,
    yearBefore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
