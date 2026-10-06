# Changelog

All notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/).

## [2.3.0] — 2026-10-06

Interface overhaul: the whole app is rebuilt as a "liquid glass" design system.
Every feature, keyboard shortcut, download and offline path is unchanged — this
release only touches how the app looks, moves and reads.

### Added

* **Tokenised glass material system** — `glass-sm` / `glass-md` / `glass-lg` /
  `glass-tint` layers built from shared tokens (surfaces, blurs, radii, shadows,
  motion, z-index). No hard-coded colours or timings in component rules, and an
  opaque fallback for browsers without `backdrop-filter`.
* **`assets/ui.js`** — a dependency-free UI layer (icons, toasts, popover,
  dialog, tabs, scroll reveal, pointer shine, number roll) so behaviour stays
  testable and no markup strings are built at runtime.
* **Icon sprite** — 24 original single-stroke symbols inlined in `index.html`;
  no external icon font, no network request, nothing inline-scripted.
* **Ambient background** — two very slow drifting gradient fields plus a subtle
  grain layer that give the glass something to refract. Both freeze under
  `prefers-reduced-motion`.
* **Guide dialog** — the five export methods moved into a native `<dialog>` with
  ARIA tabs, so the page stays scannable without a wall of instructions.
* **Empty, loading and stale states** — a first-run card, a skeleton for large
  inputs, and a *stale* badge when the textarea changes after a conversion.
* **Toasts** — floating glass confirmations, including an *Undo* action after
  Clear.
* **Motion tokens** — micro 120 ms, quick 180 ms, standard 260 ms, large
  340–460 ms, with a spring easing for entrances. Reduced-motion collapses them
  to state changes only.

### Changed

* **Layout** — a floating top bar with a gliding nav indicator, a sticky input
  card above the result column on desktop, and a thumb-friendly bottom bar with
  bottom sheets on phones.
* **Typography** — system/Inter stack with a stronger scale, larger titles and
  softer metadata; the mono stack is reserved for cookies, payloads and cURL.
* **Forms, tables and lists** — translucent inputs with calm focus rings,
  lighter row surfaces instead of a card per row, a sticky table header and
  click-to-reveal cookie values.
* **Dark mode** — deep neutral palette with controlled highlights instead of an
  inversion of the light theme; both palettes stay byte-identical between the
  system-preference and manual-theme blocks.
* **Accessibility pass** — visible focus rings everywhere, `aria-expanded` on
  the options panel, labelled icon buttons, a skip link, a live-region status
  banner and reduced-motion/reduced-transparency support.
* **`404.html`** — same glass language as the app instead of the old
  inline-styled page.

### Fixed

* The mobile bar's options button no longer opens and instantly closes the
  panel: the popover now treats both buttons as equal triggers and anchors
  itself to whichever one was pressed.

## [2.2.0] — 2026-10-06

Second hardening pass: two new input formats, a validated output contract, a
testable UI layer, and a self-checking repository. Still zero dependencies, no
build step, no network access.

### Added

