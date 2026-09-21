/**
 * Build the saved copy of the FRED data this page draws.
 *
 * FRED sends no cross-origin headers, on either the JSON API or the CSV graph
 * endpoints, so a browser can never read it from a page hosted anywhere else.
 * This script runs in Node, where that rule does not apply, and writes what it
 * reads into `data/snapshot/`. The page loads those files and nothing else.
 *
 * It works two ways, and the files it writes are the same shape either way, so
 * the page cannot tell which one built them.
 *
 *   keyless   No `FRED_API_KEY` in the environment. Values come from the CSV
 *             graph endpoints, which need no key; the titles, units, frequency
 *             and source come from the curated table in `tools/series.mjs`; the
 *             vintages come from ALFRED's CSV endpoint at the fixed list of
 *             dates in that same file.
 *
 *   keyed     `FRED_API_KEY` is set. The same values, plus each series' own
 *             title, units, frequency, seasonal adjustment, last-updated stamp
 *             and notes from `fred/series`; every vintage date FRED holds since
 *             2015 from `fred/series/vintagedates`; and the vintage values from
 *             `fred/series/observations` with a real-time range.
 *
 * Four files come out:
 *
 *   series.json        one row per catalogue series: what it is and where from
 *   observations.json  every reading, long form: { s: series, d: date, v: value }
 *   vintages.json      the five headline series as they stood on each vintage date
 *   meta.json          when it was built, which way, and the source citation
 *
 * Daily and weekly series are reduced to one reading a month -- the last of the
 * month, stamped on the first of it -- so that every series shares one date
 * column. Nothing is averaged or interpolated: each kept reading is a reading
 * FRED published, to the precision FRED published it at.
 *
 * Usage: node tools/build-snapshot.mjs [--out <dir>] [--quiet]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HEADLINE,
  OBSERVATION_START,
  RECESSION,
  SERIES,
  VINTAGE_DATES,
  VINTAGE_START,
  DEFAULT_SELECTION,
} from './series.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(root, 'data', 'snapshot');
const quiet = args.includes('--quiet');

const API_KEY = (process.env.FRED_API_KEY || '').trim();
const MODE = API_KEY ? 'keyed' : 'keyless';

const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
const ALFRED_CSV = 'https://alfred.stlouisfed.org/graph/alfredgraph.csv';
const FRED_API = 'https://api.stlouisfed.org/fred';

const CITATION =
  'Source: FRED®, Federal Reserve Bank of St. Louis; https://fred.stlouisfed.org. ' +
  'Series are U.S. government data (BEA, BLS, Board of Governors, Census, Treasury, EIA).';

/**
 * How many vintages of one series one ALFRED request may carry.
 *
 * Values are asked for one series at a time rather than in batches. FRED will
 * put several ids in one CSV, but only while they share an exact publication
 * frequency: ask for a "weekly, ending Saturday" series and a "weekly, as of
 * Wednesday" one together and the answer is a ZIP archive of one CSV per
 * frequency instead of a CSV, which is not a shape worth handling for the sake
 * of a few saved round trips.
 */
const VINTAGE_BATCH = 8;

/** Say what is happening, unless asked not to. */
function say(...parts) {
  if (!quiet) console.log(...parts);
}

/** Wait, between requests, so a long run is not a burst. */
function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Fetch a URL as text, retrying a few times on a network error or a 5xx.
 *
 * A snapshot build that half-succeeds is worse than one that fails: the page
 * would show a catalogue with holes in it and no way to tell. So a request that
 * cannot be completed throws, and the run stops.
 *
 * @param {string} url the address to read
 * @param {string} what a human name for it, used in the error
 * @returns {Promise<string>} the body
 */
async function getText(url, what) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/csv,application/json,*/*' },
        signal: AbortSignal.timeout(120000),
      });
      if (response.status >= 500) throw new Error(`${what}: FRED answered ${response.status}`);
      if (!response.ok) throw new Error(`${what}: FRED answered ${response.status} ${response.statusText}`);
      const body = await response.text();
      if (!body.trim()) throw new Error(`${what}: FRED answered with an empty body`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await pause(attempt * 1500);
    }
  }
  throw new Error(`${what}: gave up after four attempts. ${lastError && lastError.message}`);
}

/** Fetch a URL as JSON, on the same terms. */
async function getJson(url, what) {
  const body = await getText(url, what);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${what}: FRED's answer was not JSON`);
  }
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Parse one of FRED's CSV answers.
 *
 * The shape is always the same: a date column, then one column per series
 * requested, and an empty field where that series has no reading for that date.
 * FRED also writes `.` for a missing daily reading on a holiday.
 *
 * @param {string} text the CSV body
 * @returns {{columns: string[], rows: Array<Array<string>>}} the header after
 *   the date column, and the rows with the date first
 */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const columns = header.slice(1).map((name) => name.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    rows.push(line.split(','));
  }
  return { columns, rows };
}

