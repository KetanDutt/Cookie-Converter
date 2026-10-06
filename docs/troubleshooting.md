# Troubleshooting

Every error the converter can produce has a machine-readable code
(`CookieConverter.ERROR_CODES`) and a human sentence. This page explains them,
plus the situations that are *not* errors but still surprise people.

---

## `Missing required cookies: …`

The named cookies were not present in the input.

| Cause | Fix |
| --- | --- |
| Exported from the wrong tab | The active tab must be `https://gemini.google.com`, signed in. Extensions export the *current site* only. |
| Export contains comments only | Some exporters write just a header when the site has no cookies — sign in again and retry. |
| Whole-browser export | Same-named cookies from other domains are ignored on purpose; you will see a warning listing them. Export for Gemini instead. |
| Values were dropped | `#HttpOnly_` lines **are** cookies; this tool reads them (see [formats.md](formats.md#the-httponly_-prefix)). |
| Only some cookies are missing | The account may not have the `__Secure-1PSID` family yet — open <https://gemini.google.com> in the browser, accept any prompts, then export again. |

The **Required cookies** checklist above the audit table shows exactly which of
the six are missing, expired or taken from another domain.

---

## `Expired required cookies: …`

The cookies exist but their expiry timestamp is in the past.

* Re-export fresh cookies — `__Secure-1PSID` and the `1P`/`3P` family rotate.
* Check your **system clock**. A machine that is days behind makes valid cookies
  look expired (and the audit table will show odd dates).
* If you know the values are new and only the clock is wrong, enable
  **Advanced options → Allow expired cookies**. The conversion proceeds and the
  notes warn you that expired cookies were used.
* An expiry of `0` means *session cookie* and is always accepted.

---

## `Unusable cookie value(s): …`

The value contains a semicolon, whitespace, control characters, or is empty.

A `Cookie:` header is a list of `name=value` pairs separated by `;`, so such a
value cannot be transmitted — the server would see a different cookie set than
you intended. Re-export the cookies; correctly exported Google values never
contain those characters.

Most common real-world cause: copying values out of a table by hand and picking
up a trailing space or a line break. Prefer *Copy as cURL* or a JSON export.

---

## `Input is too large (…)` / `TOO_LARGE`

The input exceeds 5 MB. Export only the cookies for `gemini.google.com` rather
than the entire browser — a Gemini cookie set is a couple of kilobytes.

---

## `Nothing to convert — the input is empty.`

Self-explanatory. Press **Load sample** to see a working example.

---

## `Input looks like JSON but could not be parsed: …`

* The paste is truncated (the most common cause — an export was cut off).
* The file is JSON Lines (one object per line) rather than an array: wrap the
  objects in `[ … ]` and separate them with commas.
* You copied the *pretty-printed* DevTools view of an object rather than its
  JSON. Use **Copy all as JSON** in the three-dot menu.

---

## `That cURL command reads cookies from a file (…)`

`curl -b cookies.txt` puts cookies in a file, so the paste contains no values.
Open the file and paste its contents instead, or copy the request as cURL from a
request that *sends* a `Cookie:` header.

---

## `No Cookie header found in that cURL command.`

The command you copied has no cookies attached (it was an anonymous request).

* Make sure you are signed in at `gemini.google.com` in that browser profile.
* Copy a request from the **Network** tab of `gemini.google.com`, not from a CDN
  or an analytics domain.
* If the request used a browsing profile without cookies, reload the page and
  copy the first document request instead.

---

## `Skipped N unreadable line(s)`

See the **Skipped lines** report inside the result card: it lists line numbers
and reasons. Comments and blank lines are skipped silently and counted
separately (`N comment line(s)`), so a report entry means a genuinely
unrecognised line — often a truncated export or a binary file.

---

## The JSON was generated but gemini-web2api still rejects it

* Use **Minified** output when pasting into a single-line config value.
* Make sure you copied the *whole* payload — truncated values are the most
  common cause.
* Confirm `sapisid` matches the `SAPISID` value inside `cookie` (the tool
  guarantees it; a hand-edited file may not).
* Use Advanced options → *Include extra Google cookies* to append
  `__Secure-1PSIDTS`, which some sessions require.
* The account may need to accept new terms on `gemini.google.com` first — visit
  the site in a normal browser once.
* Signed-in Gemini URLs sometimes contain an account index
  (`https://gemini.google.com/u/1/app`); upstream needs `auth_user` set to that
  number.
* `xsrf_token` (`SNlM0e` in the page source) must be current: refresh Gemini Web
  and update it if you get an `xsrf` error.

---

## Nothing happens when I press Convert

* The button is disabled while the input is empty — paste something first.
* Check the browser console (`F12`) for errors.
* The page needs JavaScript enabled, and no script-blocking extension
  interfering with `assets/*.js`. If `assets/converter.js` cannot load, the page
  says so explicitly instead of staying silent.

---

## The theme is wrong on first paint / the icon looks out of sync

The first paint follows your OS (`prefers-color-scheme`). Once you press the
theme button the explicit choice is stored in `localStorage` and wins from then
on. In private mode storage is unavailable and the choice lasts for the session
only — that is intentional, because nothing user-identifying is ever persisted.

---

## My extension exports JSON with different field names

`name`/`key`/`Name`, `value`/`val`/`Value`, `domain`/`host`,
`expirationDate`/`expires`/`expiry`/`expiration`, `secure`/`isSecure`,
`httpOnly`/`isHttpOnly` are all understood. Anything else: open an issue with a
**sanitised** sample (replace every value with `xxx` — never paste real cookie
values).

---

## "Could not read file"

The selected file is not readable text. Cookie exports are plain text — re-export
rather than converting an archive, a `.sqlite` database or a binary file.

---

## Still stuck?

1. Reproduce the shape of the problem with the test suite: `npm test`.
2. Run `npm run check` to rule out a broken local copy (missing files, mismatched
   assets).
3. Open an issue with: the error message, the detected format shown next to the
   textarea, your browser and the exporter you used — **never real cookie
   values**. Use the sample loader if you need something to paste.
