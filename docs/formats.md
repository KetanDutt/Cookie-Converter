# Cookie formats

The converter auto-detects four input shapes and always emits the same
gemini-web2api JSON.

## 1. Netscape / curl cookie file

The classic tab-separated format exported by `curl` and most browser
extensions ("Get cookies.txt LOCALLY", Netscape exporters, etc.).

```
# Netscape HTTP Cookie File
# comment lines start with '#'
#HttpOnly_.gemini.google.com	TRUE	/	TRUE	1893456000	SID	your-sid-value
```

Fields, in order:

| # | Field | Notes |
| --- | --- | --- |
| 1 | domain | Leading dot = applies to subdomains. `#HttpOnly_` may be prefixed (see below). |
| 2 | include subdomains | `TRUE` / `FALSE` |
| 3 | path | Usually `/` |
| 4 | secure | `TRUE` / `FALSE` |
| 5 | expiry | Unix seconds; `0` = session cookie |
| 6 | name | e.g. `SID` |
| 7+ | value | Everything remaining — tabs inside the value are preserved |

### The `#HttpOnly_` prefix

`curl` and many exporters mark HttpOnly cookies with a `#HttpOnly_` prefix on
the domain. This matters because **`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`
and `__Secure-1PSID` are all HttpOnly cookies** — a correct parser must treat
those lines as cookies, not comments. The converter does.

Whitespace-separated variants (some exporters use spaces) are accepted as a
fallback when a line has fewer than 7 tab-separated fields.

## 2. Browser-extension JSON export

Arrays of cookie objects, as produced by Cookie-Editor, EditThisCookie, or
Chromium DevTools "Copy all as JSON":

```json
[
  { "domain": ".gemini.google.com", "name": "SID", "value": "...",
    "expirationDate": 1893456000, "httpOnly": true, "secure": true, "path": "/" }
]
```

Accepted field aliases: `name`/`key`, `value`/`val`, `expirationDate`/`expires`.

## 3. Plain JSON object

* A `{ "name": "value", ... }` map is treated as a set of cookies (no domain
  or expiry information available in this shape).
* A `{ "cookie": "...", "sapisid": "..." }` object is recognised as
  *already-converted* gemini-web2api JSON and passed through unchanged.

## 4. Raw `Cookie` header string

Copied straight from DevTools → Network tab → request headers:

```
SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...
```

## Output: gemini-web2api JSON

```json
{
  "cookie": "SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...",
  "sapisid": "<value of SAPISID>"
}
```

* Cookie pairs are always emitted in the fixed order above.
* `sapisid` duplicates the `SAPISID` value because gemini-web2api uses it to
  compute the `SAPISIDHASH` authorization header.
* The UI offers *Pretty* (2-space indent) and *Minified* (single line — ideal
  for pasting into config files) output.

## Selection rules

When the input contains several candidates for the same cookie name
(e.g. a whole-browser export), the converter:

1. Ignores expired entries.
2. Prefers cookies scoped to `gemini.google.com`, then `.google.com`,
   then anything else (foreign domains also trigger a visible warning).
3. Breaks remaining ties by the latest expiry, then last occurrence.
