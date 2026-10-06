/**
 * Gemini Cookie Converter — pure conversion engine.
 * ============================================================================
 * A dependency-free, DOM-free module that turns *any* common cookie export
 * into the payload expected by
 * [gemini-web2api](https://github.com/Sophomoresty/gemini-web2api):
 *
 *     { "cookie": "SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…",
 *       "sapisid": "…" }
 *
 * It runs in the browser (as the `CookieConverter` global) and in Node
 * (via `require`) where the test-suite exercises it.
 *
 * Supported input formats — every one of them auto-detected:
 *   1. `netscape`   — Netscape / curl cookie jar (`#HttpOnly_` aware).
 *   2. `json`       — extension arrays, DevTools/Puppeteer/Playwright storage
 *                     state, plain name/value maps, partial payloads.
 *   3. `header`     — a raw `Cookie:` request header string.
 *   4. `curl`       — a pasted `curl`/`curl.exe`/`wget` command line.
 *   5. `set-cookie` — `Set-Cookie:` response header lines.
 *
 * Design rules (unchanged from v2, still enforced):
 *   • No dependencies, no build step, no network, no DOM.
 *   • Single-pass, linear-time parsing with hard input caps.
 *   • All time-dependent logic accepts an injectable `nowSec`.
 *   • Errors are specific, actionable and machine-readable (`err.code`).
 *
 * @module CookieConverter
 * @version 2.2.0
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  } else {
    root.CookieConverter = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ==========================================================================
   * 1 · Constants
   * ======================================================================== */

  /** Engine version — kept in sync with package.json (enforced by `npm run check`). */
  const VERSION = '2.2.0';

  /**
   * Cookies required by gemini-web2api, in the exact order they are emitted.
   * Order matters: it mirrors the upstream documentation so the generated
   * header looks identical to what a user would hand-write.
   */
  const REQUIRED = Object.freeze([
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID',
  ]);

  /**
   * Additional Google cookies that exist in most signed-in exports and are
   * useful for long-lived sessions (rotating "1P" cookies). They are *not*
   * required; the UI can opt in to appending them when they are present.
   */
  const SUGGESTED_EXTRA = Object.freeze([
    '__Secure-1PSIDTS', '__Secure-3PSID', '__Secure-1PAPISID', 'SIDCC',
  ]);

  /** Every format `detectFormat()` can return (plus `'empty'`). */
  const FORMATS = Object.freeze(['netscape', 'json', 'header', 'curl', 'set-cookie']);

  /** Machine-readable error codes carried by `ConversionError#code`. */
  const ERROR_CODES = Object.freeze({
    EMPTY_INPUT: 'EMPTY_INPUT',
    TOO_LARGE: 'TOO_LARGE',
    PARSE_ERROR: 'PARSE_ERROR',
    MISSING_COOKIES: 'MISSING_COOKIES',
    EXPIRED_COOKIES: 'EXPIRED_COOKIES',
    INVALID_COOKIE_VALUE: 'INVALID_COOKIE_VALUE',
  });

  /** Domains whose cookies can contain a usable Gemini session. */
  const EXPECTED_DOMAINS = Object.freeze(['gemini.google.com']);

  /** Netscape field count: domain, subdomains, path, secure, expiry, name, value. */
  const MIN_FIELDS = 7;

  /** Hard limits — keep the main thread (and memory) predictable. */
  const LIMITS = Object.freeze({
    /** Maximum accepted input size in characters (5 MiB). */
    MAX_CHARS: 5 * 1024 * 1024,
    /** Maximum number of cookie entries parsed before truncating. */
    MAX_ENTRIES: 200000,
    /** Maximum malformed lines remembered for the report. */
    MAX_REPORTED: 25,
  });

  /** Line prefix used by curl and many exporters for HttpOnly cookies. */
  const HTTP_ONLY_PREFIX = '#HttpOnly_';

  /** Keys never treated as cookie names (prototype-pollution guard). */
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  /** Values that smell like the sample/placeholder text instead of a real cookie. */
  const PLACEHOLDER_RE = /(replace[-_ ]?me|your[-_ ]?(sid|value|cookie)|^sample|x{6,}|^paste[-_ ]|^todo|^placeholder|^changeme|^change[-_ ]me)/i;

  /* ==========================================================================
   * 2 · Errors & small utilities
   * ======================================================================== */

  /**
   * Error thrown (or reported) for every expected failure mode.
   * Carries a stable `code` and structured `details` so callers can render
   * targeted help instead of parsing messages.
   */
  class ConversionError extends Error {
    /**
     * @param {string} code one of ERROR_CODES
     * @param {string} message human-readable, already specific
     * @param {{details?: object, hint?: string}} [extra]
     */
    constructor(code, message, extra) {
      super(message);
      this.name = 'ConversionError';
      this.code = code;
      this.details = (extra && extra.details) || {};
      this.hint = (extra && extra.hint) || null;
      // Back-compat aliases: v2 exposed these on the error object directly.
      if (Array.isArray(this.details.missing)) this.missing = this.details.missing;
      if (Array.isArray(this.details.expired)) this.expired = this.details.expired;
      if (Array.isArray(this.details.invalid)) this.invalid = this.details.invalid;
    }
  }

  /** Current time in whole seconds. */
  function resolveNow(nowSec) {
    return typeof nowSec === 'number' && Number.isFinite(nowSec) ? nowSec : Date.now() / 1000;
  }

  /** Case-insensitive `TRUE`/`yes`/`1` test used by the Netscape format. */
  function isTrue(value) {
    return /^(true|yes|1)$/i.test(String(value).trim());
  }

  /** `true`/`false`-ish field (Netscape flags). */
  function isBoolish(value) {
    return /^(true|false|yes|no|0|1)$/i.test(String(value).trim());
  }

  /** A plausible Netscape expiry field: epoch seconds, `0`, or a date string. */
  function isExpiryish(value) {
    const s = String(value).trim();
    if (s === '') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return true;
    return Number.isFinite(Date.parse(s));
  }

  /**
   * Normalise any expiry representation to **epoch seconds**.
   * Understands epoch seconds, epoch milliseconds, ISO-8601 / cookie dates and
   * `-1`/`0` (session cookie). Unparseable values become `0` (session) and set
   * `ok:false` so callers can surface a note.
   *
   * @param {string|number|null|undefined} raw
   * @returns {{seconds: number, ok: boolean}}
   */
  function parseExpiry(raw) {
    if (raw === null || raw === undefined || raw === '') return { seconds: 0, ok: true };
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw <= 0) return { seconds: 0, ok: true, session: true };
      return { seconds: raw > 1e12 ? Math.round(raw / 1000) : Math.round(raw), ok: true };
    }
    const s = String(raw).trim();
    if (s === '' || s === '0' || s === '-1') return { seconds: 0, ok: true, session: true };
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0) return { seconds: 0, ok: true, session: true };
      return { seconds: n > 1e12 ? Math.round(n / 1000) : Math.round(n), ok: true };
    }
    const ms = Date.parse(s);
    if (Number.isFinite(ms)) return { seconds: Math.floor(ms / 1000), ok: true };
    return { seconds: 0, ok: false };
  }

  /**
   * Remove characters that can never be part of a cookie value (NUL and the
   * control range except TAB/CR/LF, which some exporters use as separators)
   * and trim surrounding whitespace.
   */
  function cleanValue(value) {
    return String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/^[\s]+|[\s]+$/g, '');
  }

  /** Strip one layer of surrounding double quotes from a cookie value. */
  function unquote(value) {
    const s = String(value);
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
      return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    return s;
  }

  /**
   * Why a cookie value cannot be used verbatim in a `Cookie:` header.
   * @returns {string|null} a human-readable reason, or `null` when usable.
   */
  function valueIssue(value) {
    const v = String(value);
    if (v === '') return 'the value is empty';
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) return 'it contains control characters';
    if (v.indexOf(';') !== -1) return 'it contains a semicolon, which would split the cookie header';
    if (/[ \t]/.test(v)) return 'it contains whitespace, which is not valid in a cookie value';
    return null;
  }

  /** `true` when a value looks like sample/placeholder text rather than a real token. */
  function looksPlaceholder(value) {
    const v = String(value);
    return v.length < 80 && PLACEHOLDER_RE.test(v);
  }

  /** Shorten a line for error reporting. */
  function snippet(text, max) {
    const s = String(text).trim();
    const limit = max || 70;
    return s.length > limit ? s.slice(0, limit - 1) + '…' : s;
  }

  /**
   * Relevance of a cookie domain for the target site.
   * `3` = the site itself (or a subdomain), `2` = its parent (`google.com`),
   * `1` = anything else / unknown.
   */
  function domainScore(domain, expectedDomains) {
    if (typeof domain !== 'string') return 1;
    const d = domain.replace(/^\./, '').toLowerCase();
    if (d === '') return 1;
    const sites = expectedDomains && expectedDomains.length ? expectedDomains : EXPECTED_DOMAINS;
    for (let i = 0; i < sites.length; i++) {
      const site = String(sites[i]).replace(/^\./, '').toLowerCase();
      if (d === site) return 3;
      if (d.length > site.length + 1 && d.endsWith('.' + site)) return 3;
    }
    if (d === 'google.com' || d.endsWith('.google.com')) return 2;
    return 1;
  }

  /** Normalise a user-supplied name list, falling back to `fallback`. */
  function normaliseNames(list, fallback) {
    const source = Array.isArray(list) ? list : fallback;
    const out = [];
    for (const item of source || []) {
      const name = String(item).trim();
      if (name && out.indexOf(name) === -1 && !UNSAFE_KEYS.has(name)) out.push(name);
    }
    return out;
  }

  /* ==========================================================================
   * 3 · Format detection
   * ======================================================================== */

  /**
   * Does a line look like a `Cookie:`/`name=value; …` header line?
   * Linear scan instead of a backtracking regex — the old pattern could
   * misbehave on pathological input (megabytes of `=` without separators).
   */
  function looksLikeHeaderLine(line) {
    const text = String(line).trim();
    if (text === '' || text.indexOf('=') === -1) return false;
    const withoutPrefix = text.replace(/^cookie\s*:\s*/i, '');
    const pairs = withoutPrefix.split(';');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i].trim();
      if (pair === '') continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) return false;
      const name = pair.slice(0, eq).trim();
      if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name)) return false;
      if (/[\r\n]/.test(pair)) return false;
    }
    return true;
  }

  /** Does a line look like a Netscape cookie record? */
  function looksLikeNetscapeLine(line) {
    const text = String(line).trim();
    if (text === '') return false;
    const body = text.indexOf(HTTP_ONLY_PREFIX) === 0 ? text.slice(HTTP_ONLY_PREFIX.length) : text;
    let parts = body.split('\t');
    if (parts.length < MIN_FIELDS) parts = body.split(/[ \t]+/);
    if (parts.length < MIN_FIELDS) return false;
    return Boolean(parts[5].trim()) && isBoolish(parts[1]) && isExpiryish(parts[4]);
  }

  /** Attribute keywords that reveal a `Set-Cookie` header rather than a Cookie header. */
  const SET_COOKIE_ATTR_RE = /(?:^|;)\s*(domain|path|expires|max-age|secure|httponly|samesite)\s*(?:=|;|$)/i;

  /** Does the text look like one or more `Set-Cookie:` headers? */
  function looksLikeSetCookie(text) {
    const lines = String(text).split(/\r\n|\r|\n/);
    let sawContent = false;
    let prefixed = 0;
    let attributeStyle = 0;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '' || (line.charAt(0) === '#' && line.indexOf(HTTP_ONLY_PREFIX) !== 0)) continue;
      sawContent = true;
      const body = line.replace(/^set-cookie\s*:\s*/i, '').replace(new RegExp('^' + HTTP_ONLY_PREFIX), '');
      if (/^set-cookie\s*:/i.test(line)) prefixed++;
      if (body.indexOf('=') > 0 && SET_COOKIE_ATTR_RE.test(body)) attributeStyle++;
      else if (!/^set-cookie\s*:/i.test(line)) return false;
    }
    if (!sawContent) return false;
    if (prefixed > 0 && prefixed === countNonEmptyLines(lines)) return true;
    return attributeStyle === countNonEmptyLines(lines);
  }

  function countNonEmptyLines(lines) {
    let n = 0;
    for (const line of lines) {
      const t = line.trim();
      if (t === '') continue;
      if (t.charAt(0) === '#' && t.indexOf(HTTP_ONLY_PREFIX) !== 0) continue;
      n++;
    }
    return n;
  }

  /** Does the text look like a pasted `curl`/`wget` command? */
  function looksLikeCurl(text) {
    const head = String(text).trimStart();
    if (!/^(?:&\s*)?(?:sudo\s+|start\s+)?(?:curl|curl\.exe|wget)\b/i.test(head)) return false;
    return /cookie\s*:/i.test(head) || /(?:^|\s)(?:-b|--cookie|-H|--header)(?:\s|=)/i.test(head);
  }

  /**
   * Classify the input without parsing all of it.
   * @returns {'json'|'header'|'netscape'|'curl'|'set-cookie'|'empty'}
   */
  function detectFormat(text) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') return 'empty';
    const first = t.charAt(0);
    if (first === '[' || first === '{') return 'json';
    if (looksLikeCurl(t)) return 'curl';

    const lines = t.split(/\r\n|\r|\n/);
    let tabular = false;
    let sawContent = false;
    let headerish = 0;
    let contentLines = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '') continue;
      if (line.charAt(0) === '#' && line.indexOf(HTTP_ONLY_PREFIX) !== 0) continue;
      sawContent = true;
      contentLines++;
      if (looksLikeNetscapeLine(line)) tabular = true;
      if (looksLikeHeaderLine(line)) headerish++;
    }

    if (!sawContent) return 'empty';
    if (tabular) return 'netscape';
    if (looksLikeSetCookie(t)) return 'set-cookie';
    if (headerish === contentLines) return 'header';
    return 'netscape';
  }

  /* ==========================================================================
   * 4 · Netscape / curl cookie-jar parsing
   * ======================================================================== */

  /**
   * Split a Netscape record into fields.
   * Tabs first (the spec), then runs of whitespace for lenient exporters.
   * @returns {{parts: string[], sep: string}|null}
   */
  function splitFields(line) {
    let parts = String(line).split('\t');
    if (parts.length >= MIN_FIELDS) return { parts, sep: '\t' };
    parts = String(line).split(/[ \t]+/);
    if (parts.length >= MIN_FIELDS) return { parts, sep: ' ' };
    return null;
  }

  /**
   * Parse one Netscape cookie line.
   * @param {string} rawLine
   * @returns {object|null} entry, or `null` for comments/blank/malformed lines
   */
  function parseNetscapeLine(rawLine) {
    let line = String(rawLine).trim();
    if (line === '' || (line.charAt(0) === '#' && line.indexOf(HTTP_ONLY_PREFIX) !== 0)) return null;

    let httpOnly = false;
    if (line.indexOf(HTTP_ONLY_PREFIX) === 0) {
      httpOnly = true;
      line = line.slice(HTTP_ONLY_PREFIX.length);
    }

    const fields = splitFields(line);
    if (!fields) return null;
    const parts = fields.parts;
    if (!parts[5].trim()) return null;
    if (!isBoolish(parts[1]) && !isBoolish(parts[3])) return null;
    if (!isExpiryish(parts[4])) return null;

    // Re-join the value using the separator it was split on, so values that
    // contain tabs/spaces survive the round trip untouched.
    const expiry = parseExpiry(parts[4]);
    return {
      domain: cleanValue(parts[0]),
      includeSubdomains: isTrue(parts[1]),
      path: cleanValue(parts[2]) || '/',
      secure: isTrue(parts[3]),
      expires: expiry.seconds,
      expiryUnderstood: expiry.ok,
      name: parts[5].trim(),
      value: cleanValue(parts.slice(6).join(fields.sep)),
      httpOnly,
      sameSite: null,
      source: 'netscape',
    };
  }

  /**
   * Parse a whole Netscape / curl cookie file.
   * @param {string} text
   * @param {number} [nowSec] injectable clock
   */
  function parseNetscape(text, nowSec) {
    const now = resolveNow(nowSec);
    const lines = String(text).split(/\r\n|\r|\n/);
    const entries = [];
    const malformed = [];
    let parsed = 0;
    let comments = 0;
    let truncated = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (trimmed === '') continue;
      if (trimmed.charAt(0) === '#' && trimmed.indexOf(HTTP_ONLY_PREFIX) !== 0) {
        comments++;
        continue;
      }
      const entry = parseNetscapeLine(raw);
      if (!entry) {
        if (malformed.length < LIMITS.MAX_REPORTED) {
          malformed.push({ line: i + 1, text: snippet(raw), reason: 'not a valid Netscape cookie line' });
        }
        continue;
      }
      if (entries.length >= LIMITS.MAX_ENTRIES) { truncated = true; continue; }
      entry.line = i + 1;
      entry.order = entries.length;
      entry.expired = entry.expires > 0 && entry.expires <= now;
      entry.selected = false;
      entries.push(entry);
      parsed++;
    }

    return {
      entries, parsed, comments, malformed, truncated,
      skipped: malformed.length,
      format: 'netscape',
      lines: lines.length,
    };
  }

  /* ==========================================================================
   * 5 · JSON export parsing
   * ======================================================================== */

  /**
   * Convert one JSON cookie object into an entry.
   * Understands the field aliases used by Cookie-Editor, EditThisCookie,
   * Chromium DevTools ("Copy all as JSON"), Puppeteer/Playwright storage
   * state and Firefox `cookies.sqlite` dumps.
   *
   * @returns {{entry: object|null, reason: string|null}}
   */
  function entryFromJsonItem(item, index) {
    const label = 'item #' + (index + 1);
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { entry: null, reason: label + ' is not an object' };
    }
    const rawName = item.name !== undefined ? item.name
      : item.key !== undefined ? item.key
        : item.Name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) return { entry: null, reason: label + ' is missing a cookie name' };

    let rawValue = item.value !== undefined ? item.value
      : item.val !== undefined ? item.val
        : item.Value;
    if (rawValue === null || rawValue === undefined) rawValue = '';
    const type = typeof rawValue;
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      return { entry: null, reason: 'cookie "' + name + '" has a value of unsupported type' };
    }

    const rawDomain = item.domain !== undefined ? item.domain
      : item.host !== undefined ? item.host
        : item.Domain;
    const domain = typeof rawDomain === 'string' ? cleanValue(rawDomain) : '';

    const expirySource = item.expirationDate !== undefined ? item.expirationDate
      : item.expires !== undefined ? item.expires
        : item.expiry !== undefined ? item.expiry
          : item.expiration;
    const expiry = parseExpiry(expirySource);

    return {
      entry: {
        domain,
        includeSubdomains: domain.charAt(0) === '.',
        path: typeof item.path === 'string' && item.path ? item.path : '/',
        secure: item.secure === true || item.isSecure === true,
        expires: expiry.seconds,
        expiryUnderstood: expiry.ok,
        name,
        value: cleanValue(unquote(String(rawValue))),
        httpOnly: item.httpOnly === true || item.isHttpOnly === true,
        sameSite: typeof item.sameSite === 'string' ? item.sameSite : null,
        source: 'json',
      },
      reason: null,
    };
  }

  /** Build entries from an array of JSON cookie objects, collecting bad rows. */
  function entriesFromJsonArray(list) {
    const entries = [];
    const malformed = [];
    let truncated = false;
    for (let i = 0; i < list.length; i++) {
      const { entry, reason } = entryFromJsonItem(list[i], i);
      if (!entry) {
        if (malformed.length < LIMITS.MAX_REPORTED) malformed.push({ line: i + 1, text: '', reason });
        continue;
      }
      if (entries.length >= LIMITS.MAX_ENTRIES) { truncated = true; continue; }
      entry.line = i + 1;
      entry.order = entries.length;
      entry.expired = false;
      entry.selected = false;
      entries.push(entry);
    }
    return { entries, malformed, truncated };
  }

  /** Entries from a `{ name: value }` map (no domain/expiry information). */
  function entriesFromMap(map) {
    const entries = [];
    const malformed = [];
    for (const key of Object.keys(map)) {
      if (UNSAFE_KEYS.has(key)) continue;
      const value = map[key];
      if (value !== null && typeof value === 'object') {
        if (malformed.length < LIMITS.MAX_REPORTED) {
          malformed.push({ line: 0, text: key, reason: 'value for "' + key + '" is not a string' });
        }
        continue;
      }
      const name = String(key).trim();
      if (!name) continue;
      entries.push({
        domain: '',
        includeSubdomains: false,
        path: '/',
        secure: false,
        expires: 0,
        expiryUnderstood: true,
        name,
        value: cleanValue(value === null || value === undefined ? '' : String(value)),
        httpOnly: false,
        sameSite: null,
        source: 'json-map',
        line: 0,
        order: entries.length,
        expired: false,
        selected: false,
      });
    }
    return entries;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Parse any JSON cookie export.
   *
   * Accepted shapes:
   *   • `[ {name, value, …}, … ]`
   *   • `{ cookies: [ … ] }` (Puppeteer / Playwright storage state)
   *   • `{ name: value, … }` (plain map)
   *   • `{ name, value }` (single cookie)
   *   • `{ cookie: "…", sapisid: "…" }` → passthrough (see `convert`)
   *   • `{ cookie: "SID=…; SANISID…" }` → parsed as a header, completed
   *
   * @param {string} text
   * @param {number} [nowSec]
   */
  function parseJsonExport(text, nowSec) {
    const now = resolveNow(nowSec);
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ConversionError(
        ERROR_CODES.PARSE_ERROR,
        'Input looks like JSON but could not be parsed: ' + e.message,
        { hint: 'Check for a truncated paste — the JSON must be complete, including the final bracket.' }
      );
    }

    const info = [];
    const notes = (parsed) => {
      for (const entry of parsed.entries) {
        entry.expired = entry.expires > 0 && entry.expires <= now;
      }
      const bad = parsed.entries.filter((e) => e.expiryUnderstood === false);
      if (bad.length) {
        info.push('Could not read the expiry date of: ' + bad.map((e) => e.name).join(', ') +
          ' — treated as session cookies.');
      }
      const base = {
        entries: parsed.entries,
        parsed: parsed.entries.length,
        skipped: parsed.malformed.length,
        malformed: parsed.malformed,
        truncated: parsed.truncated,
        comments: 0,
        info,
        format: 'json',
        lines: 0,
      };
      return base;
    };

    if (Array.isArray(data)) {
      const parsed = entriesFromJsonArray(data);
      if (!parsed.entries.length && !parsed.malformed.length) {
        throw new ConversionError(ERROR_CODES.PARSE_ERROR, 'The JSON array is empty — nothing to convert.',
          { hint: 'Export cookies for gemini.google.com and try again.' });
      }
      return notes(parsed);
    }

    if (!isPlainObject(data)) {
      throw new ConversionError(ERROR_CODES.PARSE_ERROR,
        'Unsupported JSON: expected an array of cookies, a cookie map, or a gemini-web2api payload.');
    }

    // Puppeteer / Playwright storage state and friends.
    if (Array.isArray(data.cookies)) {
      const parsed = entriesFromJsonArray(data.cookies);
      if (Array.isArray(data.origins) && data.origins.length) {
        info.push('Ignored the "origins" section of the storage-state file.');
      }
      return notes(parsed);
    }

    // Already-converted gemini-web2api payload (possibly missing `sapisid`).
    // `cookie` must look like a real header, otherwise it is just a cookie
    // that happens to be called "cookie" in a name/value map.
    if (typeof data.cookie === 'string' && data.cookie.trim() &&
        (typeof data.sapisid === 'string' || looksLikeHeaderLine(data.cookie))) {
      const header = parseRawHeader(data.cookie);
      const result = notes({ entries: header.entries, malformed: header.malformed, truncated: false });
      result.passthrough = typeof data.sapisid === 'string' && data.sapisid.trim()
        ? { cookie: data.cookie.trim(), sapisid: data.sapisid.trim() }
        : { cookie: data.cookie.trim(), sapisid: null };
      result.format = 'json';
      return result;
    }

    // A single cookie object: { "name": "SID", "value": "…" }.
    if (typeof data.name === 'string' && data.name.trim() && 'value' in data) {
      const parsed = entriesFromJsonArray([data]);
      return notes(parsed);
    }

    // Plain name/value map.
    if (Object.keys(data).length === 0) {
      throw new ConversionError(ERROR_CODES.PARSE_ERROR, 'The JSON object is empty — nothing to convert.');
    }
    const entries = entriesFromMap(data);
    if (!entries.length) {
      throw new ConversionError(ERROR_CODES.PARSE_ERROR,
        'No usable cookie values found — expected strings such as {"SID": "…"}.');
    }
    return notes({ entries, malformed: [], truncated: false });
  }

  /* ==========================================================================
   * 6 · Raw `Cookie` header parsing
   * ======================================================================== */

  /**
   * Parse a raw `Cookie:` header string (single- or multi-line, with or
   * without the `Cookie:` prefix). Later duplicates win, mirroring how a
   * browser resolves same-named cookies in a header.
   *
   * @param {string} text
   */
  function parseRawHeader(text) {
    const lines = String(text).split(/\r\n|\r|\n/);
    const entries = [];
    const malformed = [];
    const byName = new Map();   // name -> {entry, index}
    let segments = 0;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].trim().replace(/^cookie\s*:\s*/i, '');
      if (line === '') continue;
      const pairs = line.split(';');
      for (const rawPair of pairs) {
        const pair = rawPair.trim();
        if (pair === '') continue;
        const eq = pair.indexOf('=');
        if (eq <= 0) {
          if (malformed.length < LIMITS.MAX_REPORTED) {
            malformed.push({ line: li + 1, text: snippet(pair), reason: 'no "name=value" pair' });
          }
          continue;
        }
        const name = pair.slice(0, eq).trim();
        if (!name || name.charAt(0) === '$' || UNSAFE_KEYS.has(name)) continue;
        segments++;
        const entry = {
          domain: '',
          includeSubdomains: false,
          path: '/',
          secure: false,
          expires: 0,
          expiryUnderstood: true,
          name,
          value: cleanValue(unquote(pair.slice(eq + 1).trim())),
          httpOnly: false,
          sameSite: null,
          source: 'header',
          line: li + 1,
          order: segments,
          expired: false,
          selected: false,
        };
        const previous = byName.get(name);
        if (previous) {
          // Overwrite in place: the last occurrence wins, order stays stable.
          entries[previous.index] = entry;
        } else {
          byName.set(name, { entry, index: entries.length });
          entries.push(entry);
        }
      }
    }

    return {
      entries,
      parsed: entries.length,
      skipped: malformed.length,
      malformed,
      comments: 0,
      truncated: false,
      info: [],
      format: 'header',
      lines: lines.length,
    };
  }

  /* ==========================================================================
   * 7 · cURL command parsing
   * ======================================================================== */

  /**
   * Split a shell command into tokens, honouring POSIX quoting and the
   * `$'…'` (ANSI-C) quoting produced when you paste with `set -o vi`/zsh.
   * @param {string} text
   * @returns {string[]}
   */
  function tokenizeShell(text) {
    const src = String(text)
      .replace(/\\(\r?\n)/g, ' ')
      .replace(/\^\r?\n/g, ' ');
    const tokens = [];
    let current = '';
    let started = false;
    let mode = 'plain';

    const ansiChar = (ch) => {
      switch (ch) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case '\\': return '\\';
        case "'": return "'";
        case '"': return '"';
        default: return ch;
      }
    };

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (mode === 'single') {
        if (ch === "'") mode = 'plain';
        else current += ch;
      } else if (mode === 'double') {
        if (ch === '\\' && (src[i + 1] === '"' || src[i + 1] === '\\')) current += src[++i];
        else if (ch === '"') mode = 'plain';
        else current += ch;
      } else if (mode === 'ansi') {
        if (ch === '\\') {
          const next = src[++i];
          if (next === 'x') {
            const hex = src.slice(i + 1, i + 3);
            if (/^[0-9a-f]{2}$/i.test(hex)) { current += String.fromCharCode(parseInt(hex, 16)); i += 2; }
          } else if (next === 'u') {
            const hex = src.slice(i + 1, i + 5);
            if (/^[0-9a-f]{4}$/i.test(hex)) { current += String.fromCharCode(parseInt(hex, 16)); i += 4; }
          } else if (next !== undefined) {
            current += ansiChar(next);
          }
        } else if (ch === "'") {
          mode = 'plain';
        } else {
          current += ch;
        }
      } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        if (started) { tokens.push(current); current = ''; started = false; }
      } else if (ch === "'") {
        mode = 'single'; started = true;
      } else if (ch === '"') {
        mode = 'double'; started = true;
      } else if (ch === '$' && src[i + 1] === "'") {
        mode = 'ansi'; i++; started = true;
      } else {
        current += ch;
        started = true;
      }
    }
    if (started) tokens.push(current);
    return tokens;
  }

  /**
   * Extract cookies from a pasted `curl` command line
   * (DevTools → Network → *Copy as cURL*).
   *
   * Handles `-H 'Cookie: …'`, `--header 'Cookie: …'`, `-b/--cookie '<pairs>'`
   * and warns when `-b` points at a cookie-file path (unreadable here).
   */
  function parseCurl(text) {
    const tokens = tokenizeShell(text);
    let header = null;
    let cookieArg = null;
    let cookieFile = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const lower = token.toLowerCase();
      const inlineValue = (prefix) => (lower.indexOf(prefix) === 0 ? token.slice(prefix.length) : null);

      if (lower === '-h' || lower === '--header') {
        const value = tokens[++i];
        if (value && /^cookie\s*:/i.test(value)) header = value.replace(/^cookie\s*:\s*/i, '');
      } else if (lower.indexOf('--header=') === 0) {
        const value = inlineValue('--header=');
        if (value && /^cookie\s*:/i.test(value)) header = value.replace(/^cookie\s*:\s*/i, '');
      } else if (lower === '-b' || lower === '--cookie') {
        const value = tokens[++i];
        if (value) {
          if (value.indexOf('=') !== -1 && !/[/\\]/.test(value)) cookieArg = value;
          else cookieFile = value;
        }
      } else if (lower.indexOf('--cookie=') === 0) {
        const value = inlineValue('--cookie=');
        if (value) { if (value.indexOf('=') !== -1) cookieArg = value; else cookieFile = value; }
      }
    }

    const info = [];
    if (!header && cookieFile) {
      throw new ConversionError(
        ERROR_CODES.PARSE_ERROR,
        'That cURL command reads cookies from a file (' + cookieFile + '), so the cookie values are not in the paste.',
        { hint: 'Open the file and paste its contents, or use "Copy as cURL" from a request that sends a Cookie: header.' }
      );
    }
    if (!header && cookieArg) {
      header = cookieArg;
      info.push('Read the cookies from the cURL "-b/--cookie" argument.');
    }
    if (!header) {
      throw new ConversionError(
        ERROR_CODES.PARSE_ERROR,
        'No Cookie header found in that cURL command.',
        { hint: 'Copy the request as cURL from a signed-in gemini.google.com request (DevTools → Network → right-click → Copy as cURL).' }
      );
    }

    const parsed = parseRawHeader(header);
    parsed.format = 'curl';
    parsed.info = info.concat(['Extracted the Cookie header from the pasted cURL command.']);
    return parsed;
  }

  /* ==========================================================================
   * 8 · `Set-Cookie` header parsing
   * ======================================================================== */

  /**
   * Parse one or more `Set-Cookie` headers (with or without the prefix).
   * @param {string} text
   * @param {number} [nowSec]
   */
  function parseSetCookie(text, nowSec) {
    const now = resolveNow(nowSec);
    const lines = String(text).split(/\r\n|\r|\n/);
    const entries = [];
    const malformed = [];
    const info = [];

    for (let li = 0; li < lines.length; li++) {
      let line = lines[li].trim();
      if (line === '') continue;
      if (line.charAt(0) === '#' && line.indexOf(HTTP_ONLY_PREFIX) !== 0) continue;
      line = line.replace(/^set-cookie\s*:\s*/i, '');
      let httpOnly = false;
      if (line.indexOf(HTTP_ONLY_PREFIX) === 0) { httpOnly = true; line = line.slice(HTTP_ONLY_PREFIX.length); }

      const parts = line.split(';');
      const head = parts.shift() || '';
      const eq = head.indexOf('=');
      if (eq <= 0) {
        if (malformed.length < LIMITS.MAX_REPORTED) {
          malformed.push({ line: li + 1, text: snippet(head), reason: 'no "name=value" pair' });
        }
        continue;
      }

      const entry = {
        domain: '',
        includeSubdomains: false,
        path: '/',
        secure: false,
        expires: 0,
        expiryUnderstood: true,
        name: head.slice(0, eq).trim(),
        value: cleanValue(unquote(head.slice(eq + 1).trim())),
        httpOnly,
        sameSite: null,
        source: 'set-cookie',
        line: li + 1,
        order: entries.length,
        expired: false,
        selected: false,
      };
      if (!entry.name) continue;

      for (const rawAttr of parts) {
        const attr = rawAttr.trim();
        if (attr === '') continue;
        const attrEq = attr.indexOf('=');
        const key = (attrEq === -1 ? attr : attr.slice(0, attrEq)).trim().toLowerCase();
        const value = attrEq === -1 ? '' : attr.slice(attrEq + 1).trim();
        if (key === 'domain') entry.domain = cleanValue(value);
        else if (key === 'path') entry.path = cleanValue(value) || '/';
        else if (key === 'expires') {
          const expiry = parseExpiry(value);
          entry.expires = expiry.seconds;
          entry.expiryUnderstood = expiry.ok;
        } else if (key === 'max-age') {
          const seconds = Number(value);
          if (Number.isFinite(seconds)) entry.expires = Math.round(now + seconds);
        } else if (key === 'secure') entry.secure = true;
        else if (key === 'httponly') entry.httpOnly = true;
        else if (key === 'samesite') entry.sameSite = value || null;
      }
      entry.includeSubdomains = entry.domain.charAt(0) === '.';
      entry.expired = entry.expires > 0 && entry.expires <= now;
      entries.push(entry);
    }

    const bad = entries.filter((e) => e.expiryUnderstood === false);
    if (bad.length) {
      info.push('Could not read the expiry date of: ' + bad.map((e) => e.name).join(', ') +
        ' — treated as session cookies.');
    }

    return {
      entries,
      parsed: entries.length,
      skipped: malformed.length,
      malformed,
      comments: 0,
      truncated: false,
      info,
      format: 'set-cookie',
      lines: lines.length,
    };
  }

  /* ==========================================================================
   * 9 · Detection-driven parsing
   * ======================================================================== */

  /**
   * Detect the format of `text` and parse it.
   * @param {string} text
   * @param {number} [nowSec]
   * @returns {object} a parse result: `{entries, parsed, skipped, comments, malformed, format, …}`
   * @throws {ConversionError} EMPTY_INPUT
   */
  function parseAuto(text, nowSec) {
    const source = text == null ? '' : String(text);
    const format = detectFormat(source);
    if (format === 'empty') {
      throw new ConversionError(ERROR_CODES.EMPTY_INPUT, 'Nothing to convert — the input is empty.',
        { hint: 'Paste an export, drop a file, or use "Load sample".' });
    }
    switch (format) {
      case 'json': return parseJsonExport(source, nowSec);
      case 'curl': return parseCurl(source, nowSec);
      case 'set-cookie': return parseSetCookie(source, nowSec);
      case 'header': return parseRawHeader(source);
      default: return parseNetscape(source, nowSec);
    }
  }

  /* ==========================================================================
   * 10 · Selection
   * ======================================================================== */

  /**
   * Rank candidates for the same cookie name. Lower is better.
   * Order: usable value → domain relevance → later expiry → later occurrence.
   */
  function compareCandidates(a, b) {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.entry.expires !== a.entry.expires) return b.entry.expires - a.entry.expires;
    return b.entry.order - a.entry.order;
  }

  /**
   * Pick the best entry for every required (and optional extra) cookie.
   *
   * Preference order: usable value, highest domain score, latest expiry,
   * last occurrence. Expired entries are only used when `opts.allowExpired`
   * is set, and are always reported.
   *
   * @param {object[]} entries parsed cookie entries
   * @param {{required?: string[], extraCookies?: string[], expectedDomains?: string[],
   *          allowExpired?: boolean}} [opts]
   */
  function selectRequired(entries, opts) {
    const options = opts || {};
    const required = normaliseNames(options.required, REQUIRED);
    const extras = normaliseNames(options.extraCookies, [])
      .filter((name) => required.indexOf(name) === -1);
    const expected = Array.isArray(options.expectedDomains) && options.expectedDomains.length
      ? options.expectedDomains
      : EXPECTED_DOMAINS;
    const allowExpired = Boolean(options.allowExpired);
    const wanted = required.concat(extras);
    const wantedSet = new Set(wanted);

    const candidates = new Map();
    const foreignDomains = new Map();

    for (const entry of entries) {
      if (!wantedSet.has(entry.name)) continue;
      const score = domainScore(entry.domain, expected);
      if (score === 1 && entry.domain) {
        if (!foreignDomains.has(entry.name)) foreignDomains.set(entry.name, new Set());
        foreignDomains.get(entry.name).add(entry.domain);
      }
      if (!candidates.has(entry.name)) candidates.set(entry.name, []);
      candidates.get(entry.name).push({
        entry,
        score,
        usable: valueIssue(entry.value) === null,
      });
    }

    const selected = {};
    const missing = [];
    const expiredOnly = [];
    const usedExpired = [];
    const weak = [];
    const unknownDomain = [];
    const invalid = [];
    const warnings = [];
    const info = [];
    const ignoredForeign = [];
    const expiredDuplicates = [];
    const absentExtras = [];
    const requiredSet = new Set(required);

    for (const name of wanted) {
      const isRequired = requiredSet.has(name);
      const list = candidates.get(name);
      if (!list || !list.length) {
        if (isRequired) missing.push(name);
        else absentExtras.push(name);
        continue;
      }

      const valid = list.filter((c) => !c.entry.expired);
      const expired = list.filter((c) => c.entry.expired);
      let ranked = valid.slice().sort(compareCandidates);

      if (!ranked.length) {
        if (!allowExpired) {
          // Optional extras never block a conversion.
          if (isRequired) expiredOnly.push(name);
          else absentExtras.push(name + ' (expired)');
          continue;
        }
        ranked = expired.slice().sort(compareCandidates);
        usedExpired.push(name);
      } else if (valid.length > 1 && isRequired) {
        info.push('Multiple values seen for "' + name + '" — picked the best-scoped, freshest one.');
      }
      if (isRequired && ranked.length && expired.length && valid.length) {
        expiredDuplicates.push(name);
      }

      const chosen = ranked[0];
      chosen.entry.selected = true;
      selected[name] = chosen.entry;

      if (isRequired && chosen.score < 3) {
        weak.push(name);
        if (chosen.score === 1 && chosen.entry.domain) {
          warnings.push('Using "' + name + '" from an unrelated domain (' +
            chosen.entry.domain + ') — re-export from gemini.google.com for a reliable session.');
        } else if (chosen.score === 2) {
          info.push('"' + name + '" is scoped to google.com, not gemini.google.com.');
        }
      }
      if (isRequired && !chosen.entry.domain) unknownDomain.push(name);

      const reason = valueIssue(chosen.entry.value);
      if (reason && isRequired) invalid.push({ name, reason, value: chosen.entry.value });
    }

    // Same-named cookies from unrelated domains that were *not* used.
    for (const [name, domains] of foreignDomains) {
      const chosen = selected[name];
      const usedForeign = chosen && domainScore(chosen.domain, expected) === 1;
      if (usedForeign) continue; // already reported as "Using … from an unrelated domain"
      if (!domains.size) continue;
      ignoredForeign.push(name + ' (' + Array.from(domains).sort().join(', ') + ')');
    }
    if (ignoredForeign.length) {
      warnings.push('Ignored same-named cookies from unrelated domains: ' + ignoredForeign.join(', ') + '.');
    }
    if (expiredDuplicates.length) {
      info.push('Ignored expired copies of: ' + expiredDuplicates.join(', ') + '.');
    }
    if (unknownDomain.length) {
      info.push('No domain information for: ' + unknownDomain.join(', ') +
        ' (input format does not carry a domain).');
    }
    if (absentExtras.length) {
      info.push('Optional cookie(s) not found in this export: ' + absentExtras.join(', ') + '.');
    }
    if (usedExpired.length) {
      warnings.push('Using expired cookie(s) because "allow expired" is on: ' + usedExpired.join(', ') + '.');
    }

    const checklist = required.map((name) => {
      const entry = selected[name] || null;
      if (!entry) {
        const reason = expiredOnly.indexOf(name) !== -1 ? 'expired' : 'missing';
        return { name, status: reason, entry: null };
      }
      if (entry.expired) return { name, status: 'expired', entry };
      if (valueIssue(entry.value)) return { name, status: 'invalid', entry };
      if (domainScore(entry.domain, expected) < 3) {
        return { name, status: entry.domain ? 'weak' : 'ok', entry };
      }
      return { name, status: 'ok', entry };
    });

    return {
      selected,
      checklist,
      missing,
      expiredOnly,
      usedExpired,
      weak,
      invalid,
      warnings,
      info,
      ignoredForeign,
      absentExtras,
      extrasUsed: extras.filter((name) => selected[name] && !valueIssue(selected[name].value)),
    };
  }

  /** Convenience wrapper: the per-required-cookie status table. */
  function auditRequired(entries, opts) {
    return selectRequired(entries, opts).checklist;
  }

  /* ==========================================================================
   * 11 · Payload building
   * ======================================================================== */

  /**
   * Build the gemini-web2api payload.
   * @param {Object<string, object>} selected name → entry
   * @param {{required?: string[], extraCookies?: string[], allowExpired?: boolean}} [opts]
   * @throws {ConversionError} MISSING_COOKIES | EXPIRED_COOKIES | INVALID_COOKIE_VALUE
   */
  function buildPayload(selected, opts) {
    const options = opts || {};
    const required = normaliseNames(options.required, REQUIRED);
    const extras = normaliseNames(options.extraCookies, []).filter((n) => required.indexOf(n) === -1);
    const allowExpired = Boolean(options.allowExpired);

    const missing = [];
    const expired = [];
    const invalid = [];
    for (const name of required) {
      const entry = selected[name];
      if (!entry) { missing.push(name); continue; }
      if (entry.expired && !allowExpired) { expired.push(name); continue; }
      const reason = valueIssue(entry.value);
      if (reason) invalid.push({ name, reason });
    }
    const usableExtras = [];
    for (const name of extras) {
      const entry = selected[name];
      if (!entry || entry.expired || valueIssue(entry.value)) continue;
      usableExtras.push(name);
    }

    if (missing.length || expired.length || invalid.length) {
      const messages = [];
      if (missing.length) messages.push('Missing required cookies: ' + missing.join(', '));
      if (expired.length) messages.push('Expired required cookies: ' + expired.join(', '));
      if (invalid.length) {
        messages.push('Unusable cookie value(s): ' +
          invalid.map((i) => i.name + ' (' + i.reason + ')').join(', '));
      }
      const code = missing.length ? ERROR_CODES.MISSING_COOKIES
        : expired.length ? ERROR_CODES.EXPIRED_COOKIES
          : ERROR_CODES.INVALID_COOKIE_VALUE;
      throw new ConversionError(code, messages.join('. ') + '.', {
        details: { missing, expired, invalid },
        hint: missing.length
          ? 'Export cookies while signed in at gemini.google.com (docs/exporting-cookies.md).'
          : expired.length
            ? 'Re-export fresh cookies; if the values are new, check your system clock (docs/troubleshooting.md).'
            : 'Re-export the cookies — values cannot contain spaces, semicolons or control characters.',
      });
    }

    const names = required.concat(usableExtras);
    const cookie = names.map((name) => name + '=' + selected[name].value).join('; ');
    return {
      cookie,
      sapisid: selected.SAPISID ? selected.SAPISID.value : null,
      extras: usableExtras,
    };
  }

  /* ==========================================================================
   * 12 · One-call pipeline
   * ======================================================================== */

  /**
   * Parse any supported input and produce the full result object used by the
   * UI and the tests.
   *
   * @param {string} text
   * @param {{nowSec?: number, allowExpired?: boolean, extraCookies?: string[],
   *          required?: string[], expectedDomains?: string[], maxChars?: number}} [opts]
   * @returns {{
   *   ok: boolean, code: string|null, error: string|null, hint: string|null,
   *   payload: object|null, json: object|null, raw: string|null,
   *   selected: object, entries: object[], checklist: object[],
   *   missing: string[], expiredOnly: string[], invalid: object[],
   *   warnings: string[], info: string[], stats: object,
   *   format: string, passthrough: boolean, options: object
   * }}
   */
  function convert(text, opts) {
    const options = opts || {};
    const started = {
      nowSec: options.nowSec,
      allowExpired: Boolean(options.allowExpired),
      extraCookies: normaliseNames(options.extraCookies, []),
      required: normaliseNames(options.required, REQUIRED),
      expectedDomains: Array.isArray(options.expectedDomains) && options.expectedDomains.length
        ? options.expectedDomains.slice()
        : EXPECTED_DOMAINS.slice(),
    };

    const source = text == null ? '' : String(text);
    const maxChars = typeof options.maxChars === 'number' ? options.maxChars : LIMITS.MAX_CHARS;

    /** Shared empty result so every branch returns the same shape. */
    const emptyResult = () => ({
      ok: false,
      code: null,
      error: null,
      hint: null,
      payload: null,
      json: null,
      raw: null,
      selected: {},
      entries: [],
      checklist: [],
      missing: [],
      expiredOnly: [],
      usedExpired: [],
      invalid: [],
      warnings: [],
      info: [],
      parsed: 0,
      skipped: 0,
      stats: { parsed: 0, skipped: 0, comments: 0, malformed: [], lines: 0, chars: source.length, truncated: false },
      format: 'empty',
      passthrough: false,
      options: started,
    });

    const result = emptyResult();

    if (source.length > maxChars) {
      result.code = ERROR_CODES.TOO_LARGE;
      result.error = 'Input is too large (' + formatBytes(source.length) + '). Limit is ' +
        formatBytes(maxChars) + '.';
      result.hint = 'Export cookies for gemini.google.com only instead of the whole browser.';
      return result;
    }

    let parsed;
    try {
      parsed = parseAuto(source, options.nowSec);
    } catch (err) {
      if (err instanceof ConversionError) {
        result.code = err.code;
        result.error = err.message;
        result.hint = err.hint;
        // Empty input is semantically "every required cookie is missing".
        if (err.code === ERROR_CODES.EMPTY_INPUT) {
          result.missing = started.required.slice();
          result.checklist = started.required.map((name) => ({ name, status: 'missing', entry: null }));
        }
      } else {
        result.code = ERROR_CODES.PARSE_ERROR;
        result.error = 'Unexpected error while parsing: ' + err.message;
      }
      return result;
    }

    result.format = parsed.format;
    result.entries = parsed.entries;
    result.parsed = parsed.parsed;
    result.skipped = parsed.skipped;
    result.stats = {
      parsed: parsed.parsed,
      skipped: parsed.skipped,
      comments: parsed.comments || 0,
      malformed: parsed.malformed || [],
      lines: parsed.lines || 0,
      chars: source.length,
      truncated: Boolean(parsed.truncated),
    };
    result.info = (parsed.info || []).slice();

    /* ---- already-converted payload ------------------------------------ */
    if (parsed.passthrough) {
      const byName = new Map(result.entries.map((e) => [e.name, e]));
      const given = parsed.passthrough.sapisid;
      const inString = byName.get('SAPISID') ? byName.get('SAPISID').value : null;

      if (given) {
        // A complete payload: validate it, never rewrite the cookie string.
        const sapisid = inString || given;
        const payload = { cookie: parsed.passthrough.cookie, sapisid };
        result.ok = true;
        result.passthrough = true;
        result.payload = payload;
        result.json = payload;
        result.raw = payload.cookie;
        for (const [name, entry] of byName) result.selected[name] = entry;
        result.checklist = started.required.map((name) => {
          const entry = byName.get(name) || null;
          if (!entry) return { name, status: 'missing', entry: null };
          if (valueIssue(entry.value)) return { name, status: 'invalid', entry };
          return { name, status: 'ok', entry };
        });
        result.missing = result.checklist.filter((c) => c.status === 'missing').map((c) => c.name);
        result.info.push('Input was already in gemini-web2api format; it was validated and passed through unchanged.');
        if (inString && given !== inString) {
          result.warnings.push('The "sapisid" field did not match SAPISID in the cookie string — ' +
            'the value from the cookie string was used.');
        }
        if (result.missing.length) {
          result.warnings.push('The pasted payload does not contain ' + result.missing.join(', ') +
            ' — gemini-web2api will most likely reject it.');
        }
        const unusable = result.checklist.filter((row) => row.status === 'invalid');
        if (unusable.length) {
          result.warnings.push('Unusable value(s) in the pasted payload: ' +
            unusable.map((row) => row.name + ' (' + valueIssue(row.entry.value) + ')').join(', ') + '.');
        }
        return result;
      }

      // No `sapisid`: rebuild the payload from the cookie string itself.
      result.info.push('The payload had no "sapisid" field — it is being derived from the cookie string.');
    }

    /* ---- normal selection -------------------------------------------- */
    const selection = selectRequired(result.entries, started);
    result.selected = selection.selected;
    result.checklist = selection.checklist;
    result.missing = selection.missing;
    result.expiredOnly = selection.expiredOnly;
    result.usedExpired = selection.usedExpired;
    result.invalid = selection.invalid;
    result.warnings = result.warnings.concat(selection.warnings);
    result.info = result.info.concat(selection.info);

    if (result.stats.truncated) {
      result.warnings.push('Input contained more than ' + LIMITS.MAX_ENTRIES +
        ' cookies; only the first ' + LIMITS.MAX_ENTRIES + ' were analysed.');
    }
    if (parsed.malformed && parsed.malformed.length) {
      result.info.push('Skipped ' + parsed.skipped + ' unreadable ' +
        (parsed.skipped === 1 ? 'line' : 'lines') + ' (see the report below).');
    }

    if (!selection.missing.length && !selection.expiredOnly.length && !selection.invalid.length) {
      try {
        const payload = buildPayload(selection.selected, started);
        result.ok = true;
        result.payload = payload;
        result.json = payload;
        result.raw = payload.cookie;
      } catch (err) {
        result.code = err.code || ERROR_CODES.PARSE_ERROR;
        result.error = err.message;
        result.hint = err.hint;
        if (err.details) {
          result.missing = err.details.missing || result.missing;
          result.expiredOnly = err.details.expired || result.expiredOnly;
        }
      }
    } else {
      const parts = [];
      if (selection.missing.length) parts.push('Missing required cookies: ' + selection.missing.join(', '));
      if (selection.expiredOnly.length) {
        parts.push('Expired required cookies: ' + selection.expiredOnly.join(', '));
      }
      if (selection.invalid.length) {
        parts.push('Unusable cookie value(s): ' +
          selection.invalid.map((i) => i.name + ' (' + i.reason + ')').join(', '));
      }
      result.error = parts.join('. ') + '.';
      result.code = selection.missing.length ? ERROR_CODES.MISSING_COOKIES
        : selection.expiredOnly.length ? ERROR_CODES.EXPIRED_COOKIES
          : ERROR_CODES.INVALID_COOKIE_VALUE;
      result.hint = selection.missing.length
        ? 'Export cookies while signed in at gemini.google.com (see docs/exporting-cookies.md).'
        : selection.expiredOnly.length
          ? 'Re-export fresh cookies — or enable "allow expired" if your system clock is wrong.'
          : 'Values cannot contain spaces, semicolons or control characters; re-export the cookies.';
    }

    /* ---- placeholder hints ------------------------------------------- */
    if (result.ok) {
      const placeholders = started.required.filter((name) => {
        const entry = result.selected[name];
        return entry && looksPlaceholder(entry.value);
      });
      if (placeholders.length) {
        result.warnings.push('These look like placeholder values: ' + placeholders.join(', ') +
          ' — replace the sample with your real export.');
      }
    }

    return result;
  }

  /** Human-readable byte size for error messages. */
  function formatBytes(chars) {
    if (chars < 1024) return chars + ' B';
    if (chars < 1024 * 1024) return (chars / 1024).toFixed(1) + ' KB';
    return (chars / 1048576).toFixed(1) + ' MB';
  }

  /* ==========================================================================
   * 13 · Public API
   * ======================================================================== */

  return {
    VERSION,
    REQUIRED: REQUIRED.slice(),
    SUGGESTED_EXTRA: SUGGESTED_EXTRA.slice(),
    FORMATS: FORMATS.slice(),
    ERROR_CODES,
    LIMITS,
    EXPECTED_DOMAINS: EXPECTED_DOMAINS.slice(),
    ConversionError,

    // parsing
    detectFormat,
    parseAuto,
    parseNetscape,
    parseNetscapeLine,
    parseJsonExport,
    parseRawHeader,
    parseCurl,
    parseSetCookie,

    // analysis
    domainScore,
    selectRequired,
    auditRequired,
    buildPayload,
    convert,

    // helpers (exposed for the UI and for tests)
    parseExpiry,
    valueIssue,
    looksPlaceholder,
    tokenizeShell,
  };
});
