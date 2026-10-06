# Testing

```bash
npm run verify     # the whole gate: consistency checks, then the test suite
npm run check      # scripts/check.js only
npm test           # the 92 tests
npm run test:watch # re-run on change
```

There is **nothing to install** — the suite uses Node's built-in test runner
(`node:test`, Node ≥ 18) and a hand-written DOM. No Jest, no jsdom, no coverage
service.

---

## What runs, and why

### 1 · `scripts/check.js` — consistency guard rails

Static analysis for the failure modes a dependency-free, build-free project
cannot catch with a compiler:

| Check | Catches |
| --- | --- |
| Versions agree | `package.json`, `assets/converter.js`, `sw.js`, the footer and the changelog drifting apart |
| DOM wiring | `app.js` looking up an element id that no longer exists in `index.html` (and ids nothing uses) |
| Status classes | a class the JS toggles (`check-ok`, `note-warn`, `badge-invalid`, …) with no CSS rule |
| CSP | directives removed from the meta tag, `'unsafe-inline'`/`'unsafe-eval'` sneaking in, inline `style=` or `onclick=` in the markup |
| Injection safety | a non-literal `innerHTML` assignment, `eval`, `new Function`, `document.write` |
| Theme tokens | the two copies of the light palette (media query + explicit theme) drifting apart |
| File references | broken `src`/`href`, missing service-worker precache entries, missing manifest icons |
| Docs links | a Markdown link pointing at a deleted file |
| Formats | the documented formats and the engine's `FORMATS` list disagreeing |
| Hygiene | `console.log`, `debugger`, `TODO`, oversized assets, a `.gitignore` that stopped blocking cookie files |

### 2 · `tests/converter.test.js` — engine (61 cases)

Coverage by area:

* **Netscape**: full conversion, `#HttpOnly_`, comments vs malformed accounting,
  whitespace fallback, tabs inside values, CRLF, UTF-8 BOM, session cookies,
  20 000-row performance smoke test.
* **JSON**: extension arrays, aliases (`key`/`val`/`host`/`expiry`/`isSecure`),
  DevTools ISO dates, millisecond timestamps, storage-state `{cookies:[…]}`,
  plain maps, single objects, invalid rows skipped, empty array, prototype
  pollution, passthrough payloads (matching, mismatched and missing `sapisid`).
* **Headers / cURL / Set-Cookie**: raw header, `Cookie:` prefix, line breaks,
  quoted values, duplicate resolution, every cURL quoting style, `-b` with a
  file path, missing cookie header, attributes, `Max-Age`.
* **Detection**: all six shapes, comments-only input, and a pathological
  megabyte-of-`=` input that must stay linear.
* **Selection**: domain precedence, foreign-domain fallback + warning, duplicate
  resolution by expiry then last occurrence, expired duplicates, `allowExpired`,
  `weak` checklist status.
* **Values & limits**: semicolons, whitespace, empty values, placeholder
  warnings, oversized input, entry caps.
* **API**: `buildPayload` error codes, custom `required`/`expectedDomains`,
  optional extras, `auditRequired`, defensive copies, empty input.

### 3 · `tests/app.test.js` — UI integration (29 cases)

`assets/app.js` is executed for real inside `tests/helpers/dom-stub.js`:

* the stub reads every `id="…"` from `index.html`, so the UI tests fail if the
  markup and the wiring disagree;
* it implements the DOM surface the app touches (element tree, bubbling events,
  `closest`, `classList`, `dataset`, `textContent`, `document.createDocumentFragment`);
* `setTimeout` is replaced by a deterministic clock, so toast and debounce
  behaviour is testable and nothing keeps Node alive.

Covered: boot and version banner, successful and failing conversions, checklist
statuses, masked/revealed values, per-cell reveal, filtering and the required-only
toggle, skipped-line report, warning vs info styling, paste auto-convert, live
format badge, stale marking, disabled Convert button, drop-to-load, oversized
file, drag highlight, advanced options with persistence, allow-expired flow,
pretty/minified toggle, clipboard with fallback, both downloads, theming
(system → explicit → stored), toast dedupe/cap/dismiss, `Ctrl`+`Enter`,
`Escape`, sample loading, `Clear`, and "no cookie value ever reaches storage".

---

## The DOM stub

`tests/helpers/dom-stub.js` (~450 lines) is intentionally minimal and explicit:
it implements only what the app uses, and it is not a general-purpose DOM
implementation. If you add a DOM API to `app.js`, add it there too — a missing
method fails loudly with a clear stack trace rather than silently passing.

```js
const { createRealm, makeFile } = require('./helpers/dom-stub.js');

const realm = createRealm({ prefersLight: true, theme: 'dark', prefs: { extra: true } });
realm.document.getElementById('input').value = netscapeText;
realm.document.getElementById('convert').click();
realm.clock.runDue(300);          // run timers scheduled within 300 ms

console.log(realm.document.getElementById('output').value);
realm.fire('keydown', { key: 'Enter', ctrlKey: true });  // document-level events
```

Options: `prefersLight`, `theme` (a stored preference), `prefs` (advanced
toggles), `protocol`, `navigator` (to simulate a missing Clipboard API).

---

## Adding tests

1. Pick the right file: engine behaviour → `converter.test.js`; anything that
   involves the DOM, wiring, timers or user flows → `app.test.js`.
2. Prefer **behaviour** over implementation: assert on the returned result or on
   the rendered DOM, not on private helpers.
3. Always inject `nowSec` in engine tests — never depend on the wall clock.
4. For UI tests, use real-clock-relative timestamps (`NOW = Date.now()/1000`)
   because the app converts against the real clock.
5. Add a regression test with every bug fix, and mention the bug in a comment
   when the case is subtle.
6. Run `npm run verify` before opening a pull request.

## Testing without the suite

* **Manual smoke test:** `npm run serve` then open
  <http://localhost:8080> — press *Load sample*, *Convert*, and check the notes.
* **Offline test:** load the page once, then switch DevTools → Network →
  *Offline* and reload; the app must still work from the service-worker cache.
* **CSP test:** the console must show no CSP violations. Any violation is a
  bug — the page ships `default-src 'none'`.
* **Accessibility spot-check:** tab through the page; every interactive element
  must show a focus ring and be reachable, `Escape` must clear toasts, and the
  requested/required checklist must be announced.

## Performance checks

The suite includes a 20 000-cookie conversion that must finish well under two
seconds (it typically takes single-digit milliseconds). For a real stress test,
concatenate several browser exports up to the 5 MB limit and confirm the page
stays responsive: parsing is capped, the table renders 400 rows, and the notes
tell you if the entry cap was hit.
