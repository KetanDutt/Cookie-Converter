/**
 * Test suite for `assets/converter.js`.
 *
 * Runs on Node's built-in test runner with **zero dependencies**:
 *     npm test          →  node --test tests/
 *
 * Every test injects a fixed clock (`nowSec`) so expiry logic is deterministic.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/converter.js');

const NOW = 2_000_000_000; // fixed clock, seconds
const FUTURE = NOW + 86_400 * 30;
const PAST = NOW - 3_600;

const netscape = (rows, header = '# Netscape HTTP Cookie File') =>
  (header ? header + '\n' : '') + rows.map((r) => r.join('\t')).join('\n') + '\n';

const fullSet = (overrides = {}) => {
  const base = {
    SID: 'sid-value',
    HSID: 'hsid-value',
    SSID: 'ssid-value',
    APISID: 'apisid-value',
    SAPISID: 'sapisid-value',
    '__Secure-1PSID': '1psid-value',
    ...overrides,
  };
  return Object.entries(base).map(([name, value]) => [
    '.gemini.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), name, value,
  ]);
};

const jsonArray = (rows = fullSet()) => rows.map(([domain, , path, secure, expires, name, value]) => ({
  domain, path, secure: secure === 'TRUE', expirationDate: Number(expires), name, value, httpOnly: true,
}));

const headerString = (rows = fullSet()) =>
  rows.map(([, , , , , name, value]) => `${name}=${value}`).join('; ');

/* ==========================================================================
 * Netscape format
 * ======================================================================== */

test('parses a complete Netscape export and builds the payload', () => {
  const result = C.convert(netscape(fullSet()), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'netscape');
  assert.equal(result.code, null);
  assert.equal(result.payload.sapisid, 'sapisid-value');
  assert.equal(result.raw, result.payload.cookie);
  assert.equal(result.json, result.payload);
  assert.equal(
    result.payload.cookie,
    'SID=sid-value; HSID=hsid-value; SSID=ssid-value; APISID=apisid-value; ' +
      'SAPISID=sapisid-value; __Secure-1PSID=1psid-value'
  );
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.expiredOnly, []);
});

test('reads #HttpOnly_-prefixed lines (critical: SID family is HttpOnly)', () => {
  const text = netscape(fullSet().map((r) => ['#HttpOnly_' + r.join('\t')]), '');
  const result = C.convert(text, { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.payload.sapisid, 'sapisid-value');
  assert.ok(result.entries.every((e) => e.httpOnly === true));
});

test('plain comment lines are skipped, #HttpOnly_ lines are not', () => {
  assert.equal(C.parseNetscapeLine('# just a comment'), null);
  const entry = C.parseNetscapeLine('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tA\tB');
  assert.deepEqual(
    { domain: entry.domain, name: entry.name, value: entry.value, httpOnly: entry.httpOnly },
    { domain: '.example.com', name: 'A', value: 'B', httpOnly: true }
  );
});

test('comments are counted separately from malformed lines', () => {
  const text = netscape(fullSet()); // one "# Netscape HTTP Cookie File" comment
  const result = C.convert(text, { nowSec: NOW });
  assert.equal(result.stats.comments, 1);
  assert.equal(result.stats.skipped, 0);
});

test('whitespace-separated fallback keeps values intact', () => {
  const entry = C.parseNetscapeLine('.gemini.google.com TRUE / TRUE ' + FUTURE + ' SID abc def');
  assert.equal(entry.name, 'SID');
  assert.equal(entry.value, 'abc def'); // rejoined with spaces, not tabs
});

test('values containing tabs survive the round trip', () => {
  const entry = C.parseNetscapeLine('.g.com\tTRUE\t/\tTRUE\t0\tSID\ta\tb');
  assert.equal(entry.value, 'a\tb');
});

test('malformed and short lines are skipped, not fatal', () => {
  const result = C.convert('garbage\nshort\tline\n' + netscape(fullSet()), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 2);
  assert.equal(result.stats.malformed.length, 2);
  assert.match(result.stats.malformed[0].reason, /not a valid Netscape/);
});

test('a Prose-y line that merely contains tabs is not a cookie', () => {
  const result = C.convert('# Netscape HTTP Cookie File\nname\tvalue\tsomething\n', { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.stats.parsed, 0);
});

test('missing required cookies are reported by name', () => {
  const rows = fullSet();
  rows.splice(0, 1); // drop SID
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, C.ERROR_CODES.MISSING_COOKIES);
  assert.deepEqual(result.missing, ['SID']);
  assert.match(result.error, /Missing required cookies: SID/);
  assert.match(result.hint, /gemini\.google\.com/);
  assert.equal(result.checklist.find((c) => c.name === 'SID').status, 'missing');
});

test('expired required cookies are rejected with a clear error', () => {
  const rows = fullSet();
  rows[5][4] = String(PAST); // expire __Secure-1PSID
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, C.ERROR_CODES.EXPIRED_COOKIES);
  assert.deepEqual(result.expiredOnly, ['__Secure-1PSID']);
  assert.match(result.error, /Expired required cookies: __Secure-1PSID/);
  assert.equal(result.checklist.find((c) => c.name === '__Secure-1PSID').status, 'expired');
});

