/**
 * Test suite for assets/converter.js — runs on Node's built-in test runner
 * with zero dependencies:  `npm test`  (or `node --test tests/`).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/converter.js');

const NOW = 2_000_000_000; // fixed clock (seconds)
const FUTURE = NOW + 86_400 * 30;
const PAST = NOW - 3_600;

const netscape = (rows) =>
  '# Netscape HTTP Cookie File\n' +
  rows.map((r) => r.join('\t')).join('\n') +
  '\n';

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

/* ------------------------------------------------------------------ */

test('parses a complete Netscape export and builds the payload', () => {
  const result = C.convert(netscape(fullSet()), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'netscape');
  assert.equal(result.payload.sapisid, 'sapisid-value');
  assert.equal(
    result.payload.cookie,
    'SID=sid-value; HSID=hsid-value; SSID=ssid-value; APISID=apisid-value; ' +
      'SAPISID=sapisid-value; __Secure-1PSID=1psid-value'
  );
});

test('reads #HttpOnly_-prefixed lines (critical: SID family is HttpOnly)', () => {
  const text =
    '# Netscape HTTP Cookie File\n' +
    fullSet()
      .map((r) => '#HttpOnly_' + r.join('\t'))
      .join('\n') +
    '\n';
  const result = C.convert(text, { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.payload.sapisid, 'sapisid-value');
  assert.ok(result.entries.every((e) => e.httpOnly === true));
});

test('plain comment lines are skipped, #HttpOnly_ lines are not', () => {
  const line = C.parseNetscapeLine('# just a comment');
  assert.equal(line, null);
  const entry = C.parseNetscapeLine('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tA\tB');
  assert.deepEqual(
    { domain: entry.domain, name: entry.name, value: entry.value, httpOnly: entry.httpOnly },
    { domain: '.example.com', name: 'A', value: 'B', httpOnly: true }
  );
});

test('whitespace-separated fallback keeps values intact', () => {
  const line = '.gemini.google.com TRUE / TRUE ' + FUTURE + ' SID abc def';
  const entry = C.parseNetscapeLine(line);
  assert.equal(entry.name, 'SID');
  assert.equal(entry.value, 'abc def'); // rejoined with spaces, not tabs
});

test('values containing tabs survive the round trip', () => {
  const entry = C.parseNetscapeLine('.g.com\tTRUE\t/\tTRUE\t0\tSID\ta\tb');
  assert.equal(entry.value, 'a\tb');
});

test('malformed and short lines are skipped, not fatal', () => {
  const text = 'garbage\nshort\tline\n' + netscape(fullSet());
  const result = C.convert(text, { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.ok(result.skipped >= 2);
});

test('missing required cookies are reported by name', () => {
  const rows = fullSet();
  rows.splice(0, 1); // drop SID
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['SID']);
  assert.match(result.error, /Missing required cookies: SID/);
});

test('expired required cookies are rejected with a clear error', () => {
  const rows = fullSet();
  rows[5][4] = String(PAST); // expire __Secure-1PSID
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.deepEqual(result.expiredOnly, ['__Secure-1PSID']);
  assert.match(result.error, /Expired required cookies: __Secure-1PSID/);
});

test('session cookies (expiry 0) are accepted', () => {
  const rows = fullSet();
  rows[0][4] = '0';
  const result = C.convert(netscape(rows), { nowSec: NOW });
  assert.equal(result.ok, true);
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
});

test('CRLF line endings are handled', () => {
  const text = netscape(fullSet()).replace(/\n/g, '\r\n');
  const result = C.convert(text, { nowSec: NOW });
  assert.equal(result.ok, true);
});

test('parses a Cookie-Editor style JSON array export', () => {
  const data = fullSet().map(([domain, , path, secure, expires, name, value]) => ({
    domain, path, secure: secure === 'TRUE',
    expirationDate: Number(expires), name, value, httpOnly: true,
  }));
  const result = C.convert(JSON.stringify(data), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'json');
  assert.equal(result.payload.sapisid, 'sapisid-value');
});

test('parses a plain JSON name/value map', () => {
  const map = Object.fromEntries(fullSet().map(([domain, , , , , name, value]) => [name, value]));
  const result = C.convert(JSON.stringify(map), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'json');
});

test('passes through already-converted gemini-web2api JSON', () => {
  const payload = { cookie: 'SID=x; SAPISID=y', sapisid: 'y' };
  const result = C.convert(JSON.stringify(payload), { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.passthrough, true);
  assert.deepEqual(result.payload, payload);
});

test('invalid JSON produces a friendly error', () => {
  assert.throws(() => C.parseJsonExport('{"broken": '), /could not be parsed/);
});

test('parses a raw Cookie header string', () => {
  const header = fullSet().map(([d, , , , , name, value]) => `${name}=${value}`).join('; ');
  const result = C.convert(header, { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.format, 'header');
});

test('detectFormat classifies the four shapes', () => {
  assert.equal(C.detectFormat(''), 'empty');
  assert.equal(C.detectFormat('  [{ "name": "SID" }] '), 'json');
  assert.equal(C.detectFormat('SID=a; HSID=b'), 'header');
  assert.equal(C.detectFormat('# Netscape HTTP Cookie File\n.g.com\tTRUE\t/\tTRUE\t0\tSID\ta'), 'netscape');
});

test('buildPayload throws structured errors', () => {
  assert.throws(
    () => C.buildPayload({}),
    (err) => err.missing.length === C.REQUIRED.length && /Missing required cookies/.test(err.message)
  );
});

test('convert on empty input reports everything missing, not a crash', () => {
  const result = C.convert('', { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, C.REQUIRED.length);
});

test('mutating the exposed REQUIRED list cannot change converter behaviour', () => {
  C.REQUIRED.push('HACK');
  const result = C.convert('HACK=evil', { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.ok(!result.missing.includes('HACK'));
  assert.deepEqual(result.missing, ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID']);
});
