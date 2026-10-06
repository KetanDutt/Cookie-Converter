# 🍪 Gemini Cookie Converter

> Turn **any** browser cookie export into the JSON payload that
> [gemini-web2api](https://github.com/Sophomoresty/gemini-web2api) expects —
> **100% client-side, zero dependencies, no build step, no tracking.**

```json
{
  "cookie": "SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…",
  "sapisid": "…"
}
```

[gemini-web2api](https://github.com/Sophomoresty/gemini-web2api) needs your
signed-in Gemini cookies as a single payload. Browsers hand them to you in half
a dozen awkward shapes — this tool accepts all of them, validates them, and
produces the payload without a single byte leaving your browser tab.

**[Open the converter »](index.html)** · [Documentation](docs/README.md) ·
[Formats](docs/formats.md) · [Troubleshooting](docs/troubleshooting.md)

---

## Features

### Input — five formats, auto-detected

| Format | Where it comes from |
| --- | --- |
| **Netscape / curl cookie file** | `curl` jars, *Get cookies.txt LOCALLY*, `cookies.txt` — including `#HttpOnly_` lines |
| **JSON exports** | Cookie-Editor, EditThisCookie, Chromium DevTools *Copy all as JSON*, Puppeteer/Playwright storage state, Firefox `cookies.sqlite` dumps, plain `{name: value}` maps |
| **Raw `Cookie` header** | DevTools → Network → Request Headers |
| **`Set-Cookie` headers** | DevTools → Network → Response Headers (attributes are understood, not mistaken for cookie names) |
| **Copy as cURL** | DevTools → right-click a request → *Copy as cURL* (bash, zsh `$'…'` and PowerShell quoting) |

Already have a payload? A `{"cookie": …, "sapisid": …}` object is validated and
passed through — a mismatched `sapisid` is corrected, and a missing one is
derived for you.

### Processing — correct, not just plausible

* **Smart selection** — prefers `gemini.google.com`, then `google.com`, ignores
  same-named cookies from unrelated domains, and picks the freshest value when
  several exist.
* **Expiry validation** — expired cookies are rejected with a specific message
  instead of producing a config that fails hours later. Session cookies
  (`expiry 0`) and millisecond/ISO-8601 timestamps are handled.
* **Value validation** — cookie values containing `;`, whitespace or control
  characters cannot be sent in a `Cookie:` header, so they are refused with an
  explanation rather than silently producing a broken header.
* **Audit trail** — every parsed cookie is listed with domain, human-readable
  expiry and flags; skipped lines are reported with line numbers; notes tell
  you exactly which decision was made and why.
* **Incomplete payloads are repaired** — a `{cookie: …}` object without
  `sapisid`, or with a `sapisid` that does not match its own cookie string, is
  fixed and flagged.

### Output — ready to paste or drop in

* **Pretty / minified** JSON, one-click copy, `cookie.json` download.
* **`cookie.txt` download** — the same value as the single-line cookie file
  gemini-web2api accepts via `--cookie-file cookie.txt`.
* Optional **extra Google cookies** (`__Secure-1PSIDTS`, `SIDCC`, …) for
  long-lived sessions, and an opt-in “allow expired” escape hatch for clock skew.

### Experience

* Liquid-Glass UI with dark/light/system theming, drag & drop, clipboard-file
  paste, live format detection, filterable audit table, `Ctrl`/`Cmd`+`Enter`
  to convert, toasts and inline banners.
* Fully keyboard accessible, screen-reader labelled, `prefers-reduced-motion`
  and `prefers-contrast` aware, and usable with JavaScript-only (no server
  round-trips anywhere).
* **Installable & offline** — a web manifest and a network-first service worker
  make it work on a plane; nothing is ever fetched with your data.
* Hardened: strict `Content-Security-Policy` (`default-src 'none'`), no network
  requests, no analytics, no cookie value written to storage, DOM attributes,
  URLs or the console. Values are masked in the UI until you ask to see them.

## Quick start

```bash
git clone https://github.com/KetanDutt/Cookie-Converter
cd Cookie-Converter
npm run serve          # → http://localhost:8080   (or just open index.html)
```

1. Drop your exported cookie file (or paste the contents).
2. Press **Convert** — `Ctrl`/`Cmd`+`Enter` works too.
3. Copy or download `cookie.json` and hand it to gemini-web2api.

Need cookies first? See [docs/exporting-cookies.md](docs/exporting-cookies.md).

## Privacy & security

Everything runs inside your browser tab. The page ships a strict CSP, makes
**no network requests**, stores nothing, and masks cookie values by default.
Cookie files are bearer credentials — treat them like passwords and read
[docs/security.md](docs/security.md) before exporting.

## Project structure

```
.nojekyll             Serve the tree verbatim on GitHub Pages (no Jekyll build)
index.html            App shell, strict CSP, semantic markup
404.html              Static-host fallback page in the same material language
sw.js                 Network-first service worker (offline support)
site.webmanifest      Installable app metadata
_headers              CSP + security headers for Netlify / Cloudflare Pages
assets/
  converter.js        Pure conversion engine (browser global + CommonJS)
  ui.js               UI primitives — icons, toasts, popover, dialog, tabs
  app.js              UI wiring: DOM, files, clipboard, theme, toasts
  style.css           Liquid-Glass design system (tokens → materials → components)
  favicon.svg         Inline-vector favicon
  icon-maskable.svg   Maskable PWA icon
tests/
  converter.test.js   61 engine tests (formats, selection, limits, security)
  app.test.js         29 UI integration tests on a dependency-free DOM stub
  helpers/dom-stub.js Mini DOM + fake clock used by the UI tests
scripts/
  check.js            Consistency guard rails (`npm run check`)
  serve.js            Zero-dependency static server (`npm run serve:node`)
docs/                 Full documentation — start at docs/README.md
```

## Development

Requires **Node ≥ 18** for the tests. There is nothing to install — the project
has no runtime or development dependencies, by design.

```bash
npm run check     # versions, DOM wiring, CSP, docs links, theme tokens, hygiene
npm test          # 107 tests: engine + UI integration
npm run verify    # both, in one go — the project's only gate
npm run serve     # static preview on :8080 (Python or `serve:node`)
```

There is no CI service and no pipeline to wait for: `npm run verify` is the
gate, and it checks everything the project relies on (including the shipped file
set and that no cookie export is ever tracked by git).

* [docs/architecture.md](docs/architecture.md) — how the engine and UI fit together
* [docs/api.md](docs/api.md) — the programmatic engine API
* [docs/testing.md](docs/testing.md) — what is tested and how to extend it
* [docs/design.md](docs/design.md) — the design system and its tokens
* [CONTRIBUTING.md](CONTRIBUTING.md) — workflow and review checklist

## Deployment

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, S3, nginx, a
USB stick or `file://`. Step-by-step instructions, including the security-header
templates, are in [docs/deployment.md](docs/deployment.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/](docs/README.md) | Documentation index |
| [Formats](docs/formats.md) | Every accepted input shape and the output structure |
| [Exporting cookies](docs/exporting-cookies.md) | Browser walkthroughs for each export method |
| [Troubleshooting](docs/troubleshooting.md) | Fixes for every error the tool can produce |
| [Security & privacy](docs/security.md) | Threat model, guarantees and safe handling |
| [Architecture](docs/architecture.md) | Module design, pipeline, performance budget |
| [API reference](docs/api.md) | `CookieConverter.convert()` and friends |
| [Testing](docs/testing.md) | The suite, the DOM stub, and how to add cases |
| [Design system](docs/design.md) | Tokens, glass materials, motion, accessibility |
| [Deployment](docs/deployment.md) | Static hosting, headers, offline behaviour |
| [FAQ](docs/faq.md) | Short answers to the usual questions |
| [Changelog](docs/changelog.md) | Version history |

## License

[All rights reserved](LICENSE). This repository and its contents are provided for
viewing and evaluation purposes only: no permission is granted to use, copy,
modify, distribute or create derivative works from it, commercial use is
prohibited without a separate written licence, and it may not be used to train
machine-learning models. Licensing questions and commercial permissions:
[LICENSE](LICENSE) lists the contact address.

You can always run the official deployment without installing anything — the
app itself runs entirely in your browser.

---

*Disclaimer: this project is not affiliated with Google. Only convert cookies
from accounts you own and are permitted to use.*