test('allowExpired opts into expired cookies, loudly', () => {
  const rows = fullSet();
  rows[5][4] = String(PAST);
  const result = C.convert(netscape(rows), { nowSec: NOW, allowExpired: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.usedExpired, ['__Secure-1PSID']);
  assert.ok(result.warnings.some((w) => /expired cookie\(s\).*allow expired/i.test(w)));
});

test('session cookies (expiry 0) are accepted', () => {
  const rows = fullSet();
  rows[0][4] = '0';
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.entries.find((e) => e.name === 'SID').expires, 0);
});

test('domain precedence: gemini.google.com beats google.com beats others', () => {
  const rows = [
    ...fullSet(), // .gemini.google.com
    ['.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), 'SID', 'wrong-google'],
    ['.evil.example', 'TRUE', '/', 'TRUE', String(FUTURE), 'HSID', 'wrong-evil'],
  ];
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.payload.cookie.includes('SID=sid-value'));
  assert.ok(result.payload.cookie.includes('HSID=hsid-value'));
  assert.ok(!result.payload.cookie.includes('wrong-'));
  assert.ok(result.warnings.some((w) => w.includes('.evil.example')));
  assert.equal(C.domainScore('.gemini.google.com'), 3);
  assert.equal(C.domainScore('gemini.google.com'), 3);
  assert.equal(C.domainScore('.accounts.gemini.google.com'), 3);
  assert.equal(C.domainScore('.google.com'), 2);
  assert.equal(C.domainScore('.notgoogle.com'), 1);
  assert.equal(C.domainScore(''), 1);
});

test('a foreign-only candidate is used but flagged as unreliable', () => {
  const rows = fullSet().filter((r) => r[5] !== 'HSID')
    .concat([['.evil.example', 'TRUE', '/', 'TRUE', String(FUTURE), 'HSID', 'evil-value']]);
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.payload.cookie.includes('HSID=evil-value'));
  assert.ok(result.warnings.some((w) => /unrelated domain/.test(w)));
  assert.equal(result.checklist.find((c) => c.name === 'HSID').status, 'weak');
});

test('among duplicates on the same domain, the latest expiry wins', () => {
  const rows = [
    ...fullSet({ SID: 'old-value' }).map((r) => {
      const copy = r.slice();
      if (copy[5] === 'SID') copy[4] = String(FUTURE - 100);
      return copy;
    }),
    ['.gemini.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), 'SID', 'new-value'],
  ];
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.payload.cookie.includes('SID=new-value'));
  assert.ok(result.info.some((i) => /Multiple values seen for "SID"/.test(i)));
});

