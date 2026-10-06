/**
 * Gemini Cookie Converter — application layer.
 * ============================================================================
 * Wires the DOM to the pure conversion engine (`assets/converter.js`) using the
 * interaction primitives from `assets/ui.js`. This file owns *state and flow*;
 * it never parses cookies itself and it never talks to the network.
 *
 * Privacy contract (unchanged since v1):
 *   • no network requests — everything below is local DOM work;
 *   • no cookie value is written to storage, URIs, attributes or the console;
 *   • the only persisted values are the theme choice and two option toggles;
 *   • values stay masked in the audit table until the user opts in.
 *
 * Structure:
 *   1  boot              2  elements           3  constants & state
 *   4  helpers           5  status & toasts    6  rendering
 *   7  actions           8  input metadata     9  theme
 *  10  navigation       11  options popover   12  dialog & tabs
 *  13  scroll & motion  14  wiring            15  service worker
 */
(function () {
  'use strict';

  /* ======================================================================
   * 1 · Boot guard
   * ==================================================================== */

  const CC = window.CookieConverter;
  const UI = window.UI;

  const bootError = (message) => {
    const banner = document.getElementById('status');
    if (!banner) return;
    banner.hidden = false;
    banner.className = 'banner banner-err';
    banner.textContent = message;
  };

  if (!CC) {
    bootError('The conversion engine (assets/converter.js) failed to load — check the browser console, ' +
      'or that the file was copied next to app.js.');
    return;
  }
  if (!UI) {
    bootError('The interface module (assets/ui.js) failed to load — check the browser console, ' +
      'or that the file was copied next to app.js.');
    return;
  }

  /* ======================================================================
   * 2 · Elements
   * ==================================================================== */

  const $ = (id) => document.getElementById(id);
  const $q = (selector) => document.querySelector(selector);

  const els = {
    // input card
    file: $('file'),
    dropzone: $('dropzone'),
    input: $('input'),
    status: $('status'),
    detectBadge: $('detect-badge'),
    charCount: $('char-count'),
    convert: $('convert'),
    sample: $('sample'),
    clear: $('clear'),
    // result column
    emptyState: $('empty-state'),
    emptyGuide: $('empty-guide'),
    emptySample: $('empty-sample'),
    skeleton: $('result-skeleton'),
    result: $('result'),
    stats: $('stats'),
    coverage: $('coverage'),
    coverageFill: $('coverage-fill'),
    coverageCount: $('coverage-count'),
    checklistWrap: $('checklist-wrap'),
    checklist: $('checklist'),
    tableTools: $('table-tools'),
    tableWrap: $('table-wrap'),
    tableBody: $q('#cookie-table tbody'),
    tableNote: $('table-note'),
    filter: $('filter'),
    onlyRequired: $('only-required'),
    reveal: $('reveal'),
    notes: $('notes'),
    report: $('report'),
    reportCount: $('report-count'),
    reportList: $('report-list'),
    outputTools: $('output-tools'),
    output: $('output'),
    resultActions: $('result-actions'),
    privacyNote: $('privacy-note'),
    copy: $('copy'),
    downloadJson: $('download-json'),
    downloadTxt: $('download-txt'),
    fmtPretty: $('fmt-pretty'),
    fmtMin: $('fmt-min'),
    segmented: $q('.segmented'),
    // navigation & chrome
    topbar: $('topbar'),
    headerVeil: $('header-veil'),
    toTop: $('to-top'),
    nav: $q('.nav'),
    navConverter: $('nav-converter'),
    navGuide: $('nav-guide'),
    bottombar: $('bottombar'),
    barConvert: $('bar-convert'),
    barGuide: $('bar-guide'),
    barOptions: $('bar-options'),
    themeToggle: $('theme-toggle'),
    version: $('version'),
    // options popover
    optionsToggle: $('options-toggle'),
    optionsPanel: $('options-panel'),
    optionsClose: $('options-close'),
    optionsReset: $('options-reset'),
    optionsDot: $('options-dot'),
    optExtra: $('opt-extra'),
    optExpired: $('opt-expired'),
    // guide dialog
    guideDialog: $('guide-dialog'),
    guideTabs: $('guide-tabs'),
    guideClose: $('guide-close'),
    guideDone: $('guide-done'),
    // sample chips
    sampleNetscape: $('sample-netscape'),
    sampleJson: $('sample-json'),
    sampleHeader: $('sample-header'),
    sampleSetCookie: $('sample-setcookie'),
    sampleCurl: $('sample-curl'),
    toasts: $('toasts'),
    guide: $('guide'),
  };

  /* ======================================================================
   * 3 · Constants & state
   * ==================================================================== */

  const MAX_FILE_BYTES = CC.LIMITS.MAX_CHARS;
  const MAX_TABLE_ROWS = 400;          // rows rendered per page
  const MAX_TABLE_ROWS_HARD = 4000;    // upper bound for repeated "show more"
  const AUTO_CONVERT_LIMIT = 512 * 1024;
  const SKELETON_THRESHOLD = 192 * 1024; // show a loading state above this
  const MASK = '\u2022'.repeat(14);
  const PREFS_KEY = 'gcc-prefs';
  const THEME_KEY = 'gcc-theme';
  const DEFAULT_PREFS = { extra: false, expired: false };

  const FORMAT_LABELS = {
    netscape: 'Netscape / curl cookie file',
    json: 'JSON export',
    header: 'raw Cookie header',
    curl: 'Copy-as-cURL command',
    'set-cookie': 'Set-Cookie header',
    empty: 'Waiting for input',
  };

  const STATUS_LABELS = {
    ok: 'found',
    weak: 'other domain',
    expired: 'expired',
    invalid: 'unusable value',
    missing: 'missing',
  };

  const STATUS_ICONS = {
    ok: 'check',
    weak: 'alert',
    expired: 'alert',
    invalid: 'close',
    missing: 'close',
  };

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  const state = {
    result: null,        // last conversion result
    payload: null,       // payload of the last successful conversion
    pretty: true,        // output formatting
    stale: false,
    shownRows: [],       // rows currently rendered (index base for reveal)
    tableLimit: MAX_TABLE_ROWS,
    lastDurationMs: 0,
    prefs: Object.assign({}, DEFAULT_PREFS),
    undo: null,          // memory-only snapshot offered by the Clear toast
  };

  /* ======================================================================
   * 4 · Helpers
   * ==================================================================== */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
  }

  function formatBytes(chars) {
    if (chars < 1024) return chars + ' B';
    if (chars < 1024 * 1024) return (chars / 1024).toFixed(1) + ' KB';
    return (chars / 1048576).toFixed(1) + ' MB';
  }

  function formatExpiry(entry) {
    if (!entry.expires) return 'Session';
    const when = dateFormat.format(new Date(entry.expires * 1000));
    if (entry.expired) return 'Expired · ' + when;
    const days = Math.ceil((entry.expires * 1000 - Date.now()) / 86400000);
    const rel = days <= 0 ? 'today' : days === 1 ? 'in 1 day' : 'in ' + days + ' days';
    return when + ' (' + rel + ')';
  }

  function setHidden(node, hidden) {
    if (node) node.hidden = Boolean(hidden);
  }

  function on(id, event, handler) {
    const node = els[id] || $(id);
    if (node) node.addEventListener(event, handler);
  }

  function anyOf(...nodes) {
    return nodes.filter(Boolean);
  }

  /* ======================================================================
   * 5 · Status banner & toasts
   * ==================================================================== */

  function showBanner(kind, message, hint) {
    if (!els.status) return;
    els.status.hidden = false;
    els.status.className = 'banner banner-' + kind;
    els.status.textContent = message + (hint ? '\n' + hint : '');
  }

  function hideBanner() {
    if (!els.status) return;
    els.status.hidden = true;
    els.status.textContent = '';
  }

  const toast = (message, kind, options) => UI.toast.show(message, kind, options);

  /* ======================================================================
   * 6 · Rendering
   * ==================================================================== */

  function setDetectBadge(format) {
    if (!els.detectBadge) return;
    els.detectBadge.dataset.format = format;
    els.detectBadge.textContent = format === 'empty'
      ? FORMAT_LABELS.empty
      : 'Detected: ' + (FORMAT_LABELS[format] || format);
  }

  /** Coverage meter: how many of the required cookies are usable. */
  function renderCoverage(result) {
    if (!els.coverage) return;
    const required = CC.REQUIRED.length;
    const found = (result.checklist || []).filter((row) => row.status === 'ok' || row.status === 'weak').length;
    els.coverage.dataset.progress = String(found);
    if (els.coverageFill) els.coverageFill.style.setProperty('--progress', String(required ? found / required : 0));
    if (els.coverageCount) UI.animateNumber(els.coverageCount, found, { from: found, duration: 320 });
    els.coverage.setAttribute('aria-label', found + ' of ' + required + ' required cookies usable');
  }

  function renderChecklist(result) {
    if (!els.checklist) return;
    const rows = result.checklist || [];
    els.checklist.textContent = '';
    setHidden(els.checklistWrap, !rows.length);
    if (!rows.length) return;

    for (const row of rows) {
      const item = el('li', 'check check-' + row.status);
      const glyph = UI.icon(STATUS_ICONS[row.status] || 'info', 'icon-14');
      item.appendChild(glyph);
      item.appendChild(el('span', 'check-name', row.name));
      if (row.entry && row.entry.domain) {
        item.appendChild(el('span', 'check-domain', row.entry.domain));
      }
      item.appendChild(el('span', 'badge badge-' + row.status, STATUS_LABELS[row.status] || row.status));
      els.checklist.appendChild(item);
    }
  }

  function visibleEntries() {
    const result = state.result;
    if (!result) return { rows: [], total: 0, filtered: 0 };
    const needle = (els.filter && els.filter.value ? els.filter.value : '').trim().toLowerCase();
    const requiredOnly = Boolean(els.onlyRequired && els.onlyRequired.checked);
    const required = CC.REQUIRED;
    let rows = result.entries || [];

    if (requiredOnly) rows = rows.filter((entry) => required.indexOf(entry.name) !== -1);
    if (needle) {
      rows = rows.filter((entry) =>
        entry.name.toLowerCase().includes(needle) ||
        (entry.domain || '').toLowerCase().includes(needle));
    }
    const filtered = rows.length;

    // Required cookies first — in the order of the generated header — then the
    // rest alphabetically: deterministic, and easy to scan.
    const rank = (entry) => {
      const index = required.indexOf(entry.name);
      return index === -1 ? required.length : index;
    };
    rows = rows.slice().sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff) return diff;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.order - b.order;
    });
    return { rows, total: (result.entries || []).length, filtered };
  }

  function renderTable() {
    if (!els.tableBody) return;
    const { rows, total, filtered } = visibleEntries();
    const selectedNames = state.result ? state.result.selected || {} : {};
    const shown = rows.slice(0, Math.min(state.tableLimit, MAX_TABLE_ROWS_HARD));
    state.shownRows = shown; // index base for the per-cell reveal

    els.tableBody.textContent = '';
    const fragment = document.createDocumentFragment();
    const reveal = Boolean(els.reveal && els.reveal.checked);

    for (const entry of shown) {
      const isRequired = CC.REQUIRED.indexOf(entry.name) !== -1;
      const isUsed = Boolean(selectedNames[entry.name]) && selectedNames[entry.name] === entry;
      const row = el('tr', isRequired ? null : 'extra');

      const nameCell = el('td');
      nameCell.appendChild(el('span', null, entry.name));
      if (isUsed) {
        const foreign = CC.domainScore(entry.domain) < 3;
        nameCell.appendChild(el('span', 'badge ' + (foreign ? 'badge-warn' : 'badge-used'),
          foreign ? 'foreign domain' : 'used'));
      } else if (isRequired && entry.expired) {
        nameCell.appendChild(el('span', 'badge badge-warn', 'expired'));
      }

      const flags = el('td');
      if (entry.secure) flags.appendChild(el('span', 'flag', 'Secure'));
      if (entry.httpOnly) flags.appendChild(el('span', 'flag', 'HttpOnly'));
      if (entry.sameSite) flags.appendChild(el('span', 'flag', 'SameSite=' + entry.sameSite));
      if (!entry.domain) flags.appendChild(el('span', 'flag', 'no domain'));

      const valueCell = el('td', 'value', reveal ? entry.value : MASK);
      valueCell.dataset.index = String(shown.indexOf(entry));
      valueCell.title = reveal ? 'Click to hide this value' : 'Click to reveal this value';

      row.append(
        nameCell,
        el('td', null, entry.domain || '\u2014'),
        el('td', entry.expired ? 'expired-cell' : null, formatExpiry(entry)),
        flags,
        valueCell
      );
      fragment.appendChild(row);
    }
    els.tableBody.appendChild(fragment);

    if (!els.tableNote) return;
    if (!filtered) {
      els.tableNote.hidden = false;
      els.tableNote.textContent = 'No cookies match this filter.';
      const clear = el('button', 'link-btn', ' Clear it');
      clear.type = 'button';
      clear.id = 'clear-filter';
      els.tableNote.appendChild(clear);
      return;
    }
    els.tableNote.hidden = false;
    if (shown.length < filtered) {
      els.tableNote.textContent = 'Showing ' + shown.length + ' of ' + filtered +
        ' matching cookies (' + total + ' parsed). ';
      if (state.tableLimit < MAX_TABLE_ROWS_HARD) {
        const more = el('button', 'link-btn', 'Show more');
        more.type = 'button';
        more.id = 'show-more';
        els.tableNote.appendChild(more);
      }
    } else {
      els.tableNote.textContent = 'Showing all ' + shown.length + ' cookies.';
    }
  }

  function renderNotes(result) {
    if (!els.notes) return;
    const warnings = result.warnings || [];
    const info = result.info || [];
    els.notes.textContent = '';
    setHidden(els.notes, !warnings.length && !info.length);
    if (!warnings.length && !info.length) return;

    if (warnings.length && info.length) {
      els.notes.appendChild(el('li', 'notes-head', 'Before you use this'));
    }
    for (const text of warnings) els.notes.appendChild(el('li', 'note note-warn', text));

    if (warnings.length && info.length) {
      els.notes.appendChild(el('li', 'notes-head', 'Details'));
    }
    for (const text of info) els.notes.appendChild(el('li', 'note note-info', text));
  }

  function renderReport(result) {
    if (!els.report || !els.reportList) return;
    const malformed = (result.stats && result.stats.malformed) || [];
    const skipped = result.stats ? result.stats.skipped : 0;
    setHidden(els.report, !malformed.length);
    if (!malformed.length) return;
    if (els.reportCount) els.reportCount.textContent = String(skipped);
    els.reportList.textContent = '';
    for (const item of malformed) {
      const where = item.line ? 'Line ' + item.line + ': ' : '';
      const what = item.text ? '\u201c' + item.text + '\u201d \u2014 ' : '';
      els.reportList.appendChild(el('li', null, where + what + item.reason));
    }
    if (skipped > malformed.length) {
      els.reportList.appendChild(el('li', 'muted',
        '\u2026and ' + (skipped - malformed.length) + ' more (first ' + malformed.length + ' shown).'));
    }
  }

  function renderOutput() {
    if (!els.output || !state.payload) return;
    els.output.value = state.pretty
      ? JSON.stringify(state.payload, null, 2)
      : JSON.stringify(state.payload);
  }

  function setStale(isStale) {
    state.stale = isStale;
    if (els.result) els.result.classList.toggle('is-stale', isStale);
  }

  function render(result) {
    state.result = result;
    state.tableLimit = MAX_TABLE_ROWS;
    state.payload = result.ok ? result.payload : null;

    setDetectBadge(result.format);
    const stats = result.stats || {};
    const bits = [FORMAT_LABELS[result.format] || result.format];
    bits.push(result.parsed + (result.parsed === 1 ? ' cookie' : ' cookies') + ' parsed');
    if (result.parsed) bits.push('in ' + (state.lastDurationMs || 0) + ' ms');
    if (stats.comments) bits.push(stats.comments + ' comment line(s)');
    if (stats.skipped) bits.push(stats.skipped + ' line(s) skipped');
    if (els.stats) els.stats.textContent = bits.join(' \u00b7 ');

    renderCoverage(result);
    renderChecklist(result);
    renderNotes(result);
    renderReport(result);

    const hasEntries = Boolean(result.entries && result.entries.length);
    setHidden(els.tableTools, !hasEntries);
    setHidden(els.tableWrap, !hasEntries);
    if (hasEntries) renderTable();
    else setHidden(els.tableNote, true);

    setHidden(els.outputTools, !result.ok);
    if (els.output) {
      els.output.hidden = !result.ok;
      // Never leave a previous payload sitting in a hidden field.
      if (!result.ok) els.output.value = '';
    }
    setHidden(els.resultActions, !result.ok);
    setHidden(els.privacyNote, !result.ok);
    if (result.ok) renderOutput();

    const hasFailures = (result.checklist || []).some((row) => row.status !== 'ok');
    setHidden(els.result, !result.ok && !hasEntries && !hasFailures);
    setHidden(els.skeleton, true);
    setHidden(els.emptyState, true);
    setStale(false);

    if (result.ok) {
      const message = result.passthrough
        ? 'Valid gemini-web2api payload — passed through unchanged.'
        : 'Success — all ' + CC.REQUIRED.length + ' required cookies found.';
      showBanner(result.warnings.length ? 'warn' : 'ok', message,
        result.warnings.length ? 'Read the notes below before using the payload.' : null);
    } else {
      showBanner('err', result.error || 'Could not find the required cookies.',
        result.hint || 'See docs/troubleshooting.md for common fixes.');
    }
  }

  /** Loading state for inputs big enough that parsing is noticeable. */
  function showSkeleton() {
    setHidden(els.emptyState, true);
    setHidden(els.result, true);
    setHidden(els.skeleton, false);
  }

  function showEmptyState() {
    setHidden(els.emptyState, false);
    setHidden(els.skeleton, true);
  }

  /* ======================================================================
   * 7 · Actions
   * ==================================================================== */

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function runConversion(source) {
    const started = now();
    let result;
    try {
      result = CC.convert(source, {
        extraCookies: state.prefs.extra ? CC.SUGGESTED_EXTRA : [],
        allowExpired: state.prefs.expired,
        maxChars: MAX_FILE_BYTES,
      });
    } catch (error) {
      setHidden(els.skeleton, true);
      setHidden(els.result, true);
      showEmptyState();
      showBanner('err', 'Unexpected error: ' + error.message,
        'Please report this with the input shape (never real cookie values).');
      return;
    }
    state.lastDurationMs = Math.max(1, Math.round(now() - started));
    render(result);
  }

  function convert(options) {
    const opts = options || {};
    const source = els.input ? els.input.value : '';
    if (!source.trim()) {
      setHidden(els.result, true);
      showBanner('warn', 'Paste a cookie export, or drop / choose a file first.',
        'No idea where to start? Press \u201cShow me how\u201d or load a sample.');
      return;
    }

    // Heavy inputs: paint the skeleton first so the tab never looks frozen.
    if (source.length > SKELETON_THRESHOLD) {
      showSkeleton();
      const schedule = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 16));
      schedule(() => window.setTimeout(() => runConversion(source), 0));
    } else {
      runConversion(source);
    }

    if (opts.scroll !== false && els.result && !els.result.hidden && !isWideLayout() && typeof els.result.scrollIntoView === 'function') {
      els.result.scrollIntoView({ behavior: UI.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function isWideLayout() {
    return Boolean(window.matchMedia && window.matchMedia('(min-width: 1060px)').matches);
  }

  function clearAll() {
    // Snapshot for the "Undo" action (memory only — nothing is persisted).
    state.undo = {
      input: els.input ? els.input.value : '',
      output: els.output ? els.output.value : '',
      result: state.result,
    };

    if (els.input) els.input.value = '';
    if (els.output) els.output.value = '';
    if (els.file) els.file.value = '';
    if (els.filter) els.filter.value = '';
    if (els.onlyRequired) els.onlyRequired.checked = false;
    state.payload = null;
    state.result = null;
    setHidden(els.result, true);
    setHidden(els.skeleton, true);
    showEmptyState();
    hideBanner();
    updateInputMeta();
    if (els.input) els.input.focus();

    toast('Cleared. Cookie values are gone from the page.', 'info', {
      icon: 'refresh',
      action: {
        label: 'Undo',
        onAction: restoreUndo,
      },
    });
  }

  function restoreUndo() {
    const snapshot = state.undo;
    if (!snapshot) return;
    state.undo = null;
    if (els.input) els.input.value = snapshot.input;
    if (els.output) els.output.value = snapshot.output;
    updateInputMeta();
    if (snapshot.result) render(snapshot.result);
    else showEmptyState();
    toast('Restored.', 'ok');
  }

  /** Sample payloads — every value is obviously fake, and they never expire. */
  function sampleText(kind) {
    const expiry = String(Math.floor(Date.now() / 1000) + 365 * 24 * 3600); // +1 year
    const names = CC.REQUIRED;
    const values = (prefix) => names.map((name) => [name, prefix + name.toLowerCase().replace(/[^a-z0-9]/g, '') + '-replace-me']);
    const header = values('SAMPLE-').map(([name, value]) => name + '=' + value).join('; ');

    if (kind === 'json') {
      const items = names.map((name) => ({
        domain: '.gemini.google.com',
        name,
        value: 'SAMPLE-' + name.toLowerCase().replace(/[^a-z0-9]/g, '') + '-replace-me',
        path: '/',
        secure: true,
        httpOnly: true,
        expirationDate: Number(expiry),
      }));
      return JSON.stringify(items, null, 2);
    }
    if (kind === 'header') return header;
    if (kind === 'setcookie') {
      const expires = new Date(Number(expiry) * 1000).toUTCString();
      return names.map((name, index) =>
        'Set-Cookie: ' + name + '=' + header.split('; ')[index].split('=')[1] +
        '; Domain=.gemini.google.com; Path=/; Expires=' + expires + '; Secure; HttpOnly; SameSite=None'
      ).join('\n');
    }
    if (kind === 'curl') {
      return [
        "curl 'https://gemini.google.com/app' \\",
        "  -H 'accept: */*' \\",
        "  -H 'cookie: " + header + "' \\",
        '  --compressed',
      ].join('\n');
    }
    return [
      '# Netscape HTTP Cookie File',
      '# Sample export — replace every value with your own.',
      ...values('SAMPLE-').map(([name, value]) => '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + expiry + '\t' + name + '\t' + value),
      '.gemini.google.com\tTRUE\t/\tTRUE\t' + expiry + '\tNID\tSAMPLE-extra-cookie-ignored',
      '',
    ].join('\n');
  }

  function loadSample(kind) {
    const type = kind || 'netscape';
    if (els.input) els.input.value = sampleText(type);
    if (els.file) els.file.value = '';
    updateInputMeta();
    convert({ scroll: true });
    toast(type === 'netscape'
      ? 'Sample loaded — replace the values with your real export.'
      : 'Sample loaded — ' + (FORMAT_LABELS[type === 'setcookie' ? 'set-cookie' : type] || type) + '.',
    'info');
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showBanner('err', 'File is too large (' + formatBytes(file.size) + '). Limit is ' +
        formatBytes(MAX_FILE_BYTES) + '.',
        'Export only the cookies for gemini.google.com rather than the whole browser.');
      return;
    }
    if (els.dropzone) els.dropzone.classList.add('is-loading');

    const read = typeof file.text === 'function'
      ? file.text()
      : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsText(file);
      });

    read.then((text) => {
      if (els.input) els.input.value = text;
      updateInputMeta();
      if (text.trim() && text.length <= AUTO_CONVERT_LIMIT) {
        convert({ scroll: true });
        toast('Loaded \u201c' + file.name + '\u201d — converted automatically.', 'ok');
      } else {
        toast('Loaded \u201c' + file.name + '\u201d — press Convert.', 'ok');
      }
    }).catch(() => {
      showBanner('err', 'Could not read "' + file.name + '". Is it a plain-text cookie export?');
    }).then(() => {
      if (els.dropzone) els.dropzone.classList.remove('is-loading');
    });
  }

  function legacyCopy() {
    if (!els.output) return;
    els.output.focus();
    els.output.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    toast(ok ? 'JSON copied to clipboard.' : 'Copy failed — select the JSON and press Ctrl+C.',
      ok ? 'ok' : 'err');
  }

  function copyOutput() {
    if (!els.output || !els.output.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(els.output.value)
        .then(() => toast('JSON copied to clipboard.', 'ok'))
        .catch(legacyCopy);
    } else {
      legacyCopy();
    }
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a moment to start the download before revoking.
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadJson() {
    if (!els.output || !els.output.value) return;
    download('cookie.json', els.output.value, 'application/json');
    toast('Downloading cookie.json — keep it private.', 'ok', { icon: 'download' });
  }

  function downloadTxt() {
    if (!state.payload || !state.payload.cookie) return;
    // gemini-web2api also accepts a plain one-line cookie file (--cookie-file).
    download('cookie.txt', state.payload.cookie + '\n', 'text/plain');
    toast('Downloading cookie.txt — keep it private.', 'ok', { icon: 'download' });
  }

  /* ======================================================================
   * 8 · Live input metadata
   * ==================================================================== */

  function updateInputMeta() {
    const value = els.input ? els.input.value : '';
    if (els.charCount) {
      els.charCount.textContent = formatBytes(value.length) + ' / ' + formatBytes(MAX_FILE_BYTES);
    }
    setDetectBadge(value.trim() ? CC.detectFormat(value) : 'empty');

    const hasInput = Boolean(value.trim());
    if (els.convert) els.convert.disabled = !hasInput;
    if (els.barConvert) els.barConvert.disabled = !hasInput;
    if (state.result) setStale(true);
  }

  let metaTimer = 0;
  function scheduleInputMeta() {
    window.clearTimeout(metaTimer);
    metaTimer = window.setTimeout(updateInputMeta, 150);
  }

  /* ======================================================================
   * 9 · Theme
   * ==================================================================== */

  function storedTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (e) {
      return null;
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (!els.themeToggle) return;
    const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    els.themeToggle.setAttribute('aria-label', label);
    els.themeToggle.setAttribute('data-tip', theme === 'light' ? 'Dark' : 'Light');
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) { /* storage unavailable */ }
  }

  function initTheme() {
    const saved = storedTheme();
    applyTheme(saved || systemTheme());
    if (!saved && window.matchMedia) {
      const query = window.matchMedia('(prefers-color-scheme: light)');
      const listener = (event) => {
        if (!storedTheme()) applyTheme(event.matches ? 'light' : 'dark');
      };
      if (query.addEventListener) query.addEventListener('change', listener);
      else if (query.addListener) query.addListener(listener);
    }
  }

  /* ======================================================================
   * 10 · Navigation
   * ==================================================================== */

  function setActiveNav(target) {
    const isGuide = target === 'guide';
    if (els.nav) els.nav.dataset.active = isGuide ? '1' : '0';
    anyOf(els.navConverter, els.navGuide).forEach((item) => {
      const active = item.dataset.nav === target;
      item.classList.toggle('is-active', active);
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
  }

  function goTo(target) {
    const node = target === 'guide' ? els.guide : document.getElementById('converter');
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: UI.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    setActiveNav(target);
  }

  function initNavTracking() {
    if (typeof window.IntersectionObserver !== 'function') return;
    const observer = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        setActiveNav(entry.target.id === 'guide' ? 'guide' : 'converter');
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    anyOf(els.guide, document.getElementById('converter')).forEach((node) => observer.observe(node));
  }

  /* ======================================================================
   * 11 · Options popover
   * ==================================================================== */

  let popover = null;

  function syncOptions() {
    const nonDefault = state.prefs.extra !== DEFAULT_PREFS.extra || state.prefs.expired !== DEFAULT_PREFS.expired;
    setHidden(els.optionsDot, !nonDefault);
    if (els.optionsReset) els.optionsReset.disabled = !nonDefault;
  }

  function initOptions() {
    if (els.optExtra) els.optExtra.checked = state.prefs.extra;
    if (els.optExpired) els.optExpired.checked = state.prefs.expired;
    syncOptions();

    // The top bar button and the mobile bar button are equal triggers: the panel
    // is anchored to whichever one opened it.
    popover = UI.popover({
      triggers: [els.optionsToggle, els.barOptions].filter(Boolean),
      panel: els.optionsPanel,
    });
    if (els.optionsClose && popover) els.optionsClose.addEventListener('click', () => popover.close());

    on('optExtra', 'change', (event) => {
      state.prefs.extra = event.target.checked;
      savePrefs();
      syncOptions();
      if (els.input && els.input.value.trim()) convert();
    });
    on('optExpired', 'change', (event) => {
      state.prefs.expired = event.target.checked;
      savePrefs();
      syncOptions();
      if (els.input && els.input.value.trim()) convert();
    });
    if (els.optionsReset) {
      els.optionsReset.addEventListener('click', () => {
        state.prefs = Object.assign({}, DEFAULT_PREFS);
        savePrefs();
        if (els.optExtra) els.optExtra.checked = false;
        if (els.optExpired) els.optExpired.checked = false;
        syncOptions();
        if (els.input && els.input.value.trim()) convert();
        toast('Options reset to defaults.', 'info');
      });
    }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.prefs.extra = parsed.extra === true;
        state.prefs.expired = parsed.expired === true;
      }
    } catch (e) { /* storage unavailable or corrupt — use defaults */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
    } catch (e) { /* storage unavailable */ }
  }

  /* ======================================================================
   * 12 · Guide dialog & tabs
   * ==================================================================== */

  let guideDialog = null;

  function initGuide() {
    guideDialog = UI.dialog({
      dialog: els.guideDialog,
      triggers: anyOf(els.emptyGuide, els.navGuide, els.barGuide),
    });
    UI.tabs({ container: els.guideTabs });

    if (els.guideClose && guideDialog) els.guideClose.addEventListener('click', () => guideDialog.close());
    if (els.guideDone && guideDialog) els.guideDone.addEventListener('click', () => guideDialog.close());
  }

  /* ======================================================================
   * 13 · Scroll behaviour & motion
   * ==================================================================== */

  function initScroll() {
    let ticking = false;

    const apply = () => {
      ticking = false;
      const y = window.scrollY || 0;
      if (els.topbar) els.topbar.classList.toggle('is-scrolled', y > 8);
      if (els.headerVeil) els.headerVeil.classList.toggle('is-active', y > 8);
      if (els.toTop) {
        const visible = y > 480;
        els.toTop.hidden = false; // keep it in the a11y tree only when visible
        els.toTop.classList.toggle('is-visible', visible);
        els.toTop.setAttribute('aria-hidden', String(!visible));
        els.toTop.tabIndex = visible ? 0 : -1;
      }
    };

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      const raf = window.requestAnimationFrame || ((fn) => window.setTimeout(fn, 16));
      raf(apply);
    }, { passive: true });
    apply();

    if (els.toTop) els.toTop.addEventListener('click', () => goTo('converter'));
  }

  function initMotion() {
    UI.reveal('.reveal', { stagger: 60 });
    UI.shine(document);
  }

  /* ======================================================================
   * 14 · Wiring
   * ==================================================================== */

  function init() {
    loadPrefs();
    initTheme();
    initOptions();
    initGuide();
    initNavTracking();
    initScroll();
    initMotion();
    updateInputMeta();

    if (els.version) els.version.textContent = 'v' + CC.VERSION;

    /* — primary actions — */
    on('convert', 'click', () => convert());
    on('barConvert', 'click', () => convert());
    on('sample', 'click', () => loadSample('netscape'));
    on('emptySample', 'click', () => loadSample('netscape'));
    on('clear', 'click', clearAll);
    on('copy', 'click', copyOutput);
    on('downloadJson', 'click', downloadJson);
    on('downloadTxt', 'click', downloadTxt);
    on('fmtPretty', 'click', () => setPretty(true));
    on('fmtMin', 'click', () => setPretty(false));
    on('themeToggle', 'click', toggleTheme);

    /* — navigation — */
    anyOf(els.navConverter, els.navGuide).forEach((item) => {
      item.addEventListener('click', () => goTo(item.dataset.nav));
    });

    /* — sample chips — */
    const chips = {
      sampleNetscape: 'netscape',
      sampleJson: 'json',
      sampleHeader: 'header',
      sampleSetCookie: 'setcookie',
      sampleCurl: 'curl',
    };
    Object.keys(chips).forEach((id) => {
      const node = els[id];
      if (node) node.addEventListener('click', () => loadSample(chips[id]));
    });

    /* — table controls — */
    on('reveal', 'change', renderTable);
    on('onlyRequired', 'change', () => { state.tableLimit = MAX_TABLE_ROWS; renderTable(); });
    on('filter', 'input', () => { state.tableLimit = MAX_TABLE_ROWS; renderTable(); });

    if (els.tableNote) {
      els.tableNote.addEventListener('click', (event) => {
        const target = event.target;
        if (!target || !target.id) return;
        if (target.id === 'show-more') {
          state.tableLimit = Math.min(state.tableLimit + MAX_TABLE_ROWS, MAX_TABLE_ROWS_HARD);
          renderTable();
        } else if (target.id === 'clear-filter') {
          if (els.filter) els.filter.value = '';
          state.tableLimit = MAX_TABLE_ROWS;
          renderTable();
        }
      });
    }

    if (els.tableBody) {
      els.tableBody.addEventListener('click', (event) => {
        const cell = event.target && event.target.closest ? event.target.closest('td.value') : null;
        if (!cell) return;
        const entry = (state.shownRows || [])[Number(cell.dataset.index)];
        if (!entry) return;
        if (cell.dataset.revealed === '1') {
          cell.textContent = MASK;
          delete cell.dataset.revealed;
          cell.title = 'Click to reveal this value';
        } else {
          cell.textContent = entry.value;
          cell.dataset.revealed = '1';
          cell.title = 'Click to hide this value';
        }
      });
    }

    /* — file picking & drag/drop — */
    if (els.dropzone && els.file) {
      els.dropzone.addEventListener('click', () => els.file.click());
      els.dropzone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          els.file.click();
        }
      });
      els.file.addEventListener('change', () => readFile(els.file.files && els.file.files[0]));

      ['dragenter', 'dragover'].forEach((name) => {
        els.dropzone.addEventListener(name, (event) => {
          event.preventDefault();
          els.dropzone.classList.add('drag-over');
        });
      });
      ['dragleave', 'drop'].forEach((name) => {
        els.dropzone.addEventListener(name, (event) => {
          event.preventDefault();
          els.dropzone.classList.remove('drag-over');
        });
      });
      els.dropzone.addEventListener('drop', (event) => {
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) readFile(files[0]);
      });
    }

    /* — input — */
    if (els.input) {
      els.input.addEventListener('input', scheduleInputMeta);
      els.input.addEventListener('paste', () => {
        // Convert automatically for small pastes; big ones wait for the button.
        window.setTimeout(() => {
          updateInputMeta();
          if (els.input.value.trim() && els.input.value.length <= AUTO_CONVERT_LIMIT) {
            convert({ scroll: false });
          }
        }, 0);
      });
    }

    /* — global — */
    document.addEventListener('paste', (event) => {
      const files = event.clipboardData && event.clipboardData.files;
      if (files && files.length && els.input && document.activeElement !== els.input) {
        event.preventDefault();
        readFile(files[0]);
      }
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        convert();
        return;
      }
      if (event.key === 'Escape') {
        if (popover && popover.isOpen()) popover.close();
        UI.toast.dismissAll();
      }
      // "/" focuses the filter once there is something to filter
      if (event.key === '/' && els.filter && state.result && document.activeElement !== els.filter &&
          !/^(INPUT|TEXTAREA)$/.test(document.activeElement ? document.activeElement.tagName : '')) {
        event.preventDefault();
        els.filter.focus();
      }
    });
  }

  function setPretty(pretty) {
    state.pretty = pretty;
    if (els.fmtPretty) {
      els.fmtPretty.classList.toggle('active', pretty);
      els.fmtPretty.setAttribute('aria-pressed', String(pretty));
    }
    if (els.fmtMin) {
      els.fmtMin.classList.toggle('active', !pretty);
      els.fmtMin.setAttribute('aria-pressed', String(!pretty));
    }
    if (els.segmented) els.segmented.dataset.value = pretty ? 'pretty' : 'min';
    renderOutput();
  }

  /* ======================================================================
   * 15 · Offline support (skipped on file:// and unsupported browsers)
   * ==================================================================== */

  function initServiceWorker() {
    if (!navigator.serviceWorker) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      // `updateViaCache: 'none'` keeps the worker itself fresh: the browser's
      // update check always goes to the network, never the HTTP cache.
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {
        /* offline support is a bonus — never break the app over it */
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); initServiceWorker(); });
  } else {
    init();
    initServiceWorker();
  }
})();
