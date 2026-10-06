/**
 * Cookie Converter — core conversion logic.
 *
 * Pure module with NO DOM dependencies so it can run in the browser
 * (as `window.CookieConverter`) and under Node (via `require`) where it
 * is exercised by the test suite in `tests/`.
 *
 * Supported input formats (auto-detected):
 *   1. Netscape / curl cookie file (tab-separated, `#HttpOnly_` aware).
 *   2. Browser-extension JSON export (array of cookie objects).
 *   3. Plain JSON object: name/value map or gemini-web2api passthrough.
 *   4. Raw `Cookie` header string (`SID=...; HSID=...; ...`).
 *
 * Output follows the gemini-web2api structure:
 *   { "cookie": "SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...",
 *     "sapisid": "<SAPISID value>" }
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = api;
  } else {
    root.CookieConverter = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /**
   * Cookies required by gemini-web2api, in the order they are emitted in
   * the generated `cookie` header string (matches the upstream README).
   */
  var REQUIRED = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID'];

  /** Netscape field count: domain, subdomains, path, secure, expiry, name, value. */
  var MIN_FIELDS = 7;

  /** Only exports from these sites can contain usable Gemini cookies. */
  var EXPECTED_DOMAINS = ['gemini.google.com'];

  /**
   * One or more `name=value` pairs separated by `;` on a single line;
   * used to recognise raw Cookie header strings.
   */
  var HEADER_LINE =
    /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+=[^;\r\n]*(?:\s*;\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=[^;\r\n]*)*\s*;?\s*$/;

  /** Line prefix used by curl and many exporters for HttpOnly cookies. */
  var HTTP_ONLY_PREFIX = '#HttpOnly_';

  /* ------------------------------------------------------------------ *
   * Netscape parsing
   * ------------------------------------------------------------------ */

  function splitFields(line) {
    // Netscape files are tab-separated; a few exporters use runs of
    // whitespace instead. Try tabs first, then fall back to whitespace.
    var parts = line.split('\t');
    if (parts.length >= MIN_FIELDS) return { parts: parts, sep: '\t' };
    parts = line.split(/[ \t]+/);
    if (parts.length >= MIN_FIELDS) return { parts: parts, sep: ' ' };
    return null;
  }

  /**
   * Parse a single Netscape cookie line.
   * Returns a cookie entry object, or `null` when the line is a comment,
   * blank, or malformed.
   */
  function parseNetscapeLine(rawLine) {
    var line = rawLine.trim();
    if (line === '') return null;

    var httpOnly = false;
    if (line.charAt(0) === '#') {
      // `#HttpOnly_<domain>` lines are real cookies, not comments.
      if (line.indexOf(HTTP_ONLY_PREFIX) === 0) {
        httpOnly = true;
        line = line.slice(HTTP_ONLY_PREFIX.length);
      } else {
        return null;
      }
    }

    var fields = splitFields(line);
    if (!fields) return null;

    var parts = fields.parts;
    // Rejoin the value with the same separator it was split on so values
    // containing the separator survive the round-trip intact.
    var value = parts.slice(6).join(fields.sep);
    var expiresRaw = parts[4];
    var expires = Number(expiresRaw);

    return {
      domain: parts[0],
      includeSubdomains: /^(true|yes|1)$/i.test(parts[1]),
      path: parts[2],
      secure: /^(true|yes|1)$/i.test(parts[3]),
      expires: Number.isFinite(expires) ? expires : 0,
      name: parts[5],
      value: value,
      httpOnly: httpOnly,
    };
  }

  /**
   * Parse a full Netscape cookie file.
   * @param {string} text raw file content
   * @param {number} [nowSec] current time in seconds (injectable for tests)
   * @returns {{entries: Array, parsed: number, skipped: number}}
   */
  function parseNetscape(text, nowSec) {
    var now = typeof nowSec === 'number' ? nowSec : Date.now() / 1000;
    var lines = String(text).split(/\r\n|\r|\n/);
    var entries = [];
    var parsed = 0;
    var skipped = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === '') continue;
      var entry = parseNetscapeLine(line);
      if (!entry) {
        skipped++;
        continue;
      }
      parsed++;
      entry.expired = entry.expires > 0 && entry.expires <= now;
      entries.push(entry);
    }
    return { entries: entries, parsed: parsed, skipped: skipped };
  }

  /* ------------------------------------------------------------------ *
   * JSON export parsing (browser extensions: Cookie-Editor, EditThisCookie,
   * Chrome DevTools, ...)
   * ------------------------------------------------------------------ */

  function entryFromJsonItem(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('JSON export: item #' + (index + 1) + ' is not an object.');
    }
    var name = item.name != null ? item.name : item.key;
    var value = item.value != null ? item.value : item.val;
    if (typeof name !== 'string' || name === '') {
      throw new Error('JSON export: item #' + (index + 1) + ' is missing a cookie name.');
    }
    if (value == null) value = '';
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error('JSON export: cookie "' + name + '" has a value of unsupported type.');
    }
    var domain = typeof item.domain === 'string' && item.domain !== '' ? item.domain : '';
    var expiresRaw = item.expirationDate != null ? item.expirationDate : item.expires;
    var expires = Number(expiresRaw);

    return {
      domain: domain,
      includeSubdomains: domain.charAt(0) === '.',
      path: typeof item.path === 'string' ? item.path : '/',
      secure: item.secure === true,
      expires: Number.isFinite(expires) ? expires : 0,
      name: name,
      value: String(value),
      httpOnly: item.httpOnly === true,
    };
  }

  /**
   * Parse a JSON export. Accepts:
   *   - an array of cookie objects  → entries
   *   - `{ cookie: "...", sapisid: "..." }` → gemini-web2api passthrough
   *   - any other object            → treated as a name/value map
   */
  function parseJsonExport(text, nowSec) {
    var now = typeof nowSec === 'number' ? nowSec : Date.now() / 1000;
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Input looks like JSON but could not be parsed: ' + e.message);
    }

    if (Array.isArray(data)) {
      var entries = [];
      for (var i = 0; i < data.length; i++) {
        var entry = entryFromJsonItem(data[i], i);
        entry.expired = entry.expires > 0 && entry.expires <= now;
        entries.push(entry);
      }
      return { entries: entries, parsed: entries.length, skipped: 0, format: 'json' };
    }

    if (data && typeof data === 'object') {
      // Passthrough: the caller already produced gemini-web2api JSON.
      if (typeof data.cookie === 'string' && typeof data.sapisid === 'string') {
        return {
          entries: [],
          parsed: 0,
          skipped: 0,
          format: 'json',
          passthrough: { cookie: data.cookie, sapisid: data.sapisid },
        };
      }
      // Plain name/value map.
      var mapEntries = [];
      var keys = Object.keys(data);
      for (var k = 0; k < keys.length; k++) {
        var name = keys[k];
        var value = data[name];
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          continue;
        }
        mapEntries.push({
          domain: '',
          includeSubdomains: false,
          path: '/',
          secure: false,
          expires: 0,
          name: name,
          value: String(value),
          httpOnly: false,
          expired: false,
        });
      }
      return { entries: mapEntries, parsed: mapEntries.length, skipped: 0, format: 'json' };
    }

    throw new Error('Unsupported JSON: expected an array of cookies or an object.');
  }

  /* ------------------------------------------------------------------ *
   * Raw `Cookie` header string
   * ------------------------------------------------------------------ */

  function parseRawHeader(text) {
    var entries = [];
    var pairs = String(text).split(';');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].trim();
      if (!pair) continue;
      var eq = pair.indexOf('=');
      if (eq <= 0) continue;
      entries.push({
        domain: '',
        includeSubdomains: false,
        path: '/',
        secure: false,
        expires: 0,
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        httpOnly: false,
        expired: false,
      });
    }
    return { entries: entries, parsed: entries.length, skipped: 0, format: 'header' };
  }

  /* ------------------------------------------------------------------ *
   * Format detection + selection
   * ------------------------------------------------------------------ */

  /** Classify the input without parsing it fully. */
  function detectFormat(text) {
    var t = String(text).trim();
    if (t === '') return 'empty';
    if (t.charAt(0) === '[' || t.charAt(0) === '{') return 'json';

    var lines = t.split(/\r\n|\r|\n/);
    var hasTabularLine = false;
    var sawLine = false;
    var allHeaderLines = true;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '' || line.charAt(0) === '#') continue;
      sawLine = true;
      if (line.split('\t').length >= MIN_FIELDS) hasTabularLine = true;
      if (!HEADER_LINE.test(line)) allHeaderLines = false;
    }
    if (!sawLine || hasTabularLine) return 'netscape';
    return allHeaderLines ? 'header' : 'netscape';
  }

  /** Auto-detect the input format and parse accordingly. */
  function parseAuto(text, nowSec) {
    var format = detectFormat(text);
    if (format === 'json') return parseJsonExport(text, nowSec);
    if (format === 'header') return parseRawHeader(text);
    var result = parseNetscape(text, nowSec);
    result.format = 'netscape';
    return result;
  }

  /**
   * Domain relevance for gemini.google.com:
   *   3 = gemini.google.com (exact or parent), 2 = google.com, 1 = anything else.
   */
  function domainScore(domain) {
    if (typeof domain !== 'string') return 1;
    var d = domain.replace(/^\./, '').toLowerCase();
    if (d === '') return 1;
    for (var i = 0; i < EXPECTED_DOMAINS.length; i++) {
      var site = EXPECTED_DOMAINS[i];
      if (d === site || d.length > site.length && d.slice(-site.length - 1) === '.' + site) {
        return 3;
      }
    }
    if (d === 'google.com' || d.slice(-11) === '.google.com') return 2;
    return 1;
  }

  /**
   * Pick the best entry for each required cookie.
   *
   * Preference order: highest domain score, then latest expiry, then the
   * last occurrence in the input. Expired entries are never selected, but
   * are reported so the caller can distinguish "expired" from "missing".
   *
   * @returns {{selected: Object, missing: Array, expiredOnly: Array,
   *            warnings: Array, info: Array, foreign: Array}}
   */
  function selectRequired(entries) {
    var byName = Object.create(null);
    var warnings = [];
    var info = [];
    var foreign = [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (REQUIRED.indexOf(e.name) === -1) continue;
      var score = domainScore(e.domain);
      if (score === 1 && e.domain) foreign.push(e.name + ' (' + e.domain + ')');
      if (!byName[e.name]) byName[e.name] = [];
      byName[e.name].push({ entry: e, score: score });
    }

    if (foreign.length > 0) {
      warnings.push(
        'Ignored same-named cookies from unrelated domains: ' + foreign.join(', ') + '.'
      );
    }

    var selected = {};
    var missing = [];
    var expiredOnly = [];

    for (var r = 0; r < REQUIRED.length; r++) {
      var name = REQUIRED[r];
      var candidates = byName[name];
      if (!candidates || candidates.length === 0) {
        missing.push(name);
        continue;
      }
      var valid = [];
      var sawExpired = false;
      for (var c = 0; c < candidates.length; c++) {
        if (candidates[c].entry.expired) {
          sawExpired = true;
        } else {
          valid.push(candidates[c]);
        }
      }
      if (valid.length === 0) {
        expiredOnly.push(name);
        continue;
      }
      if (valid.length > 1 || sawExpired) {
        info.push(
          'Multiple values seen for "' + name + '"; picked the best-scoped, freshest one.'
        );
      }
      valid.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return b.entry.expires - a.entry.expires; // 0 (session) sorts last
      });
      selected[name] = valid[0].entry;
    }

    return {
      selected: selected,
      missing: missing,
      expiredOnly: expiredOnly,
      warnings: warnings,
      info: info,
      foreign: foreign,
    };
  }

  /**
   * Build the gemini-web2api payload from selected entries.
   * @throws {Error} with a human-readable message when cookies are missing
   *                 or only present in expired form.
   */
  function buildPayload(selected, opts) {
    var options = opts || {};
    var missing = [];
    var expiredOnly = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      var name = REQUIRED[i];
      var entry = selected[name];
      if (!entry) missing.push(name);
      else if (entry.expired && !options.allowExpired) expiredOnly.push(name);
    }

    var problems = [];
    if (missing.length > 0) problems.push('Missing required cookies: ' + missing.join(', '));
    if (expiredOnly.length > 0) {
      problems.push('Expired required cookies: ' + expiredOnly.join(', '));
    }
    if (problems.length > 0) {
      var err = new Error(problems.join('. ') + '.');
      err.missing = missing;
      err.expired = expiredOnly;
      throw err;
    }

    var cookie = REQUIRED.map(function (name) {
      return name + '=' + selected[name].value;
    }).join('; ');

    return { cookie: cookie, sapisid: selected.SAPISID.value };
  }

  /**
   * One-call convenience: parse any supported input and produce
   * `{ ok, payload, json, selected, missing, expiredOnly, warnings, info,
   *    parsed, skipped, format, passthrough }`.
   */
  function convert(text, opts) {
    var parsed = parseAuto(text, opts && opts.nowSec);

    if (parsed.passthrough) {
      return {
        ok: true,
        passthrough: true,
        payload: parsed.passthrough,
        json: parsed.passthrough,
        selected: {},
        missing: [],
        expiredOnly: [],
        warnings: ['Input was already in gemini-web2api format; passed through unchanged.'],
        info: [],
        parsed: parsed.parsed,
        skipped: parsed.skipped,
        format: parsed.format,
      };
    }

    var selection = selectRequired(parsed.entries);
    var result = {
      ok: false,
      payload: null,
      json: null,
      selected: selection.selected,
      missing: selection.missing,
      expiredOnly: selection.expiredOnly,
      warnings: selection.warnings,
      info: selection.info,
      parsed: parsed.parsed,
      skipped: parsed.skipped,
      format: parsed.format,
      entries: parsed.entries,
    };

    if (selection.missing.length === 0 && selection.expiredOnly.length === 0) {
      try {
        var payload = buildPayload(selection.selected, opts);
        result.ok = true;
        result.payload = payload;
        result.json = JSON.parse(JSON.stringify(payload));
      } catch (e) {
        result.missing = e.missing || [];
        result.expiredOnly = e.expired || [];
        result.error = e.message;
      }
    } else {
      var parts = [];
      if (selection.missing.length > 0) {
        parts.push('Missing required cookies: ' + selection.missing.join(', '));
      }
      if (selection.expiredOnly.length > 0) {
        parts.push('Expired required cookies: ' + selection.expiredOnly.join(', '));
      }
      result.error = parts.join('. ') + '.';
    }
    return result;
  }

  return {
    REQUIRED: REQUIRED.slice(),
    EXPECTED_DOMAINS: EXPECTED_DOMAINS.slice(),
    parseNetscape: parseNetscape,
    parseNetscapeLine: parseNetscapeLine,
    parseJsonExport: parseJsonExport,
    parseRawHeader: parseRawHeader,
    parseAuto: parseAuto,
    detectFormat: detectFormat,
    domainScore: domainScore,
    selectRequired: selectRequired,
    buildPayload: buildPayload,
    convert: convert,
  };
});
