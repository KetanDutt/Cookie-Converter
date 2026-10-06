# Architecture

## Goals

1. **Zero dependencies, zero build step** — deployable anywhere, auditable
   in minutes, no supply chain.
2. **Pure/testable core** — parsing logic lives in a DOM-free module.
3. **Fail loud and specific** — every error message names the cookies or
   lines involved.

## Layout

```
index.html            Shell, markup, strict CSP meta tag
assets/
  converter.js        Pure conversion engine (UMD: browser global + CommonJS)
  app.js              DOM wiring, rendering, theme, files, clipboard
  style.css           Theme-aware styles (dark default / light)
  favicon.svg         Inline-vector favicon
tests/
  converter.test.js   Node built-in test runner suite (21 tests, no deps)
docs/                 You are here
404.html              GitHub Pages fallback page
```

## Module design

`converter.js` uses a UMD wrapper:

* Browser → `window.CookieConverter`
* Node → `module.exports` (used by the test suite)

Public surface:

| API | Purpose |
| --- | --- |
| `REQUIRED` | The six required cookie names (defensive copy) |
| `detectFormat(text)` | `'json' \| 'header' \| 'netscape' \| 'empty'` |
| `parseNetscape(text, nowSec?)` | Netscape parser (`#HttpOnly_` aware) |
| `parseJsonExport(text, nowSec?)` | JSON array / map / passthrough parser |
| `parseRawHeader(text)` | `Cookie` header string parser |
| `parseAuto(text, nowSec?)` | Detect + parse |
| `selectRequired(entries)` | Domain-aware best-candidate selection |
| `buildPayload(selected)` | Throws structured errors; returns `{cookie, sapisid}` |
| `convert(text)` | One-call pipeline returning a rich result object |

All time-dependent logic accepts an injectable `nowSec`, which keeps the
expiry tests deterministic.

## Parsing pipeline

```
input ── detectFormat ──► parser ──► entries[] ──► selectRequired ──► buildPayload ──► JSON
                                          │               │
                                          └── table UI    └── warnings / missing / expired
```

Key decisions:

* **`#HttpOnly_` lines are cookies**, not comments (curl-style exports).
* **Tab split first**, whitespace fallback second; values are re-joined with
  the same separator they were split on.
* **Domain scoring** (`gemini.google.com` > `.google.com` > other) prevents
  same-named cookies from unrelated sites from poisoning the output.
* **Expired cookies are never selected**; if a required cookie exists only in
  expired form the error says *expired*, not *missing*.
* Rendering uses `textContent`/`createElement` only — no `innerHTML` — so
  cookie values can never inject markup.

## Performance

* Single-pass O(n) parsing; no regex over the whole input.
* Table rows are built in one `DocumentFragment` (single reflow).
* 5 MB input cap keeps the main thread responsive.

## Testing

```bash
npm test          # node --test tests/   (Node ≥ 18, zero dependencies)
```

Coverage includes: full conversion, `#HttpOnly_` handling, whitespace
fallback, tab-in-value round-trips, malformed lines, missing/expired
reporting, domain precedence, duplicate resolution, CRLF, all three JSON
shapes, raw headers, format detection, and immutability of the public API.
