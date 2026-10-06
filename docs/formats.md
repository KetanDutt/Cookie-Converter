# Cookie formats

The converter accepts **five input shapes**, detects which one you pasted, and
always emits the same gemini-web2api payload.

```
netscape · json · header · curl · set-cookie   →   { "cookie": "…", "sapisid": "…" }
```

Detection is linear in input size and never guesses destructively: if the
detected parser finds nothing, you get a specific error, not a wrong payload.

---

## 1 · Netscape / curl cookie file

The classic tab-separated format written by `curl -c` and by nearly every
"export cookies" extension.

```
# Netscape HTTP Cookie File
# comment lines start with '#'
#HttpOnly_.gemini.google.com	TRUE	/	TRUE	1893456000	SID	your-sid-value
```

| # | Field | Notes |
| --- | --- | --- |
| 1 | domain | A leading dot means "applies to subdomains". May be prefixed with `#HttpOnly_`. |
| 2 | include subdomains | `TRUE` / `FALSE` (also `yes`/`no`, `1`/`0`) |
| 3 | path | Usually `/` |
| 4 | secure | `TRUE` / `FALSE` |
| 5 | expiry | Unix seconds, `0` for a session cookie, or an ISO-8601/cookie date string |
| 6 | name | e.g. `SID` |
| 7+ | value | Everything remaining — tabs inside the value are preserved |

### The `#HttpOnly_` prefix

`curl` and many exporters mark HttpOnly cookies with `#HttpOnly_` in front of
the *domain*. This matters: **`SID`, `HSID`, `SSID`, `APISID`, `SAPISID` and
`__Secure-1PSID` are all HttpOnly**, so a parser that treats `#HttpOnly_` lines
as comments silently drops everything you need. This converter treats them as
cookies and flags them `HttpOnly` in the audit table.

Whitespace-separated variants (some exporters use spaces instead of tabs) are
accepted as a fallback, and a value containing spaces is preserved.

Malformed lines never abort the run — they are counted and listed under
*Skipped lines* with their line numbers.

---

## 2 · JSON exports

### Extension arrays

Cookie-Editor, EditThisCookie and friends:

```json
[
  { "domain": ".gemini.google.com", "name": "SID", "value": "…",
    "path": "/", "expirationDate": 1893456000, "httpOnly": true, "secure": true }
]
```

Accepted aliases: `name`/`key`/`Name`, `value`/`val`/`Value`,
`domain`/`host`/`Domain`, `expirationDate`/`expires`/`expiry`/`expiration`,
`secure`/`isSecure`, `httpOnly`/`isHttpOnly`.

### Chromium DevTools — *Copy all as JSON*

Values such as `"expires": "2029-01-01T00:00:00.000Z"`, `-1` or `null` are all
understood: ISO strings are parsed, millisecond timestamps are converted to
seconds, and `-1`/`null`/`0` mean "session cookie".

### Puppeteer / Playwright storage state

```json
{ "cookies": [ { "name": "SID", "value": "…", "domain": ".google.com", "expires": 1893456000 } ],
  "origins": [ … ] }
```

The `origins` section is ignored (and mentioned in the notes).

### Plain maps and single cookies

```json
{ "SID": "…", "HSID": "…", "SAPISID": "…" }        // no domain/expiry information
{ "name": "SID", "value": "…" }                    // one cookie
```

### Already-converted payloads

```json
{ "cookie": "SID=…; HSID=…; SAPISID=…", "sapisid": "…" }
```

* Both fields present → passed through **unchanged** after validation; the
  cookie string is still parsed so the audit table and checklist are populated.
* `sapisid` contradicts the `SAPISID` inside the cookie string → the value from
  the cookie string wins, with a warning.
* `sapisid` missing → it is derived from the cookie string.
* Required cookies missing from the string → passed through anyway, with a loud
  warning that gemini-web2api will most likely reject it.

Unusable rows inside an array (missing name, nested object as a value) are
skipped individually instead of failing the whole export.

---

## 3 · Raw `Cookie` header

Copied from DevTools → Network → a request → Request Headers:

