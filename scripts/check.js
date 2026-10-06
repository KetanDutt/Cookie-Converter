#!/usr/bin/env node
/**
 * Project consistency checks — `npm run check`.
 * ============================================================================
 * There is no bundler, no linter and no dependency tree in this project, so
 * this script is the guard rail: it verifies the things that would otherwise
 * rot silently — version numbers drifting apart, `app.js` asking for element
 * ids that no longer exist, documentation links pointing at deleted files,
 * a CSP that no longer matches the markup, and the two copies of the light
 * theme palette falling out of sync.
 *
 * Exit code: 0 when clean, 1 when any check fails.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const results = { pass: 0, warn: 0, fail: 0 };

const rel = (file) => path.relative(ROOT, file) || file;

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function ok(message) {
  results.pass++;
  process.stdout.write('  \u2713 ' + message + '\n');
}

function warn(message) {
  results.warn++;
  process.stdout.write('  ! ' + message + '\n');
}

function fail(message) {
  results.fail++;
  process.stdout.write('  \u2717 ' + message + '\n');
}

function section(title) {
  process.stdout.write('\n' + title + '\n');
}

/* ------------------------------------------------------------------ *
 * 1 · Versions stay in lockstep
 * ------------------------------------------------------------------ */

section('Versions');

const pkg = JSON.parse(read('package.json'));
const engineVersion = (read('assets/converter.js').match(/const VERSION = '([^']+)'/) || [])[1];
const swVersion = (read('sw.js').match(/const VERSION = '([^']+)'/) || [])[1];
const changelog = read('docs/changelog.md');
const changelogVersion = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
const footerVersion = (read('index.html').match(/id="version">v([0-9.]+)</) || [])[1];

const versions = {
  'package.json': pkg.version,
  'assets/converter.js': engineVersion,
  'sw.js': swVersion,
  'docs/changelog.md': changelogVersion,
  'index.html (footer)': footerVersion,
};

const distinct = new Set(Object.values(versions));
if (distinct.size === 1 && !distinct.has(undefined)) {
  ok('all versions agree: ' + pkg.version);
} else {
  for (const [file, version] of Object.entries(versions)) {
    if (version !== pkg.version) fail(`${file} is ${version}, package.json is ${pkg.version}`);
  }
}

/* ------------------------------------------------------------------ *
 * 2 · Every element id app.js looks up exists in index.html
 * ------------------------------------------------------------------ */

section('DOM wiring');

const html = read('index.html');
const appJs = read('assets/app.js');
const css = read('assets/style.css');
const htmlIds = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));

