/**
 * Gemini Cookie Converter — UI layer.
 *
 * Thin glue between the DOM and the pure conversion engine in
 * `converter.js` (exposed as `window.CookieConverter`). No data ever
 * leaves the page: no network requests, no analytics, no storage of
 * cookie values (only the theme preference is persisted).
 */
(function () {
  'use strict';

  var CC = window.CookieConverter;
  if (!CC) return;

  /* ---------------- elements & state ---------------- */

  var fileInput = document.getElementById('file');
  var dropzone = document.getElementById('dropzone');
  var input = document.getElementById('input');
  var statusEl = document.getElementById('status');
  var resultCard = document.getElementById('result');
  var statsEl = document.getElementById('stats');
  var tableSectionTools = resultCard.querySelector('.table-tools');
  var tableWrap = resultCard.querySelector('.table-wrap');
  var tableBody = resultCard.querySelector('#cookie-table tbody');
  var warningsEl = document.getElementById('warnings');
  var revealToggle = document.getElementById('reveal');
  var outputTools = resultCard.querySelector('.output-tools');
  var output = document.getElementById('output');
  var resultActions = resultCard.querySelector('.actions');
  var fmtPretty = document.getElementById('fmt-pretty');
  var fmtMin = document.getElementById('fmt-min');
  var themeToggle = document.getElementById('theme-toggle');
  var topbar = document.getElementById('topbar');
  var toastStack = document.getElementById('toasts');
  var segmented = document.querySelector('.segmented');

  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

  var dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

  var state = {
    payload: null,   // last successful gemini-web2api payload
    entries: [],     // last parsed cookie entries (for the table)
    selected: null,  // name -> entry picked by the converter
    pretty: true,    // output formatting
  };

  /* ---------------- helpers ---------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatLabel(format) {
    if (format === 'json') return 'JSON export';
    if (format === 'header') return 'raw Cookie header';
    return 'Netscape file';
  }

  function formatExpiry(entry) {
    if (!entry.expires) return 'Session';
    var date = new Date(entry.expires * 1000);
    if (entry.expired) return 'Expired \u00b7 ' + dateFormat.format(date);
    var days = Math.ceil((entry.expires * 1000 - Date.now()) / 86400000);
    var rel = days <= 0 ? 'today' : days === 1 ? 'in 1 day' : 'in ' + days + ' days';
    return dateFormat.format(date) + ' (' + rel + ')';
  }

  function showBanner(kind, message) {
    statusEl.hidden = false;
    statusEl.className = 'banner banner-' + kind;
    statusEl.textContent = message;
  }

  function hideBanner() {
    statusEl.hidden = true;
    statusEl.textContent = '';
  }

  /* ---------------- toasts (Layer 6) ---------------- */

  var TOAST_ICONS = {
    ok: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.2 5.1-3.7 4a.6.6 0 0 1-.87.02L4.9 8.4l.86-.84 1.3 1.28 3.25-3.52Z"/></svg>',
    info: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.7 6h1.4v4.4H7.3ZM8 3.4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>',
    err: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm2.5 3.6.9.9L8.9 8l2.5 2.5-.9.9L8 8.9l-2.5 2.5-.9-.9L7.1 8 4.6 5.5l.9-.9L8 7.1Z"/></svg>',
  };

  function dismissToast(toast) {
    if (toast.dataset.leaving) return;
    toast.dataset.leaving = '1';
    toast.classList.add('toast-out');
    setTimeout(function () {
      toast.remove();
    }, 280);
  }

  function showToast(message, kind) {
    if (!toastStack) return;
    var type = kind || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast glass-float toast-' + type;
    toast.setAttribute('role', 'status');
    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
    var msg = document.createElement('span');
    msg.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(msg);
    toast.addEventListener('click', function () {
      dismissToast(toast);
    });
    toastStack.appendChild(toast);
    setTimeout(function () {
      dismissToast(toast);
    }, 3400);
  }

  /* ---------------- rendering ---------------- */

  function renderOutput() {
    if (!state.payload) return;
    output.value = state.pretty
      ? JSON.stringify(state.payload, null, 2)
      : JSON.stringify(state.payload);
  }

  function renderTable() {
    tableBody.textContent = '';
    var fragment = document.createDocumentFragment();
    var selectedNames = state.selected ? Object.keys(state.selected) : [];

    for (var i = 0; i < state.entries.length; i++) {
      var entry = state.entries[i];
      var isRequired = CC.REQUIRED.indexOf(entry.name) !== -1;
      var isSelected = isRequired && state.selected && state.selected[entry.name] === entry;
      var row = el('tr', isRequired ? '' : 'extra');

      var nameCell = el('td', null, entry.name + ' ');
      if (isSelected) {
        var foreign = CC.domainScore(entry.domain) < 3;
        nameCell.appendChild(
          el('span', 'badge ' + (foreign ? 'badge-warn' : 'badge-used'),
            foreign ? 'foreign domain' : 'used')
        );
      } else if (isRequired && entry.expired) {
        nameCell.appendChild(el('span', 'badge badge-warn', 'expired'));
      }

      var flags = el('td');
      if (entry.secure) flags.appendChild(el('span', 'flag', 'Secure'));
      if (entry.httpOnly) flags.appendChild(el('span', 'flag', 'HttpOnly'));
      if (!entry.domain) flags.appendChild(el('span', 'flag', 'no domain'));

      var valueCell = el('td', 'value', revealToggle.checked ? entry.value : MASK);
      valueCell.dataset.index = String(i);

      row.appendChild(nameCell);
      row.appendChild(el('td', null, entry.domain || '\u2014'));
      row.appendChild(el('td', entry.expired ? 'expired-cell' : null, formatExpiry(entry)));
      row.appendChild(flags);
      row.appendChild(valueCell);
      fragment.appendChild(row);
    }
    tableBody.appendChild(fragment);
  }

  function renderNotes(res) {
    var notes = (res.warnings || []).concat(res.info || []);
    warningsEl.textContent = '';
    if (notes.length === 0) {
      warningsEl.hidden = true;
      return;
    }
    warningsEl.hidden = false;
    for (var i = 0; i < notes.length; i++) {
      warningsEl.appendChild(el('li', null, notes[i]));
    }
  }

  function render(res) {
    state.entries = res.entries || [];
    state.selected = res.selected || null;
    state.payload = res.ok ? res.payload : null;

    var found = res.selected ? Object.keys(res.selected).length : 0;
    var bits = [formatLabel(res.format)];
    bits.push(res.parsed + (res.parsed === 1 ? ' cookie' : ' cookies') + ' parsed');
    if (res.format !== 'header') {
      bits.push(found + '/' + CC.REQUIRED.length + ' required found');
    }
    if (res.skipped > 0) bits.push(res.skipped + ' line(s) skipped');
    statsEl.textContent = bits.join(' \u00b7 ');

    var hasTable = state.entries.length > 0;
    tableSectionTools.hidden = !hasTable;
    tableWrap.hidden = !hasTable;
    if (hasTable) renderTable();

    outputTools.hidden = !res.ok;
    output.hidden = !res.ok;
    resultActions.hidden = !res.ok;
    if (res.ok) renderOutput();

    renderNotes(res);
    resultCard.hidden = !res.ok && !hasTable;

    if (res.ok) {
      var msg = res.passthrough
        ? 'Input was already valid gemini-web2api JSON \u2014 passed through unchanged.'
        : 'Success \u2014 all ' + CC.REQUIRED.length + ' required cookies found.';
      showBanner('ok', msg);
    } else {
      var hint = '\nTip: make sure you exported cookies for gemini.google.com while signed in. ' +
        'See docs/troubleshooting.md for common fixes.';
      showBanner('err', (res.error || 'Could not find the required cookies.') + hint);
    }
  }

  /* ---------------- actions ---------------- */

  function convert() {
    var text = input.value;
    if (!text.trim()) {
      resultCard.hidden = true;
      showBanner('warn', 'Paste a cookie export, or drop / choose a file first.');
      return;
    }
    var res;
    try {
      res = CC.convert(text);
    } catch (e) {
      resultCard.hidden = true;
      showBanner('err', 'Error: ' + e.message);
      return;
    }
    render(res);
  }

  function clearAll() {
    input.value = '';
    output.value = '';
    fileInput.value = '';
    state.payload = null;
    state.entries = [];
    state.selected = null;
    resultCard.hidden = true;
    hideBanner();
  }

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showBanner('err', 'File is too large (' + Math.round(file.size / 1048576) + ' MB). Limit is 5 MB.');
      return;
    }
    dropzone.classList.add('is-loading');
    file.text().then(function (text) {
      input.value = text;
      showToast('Loaded \u201c' + file.name + '\u201d \u2014 press Convert.', 'ok');
    }).catch(function () {
      showBanner('err', 'Could not read "' + file.name + '". Is it a text file?');
    }).then(function () {
      dropzone.classList.remove('is-loading');
    });
  }

  function copyOutput() {
    if (!output.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(output.value).then(function () {
        showToast('JSON copied to clipboard.', 'ok');
      }).catch(function () {
        legacyCopy();
      });
    } else {
      legacyCopy();
    }
  }

  function legacyCopy() {
    output.focus();
    output.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    showToast(
      ok ? 'JSON copied to clipboard.' : 'Copy failed \u2014 select the JSON and press Ctrl+C.',
      ok ? 'ok' : 'err'
    );
  }

  function downloadOutput() {
    if (!output.value) return;
    var blob = new Blob([output.value], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cookie.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a moment to start the download before revoking.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    showToast('Downloading cookie.json \u2014 keep it private.', 'ok');
  }

  /* ---------------- sample data ---------------- */

  function loadSample() {
    var exp = '1893456000'; // 2030-01-01
    input.value = [
      '# Netscape HTTP Cookie File',
      '# Sample export \u2014 replace the values with your own.',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + exp + '\tSID\tSAMPLE-sid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tFALSE\t' + exp + '\tHSID\tSAMPLE-hsid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + exp + '\tSSID\tSAMPLE-ssid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + exp + '\tAPISID\tSAMPLE-apisid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + exp + '\tSAPISID\tSAMPLE-sapisid-replace-me',
      '#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t' + exp + '\t__Secure-1PSID\tSAMPLE-1psid-replace-me',
      '.gemini.google.com\tTRUE\t/\tTRUE\t' + exp + '\tNID\tSAMPLE-extra-cookie-ignored',
      '',
    ].join('\n');
    showToast('Sample loaded \u2014 press Convert to see how it works.', 'info');
  }

  /* ---------------- theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  (function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem('gcc-theme');
    } catch (e) { /* storage unavailable */ }
    var prefersLight = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(saved || (prefersLight ? 'light' : 'dark'));
  })();

  /* ---------------- wiring ---------------- */

  document.getElementById('convert').addEventListener('click', convert);
  document.getElementById('clear').addEventListener('click', clearAll);
  document.getElementById('sample').addEventListener('click', loadSample);
  document.getElementById('copy').addEventListener('click', copyOutput);
  document.getElementById('download').addEventListener('click', downloadOutput);

  fmtPretty.addEventListener('click', function () {
    state.pretty = true;
    fmtPretty.classList.add('active');
    fmtMin.classList.remove('active');
    if (segmented) segmented.dataset.value = 'pretty';
    renderOutput();
  });
  fmtMin.addEventListener('click', function () {
    state.pretty = false;
    fmtMin.classList.add('active');
    fmtPretty.classList.remove('active');
    if (segmented) segmented.dataset.value = 'min';
    renderOutput();
  });

  revealToggle.addEventListener('change', renderTable);

  themeToggle.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try {
      localStorage.setItem('gcc-theme', next);
    } catch (e) { /* storage unavailable */ }
  });

  dropzone.addEventListener('click', function () {
    fileInput.click();
  });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', function () {
    loadFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (e) {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) {
      loadFile(e.dataTransfer.files[0]);
    }
  });

  document.addEventListener('paste', function (e) {
    var files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) {
      e.preventDefault();
      loadFile(files[0]);
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      convert();
    }
  });

  /* Top bar gains material as content scrolls beneath it. */
  function onScroll() {
    if (topbar) topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
