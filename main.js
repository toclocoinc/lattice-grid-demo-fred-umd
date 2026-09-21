/**
 * The entry point: read the saved copy, hand it to the dashboard, draw.
 *
 * There is only one source. FRED sends no cross-origin headers on either its
 * JSON API or its CSV graph endpoints, so no page served from anywhere else can
 * read it in a browser -- not this one, and not any other. What this page draws
 * is the copy in `data/snapshot/`, which a scheduled job rebuilds from FRED in
 * Node, where that rule does not apply, and commits.
 *
 * This is the script-tag edition. The grid and its modules arrived as classic
 * `<script src>` tags from jsDelivr, ahead of this file, and left globals
 * behind: `LatticeGrid` (the core, which the charts module extends),
 * `LatticeGridDataRouter`, `LatticeGridKPI` and `LatticeGridTabs`. This file
 * picks the factories off those globals and hands them to the dashboard, which
 * never touches a global itself.
 */
(function (root) {
  'use strict';

  const TITLE = 'The US economy, as it was published';

  const host = document.querySelector('#app');

  /** Draw the waiting state, and return a function that updates its message. */
  function showProgress(first) {
    host.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'loading';
    const title = document.createElement('h1');
    title.textContent = TITLE;
    const message = document.createElement('p');
    message.className = 'loading-message';
    message.textContent = first;
    const bar = document.createElement('div');
    bar.className = 'loading-bar';
    const fill = document.createElement('div');
    fill.className = 'loading-fill';
    bar.append(fill);
    panel.append(title, message, bar);
    host.append(panel);
    return (text, fraction) => {
      message.textContent = text;
      fill.style.width = `${Math.round((fraction || 0) * 100)}%`;
    };
  }

  /** Say what went wrong, in words a reader can act on. */
  function showError(error) {
    host.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'loading';
    const title = document.createElement('h1');
    title.textContent = 'The FRED data could not be loaded';
    const message = document.createElement('p');
    message.className = 'loading-message';
    message.textContent = String((error && error.message) || error);
    panel.append(title, message);
    host.append(panel);
    console.error('[fred demo]', error);
  }

  /**
   * The grid's factories, read off the globals the script tags left behind.
   *
   * Checked by name rather than assumed, so a script tag that did not load, or
   * loaded in the wrong order, is reported as the sentence it is rather than as
   * "undefined is not a function" somewhere inside the dashboard.
   *
   * @returns {object} the factories and `setLicence`
   */
  function libraryFromGlobals() {
    const missing = [];
    const need = (object, name, what) => {
      const value = object && object[name];
      if (typeof value !== 'function') missing.push(what);
      return value;
    };
    const createGrid = need(root.LatticeGrid, 'createGrid', 'lattice-grid.min.js (LatticeGrid.createGrid)');
    const setLicence = need(root.LatticeGrid, 'setLicence', 'lattice-grid.min.js (LatticeGrid.setLicence)');
    const createStat = need(root.LatticeGrid, 'createStat', 'lattice-grid.min.js (LatticeGrid.createStat)');
    /* The charts module extends the core global rather than defining its own,
       so it has to be loaded after the core; this is where that shows. */
    const createChart = need(root.LatticeGrid, 'createChart', 'modules/charts.min.js (LatticeGrid.createChart)');
    const createDataRouter = need(root.LatticeGridDataRouter, 'createDataRouter', 'modules/data-router.min.js (LatticeGridDataRouter.createDataRouter)');
    const createKPI = need(root.LatticeGridKPI, 'createKPI', 'modules/kpi.min.js (LatticeGridKPI.createKPI)');
    const createTabs = need(root.LatticeGridTabs, 'createTabs', 'modules/tabs.min.js (LatticeGridTabs.createTabs)');
    if (missing.length) {
      throw new Error(
        `The grid did not load from the CDN. Missing: ${missing.join('; ')}. ` +
          'Check that the script tags in index.html are reachable and in order, with the core first.',
      );
    }
    return { createGrid, setLicence, createStat, createChart, createDataRouter, createKPI, createTabs };
  }

  async function start() {
    const started = performance.now();
    try {
      const library = libraryFromGlobals();
      const { readSnapshot, buildDashboard } = root.FredDemo;

      /* Applied before anything is drawn, because a grid that already exists
         keeps whatever licence was in force when it was built. */
      library.setLicence(DEMO_LICENCE);

      const update = showProgress('Reading the saved copy...');
      const snapshot = await readSnapshot(update);
      update('Building the dashboard...', 1);
      const fetched = performance.now();

      const built = buildDashboard({
        root: host,
        createGrid: library.createGrid,
        createStat: library.createStat,
        createChart: library.createChart,
        createKPI: library.createKPI,
        createTabs: library.createTabs,
        createDataRouter: library.createDataRouter,
        snapshot,
      });

      const finished = performance.now();
      const timings = {
        series: snapshot.series.length,
        readings: snapshot.observations.length,
        vintages: snapshot.vintages.length,
        catalogueRows: built.catalogueGrid.rows.count(),
        routedReadings: built.chartGrid.rows.count(),
        fetchMs: Math.round(fetched - started),
        buildMs: Math.round(finished - fetched),
        totalMs: Math.round(finished - started),
      };

      root.__fredDemo = Object.assign(built, { timings, ready: true });
      console.log('[fred demo] ready', timings);
    } catch (error) {
      root.__fredDemo = { ready: false, error: String((error && error.message) || error) };
      showError(error);
    }
  }

  start();
})(window);