* **`Copy as cURL` input** — paste the DevTools command line and the `Cookie:`
  header is extracted. Handles POSIX quoting, `$'…'` ANSI-C escapes
  (including `\x3B`), `\`/`^` line continuations, `-H/--header`,
  `-b/--cookie`, and every `--flag=value` form. A `-b cookies.txt` argument is
  explained instead of silently producing nothing.
* **`Set-Cookie` input** — response headers are parsed with their attributes
  (`Domain`, `Path`, `Expires`, `Max-Age`, `Secure`, `HttpOnly`, `SameSite`);
  attributes can no longer be mistaken for cookie names.
* **`cookie.txt` download** — gemini-web2api also accepts a plain single-line
  cookie file via `--cookie-file cookie.txt`; the UI now offers both payload
  shapes.
* **Optional extra cookies** — `__Secure-1PSIDTS`, `__Secure-3PSID`,
  `__Secure-1PAPISID`, `SIDCC` can be appended when present (Advanced options).
  They never affect the required-cookie validation.
* **Repair of partial payloads** — `{"cookie": "…"}` without `sapisid` is
  completed, and a `sapisid` that contradicts its own cookie string is corrected
  with a warning. Incomplete payloads pass through only with a loud warning.
* **Machine-readable errors** — `ConversionError` with `code`, `details` and
  `hint`; `ERROR_CODES` exported. All failures now name the offending cookie,
  line or character and suggest a fix.
* **Value validation** — values containing `;`, whitespace, control characters
  or nothing at all are refused before they can produce a broken `Cookie:`
  header.
* **Per-cookie checklist UI** — the six required cookies with `found`, `expired`,
  `missing`, `unusable value` or `other domain` status, visible even when the
  conversion fails.
* **Live format detection**, input size readout, stale-result marking, unreadable
  table filtering, required-only toggle, per-cell value reveal, "Show more" paging
  for very large exports, timing/statistics line, and a skipped-lines report with
  line numbers.
* **Offline & installable** — network-first service worker (`sw.js`), web
  manifest, maskable icon. Nothing is cached unless it is an application file.
* **Security headers file** for Netlify/Cloudflare Pages (`_headers`) and
  `meta[name=referrer]`.
* **Zero-dependency UI test harness** — `tests/helpers/dom-stub.js` runs the real
  `app.js` against a mini-DOM whose element ids come from `index.html`;
  29 integration tests cover the wiring, rendering, toasts, timers and theme.
* **`scripts/check.js`** — consistency guard rails: version lockstep, DOM wiring,
  CSP contents, injection safety, theme-token duplication, file and Markdown
  references, the shipped file set, tracked cookie exports, license metadata,
  leftover debris, asset sizes.
* **New documentation** — this file's siblings `api.md`, `testing.md`,
  `design.md`, `faq.md`, `contributing.md`, plus a rewritten README and a
  documentation index.

### Fixed

* **Toast stack could hang the tab** — the overflow loop re-dismissed toasts that
  were already animating out and never shrank the stack (infinite loop). Overflow
  toasts are now removed outright.
* **Optional cookies blocked conversions** — requesting an extra cookie that was
  absent was reported as a missing *required* cookie.
* **Crash with a custom `required` set** — `buildPayload` assumed `SAPISID` was
  present; it now returns `sapisid: null` when the required set has no SAPISID.
* **`-b`/`--cookie=` cURL forms were not detected** at the format-detection stage.
* **`detectFormat` could not see a `Set-Cookie` header** and treated its
  attributes as cookies.
* **Unusable duplicate values could win selection**; entries whose values cannot
  be used now sort last.
* **`allowExpired` was unreachable** through `convert()` — it is now honoured by
  the selection stage and reported in `usedExpired`.
* Comment lines were previously counted as "skipped"; comments and genuinely
  unreadable lines are now counted separately, so the report is meaningful.
* A JSON export with one bad row no longer aborts the whole conversion — bad
  rows are skipped and reported individually.
* `Set-Cookie`/DevTools ISO-8601 `expires` strings and millisecond timestamps are
  now parsed instead of being silently treated as session cookies.
* Theme flash on first paint: the light palette is applied via
  `prefers-color-scheme` before JavaScript runs.
* The result card no longer hides the checklist when a conversion fails.
* Copy failures no longer produce an unhandled promise rejection.

### Changed

* `assets/converter.js` rewritten in ES2015+ with JSDoc throughout, a documented
  pipeline and a linear (non-backtracking) format detector. The public API stays
  backward compatible (including the legacy `parsed`, `skipped`, `error.missing`
  and `error.expired` fields).
* `assets/app.js` rewritten as one auditable IIFE with a boot guard, null-tolerant
  element lookups, bounded rendering and no dynamically generated markup (toast
  icons are now CSS masks).
* `assets/style.css` extended with the checklist, notes, report, filter controls
  and disclosure styles; light palette tokens are duplicated deliberately (media
  query + explicit theme) and verified identical by `npm run check`.
* Documentation reorganised; `docs/README.md` is now a proper index with a
  "read it when you want to…" column.
* `package.json` gained `check`, `verify`, `test:watch`, `serve:node`, repository
  metadata and `engines`.
* **Licence aligned with the repository:** `package.json` (`UNLICENSED`), the page
  footer and the documentation now point at [LICENSE](../LICENSE) (All Rights
  Reserved) instead of claiming MIT. Deployment, security and FAQ copy was updated
  so it no longer suggests re-hosting or redistributing the software without
  permission.
* **No CI service.** The GitHub Actions workflow was removed at the maintainer's
  request; its two guarantees (the shipped file set, and "no cookie export is
  ever committed") moved into `npm run check`, so `npm run verify` stays the
  single gate. Nothing about the shipped app changed.

### Security

* CSP extended with `worker-src 'self'`, `manifest-src 'self'` and
  `connect-src 'none'`; `Referrer-Policy: no-referrer`; optional real headers in
  `_headers` including `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
