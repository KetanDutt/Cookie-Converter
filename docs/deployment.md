# Deployment

The app is 100% static — no build step, no dependencies, no server logic, no
environment variables. Whatever a file host can serve, it can host.

```
.nojekyll    index.html   404.html   sw.js   site.webmanifest   _headers
assets/{converter.js, app.js, style.css, favicon.svg, icon-maskable.svg}
docs/…
```

Nothing needs to be compiled or copied: the repository *is* the site.

---

## GitHub Pages

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source:** *Deploy from a branch*.
3. Branch `main`, folder `/ (root)` → **Save**.
4. Open `https://<user>.github.io/<repo>/`.

`404.html` is picked up automatically. Everything works under a sub-path
because all URLs in the project are relative. (If you prefer Actions-based
deploys, `.github/workflows/ci.yml` already validates the exact file set the host
needs.)

The repository ships a `.nojekyll` file, so GitHub Pages serves the tree
**verbatim**: no Jekyll build, nothing silently dropped (Jekyll ignores
`_`-prefixed files such as `_headers`), and the `docs/*.md` links the UI uses
keep resolving — they open as readable plain text rather than rendered HTML.
If you want rendered documentation instead, delete `.nojekyll` and link to
`docs/<name>.html`; both choices work, they just differ in fidelity.

## Netlify

* **Drag & drop:** drop the folder on <https://app.netlify.com/drop>.
* **From Git:** build command *empty*, publish directory `/`.

The included [`_headers`](../_headers) file is applied automatically: the CSP as
a real HTTP header, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `X-Frame-Options: DENY`, plus long-lived caching for
`assets/*` and `no-cache` for `sw.js` (so the service worker itself is never
stale).

## Cloudflare Pages

* Framework preset: **None**, build command: *empty*, build output directory `/`.

`_headers` is supported with the same syntax, so the security headers come along
for free.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name converter.example.com;
    root /var/www/cookie-converter;

    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location = /sw.js { add_header Cache-Control "no-cache"; }
    location /assets/ { expires 7d; add_header Cache-Control "public, max-age=604800"; }
    error_page 404 /404.html;
}
```

## Caddy

```caddy
converter.example.com {
    root * /var/www/cookie-converter
    file_server
    header {
        Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
    }
    handle_errors {
        rewrite * /404.html
        file_server
    }
}
```

## S3 / static buckets

```bash
aws s3 sync . s3://my-bucket --exclude ".git/*" --exclude "node_modules/*" \
  --exclude ".github/*" --exclude "tests/*" --exclude "scripts/*"
```

Enable static website hosting and set `index.html` / `404.html` as the document
and error documents. Buckets cannot set response headers per object, so the
`<meta>` CSP in `index.html` is what protects you there — it is equally strict.

## `file://` and air-gapped machines

Open `index.html` directly from disk. Everything works, offline, with no server:
the strict CSP is a meta tag, downloads use blob URLs, and the clipboard falls
back to select-and-copy when the Clipboard API is unavailable in a non-secure
context. The service worker simply is not registered (it requires
`http(s)://`), so there is no offline-cache layer to worry about — the files are
already local.

This is the most private deployment: the machine never needs a network
connection at all.

## HTTPS

All providers above are HTTPS by default, which is recommended (Clipboard API,
service worker, installability). The app degrades gracefully over plain HTTP:
copy falls back to `execCommand`, and the service worker is skipped.

---

## Cache behaviour

| Path | Policy | Why |
| --- | --- | --- |
| `index.html`, other HTML | revalidate each visit | a new version must be one reload away |
| `assets/*` | long-lived (`max-age=604800`) | filenames are stable but the service worker revalidates in the background |
| `sw.js` | `no-cache` | the worker must never be served stale, or updates stall |

The service worker is **network-first**, so even aggressive caching cannot pin a
user to an old build: it fetches, then updates the cache, then falls back to the
cache only when the network fails.

## Optional hardening

* Enable HSTS at the host (nothing in the app depends on it).
* Subresource Integrity is irrelevant here — there is nothing third-party to
  pin. That is the point.
* If you mirror the tool, mirror the *whole* directory: a missing `sw.js` is
  tolerated, but a missing `assets/converter.js` makes the page announce
  loudly that the engine failed to load instead of silently doing nothing.

## Verifying a deployment

```bash
curl -sI https://your-host/ | grep -i content-security-policy   # header (if configured)
curl -s  https://your-host/ | grep -o "Content-Security-Policy[^>]*"  # meta tag
```

Then, in the browser: DevTools → Console must show **no CSP violations**, and
load the page once → toggle *Offline* → reload; the converter must still work.
