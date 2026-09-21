/**
 * Load the demo in a real browser and check that it works.
 *
 * It depends on jsDelivr, because that is where the page gets the grid from:
 * this edition has no local copy of the library at all, and a check that loaded
 * one would not be checking the page. It does not depend on FRED, because the
 * page does not either -- everything it draws is the saved copy in
 * `data/snapshot/`, and the figures below are recomputed here, in Node, from
 * those same files rather than read back off the screen.
 *
 * Beyond "it drew something", it asserts the things this demo exists to show:
 *
 *   - the library arrived by classic script tag: there is no `type="module"`
 *     script on the page, every library tag points at the pinned release on
 *     the CDN, and each one left the global it documents;
 *   - the catalogue grid -- the main grid -- paints data rows, and no grid on
 *     the page shows the right-hand tool rail;
 *   - the figures on the tiles agree with the saved data, recomputed here;
 *   - the tiles show their numbers in full rather than ellipsised;
 *   - the chart draws a line per selected series, with recession shading, and
 *     each transformation redraws it;
 *   - ticking a series in the catalogue moves the chart, the tiles and the
 *     observations table -- through the router's link, with no reload;
 *   - the vintages tab draws two lines over each other, the revisions table
 *     paints rows, and rewinding the slider actually changes what is shown;
 *   - nothing says "NaN" anywhere on the page;
 *   - at 400px wide the page does not scroll sideways and the main grid still
 *     paints rows.
 *
 * Exits non-zero when any of that fails, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs [--shots <dir>]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : null;

/** The release every library tag must name, and the globals each file leaves. */
const GRID_VERSION = '1.66.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@${GRID_VERSION}/`;
const LIBRARY_TAGS = [
  { file: 'lattice-grid.min.js', global: 'LatticeGrid', member: 'createGrid' },
  { file: 'modules/charts.min.js', global: 'LatticeGrid', member: 'createChart' },
  { file: 'modules/data-router.min.js', global: 'LatticeGridDataRouter', member: 'createDataRouter' },
  { file: 'modules/kpi.min.js', global: 'LatticeGridKPI', member: 'createKPI' },
  { file: 'modules/tabs.min.js', global: 'LatticeGridTabs', member: 'createTabs' },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

/** The first browser on this machine that actually exists. */
async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error(`No browser found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`);
}

/** This check needs Node's built-in WebSocket, which arrived in Node 22. */
function requireModernNode() {
  if (typeof WebSocket === 'undefined') {
    throw new Error(
      `This check needs Node 22 or newer. You are running ${process.version}, which has no built in WebSocket.`,
    );
  }
}