* Input is size-capped (5 MB) and entry-capped (200 000) before allocation.
* `__proto__`/`constructor`/`prototype` keys in JSON maps are ignored.
* `Clear` now wipes the filter, the parsed state and the rendered table as well
  as the textarea and output.

---

## [2.1.0] — 2026-10-06

### Added — Liquid Glass design system

* Original translucent "Liquid Glass" visual language: layered glass materials
  (primary / secondary / floating), backdrop blur + saturation, inner edge
  highlights, soft ambient shadows, and a low-contrast ambient background the
  materials interact with.
* Centralized design tokens — colours, glass opacities, blur levels, radii,
  shadows, spacing, type scale, motion durations/easings, z-index layers.
* Floating glass top bar that gains material as you scroll.
* Floating glass toasts for transient events (file loaded, copied, downloaded,
  sample loaded) with spring enter/exit motion.
* Micro-interactions: gliding segmented-control thumb, animated theme-toggle icon
  crossfade, spring switch, dropzone drag/lift feedback, staggered table row
  entrances, file-loading spinner, hover lifts on buttons.
* First-class light theme (rebuilt, not inverted), `prefers-reduced-motion`
  support, GPU-friendly transform/opacity animations only.
* Redesigned 404 page in the same material language.

### Changed

* Visual redesign only — parsing engine, selection rules, output format,
  keyboard shortcuts and user flows unchanged (all 21 tests passed).

---

## [2.0.0] — 2026-10-06

### Added

* **JSON export support** — browser-extension arrays (Cookie-Editor /
  EditThisCookie / DevTools shapes), plain name/value maps, and already-converted
  gemini-web2api JSON (passed through untouched).
* **Raw `Cookie` header input** — paste `SID=…; HSID=…` directly.
* Automatic **input format detection**.
* **Domain-aware selection**: prefers `gemini.google.com`, then `.google.com`;
  warns about same-named cookies from unrelated domains.
* **Expiry validation**: expired required cookies are rejected with a clear
  message; session cookies accepted; the table shows human-readable dates.
* Drag & drop file zone, clipboard file paste, cookie audit table with **masked
  values** and opt-in reveal, pretty/minified output toggle, sample loader,
  success/warning/error banners, stats line, dark/light theme toggle
  (persisted), `Ctrl+Enter` shortcut, footer, custom 404 page, favicon.
* Strict **Content-Security-Policy** meta tag (`default-src 'none'`).
* Test suite: 21 dependency-free tests via Node's built-in runner.
* Documentation under `docs/` and a rewritten README.
* MIT license and a `.gitignore` guarding against committing cookie files.

### Fixed

* **`#HttpOnly_` lines were skipped as comments**, silently dropping the required
  cookies from standard curl/extension exports.
* Whitespace-fallback parsing re-joined split values with tabs, corrupting values
  that contained spaces.
* Same-named cookies from **any domain** were accepted in last-wins order;
  selection is now deterministic and scoped to Google/Gemini domains.
* Expired cookies were accepted silently.
* Download: the blob URL was revoked immediately and the anchor was never
  attached to the document — fragile on some browsers.
* Copy button: unhandled promise rejection when the Clipboard API was
  unavailable; now falls back to select + `execCommand`.
* File loading errors (unreadable/oversized files) are caught and reported.

### Changed

* Split the single-file app into `assets/converter.js` (pure, testable),
  `assets/app.js` (UI) and `assets/style.css`.

---

## [1.0.0] — initial release

* Single-file converter for Netscape cookie exports to gemini-web2api JSON.