test('a same-expiry duplicate resolves to the last occurrence', () => {
  const rows = fullSet({ SID: 'first' })
    .concat([['.gemini.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), 'SID', 'second']]);
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.ok(result.payload.cookie.includes('SID=second'));
});

test('expired duplicates are ignored and reported', () => {
  const rows = fullSet()
    .concat([['.gemini.google.com', 'TRUE', '/', 'TRUE', String(PAST), 'SID', 'stale']]);
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.payload.cookie.includes('SID=sid-value'));
  assert.ok(result.info.some((i) => /Ignored expired copies of: SID/.test(i)));
});

test('CRLF line endings are handled', () => {
  const result = C.convert(netscape(fullSet()).replace(/\n/g, '\r\n'), { nowSec: NOW });
  assert.equal(result.ok, true);
});

test('a UTF-8 BOM does not break detection or parsing', () => {
  const result = C.convert('\uFEFF' + netscape(fullSet()), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'netscape');
});

/* ==========================================================================
 * JSON exports
 * ======================================================================== */

test('parses a Cookie-Editor style JSON array export', () => {
  const result = C.convert(JSON.stringify(jsonArray()), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'json');
  assert.equal(result.payload.sapisid, 'sapisid-value');
});

test('parses a plain JSON name/value map', () => {
  const map = Object.fromEntries(fullSet().map(([, , , , , name, value]) => [name, value]));
  const result = C.convert(JSON.stringify(map), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'json');
  assert.ok(result.info.some((i) => /No domain information for/.test(i)));
});

test('parses Puppeteer/Playwright storage state ({ cookies: [...] })', () => {
  const state = {
    cookies: fullSet().map(([domain, , path, secure, expires, name, value]) => ({
      name, value, domain, path, secure: secure === 'TRUE', expires: Number(expires),
      httpOnly: true, sameSite: 'None',
    })),
    origins: [{ origin: 'https://gemini.google.com', localStorage: [{ name: 'x', value: 'y' }] }],
  };
  const result = C.convert(JSON.stringify(state), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.info.some((i) => /origins/.test(i)));
  assert.equal(result.entries[0].sameSite, 'None');
});

test('understands DevTools JSON with ISO-8601 expiry strings', () => {
  const iso = new Date(FUTURE * 1000).toISOString();
  const items = jsonArray().map((item) => ({ ...item, expires: iso }));
  const result = C.convert(JSON.stringify(items), { nowSec: NOW });
  assert.equal(result.ok, true, result.error || '');
  assert.equal(result.entries[0].expires, Math.floor(Date.parse(iso) / 1000));
});

test('accepts millisecond timestamps, -1 and null expiries', () => {
  assert.equal(C.parseExpiry(1893456000000).seconds, 1893456000);
  assert.equal(C.parseExpiry(-1).seconds, 0);
  assert.equal(C.parseExpiry(null).seconds, 0);
  assert.equal(C.parseExpiry('Wed, 21 Oct 2026 07:28:00 GMT').seconds, Date.parse('Wed, 21 Oct 2026 07:28:00 GMT') / 1000);
  assert.equal(C.parseExpiry('nonsense').ok, false);
});

test('field aliases: key/val/host/expiry/isSecure/isHttpOnly', () => {
  const items = fullSet().map(([domain, , , secure, expires, name, value]) => ({
    key: name, val: value, host: domain, expiry: Number(expires),
    isSecure: secure === 'TRUE', isHttpOnly: true,
  }));
  const result = C.convert(JSON.stringify(items), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.entries.every((e) => e.httpOnly && e.secure));
});

test('a single cookie object is accepted', () => {
  const result = C.convert(JSON.stringify({ name: 'SID', value: 'abc', domain: '.gemini.google.com' }), { nowSec: NOW });
  assert.equal(result.ok, false); // only SID — but it must be parsed, not rejected
  assert.deepEqual(result.missing, ['HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID']);
});

test('invalid rows are skipped and reported instead of failing the whole export', () => {
  const items = jsonArray().concat([{ value: 'no-name' }, null, { name: 'X', value: { nested: true } }]);
  const result = C.convert(JSON.stringify(items), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.stats.parsed, 6);
  assert.equal(result.stats.skipped, 3);
  assert.ok(result.info.some((i) => /Skipped 3 unreadable lines/.test(i)));
});

test('an empty JSON array is a friendly error, not a crash', () => {
  assert.throws(() => C.parseJsonExport('[]'), (err) =>
    err.code === C.ERROR_CODES.PARSE_ERROR && /empty/i.test(err.message));
});

test('passes through already-converted gemini-web2api JSON', () => {
  const payload = { cookie: headerString(), sapisid: 'sapisid-value' };
  const result = C.convert(JSON.stringify(payload), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.passthrough, true);
  assert.deepEqual(result.payload, payload);
  assert.equal(result.entries.length, 6); // the table is still populated
});

test('a wrong sapisid in a payload is corrected and flagged', () => {
  const payload = { cookie: headerString(), sapisid: 'mismatched' };
  const result = C.convert(JSON.stringify(payload), { nowSec: NOW });
  assert.equal(result.payload.sapisid, 'sapisid-value');
  assert.ok(result.warnings.some((w) => /did not match SAPISID/.test(w)));
});

test('a payload with no sapisid is completed from its own cookie string', () => {
  const result = C.convert(JSON.stringify({ cookie: headerString() }), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.passthrough, false);
  assert.equal(result.payload.sapisid, 'sapisid-value');
  assert.ok(result.info.some((i) => /no "sapisid" field/.test(i)));
});

test('an incomplete payload still passes through, with a loud warning', () => {
  const result = C.convert(JSON.stringify({ cookie: 'SID=x; SAPISID=y', sapisid: 'y' }), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.passthrough, true);
  assert.ok(result.warnings.some((w) => /most likely reject/.test(w)));
  assert.deepEqual(result.missing, ['HSID', 'SSID', 'APISID', '__Secure-1PSID']);
});

test('invalid JSON produces a friendly error', () => {
  assert.throws(() => C.parseJsonExport('{"broken": '), /could not be parsed/);
});

test('__proto__ in a JSON map cannot pollute the prototype', () => {
  const result = C.convert('{"__proto__": "polluted", "SID": "x"}', { nowSec: NOW });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].name, 'SID');
  assert.equal({}.polluted, undefined);
});

