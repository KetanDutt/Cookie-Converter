# Exporting cookies from your browser

> ⚠️ **Before you start:** treat these cookies like your Google password.
> Anyone holding them can act as your account on Gemini until they expire. Read
> the [security guide](security.md), and delete export files when you're done.

You must be signed in at <https://gemini.google.com> with the account you want
to use. Export from **that tab** — cookies are scoped per site.

Pick whichever method matches the tools you have. All five produce something the
converter understands.

---

## Option A — `Copy as cURL` (no extensions, fastest)

1. Stay signed in on `https://gemini.google.com`.
2. Open DevTools (`F12`) → **Network** tab.
3. Reload the page, then click any request whose domain is `gemini.google.com`
   (the first document request is ideal).
4. Right-click it → **Copy** → **Copy as cURL** (bash, cmd or PowerShell all work).
5. Paste the whole command into the converter — the `Cookie:` header is
   extracted automatically.

Nothing is installed, nothing is downloaded, and the command never leaves your
browser tab when you paste it into this page.

---

## Option B — Netscape file via an extension (best for repeat use)

1. Install a reputable exporter, e.g. **Get cookies.txt LOCALLY** (Chrome/Edge)
   or **cookies.txt** (Firefox).
2. Visit `https://gemini.google.com` and stay on that tab.
3. Click the extension and export cookies for the current site.
4. Drop the downloaded `.txt` file onto the converter.

Lines beginning with `#HttpOnly_` are expected and handled correctly — a tool
that tells you they are "just comments" is wrong (see
[formats.md](formats.md#the-httponly_-prefix)).

---

## Option C — JSON via Cookie-Editor

1. Install **Cookie-Editor** (Chrome/Firefox/Edge).
2. On `gemini.google.com`, open the extension → **Export** → **Export as JSON**.
3. Paste the JSON array into the converter (or drop the `.json` file).

Chromium DevTools' *Copy all as JSON* on the Application → Cookies panel works
too, including its ISO-8601 `expires` strings.

---

## Option D — Copy from the DevTools Cookies panel

1. Open DevTools (`F12`) → **Application** → **Storage → Cookies** →
   `https://gemini.google.com`.
2. Copy the values of `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`,
   `__Secure-1PSID`.
3. Paste them as a raw header string:

   ```
   SID=…; HSID=…; SSID=…; APISID=…; SAPISID=…; __Secure-1PSID=…
   ```

   Leading `Cookie: ` and line breaks are fine.

---

## Option E — `Set-Cookie` headers from a response

1. DevTools → **Network** → click a `gemini.google.com` request.
2. **Response Headers** → copy every `Set-Cookie` line.
3. Paste them; attributes (`Domain`, `Path`, `Expires`, `Secure`, `HttpOnly`,
   `SameSite`) are parsed rather than mistaken for cookie names.

Server logs and `curl -i` output work the same way.

---

## Option F — curl cookie jar (advanced)

```bash
curl -c cookies.txt https://gemini.google.com
```

An interactive login is required for real cookies, so this is mainly useful in
automation that already authenticates. The resulting jar is a standard Netscape
file the converter understands.

---

## After exporting

1. Convert in the tool and check the **Required cookies** checklist — all six
   should read *found*.
2. Copy or download `cookie.json` (or `cookie.txt` for
   `--cookie-file cookie.txt`) and put it where gemini-web2api expects it.
3. **Delete** the raw export and the generated payload from your Downloads
   folder (and empty the trash) once it is in place.
4. Rotate if you are unsure: signing out of all sessions or changing your Google
   password invalidates every exported cookie immediately.

## How long do they last?

* `__Secure-1PSID` and the `1P`/`3P` family rotate as Google refreshes your
  session; exports can go stale within hours or last for months depending on the
  account and activity.
* If gemini-web2api suddenly reports authentication problems, re-export. The
  converter will tell you if a cookie is already expired when you convert.
* If the whole environment runs ahead of/behind real time (VMs, containers,
  dual-boot), enable **Advanced options → Allow expired cookies** and compare the
  dates shown in the audit table with your system clock.
