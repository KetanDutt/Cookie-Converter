# Design system

The UI is a small, self-contained "Liquid Glass" system: translucency, depth and
fluid micro-interactions, expressed entirely through CSS custom properties in
`assets/style.css`. There are no inline styles anywhere — the strict CSP forbids
them — so every visual decision is a token or a class.

```
tokens (:root)  →  materials (.glass/.glass-soft/.glass-float)  →  components  →  motion
```

---

## 1 · Tokens

All tokens live in `:root`. The light palette is defined twice, on purpose:
once inside `@media (prefers-color-scheme: light)` (so the *first paint* already
matches the OS, and no flash of the wrong theme can happen) and once for
`[data-theme="light"]` (an explicit choice on a dark-preferring OS). The two
blocks are marked `@light-tokens:start/end` and `npm run check` fails if they
ever drift apart.

| Group | Examples | Notes |
| --- | --- | --- |
| Palette | `--bg`, `--text`, `--muted`, `--accent`, `--ok`, `--warn`, `--err` | “-soft” variants are the translucent fills for tinted surfaces |
| Glass | `--glass-1/2/3`, `--glass-border`, `--glass-edge`, `--glass-hover`, `--inset` | three translucency levels: recessed, surface, floating |
| Fallback | `--solid`, `--solid-soft` | used when `backdrop-filter` is unsupported or transparency is reduced |
| Geometry | `--radius-sm/md/lg/xl/pill` | 10 → 26 px, plus pills |
| Spacing | `--sp-1 … --sp-8` | 4 → 48 px, a 4 px rhythm |
| Type | `--font-sans`, `--font-mono`, `--fs-hero/h2/body/small/micro` | system fonts only — no web-font requests, ever |
| Motion | `--t-fast/med/slow`, `--ease-out/in-out/spring` | 150/260/420 ms |
| Layers | `--z-bg/content/nav/pop/toast` | documented stacking order |

Adding a colour or a duration means adding a token — components never hard-code
values (the only exceptions are the intentionally theme-independent `#fff`
gradient stops inside switches).

## 2 · Materials

| Class | Use | Recipe |
| --- | --- | --- |
| `.glass` | cards, top bar, primary surfaces | `backdrop-filter: blur(22px) saturate(1.5)` + vertical translucency gradient + inner top highlight + large soft shadow |
| `.glass-soft` | recessed panels (tables) | single translucent fill + inner highlight |
| `.glass-float` | toasts, popovers, scrolled top bar | heavier blur (34 px) + stronger border + deepest shadow |

Degradation is explicit:

* `@supports not (backdrop-filter: …)` → opaque `--solid` fills, same layout.
* `@media (prefers-reduced-transparency: reduce)` → same opaque fallback.
* `@media (forced-colors: active)` → system colours, glass removed.
* `@media (prefers-reduced-motion: reduce)` → all animations/transitions ~0 ms,
  ambient orbs frozen, smooth scrolling off.

Nothing breaks; the UI just becomes flatter, which is the point.

## 3 · Components

* **Top bar** — sticky pill that gains material once content scrolls beneath it
  (`is-scrolled`, driven by a passive scroll listener).
* **Cards** — `--radius-xl` surfaces with a hero, the input area, and results.
* **Dropzone** — dashed glass; hover/drag raise the icon with spring easing; a
  spinner appears while a file is read; it is a real button for keyboards.
* **Buttons** — `btn-primary` (tinted glass, dark-theme inversion), `btn-glass`
  (translucent secondary), `btn-ghost` (text-only), plus `link-btn` for inline
  actions such as *Show more*.
* **Segmented control** — a gliding glass thumb, `aria-pressed` kept in sync,
  state carried on the container's `[data-value]`.
* **Switch** — 38×22 pill with a spring-driven knob that grows to 42×24 on
  coarse pointers (touch targets).
* **Checklist** — the six required cookies as status chips:
  `ok` (green), `weak` (amber, amber = another Google/foreign domain),
  `expired` (amber), `missing`/`invalid` (red). Auto-filling grid.
* **Audit table** — sticky-free, horizontally scrollable, mono-spaced values
  masked by default; a single click reveals one cell, the switch reveals all.
* **Notes** — `note-warn` (⚠) and `note-info` (ℹ) rows, so warnings and
  information never look alike.
* **Banners** — inline status with a masked SVG icon per kind
  (`banner-ok/warn/err/info`), `role="status"`.
* **Toasts** — floating glass stack, max three, deduplicated, dismiss on click or
  after 3.6 s, pausing on hover; icons are CSS masks so no markup is generated in
  JavaScript.
* **Disclosures** — `<details>` styled consistently (help, advanced options,
  skipped lines).
* **404 page** — the same materials and tokens, with `script-src 'none'`.

## 4 · Motion

* Durations come from the tokens: 150 ms for state changes, 260 ms for
  structural transitions, 420 ms for entrances.
* Interactive elements use `--ease-spring` (a slight overshoot); structural
  transitions use `--ease-out`.
* Only `transform` and `opacity` animate, so compositing stays on the GPU.
* Entrance choreography: cards rise, table rows stagger 30 ms apart.
* `prefers-reduced-motion` disables all of it without changing layout.

## 5 · Accessibility

* Semantic landmarks (`header`, `main`, `footer`, labelled sections), one `<h1>`.
* Skip link to the converter; visible focus rings on everything focusable.
* Live regions: `role="status"` on the banner and the toast stack.
* The audit table has a `<caption>` and `scope="col"` headers; masked values
  never leak into the accessibility tree.
* Colour is never the only signal: every status also has a text label
  (*found*, *expired*, *missing*, …).
* Contrast: the light palette uses darker amber/red than the dark one so both
  themes keep body text and status colours readable.
* `prefers-reduced-transparency`, `prefers-reduced-motion` and `forced-colors`
  are all honoured.

## 6 · Theming behaviour

1. Before JavaScript runs, `prefers-color-scheme` decides (no flash).
2. `app.js` reads the stored preference (`gcc-theme`) and applies it if present.
3. With no stored preference it follows the OS **live** — a `matchMedia` change
   listener re-applies the theme when the OS switches at sunset.
4. Pressing the theme button pins an explicit choice forever (until storage is
   cleared); the button's tooltip and `aria-label` always describe the *next*
   action.
5. `meta[name="theme-color"]` is declared for both schemes so browser chrome
   matches the page.

## 7 · Copy guidelines

* Buttons are verbs: *Convert*, *Copy JSON*, *Download cookie.json*.
* Errors state what happened and what to do next (`error` + `hint`), never just
  "invalid input".
* The word "on-device" is preferred over "secure"; security claims stay concrete
  and verifiable.
* Documentation links appear where the question arises (help disclosure in the
  input card, troubleshooting link in failures, security link in the footer).
