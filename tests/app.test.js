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

test('boots cleanly: engine + UI loaded, no error banner', () => {
  const realm = boot();
  assert.equal(realm.engine.REQUIRED.length, 6);
  assert.equal(typeof realm.ui.toast.show, 'function');
  const status = realm.document.getElementById('status');
  // The boot guard only ever writes to #status when a module failed to load.
  assert.equal(status.textContent, '');
  assert.ok(!status.classList.contains('banner-err'));
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

test('a failed conversion wipes the previous payload from the output field', () => {
  const realm = boot();
  const { document } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();
  assert.match(document.getElementById('output').value, /sapisid/);

  document.getElementById('input').value = 'SID=only-this';
  document.getElementById('convert').click();
  assert.equal(document.getElementById('output').value, '');
  assert.equal(document.getElementById('output').hidden, true);
  assert.equal(document.getElementById('result-actions').hidden, true);
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
  assert.equal(document.querySelector('.segmented').dataset.value, 'min');
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

/* ------------------------------------------------------------------ *
 * Redesign: navigation, popover, dialog, tabs, states
 * ------------------------------------------------------------------ */

test('navigation glides between sections and tracks scroll', () => {
  const realm = boot();
  const { document } = realm;
  const nav = document.querySelector('.nav');

  assert.equal(nav.dataset.active, '0');
  assert.equal(document.getElementById('nav-converter').classList.contains('is-active'), true);
  assert.equal(document.getElementById('nav-converter').getAttribute('aria-current'), 'true');

  document.getElementById('nav-guide').click();
  assert.equal(nav.dataset.active, '1');
  assert.equal(document.getElementById('nav-guide').classList.contains('is-active'), true);
  assert.equal(document.getElementById('nav-converter').hasAttribute('aria-current'), false);
  assert.equal(document.getElementById('guide').scrolledIntoView, true);

  document.getElementById('nav-converter').click();
  assert.equal(nav.dataset.active, '0');
});

test('scroll state drives the header veil, top bar and back-to-top button', () => {
  const realm = boot();
  const { document } = realm;
  const toTop = document.getElementById('to-top');

  assert.equal(document.getElementById('header-veil').classList.contains('is-active'), false);
  assert.equal(toTop.classList.contains('is-visible'), false);

  realm.scrollTo(600);
  assert.equal(document.getElementById('topbar').classList.contains('is-scrolled'), true);
  assert.equal(document.getElementById('header-veil').classList.contains('is-active'), true);
  assert.equal(toTop.classList.contains('is-visible'), true);
  assert.equal(toTop.tabIndex, 0);

  realm.scrollTo(0);
  assert.equal(toTop.classList.contains('is-visible'), false);
  assert.equal(toTop.tabIndex, -1);
});

test('options popover opens, traps nothing, closes on outside click and Escape', () => {
  const realm = boot();
  const { document, clock } = realm;
  const trigger = document.getElementById('options-toggle');
  const panel = document.getElementById('options-panel');

  assert.equal(panel.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  trigger.click();
  assert.equal(panel.hidden, false);
  assert.equal(panel.classList.contains('is-open'), true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  // Escape closes
  realm.fire('keydown', { key: 'Escape' });
  clock.runAll();
  assert.equal(panel.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  // Outside click closes
  trigger.click();
  assert.equal(panel.hidden, false);
  document.body.dispatchEvent({ type: 'click', target: document.body });
  clock.runAll();
  assert.equal(panel.hidden, true);

  // Clicks inside the panel must NOT close it
  trigger.click();
  panel.dispatchEvent({ type: 'click', target: panel });
  assert.equal(panel.hidden, false);
});

test('the mobile bar options button drives the same popover', () => {
  const realm = boot();
  const { document } = realm;
  const bar = document.getElementById('bar-options');
  document.getElementById('bar-options').click();
  assert.equal(document.getElementById('options-panel').hidden, false);
  assert.equal(bar.getAttribute('aria-expanded'), 'true');
  bar.click();
  assert.equal(document.getElementById('options-panel').classList.contains('is-open'), false);
});

test('options: dot indicator, persistence and reset', () => {
  const realm = boot();
  const { document } = realm;
  const dot = document.getElementById('options-dot');
  assert.equal(dot.hidden, true);

  const extra = document.getElementById('opt-extra');
  extra.checked = true;
  extra.dispatchEvent({ type: 'change', target: extra });
  assert.equal(dot.hidden, false);
  assert.equal(JSON.parse(realm.storage.get('gcc-prefs')).extra, true);

  document.getElementById('options-reset').click();
  assert.equal(dot.hidden, true);
  assert.equal(document.getElementById('opt-extra').checked, false);
  assert.equal(JSON.parse(realm.storage.get('gcc-prefs')).extra, false);
});

test('guide dialog opens from the nav, empty state and mobile bar', () => {
  const realm = boot();
  const { document, clock } = realm;
  const dialog = document.getElementById('guide-dialog');
  assert.equal(dialog.open, false);

  document.getElementById('empty-guide').click();
  assert.equal(dialog.open, true);
  assert.ok(!dialog.classList.contains('is-closing'));

  // closes with the animation, then really closes
  document.getElementById('guide-close').click();
  assert.equal(dialog.classList.contains('is-closing'), true);
  clock.runAll();
  assert.equal(dialog.open, false);

  document.getElementById('nav-guide').click();
  assert.equal(dialog.open, true);
  document.getElementById('guide-done').click();
  clock.runAll();
  assert.equal(dialog.open, false);

  document.getElementById('bar-guide').click();
  assert.equal(dialog.open, true);
});

test('guide tabs follow the ARIA pattern and glide', () => {
  const realm = boot();
  const { document } = realm;
  const tabs = document.getElementById('guide-tabs');
  const jsonTab = document.getElementById('tab-json');
  const curlPanel = document.getElementById('panel-curl');
  const jsonPanel = document.getElementById('panel-json');

  assert.equal(tabs.dataset.active, '0');
  assert.equal(document.getElementById('tab-curl').getAttribute('aria-selected'), 'true');
  assert.equal(curlPanel.hidden, false);
  assert.equal(jsonPanel.hidden, true);

  jsonTab.click();
  assert.equal(tabs.dataset.active, '2');
  assert.equal(jsonTab.getAttribute('aria-selected'), 'true');
  assert.equal(jsonTab.tabIndex, 0);
  assert.equal(document.getElementById('tab-curl').tabIndex, -1);
  assert.equal(jsonPanel.hidden, false);
  assert.equal(curlPanel.hidden, true);

  // arrow keys move between tabs, wrapping at the ends
  jsonTab.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(tabs.dataset.active, '3');
  document.getElementById('tab-response').dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(tabs.dataset.active, '0');
  document.getElementById('tab-curl').dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
  assert.equal(tabs.dataset.active, '4');
});

test('empty state hands over to the result and comes back after Clear', () => {
  const realm = boot();
  const { document } = realm;
  const emptyState = document.getElementById('empty-state');
  assert.equal(emptyState.hidden, false);

  document.getElementById('empty-sample').click();
  assert.equal(emptyState.hidden, true);
  assert.equal(document.getElementById('output').hidden, false);

  document.getElementById('clear').click();
  assert.equal(emptyState.hidden, false);
  assert.equal(document.getElementById('result').hidden, true);
});

test('every sample chip loads a format that converts', () => {
  const cases = [
    ['sample-netscape', 'netscape'],
    ['sample-json', 'json'],
    ['sample-header', 'header'],
    ['sample-setcookie', 'set-cookie'],
    ['sample-curl', 'curl'],
  ];
  for (const [id, format] of cases) {
    const realm = boot();
    const { document } = realm;
    document.getElementById(id).click();
    const badge = document.getElementById('detect-badge');
    assert.equal(badge.dataset.format, format, id + ' should detect as ' + format);
    assert.equal(document.getElementById('output').hidden, false, id + ' should convert');
    const payload = JSON.parse(document.getElementById('output').value);
    assert.equal(typeof payload.sapisid, 'string');
    assert.match(payload.cookie, /^SID=SAMPLE-sid-replace-me/);
  }
});

test('the coverage meter reports how many required cookies are usable', () => {
  const realm = boot();
  const { document, clock } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();
  clock.runAll();

  const coverage = document.getElementById('coverage');
  assert.equal(coverage.dataset.progress, '6');
  assert.equal(document.getElementById('coverage-fill').style.getPropertyValue('--progress'), '1');
  assert.equal(document.getElementById('coverage-count').textContent, '6');
  assert.match(coverage.getAttribute('aria-label'), /6 of 6/);

  // a partial export reports the shortfall
  document.getElementById('input').value = netscape(['SID', 'HSID']);
  document.getElementById('convert').click();
  clock.runAll();
  assert.equal(document.getElementById('coverage').dataset.progress, '2');
});

test('large inputs show a skeleton instead of freezing the page', () => {
  const realm = boot();
  const { document, clock } = realm;
  document.getElementById('input').value = 'x'.repeat(200000);
  document.getElementById('convert').click();

  const skeleton = document.getElementById('result-skeleton');
  assert.equal(skeleton.hidden, false, 'skeleton should be visible while parsing');

  clock.runAll();
  assert.equal(skeleton.hidden, true);
  assert.match(document.getElementById('status').className, /banner-err/);
});

test('Clear offers an Undo that restores the previous state', () => {
  const realm = boot();
  const { document, clock } = realm;
  document.getElementById('input').value = FULL;
  document.getElementById('convert').click();
  const payloadBefore = document.getElementById('output').value;

  document.getElementById('clear').click();
  const toasts = document.getElementById('toasts');
  const undo = toasts.children[0].children.filter((node) => node.classList.contains('toast-action'))[0];
  assert.ok(undo, 'the Clear toast should offer an action');
  assert.equal(undo.textContent, 'Undo');

  undo.click();
  clock.runAll();
  assert.equal(document.getElementById('input').value, FULL);
  assert.equal(document.getElementById('output').value, payloadBefore);
  assert.equal(document.getElementById('result').hidden, false);
});

test('the mobile bar convert button mirrors the primary action', () => {
  const realm = boot();
  const { document } = realm;
  const barConvert = document.getElementById('bar-convert');
  assert.equal(barConvert.disabled, true);

  document.getElementById('input').value = FULL;
  document.getElementById('input').dispatchEvent({ type: 'input' });
  realm.clock.runDue(200);
  assert.equal(barConvert.disabled, false);

  barConvert.click();
  assert.equal(document.getElementById('output').hidden, false);
});

test('scroll-reveal is applied to entrance elements', () => {
  const realm = boot();
  const { document } = realm;
  assert.equal(document.querySelector('.input-card').classList.contains('is-visible'), true);
  assert.equal(document.getElementById('empty-state').classList.contains('is-visible'), true);
});

test('icon-only controls all carry an accessible name', () => {
  const realm = boot();
  const { document } = realm;
  const iconButtons = document.querySelectorAll('.icon-btn');
  assert.ok(iconButtons.length >= 3);
  for (const button of iconButtons) {
    const label = button.getAttribute('aria-label');
    assert.ok(label && label.trim().length > 0, 'icon button is missing aria-label');
  }
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    assert.ok(tab.textContent.trim().length > 0, 'tab needs a visible label');
  }
});
