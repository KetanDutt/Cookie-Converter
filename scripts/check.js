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

// Ids referenced from markup count as used too: labels, aria-* wiring, the
// `<use href="#…">` lookups that pull symbols out of the icon sprite, and the
// icon names the runtime asks for through UI.icon('name') / icon: 'name'
// literals or lookup tables such as STATUS_ICONS.
const jsBundle = appJs + read('assets/ui.js');
const iconRefs = new Set([
  ...Array.from(jsBundle.matchAll(/\bicon(?:\(|:\s*)'([a-z0-9-]+)'/g), (m) => m[1]),
  ...Array.from(jsBundle.matchAll(/\b[A-Z_]*ICONS\s*=\s*\{([^}]*)\}/g), (m) =>
    Array.from(m[1].matchAll(/'([a-z0-9-]+)'/g), (x) => x[1])).flat(),
]);
const spriteNames = new Set(Array.from(
  html.matchAll(/<symbol id="i-([a-z0-9-]+)"/g), (m) => m[1]));

const referencedIds = new Set(Array.from(
  html.matchAll(/(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g),
  (m) => m[1]
)
  .concat(Array.from(html.matchAll(/(?:xlink:href|href)="#([^"]+)"/g), (m) => m[1]))
  .concat([...iconRefs].map((name) => 'i-' + name))
  .flatMap((value) => value.split(/\s+/)));

const unusedIds = [...htmlIds].filter((id) => !lookedUp.has(id) && !referencedIds.has(id));
if (unusedIds.length) warn('index.html ids never referenced by app.js: ' + unusedIds.join(', '));
else ok('no unused element ids in index.html');

// Both directions of the sprite contract are worth guarding: a typo renders an
// invisible glyph, a stale symbol is dead weight.
const missingIcons = [...iconRefs].filter((name) => !spriteNames.has(name));
if (missingIcons.length) fail('icon(s) requested but missing from the sprite: ' + missingIcons.join(', '));
else ok(`all ${iconRefs.size} runtime icon name(s) exist in the ${spriteNames.size}-symbol sprite`);

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
 * 3 · Browser chrome colours are palette tokens, not free-hand hexes
 * ------------------------------------------------------------------ */

section('Theme colours');

const darkBg = (css.match(/--bg:\s*(#[0-9a-fA-F]{6})/) || [])[1];
const lightBlock = css.match(/\/\* @light-tokens:start \*\/([\s\S]*?)\/\* @light-tokens:end \*\//);
const lightBg = lightBlock && (lightBlock[1].match(/--bg:\s*(#[0-9a-fA-F]{6})/) || [])[1];

function themeColours(source) {
  return Array.from(source.matchAll(/content="(#[0-9a-fA-F]{6})" media="\(prefers-color-scheme: (dark|light)\)"/g))
    .map((m) => ({ hex: m[1].toLowerCase(), scheme: m[2] }));
}

let colourDrift = [];
for (const file of ['index.html', '404.html']) {
  const found = themeColours(read(file));
  if (found.length !== 2) colourDrift.push(`${file} should declare both theme colours`);
  for (const { hex, scheme } of found) {
    const expected = scheme === 'dark' ? darkBg : lightBg;
    if (hex !== expected) colourDrift.push(`${file} ${scheme} theme-color is ${hex}, --bg is ${expected}`);
  }
}
const webmanifest = JSON.parse(read('site.webmanifest'));
if (darkBg && webmanifest.theme_color.toLowerCase() !== darkBg) {
  colourDrift.push(`site.webmanifest theme_color is ${webmanifest.theme_color}, --bg is ${darkBg}`);
}
if (darkBg && webmanifest.background_color.toLowerCase() !== darkBg) {
  colourDrift.push(`site.webmanifest background_color is ${webmanifest.background_color}, --bg is ${darkBg}`);
}

if (colourDrift.length) fail('theme colour drift: ' + colourDrift.join('; '));
else ok(`browser chrome colours match --bg (${darkBg} dark / ${lightBg} light)`);

/* ------------------------------------------------------------------ *
 * 4 · The 404 page is a separate document — guard it the same way
 * ------------------------------------------------------------------ */

section('404 page');

const notFound = read('404.html');
const notFoundClasses = new Set(
  Array.from(notFound.matchAll(/class="([^"]+)"/g), (m) => m[1])
    .flatMap((value) => value.split(/\s+/))
    .filter(Boolean)
);
// Utility classes are declared in the same stylesheet as the app's.
const orphanClasses = [...notFoundClasses].filter((name) => !css.includes('.' + name));
if (orphanClasses.length) {
  fail('404.html uses class(es) with no CSS rule: ' + orphanClasses.join(', '));
} else {
  ok(`all ${notFoundClasses.size} class(es) on the 404 page are styled`);
}

if (/\sstyle="/.test(notFound) || /<script/i.test(notFound)) {
  fail('404.html must stay free of inline styles and scripts (its CSP forbids them)');
} else {
  ok('404.html ships no inline styles or scripts');
}

if (/\.reveal\b/.test(notFound)) {
  fail('404.html cannot use .reveal — it needs JS to become visible');
} else {
  ok('404.html does not depend on scripted reveals');
}

/* ------------------------------------------------------------------ *
 * 5 · Measured contrast — the tokens must clear WCAG AA themselves
 * ------------------------------------------------------------------ */

section('Contrast');

// Parses `#rgb`, `#rrggbb` and `rgb()/rgba()` — the only colour syntaxes the
// tokens use for text and fills.
function parseColour(value) {
  const v = String(value).trim();
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: 1 };
  }
  const fn = v.match(/rgba?\(([^)]+)\)/);
  if (!fn) return null;
  const parts = fn[1].split(',').map((n) => parseFloat(n));
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}

const composite = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function tokenBlock(source, start, end) {
  const tokens = {};
  const slice = start ? source.slice(start, end) : source;
  for (const m of slice.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2];
  return tokens;
}

const darkTokens = tokenBlock(css, css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: light)'));
const lightTokens = tokenBlock(css, css.indexOf('@light-tokens:start'), css.indexOf('@light-tokens:end'));

const READING_SURFACES = ['--bg', '--bg-deep', '--s-1', '--s-2', '--well'];
const ALL_SURFACES = [...READING_SURFACES, '--s-3', '--s-4'];

// Every ink that carries text, and the surfaces it is allowed to land on.
const INK_RULES = [
  ['--text', ALL_SURFACES, 4.5],
  ['--text-strong', ALL_SURFACES, 4.5],
  ['--muted', ALL_SURFACES, 4.5],
  ['--faint', READING_SURFACES, 4.5],   // micro labels — raised fills are never their home
];
// Body ink drawn on the translucent tints the checklist, banners and pills use.
const TINT_SURFACES = ['--accent-soft', '--ok-soft', '--warn-soft', '--err-soft'];
const TINT_INKS = ['--text', '--text-strong', '--muted'];
// Text drawn on a tinted fill of its own colour (badges, banners, pills).
const TINT_RULES = [
  ['--ok', '--ok-soft'],
  ['--warn', '--warn-soft'],
  ['--err', '--err-soft'],
  ['--accent', '--accent-soft'],
  ['--accent-strong', '--accent-soft'],
];

const contrastFailures = [];

for (const [themeName, tokens] of [['dark', darkTokens], ['light', lightTokens]]) {
  if (!tokens['--bg']) continue;
  const pageBg = parseColour(tokens['--bg']).rgb;
  const surfaceValue = (name) => {
    const colour = parseColour(tokens[name]);
    if (!colour) return null;
    return name === '--bg' || name === '--bg-deep' ? colour.rgb : composite(colour, pageBg);
  };

  for (const [ink, surfaces, min] of INK_RULES) {
    const colour = parseColour(tokens[ink]);
    if (!colour) continue;
    for (const surface of surfaces) {
      const bg = surfaceValue(surface);
      if (!bg) continue;
      const ratio = contrast(composite(colour, bg), bg);
      if (ratio < min - 1e-9) {
        contrastFailures.push(`${themeName}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1 (needs ${min})`);
      }
    }
  }

  for (const ink of TINT_INKS) {
    const colour = parseColour(tokens[ink]);
    if (!colour) continue;
    for (const soft of TINT_SURFACES) {
      const softColour = parseColour(tokens[soft]);
      if (!softColour) continue;
      const fill = composite(softColour, pageBg);
      const ratio = contrast(composite(colour, fill), fill);
      if (ratio < 4.5 - 1e-9) {
        contrastFailures.push(`${themeName}: ${ink} on ${soft} is ${ratio.toFixed(2)}:1 (needs 4.5)`);
      }
    }
  }

  for (const [ink, soft] of TINT_RULES) {
    const softColour = parseColour(tokens[soft]);
    const inkColour = parseColour(tokens[ink]);
    if (!softColour || !inkColour) continue;
    const fill = composite(softColour, pageBg);
    const ratio = contrast(composite(inkColour, fill), fill);
    if (ratio < 4.5 - 1e-9) {
      contrastFailures.push(`${themeName}: ${ink} on ${soft} is ${ratio.toFixed(2)}:1 (needs 4.5)`);
    }
  }

  const accent = parseColour(tokens['--accent']);
  const accentInk = parseColour(tokens['--accent-ink']);
  if (accent && accentInk) {
    const fill = composite(accent, pageBg);
    const ratio = contrast(composite(accentInk, fill), fill);
    if (ratio < 4.5 - 1e-9) {
      contrastFailures.push(`${themeName}: --accent-ink on --accent is ${ratio.toFixed(2)}:1 (needs 4.5)`);
    }
  }
}

// `--faint` and `--muted` sit next to each other in the same labels; if they
// converge, the hierarchy is gone even though both pass on their own.
for (const [themeName, tokens] of [['dark', darkTokens], ['light', lightTokens]]) {
  if (!tokens['--faint'] || !tokens['--muted']) continue;
  const bg = parseColour(tokens['--bg']).rgb;
  const faint = contrast(parseColour(tokens['--faint']).rgb, bg);
  const muted = contrast(parseColour(tokens['--muted']).rgb, bg);
  if (muted / faint < 1.25) {
    contrastFailures.push(`${themeName}: --muted and --faint are visually the same (${(muted / faint).toFixed(2)}× apart)`);
  }
}

if (contrastFailures.length) fail('contrast: ' + contrastFailures.join('; '));
else {
  const pairs = INK_RULES.reduce((n, [, surfaces]) => n + surfaces.length, 0)
    + TINT_INKS.length * TINT_SURFACES.length + TINT_RULES.length + 1;
  ok(`${pairs} text/background pair(s) clear WCAG AA in both themes`);
}

/* ------------------------------------------------------------------ *
 * 6 · Motion values come from tokens, never from thin air
 * ------------------------------------------------------------------ */

section('Motion tokens');

const durationViolations = [];
css.split('\n').forEach((line, index) => {
  if (/--t-[a-z0-9-]+\s*:/.test(line)) return;              // a token definition
  if (/^\s*\/?\*/.test(line)) return;                        // comment
  const withoutTokens = line.replace(/var\([^)]*\)/g, 'TOKEN');
  for (const m of withoutTokens.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)) {
    if (m[1] === '0' || m[0] === '0.01ms') continue;         // zeroing out is not a value
    durationViolations.push(`line ${index + 1}: ${m[0]} in "${line.trim()}"`);
  }
});
if (durationViolations.length) {
  fail('raw durations outside the motion tokens: ' + durationViolations.join('; '));
} else {
  ok('every duration comes from a --t-* token');
}

/* ------------------------------------------------------------------ *
 * 7 · Touch targets: coarse pointers get fingertip-sized controls
 * ------------------------------------------------------------------ */

section('Touch targets');

const coarseBlock = (css.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/) || [])[1] || '';
const TOUCH_TARGETS = ['.icon-btn', '.to-top', '.nav-item', '.tab', '.chip-btn', '.bar-btn', '.switch-row'];
// `.btn` (44) and `.segmented button` (40) are deliberate: a segmented control is
// a way to pick between two states, not a primary action.
const TOUCH_FLOOR = 44;

const undersized = [];
for (const selector of TOUCH_TARGETS) {
  const escaped = selector.replace('.', '\\.');
  const rule = coarseBlock.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  const size = rule && (rule[1].match(/(?:min-)?height:\s*(\d+)px/) || [])[1];
  if (!size) undersized.push(`${selector} declares no height`);
  else if (Number(size) < TOUCH_FLOOR) undersized.push(`${selector} is ${size}px`);
}
if (!coarseBlock) undersized.push('the @media (pointer: coarse) block is gone');
if (undersized.length) fail('touch targets too small: ' + undersized.join('; '));
else ok(`${TOUCH_TARGETS.length} control(s) declare ≥ ${TOUCH_FLOOR}px targets for coarse pointers`);

/* ------------------------------------------------------------------ *
 * 8 · Interactive classes carry hover + press feedback
 * ------------------------------------------------------------------ */

section('Interaction states');

const INTERACTIVE = ['.btn', '.icon-btn', '.chip-btn', '.nav-item', '.tab', '.bar-btn',
  '.to-top', '.link-btn', '.segmented button', '.check'];
const missingHover = INTERACTIVE.filter((selector) =>
  !new RegExp(selector.replace('.', '\\.') + '[^{,]*:hover').test(css));
if (missingHover.length) fail('no :hover state for ' + missingHover.join(', '));
else ok(`all ${INTERACTIVE.length} interactive control(s) have a hover state`);

if (!/:focus-visible/.test(css)) fail('the global :focus-visible ring disappeared');
else ok('focus rings are drawn for every focusable element');

/* ------------------------------------------------------------------ *
 * 9 · CSP allows exactly what the app needs
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
 * 10 · No dynamic innerHTML (XSS surface)
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
 * 11 · The duplicated light palette stays identical
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
 * 12 · Everything referenced actually exists
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
 * 13 · Shipped file set & repository hygiene
 * ------------------------------------------------------------------ */

section('Shipped files');

// Exactly what a static host must receive — this list used to live in CI.
const SHIPPED = [
  'index.html', '404.html', 'sw.js', 'site.webmanifest', '_headers', '.nojekyll',
  'assets/app.js', 'assets/converter.js', 'assets/style.css', 'assets/ui.js',
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
 * 14 · License metadata agrees with LICENSE
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
 *119 · Hygiene
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