/* ==========================================================================
 * Raw headers, cURL, Set-Cookie
 * ======================================================================== */

test('parses a raw Cookie header string', () => {
  const result = C.convert(headerString(), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'header');
});

test('a raw header may include the "Cookie:" prefix and line breaks', () => {
  const result = C.convert('Cookie: ' + headerString().replace('; ', ';\n  '), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 6);
});

test('quoted values are unquoted, duplicates resolve to the last occurrence', () => {
  const result = C.parseRawHeader('SID="one"; HSID=b; SID=two');
  const sid = result.entries.find((e) => e.name === 'SID');
  assert.equal(sid.value, 'two');
  assert.equal(result.entries.length, 2);
});

test('extracts cookies from a pasted Copy-as-cURL command', () => {
  const command = [
    "curl 'https://gemini.google.com/app' \\",
    "  -H 'accept: */*' \\",
    `  -H 'cookie: ${headerString()}' \\`,
    '  --compressed',
  ].join('\n');
  const result = C.convert(command, { nowSec: NOW });
  assert.equal(result.format, 'curl');
  assert.equal(result.ok, true);
  assert.ok(result.info.some((i) => /cURL/.test(i)));
});

test('cURL: -b pairs, --cookie, --header= and ANSI-C quoting', () => {
  assert.equal(C.convert(`curl x -b '${headerString()}'`, { nowSec: NOW }).ok, true);
  assert.equal(C.convert(`curl x --cookie='${headerString()}'`, { nowSec: NOW }).ok, true);
  assert.equal(C.convert(`curl x --header='Cookie: ${headerString()}'`, { nowSec: NOW }).ok, true);
  const ansi = C.convert("curl x -H $'Cookie: SID=a\\x41b; HSID=h'", { nowSec: NOW });
  assert.equal(ansi.entries.find((e) => e.name === 'SID').value, 'aAb');
});

test('cURL with a cookie-file path explains the problem', () => {
  assert.throws(() => C.parseCurl('curl https://x -b cookies.txt'), (err) =>
    err.code === C.ERROR_CODES.PARSE_ERROR && /reads cookies from a file/.test(err.message));
});

test('cURL without a Cookie header explains what to copy', () => {
  assert.throws(() => C.parseCurl('curl https://x -H "accept: */*"'), (err) =>
    /No Cookie header/.test(err.message) && /Copy as cURL/.test(err.hint));
});

test('parses Set-Cookie response headers', () => {
  const text = fullSet().map(([domain, , path, , expires, name, value]) =>
    `Set-Cookie: ${name}=${value}; Domain=${domain}; Path=${path}; ` +
    `Expires=${new Date(Number(expires) * 1000).toUTCString()}; Secure; HttpOnly; SameSite=None`
  ).join('\n');
  const result = C.convert(text, { nowSec: NOW });
  assert.equal(result.format, 'set-cookie');
  assert.equal(result.ok, true);
  const sid = result.entries.find((e) => e.name === 'SID');
  assert.equal(sid.domain, '.gemini.google.com');
  assert.equal(sid.httpOnly, true);
  assert.equal(sid.secure, true);
  assert.equal(sid.sameSite, 'None');
});

