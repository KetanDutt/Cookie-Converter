# Engine API reference

The conversion engine is a single dependency-free module that runs unchanged in
a browser and in Node.

```js
// Browser
const result = CookieConverter.convert(text);

// Node / bundlers
const CookieConverter = require('./assets/converter.js');
const result = CookieConverter.convert(text);
```

* **Browser:** `<script src="assets/converter.js"></script>` publishes
  `window.CookieConverter`.
* **Node:** `module.exports` (CommonJS), used by the test suite.
* No global state, no I/O, no DOM, no timers. For a given `(text, options)` the
  result is deterministic.

---

## `convert(text, options?) → Result`

The one-call pipeline: detect → parse → select → validate → build.

```js
const result = CookieConverter.convert(netscapeFileText);
if (result.ok) {
  console.log(result.payload);   // { cookie: "SID=…; …", sapisid: "…", extras: [] }
} else {
  console.error(result.code, result.error, result.hint);
}
```

### Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `nowSec` | `number` | `Date.now()/1000` | Clock used for expiry checks (inject for deterministic tests) |
| `allowExpired` | `boolean` | `false` | Use expired cookies as a last resort (warns when used) |
| `extraCookies` | `string[]` | `[]` | Optional cookie names to append **when present** (e.g. `['__Secure-1PSIDTS']`) — never affects `missing` |
| `required` | `string[]` | the six Gemini cookies | Override the required set (makes the engine reusable for other targets) |
| `expectedDomains` | `string[]` | `['gemini.google.com']` | Domains that score highest during selection |
| `maxChars` | `number` | `5 * 1024 * 1024` | Input cap; larger input returns `TOO_LARGE` |

### Result

Always the same shape, whether or not the conversion succeeded.

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | `boolean` | `true` when `payload` was produced |
| `code` | `string \| null` | one of `ERROR_CODES` when `ok === false` |
| `error` | `string \| null` | specific, user-facing sentence |
| `hint` | `string \| null` | suggested next action |
| `payload` | `object \| null` | `{ cookie, sapisid, extras }` |
| `json` | `object \| null` | alias of `payload` (kept for compatibility) |
| `raw` | `string \| null` | the bare cookie string (`cookie.txt` contents) |
| `entries` | `object[]` | everything parsed, each with `selected` set on the chosen ones |
| `selected` | `object` | name → entry actually used |
| `checklist` | `{name, status, entry}[]` | one row per required cookie; `status ∈ ok · weak · expired · invalid · missing` |
| `missing` | `string[]` | required cookies with no candidate at all |
| `expiredOnly` | `string[]` | required cookies that exist but are expired |
| `usedExpired` | `string[]` | expired cookies used because `allowExpired` was set |
| `invalid` | `{name, reason}[]` | required cookies whose value cannot be sent |
| `warnings` | `string[]` | things a user must read (foreign domain, expired, placeholders, truncated) |
| `info` | `string[]` | things a user may want to know (duplicates, unknown domain, extras absent) |
| `parsed`, `skipped` | `number` | entry/line counts (compatibility aliases of `stats.*`) |
| `stats` | `object` | `{ parsed, skipped, comments, malformed[], lines, chars, truncated }` |
| `format` | `string` | `netscape · json · header · curl · set-cookie · empty` |
| `passthrough` | `boolean` | input was already a gemini-web2api payload |
| `options` | `object` | the normalised options actually used |

### Example: a whole-browser export

```js
const result = CookieConverter.convert(bigExport, { nowSec: 1_800_000_000 });
for (const row of result.checklist) {
  console.log(row.name, row.status, row.entry?.domain ?? '—');
}
// SID ok .gemini.google.com
// SAPISID weak evil.example        ← still used, but flagged
```

---

## Lower-level functions

| Function | Returns |
| --- | --- |
| `detectFormat(text)` | `'json' \| 'curl' \| 'set-cookie' \| 'netscape' \| 'header' \| 'empty'` |
| `parseAuto(text, nowSec?)` | parse result for the detected format |
| `parseNetscape(text, nowSec?)` | `{entries, parsed, skipped, comments, malformed, truncated, format, lines}` |
| `parseNetscapeLine(line)` | one entry, or `null` for comments/blank/malformed lines |
| `parseJsonExport(text, nowSec?)` | parse result; throws `ConversionError` on unusable JSON |
| `parseRawHeader(text)` | parse result for `Cookie:` header text |
| `parseCurl(text)` | parse result extracted from a cURL command; throws when there is no cookie header |
| `parseSetCookie(text, nowSec?)` | parse result for `Set-Cookie:` headers |
| `selectRequired(entries, opts?)` | `{selected, checklist, missing, expiredOnly, usedExpired, weak, invalid, warnings, info, ignoredForeign, extrasUsed, absentExtras}` |
| `auditRequired(entries, opts?)` | just the `checklist` |
| `buildPayload(selected, opts?)` | `{cookie, sapisid, extras}`; throws `ConversionError` on missing/expired/invalid cookies |
| `domainScore(domain, expectedDomains?)` | `3` (target site), `2` (`google.com`), `1` (anything else) |
| `parseExpiry(value)` | `{seconds, ok}` — epoch seconds, ms timestamps, ISO-8601 and cookie dates |
| `valueIssue(value)` | why a value cannot be sent, or `null` |
| `looksPlaceholder(value)` | sample/placeholder detection used for warnings |
| `tokenizeShell(command)` | POSIX-ish tokenizer (exposed for tests) |

### Constants

| Constant | Contents |
| --- | --- |
| `VERSION` | engine version (kept in sync with `package.json` by `npm run check`) |
| `REQUIRED` | `['SID','HSID','SSID','APISID','SAPISID','__Secure-1PSID']` (copy) |
| `SUGGESTED_EXTRA` | `['__Secure-1PSIDTS','__Secure-3PSID','__Secure-1PAPISID','SIDCC']` (copy) |
| `FORMATS` | every value `detectFormat` can return |
| `EXPECTED_DOMAINS` | `['gemini.google.com']` (copy) |
| `LIMITS` | `{MAX_CHARS, MAX_ENTRIES, MAX_REPORTED}` |
| `ERROR_CODES` | `EMPTY_INPUT · TOO_LARGE · PARSE_ERROR · MISSING_COOKIES · EXPIRED_COOKIES · INVALID_COOKIE_VALUE` |

Returned arrays are defensive copies, so mutating them cannot change engine
behaviour (there is a regression test for exactly that).

---

## Errors

```js
try {
  CookieConverter.buildPayload({});
} catch (err) {
  err.name;            // 'ConversionError'
  err.code;            // 'MISSING_COOKIES'
  err.message;         // 'Missing required cookies: SID, HSID, …, __Secure-1PSID.'
  err.hint;            // actionable next step
  err.details.missing; // ['SID', 'HSID', …]
  err.missing;         // legacy alias of details.missing
}
```

`convert()` never throws for expected failures — it returns `ok: false` with
`code`/`error`/`hint`. The lower-level functions throw so they stay composable.

---

## Reusing the engine for another service

```js
const result = CookieConverter.convert(text, {
  required: ['session_id'],
  expectedDomains: ['example.com'],
  extraCookies: ['csrf_token'],
});
// result.payload → { cookie: 'session_id=…; csrf_token=…', sapisid: null, extras: ['csrf_token'] }
```

Nothing else in the module is Gemini-specific apart from those defaults, so the
engine doubles as a general cookie-jar normaliser.