/** A free TCP port, asked of the operating system. */
function freePort() {
  return new Promise((ok, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

/**
 * The rule, restated here rather than read off the page.
 *
 * `src/fred-data.js` owns `isRateSeries`; this is the same predicate written
 * again in Node, so a check of the page's arithmetic is not the page's own
 * arithmetic handed back.
 *
 * @param {string} units the series' units
 * @returns {boolean} true when a change in it belongs in percentage points
 */
function isRateSeries(units) {
  return /percent/i.test(String(units || ''));
}

/** The ISO date one calendar year before another. */
function yearBefore(date) {
  return `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
}

const failures = [];
const notes = [];

/** Record a check and its outcome. */
function check(ok, description, detail) {
  if (ok) {
    notes.push(`  ok   ${description}${detail ? ` (${detail})` : ''}`);
  } else {
    failures.push(`${description}${detail ? ` (${detail})` : ''}`);
    notes.push(`  FAIL ${description}${detail ? ` (${detail})` : ''}`);
  }
}

let browser;
let browserPid = null;
let profile;
let server;

try {
  requireModernNode();
  const chromePath = await findChrome();
  const started = await startServer(0);
  server = started.server;
  const origin = `http://127.0.0.1:${started.port}`;
  console.log(`Browser: ${chromePath}`);
  console.log(`Serving: ${origin}`);

  profile = await mkdtemp(join(tmpdir(), 'fred-umd-demo-verify-'));
  const port = await freePort();
  browser = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browserPid = browser.pid;
  browser.stderr.on('data', () => {});

  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('the browser never opened its debugging port');

  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  let consoleErrors = [];
  let pageErrors = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else ok(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description || details.text);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: ok, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout, what) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      let value;
      try {
        value = await evaluate(expression);
      } catch {}
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  /** Open the page with a clean error log and wait for it to report in. */
  const open = async (url, label) => {
    consoleErrors = [];
    pageErrors = [];
    console.log(`\n--- ${label} ---\n${url}`);
    await call('Page.navigate', { url });
    await waitFor('!!(window.__fredDemo)', 120000, `${label} to load`);
    const state = await evaluate('({ ready: window.__fredDemo.ready, error: window.__fredDemo.error || null })');
    if (!state.ready) throw new Error(`${label} reported a failure: ${state.error}`);
    await waitFor('window.__fredDemo.catalogueGrid && window.__fredDemo.catalogueGrid.rows.count() > 0', 60000, `${label} catalogue rows`);
  };

  /** Save a screenshot, when a directory was asked for. */
  const shoot = async (name) => {
    if (!shotDir) return;
    await mkdir(shotDir, { recursive: true });
    const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = join(shotDir, `${name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    console.log(`  shot ${file}`);
  };

  /** Complain about anything the page logged. */
  const noErrors = (label) => {
    check(consoleErrors.length === 0, `${label}: no console errors`, consoleErrors.slice(0, 3).join(' | '));
    check(pageErrors.length === 0, `${label}: no page errors`, pageErrors.slice(0, 3).join(' | '));
  };

  /* =================================================================== */
  /* The saved data, recomputed here so the page's figures are checked    */
  /* against something other than the page.                               */
  /* =================================================================== */

  const meta = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'meta.json'), 'utf8'));
  const catalogue = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'series.json'), 'utf8'));
  const observations = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'observations.json'), 'utf8'));
  const vintages = JSON.parse(await readFile(join(root, 'data', 'snapshot', 'vintages.json'), 'utf8'));

  const bySeries = new Map();
  for (const row of observations) {
    if (!bySeries.has(row.s)) bySeries.set(row.s, []);
    bySeries.get(row.s).push(row);
  }
  const valueAt = (id, date) => {
    const list = bySeries.get(id) || [];
    for (const point of list) if (point.d === date) return point.v;
    return null;
  };
  const latestOf = (id) => {
    const list = bySeries.get(id) || [];
    return list.length ? list[list.length - 1] : null;
  };
  /**
   * What the year-on-year tile should read: points for a rate, per cent for a
   * level, computed here from the saved files.
   */
  const yoyOf = (id) => {
    const latest = latestOf(id);
    if (!latest) return null;
    const ago = valueAt(id, yearBefore(latest.d));
    if (ago === null) return null;
    const row = catalogue.find((r) => r.id === id);
    if (isRateSeries(row && row.units)) return latest.v - ago;
    return ago === 0 ? null : ((latest.v - ago) / Math.abs(ago)) * 100;
  };

  const near = (a, b, eps) => a != null && b != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

  /* =================================================================== */
  /* 1. The page.                                                         */
  /* =================================================================== */

  console.log(`  snapshot: built ${meta.builtAt} in ${meta.mode} mode; `
    + `${catalogue.length} series, ${observations.length} readings, ${vintages.length} vintage records`);
  console.log(`  vintage dates per headline series: ${JSON.stringify(meta.counts.vintageDates)}`);

  await open(`${origin}/index.html`, 'the dashboard');

  /* ---- how the library arrived ---- */

  const delivery = await evaluate(`(() => {
    const scripts = [...document.querySelectorAll('script')];
    return {
      moduleScripts: scripts.filter((s) => s.type === 'module').length,
      importmaps: scripts.filter((s) => s.type === 'importmap').length,
      librarySrcs: scripts.map((s) => s.getAttribute('src') || '').filter((src) => /cdn\\.jsdelivr\\.net/.test(src)),
      withIntegrity: scripts.filter((s) => /cdn\\.jsdelivr\\.net/.test(s.src) && s.integrity).length,
      stylesheetSrc: (document.querySelector('link[rel=stylesheet][href*="cdn.jsdelivr.net"]') || {}).href || null,
      stylesheetIntegrity: (document.querySelector('link[rel=stylesheet][href*="cdn.jsdelivr.net"]') || {}).integrity || null,
      members: {
        createGrid: typeof (window.LatticeGrid || {}).createGrid,
        setLicence: typeof (window.LatticeGrid || {}).setLicence,
        createChart: typeof (window.LatticeGrid || {}).createChart,
        createDataRouter: typeof (window.LatticeGridDataRouter || {}).createDataRouter,
        createKPI: typeof (window.LatticeGridKPI || {}).createKPI,
        createTabs: typeof (window.LatticeGridTabs || {}).createTabs,
      },
    };
  })()`);
  console.log(`  library tags: ${delivery.librarySrcs.length} from the CDN, ${delivery.withIntegrity} with an integrity hash; module scripts on the page: ${delivery.moduleScripts}`);
  check(delivery.moduleScripts === 0, 'delivery: no type="module" script on the page', `${delivery.moduleScripts}`);
  check(delivery.importmaps === 0, 'delivery: no import map on the page', `${delivery.importmaps}`);
  check(
    delivery.librarySrcs.length === LIBRARY_TAGS.length,
    `delivery: ${LIBRARY_TAGS.length} library script tags point at the CDN`,
    `${delivery.librarySrcs.length}`,
  );
  for (const tag of LIBRARY_TAGS) {
    const wanted = `${CDN_BASE}${tag.file}`;
    check(delivery.librarySrcs.includes(wanted), `delivery: ${tag.file} is loaded from the pinned ${GRID_VERSION} release`, wanted);
    check(delivery.members[tag.member] === 'function', `delivery: ${tag.file} left ${tag.global}.${tag.member} behind`, delivery.members[tag.member]);
  }
  check(delivery.withIntegrity === LIBRARY_TAGS.length, 'delivery: every library tag carries an integrity hash', `${delivery.withIntegrity} of ${LIBRARY_TAGS.length}`);
  check(
    delivery.stylesheetSrc === `${CDN_BASE}lattice-grid.min.css`,
    `delivery: the stylesheet is loaded from the pinned ${GRID_VERSION} release`,
    delivery.stylesheetSrc,
  );
  check(!!delivery.stylesheetIntegrity, 'delivery: the stylesheet carries an integrity hash');

  /* ---- what was loaded ---- */

  const loaded = await evaluate(`(() => {
    const d = window.__fredDemo;
    return {
      catalogueRows: d.catalogueGrid.rows.count(),
      chartRows: d.chartGrid.rows.count(),
      tileRows: d.tileGrid.rows.count(),
      observationRows: d.observationsGrid.rows.count(),
      selected: d.selectedSeries(),
      watermark: d.catalogueGrid.licence.watermark(),
      licenceState: d.catalogueGrid.licence.state(),
      routes: d.router.metrics().routes.map((r) => ({ label: r.label, rows: r.rows })),
    };
  })()`);
  console.log(`  ${loaded.catalogueRows} catalogue rows, ${loaded.chartRows} readings on the chart route, `
    + `${loaded.tileRows} on the tile route, ${loaded.observationRows} dates in the observations table`);
  console.log(`  routes: ${JSON.stringify(loaded.routes)}`);
  check(loaded.catalogueRows === catalogue.length, 'the catalogue holds every saved series', `${loaded.catalogueRows} of ${catalogue.length}`);
  check(loaded.chartRows > 0, 'the chart route holds readings', `${loaded.chartRows}`);
  check(loaded.tileRows > 0, 'the tile route holds readings', `${loaded.tileRows}`);
  check(loaded.observationRows > 0, 'the observations table holds dates', `${loaded.observationRows}`);
  check(
    loaded.selected.length === meta.defaultSelection.length
      && meta.defaultSelection.every((sid) => loaded.selected.includes(sid)),
    'the default selection is the one the snapshot names',
    `${loaded.selected.join(', ')}; expected ${meta.defaultSelection.join(', ')}`,
  );
  check(loaded.watermark === false, 'no watermark on localhost', `state ${loaded.licenceState}`);
  check(loaded.routes.length >= 4, 'the router is driving four routes off the one stream', `${loaded.routes.length}`);

  /* The recession indicator is shading, never a catalogue row. */
  const hasRecessionRow = catalogue.some((row) => row.id === meta.recessionSeries);
  check(!hasRecessionRow, 'the recession indicator is not a row in the catalogue', meta.recessionSeries);

  /* ---- the main grid, specifically ---- */

  const mainGrid = await evaluate(`(() => {
    const host = document.querySelector('.primary-host');
    const root = host && host.querySelector('.lattice');
    const viewport = root && root.querySelector('.lat-body-viewport');
    if (!root) return { found: false };
    return {
      found: true,
      dataRows: viewport ? viewport.querySelectorAll('.lat-row[data-index]').length : 0,
      bodyCells: viewport ? viewport.querySelectorAll('[role="gridcell"]').length : 0,
      columnHeaders: root.querySelectorAll('[role="columnheader"]').length,
      viewportHeight: viewport ? Math.round(viewport.getBoundingClientRect().height) : 0,
      links: root.querySelectorAll('a.lat-link[href^="https://fred.stlouisfed.org/series/"]').length,
      firstLink: (root.querySelector('a.lat-link') || {}).href || null,
    };
  })()`);
  console.log(`  main grid: ${mainGrid.dataRows} data rows, ${mainGrid.bodyCells} body cells, `
    + `${mainGrid.columnHeaders} column headers, body ${mainGrid.viewportHeight}px tall, ${mainGrid.links} FRED links`);
  check(mainGrid.found, 'the main grid exists');
  check(mainGrid.dataRows > 0, 'the main grid painted at least one data row',
    `${mainGrid.dataRows} data rows in a body ${mainGrid.viewportHeight}px tall`);
  check(mainGrid.bodyCells > 0, 'the main grid painted cells', `${mainGrid.bodyCells}`);
  check(mainGrid.columnHeaders > 0, 'the main grid drew a column header row', `${mainGrid.columnHeaders}`);
  check(mainGrid.links > 0, "each row's FRED id links to that series on fred.stlouisfed.org", mainGrid.firstLink);

  const rails = await evaluate(`document.querySelectorAll('.lat-panel-dock').length`);
  console.log(`  tool rails on the page: ${rails}`);
  check(rails === 0, 'no grid shows the right-hand tool rail', `${rails} rail(s)`);

  /* ---- nothing reads NaN ---- */

  const nan = await evaluate(`(() => {
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if (/\\bNaN\\b/.test(node.nodeValue || '')) bad.push((node.nodeValue || '').trim().slice(0, 60));
    }
    return bad.slice(0, 5);
  })()`);
  check(nan.length === 0, 'nothing on the page reads "NaN"', nan.join(' | '));

  /* ---- the tiles agree with the saved data ---- */

  const tiles = await evaluate(`(() => {
    const d = window.__fredDemo;
    const models = d.kpi.tiles().map((t) => ({ id: t.id, value: t.value, formatted: t.formatted, status: String(t.status) }));
    const painted = [...document.querySelectorAll('.kpi-strip .lat-kpi__value')].map((e) => ({
      text: e.textContent,
      top: Math.round((e.closest('.lat-kpi__tile') || e).getBoundingClientRect().top),
      clipped: e.scrollWidth > e.clientWidth + 1,
      bg: getComputedStyle(e.closest('.lat-kpi__tile') || e).backgroundColor,
      height: Math.round((e.closest('.lat-kpi__tile') || e).getBoundingClientRect().height),
    }));
    return {
      models, painted, tiles: d.kpi.tiles().length,
      caption: (document.querySelector('.kpi-host .panel-caption') || {}).textContent || '',
      rows: new Set(painted.map((p) => p.top)).size,
    };
  })()`);
  console.log(`  ${tiles.tiles} tiles; values: ${tiles.painted.map((p) => p.text).join(', ')}`);
  const expectedTiles = Math.min(6, loaded.selected.length);
  check(tiles.tiles === expectedTiles, 'one tile for each selected series, six at most',
    `${tiles.tiles} for ${loaded.selected.length} selected`);
  for (const sid of loaded.selected.slice(0, 6)) {
    const latest = latestOf(sid);
    const model = tiles.models.find((t) => t.id === `${sid}__latest`);
    check(!!model && near(model.value, latest.v, 1e-9), `the ${sid} tile matches the saved data`,
      `tile ${model && model.value}, expected ${latest.v}`);
  }
  check(tiles.caption.includes('first six selected series'), 'the tiles say what they are showing', tiles.caption);
  const clipped = tiles.painted.filter((p) => p.clipped);
  check(clipped.length === 0, 'no tile figure is cut short by an ellipsis', clipped.map((p) => p.text).join(', '));
  const white = tiles.painted.filter((p) => p.bg === 'rgb(255, 255, 255)').length;
  check(white === tiles.painted.length, 'every tile is drawn on a white card', `${white} of ${tiles.painted.length}`);
  const heights = new Set(tiles.painted.map((p) => p.height));
  check(heights.size === 1, 'every tile is the same height', [...heights].join(', '));

  /* ---- a change in a rate is points, never a percentage of the rate ---- */

  /*
   * Which series carries the rate rule and which carries the level rule is read
   * out of the selection rather than written down, so the same checks hold
   * after a refresh changes what the page opens on.
   */
  const rateSeries = loaded.selected.find((sid) => isRateSeries((catalogue.find((r) => r.id === sid) || {}).units));
  const levelSeries = loaded.selected.find((sid) => !isRateSeries((catalogue.find((r) => r.id === sid) || {}).units));
  check(!!rateSeries && !!levelSeries,
    'the default selection holds a rate and a level, so both halves of the rule are on screen',
    `rate ${rateSeries}, level ${levelSeries}`);

  const rateRule = await evaluate(`(() => {
    const d = window.__fredDemo;
    const tile = (id) => {
      const model = d.kpi.tile(id);
      const fig = [...document.querySelectorAll('.kpi-strip .lat-kpi__tile')]
        .find((e) => (e.querySelector('.lat-kpi__label') || {}).textContent === (model && model.label));
      return {
        label: model && model.label,
        value: model && model.value,
        delta: model ? model.delta : undefined,
        deltaPercent: model ? model.deltaPercent : undefined,
        text: fig ? fig.textContent : null,
      };
    };
    return { rate: tile('${rateSeries}__latest'), level: tile('${levelSeries}__latest') };
  })()`);
  const rateLatest = latestOf(rateSeries);
  const rateAgo = valueAt(rateSeries, yearBefore(rateLatest.d));
  const ratePoints = rateLatest.v - rateAgo;
  console.log(`  ${rateSeries} tile label: ${JSON.stringify(rateRule.rate.label)}; text "${rateRule.rate.text}"`);
  console.log(`  ${levelSeries} tile: delta ${rateRule.level.delta}, deltaPercent ${rateRule.level.deltaPercent}`);
  check(/percentage points|\bpp\b/i.test(rateRule.rate.label || ''),
    `the ${rateSeries} tile states its year-on-year movement in percentage points`, rateRule.rate.label);
  check((rateRule.rate.label || '').includes(`${ratePoints > 0 ? '+' : ''}${ratePoints.toFixed(2)} pp`),
    'and that is the change in points, not a percentage of the rate',
    `label ${JSON.stringify(rateRule.rate.label)}, expected ${ratePoints.toFixed(2)} pp `
      + `(a percentage would be ${(ratePoints / rateAgo) * 100})`);
  check(!/%/.test(rateRule.rate.text || ''), `the ${rateSeries} tile shows no % anywhere`, rateRule.rate.text);
  check(rateRule.rate.delta === null,
    `the ${rateSeries} tile draws no relative movement line, so no percentage of a rate is shown`,
    `delta ${rateRule.rate.delta}`);

  /* And a level series keeps the panel's own movement line, so the rule is a
     rule and not a blanket removal. */
  const levelLatest = latestOf(levelSeries);
  const levelAgo = valueAt(levelSeries, yearBefore(levelLatest.d));
  check(near(rateRule.level.delta, levelLatest.v - levelAgo, 1e-9),
    'a level series keeps its movement line, against the reading a year earlier',
    `delta ${rateRule.level.delta}, expected ${levelLatest.v - levelAgo}`);
  check(near(rateRule.level.deltaPercent * 100, ((levelLatest.v - levelAgo) / levelAgo) * 100, 1e-9),
    'and its percentage is the percentage of a level, which is the right reading',
    `${rateRule.level.deltaPercent * 100}%`);
  check(!/pp\b/.test(rateRule.level.label || ''), 'a level series is not given a points line', rateRule.level.label);

  /* The catalogue's two year-on-year columns: one unit each, never both. */
  const catalogueUnits = await evaluate(`(() => {
    const d = window.__fredDemo;
    const rows = d.catalogueGrid.rows.data();
    const bad = rows.filter((r) => r.yoyPoints != null && r.yoyPercent != null).map((r) => r.sid);
    const rateWithPercent = rows.filter((r) => r.rate && r.yoyPercent != null).map((r) => r.sid);
    const levelWithPoints = rows.filter((r) => !r.rate && r.yoyPoints != null).map((r) => r.sid);
    return {
      columns: d.catalogueGrid.columns.visible().map((c) => c.id),
      bad, rateWithPercent, levelWithPoints,
      chosen: rows.find((r) => r.sid === '${rateSeries}'),
    };
  })()`);
  check(catalogueUnits.bad.length === 0, 'no catalogue row fills both year-on-year columns', catalogueUnits.bad.join(', '));
  check(catalogueUnits.rateWithPercent.length === 0, 'no rate series is given a year-on-year percentage',
    catalogueUnits.rateWithPercent.join(', '));
  check(catalogueUnits.levelWithPoints.length === 0, 'no level series is given a year-on-year in points',
    catalogueUnits.levelWithPoints.join(', '));
  check(near(catalogueUnits.chosen.yoyPoints, ratePoints, 1e-9),
    `the catalogue's ${rateSeries} year-on-year is the change in points`,
    `${catalogueUnits.chosen.yoyPoints}`);

  /* ---- no em dash in anything a reader sees ---- */

  const dashes = await evaluate(`(() => {
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if ((node.nodeValue || '').includes('\u2014')) bad.push((node.nodeValue || '').trim().slice(0, 70));
    }
    return bad.slice(0, 5);
  })()`);
  check(dashes.length === 0, 'no visible text on the page uses an em dash', dashes.join(' | '));

  /* ---- the chart ---- */

  const chartOf = `(() => {
    const c = window.__fredDemo.chart;
    const data = c.data();
    const series = (data && data.series) || [];
    return {
      kind: data && data.kind,
      series: series.map((s) => ({ key: s.key, points: s.points.length, withValue: s.points.filter((p) => p.y != null).length })),
      lines: c.element.querySelectorAll('path.lat-chartview__line').length,
      bands: c.element.querySelectorAll('rect.lat-chartview__annotation-band').length,
      marks: c.element.querySelectorAll('path.lat-chartview__mark, circle.lat-chartview__mark').length,
      empty: !!(data && data.empty),
    };
  })()`;
  const chart = await evaluate(chartOf);
  console.log(`  chart: x scale ${chart.kind}, ${chart.series.length} series, ${chart.lines} lines, ${chart.bands} recession bands`);
  for (const s of chart.series) console.log(`    ${s.key}: ${s.withValue} of ${s.points} points carry a reading`);
  check(chart.kind === 'time', 'the chart draws a time axis rather than a row of labels', String(chart.kind));
  check(chart.series.length > 1, 'the chart drew a series for each selected series in the chosen unit', `${chart.series.length}`);
  check(chart.series.every((s) => s.withValue > 0), 'every chart series carries readings rather than empty axes',
    chart.series.map((s) => `${s.key}:${s.withValue}`).join(', '));
  check(chart.lines >= chart.series.length, 'the chart drew a line per series', `${chart.lines} lines for ${chart.series.length} series`);
  check(chart.bands > 0, 'the chart shades the NBER recessions', `${chart.bands} bands`);
  check(chart.empty === false, 'the chart is not showing its empty state');

  /* One series' points are checked against the saved readings. */
  /* A series the chart actually drew: in level mode only one unit group is on
     the axis, so the first selected series is not always one of them. */
  const firstSeries = chart.series[0].key;
  const plotted = await evaluate(`(() => {
    const s = window.__fredDemo.chart.data().series.find((x) => x.key === ${JSON.stringify(firstSeries)});
    if (!s) return null;
    const last = [...s.points].filter((p) => p.y != null).pop();
    return last ? { y: last.y } : null;
  })()`);
  const expectedLast = latestOf(firstSeries);
  check(plotted && near(plotted.y, expectedLast.v, 1e-9), `the last point drawn for ${firstSeries} is the saved reading`,
    `drawn ${plotted && plotted.y}, expected ${expectedLast.v}`);

  await shoot('01-dashboard');

  /* ---- each transformation redraws it ---- */

  for (const mode of ['pct', 'yoy', 'index', 'level']) {
    await evaluate(`window.__fredDemo.setMode(${JSON.stringify(mode)})`);
    await sleep(500);
    const drawn = await evaluate(chartOf);
    check(drawn.series.length > 0 && drawn.series.every((s) => s.withValue > 0),
      `the "${mode}" transformation draws readings`, drawn.series.map((s) => `${s.key}:${s.withValue}`).join(', '));
    check(drawn.empty === false, `the "${mode}" transformation is not the empty state`);
  }

  /* The change transformations name the unit on the axis, and a selection that
     mixes a rate with a level is two units rather than one squashed together. */
  for (const mode of ['pct', 'yoy']) {
    await evaluate(`window.__fredDemo.setMode(${JSON.stringify(mode)})`);
    await sleep(500);
    const axis = await evaluate(`(() => {
      const d = window.__fredDemo;
      return {
        unit: d.unit,
        series: d.chart.data().series.map((s) => String(s.key)),
        title: [...d.chart.element.querySelectorAll('text.lat-chartview__axis-title')].map((t) => t.textContent),
      };
    })()`);
    console.log(`  "${mode}": unit ${axis.unit}, series ${axis.series.join(', ')}`);
    check(axis.unit === 'Percentage points' || axis.unit === 'Per cent',
      `the "${mode}" chart names the unit it is drawing`, String(axis.unit));
    check(axis.title.some((t) => t === axis.unit), `the "${mode}" chart labels its value axis with that unit`,
      axis.title.join(' | '));
    /* Every series drawn is in that one unit. */
    const kinds = axis.series.map((sid) => {
      const row = catalogue.find((r) => r.id === sid);
      return isRateSeries(row && row.units) ? 'Percentage points' : 'Per cent';
    });
    check(kinds.every((k) => k === axis.unit), `the "${mode}" chart draws only the series in that unit`,
      axis.series.map((sid, i) => `${sid}:${kinds[i]}`).join(', '));
  }

  /* The index really is 100 at the base month, for a series that has one. */
  await evaluate("window.__fredDemo.setMode('index')");
  await sleep(500);
  const indexed = await evaluate(`(() => {
    const d = window.__fredDemo;
    const base = d.indexBase;
    const rows = d.chartGrid.rows.data().filter((r) => r.d.slice(0, 7) === base);
    return rows.map((r) => ({ s: r.s, idx: r.idx }));
  })()`);
  const atBase = indexed.filter((r) => r.idx != null);
  check(atBase.length > 0 && atBase.every((r) => Math.abs(r.idx - 100) < 1e-9),
    'every series reads exactly 100 at the index base month',
    atBase.map((r) => `${r.s}:${r.idx}`).join(', '));
  await evaluate("window.__fredDemo.setMode('level')");
  await sleep(500);

  /* ---- the selection drives everything, through the router's link ---- */

  const before = await evaluate(`(() => {
    const d = window.__fredDemo;
    return {
      tiles: d.kpi.tiles().length,
      chartRows: d.chartGrid.rows.count(),
      tileRows: d.tileGrid.rows.count(),
      observationRows: d.observationsGrid.rows.count(),
      columns: d.observationsGrid.columns.visible().map((c) => c.id),
      chartSeries: d.chart.data().series.length,
    };
  })()`);

  const extra = catalogue.find((row) => !meta.defaultSelection.includes(row.id) && row.unitGroup === 'Percent');
  console.log(`  the extra series ticked below: ${extra.id} (${extra.units})`);
  await evaluate(`(() => {
    const d = window.__fredDemo;
    const keys = d.catalogueGrid.selection.keys();
    d.catalogueGrid.selection.set([...keys, 'S:' + ${JSON.stringify(extra.id)}]);
  })()`);
  await sleep(800);

  const after = await evaluate(`(() => {
    const d = window.__fredDemo;
    return {
      tiles: d.kpi.tiles().length,
      chartRows: d.chartGrid.rows.count(),
      tileRows: d.tileGrid.rows.count(),
      observationRows: d.observationsGrid.rows.count(),
      columns: d.observationsGrid.columns.visible().map((c) => c.id),
      chartSeries: d.chart.data().series.length,
      selected: d.selectedSeries(),
    };
  })()`);
  console.log(`  ticking ${extra.id}: tiles ${before.tiles} -> ${after.tiles}, chart rows ${before.chartRows} -> ${after.chartRows}, `
    + `chart series ${before.chartSeries} -> ${after.chartSeries}, observation columns ${before.columns.length} -> ${after.columns.length}`);
  check(after.tiles === Math.min(6, after.selected.length), 'ticking a series adds its tile, up to the cap of six',
    `${before.tiles} -> ${after.tiles} for ${after.selected.length} selected`);
  check(after.tileRows > before.tileRows, "ticking a series routes its readings to the tiles' grid", `${before.tileRows} -> ${after.tileRows}`);
  check(after.chartRows > before.chartRows, 'ticking a series routes its readings to the chart', `${before.chartRows} -> ${after.chartRows}`);
  check(after.chartSeries === before.chartSeries + 1, 'ticking a series draws one more line', `${before.chartSeries} -> ${after.chartSeries}`);
  check(after.columns.includes(extra.id), 'ticking a series shows its column in the observations table', after.columns.join(', '));
  check(
    near(after.tileRows - before.tileRows, (bySeries.get(extra.id) || []).length, 1e-9),
    'exactly that series’ readings arrived, and no others',
    `${after.tileRows - before.tileRows} vs ${(bySeries.get(extra.id) || []).length}`,
  );

  /* And unticking takes it all away again. */
  await evaluate(`window.__fredDemo.catalogueGrid.selection.set(${JSON.stringify(meta.defaultSelection.map((s) => `S:${s}`))})`);
  await sleep(800);
  const restored = await evaluate(`(() => {
    const d = window.__fredDemo;
    return { tiles: d.kpi.tiles().length, tileRows: d.tileGrid.rows.count(), columns: d.observationsGrid.columns.visible().map((c) => c.id) };
  })()`);
  check(restored.tiles === before.tiles, 'unticking takes the tiles away again', `${restored.tiles}`);
  check(restored.tileRows === before.tileRows, 'unticking takes the readings away again', `${restored.tileRows}`);
  check(!restored.columns.includes(extra.id), 'unticking hides the column again', restored.columns.join(', '));

  /* ---- the observations table says what the saved data says ---- */

  const table = await evaluate(`(() => {
    const d = window.__fredDemo;
    const rows = [];
    d.observationsGrid.rows.forEach((r) => { if (r && r.data) rows.push(r.data); });
    rows.sort((a, b) => (a.d < b.d ? 1 : -1));
    return { count: rows.length, newest: rows[0] || null, columns: d.observationsGrid.columns.visible().map((c) => c.id) };
  })()`);
  const expectedNewest = meta.defaultSelection
    .map((sid) => latestOf(sid).d)
    .reduce((a, b) => (a > b ? a : b));
  console.log(`  observations table: ${table.count} dates, newest ${table.newest && table.newest.d}`);
  check(table.newest && table.newest.d === expectedNewest, 'the newest row in the observations table is the newest saved reading',
    `${table.newest && table.newest.d}, expected ${expectedNewest}`);
  for (const sid of meta.defaultSelection) {
    const latest = latestOf(sid);
    const cell = await evaluate(`window.__fredDemo.observationsGrid.rows.value(${JSON.stringify(latest.d)}, ${JSON.stringify(sid)})`);
    check(near(cell, latest.v, 1e-9), `the observations table holds ${sid}'s newest reading on its own date`,
      `${cell}, expected ${latest.v} on ${latest.d}`);
  }

  /* ---- the readings table scrolls its own rows ---- */

  await evaluate("window.__fredDemo.tabs.activate('observations')");
  await sleep(900);
  const scroll = await evaluate(`(async () => {
    const pane = document.querySelector('.observations-tab .grid-pane');
    const root = pane && pane.querySelector('.lattice');
    const body = root && root.querySelector('.lat-body-viewport');
    const panel = document.querySelector('.tabs-host .lat-tabs__panel:not([hidden])');
    if (!body) return { found: false };
    const before = { top: body.scrollTop, panel: panel ? panel.scrollTop : 0, page: window.scrollY };
    body.scrollTop = 800;
    await new Promise((r) => setTimeout(r, 400));
    const after = { top: body.scrollTop, panel: panel ? panel.scrollTop : 0, page: window.scrollY };
    const firstVisible = body.querySelector('.lat-row[data-index]');
    body.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 300));
    return {
      found: true,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      paneHeight: Math.round(pane.getBoundingClientRect().height),
      panelScrollHeight: panel ? panel.scrollHeight : 0,
      panelClientHeight: panel ? panel.clientHeight : 0,
      before,
      after,
      rowAt800: firstVisible ? firstVisible.getAttribute('data-index') : null,
      caption: (document.querySelector('.observations-tab .panel-caption') || {}).textContent || '',
    };
  })()`);
  console.log(`  readings table: pane ${scroll.paneHeight}px, body ${scroll.clientHeight}px of ${scroll.scrollHeight}px scrollable; `
    + `scrollTop ${scroll.before.top} -> ${scroll.after.top}, first row at that point ${scroll.rowAt800}`);
  console.log(`  its panel: ${scroll.panelClientHeight}px of ${scroll.panelScrollHeight}px`);
  check(scroll.found, 'the readings table is on the readings tab');
  check(scroll.paneHeight > 380 && scroll.paneHeight < 470, 'the readings table has a stated height of its own',
    `${scroll.paneHeight}px`);
  check(scroll.scrollHeight > scroll.clientHeight, 'the readings table has more rows than it can show at once',
    `${scroll.scrollHeight} > ${scroll.clientHeight}`);
  check(scroll.after.top > 0, 'scrolling the readings table moves its own rows',
    `scrollTop ${scroll.before.top} -> ${scroll.after.top}`);
  check(Number(scroll.rowAt800) > 0, 'and the rows underneath are reachable', `first drawn row index ${scroll.rowAt800}`);
  check(scroll.after.panel === scroll.before.panel && scroll.after.page === scroll.before.page,
    'the tab panel and the page itself stay put while it scrolls',
    `panel ${scroll.before.panel} -> ${scroll.after.panel}, page ${scroll.before.page} -> ${scroll.after.page}`);
  check(scroll.panelScrollHeight <= scroll.panelClientHeight + 1,
    'the tab panel is not scrolling the whole table instead',
    `${scroll.panelScrollHeight} vs ${scroll.panelClientHeight}`);
  check(/blank cell/i.test(scroll.caption), 'the readings table says what a blank cell means', scroll.caption);

  /* ---- the headings are the series' names, with FRED's id beneath ---- */

  const headings = await evaluate(`(() => {
    const root = document.querySelector('.observations-tab .grid-pane .lattice');
    const cells = [...root.querySelectorAll('[role="columnheader"]')];
    return cells.map((c) => ({
      title: (c.querySelector('.obs-head-title') || {}).textContent || null,
      id: (c.querySelector('.obs-head-id') || {}).textContent || null,
      text: c.textContent.trim().slice(0, 40),
    }));
  })()`);
  const named = headings.filter((h) => h.title);
  console.log(`  headings: ${headings.map((h) => h.text).join(' | ')}`);
  check(named.length === loaded.selected.length, 'every series column is headed by the series name',
    `${named.length} named of ${headings.length} headings`);
  for (const sid of loaded.selected) {
    const row = catalogue.find((r) => r.id === sid);
    const head = named.find((h) => h.id === sid);
    check(!!head && head.title === row.title, `the ${sid} column is headed "${row.title}" with its FRED id beneath`,
      head ? `${head.title} / ${head.id}` : 'not found');
  }

  /* ---- ticking a checkbox selects a row and nothing else ---- */

  const clicking = await evaluate(`(async () => {
    const root = document.querySelector('.primary-host .lattice');
    const box = root.querySelector('.lat-body-viewport input[type="checkbox"]');
    const before = window.__fredDemo.catalogueGrid.selection.keys().length;
    if (box) box.click();
    await new Promise((r) => setTimeout(r, 500));
    const cell = root.querySelector('.lat-body-viewport [role="gridcell"]:not(:first-child)');
    if (cell) cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 500));
    return {
      before,
      afterBox: window.__fredDemo.catalogueGrid.selection.keys().length,
      ranges: window.__fredDemo.catalogueGrid.selection.ranges().length,
      fillHandles: document.querySelectorAll('.lat-fill-handle').length,
      rangeCells: document.querySelectorAll('.lat-cell--range').length,
    };
  })()`);
  console.log(`  after a checkbox click and a cell click: selection ${clicking.before} -> ${clicking.afterBox}, `
    + `ranges ${clicking.ranges}, fill handles ${clicking.fillHandles}, range cells ${clicking.rangeCells}`);
  check(clicking.afterBox !== clicking.before, 'the checkbox selects the row', `${clicking.before} -> ${clicking.afterBox}`);
  check(clicking.ranges === 0, 'clicking a cell starts no cell range', `${clicking.ranges}`);
  check(clicking.fillHandles === 0, 'there is no fill handle to grab', `${clicking.fillHandles}`);
  check(clicking.rangeCells === 0, 'no cell is drawn as selected', `${clicking.rangeCells}`);

  /* And no heading offers to be dragged, or to open a menu. */
  const headerFurniture = await evaluate(`(() => ({
    menus: document.querySelectorAll('.lat-header-menu').length,
    filters: document.querySelectorAll('.lat-header-filter').length,
    sorts: document.querySelectorAll('.lat-header-sort').length,
    movable: document.querySelectorAll('[data-movable="true"]').length,
    reorderTips: [...document.querySelectorAll('[title]')].filter((e) => /to reorder/i.test(e.getAttribute('title') || '')).length,
  }))()`);
  console.log(`  header furniture: ${JSON.stringify(headerFurniture)}`);
  check(headerFurniture.menus === 0, 'no heading carries a column menu', `${headerFurniture.menus}`);
  check(headerFurniture.filters === 0, 'no heading carries a filter funnel', `${headerFurniture.filters}`);
  check(headerFurniture.reorderTips === 0, 'no heading offers to be dragged to reorder', `${headerFurniture.reorderTips}`);
  check(headerFurniture.movable === 0, 'and none is marked as draggable', `${headerFurniture.movable}`);
  check(headerFurniture.sorts > 0, 'the sort control is still there, which is the one worth keeping',
    `${headerFurniture.sorts}`);

  /* Put the selection back before the rest of the checks read it. */
  await evaluate(`window.__fredDemo.catalogueGrid.selection.set(${JSON.stringify(meta.defaultSelection.map((x) => `S:${x}`))})`);
  await sleep(700);

  noErrors('the dashboard');

  /* =================================================================== */
  /* 2. The vintages tab.                                                 */
  /* =================================================================== */

  await evaluate("window.__fredDemo.tabs.activate('vintages')");
  await sleep(1200);

  const vintageOf = `(() => {
    const v = window.__fredDemo.vintages;
    const data = v.chart.data();
    const series = (data && data.series) || [];
    return {
      kind: data && data.kind,
      series: series.map((s) => ({ key: String(s.key), label: s.label, points: s.points.length, withValue: s.points.filter((p) => p.y != null).length })),
      lines: v.chart.element.querySelectorAll('path.lat-chartview__line').length,
      empty: !!(data && data.empty),
      vintage: v.vintage,
      series_: v.series,
      rows: v.asPublishedGrid.rows.count(),
      revisionRows: v.revisionsGrid.rows.count(),
      painted: document.querySelectorAll('.vintage-pane .lat-row[data-index]').length,
      travelling: !!(v.router && v.router.traveling),
      buffered: v.router ? v.router.buffered : 0,
      stat: v.stat.value(),
      statText: (document.querySelector('.vintage-pane .lat-stat__value') || {}).textContent || null,
    };
  })()`;

  const vintage = await evaluate(vintageOf);
  console.log(`  vintages: ${vintage.series_} as at ${vintage.vintage}; ${vintage.rows} rows, ${vintage.revisionRows} revision rows, `
    + `${vintage.painted} painted, ${vintage.buffered} deltas buffered, travelling: ${vintage.travelling}`);
  for (const s of vintage.series) console.log(`    ${s.label || s.key}: ${s.withValue} of ${s.points} points`);
  check(vintage.kind === 'time', 'the overlay chart draws a time axis', String(vintage.kind));
  check(vintage.series.length === 2, 'the overlay chart draws two series: as published, and as it stands now',
    vintage.series.map((s) => s.label || s.key).join(' | '));
  check(vintage.series.every((s) => s.withValue > 0), 'both overlay series carry readings',
    vintage.series.map((s) => `${s.label || s.key}:${s.withValue}`).join(', '));
  check(vintage.lines >= 2, 'the overlay chart drew two lines', `${vintage.lines}`);
  check(vintage.empty === false, 'the overlay chart is not showing its empty state');
  check(vintage.revisionRows > 0, 'the revisions table holds rows', `${vintage.revisionRows}`);
  check(vintage.painted > 0, 'the revisions table painted rows', `${vintage.painted}`);
  check(vintage.buffered > 0, "the router's time-travel buffer holds the revision history", `${vintage.buffered} deltas`);
  check(vintage.travelling, 'the view opens rewound to a past vintage rather than at today', `at ${vintage.vintage}`);

  /*
   * The opening vintage, recomputed here: the day the series' biggest revision
   * was FIRST published. The page works it out from the same data, so this is
   * the rule checked rather than a date written down in two places -- which
   * matters, because a keyless snapshot and a keyed one share almost no vintage
   * dates and a fixed date would be right in only one of them.
   */
  const biggestRevisionOf = (series) => {
    const mine = vintages.filter((v) => v.series === series);
    if (!mine.length) return null;
    const newest = new Map(mine[mine.length - 1].observations.map((o) => [o.d, o.v]));
    const first = new Map();
    const firstVintage = new Map();
    for (const record of mine) {
      for (const o of record.observations) {
        if (!first.has(o.d)) { first.set(o.d, o.v); firstVintage.set(o.d, record.vintageDate); }
      }
    }
    let best = null;
    for (const [d, latest] of newest) {
      if (!first.has(d)) continue;
      const revision = latest - first.get(d);
      if (!best || Math.abs(revision) > Math.abs(best.revision)) {
        best = { d, revision, first: first.get(d), latest, vintage: firstVintage.get(d) };
      }
    }
    return best;
  };

  const expectedOpening = biggestRevisionOf(vintage.series_);
  console.log(`  biggest revision in ${vintage.series_}: ${expectedOpening.d} first published ${expectedOpening.first} `
    + `on ${expectedOpening.vintage}, now ${expectedOpening.latest} (${expectedOpening.revision.toFixed(2)})`);
  check(vintage.vintage === expectedOpening.vintage,
    "the view opens on the day the series' biggest revision was first published",
    `${vintage.vintage}, expected ${expectedOpening.vintage}`);
  check(!!vintages.find((v) => v.series === vintage.series_ && v.vintageDate === vintage.vintage),
    'the opening vintage is one the snapshot saved', `${vintage.series_} @ ${vintage.vintage}`);

  const shown = await evaluate(`(() => {
    const g = window.__fredDemo.vintages.asPublishedGrid;
    return {
      then: g.rows.value(${JSON.stringify(`${expectedOpening.d}|then`)}, 'v'),
      now: g.rows.value(${JSON.stringify(`${expectedOpening.d}|now`)}, 'v'),
    };
  })()`);
  check(near(shown.then, expectedOpening.first, 1e-9),
    'the reading on screen for that observation is the number that vintage published',
    `${shown.then}, expected ${expectedOpening.first} for ${expectedOpening.d}`);
  check(near(shown.now, expectedOpening.latest, 1e-9),
    'and the line beside it is the number as it stands today',
    `${shown.now}, expected ${expectedOpening.latest}`);
  check(Math.abs(expectedOpening.revision) > 0,
    'that reading has actually been revised since, so the two lines differ',
    `first ${expectedOpening.first}, now ${expectedOpening.latest}`);
  check(vintage.stat != null && near(Math.abs(vintage.stat), Math.abs(expectedOpening.revision), 1e-9),
    'the largest-revision tile reports exactly that revision',
    `tile ${vintage.statText}, expected ${expectedOpening.revision}`);

  /* Every vintage the snapshot holds is reachable on the slider. */
  const slider = await evaluate(`(() => {
    const el = document.querySelector('.vintage-slider');
    return { min: Number(el.min), max: Number(el.max), value: Number(el.value), dates: window.__fredDemo.vintages.dates.length };
  })()`);
  console.log(`  slider: ${slider.dates} vintage dates, position ${slider.value} of ${slider.max}`);
  const savedVintages = vintages.filter((v) => v.series === vintage.series_).length;
  check(slider.dates === savedVintages,
    'the slider offers every vintage the snapshot saved for the series',
    `${slider.dates}, expected ${savedVintages}`);
  check(slider.max === slider.dates - 1 && slider.min === 0,
    'the slider spans exactly those vintages', `${slider.min}..${slider.max} for ${slider.dates}`);

  /* A rate series' revisions are in points and carry no percentage column. */
  const rateRevisions = await evaluate(`(async () => {
    const v = window.__fredDemo.vintages;
    v.loadSeries('UNRATE');
    await new Promise((r) => setTimeout(r, 700));
    const rows = v.revisionsGrid.rows.data();
    const moved = rows.filter((r) => r.revision !== 0);
    return {
      series: v.series,
      rate: v.rate,
      columns: v.revisionsGrid.columns.visible().map((c) => ({ id: c.id, title: c.title })),
      rows: rows.length,
      withPercent: rows.filter((r) => r.revisionPct != null).length,
      example: moved[0] || rows[0] || null,
      painted: document.querySelectorAll('.vintage-pane .lat-row[data-index]').length,
      text: (document.querySelector('.vintage-pane .lat-stat__value') || {}).textContent || null,
    };
  })()`);
  const revisionColumn = rateRevisions.columns.find((c) => c.id === 'revision');
  console.log(`  UNRATE revisions: ${rateRevisions.rows} rows, columns ${rateRevisions.columns.map((c) => c.id).join(', ')}, `
    + `example ${JSON.stringify(rateRevisions.example)}`);
  check(rateRevisions.rate === true, 'the vintages tab knows UNRATE is a rate series', String(rateRevisions.rate));
  check(!rateRevisions.columns.some((c) => c.id === 'revisionPct'),
    "a rate series' revisions table has no revision-percentage column at all",
    rateRevisions.columns.map((c) => c.id).join(', '));
  check(rateRevisions.withPercent === 0, 'and no row carries a revision percentage', `${rateRevisions.withPercent}`);
  check(/percentage points/i.test((revisionColumn && revisionColumn.title) || ''),
    "the revision column says it is in percentage points", revisionColumn && revisionColumn.title);
  check(rateRevisions.painted > 0, 'the revisions table still paints rows for a rate series', `${rateRevisions.painted}`);
  check(/pp/.test(rateRevisions.text || ''), 'the largest-revision tile states its unit for a rate series', rateRevisions.text);

  /* Back to the series the tab opens on, for the screenshot. */
  await evaluate("window.__fredDemo.vintages.loadSeries('A191RL1Q225SBEA')");
  await sleep(700);
  await shoot('02-vintages');

  /* Rewinding changes what is shown, and going back to today restores it. */
  const scrubbed = await evaluate(`(async () => {
    const v = window.__fredDemo.vintages;
    const last = v.dates.length - 1;
    v.scrubToIndex(0);
    await new Promise((r) => setTimeout(r, 400));
    const earliest = { rows: v.asPublishedGrid.rows.count(), vintage: v.vintage, travelling: !!v.router.traveling };
    v.scrubToIndex(last);
    await new Promise((r) => setTimeout(r, 400));
    const today = { rows: v.asPublishedGrid.rows.count(), vintage: v.vintage, travelling: !!v.router.traveling };
    return { earliest, today };
  })()`);
  console.log(`  scrub: ${scrubbed.earliest.vintage} -> ${scrubbed.earliest.rows} rows; `
    + `${scrubbed.today.vintage} -> ${scrubbed.today.rows} rows`);
  check(scrubbed.earliest.rows > 0, 'rewinding to the earliest vintage still shows readings', `${scrubbed.earliest.rows}`);
  check(scrubbed.today.rows > scrubbed.earliest.rows, 'rewinding actually removes the readings published later',
    `${scrubbed.earliest.rows} at ${scrubbed.earliest.vintage} vs ${scrubbed.today.rows} at ${scrubbed.today.vintage}`);
  check(!scrubbed.today.travelling, 'going back to today leaves the router at the head of the stream');

  /* Another series loads, replays and draws. */
  const other = await evaluate(`(async () => {
    const v = window.__fredDemo.vintages;
    const next = v.index.series.find((s) => s !== v.series);
    v.loadSeries(next);
    await new Promise((r) => setTimeout(r, 600));
    return {
      series: v.series,
      rows: v.asPublishedGrid.rows.count(),
      revisionRows: v.revisionsGrid.rows.count(),
      lines: v.chart.element.querySelectorAll('path.lat-chartview__line').length,
      buffered: v.router.buffered,
    };
  })()`);
  console.log(`  switched to ${other.series}: ${other.rows} rows, ${other.revisionRows} revision rows, ${other.lines} lines`);
  check(other.rows > 0 && other.lines >= 2, 'picking another series replays and redraws it',
    `${other.series}: ${other.rows} rows, ${other.lines} lines`);
  check(other.revisionRows > 0, 'the revisions table follows the series', `${other.revisionRows}`);

  const nanAgain = await evaluate(`(() => {
    const bad = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if (/\\bNaN\\b/.test(node.nodeValue || '')) bad.push((node.nodeValue || '').trim().slice(0, 60));
    }
    return bad.slice(0, 5);
  })()`);
  check(nanAgain.length === 0, 'nothing on the vintages tab reads "NaN"', nanAgain.join(' | '));

  noErrors('the vintages tab');

  /* =================================================================== */
  /* 3. On a phone.                                                       */
  /* =================================================================== */

  await call('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: true });
  await open(`${origin}/index.html`, 'the dashboard, 400px wide');

  const narrow = await evaluate(`(() => {
    const de = document.documentElement;
    const host = document.querySelector('.primary-host');
    const root = host && host.querySelector('.lattice');
    const viewport = root && root.querySelector('.lat-body-viewport');
    const widest = [];
    const clipped = (e) => getComputedStyle(e).overflowX !== 'visible';
    const walk = (e) => {
      for (const child of e.children) {
        const box = child.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.right > de.clientWidth + 1) {
          widest.push(String(child.className || child.tagName).slice(0, 40) + ' @' + Math.round(box.right));
        }
        if (!clipped(child)) walk(child);
      }
    };
    walk(document.body);
    return {
      clientWidth: de.clientWidth,
      scrollWidth: de.scrollWidth,
      dataRows: viewport ? viewport.querySelectorAll('.lat-row[data-index]').length : 0,
      tiles: document.querySelectorAll('.kpi-strip .lat-kpi__tile').length,
      chartWidth: Math.round((document.querySelector('.chart-box') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
      sticking: widest.slice(0, 5),
    };
  })()`);
  console.log(`  at 400px: scrollWidth ${narrow.scrollWidth} vs clientWidth ${narrow.clientWidth}, `
    + `${narrow.dataRows} data rows in the main grid, ${narrow.tiles} tiles, chart ${narrow.chartWidth}px wide`);
  if (narrow.sticking.length) console.log(`  sticking out: ${narrow.sticking.join(', ')}`);

  check(narrow.scrollWidth <= narrow.clientWidth, 'at 400px: the page does not scroll sideways',
    `scrollWidth ${narrow.scrollWidth} > clientWidth ${narrow.clientWidth}; ${narrow.sticking.join(', ')}`);
  check(narrow.dataRows > 0, 'at 400px: the main grid still paints data rows', `${narrow.dataRows}`);
  check(narrow.tiles > 0, 'at 400px: the tiles are still drawn', `${narrow.tiles}`);
  await shoot('03-dashboard-400');

  /* The vintages tab, narrow. */
  await evaluate("window.__fredDemo.tabs.activate('vintages')");
  await sleep(1200);
  const narrowVintage = await evaluate(`(() => {
    const de = document.documentElement;
    const v = window.__fredDemo.vintages;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      lines: v.chart.element.querySelectorAll('path.lat-chartview__line').length,
      painted: document.querySelectorAll('.vintage-pane .lat-row[data-index]').length,
      revisionRows: v.revisionsGrid.rows.count(),
    };
  })()`);
  console.log(`  at 400px, vintages: scrollWidth ${narrowVintage.scrollWidth} vs ${narrowVintage.clientWidth}, `
    + `${narrowVintage.lines} lines, ${narrowVintage.painted} painted revision rows`);
  check(narrowVintage.scrollWidth <= narrowVintage.clientWidth, 'at 400px: the vintages tab does not scroll sideways',
    `${narrowVintage.scrollWidth} > ${narrowVintage.clientWidth}`);
  check(narrowVintage.lines >= 2, 'at 400px: the overlay chart still draws two lines', `${narrowVintage.lines}`);
  check(narrowVintage.painted > 0, 'at 400px: the revisions table still paints rows', `${narrowVintage.painted}`);
  await shoot('04-vintages-400');

  noErrors('at 400px');

  socket.close();
} catch (error) {
  failures.push(String((error && error.stack) || error));
} finally {
  if (browserPid) {
    try { process.kill(-browserPid, 'SIGKILL'); } catch {}
    try { process.kill(browserPid, 'SIGKILL'); } catch {}
  }
  if (server) server.close();
  await sleep(400);
  if (profile) await rm(profile, { recursive: true, force: true });
}

console.log('\nChecks:');
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${notes.length} checks passed.`);
process.exit(0);