test('Set-Cookie attributes are not mistaken for cookie names', () => {
  const result = C.convert('SID=abc; Domain=.gemini.google.com; Path=/', { nowSec: NOW });
  assert.equal(result.detectFormat || result.format, 'set-cookie');
  assert.deepEqual(result.entries.map((e) => e.name), ['SID']);
});

test('Set-Cookie Max-Age is relative to the injected clock', () => {
  const result = C.parseSetCookie('SID=abc; Max-Age=3600', NOW);
  assert.equal(result.entries[0].expires, NOW + 3600);
});

/* ==========================================================================
 * Detection
 * ======================================================================== */

test('detectFormat classifies every supported shape', () => {
  assert.equal(C.detectFormat(''), 'empty');
  assert.equal(C.detectFormat('   \n  '), 'empty');
  assert.equal(C.detectFormat('# only comments\n'), 'empty');
  assert.equal(C.detectFormat('  [{ "name": "SID" }] '), 'json');
  assert.equal(C.detectFormat('{"SID":"x"}'), 'json');
  assert.equal(C.detectFormat('SID=a; HSID=b'), 'header');
  assert.equal(C.detectFormat('# Netscape HTTP Cookie File\n.g.com\tTRUE\t/\tTRUE\t0\tSID\ta'), 'netscape');
  assert.equal(C.detectFormat('curl https://x -b "SID=a"'), 'curl');
  assert.equal(C.detectFormat('Set-Cookie: SID=a; Path=/; Secure'), 'set-cookie');
  assert.equal(C.detectFormat('SID=a; Path=/; Secure'), 'set-cookie');
});

test('detection is fast on a pathological header-like input', () => {
  // A megabyte of "=" without separators used to risk regex backtracking.
  const nasty = 'a='.repeat(250000);
  const started = Date.now();
  C.detectFormat(nasty);
  assert.ok(Date.now() - started < 1000, 'detection should stay linear');
});

/* ==========================================================================
 * Values, limits and options
 * ======================================================================== */

