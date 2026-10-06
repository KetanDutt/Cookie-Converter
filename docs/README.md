# Documentation

Everything you need to use, deploy, and extend the **Gemini Cookie Converter**.

| Document | Contents |
| --- | --- |
| [Cookie formats](formats.md) | The Netscape format, JSON exports, raw headers, and the gemini-web2api output structure |
| [Exporting cookies](exporting-cookies.md) | Step-by-step: getting cookies out of your browser safely |
| [Troubleshooting](troubleshooting.md) | Fixes for the most common errors |
| [Security & privacy](security.md) | What this tool does with your data (nothing) and how to handle cookies safely |
| [Deployment](deployment.md) | Hosting on GitHub Pages, Netlify, or any static server |
| [Architecture](architecture.md) | Code structure, design decisions, and how to run the tests |
| [Changelog](changelog.md) | Version history |

## Quick orientation

- **What it is** — a single-page static web app that converts browser cookie
  exports into the JSON payload expected by
  [gemini-web2api](https://github.com/Sophomoresty/gemini-web2api):

  ```json
  {
    "cookie": "SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...",
    "sapisid": "..."
  }
  ```

- **What it never does** — upload, log, store, or transmit your cookie data.
  Parsing and JSON generation happen entirely in your browser tab. See the
  [security guide](security.md).

- **Required cookies** — `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, and
  `__Secure-1PSID`, all of which must be fresh (not expired) and belong to
  `gemini.google.com` (or its parent `.google.com`).
