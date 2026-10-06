# Troubleshooting

## "Missing required cookies: …"

The named cookies were not present in the input.

* **Export from the right tab.** The active tab must be
  `https://gemini.google.com`, signed in. Extensions export cookies for the
  *current site* only.
* **You exported comments only.** Some exporters produce a header-only file
  when the site has no cookies — sign in again and retry.
* **Whole-browser exports:** if you exported every site, check that the file
  actually contains Gemini cookies; unrelated same-named cookies from other
  domains are ignored on purpose (you'll see a warning listing them).
* **`#HttpOnly_` lines** are supported — if another tool told you they were
  "comments", that tool is wrong; try this converter.

## "Expired required cookies: …"

The cookies existed but their expiry timestamp is in the past.

* Re-export fresh cookies (they expire; `__Secure-1PSID` values rotate).
* Check your **system clock** — a wrong clock makes valid cookies look
  expired.
* If the exporter writes `0` in the expiry column the cookie is treated as a
  *session* cookie and accepted.

## The JSON was generated but gemini-web2api still rejects it

* Use **Minified** output when pasting into a single-line config value.
* Make sure you copy the *whole* file contents — truncated values are the
  most common cause.
* Confirm `sapisid` matches the `SAPISID` value in the `cookie` string.
* The account may need to accept new terms on `gemini.google.com` first;
  visit the site in a normal browser once.

## My extension exports JSON with different field names

`name`/`key`, `value`/`val`, and `expirationDate`/`expires` are all
understood. Anything else: open an issue with a *sanitised* sample (replace
values with `xxx` — never paste real cookie values).

## Nothing happens when I click Convert

* Check the browser console (`F12`) for errors.
* The page needs JavaScript enabled and no script-blocking extension
  interfering with `assets/*.js`.

## "Could not read file"

The selected file isn't readable text. Cookie exports are plain text —
re-export rather than converting binary/archived files.

## Still stuck?

Verify behaviour locally with the test suite (`npm test`), then open an issue
with the input *shape* (never real values), browser, and exporter used.
