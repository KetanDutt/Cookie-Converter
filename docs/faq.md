# FAQ

**Is my cookie data uploaded anywhere?**
No. There is no server component, no analytics and no network code — the page
ships `connect-src 'none'` in its CSP, which makes exfiltration impossible even
if something else went wrong. See [security.md](security.md).

**Do I need to install anything?**
No. `assets/converter.js` has no dependencies and there is no build step. If you
want a local copy rather than a hosted one, download the folder and open
`index.html`, or run `npm run serve`.

**Which cookies does gemini-web2api actually need?**
`SID`, `HSID`, `SSID`, `APISID`, `SAPISID` and `__Secure-1PSID` — all belonging
to `gemini.google.com` (or its parent `google.com`) and all unexpired. The tool
validates exactly that.

**What about `__Secure-1PSIDTS` and friends?**
They rotate during a session and some accounts need them. Tick
*Advanced options → Include extra Google cookies* and they are appended when
present. They are never required and never block a conversion.

**Do I need a Gemini Advanced subscription?**
For real Pro routing, yes — an account cookie authenticates a free account but
upstream falls back to Flash models. The converter only produces the payload; it
cannot change what your account is entitled to.

**Why did it refuse a value with a space?**
Because a `Cookie:` header cannot carry one: the server would receive a
different cookie set than you intended. Google's own cookie values never contain
spaces, semicolons or control characters — a refusal means the export (or a
manual copy) was damaged. See [formats.md](formats.md#why-some-values-are-refused).

**The cookies are valid but the API still fails. What now?**
Check, in order: minified vs pretty output when pasting into a single-line config;
that you copied the whole payload; `auth_user` if your Gemini URL contains `/u/1/`;
and `xsrf_token` freshness (`SNlM0e` in the page source). More in
[troubleshooting.md](troubleshooting.md).

**Which format should I use?**
Any. *Copy as cURL* needs no extension and is usually fastest; a Netscape file
is the most convenient for repeat use; JSON is best when you want the raw values
visible in the audit table.

**Can I use it for another service?**
Yes — `CookieConverter.convert(text, { required: ['…'], expectedDomains: ['…'] })`
makes the engine a general cookie-jar normaliser. See [api.md](api.md).

**Why is there no TypeScript / framework / bundler?**
Auditability. The whole app is four readable files, the tests run with `node`
alone, and deployment is a `git push`. `npm run check` and 90 tests take over the
job a compiler would do here.

**Does it work offline / can I install it?**
Yes to both. A web manifest and a network-first service worker make it
installable, and it keeps working on a plane or an air-gapped machine. When you
are online the network always wins, so you can never be stuck on an old build.

**Why is the sample output flagged with a warning?**
Because the sample contains placeholder values (`SAMPLE-sid-replace-me`). That is
the intended teaching moment: it converts, and it tells you to replace them.

**Does the tool store anything about me?**
Only two things, both in `localStorage`: the theme preference and the two
advanced toggles. No cookie value is ever written to storage, the URL, the DOM
attributes or the console — there is a test asserting exactly that.

**Can I trust a hosted copy?**
You can *audit* it: read four files, or run `npm run check` on the same commit.
For maximum trust, host your own copy
([deployment.md](deployment.md)) or open it from `file://`.

**Something is wrong and the error message is not listed here.**
Run `npm run verify` locally first — it catches the "my copy is broken" class of
problems. Then open an issue with the error message, the detected format shown
next to the textarea, and your browser — never real cookie values, not even
partially masked ones.