const lookedUp = new Set(
  Array.from(appJs.matchAll(/\$\(\s*'([^']+)'\s*\)/g), (m) => m[1])
    .concat(Array.from(appJs.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g), (m) => m[1]))
    .concat(Array.from(appJs.matchAll(/\$q\(\s*'#([A-Za-z0-9_-]+)/g), (m) => m[1]))
    // ids referenced from CSS selectors (hex colors excluded)
    .concat(Array.from(css.matchAll(/#([A-Za-z][A-Za-z0-9_-]*)/g), (m) => m[1])
      .filter((id) => !/^[0-9a-fA-F]{3,8}$/.test(id)))
);

const missingIds = [...lookedUp].filter((id) => !htmlIds.has(id));
if (missingIds.length) fail('app.js references missing element id(s): ' + missingIds.join(', '));
else ok(`${lookedUp.size} element id(s) referenced by app.js all exist`);

// ids referenced from markup (labels, aria-*) count as used too
const ariaIds = new Set(Array.from(
  html.matchAll(/(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g),
  (m) => m[1]
).flatMap((value) => value.split(/\s+/)));

const unusedIds = [...htmlIds].filter((id) => !lookedUp.has(id) && !ariaIds.has(id));
if (unusedIds.length) warn('index.html ids never referenced by app.js: ' + unusedIds.join(', '));
else ok('no unused element ids in index.html');

// Classes toggled from JS must have a matching CSS rule per variant.
const variantFamilies = {
  'banner-': ['ok', 'warn', 'err', 'info'],
  'badge-': ['used', 'warn', 'ok', 'weak', 'expired', 'missing', 'invalid'],
  'check-': ['ok', 'weak', 'expired', 'invalid', 'missing'],
  'note-': ['warn', 'info'],
  'toast-': ['ok', 'info', 'err', 'out'],
};
for (const [prefix, variants] of Object.entries(variantFamilies)) {
  const absent = variants.filter((variant) => !css.includes('.' + prefix + variant));
  if (absent.length) fail(`style.css has no rule for ${absent.map((v) => prefix + v).join(', ')}`);
}
if (!results.fail) ok('every JS-toggled status class has a CSS rule');

/* ------------------------------------------------------------------ *
 * 3 · CSP allows exactly what the app needs
 * ------------------------------------------------------------------ */

section('Content-Security-Policy');

const csp = (html.match(/Content-Security-Policy"\s*\n?\s*content="([^"]+)"/) || [])[1] || '';
const required = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'none'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'"];
const missingDirectives = required.filter((directive) => !csp.includes(directive));
if (!csp) fail('index.html has no Content-Security-Policy meta tag');
else if (missingDirectives.length) fail('CSP is missing: ' + missingDirectives.join('; '));
else if (/'unsafe-inline'|'unsafe-eval'/.test(csp)) fail("CSP contains 'unsafe-inline'/'unsafe-eval'");
else ok('CSP is strict and complete');

// Markup must not contain anything the strict CSP would block.
const inlineStyle = html.match(/\sstyle="/);
const inlineHandler = html.match(/\son[a-z]+\s*=/i);
if (inlineStyle) fail('index.html uses an inline style attribute (blocked by style-src \'self\')');
if (inlineHandler) fail('index.html uses an inline event handler (blocked by CSP)');
if (!inlineStyle && !inlineHandler) ok('no inline styles or event handlers in the markup');

/* ------------------------------------------------------------------ *
 * 4 · No dynamic innerHTML (XSS surface)
 * ------------------------------------------------------------------ */

section('Injection safety');

const innerHtmlAssignments = Array.from(appJs.matchAll(/innerHTML\s*=\s*([^;]+);/g), (m) => m[1].trim());
const dynamic = innerHtmlAssignments.filter((expr) => !/^'[^']*'$/.test(expr));
if (dynamic.length) fail('app.js assigns a non-literal innerHTML: ' + dynamic.join(' | '));
else ok(`innerHTML used ${innerHtmlAssignments.length} time(s), all with static literals`);

const dangerous = ['document.write', 'eval(', 'new Function('];
const found = dangerous.filter((token) => appJs.includes(token) || read('assets/converter.js').includes(token));
if (found.length) fail('dynamic code execution found: ' + found.join(', '));
else ok('no document.write / eval / new Function');

/* ------------------------------------------------------------------ *
 * 5 · The duplicated light palette stays identical
 * ------------------------------------------------------------------ */

section('Theme tokens');

function extractBlock(source, marker) {
  const pattern = new RegExp('/\\* @' + marker + ':start \\*/([\\s\\S]*?)/\\* @' + marker + ':end \\*/', 'g');
  return Array.from(source.matchAll(pattern), (m) => m[1].replace(/\s+/g, ' ').trim());
}

const lightBlocks = extractBlock(css, 'light-tokens');
if (lightBlocks.length !== 2) {
  fail(`expected 2 @light-tokens blocks in style.css, found ${lightBlocks.length}`);
} else if (lightBlocks[0] !== lightBlocks[1]) {
  fail('the two light-theme token blocks have drifted apart');
} else {
  const count = (lightBlocks[0].match(/--[a-z0-9-]+:/g) || []).length;
  ok(`both light-theme blocks agree (${count} tokens each)`);
}

/* ------------------------------------------------------------------ *
 * 6 · Everything referenced actually exists
 * ------------------------------------------------------------------ */

section('File references');

const filesToCheck = new Set();

// local src/href references in the HTML
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const target = m[1];
  if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
  filesToCheck.add(target);
}
// service worker precache list
const precache = (read('sw.js').match(/const PRECACHE = \[([\s\S]*?)\];/) || [])[1] || '';
const precachePaths = Array.from(precache.matchAll(/'([^']+)'/g), (m) => m[1]);
for (const p of precachePaths) {
  if (p === './') continue;
  filesToCheck.add(p.replace(/^\.\//, ''));
}
// manifest icons
const manifest = JSON.parse(read('site.webmanifest'));
for (const icon of manifest.icons) filesToCheck.add(icon.src);

const missingFiles = [...filesToCheck].filter((file) => !exists(file.replace(/^\.\//, '')) && !file.endsWith('/'));
if (missingFiles.length) fail('referenced files do not exist: ' + missingFiles.join(', '));
else ok(`${filesToCheck.size} referenced file(s) exist`);

/* Markdown links (README + docs/) resolve. */
const markdownFiles = ['README.md', ...fs.readdirSync(path.join(ROOT, 'docs'))
  .filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f)];

let brokenLinks = 0;
for (const file of markdownFiles) {
  const source = read(file);
  const dir = path.dirname(file);
  for (const m of source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    const resolved = path.normalize(path.join(dir, clean));
    if (!exists(resolved)) {
      brokenLinks++;
      fail(`${file} links to a missing file: ${target}`);
    }
  }
}
if (!brokenLinks) ok(`${markdownFiles.length} markdown file(s) have no broken local links`);

// every documented format is implemented and vice versa
const documentedFormats = ['netscape', 'json', 'header', 'curl', 'set-cookie'];
const engine = read('assets/converter.js');
const engineFormats = (engine.match(/const FORMATS = Object\.freeze\(\[([^\]]+)\]\)/) || [])[1] || '';
const missingFormats = documentedFormats.filter((f) => !engineFormats.includes("'" + f + "'"));
if (missingFormats.length) fail('FORMATS is missing: ' + missingFormats.join(', '));
else ok('engine FORMATS covers all documented input formats');

/* ------------------------------------------------------------------ *
 * 7 · Shipped file set & repository hygiene
 * ------------------------------------------------------------------ */

section('Shipped files');

// Exactly what a static host must receive — this list used to live in CI.
const SHIPPED = [
  'index.html', '404.html', 'sw.js', 'site.webmanifest', '_headers', '.nojekyll',
  'assets/app.js', 'assets/converter.js', 'assets/style.css',
  'assets/favicon.svg', 'assets/icon-maskable.svg',
  'LICENSE', 'README.md', 'docs/README.md',
];
const absentShipped = SHIPPED.filter((file) => !exists(file));
if (absentShipped.length) fail('missing from the shipped set: ' + absentShipped.join(', '));
else ok(`all ${SHIPPED.length} files a host needs are present`);

// Guard rail that used to live in CI: never let a real export reach the repo.
const EXPORT_NAME_RE = /^(cookie|cookies|cookie\.json|cookies\.json|export[^/]*\.json|storage-state[^/]*\.json)$/i;
let tracked = null;
try {
  tracked = require('node:child_process')
    .execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
} catch (e) {
  warn('git is unavailable — skipped the committed-cookie-export check');
}
if (tracked) {
  const leaks = tracked.filter((file) => {
    const base = file.split('/').pop();
    return EXPORT_NAME_RE.test(base) || /\.cookies$/i.test(base);
  });
  if (leaks.length) {
    fail('cookie exports look committed: ' + leaks.join(', ') +
      ' — remove them, rotate those cookies, and check the history');
  } else {
    ok('no cookie exports tracked by git');
  }
}

/* ------------------------------------------------------------------ *
 * 8 · License metadata agrees with LICENSE
 * ------------------------------------------------------------------ */

section('License');

const licenseText = read('LICENSE');
const declared = pkg.license;
const reserved = /all rights reserved/i.test(licenseText);
if (reserved && declared !== 'UNLICENSED' && declared !== 'SEE LICENSE IN LICENSE') {
  fail(`LICENSE says "All Rights Reserved" but package.json declares "${declared}"`);
} else if (!reserved && declared === 'UNLICENSED') {
  fail('package.json says UNLICENSED but LICENSE does not say "All Rights Reserved"');
} else {
  ok(`package.json (${declared}) matches LICENSE`);
}
if (reserved) {
  const claimsMit = ['README.md', 'index.html', 'CONTRIBUTING.md', 'docs/contributing.md']
    .filter((file) => /MIT licen[sc]ed|\[MIT\]\(/i.test(read(file)));
  if (claimsMit.length) fail('these files still claim an MIT license: ' + claimsMit.join(', '));
  else ok('no stray MIT claims in the docs or the footer');
}

/* ------------------------------------------------------------------ *
 * 9 · Hygiene
 * ------------------------------------------------------------------ */

section('Hygiene');

const sources = ['assets/app.js', 'assets/converter.js', 'sw.js'];
const traceOfDebris = [];
for (const file of sources) {
  const source = read(file);
  if (/console\.log\(/.test(source)) traceOfDebris.push(file + ': console.log');
  if (/\bdebugger\b/.test(source)) traceOfDebris.push(file + ': debugger');
  if (/\bTODO\b|\bFIXME\b|\bXXX\b/.test(source)) traceOfDebris.push(file + ': TODO/FIXME');
}
if (traceOfDebris.length) warn('leftovers: ' + traceOfDebris.join(', '));
else ok('no console.log / debugger / TODO leftovers');

const sizeLimit = 512 * 1024;
for (const file of ['index.html', 'assets/app.js', 'assets/converter.js', 'assets/style.css']) {
  const bytes = fs.statSync(path.join(ROOT, file)).size;
  if (bytes > sizeLimit) fail(`${file} is ${(bytes / 1024).toFixed(0)} KB — keep payloads under 512 KB`);
}
if (!results.fail) ok('all shipped assets are comfortably small');

if (!exists('.gitignore') || !read('.gitignore').includes('*.cookies')) {
  fail('.gitignore must keep cookie exports out of git');
} else {
  ok('.gitignore blocks cookie exports');
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

process.stdout.write('\n' + '-'.repeat(58) + '\n');
process.stdout.write(`check: ${results.pass} passed, ${results.warn} warning(s), ${results.fail} failure(s)\n`);
process.exit(results.fail ? 1 : 0);
