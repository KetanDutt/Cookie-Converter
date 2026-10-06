# Exporting cookies from your browser

> ⚠️ **Before you start:** treat these cookies like your Google password.
> Anyone holding them can act as your account on Gemini. Read the
> [security guide](security.md), and delete export files when you're done.

You need to be signed in to <https://gemini.google.com> with the account you
want to use.

## Option A — Netscape file via an extension (recommended)

1. Install a reputable exporter, e.g. **Get cookies.txt LOCALLY** (Chrome/Edge)
   or **cookies.txt** (Firefox).
2. Visit `https://gemini.google.com` (stay on that tab).
3. Click the extension and export cookies for the current site.
4. Drop the downloaded `.txt` file onto the converter.

Lines that begin with `#HttpOnly_` are expected and handled correctly.

## Option B — JSON via Cookie-Editor

1. Install **Cookie-Editor** (Chrome/Firefox/Edge).
2. On `gemini.google.com`, open the extension → **Export** → **Export as JSON**.
3. Paste the JSON array into the converter.

## Option C — Copy from DevTools

1. Open DevTools (`F12`) → **Application** → **Cookies** →
   `https://gemini.google.com`.
2. Copy the values of: `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`,
   `__Secure-1PSID`.
3. Paste them as a raw header string:
   `SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...`

## Option D — curl cookie jar (advanced)

```bash
curl -c cookies.txt https://gemini.google.com
```

An interactive login flow is required for real cookies, so this is mainly
useful with automation setups that already authenticate. The resulting jar is
a standard Netscape file the converter understands.

## After exporting

* Convert → download `cookie.json` → place it where gemini-web2api expects it.
* **Delete** the raw export file and `cookie.json` from your Downloads folder
  once copied to its destination, and empty the trash.
* Rotate: signing out of all sessions or changing your Google password
  invalidates the cookies if you suspect they leaked.
