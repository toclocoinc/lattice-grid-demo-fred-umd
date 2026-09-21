/**
 * A timeline you can see, step along, and play.
 *
 * The page had a scrubber before this: a small range input between two words,
 * which a reader looking for time travel did not find. This is the same control
 * made findable -- a bar the width of the panel with a tick per date on it, the
 * date it is parked on in large type, arrows to step, and a play button that
 * walks it forward to today.
 *
 * It owns no data. It is handed a list of dates and calls back with an index,
 * so the same control drives the vintage replay on one tab and the whole
 * dashboard on the other.
 *
 * A classic script: it adds `createTimeline` to the `FredDemo` global.
 */
(function (root) {
  'use strict';

  /** How long each step of a play-through lasts. */
  const STEP_MS = 700;

  /** Make an element with a class and optional text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** A date, written out. */
  function longDate(date) {
    if (!date) return 'no date';
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  }

  /**
   * Build a timeline into `host`.
   *
   * @param {object} options
   * @param {HTMLElement} options.host where to draw
   * @param {string} options.label the words in front of the date
   * @param {string[]} options.dates the dates it steps between, oldest first
   * @param {(index: number, date: string, atEnd: boolean) => void} options.onChange
   *   called whenever the position moves, with the index and the date
   * @param {string} [options.endLabel] what the "go to the end" button says
   * @param {string} [options.unit] what one tick is, for the screen reader
   * @returns {object} the controller
   */
  function createTimeline(options) {
    const { host, label, onChange } = options;
    const endLabel = options.endLabel || 'Back to today';
    const unit = options.unit || 'date';

    let dates = options.dates || [];
    let index = Math.max(0, dates.length - 1);
    let timer = null;

    const wrap = el('div', 'timeline');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', label);

    const head = el('div', 'timeline-head');
    head.append(el('span', 'timeline-label', label));
    const dateOut = el('strong', 'timeline-date', 'no date');
    const position = el('span', 'timeline-position', '');
    head.append(dateOut, position);
    wrap.append(head);

    const track = el('div', 'timeline-track');
    const ticks = el('div', 'timeline-ticks');
    ticks.setAttribute('aria-hidden', 'true');
    const range = el('input', 'timeline-range');
    range.type = 'range';
    range.min = '0';
    range.step = '1';
    range.setAttribute('aria-label', `${label}: step through each ${unit}`);
    track.append(ticks, range);
    wrap.append(track);

    const controls = el('div', 'timeline-controls');
    const back = el('button', 'action timeline-step', '◀');
    back.type = 'button';
    back.title = `One ${unit} earlier`;
    back.setAttribute('aria-label', `One ${unit} earlier`);
    const forward = el('button', 'action timeline-step', '▶');
    forward.type = 'button';
    forward.title = `One ${unit} later`;
    forward.setAttribute('aria-label', `One ${unit} later`);
    const play = el('button', 'action timeline-play', '▶ Play');
    play.type = 'button';
    const end = el('button', 'action', endLabel);
    end.type = 'button';
    controls.append(back, forward, play, end);
    wrap.append(controls);

    host.append(wrap);

    /** Redraw the tick marks: one per date, evenly spaced across the track. */
    function drawTicks() {
      ticks.textContent = '';
      if (dates.length < 2) return;
      /* A tick per date up to the point where they would be closer together
         than a hairline; past that every second or third, so the bar reads as a
         scale rather than as a solid block. */
      const every = Math.max(1, Math.ceil(dates.length / 160));
      for (let i = 0; i < dates.length; i += every) {
        const mark = el('span', 'timeline-tick');
        mark.style.left = `${(i / (dates.length - 1)) * 100}%`;
        ticks.append(mark);
      }
    }

    /** Say where we are, and tell the caller. */
    function announce(quiet) {
      const date = dates[index];
      dateOut.textContent = longDate(date);
      position.textContent = dates.length
        ? `${index + 1} of ${dates.length}`
        : '';
      range.value = String(index);
      wrap.classList.toggle('at-end', index >= dates.length - 1);
      if (!quiet && onChange) onChange(index, date, index >= dates.length - 1);
    }

    /** Move to a position, clamped. */
    function goTo(next, quiet) {
      if (!dates.length) return;
      const at = Math.max(0, Math.min(dates.length - 1, Math.round(next)));
      if (at === index && quiet !== false) {
        announce(true);
        return;
      }
      index = at;
      announce(quiet);
    }

    /** Stop a play-through, if one is running. */
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      play.textContent = '▶ Play';
      play.classList.remove('on');
      play.setAttribute('aria-pressed', 'false');
    }

    /**
     * Walk forward one step at a time until the end, then stop.
     *
     * From the end it starts again at the beginning, because a play button that
     * does nothing is worse than one that rewinds first.
     */
    function start() {
      if (dates.length < 2) return;
      if (index >= dates.length - 1) goTo(0);
      play.textContent = '⏸ Pause';
      play.classList.add('on');
      play.setAttribute('aria-pressed', 'true');
      timer = setInterval(() => {
        if (index >= dates.length - 1) { stop(); return; }
        goTo(index + 1);
      }, STEP_MS);
    }

    function toggle() {
      if (timer) stop();
      else start();
    }

    back.addEventListener('click', () => { stop(); goTo(index - 1); });
    forward.addEventListener('click', () => { stop(); goTo(index + 1); });
    play.addEventListener('click', toggle);
    end.addEventListener('click', () => { stop(); goTo(dates.length - 1); });
    range.addEventListener('input', () => { stop(); goTo(Number(range.value)); });
    /* Space plays and pauses from anywhere on the control; the arrows are the
       range input's own, so they already work. */
    wrap.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      if (event.target === back || event.target === forward || event.target === end) return;
      event.preventDefault();
      toggle();
    });

    /**
     * Replace the dates the timeline steps between.
     *
     * @param {string[]} next the new dates, oldest first
     * @param {number} [at] where to park; the end by default
     * @returns {void}
     */
    function setDates(next, at) {
      dates = next || [];
      range.max = String(Math.max(0, dates.length - 1));
      index = at === undefined ? Math.max(0, dates.length - 1) : at;
      drawTicks();
      announce(true);
    }

    setDates(options.dates || [], options.index);

    return {
      element: wrap,
      setDates,
      /** Move to a position and tell the caller. */
      goTo: (at) => { stop(); goTo(at, false); },
      /** Move to the latest position on or before a date. */
      goToDate: (date) => {
        let at = 0;
        for (let i = 0; i < dates.length; i += 1) if (dates[i] <= date) at = i;
        stop();
        goTo(at, false);
      },
      index: () => index,
      date: () => dates[index],
      dates: () => dates,
      playing: () => !!timer,
      play: start,
      stop,
      destroy: () => { stop(); wrap.remove(); },
    };
  }

  root.FredDemo = root.FredDemo || {};
  root.FredDemo.createTimeline = createTimeline;
  root.FredDemo.TIMELINE_STEP_MS = STEP_MS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
