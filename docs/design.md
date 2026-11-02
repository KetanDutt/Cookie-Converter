# Design system

The interface is **frosted glass over a slow field of colour**: a floating capsule
of chrome, two translucent panes, and inside them flat surfaces that carry the
actual work. Nothing floats that does not need to; nothing carrying data is ever
blurred.

Everything lives in `assets/style.css` (tokens → base → field → chrome → layout →
controls → readout → states → overlays → motion → responsive → accessibility) and
`assets/ui.js` (behaviour primitives). There are no inline styles or scripts
anywhere — the strict CSP forbids them — so every visual decision is a token or a
class.

The approach is adapted from [Unslop](https://github.com/heydamir/unslop) by
Damir Sokolovsky ([@heydamir](https://github.com/heydamir)), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The material language
is a spatial-glass system: translucent panels, lit edges, capsule geometry and a
lit primary action.

---

## 1 · Personality

Calm, cold, precise. A dark navy canvas with three very slow colour fields behind
it; one lit capsule per screen; everything else in graphite glass and cool ink.
Light mode is the same object on a paper-grey desk: white glass, blue accent, the
same geometry.

Two rules keep it from becoming decoration:

1. **Glass is for containers, not for content.** Chrome, panes, the popover, the
   dialog, the toast and the thumb bar are materials. The audit table, the
   payload, status colours and the coverage gauge sit on flat fills so numbers
   never have to fight a blur.
2. **One accent, one lit button.** The accent marks interaction and detection;
   the gradient capsule is the only saturated fill in the product.

The signature moment is the **six-cell coverage gauge**: six cells in a pill
track, filled with an accent→violet gradient, turning green at full coverage,
with the count spelled out (`6/6`) so colour is never the only signal.

---

## 2 · Tokens

### Canvas and ink

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `#080a0e` | `#f2f4f7` |
| `--bg-deep` | `#05070a` | `#ecf0f5` |
| `--text` / `--text-strong` | `#f6f7f9` / `#ffffff` | `#171a20` / `#0a0d12` |
| `--muted` / `--faint` | `#a8afbb` / `#7f8896` | `#4d5560` / `#636b77` |
| `--accent` / `--accent-strong` | `#91c5ff` / `#b9d9ff` | `#0f63c8` / `#0a56b0` |
| `--violet` | `#b9adff` | `#6658bf` |
| `--ok` / `--warn` / `--err` | `#73d9a4` / `#f0c27a` / `#ef9a9a` | `#1b6f47` / `#7a5410` / `#a8322a` |

Every pair that carries text is measured by `npm run check` (AA on four surface
steps, the well, the four tint fills and the accent); the gate is the contract,
not a spot check.

### Materials

| Token | Value (dark) | Use |
| --- | --- | --- |
| `--s-1` / `--panel` | `rgba(21,25,34,.68)` | panes, nav, cards |
| `--s-2` | `rgba(255,255,255,.045)` | inner surfaces, banners, rows |
| `--s-3` | `rgba(255,255,255,.075)` | hover, active nav, selected segment |
| `--s-4` | `rgba(255,255,255,.11)` | pressed, strongest neutral |
| `--well` | `rgba(6,8,12,.55)` | fields, table header, wells |
| `--material-floating` | `rgba(22,26,35,.82)` | popover, dialog, toast, thumb bar |
| `--material-tinted` | `rgba(145,197,255,.10)` | accent-tinted chips |
| `--edge` | `rgba(255,255,255,.17)` | the lit top edge (`--e-inset`) |
| `--blur-sm/md/lg` | `12/22/36px` + saturation | field wells → panes → overlays |

Glass is always *material + `backdrop-filter` + lit edge*, and always degrades:
`prefers-reduced-transparency`, a missing `backdrop-filter` and forced-colours all
replace it with `--bg-deep`.

### Shape, space, depth, motion

* Radii: 6 / 10 / 14 / 20 / 28 / 36 / pill. Capsules are the default control
  shape; panes are 28; overlays are 36.
* Space: 4 px rhythm (`--sp-1` … `--sp-10`); pane padding 20; section breaks 40.
* Depth: `--e-1` (lit inset + small drop), `--e-2` (panes, nav), `--e-3`
  (overlays), all carrying the inset top highlight.
* Motion: 160 / 280 / 400 ms with an out-quint ease. The ambient field drifts on
  52 / 64 / 72 s periods — visible only if you sit and watch.

---

## 3 · Layout model

| Layer | Owner | Notes |
| --- | --- | --- |
| L-1 | `.atmosphere` | fixed, `z-index: -1`: two accent fields and one violet, blurred 110 px, drifting |
| L1 | `.workspace` | max 1180 px, 24 px gutters, clears the floating bar |
| L2 | `.pane` | the input and result panes: glass, 28 px radius, 1 px hairline, lit edge |
| L3 | `.topbar` | fixed capsule 16 px from the top: brand, nav pills, icon buttons |
| L4 | `.popover` | options; anchored on desktop, sheet on phones |
| L4 | `dialog.sheet` | guide; native modal, blurred backdrop |
| L5 | `.bottombar` | floating capsule on phones (≤ 720 px) |
| L6 | `.toast-stack` | bottom-left, above the thumb bar on phones |

The workbench is `minmax(340px, 420px) 1fr` above 860 px, stacked below it. The
input pane is sticky on wide screens, offset by `nav-top + header + 16`. Scroll
targets carry `scroll-margin-top` so nothing lands under the floating bar.

---

## 4 · Components

* **Top bar** — a fixed capsule: 34 px paper tile with the cookie mark, a wordmark,
  a mono context label, two nav pills, two icon buttons. `.is-scrolled` deepens
  the material and the border; a soft veil fades content passing underneath.
* **Nav pills** — 34 px capsules; the active one is `--s-3` with a hairline and
  `--e-1`. No underlines, no sliding indicator.
* **Buttons** — three weights: `btn-primary` (the lit gradient capsule, dark ink
  in dark mode and white in light), `btn-secondary` (`--s-2` + hairline),
  `btn-ghost` (text only, tighter padding). 40 px tall (44 on coarse pointers),
  pill radius. Disabled is a state, not a dimmer.
* **Fields** — mono textarea on `--well` with a lit inset edge, 20 px radius;
  focus swaps the border to the accent and adds the 4 px soft ring.
* **Format badge** — a pill with a state dot; it tints accent and gains an accent
  hairline once a format is recognised.
* **Dropzone** — a `--s-2` slot with a dashed hairline that turns solid accent on
  hover, drag-over or focus.
* **Panes** — one glass surface per job; section rules are lighter than box
  edges (`--divider`), titles are 14.5/620.
* **Coverage gauge** — six cells in a 10 px pill track, accent→violet gradient,
  green at 6/6, count in mono.
* **Checklist** — status glyph, mono name, domain, status pill. On phones the name
  wins the space and the domain ellipsises.
* **Audit table** — flat `--bg-deep` sticky header, 11 px mono cells, masked
  values, domains ellipsised at 150 px, a relative expiry that only appears
  within 45 days. Scrolls sideways on phones with a mono hint; blur never enters
  a cell.
* **Notes & banners** — neutral `--s-2` with a 3 px status edge; notes are plain
  text with a status dot and mono headings.
* **Popover / dialog / toast** — `--material-floating` with `--blur-lg` and
  `--e-3`; the dialog's backdrop blurs the page behind it.
* **Thumb bar** — a floating capsule with a lit Convert pill and two quiet
  actions.
* **404** — the same glass card, centred, `script-src 'none'`.

---

## 5 · Motion

* 160 ms for state flips, 280 ms for hover/overlays, 400 ms for structural
  entrances; every duration is a `--t-*` token.
* Only `transform`, `opacity`, `filter` and colours animate.
* `.reveal` never hides content: an unrevealed element is offset 4 px and eases
  into place, so a slow observer or a script-less page can never show a blank
  pane.
* The ambient field is the only continuous motion, and it is almost imperceptible
  (52–72 s, `alternate`).
* `prefers-reduced-motion: reduce` removes every animation and transition,
  including the drift.

---

## 6 · Accessibility

* Contrast: every text/surface pair the gate can enumerate must clear WCAG AA in
  both themes; muted and faint must stay far enough apart that the hierarchy
  survives.
* Focus: a 2 px accent outline with a 4 px soft ring on every focusable element.
* Touch: 44 px targets under `(pointer: coarse)`.
* Glass degrades to solid under `prefers-reduced-transparency`, a missing
  `backdrop-filter`, forced-colours and print.
* Status is always icon **and** word **and** colour; the gauge always prints its
  count.
* Scroll regions are keyboard reachable (`#table-wrap` carries `tabindex="0"`).
* Print drops the field, the chrome, the actions and the payload block, and
  re-inks the text.

---

## 7 · Theming behaviour

Dark is the default (`:root`, `color-scheme: dark`). Light is defined twice —
`@media (prefers-color-scheme: light)` for first paint and `[data-theme="light"]`
for an explicit choice — and the two blocks must be byte-identical (the gate
compares them). `theme-color`, the manifest and the 404 all read the same `--bg`.

---

## 8 · Copy guidelines

Say what happens, in the second person, without adjectives. "This payload is a
password." "Six cookies from `gemini.google.com` are all it needs." Name things
by what the user does, not by what the code calls them. Numbers are mono and
carry units; plurals are real; no exclamation marks.
