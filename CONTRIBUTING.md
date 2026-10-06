# Contributing

Short version: **no dependencies, no build step, no network requests, no dynamic
markup** — and every change comes with tests and docs.

The full guide lives in [docs/contributing.md](docs/contributing.md).

```bash
git clone https://github.com/KetanDutt/Cookie-Converter
cd Cookie-Converter
npm run verify     # consistency checks + 90 tests (~1 s, nothing to install)
npm run serve      # preview on http://localhost:8080
```

Before opening a pull request:

- [ ] `npm run verify` is green (CI runs it on Node 18, 20 and 22).
- [ ] New behaviour is tested; bug fixes include a regression test.
- [ ] Docs are updated (README feature list, relevant `docs/*.md`, changelog).
- [ ] No dependency, no build step, no network call, no non-literal `innerHTML`.
- [ ] Keyboard, screen-reader, both themes and reduced-motion paths still work.
- [ ] Any cookie value in a test or example is obviously fake.

Security issues: please use a private advisory instead — see
[docs/security.md](docs/security.md#reporting-a-vulnerability).

Contributions are accepted under the [MIT license](LICENSE).