```
SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…
```

* The optional `Cookie:` prefix is accepted.
* Values may be split over several lines.
* Duplicate names resolve to the **last** occurrence, like a browser would.
* Quoted values (`SID="abc"`) are unquoted.

---

## 4 · `Copy as cURL`

DevTools → Network → right-click a request → *Copy as cURL*:

```bash
curl 'https://gemini.google.com/_/BardChatUi/data/…' \
  -H 'accept: */*' \
  -H 'cookie: SID=…; HSID=…; SAPISID=…' \
  --compressed
```

The command is tokenised with POSIX quoting rules, so single quotes, double
quotes, `$'…'` ANSI-C escapes (including `\x3B`) and both `\` and PowerShell
`^` line continuations work. `-H`/`--header`, `-b`/`--cookie` and their
`--flag=value` forms are all supported.

If the command reads cookies from a file (`-b cookies.txt`) there is nothing to
parse — the tool says so and tells you what to copy instead.

---

## 5 · `Set-Cookie` response headers

DevTools → Network → *Response Headers*, or a server log:

```
Set-Cookie: SID=…; Domain=.gemini.google.com; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; HttpOnly; SameSite=None
```

Attributes are parsed (`Domain`, `Path`, `Expires`, `Max-Age`, `Secure`,
`HttpOnly`, `SameSite`) and **never** mistaken for cookie names — a line such as
`SID=abc; Domain=.gemini.google.com; Path=/` yields exactly one cookie.
`Max-Age` is resolved against the current clock.

---

## Output: the gemini-web2api payload

```json
{
  "cookie": "SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…",
  "sapisid": "<the SAPISID value>"
}
```

* Pairs are always emitted in the fixed order above, matching the upstream
  documentation.
* `sapisid` is repeated as its own field because gemini-web2api uses it to build
  the `SAPISIDHASH` authorization header.
* The UI offers **Pretty** (2-space indent) and **Minified** (single line) forms,
  plus two downloads:
  * `cookie.json` — the payload above;
  * `cookie.txt` — just the cookie string, which is exactly the single-line
    format upstream accepts via `--cookie-file cookie.txt`.
* Optional extras — `__Secure-1PSIDTS`, `__Secure-3PSID`, `__Secure-1PAPISID`,
  `SIDCC` — are appended (in that order) **only** when *Advanced options →
  Include extra Google cookies* is enabled and the cookie exists with a usable
  value. They are reported in `payload.extras`.

### Why some values are refused

A `Cookie:` header is `name=value` pairs separated by `;`, so a value containing
a semicolon, whitespace, a control character or an empty value cannot be sent —
it would either split the header or be dropped by the server. Instead of
silently producing a broken payload, the converter names the offending cookie
and explains why:

```
Unusable cookie value(s): SID (it contains whitespace, which is not valid in a cookie value).
```

Re-export the cookies; a correctly exported Google value is
`[A-Za-z0-9._/+-]`-ish and never contains those characters.

---

## Selection rules

When the input contains several candidates for the same cookie name (a
whole-browser export, or a merge of two exports), the converter:

1. ignores entries whose value cannot be used, unless nothing else exists;
2. ignores **expired** entries (unless *allow expired* is enabled);
3. prefers cookies scoped to `gemini.google.com` (including subdomains), then
   `google.com`, then anything else — a foreign-domain cookie is used only if
   there is no better candidate, and is always flagged;
4. breaks remaining ties by the **latest expiry**, then by the **last
   occurrence** in the input;
5. reports every decision in the notes: duplicates, ignored foreign domains,
   ignored expired copies, unknown domains, and placeholder-looking values.

## Supported limits

| Limit | Value | Behaviour |
| --- | --- | --- |
| Input size | 5 MB | refused with a size message before parsing |
| Entries | 200 000 | further entries are ignored and reported |
| Reported malformed lines | 25 | the rest are counted, not listed |
| Table rows rendered | 400 (up to 4 000 on demand) | *Show more* reveals another page |

All limits live in `CookieConverter.LIMITS` and can be overridden per call
(see [api.md](api.md)).
