# Design system

The interface is a self-contained "liquid glass" system: translucent materials,
explicit depth, calm motion, and hierarchy carried by spacing and type rather
than by borders and colour. It is original work — the Apple-ish feel comes from
principles (translucency, depth, spatial layering), not from copying Apple's
assets, icons or layouts.

Everything lives in `assets/style.css` (tokens → materials → base → components →
motion → responsive → accessibility) and `assets/ui.js` (behaviour primitives).
There are no inline styles or scripts anywhere — the strict CSP forbids them — so
every visual decision is a token or a class.

```
tokens (:root)  →  materials (.glass-sm/md/lg/tint)  →  components  →  motion
```

---

## 1 · Tokens

All tokens live in `:root`. The light palette is defined twice, on purpose: once
inside `@media (prefers-color-scheme: light)` (so the *first paint* already
matches the OS — no flash of the wrong theme) and once for `[data-theme="light"]`
(an explicit choice on a dark-preferring OS). The two blocks are marked
`@light-tokens:start/end`, and `npm run check` fails if they ever drift apart.

| Group | Tokens | Notes |
| --- | --- | --- |
| Palette | `--bg`, `--bg-deep`, `--text`, `--text-strong`, `--muted`, `--faint` | light is a real palette, not an inversion |
| Accents | `--accent`, `--accent-strong`, `--accent-ink`, `--accent-soft`, `--accent-line`, `--violet`, `--violet-soft` | `-soft`/`-line` are the translucent fills and hairline tints |
| Status | `--ok`, `--warn`, `--err` + `-soft` / `-line` variants | light theme darkens them for contrast |
| Surfaces | `--s-1 … --s-4`, `--s-hover`, `--row-hover` | four translucency steps: recessed, surface, raised, pressed |
| Edges | `--hairline`, `--hairline-strong`, `--edge`, `--edge-soft` | 1 px translucent borders + the inner top highlight |
| Wells | `--well`, `--well-border` | inset reading surfaces (payload, cURL snippet, table head) |
| Fallback | `--solid`, `--solid-deep` | opaque fills when `backdrop-filter` is missing or transparency is reduced |
| Geometry | `--radius-xs/sm/md/lg/xl/2xl/pill` | 8 → 34 px, plus pills |
| Spacing | `--sp-1 … --sp-10` | 4 → 88 px, a 4 px rhythm |
| Type | `--font-sans`, `--font-mono`, `--fs-display/title/head/body/small/micro`, `--lh-*`, `--tr-*` | system fonts only — no web-font requests, ever |
| Depth | `--e-0/1/2/3`, `--e-inset` | soft ambient shadows; `--e-inset` is the top light line |
| Blur | `--blur-sm/md/lg`, `--saturate` | 12 / 22 / 34 px, saturated backdrop |
| Motion | `--t-instant 120`, `--t-quick 180`, `--t-standard 260`, `--t-slow 340`, `--t-sheet 460` | micro, quick, standard, large, sheet |
| Easing | `--ease-standard`, `--ease-entrance`, `--ease-exit`, `--ease-spring` | entrances settle, exits leave quickly, springs only overshoot slightly |
| Layers | `--z-bg 0`, `--z-veil 10`, `--z-content 20`, `--z-nav 30`, `--z-pop 40`, `--z-dialog 50`, `--z-toast 60` | the stacking order, written down once |

Adding a colour or a duration means adding a token — components never hard-code
values. `npm run check` fails if the two light blocks disagree, and browser
chrome colours (`theme-color`, the web manifest) are verified against `--bg`.

## 2 · Materials

| Class | Use | Recipe |
| --- | --- | --- |
| `.glass-sm` | lists, groupings, footers | 12 px blur + `--s-1` fill + hairline |
| `.glass-md` | cards and panels | 22 px blur + `--s-2` gradient + `--e-inset` + `--e-1` |
| `.glass-lg` | top bar, mobile bar, popovers, dialogs, toasts | 34 px blur + `--s-3` + `--hairline-strong` + `--e-3` |
| `.glass-tint` | accent-context surfaces (primary buttons, active pills) | accent-soft fill + accent-line border |

`.glass`, `.glass-soft` and `.glass-float` remain as aliases for the three
strengths so existing markup keeps working. Text and important controls are never
translucent: they sit on `--well` or solid fills.

Degradation is explicit and always keeps the layout:

* `@supports not (backdrop-filter: …)` → opaque `--solid` fills.
* `@media (prefers-reduced-transparency: reduce)` → the same opaque fills.
* `@media (forced-colors: active)` → system colours, glass removed.
* `@media (prefers-reduced-motion: reduce)` → animation collapsed to state
  changes, ambient fields frozen, smooth scrolling off.

## 3 · Depth model

| Layer | Owner | Examples |
| --- | --- | --- |
| L0 | `.bg`, `.bg-field`, `.bg-lamp`, `.bg-grain` | ambient light fields that give glass something to refract |
| L1 | page content | headings, prose, empty state, steps |
| L2 | `.card` | input card (sticky on wide screens), result card |
| L3 | floating chrome | `.topbar`, `.bottombar`, `.to-top`, `.header-veil` |
| L4 | popovers | `#options-panel` (anchored on desktop, sheet ≤ 720 px) |
| L5 | dialogs | `dialog.sheet` (guide), with a scrim and animated close |
| L6 | toasts | `.toast-stack` |

