# Security & privacy

## What the converter does with your data

**Nothing leaves your machine.** Specifically:

* Parsing, validation, and JSON generation run entirely in your browser tab.
* The page makes **zero network requests** with your data — and proves it
  with a strict `Content-Security-Policy` (`default-src 'none'; script-src
  'self'; style-src 'self'; img-src 'self' data:`). No inline scripts, no
  third-party resources, no analytics, no fonts, no CDNs.
* Nothing is persisted: cookie values are never written to
  `localStorage`/`cookies`/IndexedDB. Only your light/dark theme choice is
  stored.
* Values are **masked in the results table by default** ("Show values" is
  opt-in), so a shoulder-surfed or screenshared screen doesn't leak secrets.
* Cookie values are never written to `console`, DOM attributes, or URLs.

You can verify all of this by reading the three source files — the entire
application is `index.html` + `assets/style.css` + `assets/converter.js` +
`assets/app.js`.

## Handling cookie files safely

These cookies are **bearer credentials**: whoever holds them can use your
Google/Gemini session until they expire.

1. **Export only what you need** — export for `gemini.google.com` on the
   signed-in tab, not your entire browser.
2. **Move, don't linger.** Convert, copy `cookie.json` to where
   gemini-web2api runs, then delete the raw export and the JSON from your
   Downloads folder.
3. **Never share them** — not in issues, screenshots, chat logs, or commits.
   This repository's `.gitignore` blocks common cookie filenames for exactly
   this reason.
4. **Prefer local tools.** If you convert on someone else's deployment, read
   their source first; this project is designed to be auditable in minutes.
5. **Rotate on suspicion.** Change your Google password (or use
   "Sign out of all devices") to invalidate leaked cookies.
6. **Host it yourself** for maximum trust — it's four static files; see
   [deployment](deployment.md).

## Threat model notes

* The strict CSP blocks exfiltration channels (no `connect-src`, no remote
  scripts) even if the page were somehow tampered with at runtime.
* The app is safe to open via `file://` (no secure-context-only features are
  required; the copy button has a non-clipboard-API fallback).
* Input size is capped at 5 MB to keep the tab responsive against huge or
  malicious files; parsing is single-pass and linear in input size.
