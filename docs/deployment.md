# Deployment

The app is 100% static — no build step, no dependencies, no server logic.
Any file host works.

## GitHub Pages

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source:** *Deploy from a branch*.
3. Branch: `main`, folder: `/ (root)` → **Save**.
4. Open `https://<user>.github.io/<repo>/`.

The included `404.html` is served automatically by GitHub Pages.

## Any static host (Netlify, Cloudflare Pages, S3, nginx, …)

Upload the whole directory preserving its structure:

```
index.html
404.html
assets/{app.js, converter.js, favicon.svg, style.css}
docs/…
```

No configuration is required. Because the page ships a strict CSP meta tag,
no special web-server headers are needed — but if your host lets you set
them, mirroring the CSP as a real `Content-Security-Policy` header is
equally fine.

## Run locally

```bash
# any static server works, e.g.:
python3 -m http.server 8080 --bind 0.0.0.0
# → http://localhost:8080
```

Or simply open `index.html` directly from disk (`file://`) — everything,
including downloads and copy, works offline.

## HTTPS note

GitHub Pages and the hosts above are HTTPS by default, which is the
recommended way to serve the app. The tool also degrades gracefully over
plain HTTP or `file://` (clipboard falls back to the select-and-copy flow).