/** A CSV field as a number, or null when FRED published no reading. */
function toValue(field) {
  if (field == null) return null;
  const text = field.trim();
  if (!text || text === '.') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** The first day of the month an ISO date falls in. */
function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Reduce a daily or weekly series to one reading a month.
 *
 * The last reading of each calendar month, stamped on the first of that month,
 * which is where FRED stamps a monthly series. Nothing is averaged: the kept
 * number is a number FRED published on a day.
 *
 * @param {{d: string, v: number}[]} points the readings, in date order
 * @returns {{d: string, v: number}[]} one reading a month
 */
function toMonthly(points) {
  const last = new Map();
  for (const point of points) last.set(monthStart(point.d), point.v);
  return [...last.entries()].map(([d, v]) => ({ d, v })).sort((a, b) => (a.d < b.d ? -1 : 1));
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/**
 * Read one series from the keyless CSV graph endpoint.
 *
 * @param {string} id the series to read
 * @returns {Promise<{d: string, v: number}[]>} its readings, oldest first
 */
async function readValues(id) {
  const url = `${FRED_CSV}?id=${id}&cosd=${OBSERVATION_START}`;
  const body = await getText(url, `values for ${id}`);
  if (body.startsWith('PK')) {
    throw new Error(`values for ${id}: FRED answered with a ZIP archive rather than a CSV`);
  }
  const { columns, rows } = parseCsv(body);
  if (columns.length !== 1) {
    throw new Error(`values for ${id}: expected one value column, got ${columns.join(', ') || 'none'}`);
  }
  const out = [];
  for (const row of rows) {
    const date = row[0].trim();
    if (date < OBSERVATION_START) continue;
    const value = toValue(row[1]);
    if (value !== null) out.push({ d: date, v: value });
  }
  return out;
}

/**
 * Read one series' vintages from the keyless ALFRED CSV endpoint.
 *
 * ALFRED pairs `id` and `vintage_date` positionally, so asking for the same id
 * several times with several vintage dates returns one column per vintage --
 * `GDPC1_20200501`, `GDPC1_20200801` and so on -- in a single request.
 *
 * @param {string} id the series
 * @param {string[]} dates the vintage dates to ask for
 * @returns {Promise<Map<string, {d: string, v: number}[]>>} readings per vintage date
 */
async function readVintagesKeyless(id, dates) {
  const url = `${ALFRED_CSV}?id=${dates.map(() => id).join(',')}&vintage_date=${dates.join(',')}`;
  const { columns, rows } = parseCsv(await getText(url, `${id} vintages ${dates[0]}..${dates[dates.length - 1]}`));
  /* The columns come back as `<ID>_<YYYYMMDD>`; map each back to its date. */
  const byColumn = new Map();
  columns.forEach((name, index) => {
    const stamp = name.slice(name.lastIndexOf('_') + 1);
    const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    byColumn.set(index, iso);
  });
  const out = new Map();
  for (const date of dates) out.set(date, []);
  for (const row of rows) {
    const date = row[0].trim();
    if (date < VINTAGE_START) continue;
    for (let i = 0; i < columns.length; i += 1) {
      const vintage = byColumn.get(i);
      if (!out.has(vintage)) continue;
      const value = toValue(row[i + 1]);
      if (value !== null) out.get(vintage).push({ d: date, v: value });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The keyed path                                                      */
/* ------------------------------------------------------------------ */

/** An API address with the key and the JSON flag already on it. */
function api(path, params) {
  const query = new URLSearchParams({ ...params, api_key: API_KEY, file_type: 'json' });
  return `${FRED_API}/${path}?${query}`;
}

/**
 * Read a series' own description from the JSON API.
 *
 * @param {string} id the series
 * @returns {Promise<object>} FRED's own record for it
 */
async function readSeriesRecord(id) {
  const body = await getJson(api('series', { series_id: id }), `description of ${id}`);
  const record = body && body.seriess && body.seriess[0];
  if (!record) throw new Error(`description of ${id}: FRED returned no series record`);
  return record;
}

/**
 * Refuse a series FRED redistributes under someone else's copyright.
 *
 * Only a series in the public domain may be saved into this repository and
 * served from it. In the keyless mode the curated list is already restricted to
 * federal statistics; in the keyed mode FRED's own notes are the check, and a
 * series carrying a copyright line stops the build rather than being quietly
 * dropped -- a silently shorter catalogue is the failure nobody notices.
 *
 * @param {string} id the series
 * @param {string} notes FRED's notes for it
 * @returns {void}
 */
function refuseRestricted(id, notes) {
  const text = String(notes || '');
  if (/copyright/i.test(text) || /reprinted with permission/i.test(text)) {
    throw new Error(
      `${id} carries a copyright or permission line in its FRED notes, so it may not be ` +
        'saved into this repository. Remove it from tools/series.mjs.',
    );
  }
}

/**
 * Every vintage date FRED holds for a series since the vintage window opens.
 *
 * @param {string} id the series
 * @returns {Promise<string[]>} the dates, oldest first
 */
async function readVintageDates(id) {
  const body = await getJson(
    api('series/vintagedates', { series_id: id, realtime_start: VINTAGE_START, limit: '10000' }),
    `vintage dates of ${id}`,
  );
  return Array.isArray(body.vintage_dates) ? body.vintage_dates : [];
}

/**
 * One vintage of a series, from the JSON API's real-time range.
 *
 * `realtime_start` and `realtime_end` both set to the vintage date asks for the
 * series exactly as it stood that day.
 *
 * @param {string} id the series
 * @param {string} vintage the vintage date
 * @returns {Promise<{d: string, v: number}[]>} the readings as they stood
 */
async function readVintageKeyed(id, vintage) {
  const body = await getJson(
    api('series/observations', {
      series_id: id,
      realtime_start: vintage,
      realtime_end: vintage,
      observation_start: VINTAGE_START,
    }),
    `${id} as at ${vintage}`,
  );
  const out = [];
  for (const row of body.observations || []) {
    const value = toValue(row.value);
    if (value !== null) out.push({ d: row.date, v: value });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The build                                                           */
/* ------------------------------------------------------------------ */

/**
 * Read every series' values, monthly-aligned.
 *
 * @returns {Promise<{observations: object[], latest: Map<string, string>}>}
 */
async function buildObservations() {
  const wanted = [...SERIES, RECESSION];
  const observations = [];
  const latest = new Map();
  for (const entry of wanted) {
    const reduce = entry.frequency === 'Daily' || entry.frequency === 'Weekly';
    const read = await readValues(entry.id);
    const points = reduce ? toMonthly(read) : read;
    if (!points.length) throw new Error(`${entry.id}: FRED returned no readings at all`);
    for (const point of points) observations.push({ s: entry.id, d: point.d, v: point.v });
    latest.set(entry.id, points[points.length - 1].d);
    say(`  values: ${entry.id} -- ${read.length} readings${reduce ? `, ${points.length} after reducing to months` : ''}`);
    await pause(250);
  }
  observations.sort((a, b) => (a.d === b.d ? (a.s < b.s ? -1 : 1) : a.d < b.d ? -1 : 1));
  return { observations, latest };
}

/**
 * Read the headline series' vintages, whichever mode is in force.
 *
 * @returns {Promise<{vintages: object[], dates: Map<string, string[]>}>}
 */
async function buildVintages() {
  const vintages = [];
  const dates = new Map();

  for (const id of HEADLINE) {
    let wanted;
    if (MODE === 'keyed') {
      /* Every date FRED actually revised the series, since the window opens. */
      wanted = await readVintageDates(id);
      say(`  ${id}: ${wanted.length} vintage dates from FRED`);
    } else {
      wanted = VINTAGE_DATES.slice();
      say(`  ${id}: ${wanted.length} vintage dates from the fixed list`);
    }
    dates.set(id, wanted);

    const collected = new Map();
    if (MODE === 'keyed') {
      for (const vintage of wanted) {
        collected.set(vintage, await readVintageKeyed(id, vintage));
        await pause(250);
      }
    } else {
      for (let i = 0; i < wanted.length; i += VINTAGE_BATCH) {
        const slice = wanted.slice(i, i + VINTAGE_BATCH);
        const read = await readVintagesKeyless(id, slice);
        for (const [vintage, points] of read) collected.set(vintage, points);
        await pause(400);
      }
    }

    for (const vintage of wanted) {
      const observations = collected.get(vintage) || [];
      if (!observations.length) continue;
      vintages.push({ series: id, vintageDate: vintage, observations });
    }
  }
  return { vintages, dates };
}

/**
 * How many of a series' vintages differ from the one before them.
 *
 * A vintage list is only worth showing if the numbers in it move. This counts
 * the vintages whose readings are not identical to the previous vintage's, and
 * the build prints it, so a list of dates that all say the same thing is
 * visible rather than assumed away.
 *
 * @param {object[]} vintages every vintage record
 * @param {string} id the series
 * @returns {{total: number, distinct: number, firstChange: string|null}} the count
 */
function countDistinctVintages(vintages, id) {
  const mine = vintages.filter((v) => v.series === id);
  let distinct = 0;
  let firstChange = null;
  let previous = null;
  for (const vintage of mine) {
    const signature = vintage.observations.map((o) => `${o.d}=${o.v}`).join('|');
    if (signature !== previous) {
      distinct += 1;
      if (previous !== null && firstChange === null) firstChange = vintage.vintageDate;
    }
    previous = signature;
  }
  return { total: mine.length, distinct, firstChange };
}

/** Write one JSON file and report its size. */
async function write(name, value) {
  const file = join(outDir, name);
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(file, text);
  say(`  wrote ${name}: ${(text.length / 1024).toFixed(0)} KB`);
  return text.length;
}

async function main() {
  say(`Building the FRED snapshot in ${MODE} mode.`);
  await mkdir(outDir, { recursive: true });

  /* ---- what each series is ---- */
  const catalogue = [];
  for (const entry of SERIES) {
    const row = { ...entry };
    if (MODE === 'keyed') {
      const record = await readSeriesRecord(entry.id);
      refuseRestricted(entry.id, record.notes);
      /*
       * FRED's own title is kept, but beside the curated one rather than over
       * it. "Market Yield on U.S. Treasury Securities at 10-Year Constant
       * Maturity, Quoted on an Investment Basis" is the right name for a
       * citation and the wrong one for a tile or a column heading, and a page
       * that reads differently depending on which mode built its data is not
       * one snapshot in two shapes. The official name is on the tooltip.
       */
      row.officialTitle = record.title || null;
      row.units = record.units || row.units;
      row.frequency = record.frequency || row.frequency;
      row.seasonal = record.seasonal_adjustment || row.seasonal;
      row.lastUpdated = record.last_updated || null;
      row.notes = record.notes ? String(record.notes).slice(0, 600) : null;
      say(`  described ${entry.id}`);
      await pause(200);
    } else {
      row.officialTitle = null;
      row.lastUpdated = null;
      row.notes = null;
    }
    catalogue.push(row);
  }

  /* ---- the readings ---- */
  const { observations, latest } = await buildObservations();
  for (const row of catalogue) row.latestDate = latest.get(row.id) || null;

  /* ---- the vintages ---- */
  const { vintages, dates } = await buildVintages();

  const vintageReport = {};
  for (const id of HEADLINE) {
    const counted = countDistinctVintages(vintages, id);
    vintageReport[id] = counted;
    say(`  ${id}: ${counted.total} vintages saved, ${counted.distinct} of them different from the one before`);
    if (counted.distinct < 2) {
      throw new Error(
        `${id}: every saved vintage holds the same numbers, so there is no revision to show. ` +
          'Widen the vintage dates in tools/series.mjs.',
      );
    }
  }

  /* ---- out ---- */
  const meta = {
    builtAt: new Date().toISOString(),
    mode: MODE,
    citation: CITATION,
    observationStart: OBSERVATION_START,
    vintageStart: VINTAGE_START,
    headline: HEADLINE,
    recessionSeries: RECESSION.id,
    defaultSelection: DEFAULT_SELECTION,
    counts: {
      series: catalogue.length,
      observations: observations.length,
      vintages: vintages.length,
      vintageDates: Object.fromEntries([...dates].map(([id, list]) => [id, list.length])),
    },
    vintageReport,
  };

  let bytes = 0;
  bytes += await write('series.json', catalogue);
  bytes += await write('observations.json', observations);
  bytes += await write('vintages.json', vintages);
  bytes += await write('meta.json', meta);

  say(
    `Done: ${catalogue.length} series, ${observations.length} readings, ${vintages.length} vintages, ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB in total.`,
  );
}

main().catch((error) => {
  console.error(`\nThe snapshot could not be built.\n  ${(error && error.message) || error}`);
  process.exit(1);
});
