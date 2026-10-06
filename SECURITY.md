# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting flow:
**Security → Advisories → Report a vulnerability** on this repository.

Include a minimal reproduction (input shape, steps, observed vs expected) and the
affected version (`CookieConverter.VERSION` or the footer). **Never include real
cookie values** — replace them with placeholders that keep the same shape.

Expect an acknowledgement within a few days. Fixes are released as a patch
version and noted in [docs/changelog.md](docs/changelog.md).

## Scope and threat model

This project is a static, client-side tool. In scope:

* bypassing the input/value validation so a crafted export injects content into
  the generated `Cookie:` header;
* script execution from cookie data (XSS) through the UI;
* any path that writes cookie material to storage, the URL, the DOM attributes,
  the console, or the network;
* ways to make a crafted input freeze or exhaust the browser tab;
* weaknesses in the service worker cache that could serve attacker-controlled
  content.

Out of scope:

* the security of the cookies themselves (they are bearer credentials — see
  [docs/security.md](docs/security.md) for safe handling);
* the security of third-party deployments of this code that you have not
  audited yourself;
* anything requiring an already-compromised browser or extensions;
* the upstream `gemini-web2api` service.

## Guarantees this project makes

* All processing happens in the browser tab. No network requests are made —
  `connect-src 'none'` in the CSP makes this structural, not just intentional.
* No cookie value is ever persisted (the only stored values are the theme
  preference and two advanced toggles).
* Values are masked in the UI by default.
* Rendered content is built with `textContent`/`createElement` only; there is no
  dynamic `innerHTML`, no `eval`, and `npm run check` fails the build if that
  changes.
* Input is size- and entry-capped; unsafe JSON keys are ignored.

Details, mitigations and the full threat model:
[docs/security.md](docs/security.md).
