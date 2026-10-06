# Architecture

## Goals, in priority order

1. **Zero dependencies, zero build step** — deployable anywhere, auditable in
   minutes, no supply chain, no toolchain to keep alive.
2. **Pure, testable core** — all parsing and decision logic lives in a DOM-free
   module that also runs under Node.
3. **Fail loud and specific** — every failure names the cookies, lines or
   characters involved, with a machine-readable code and an actionable hint.
4. **Never silently wrong** — "I could not understand this" always beats a
   plausible but incorrect payload.

## Layout

```
index.html              Shell, semantic markup, strict CSP
404.html                Static-host fallback (same design language)
sw.js                   Network-first service worker (offline)
site.webmanifest        Installable metadata
_headers                Security headers for Netlify / Cloudflare Pages
assets/
  converter.js          Pure conversion engine — UMD (browser global + CommonJS)
  app.js                UI layer: DOM, files, clipboard, theme, toasts
  style.css             Design system: tokens → materials → components
  favicon.svg           Vector favicon
  icon-maskable.svg     Maskable PWA icon
tests/
  converter.test.js     61 engine tests
  app.test.js           29 UI integration tests
  helpers/dom-stub.js   Mini DOM + deterministic clock (no jsdom)
scripts/
  check.js              Consistency guard rails
  serve.js              Zero-dependency static server
docs/                   This documentation
```

## The engine (`assets/converter.js`)

One UMD-wrapped module. In a browser it publishes `window.CookieConverter`; in
Node it is `require`-able, which is how the tests drive it. It never touches the
DOM, storage, timers or the network, and it is deterministic for any given
`(text, nowSec)`.

### Pipeline

```
                       ┌──────────────┐
  text ──► detectFormat│ netscape     │──► entries[] ──► selectRequired ──► buildPayload
                       │ json         │                    │                    │
                       │ header       │                    │                    ▼
                       │ curl         │                    │            { cookie, sapisid }
                       │ set-cookie   │                    ▼
                       └──────────────┘            checklist · missing · expiredOnly ·
                                                   invalid · warnings · info · stats
```

Each stage is exported on its own (`parseNetscape`, `parseJsonExport`,
`parseRawHeader`, `parseCurl`, `parseSetCookie`, `selectRequired`,
`buildPayload`, `auditRequired`) so the UI, the tests and other tools can use
them independently. `convert()` is the one-call convenience wrapper that returns
the full result object the UI renders — see [api.md](api.md).

### Key decisions

* **Detection before parsing, not by trial and error.** `detectFormat()` makes a
  single linear pass and returns `json | curl | set-cookie | netscape | header |
  empty`. Ordering matters: a `Set-Cookie` line such as
  `SID=a; Domain=…` is *also* a legal `name=value` list, so attribute-bearing
  input is classified before header input, and a header string can never be
  silently misread as a Netscape file.
* **No backtracking regexes.** Header detection used to rely on a nested
  quantifier; it is now a linear scan over `;`-separated pairs, so a
  pathological input (megabytes of `=`) cannot hang the tab.
* **Separation of concerns in failure handling.** Bad *lines* are reported and
  skipped; a bad *input shape* is an error; a bad *value* is only an error if the
  value would be used (an unusable duplicate never blocks a usable one).
* **Time is injected.** Every expiry-aware function accepts `nowSec`, which keeps
  the tests deterministic and makes the engine usable in other time zones or
  after a clock correction.
* **Structured errors.** `ConversionError` carries `code`, `details` and `hint`.
  The UI renders `hint` as the second line of the banner; the tests assert on
  `code`.
* **Value validation is part of the contract.** `valueIssue()` encodes what a
  `Cookie:` header cannot represent (`;`, whitespace, control characters,
  emptiness). This is why the output is always safe to hand to an HTTP client —
  and why a crafted export cannot inject header content.
* **Extras are opt-in.** Required and optional cookie sets are separate:
  optional cookies never appear in `missing`/`expiredOnly` and never block a
  conversion, but are appended to the payload when present and requested.
* **Defensive copies at the boundary.** `REQUIRED`, `SUGGESTED_EXTRA`,
  `EXPECTED_DOMAINS`, `FORMATS` are frozen internally and returned as copies —
  a consumer mutating them cannot change engine behaviour (regression-tested).

### Result object

`convert()` always returns the same shape, successful or not, so the UI never
needs to guess:

