/**
 * UI integration tests for `assets/app.js`.
 *
 * No test dependencies: the app runs inside the mini-DOM in
 * `tests/helpers/dom-stub.js`, which reads element ids from `index.html`.
 * These tests therefore fail if the markup, the wiring and the engine ever
 * drift apart — the exact class of bug a static app usually ships with.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealm, makeFile } = require('./helpers/dom-stub.js');

// The app always converts against the real clock, so expiry fixtures must be
// relative to "now" rather than a frozen epoch.
const NOW = Math.floor(Date.now() / 1000);
const FUTURE = NOW + 86_400 * 30;
const PAST = NOW - 3_600;

const netscape = (names) => names.map((name) =>
  `#HttpOnly_.gemini.google.com\tTRUE\t/\tTRUE\t${FUTURE}\t${name}\t${name.toLowerCase()}-value`
).join('\n');

const FULL = netscape(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID']);

/** Boot the app in a fresh realm with optional hooks. */
function boot(options) {
  return createRealm(options);
}

/* ------------------------------------------------------------------ */

test('app boots and exposes the engine version in the footer', () => {
  const realm = boot();
  const version = realm.document.getElementById('version');
  assert.equal(version.textContent, 'v' + realm.engine.VERSION);
});

test('the engine is discovered from index.html ids — no wiring gaps', () => {
  const realm = boot();
  const status = realm.document.getElementById('status');
  // The boot guard only writes to #status when the engine is missing.
  assert.equal(status.hidden, false); // hidden=true only after a convert call
  assert.equal(realm.engine.REQUIRED.length, 6);
});

/* ------------------------------------------------------------------ *
 * Conversion flow
 * ------------------------------------------------------------------ */

test('Convert renders success, checklist, table, output and notes', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;

  document.getElementById('convert').click();

  const status = document.getElementById('status');
  assert.match(status.textContent, /Success — all 6 required cookies found/);
  assert.equal(status.className, 'banner banner-ok');

  const checklist = document.getElementById('checklist');
  assert.equal(checklist.children.length, 6);
  assert.ok(checklist.children.every((item) => item.classList.contains('check-ok')));

  const tbody = document.querySelector('#cookie-table tbody');
  assert.equal(tbody.children.length, 6);

  const output = document.getElementById('output');
  assert.equal(output.hidden, false);
  const payload = JSON.parse(output.value);
  assert.equal(payload.sapisid, 'sapisid-value');
  assert.match(payload.cookie, /^SID=sid-value; HSID=/);
  assert.equal(document.getElementById('result-actions').hidden, false);
  assert.equal(document.getElementById('privacy-note').hidden, false);
});

test('a failing conversion shows the error, hint and a missing checklist row', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = netscape(['SID', 'HSID']);
  document.getElementById('convert').click();

  const status = document.getElementById('status');
  assert.equal(status.className, 'banner banner-err');
  assert.match(status.textContent, /Missing required cookies: SSID, APISID, SAPISID, __Secure-1PSID/);
  assert.match(status.textContent, /docs\/exporting-cookies\.md/);

  const checklist = document.getElementById('checklist');
  const missing = checklist.children.filter((item) => item.classList.contains('check-missing'));
  assert.equal(missing.length, 4);
  assert.equal(document.getElementById('result').hidden, false); // still useful feedback
  assert.equal(document.getElementById('output').hidden, true);
});

test('empty input is refused without touching the result card', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('result').hidden = false; // pretend a previous run existed
  document.getElementById('convert').click();
  assert.match(document.getElementById('status').textContent, /Paste a cookie export/);
  assert.equal(document.getElementById('status').className, 'banner banner-warn');
  assert.equal(document.getElementById('result').hidden, true);
});

test('values are masked until "Show values" is enabled', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();

  const tbody = document.querySelector('#cookie-table tbody');
  const firstCell = () => tbody.children[0].children[4];
  assert.match(firstCell().textContent, /•/);
  assert.ok(!firstCell().textContent.includes('sid-value'));

  const reveal = document.getElementById('reveal');
  reveal.checked = true;
  reveal.dispatchEvent({ type: 'change', target: reveal });
  assert.equal(tbody.children[0].children[4].textContent, 'sid-value');
});

