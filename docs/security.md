# Security & privacy

## What the converter does with your data

**Nothing leaves your machine.** Specifically:

* Parsing, validation and payload generation run entirely inside your browser
  tab. `assets/converter.js` is a pure function library — it has no DOM, no
  `fetch`, no `XMLHttpRequest`, no `WebSocket`, no `sendBeacon`.
* The page makes **zero network requests** and proves it with a strict
  `Content-Security-Policy`:

  ```
  default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'none'; worker-src 'self'; manifest-src 'self';
  base-uri 'none'; form-action 'none'
  ```

  No inline scripts, no `eval`, no third-party resources, no fonts, no CDNs, no
  analytics. `connect-src 'none'` means even a hypothetical injected script
  could not exfiltrate anything over the network.
* `Referrer-Policy: no-referrer` (meta tag plus the optional [`_headers`
  file](../_headers)) so nothing leaks through the `Referer` header either.
* Nothing about your cookies is persisted: no `localStorage`, no cookies, no
  IndexedDB, no cache entry. The only stored values are the light/dark theme
  preference and the two advanced toggles, all in `localStorage`.
* Cookie values are **masked in the results table by default**. “Show values” is
  opt-in, and even then a single cell can be revealed without exposing the rest.
* Values are never written to the console, to DOM attributes, to the URL, or to
  `document.title`.
* All DOM text is inserted with `textContent`/`createElement`; no dynamic
  `innerHTML` exists anywhere (`npm run check` enforces both rules).
* `Clear` erases the textarea, the output, the parsed state and the table.

You can verify every claim above by reading four files — `index.html`,
`assets/style.css`, `assets/converter.js`, `assets/app.js` — which is the whole
application. `npm run check` re-verifies the CSP, the absence of `eval` and the
absence of dynamic `innerHTML` on every build.

## The service worker

Offline support is implemented as a **network-first** service worker
(`sw.js`):

* When you are online, every request goes to the network first — a deployed
  update is picked up immediately.
* Only same-origin `GET` responses of *application files* are cached, as a
  fallback for offline use.
* Nothing about your cookies is ever part of a cached response: the tool never
  sends them anywhere, so no response can contain them.
* The cache is versioned (`gcc-static-<version>`) and previous versions are
  deleted on activation.
* No service worker is registered when the page is opened from `file://` or in a
  browser without service worker support — the app works exactly the same.

## Validating what you paste

The converter refuses input that would produce a broken payload instead of
guessing. This is a security property too: values containing `;`, whitespace or
control characters cannot be smuggled into a `Cookie:` header, so a malicious
export cannot inject extra header content into the payload you hand to
gemini-web2api.

* Input size is capped at 5 MB and entry parsing at 200 000 cookies, so a
  hostile file cannot freeze the tab.
* `__proto__`/`constructor`/`prototype` keys in JSON maps are ignored, so a
  crafted export cannot pollute object prototypes.
* Malformed lines are reported, never eval'd, never rendered as markup.

## Handling cookie files safely

These cookies are **bearer credentials**: whoever holds them can use your
Google/Gemini session until they expire.

1. **Export only what you need** — export for `gemini.google.com` on the
   signed-in tab, not your entire browser.
2. **Move, don't linger.** Convert, copy the payload where gemini-web2api runs,
   then delete the raw export *and* `cookie.json` from your Downloads folder.
3. **Never share them** — not in issues, screenshots, chat logs, or commits.
   This repository's `.gitignore` blocks common cookie filenames for exactly
   this reason, and CI fails if a `cookies.txt`-style file is ever committed.
4. **Never paste them into an online service.** If a website asks you to upload
   your cookie file, treat it as hostile by default — including deployments of
   this tool that you have not read.
5. **Prefer local tools.** Host it yourself if you want maximum trust: it is a
   handful of static files (see [deployment](deployment.md)).
6. **Rotate on suspicion.** Changing your Google password, or using “Sign out of
   all devices”, invalidates leaked cookies.
7. **Beware of browser extensions.** *Any* extension you install can read every
   cookie in your browser. Use a well-known, open-source exporter, or
   Option A/D from [exporting-cookies.md](exporting-cookies.md) which require no
   extension at all.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Exfiltration by the page itself | `connect-src 'none'` + no network code in the sources |
| Tampered third-party script | No third-party scripts; `script-src 'self'` |
| XSS through a crafted export | `textContent`-only rendering; no dynamic `innerHTML`; `npm run check` fails the build if that changes |
| Prototype pollution via JSON | Unsafe keys skipped; internal maps use `Map`/null-prototype objects |
| Header injection via cookie values | Values validated before the payload is built |
| Resource exhaustion (DoS) | 5 MB input cap, 200 000 entry cap, chunked table rendering |
| Shoulder surfing / screen sharing | Values masked by default, per-cell reveal |
| Referrer leakage | `no-referrer` meta tag and header |
| Clickjacking of a self-hosted copy | `frame-ancestors 'none'` + `X-Frame-Options: DENY` in `_headers` |
| Supply chain | Zero dependencies, zero build step, `npm ls` is empty by definition |

## Reporting a vulnerability

Please open a **private** security advisory on GitHub (Security → Advisories →
*Report a vulnerability*) rather than a public issue, and include a minimal
reproduction. Do not include real cookie values in the report — replace them
with placeholders that keep the same shape.

This project is not affiliated with Google. It only manipulates data you already
own, in your own browser.