| Field | Meaning |
| --- | --- |
| `ok` | conversion produced a payload |
| `code`, `error`, `hint` | machine + human failure description |
| `payload` / `json`, `raw` | `{cookie, sapisid, extras}` and the bare cookie string |
| `entries` | everything parsed, each carrying `domain`, `expires`, `expired`, `secure`, `httpOnly`, `sameSite`, `line`, `source`, `selected` |
| `selected` | name → the entry that was actually used |
| `checklist`, `missing`, `expiredOnly`, `invalid` | per-required-cookie status |
| `warnings`, `info` | user-facing notes, warnings first |
| `stats` | `parsed`, `skipped`, `comments`, `malformed[]`, `lines`, `chars`, `truncated` |
| `format`, `passthrough`, `options` | what was detected and which options applied |

## The UI (`assets/app.js`)

A single IIFE, no framework, no virtual DOM. It is organised into numbered
sections: boot guard → elements → constants → helpers → banners/toasts →
preferences → rendering → actions → live input metadata → theme → output
toggles → wiring → service worker.

Design notes:

* **Boot guard.** If `assets/converter.js` failed to load, the page shows an
  explicit banner instead of appearing to work (regression-tested).
* **Null-tolerant element lookups.** Every element is fetched once; handlers are
  attached through a small `on()` helper that skips missing nodes, so a trimmed
  or themed-down deploy degrades instead of throwing.
* **State lives in one object** (`state`) with four fields: the last result, the
  payload, the formatting choice, and the table window. Everything else is
  derived at render time.
* **Rendering is one-way**: handlers → `convert()` → `render(result)` → DOM.
  Nothing reads state back out of the DOM except the two toggles that *are* the
  state (reveal, filter).
* **Rendering is bounded.** The audit table renders at most 400 rows (4000 on
  demand), filtering and sorting run on the parsed array, and rows are appended
  through a single `DocumentFragment` — one reflow regardless of size.
* **Stale results are marked, not silently kept.** Editing the input dims the
  result card and labels it *stale* until the next conversion.
* **Timers are injected-style.** The DOM stub replaces `setTimeout` with a
  controllable clock, which is why toast and debounce behaviour is testable and
  never keeps Node alive.
* **No markup from data.** Icons come from CSS masks; all user data is written
  with `textContent`; `npm run check` fails if a dynamic `innerHTML` reappears.
* **Accessibility** is built in, not bolted on: labelled regions, `role="status"`
  live regions for banners and toasts, `aria-pressed` on the segmented control,
  a real `<table>` with `<caption>` and `scope="col"`, a skip link, visible focus
  rings, and keyboard equivalents for every pointer interaction (including the
  dropzone).

## Testing strategy

Two suites, both dependency-free (`node:test`):

* `tests/converter.test.js` (61 cases) drives the engine directly: every format,
  every alias, selection rules, value validation, limits, prototype-pollution
  resistance, and a 20 000-row performance smoke test.
* `tests/app.test.js` (29 cases) boots the real `app.js` inside
  `tests/helpers/dom-stub.js`, a ~450-line DOM that reads its element ids from
  `index.html`. Integration bugs a static app normally ships with — typo'd ids,
  crashes in `render()`, a handler that never fires — fail the suite.

`scripts/check.js` covers the rest of the "static site rot": version drift
between `package.json`, the engine, the service worker, the footer and the
changelog; DOM ids referenced but not defined; CSP directives that no longer
match the markup; the two copies of the light theme palette drifting apart;
broken links in any Markdown file; leftover `console.log`/`debugger`/`TODO`;
and shipped-asset size. Details in [testing.md](testing.md).

## Performance budget

| Concern | Approach |
| --- | --- |
| Input | 5 MB hard cap, refused before parsing |
| Parse | single split, one detection pass, O(n) with no backtracking |
| Memory | 200 000-entry cap; entries are flat objects |
| DOM | ≤ 400 rows by default, one fragment append, delegated table events |
| First paint | two ordinary `<script>` tags, no fonts, no third-party requests; theme from `prefers-color-scheme` so there is no flash |
| Offline | network-first service worker; cache only as fallback |
| Payload | ~19 KB of JS, ~29 KB of CSS raw (~7 KB + ~6 KB gzipped) |

## Why not a framework / bundler / TypeScript?

Because the value of this tool is *auditability*: four files you can read in a
sitting, no install step, and a deployment that is literally `git push`. A build
pipeline would add a supply chain without adding correctness. The trade-off is
that the project relies on its own checks (`npm run verify`) instead of a
compiler — which is precisely what `scripts/check.js` and the 90 tests are for.

## Extension points

* **Different target service** — `convert(text, { required, expectedDomains })`
  makes the engine generic; the Gemini-specific defaults live in constants.
* **New input format** — add a parser returning the standard parse result, then a
  branch in `detectFormat`/`parseAuto`; the selection, validation and UI layers
  need no changes.
* **New UI surface** — everything the UI needs is already in the result object;
  nothing is computed by reaching into the engine's internals.