test('clicking a masked value reveals just that cell', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();

  const tbody = document.querySelector('#cookie-table tbody');
  const cell = tbody.children[0].children[4];
  cell.dispatchEvent({ type: 'click' });
  assert.equal(cell.textContent, 'sid-value');

  cell.dispatchEvent({ type: 'click' });
  assert.match(cell.textContent, /•/);
});

test('per-cell reveal stays correct while a filter is active', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL + '\n' +
    '.gemini.google.com\tTRUE\t/\tTRUE\t' + FUTURE + '\tNID\tignored-value';
  document.getElementById('convert').click();

  const filter = document.getElementById('filter');
  filter.value = 'nid';
  filter.dispatchEvent({ type: 'input' });

  const tbody = document.querySelector('#cookie-table tbody');
  const cell = tbody.children[0].children[4];
  cell.dispatchEvent({ type: 'click' });
  assert.equal(cell.textContent, 'ignored-value');
});

test('the table can be filtered and limited to required cookies', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL + '\n' +
    '.gemini.google.com\tTRUE\t/\tTRUE\t' + FUTURE + '\tNID\textra-value';
  document.getElementById('convert').click();

  const tbody = document.querySelector('#cookie-table tbody');
  assert.equal(tbody.children.length, 7);

  const filter = document.getElementById('filter');
  filter.value = 'nid';
  filter.dispatchEvent({ type: 'input' });
  assert.equal(tbody.children.length, 1);

  filter.value = '';
  filter.dispatchEvent({ type: 'input' });
  const onlyRequired = document.getElementById('only-required');
  onlyRequired.checked = true;
  onlyRequired.dispatchEvent({ type: 'change' });
  assert.equal(tbody.children.length, 6);
});

test('skipped lines are reported with their line numbers', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = 'garbage line\n' + FULL;
  document.getElementById('convert').click();

  const report = document.getElementById('report');
  assert.equal(report.hidden, false);
  assert.equal(document.getElementById('report-count').textContent, '1');
  assert.match(document.getElementById('report-list').textContent, /Line 1/);
  assert.match(document.getElementById('notes').textContent, /Skipped 1 unreadable line/);
});

test('warnings are styled as warnings, info as info', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL + '\n' +
    '.evil.example\tTRUE\t/\tTRUE\t' + FUTURE + '\tSID\tevil';
  document.getElementById('convert').click();

  const notes = document.getElementById('notes');
  const kinds = notes.children.map((item) => item.className);
  assert.ok(kinds.includes('note note-warn'));
  assert.ok(kinds.includes('note note-info'));
  assert.equal(document.getElementById('status').className, 'banner banner-warn');
});

/* ------------------------------------------------------------------ *
 * Input handling
 * ------------------------------------------------------------------ */

test('pasting a small export converts automatically', () => {
  const realm = boot();
  const { document, clock } = realm;
  const input = document.getElementById('input');
  input.value = FULL;
  input.dispatchEvent({ type: 'paste' });
  clock.runDue(0);
  assert.equal(document.getElementById('output').hidden, false);
});

test('typing updates the live format badge and marks the result stale', () => {
  const realm = boot();
  const { document, clock } = realm;
  const input = document.getElementById('input');
  input.value = FULL;
  document.getElementById('convert').click();

  const badge = document.getElementById('detect-badge');
  assert.equal(badge.dataset.format, 'netscape');
  assert.match(badge.textContent, /Netscape/);

  input.value = 'SID=a; HSID=b';
  input.dispatchEvent({ type: 'input' });
  clock.runDue(200);
  assert.equal(badge.dataset.format, 'header');
  assert.equal(document.getElementById('result').classList.contains('is-stale'), true);

  document.getElementById('convert').click();
  assert.equal(document.getElementById('result').classList.contains('is-stale'), false);
});

test('the convert button is disabled until there is input', () => {
  const realm = boot();
  const { document } = realm;
  const convert = document.getElementById('convert');
  assert.equal(convert.disabled, true);
  document.getElementById('input').value = 'SID=x';
  document.getElementById('input').dispatchEvent({ type: 'input' });
  realm.clock.runDue(200);
  assert.equal(convert.disabled, false);
});

