/**
 * Gemini Cookie Converter — UI layer.
 * ============================================================================
 * Thin glue between the DOM and the pure conversion engine in `converter.js`
 * (exposed as `window.CookieConverter`).
 *
 * Privacy contract (unchanged since v1):
 *   • no network requests — everything below is local DOM work;
 *   • no cookie value is ever written to storage, URIs, or the console;
 *   • the only persisted value is the light/dark preference;
 *   • values are masked in the audit table unless the user opts in.
 */
(function () {
  'use strict';

  const CC = window.CookieConverter;

  /* ======================================================================
   * 0 · Boot guard
   * ==================================================================== */

  const bootError = (message) => {
    const banner = document.getElementById('status');
    if (banner) {
      banner.hidden = false;
      banner.className = 'banner banner-err';
      banner.textContent = message;
    }
  };

  if (!CC) {
    bootError('The conversion engine (assets/converter.js) failed to load — check the browser console, ' +
      'or that the file was copied next to app.js.');
    return;
  }

  /* ======================================================================
   * 1 · Elements
   * ==================================================================== */

  const $ = (id) => document.getElementById(id);
  const $q = (selector) => document.querySelector(selector);

  const els = {
    file: $('file'),
    dropzone: $('dropzone'),
    input: $('input'),
    status: $('status'),
    result: $('result'),
    stats: $('stats'),
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
    convert: $('convert'),
    sample: $('sample'),
    clear: $('clear'),
    optExtra: $('opt-extra'),
    optExpired: $('opt-expired'),
    fmtPretty: $('fmt-pretty'),
    fmtMin: $('fmt-min'),
    segmented: $q('.segmented'),
    themeToggle: $('theme-toggle'),
    topbar: $('topbar'),
    detectBadge: $('detect-badge'),
    charCount: $('char-count'),
    version: $('version'),
    toasts: $('toasts'),
  };

  /* ======================================================================
   * 2 · Constants & state
   * ==================================================================== */

  const MAX_FILE_BYTES = CC.LIMITS.MAX_CHARS;
  const MAX_TABLE_ROWS = 400;      // rendered rows in one go
  const MAX_TABLE_ROWS_HARD = 4000; // upper bound for repeated "show more"
  const AUTO_CONVERT_LIMIT = 512 * 1024;
  const MASK = '\u2022'.repeat(14);
  const TOAST_LIMIT = 3;
  const TOAST_MS = 3600;
  const PREFS_KEY = 'gcc-prefs';

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

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  const state = {
    result: null,        // last conversion result
    payload: null,       // payload of the last successful conversion
    pretty: true,
    stale: false,
    shownRows: [],       // rows currently rendered (per-cell reveal index base)
    tableLimit: MAX_TABLE_ROWS,
    prefs: { extra: false, expired: false },
  };

  /* ======================================================================
   * 3 · Small helpers
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

  /* ======================================================================
   * 4 · Status banner & toasts
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

  /* Icon glyphs live in the stylesheet as CSS masks (see `.toast-icon`),
     so no markup is ever generated from JavaScript. */

  function dismissToast(toast) {
    if (!toast || toast.dataset.leaving) return;
    toast.dataset.leaving = '1';
    toast.classList.add('toast-out');
    window.setTimeout(() => toast.remove(), 280);
  }

  function showToast(message, kind) {
    if (!els.toasts) return;
    const last = els.toasts.lastElementChild;
    if (last && last.dataset.message === message) {
      dismissToast(last); // avoid stacking duplicates
    }
    const type = kind || 'info';
    const toast = el('div', 'toast glass-float toast-' + type);
    toast.setAttribute('role', 'status');
    toast.dataset.message = message;

    const icon = el('span', 'toast-icon');
    icon.setAttribute('aria-hidden', 'true');
    toast.appendChild(icon);
    toast.appendChild(el('span', null, message));
    const dismiss = el('span', 'toast-dismiss', '\u00d7');
    dismiss.setAttribute('aria-hidden', 'true');
    toast.appendChild(dismiss);
    toast.addEventListener('click', () => dismissToast(toast));

    els.toasts.appendChild(toast);
    // Overflow: drop the oldest toasts outright (they are already fading, so
    // re-dismissing them would never shrink the stack).
    let overflow = els.toasts.children.length - TOAST_LIMIT;
    while (overflow-- > 0) {
      const oldest = els.toasts.firstElementChild;
      if (!oldest) break;
      oldest.remove();
    }

    let timer = window.setTimeout(() => dismissToast(toast), TOAST_MS);
    toast.addEventListener('mouseenter', () => window.clearTimeout(timer));
    toast.addEventListener('mouseleave', () => {
      timer = window.setTimeout(() => dismissToast(toast), 1200);
    });
  }

  /* ======================================================================
   * 5 · Preferences (the only thing this app persists)
   * ==================================================================== */

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
   * 6 · Rendering
   * ==================================================================== */

  function renderChecklist(result) {
    if (!els.checklist || !els.checklistWrap) return;
    const rows = result.checklist || [];
    els.checklist.textContent = '';
    if (!rows.length) { els.checklistWrap.hidden = true; return; }
    els.checklistWrap.hidden = false;

    for (const row of rows) {
      const item = el('li', 'check check-' + row.status);
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
    const requiredOnly = els.onlyRequired && els.onlyRequired.checked;
    const required = CC.REQUIRED;
    let rows = result.entries || [];
    let filtered = rows.length;

    if (requiredOnly) {
      rows = rows.filter((entry) => required.indexOf(entry.name) !== -1);
      filtered = rows.length;
    }
    if (needle) {
      rows = rows.filter((entry) =>
        entry.name.toLowerCase().includes(needle) ||
        (entry.domain || '').toLowerCase().includes(needle));
      filtered = rows.length;
    }
    // Required cookies first — in the same order as the generated header —
    // then everything else alphabetically. Deterministic and easy to scan.
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
    const selectedNames = state.result ? Object.keys(state.result.selected || {}) : [];
    const shown = rows.slice(0, Math.min(state.tableLimit, MAX_TABLE_ROWS_HARD));
    state.shownRows = shown; // index base for the per-cell reveal

    els.tableBody.textContent = '';
    const fragment = document.createDocumentFragment();
    const reveal = Boolean(els.reveal && els.reveal.checked);

    for (const entry of shown) {
      const isRequired = CC.REQUIRED.indexOf(entry.name) !== -1;
      const isUsed = selectedNames.indexOf(entry.name) !== -1 &&
        state.result.selected[entry.name] === entry;
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

    if (els.tableNote) {
      if (!filtered) {
        els.tableNote.hidden = false;
        els.tableNote.textContent = 'No cookies match this filter.';
      } else if (shown.length < filtered) {
        els.tableNote.hidden = false;
        els.tableNote.textContent = 'Showing ' + shown.length + ' of ' + filtered +
          ' matching cookies (' + total + ' parsed). ';
        if (state.tableLimit < MAX_TABLE_ROWS_HARD) {
          const more = el('button', 'link-btn', 'Show more');
          more.type = 'button';
          more.id = 'show-more';
          els.tableNote.appendChild(more);
        }
      } else {
        els.tableNote.hidden = rows.length === 0;
        els.tableNote.textContent = rows.length === 0
          ? 'No cookies match this filter.'
          : 'Showing all ' + shown.length + ' cookies.';
      }
    }
  }

  function renderNotes(result) {
    if (!els.notes) return;
    const items = (result.warnings || []).map((text) => ({ kind: 'warn', text }))
      .concat((result.info || []).map((text) => ({ kind: 'info', text })));
    els.notes.textContent = '';
    if (!items.length) { els.notes.hidden = true; return; }
    els.notes.hidden = false;
    for (const item of items) {
      els.notes.appendChild(el('li', 'note note-' + item.kind, item.text));
    }
  }

  function renderReport(result) {
    if (!els.report || !els.reportList) return;
    const malformed = (result.stats && result.stats.malformed) || [];
    const skipped = result.stats ? result.stats.skipped : 0;
    if (!malformed.length) { els.report.hidden = true; return; }
    els.report.hidden = false;
    if (els.reportCount) els.reportCount.textContent = String(skipped);
    els.reportList.textContent = '';
    for (const item of malformed) {
      const where = item.line ? 'Line ' + item.line + ': ' : '';
      const what = item.text ? '“' + item.text + '” — ' : '';
      els.reportList.appendChild(el('li', null, where + what + item.reason));
    }
    if (skipped > malformed.length) {
      els.reportList.appendChild(el('li', 'muted',
        '…and ' + (skipped - malformed.length) + ' more (first ' + malformed.length + ' shown).'));
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
    const bits = [FORMAT_LABELS[result.format] || result.format];
    const stats = result.stats || {};
    bits.push(result.parsed + (result.parsed === 1 ? ' cookie' : ' cookies') + ' parsed');
    if (result.parsed) bits.push('in ' + (state.lastDurationMs || 0) + ' ms');
    if (stats.comments) bits.push(stats.comments + ' comment line(s)');
    if (stats.skipped) bits.push(stats.skipped + ' line(s) skipped');
    if (els.stats) els.stats.textContent = bits.join(' \u00b7 ');

    renderChecklist(result);
    renderNotes(result);
    renderReport(result);

    const hasEntries = Boolean(result.entries && result.entries.length);
    if (els.tableTools) els.tableTools.hidden = !hasEntries;
    if (els.tableWrap) els.tableWrap.hidden = !hasEntries;
    if (hasEntries) renderTable();
    else if (els.tableNote) els.tableNote.hidden = true;

    if (els.outputTools) els.outputTools.hidden = !result.ok;
    if (els.output) {
      els.output.hidden = !result.ok;
      // Never leave a previous payload sitting in a hidden field.
      if (!result.ok) els.output.value = '';
    }
    if (els.resultActions) els.resultActions.hidden = !result.ok;
    if (els.privacyNote) els.privacyNote.hidden = !result.ok;
    if (result.ok) renderOutput();

    const hasFailures = (result.checklist || []).some((row) => row.status !== 'ok');
    if (els.result) els.result.hidden = !result.ok && !hasEntries && !hasFailures;
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

  /* ======================================================================
   * 7 · Actions
   * ==================================================================== */

  function convert(options) {
    const source = els.input ? els.input.value : '';
    if (!source.trim()) {
      if (els.result) els.result.hidden = true;
      showBanner('warn', 'Paste a cookie export, or drop / choose a file first.',
        'No idea where to start? Press “Load sample” to see the flow.');
      return;
    }
    const started = (window.performance && performance.now) ? performance.now() : Date.now();
    let result;
    try {
      result = CC.convert(source, {
        extraCookies: state.prefs.extra ? CC.SUGGESTED_EXTRA : [],
        allowExpired: state.prefs.expired,
        maxChars: MAX_FILE_BYTES,
      });
    } catch (error) {
      if (els.result) els.result.hidden = true;
      showBanner('err', 'Unexpected error: ' + error.message,
        'Please report this with the input shape (never real cookie values).');
      return;
    }
    state.lastDurationMs = Math.max(1, Math.round(((window.performance && performance.now)
      ? performance.now() : Date.now()) - started));
    render(result);
    if (!options || options.scroll !== false) {
      if (els.result && !els.result.hidden) {
        els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function clearAll() {
    if (els.input) els.input.value = '';
    if (els.output) els.output.value = '';
    if (els.file) els.file.value = '';
    if (els.filter) els.filter.value = '';
    if (els.onlyRequired) els.onlyRequired.checked = false;
    state.payload = null;
    state.result = null;
    if (els.result) els.result.hidden = true;
    hideBanner();
    updateInputMeta();
    if (els.input) els.input.focus();
    showToast('Cleared. Cookie values are gone from the page.', 'info');
  }

  function loadSample() {
    const expires = '1893456000'; // 2030-01-01
    const rows = [
      '# Netscape HTTP Cookie File',
      '# Sample export — replace every value with your own.',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + expires + '\tSID\tSAMPLE-sid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tFALSE\t' + expires + '\tHSID\tSAMPLE-hsid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + expires + '\tSSID\tSAMPLE-ssid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + expires + '\tAPISID\tSAMPLE-apisid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + expires + '\tSAPISID\tSAMPLE-sapisid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + expires + '\t__Secure-1PSID\tSAMPLE-1psid-replace-me',
      '.gemini.google.com\tTRUE\t/\tTRUE\t' + expires + '\tNID\tSAMPLE-extra-cookie-ignored',
      '',
    ];
    if (els.input) els.input.value = rows.join('\n');
    if (els.file) els.file.value = '';
    updateInputMeta();
    convert({ scroll: false });
    showToast('Sample loaded — replace the values with your real export.', 'info');
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
        convert({ scroll: false });
        showToast('Loaded “' + file.name + '” — converted automatically.', 'ok');
      } else {
        showToast('Loaded “' + file.name + '” — press Convert.', 'ok');
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
    showToast(ok ? 'JSON copied to clipboard.' : 'Copy failed — select the JSON and press Ctrl+C.',
      ok ? 'ok' : 'err');
  }

  function copyOutput() {
    if (!els.output || !els.output.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(els.output.value)
        .then(() => showToast('JSON copied to clipboard.', 'ok'))
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
    showToast('Downloading cookie.json — keep it private, delete it after use.', 'ok');
  }

  function downloadTxt() {
    if (!state.payload || !state.payload.cookie) return;
    // gemini-web2api also accepts a plain one-line cookie file (`--cookie-file cookie.txt`).
    download('cookie.txt', state.payload.cookie + '\n', 'text/plain');
    showToast('Downloading cookie.txt — keep it private, delete it after use.', 'ok');
  }

  /* ======================================================================
   * 8 · Live input metadata
   * ==================================================================== */

  function setDetectBadge(format) {
    if (!els.detectBadge) return;
    els.detectBadge.dataset.format = format;
    els.detectBadge.textContent = format === 'empty'
      ? FORMAT_LABELS.empty
      : 'Detected: ' + (FORMAT_LABELS[format] || format);
  }

  function updateInputMeta() {
    const value = els.input ? els.input.value : '';
    if (els.charCount) {
      els.charCount.textContent = formatBytes(value.length) + ' / ' + formatBytes(MAX_FILE_BYTES);
    }
    setDetectBadge(value.trim() ? CC.detectFormat(value) : 'empty');
    if (els.convert) els.convert.disabled = !value.trim();
    if (state.result) setStale(true);
  }

  let metaTimer = 0;
  function scheduleInputMeta() {
    window.clearTimeout(metaTimer);
    metaTimer = window.setTimeout(updateInputMeta, 150);
  }

  /* ======================================================================
   * 9 · Theme (system-aware, remembered)
   * ==================================================================== */

  const THEME_KEY = 'gcc-theme';

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
    if (els.themeToggle) {
      els.themeToggle.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
      els.themeToggle.setAttribute('aria-label', els.themeToggle.title);
    }
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
    if (els.themeToggle) {
      els.themeToggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (e) { /* storage unavailable */ }
      });
    }
  }

  /* ======================================================================
   * 10 · Output format toggle
   * ==================================================================== */

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
   * 11 · Wiring
   * ==================================================================== */

  function on(id, event, handler) {
    const node = els[id];
    if (node) node.addEventListener(event, handler);
  }

  function init() {
    loadPrefs();
    if (els.optExtra) els.optExtra.checked = state.prefs.extra;
    if (els.optExpired) els.optExpired.checked = state.prefs.expired;
    if (els.version) els.version.textContent = 'v' + CC.VERSION;

    initTheme();
    updateInputMeta();

    /* — primary actions — */
    on('convert', 'click', () => convert());
    on('sample', 'click', loadSample);
    on('clear', 'click', clearAll);
    on('copy', 'click', copyOutput);
    on('downloadJson', 'click', downloadJson);
    on('downloadTxt', 'click', downloadTxt);
    on('fmtPretty', 'click', () => setPretty(true));
    on('fmtMin', 'click', () => setPretty(false));

    /* — options that change the result — */
    on('optExtra', 'change', (event) => {
      state.prefs.extra = event.target.checked;
      savePrefs();
      if (els.input && els.input.value.trim()) convert();
    });
    on('optExpired', 'change', (event) => {
      state.prefs.expired = event.target.checked;
      savePrefs();
      if (els.input && els.input.value.trim()) convert();
    });

    /* — table controls — */
    on('reveal', 'change', renderTable);
    on('onlyRequired', 'change', () => { state.tableLimit = MAX_TABLE_ROWS; renderTable(); });
    on('filter', 'input', () => { state.tableLimit = MAX_TABLE_ROWS; renderTable(); });
    if (els.tableBody) {
      els.tableBody.addEventListener('click', (event) => {
        const cell = event.target.closest ? event.target.closest('td.value') : null;
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
    if (els.tableNote) {
      els.tableNote.addEventListener('click', (event) => {
        if (event.target && event.target.id === 'show-more') {
          state.tableLimit = Math.min(state.tableLimit + MAX_TABLE_ROWS, MAX_TABLE_ROWS_HARD);
          renderTable();
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
      } else if (event.key === 'Escape' && els.toasts) {
        Array.from(els.toasts.children).forEach(dismissToast);
      }
    });

    /* — top bar gains material as content scrolls beneath it — */
    const onScroll = () => {
      if (els.topbar) els.topbar.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ======================================================================
   * 12 · Offline support (optional: skipped on file:// and unsupported browsers)
   * ==================================================================== */

  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
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