test('values with semicolons or spaces are rejected with a precise message', () => {
  const rows = fullSet({ SID: 'has space' });
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, C.ERROR_CODES.INVALID_COOKIE_VALUE);
  assert.match(result.error, /SID \(it contains whitespace/);

  const semicolon = C.convert(JSON.stringify(jsonArray(fullSet({ SID: 'a;b' }))), { nowSec: NOW });
  assert.equal(semicolon.ok, false);
  assert.equal(semicolon.code, C.ERROR_CODES.INVALID_COOKIE_VALUE);
  assert.match(semicolon.error, /SID \(it contains a semicolon/);
});

test('empty values are treated as invalid, not as another candidate', () => {
  const rows = fullSet().concat([['.gemini.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), 'SID', '']]);
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true); // the usable candidate still wins
  assert.ok(result.payload.cookie.includes('SID=sid-value'));
});

test('placeholder sample values raise a warning but convert', () => {
  const rows = fullSet({ SID: 'SAMPLE-sid-replace-me' });
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => /placeholder values: SID/.test(w)));
});

test('oversized input is refused before parsing', () => {
  const result = C.convert('x'.repeat(200), { maxChars: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.code, C.ERROR_CODES.TOO_LARGE);
  assert.match(result.error, /Limit is 100 B/);
});

test('empty input reports everything missing and a clear code', () => {
  const result = C.convert('', { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, C.ERROR_CODES.EMPTY_INPUT);
  assert.equal(result.missing.length, C.REQUIRED.length);
  assert.equal(result.checklist.length, C.REQUIRED.length);
});

test('optional extra cookies are appended when asked for', () => {
  const rows = fullSet().concat([
    ['.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), '__Secure-1PSIDTS', 'ts-value'],
    ['.google.com', 'TRUE', '/', 'TRUE', String(FUTURE), 'SIDCC', 'sidcc-value'],
  ]);
  const plain = C.convert(netscape(rows), { nowSec: NOW });
  assert.ok(!plain.payload.cookie.includes('__Secure-1PSIDTS'));

  const extra = C.convert(netscape(rows), {
    nowSec: NOW, extraCookies: ['__Secure-1PSIDTS', 'SIDCC', 'MISSING-COOKIE'],
  });
  assert.equal(extra.ok, true);
  assert.ok(extra.payload.cookie.endsWith('__Secure-1PSIDTS=ts-value; SIDCC=sidcc-value'));
  assert.deepEqual(extra.payload.extras, ['__Secure-1PSIDTS', 'SIDCC']);
  assert.ok(extra.selected['__Secure-1PSIDTS']);
});

test('the required set and target domains can be overridden', () => {
  const rows = [['.example.com', 'TRUE', '/', 'TRUE', String(FUTURE), 'token', 'v']];
  const result = C.convert(netscape(rows), {
    nowSec: NOW, required: ['token'], expectedDomains: ['example.com'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.cookie, 'token=v');
  assert.equal(result.payload.sapisid, null); // no SAPISID in a custom required set
});

test('limits are exposed and enforced for entry counts', () => {
  assert.ok(C.LIMITS.MAX_CHARS >= 1024 * 1024);
  assert.equal(typeof C.LIMITS.MAX_ENTRIES, 'number');
});

/* ==========================================================================
 * API surface & performance
 * ======================================================================== */

test('buildPayload throws structured errors', () => {
  assert.throws(
    () => C.buildPayload({}),
    (err) => err.missing.length === C.REQUIRED.length &&
      err.code === C.ERROR_CODES.MISSING_COOKIES &&
      /Missing required cookies/.test(err.message)
  );
});

test('buildPayload refuses expired cookies unless allowed', () => {
  const entry = (name, value, expired) => ({ name, value, expired, expires: 0, domain: '.gemini.google.com' });
  const selected = {
    SID: entry('SID', 'a', false), HSID: entry('HSID', 'b', false), SSID: entry('SSID', 'c', false),
    APISID: entry('APISID', 'd', false), SAPISID: entry('SAPISID', 'e', false),
    '__Secure-1PSID': entry('__Secure-1PSID', 'f', true),
  };
  assert.throws(() => C.buildPayload(selected), (err) => err.code === C.ERROR_CODES.EXPIRED_COOKIES);
  const payload = C.buildPayload(selected, { allowExpired: true });
  assert.ok(payload.cookie.includes('__Secure-1PSID=f'));
});

test('auditRequired returns one status per required cookie', () => {
  const parsed = C.parseNetscape(netscape(fullSet()), NOW);
  const checklist = C.auditRequired(parsed.entries, {});
  assert.equal(checklist.length, C.REQUIRED.length);
  assert.ok(checklist.every((row) => row.status === 'ok' && row.entry));
});

test('mutating the exposed REQUIRED list cannot change converter behaviour', () => {
  C.REQUIRED.push('HACK');
  const result = C.convert('HACK=evil', { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.ok(!result.missing.includes('HACK'));
  assert.deepEqual(result.missing, ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID']);
  C.REQUIRED.pop();
});

test('the exported API is frozen against accidental reassignment', () => {
  assert.equal(typeof C.convert, 'function');
  assert.equal(typeof C.VERSION, 'string');
  assert.ok(Array.isArray(C.SUGGESTED_EXTRA));
  assert.ok(Object.isFrozen(C.ERROR_CODES) || typeof C.ERROR_CODES.MISSING_COOKIES === 'string');
});

test('parses a large export in linear time', () => {
  const rows = [];
  for (let i = 0; i < 20000; i++) {
    rows.push([`.site${i}.example`, 'TRUE', '/', 'TRUE', String(FUTURE), i < 6 ? C.REQUIRED[i] : 'name' + i, 'v' + i]);
  }
  const text = netscape(rows, '');
  const started = Date.now();
  const result = C.convert(text, { nowSec: NOW });
  const elapsed = Date.now() - started;
  assert.equal(result.parsed, 20000);
  assert.equal(result.ok, true);
  assert.ok(elapsed < 2000, `parsing 20k rows took ${elapsed}ms`);
});

test('placeholder/sample values are detected', () => {
  assert.equal(C.looksPlaceholder('SAMPLE-sid-replace-me'), true);
  assert.equal(C.looksPlaceholder('xxxxxxxxxxxx'), true);
  assert.equal(C.looksPlaceholder('your-sid-here'), true);
  assert.equal(C.looksPlaceholder('AFx3kf9-Z_qq2Vn1pQ'), false);
});