test('dropping a file loads and converts it', async () => {
  const realm = boot();
  const { document } = realm;
  const dropzone = document.getElementById('dropzone');
  dropzone.dispatchEvent({
    type: 'drop',
    dataTransfer: { files: [makeFile('cookies.txt', FULL)] },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.getElementById('input').value, FULL);
  assert.equal(document.getElementById('output').hidden, false);
  assert.equal(dropzone.classList.contains('is-loading'), false);
});

test('an oversized file is refused with a helpful message', () => {
  const realm = boot();
  const { document } = realm;
  const big = { name: 'huge.txt', size: 6 * 1024 * 1024, text: () => Promise.resolve('') };
  document.getElementById('dropzone').dispatchEvent({ type: 'drop', dataTransfer: { files: [big] } });
  const status = document.getElementById('status');
  assert.equal(status.className, 'banner banner-err');
  assert.match(status.textContent, /too large/i);
});

test('drag events toggle the dropzone highlight', () => {
  const realm = boot();
  const dropzone = realm.document.getElementById('dropzone');
  dropzone.dispatchEvent({ type: 'dragover' });
  assert.equal(dropzone.classList.contains('drag-over'), true);
  dropzone.dispatchEvent({ type: 'dragleave' });
  assert.equal(dropzone.classList.contains('drag-over'), false);
});

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

test('advanced options are remembered and re-run the conversion', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL + '\n' +
    '.google.com\tTRUE\t/\tTRUE\t' + FUTURE + '\t__Secure-1PSIDTS\tts-value';
  document.getElementById('convert').click();
  assert.ok(!JSON.parse(document.getElementById('output').value).cookie.includes('PSIDTS'));

  const extra = document.getElementById('opt-extra');
  extra.checked = true;
  extra.dispatchEvent({ type: 'change', target: extra });
  const payload = JSON.parse(document.getElementById('output').value);
  assert.ok(payload.cookie.endsWith('__Secure-1PSIDTS=ts-value'));
  assert.deepEqual(payload.extras, ['__Secure-1PSIDTS']);

  // A fresh realm must remember the preference.
  const second = boot({ prefs: { extra: true, expired: false } });
  assert.equal(second.document.getElementById('opt-extra').checked, true);
});

test('allow-expired lets a stale export through with a warning', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = netscape(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID'])
    .replace('TRUE\t' + FUTURE + '\t__Secure-1PSID', 'TRUE\t' + PAST + '\t__Secure-1PSID');
  document.getElementById('convert').click();
  assert.equal(document.getElementById('status').className, 'banner banner-err');
  assert.match(document.getElementById('status').textContent, /Expired required cookies/);

  const allow = document.getElementById('opt-expired');
  allow.checked = true;
  allow.dispatchEvent({ type: 'change', target: allow });
  assert.equal(document.getElementById('output').hidden, false);
  assert.match(document.getElementById('notes').textContent, /allow expired/);
});

/* ------------------------------------------------------------------ *
 * Output actions
 * ------------------------------------------------------------------ */

test('the pretty/minified toggle re-renders the payload', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();

  const output = document.getElementById('output');
  assert.ok(output.value.includes('\n  "cookie"'));

  document.getElementById('fmt-min').click();
  assert.ok(!output.value.includes('\n'));
  assert.equal(document.getElementById('segmented-anchor').dataset.value, 'min');
  assert.equal(document.getElementById('fmt-min').getAttribute('aria-pressed'), 'true');

  document.getElementById('fmt-pretty').click();
  assert.ok(output.value.includes('\n'));
});

test('Copy uses the Clipboard API and falls back to execCommand', async () => {
  const realm = boot({
    navigator: { clipboard: { writeText: (text) => { realmCopied.push(text); return Promise.resolve(); } } },
  });
  const realmCopied = [];
  const { document } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();
  document.getElementById('copy').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(realmCopied.length, 1);
  assert.match(realmCopied[0], /"sapisid"/);

  // No clipboard API at all → legacy path (document.execCommand returns true).
  const legacy = boot({ navigator: {} });
  legacy.document.getElementById('input').value = FULL;
  legacy.document.getElementById('convert').click();
  legacy.document.getElementById('copy').click();
  assert.match(legacy.document.getElementById('toasts').textContent, /copied to clipboard/i);
});

test('downloading writes cookie.json and cookie.txt', () => {
  const realm = boot();
  const { document, window } = realm;
  const downloads = [];
  window.URL.createObjectURL = () => 'blob:stub';

  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();

  const anchorProto = document.createElement('a');
  document.body.appendChild = ((original) => function (node) {
    if (node.tagName === 'A' && node.download) downloads.push({ name: node.download, href: node.href });
    return original.call(this, node);
  })(document.body.appendChild);

  document.getElementById('download-json').click();
  document.getElementById('download-txt').click();
  assert.deepEqual(downloads.map((item) => item.name), ['cookie.json', 'cookie.txt']);
  assert.match(document.getElementById('toasts').textContent, /keep it private/i);
  assert.ok(anchorProto);
});

