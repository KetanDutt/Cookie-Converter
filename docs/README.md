# Documentation

Everything you need to use, deploy, audit and extend the **Gemini Cookie Converter**.

## Start here

| Document | Read it when you want to… |
| --- | --- |
| [Cookie formats](formats.md) | understand what you can paste and what comes out |
| [Exporting cookies](exporting-cookies.md) | get cookies out of your browser safely (5 methods) |
| [Troubleshooting](troubleshooting.md) | fix an error message the tool gave you |
| [FAQ](faq.md) | get a short answer to a common question |
| [Security & privacy](security.md) | know exactly what happens to your data |

## Build, run, ship

| Document | Contents |
| --- | --- |
| [Architecture](architecture.md) | module layout, parsing pipeline, design decisions, performance budget |
| [API reference](api.md) | the programmatic engine API (`CookieConverter.convert()` and friends) |
| [Testing](testing.md) | the 90-test suite, the dependency-free DOM stub, how to add cases |
| [Design system](design.md) | tokens, glass materials, motion, theming, accessibility |
| [Deployment](deployment.md) | GitHub Pages, Netlify, Cloudflare, nginx, `file://`, security headers |
| [Changelog](changelog.md) | version history |

## Quick orientation

**What it is** — a single-page static web app that converts browser cookie
exports into the payload expected by
[gemini-web2api](https://github.com/Sophomoresty/gemini-web2api):

```json
{
  "cookie": "SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…",
  "sapisid": "…"
}
```

**What it never does** — upload, log, store or transmit your cookie data.
Parsing and JSON generation happen entirely in your browser tab. See the
[security guide](security.md).

**Required cookies** — `SID`, `HSID`, `SSID`, `APISID`, `SAPISID` and
`__Secure-1PSID`, all fresh (not expired) and scoped to `gemini.google.com`
(or its parent domain `google.com`).

**Optional cookies** — `__Secure-1PSIDTS`, `__Secure-3PSID`,
`__Secure-1PAPISID` and `SIDCC` rotate during a session; tick *Advanced
options → Include extra Google cookies* to append them when present.

## Documentation conventions

* Every claim about behaviour should be verifiable in a source file or a test —
  if a doc and the code disagree, that is a bug: please open an issue.
* Code blocks are runnable as written.
* The suite is the source of truth for parsing rules:
  `npm test` (90 tests) and `npm run check` (wiring, CSP, docs links).
