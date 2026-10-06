# Contributing

Thanks for taking the time. This project is deliberately small, so the rules are
short and strict — keeping them is what lets it stay dependency-free.

## Ground rules

1. **No dependencies. Ever.** No runtime deps and no dev deps: the tests use
   `node:test`, the server uses `node:http`, the linter is `scripts/check.js`.
   A pull request that adds anything to `dependencies`/`devDependencies` cannot
   be merged, however useful the package is.
2. **No build step.** Whatever you write must run as-is in a browser and in
   Node ≥ 18. No transpiling, no bundling, no generated files committed.
3. **No network requests at runtime.** No `fetch`, no CDNs, no fonts, no
   analytics. The CSP forbids them anyway, and `npm run check` enforces the
   markup side.
4. **No dynamic markup from data.** Use `textContent`/`createElement`; a
   non-literal `innerHTML` fails the checks.
5. **Keep the CSP strict.** `npm run check` fails if a directive disappears or
   `'unsafe-inline'`/`'unsafe-eval'` appears.
6. **Never commit cookie exports.** `.gitignore` blocks the usual names and
   `npm run check` fails if one gets through. Use the sample loader for test
   data, or hand-craft values like `sid-value`.

## Getting started

```bash
git clone https://github.com/KetanDutt/Cookie-Converter
cd Cookie-Converter
npm run serve        # http://localhost:8080 (python3 or `npm run serve:node`)
npm run verify       # checks + 107 tests, ~1 s
```

There is nothing to install — no package manager step exists at all, here or in
any pipeline.

## Making a change

1. **Pick the layer.** Parsing/selection/validation → `assets/converter.js`.
   DOM, files, clipboard, rendering → `assets/app.js`. Visuals →
   `assets/style.css`. Never mix: the engine must stay DOM-free.
2. **Update the docs in the same change.** A behaviour change that is not in
   `docs/` (or the README feature list) is incomplete — this project's value is
   that the docs and the code agree.
3. **Bump nothing manually.** Version numbers live in `package.json`,
   `assets/converter.js`, `sw.js`, `index.html` and `docs/changelog.md`; bump all
   of them together and let `npm run check` verify.
4. **Add tests** (see [testing.md](testing.md)) — engine behaviour in
   `tests/converter.test.js`, UI flows in `tests/app.test.js`. Bug fixes always
   come with a regression test.
5. **Run `npm run verify`.** Both halves must be green.

## Style

* ES2015+ JavaScript, `'use strict'`, semicolons, two-space indent, single
  quotes, trailing commas in multi-line literals.
* Prefer `const`/`let`, arrow functions for callbacks, template literals for
  string building, `Map`/`Set` where a plain object would need prototype guards.
* Comments explain **why**, not what. Section banners in long files.
* CSS: tokens only (no hard-coded colours or durations), components in
  alphabetical-ish groups, mobile-first media queries at 720 px and 420 px.
* HTML: semantic elements first, `aria-*` only where semantics are insufficient,
  no inline styles or handlers.
* Error messages: say what happened, name the offender, and suggest the fix —
  `Unusable cookie value(s): SID (it contains whitespace …)` — plus a `hint` for
  the UI.

## Review checklist

A pull request is ready when:

- [ ] `npm run verify` is green (Node 18, 20 and 22 are all supported).
- [ ] New behaviour is tested; fixed bugs have a regression test.
- [ ] Docs are updated (README feature list, relevant `docs/*.md`, changelog).
- [ ] No new dependency, no build step, no network request, no dynamic markup.
- [ ] Keyboard and screen-reader paths still work (tab through, press `Escape`).
- [ ] Both themes and `prefers-reduced-motion` still look right.
- [ ] Any new cookie value in a test/example is obviously fake.

## Reporting bugs

Include: what you pasted (the *shape*, sanitised — never real values), the
message the tool showed, the detected format from the badge next to the
textarea, your browser, and whether `npm run verify` passes for you. For
security issues use a private advisory instead — see
[security.md](security.md#reporting-a-vulnerability).

## Documentation conventions

* `docs/` is the single source of truth; the README summarises and links.
* Every local link must resolve (`npm run check` enforces it).
* Prefer tables for option lists and short paragraphs over long prose.
* Write for two readers: the person converting cookies right now, and the person
  auditing or extending the code later.

## License

Contributions are governed by the repository's [LICENSE](../LICENSE) (All Rights
Reserved). Open an issue before starting significant work so the terms can be
confirmed; submitting a pull request confirms you have the right to contribute
the code under those terms.