/* ------------------------------------------------------------------ *
 * Theme, toasts, keyboard, lifecycle
 * ------------------------------------------------------------------ */

test('theme follows the OS, then the explicit choice, and persists', () => {
  const light = boot({ prefersLight: true });
  assert.equal(light.document.documentElement.getAttribute('data-theme'), 'light');
  light.document.getElementById('theme-toggle').click();
  assert.equal(light.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(light.storage.get('gcc-theme'), 'dark');

  const dark = boot();
  assert.equal(dark.document.documentElement.getAttribute('data-theme'), 'dark');
  dark.document.getElementById('theme-toggle').click();
  assert.equal(dark.document.documentElement.getAttribute('data-theme'), 'light');
});

test('a stored theme wins over the OS preference', () => {
  const realm = boot({ prefersLight: true, theme: 'dark' });
  assert.equal(realm.document.documentElement.getAttribute('data-theme'), 'dark');
  const other = boot({ prefersLight: false, theme: 'light' });
  assert.equal(other.document.documentElement.getAttribute('data-theme'), 'light');
});

test('toasts are announced, deduplicated and capped', () => {
  const realm = boot();
  const { document, clock } = realm;
  const toasts = document.getElementById('toasts');
  const sample = document.getElementById('sample');
  const clear = document.getElementById('clear');

  sample.click();
  sample.click();
  clock.runDue(300); // let the duplicate finish its exit animation
  assert.equal(toasts.children.length, 1);
  assert.match(toasts.children[0].dataset.message, /Sample loaded/);

  // Four *distinct* messages in a row: the stack must stay capped at three.
  sample.click(); clear.click(); sample.click(); clear.click();
  clock.runDue(300);
  assert.equal(toasts.children.length, 3);

  // Clicking dismisses immediately (after the exit animation).
  const before = toasts.children.length;
  toasts.children[0].click();
  clock.runDue(300);
  assert.equal(toasts.children.length, before - 1);
});

test('Ctrl+Enter converts and Escape clears the toasts', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;
  realm.fire('keydown', { key: 'Enter', ctrlKey: true });
  assert.equal(document.getElementById('output').hidden, false);

  document.getElementById('sample').click();
  assert.ok(document.getElementById('toasts').children.length > 0);
  realm.fire('keydown', { key: 'Escape' });
  realm.clock.runAll();
  assert.equal(document.getElementById('toasts').children.length, 0);
});

test('Load sample fills the textarea and explains itself', () => {
  const realm = boot();
  const input = realm.document.getElementById('input');
  realm.document.getElementById('sample').click();
  assert.match(input.value, /^# Netscape HTTP Cookie File/);
  assert.match(input.value, /SAMPLE-sid-replace-me/);
  assert.match(realm.document.getElementById('notes').textContent, /placeholder values: SID/);
});

test('Clear wipes every trace of the cookie data', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();
  document.getElementById('clear').click();

  assert.equal(document.getElementById('input').value, '');
  assert.equal(document.getElementById('output').value, '');
  assert.equal(document.getElementById('result').hidden, true);
  assert.equal(document.getElementById('status').hidden, true);
  assert.equal(document.getElementById('filter').value, '');
  assert.match(document.getElementById('toasts').textContent, /Cookie values are gone/);
});

test('no cookie value ever reaches storage', () => {
  const realm = boot();
  const { document, storage } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();
  const dumped = JSON.stringify([...storage.entries()]);
  assert.ok(!dumped.includes('sid-value'));
  assert.ok(!dumped.includes('SAPISID'));
});

test('a missing engine produces a visible error instead of a blank page', () => {
  const { createDocument } = require('./helpers/dom-stub.js');
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const doc = createDocument();

  // Run only app.js, without converter.js, exactly as if the file 404s.
  const sandbox = {
    window: { document: doc, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    document: doc,
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.window.window = sandbox.window;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8'), context);

  const status = doc.getElementById('status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /conversion engine \(assets\/converter\.js\) failed to load/);
});
