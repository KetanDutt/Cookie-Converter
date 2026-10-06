# Changelog

All notable changes to this project. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-06

### Added

* **JSON export support** — browser-extension arrays (`Cookie-Editor` /
  EditThisCookie / DevTools shapes), plain name/value maps, and
  already-converted gemini-web2api JSON (passed through untouched).
* **Raw `Cookie` header input** — paste `SID=...; HSID=...` directly.
* Automatic **input format detection**.
* **Domain-aware selection**: prefers `gemini.google.com`, then
  `.google.com`; warns about same-named cookies from unrelated domains.
* **Expiry validation**: expired required cookies are rejected with a clear
  message; session cookies are accepted; table shows human-readable dates.
* New UI: drag & drop file zone, clipboard file paste, cookie audit table
  with **masked values** and opt-in reveal, pretty/minified output toggle,
  sample loader, success/warning/error banners, stats line, dark/light
  theme toggle (persisted), keyboard shortcut `Ctrl+Enter`, footer,
  custom 404 page, favicon.
* Strict **Content-Security-Policy** meta tag (`default-src 'none'`).
* Test suite: 21 dependency-free tests via Node's built-in runner.
* Documentation site under `docs/` and a rewritten README.
* MIT license and `.gitignore` guarding against committing cookie files.

### Fixed

* **`#HttpOnly_` lines were skipped as comments**, silently dropping the
  required cookies from standard curl/extension exports. They are now parsed
  correctly and flagged HttpOnly.
* Whitespace-fallback parsing re-joined split values with tabs, corrupting
  values that contained spaces; values now round-trip with the original
  separator.
* Same-named cookies from **any domain** were accepted in last-wins order;
  selection is now deterministic and scoped to Google/Gemini domains.
* Expired cookies were accepted silently.
* Download: the blob URL was revoked immediately and the anchor never
  attached to the document — fragile on some browsers. Now appended,
  clicked, removed, and revoked after a delay.
* Copy button: unhandled promise rejection when the Clipboard API is
  unavailable; now falls back to select + `execCommand`.
* File loading errors (unreadable/oversized files) are caught and reported.

### Changed

* Split the single-file app into `assets/converter.js` (pure, testable),
  `assets/app.js` (UI), and `assets/style.css`.

## [1.0.0] - initial release

* Single-file converter for Netscape cookie exports to gemini-web2api JSON.
