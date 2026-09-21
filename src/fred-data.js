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
    const names = ['meta', 'series', 'observations', 'vintages', 'realtime'];
    const out = {};
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (onProgress) onProgress(`Reading the saved copy (${name})...`, i / names.length);
      const response = await fetch(`${SNAPSHOT}/${name}.json`, { cache: 'no-cache' });
      if (!response.ok) {
        /* A copy built before the rewind existed has no real-time matrix. The
           dashboard still draws; the rewind says it has nothing to rewind. */
        if (name === 'realtime' && response.status === 404) { out[name] = []; continue; }
        throw new Error(`The saved copy could not be read: ${SNAPSHOT}/${name}.json answered ${response.status}.`);
      }
      out[name] = await response.json();
    }
    return {
      meta: out.meta,
      series: out.series,
      observations: out.observations,
      vintages: out.vintages,
      realtime: out.realtime,
    };
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
   * Turn the real-time matrix into one ordered stream of deltas.
   *
   * Every row of the matrix is a moment: on day `from`, the reading for `d`
   * became `v`. A revision is simply a later row for the same reading. Fed to
   * the router in that order, each stamped with its publication day, the buffer
   * holds the real history of the numbers and `scrubTo` can put the whole
   * dashboard back to any day in it.
   *
   * Readings from before the window are one batch at the floor of it: they were
   * all published before it opened, so at every point on the timeline they are
   * simply there. The page says as much.
   *
   * @param {object} data the prepared catalogue and readings
   * @param {object[]} realtime the saved matrix, one entry a series
   * @param {string} start the first day the matrix covers
   * @returns {{base: object[], deltas: object[], days: string[], revisions: number}}
   *   the rows that predate the window, the stamped deltas, every distinct
   *   publication day, and how many of the deltas are revisions rather than
   *   first prints
   */
  function realtimeStream(data, realtime, start) {
    const byKey = new Map();
    for (const reading of data.readings) byKey.set(reading.id, reading);

    const base = [];
    for (const reading of data.readings) if (reading.d < start) base.push(reading);

    const deltas = [];
    const days = new Set();
    let revisions = 0;
    for (const entry of realtime || []) {
      const seen = new Set();
      for (const [d, v, from] of entry.r || []) {
        const id = `${entry.s}@${d}`;
        const known = byKey.get(id);
        /* A reading the current snapshot no longer carries (a series revised an
           observation away) has nothing on the page to move, so it is skipped
           rather than invented. */
        if (!known) continue;
        if (seen.has(d)) revisions += 1;
        seen.add(d);
        days.add(from);
        deltas.push({ ...known, v, pub: toTime(from), from });
      }
    }
    deltas.sort((a, b) => (a.pub === b.pub ? 0 : a.pub < b.pub ? -1 : 1));
    return { base, deltas, days: [...days].sort(), revisions };
  }

  /**
   * The catalogue, as it stood on every day the numbers behind it moved.
   *
   * The catalogue's "latest value", "change on the period before" and the two
   * year-on-year columns are not stored anywhere: they are read off the
   * readings. So a rewind of the readings has to carry a rewind of the
   * catalogue with it, or the table at the centre of the page would go on
   * reporting today while everything around it went back.
   *
   * One pass over the deltas in publication order, keeping each series' visible
   * readings as they accumulate, emitting a catalogue row whenever one of those
   * four numbers actually moves. A series whose reading was revised by a
   * thousandth still emits; a day on which nothing about it changed does not.
   *
   * @param {object} data the prepared catalogue and readings
   * @param {object[]} base the readings that predate the window
   * @param {object[]} deltas the stamped readings, in publication order
   * @returns {object[]} catalogue rows, each stamped with its publication day
   */
  function catalogueStream(data, base, deltas) {
    /** @type {Map<string, {values: Map<string, number>, dates: string[]}>} */
    const state = new Map();
    for (const row of data.catalogue) state.set(row.sid, { values: new Map(), dates: [] });

    /** Note a reading, keeping the date list sorted and duplicate-free. */
    const note = (sid, d, v) => {
      const st = state.get(sid);
      if (!st) return false;
      if (!st.values.has(d)) {
        /* Dates arrive close to order, so a walk back from the end beats a
           binary search and keeps the array sorted without a re-sort. */
        let at = st.dates.length;
        while (at > 0 && st.dates[at - 1] > d) at -= 1;
        st.dates.splice(at, 0, d);
      }
      st.values.set(d, v);
      return true;
    };

    for (const reading of base) note(reading.s, reading.d, reading.v);

    /** The four numbers the catalogue shows, from what is visible now. */
    const numbers = (sid) => {
      const st = state.get(sid);
      const entry = data.byId.get(sid);
      const n = st.dates.length;
      if (!n) return { latestDate: null, latestValue: null, change: null, yoyPoints: null, yoyPercent: null };
      const latestDate = st.dates[n - 1];
      const latestValue = st.values.get(latestDate);
      const previous = n > 1 ? st.values.get(st.dates[n - 2]) : undefined;
      const ago = st.values.get(yearBefore(latestDate));
      const change = previous === undefined ? null : latestValue - previous;
      const yoyChange = ago === undefined ? null : latestValue - ago;
      return {
        latestDate,
        latestValue,
        change,
        yoyChange,
        yoyPoints: entry.rate ? yoyChange : null,
        yoyPercent: !entry.rate && yoyChange !== null && ago !== 0 ? (yoyChange / Math.abs(ago)) * 100 : null,
        readings: n,
      };
    };

    const out = [];
    const last = new Map();
    let i = 0;
    while (i < deltas.length) {
      const day = deltas[i].from;
      const touched = new Set();
      while (i < deltas.length && deltas[i].from === day) {
        if (note(deltas[i].s, deltas[i].d, deltas[i].v)) touched.add(deltas[i].s);
        i += 1;
      }
      for (const sid of touched) {
        const entry = data.byId.get(sid);
        const figures = numbers(sid);
        const signature = `${figures.latestDate}|${figures.latestValue}|${figures.change}|`
          + `${figures.yoyPoints}|${figures.yoyPercent}`;
        if (last.get(sid) === signature) continue;
        last.set(sid, signature);
        out.push({ ...entry, ...figures, pub: deltas[i - 1].pub, from: day });
      }
    }
    return out;
  }

  /**
   * The catalogue as it stood at the floor of the window, before any delta.
   *
   * The same four numbers as `catalogueStream` computes, over the readings that
   * predate the window alone. This is what the page shows if a reader winds the
   * timeline all the way back.
   *
   * @param {object} data the prepared catalogue and readings
   * @param {object[]} base the readings that predate the window
   * @returns {object[]} one row per series
   */
  function catalogueAtFloor(data, base) {
    const bySeries = new Map();
    for (const reading of base) {
      if (!bySeries.has(reading.s)) bySeries.set(reading.s, []);
      bySeries.get(reading.s).push(reading);
    }
    return data.catalogue.map((entry) => {
      const mine = bySeries.get(entry.sid) || [];
      mine.sort((a, b) => (a.d < b.d ? -1 : 1));
      const n = mine.length;
      const latest = n ? mine[n - 1] : null;
      const previous = n > 1 ? mine[n - 2] : null;
      const agoRow = latest ? mine.find((r) => r.d === yearBefore(latest.d)) : null;
      const yoyChange = latest && agoRow ? latest.v - agoRow.v : null;
      return {
        ...entry,
        latestDate: latest ? latest.d : null,
        latestValue: latest ? latest.v : null,
        change: latest && previous ? latest.v - previous.v : null,
        yoyChange,
        yoyPoints: entry.rate ? yoyChange : null,
        yoyPercent: !entry.rate && yoyChange !== null && agoRow && agoRow.v !== 0
          ? (yoyChange / Math.abs(agoRow.v)) * 100 : null,
        readings: n,
      };
    });
  }

  /**
   * The months a whole-dashboard rewind can stop at.
   *
   * One step a month rather than one a publication day: a dashboard is read a
   * month at a time, and a hundred and forty steps is a timeline a reader can
   * aim at where two thousand is a smear.
   *
   * @param {string} start the first day the matrix covers
   * @param {string} end the last
   * @returns {string[]} the last day of each month in the range, oldest first
   */
  function rewindDates(start, end) {
    const out = [];
    let year = Number(start.slice(0, 4));
    let month = Number(start.slice(5, 7));
    while (true) {
      /* The last moment of the month: everything published in it counts. */
      const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      if (last > end) break;
      out.push(last);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    if (!out.length || out[out.length - 1] < end) out.push(end);
    return out;
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
    realtimeStream,
    catalogueStream,
    catalogueAtFloor,
    rewindDates,
    indexVintages,
    revisionsFor,
    toTime,
    yearBefore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