Each layer uses a different blur, opacity, shadow and z-index token, so depth is
legible even with motion disabled.

## 4 · Components

* **Top bar** — floating pill that gains material once content scrolls beneath it
  (`is-scrolled`, set from a passive scroll listener); the nav indicator glides
  between items and scroll-spy keeps it honest.
* **Mobile bar** — below 720 px the nav collapses into a thumb-reachable bottom
  bar with the primary action, guide and options.
* **Buttons** — `btn-primary` (tinted glass), `btn-glass` (translucent secondary)
  and `btn-ghost` (text-only), plus `link-btn` for inline actions such as *Show
  more*. Hover brightens, press compresses, focus draws a ring, `:disabled`
  desaturates.
* **Fields** — translucent `textarea` and search inputs on `--well` with a calm
  focus transition; the character counter, format badge and stale marker update
  without moving the layout.
* **Dropzone** — dashed glass, hover/drag raise the icon, a sweep runs while a
  file is read; it is a real button for keyboards.
* **Cards** — `--radius-xl` surfaces with a single subtle hover elevation; cards
  are used for hierarchy, not for every row.
* **Segmented control** — a gliding glass thumb, `aria-pressed` kept in sync,
  state carried on the container's `[data-value]`.
* **Switch** — 38×22 pill with a spring-driven knob that grows on coarse
  pointers (touch targets).
* **Checklist + coverage meter** — the six required cookies as status rows
  (`ok` green, `weak`/`expired` amber, `invalid`/`missing` red) and a meter whose
  fill scales with `--progress`, animating only `transform`.
* **Audit table** — sticky header, horizontally scrollable, mono-spaced values
  masked by default; one click reveals one cell, the switch reveals all.
* **Notes and banners** — `note-warn` / `note-info` and
  `banner-ok/warn/err/info`, each with its own masked icon, so states never look
  alike.
* **Toasts** — floating glass, max three, deduplicated by message, dismiss on
  click, auto-dismiss with hover pause, and one can carry an action (Undo after
  Clear).
* **Dialog** — native `<dialog>` with a scrim, a rise-and-scale entrance, an
  animated exit (`is-closing`) and focus returned to the trigger.
* **Empty and loading states** — a first-run card with two actions, and a
  skeleton that matches the real result card for very large inputs.
* **404 page** — the same materials and tokens, with `script-src 'none'`: it
  animates with pure CSS and never depends on JavaScript to become visible.

## 5 · Motion

* Durations come from the tokens: 120 ms micro-feedback, 180 ms quick state
  changes, 260 ms standard transitions, 340 ms large movements, 460 ms sheets.
* Interactive elements use `--ease-spring`; entrances use `--ease-entrance`;
  exits use `--ease-exit` so leaving feels decisive.
* Only `transform`, `opacity` and `filter` animate — compositing stays on the
  GPU, and nothing animates `backdrop-filter`.
* Pointer-tracked shine is rAF-throttled and passive; there is no animation loop
  anywhere in the app.
* Entrance choreography: cards rise, table rows stagger 30 ms apart, and
  `.reveal` only hides content under `@media (scripting: enabled)` so a
  script-less page still shows everything.
* `prefers-reduced-motion` disables all of it without changing layout.

## 6 · Accessibility

* Semantic landmarks (`header`, `main`, `footer`, labelled sections), one `<h1>`.
* Skip link to the converter; visible `:focus-visible` rings on everything
  focusable, including custom controls.
* Live regions: `role="status"` on the banner, `aria-live="polite"` on the toast
  stack; the options popover tracks `aria-expanded`, the tab list is a real ARIA
  tablist (arrow keys, Home/End, roving `tabindex`).
* The audit table has a `<caption>` and `scope="col"` headers; masked values
  never leak into the accessibility tree.
* Colour is never the only signal: every status also has a text label
  (*found*, *expired*, *missing*, …) and an icon.
* Contrast: the light palette uses darker amber/red than the dark one so both
  themes keep body text and status colours readable.
* `prefers-reduced-transparency`, `prefers-reduced-motion` and `forced-colors`
  are all honoured, and printing hides every layer except the payload.

## 7 · Theming behaviour

1. Before JavaScript runs, `prefers-color-scheme` decides (no flash).
2. `app.js` reads the stored preference (`gcc-theme`) and applies it if present.
3. With no stored preference it follows the OS **live** — a `matchMedia` change
   listener re-applies the theme when the OS switches at sunset.
4. Pressing the theme button pins an explicit choice forever (until storage is
   cleared); the button's tooltip and `aria-label` always describe the *next*
   action.
5. `meta[name="theme-color"]` and the web manifest are checked against `--bg`, so
   browser chrome always matches the page in both schemes.

## 8 · Copy guidelines

* Buttons are verbs: *Convert*, *Copy JSON*, *Download cookie.json*.
* Errors state what happened and what to do next (`error` + `hint`), never just
  "invalid input".
* The word "on-device" is preferred over "secure"; security claims stay concrete
  and verifiable.
* Documentation links appear where the question arises (guide dialog, footer,
  troubleshooting links in failures).
