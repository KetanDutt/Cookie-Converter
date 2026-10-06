# 🍪 Gemini Cookie Converter

> Convert browser cookie exports into the JSON structure used by
> [gemini-web2api](https://github.com/Sophomoresty/gemini-web2api) —
> **100% client-side, zero dependencies, no build step.**

```json
{
  "cookie": "SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...",
  "sapisid": "..."
}
```

[gemini-web2api](https://github.com/Sophomoresty/gemini-web2api) needs your
Gemini cookies as a single JSON payload. Exporting them from the browser
gives you Netscape `.txt` files, extension JSON, or raw header strings —
this tool turns any of those into the payload, safely and offline.

## Features

* ✅ **Four input formats, auto-detected** — Netscape/curl files (including
  `#HttpOnly_` lines), browser-extension JSON arrays, name/value JSON maps,
  and raw `Cookie` header strings
* ✅ **Smart selection** — prefers cookies scoped to `gemini.google.com`,
  ignores same-named cookies from unrelated sites, picks the freshest value
* ✅ **Expiry validation** — expired cookies are rejected with a clear
  message instead of producing a broken config
* ✅ **Cookie audit table** — see exactly what was parsed, with values
  **masked by default** (opt-in reveal)
* ✅ **Drag & drop, file browse, clipboard paste**, `Ctrl+Enter` to convert
* ✅ **Pretty or minified output**, one-click copy (with fallback) and
  `cookie.json` download
* ✅ **Dark & light themes**, responsive layout, accessible status messages
* ✅ **Hardened** — strict Content-Security-Policy, no network requests, no
  analytics, no storage of cookie data
* ✅ **Tested** — 21 dependency-free unit tests (`npm test`)

## Quick start

### Use it

Open `index.html` directly in your browser, or serve it:

```bash
python3 -m http.server 8080 --bind 0.0.0.0
# → http://localhost:8080
```

### Convert

1. Drop your exported cookie file (or paste the contents).
2. Click **Convert** (`Ctrl+Enter` works too).
3. Copy or download `cookie.json` and hand it to gemini-web2api.

Need cookies first? See [docs/exporting-cookies.md](docs/exporting-cookies.md).

## Privacy & security

Everything runs inside your browser tab. The page ships a strict CSP
(`default-src 'none'; script-src 'self'; …`), makes **no network requests**,
stores nothing, and masks cookie values in the UI by default. Cookie files
are bearer credentials — treat them like passwords and read
[docs/security.md](docs/security.md) before exporting.

## Project structure

```
index.html          App shell + strict CSP
assets/
  converter.js      Pure, dependency-free conversion engine (browser + Node)
  app.js            UI wiring (DOM, files, clipboard, theme)
  style.css         Theme-aware styles
  favicon.svg
tests/
  converter.test.js Test suite (Node built-in runner)
docs/               Full documentation
```

## Development

Requires Node ≥ 18 for the tests. There is nothing to install.

```bash
npm test    # run the unit tests
npm run serve  # static server for local preview
```

The architecture, parsing pipeline, and design decisions are documented in
[docs/architecture.md](docs/architecture.md).

## Deployment

Any static host works — GitHub Pages, Netlify, Cloudflare Pages, S3, nginx,
or a USB stick. Step-by-step instructions: [docs/deployment.md](docs/deployment.md).

## Documentation

* 📄 [docs/](docs/README.md) — documentation index
* 🧾 [Cookie formats](docs/formats.md) — inputs and the output structure
* 📤 [Exporting cookies](docs/exporting-cookies.md) — browser walkthroughs
* 🛠 [Troubleshooting](docs/troubleshooting.md) — common errors and fixes
* 🔒 [Security & privacy](docs/security.md)
* 🚀 [Deployment](docs/deployment.md)
* 🏗 [Architecture](docs/architecture.md)
* 🗂 [Changelog](docs/changelog.md)

## License

[MIT](LICENSE)

---

*Disclaimer: this project is not affiliated with Google. Only convert
cookies from accounts you own and are permitted to use.*
