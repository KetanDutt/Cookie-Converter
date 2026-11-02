# Design system

The interface is an **instrument**: a two-pane workbench on a flat surface, where
hairlines, type and spacing carry the hierarchy and colour is spent on exactly
two things — interaction and the six required cookies. There is no blur, no
glass, no gradient chrome, and no decoration that does not carry information.

Everything lives in `assets/style.css` (tokens → base → chrome → layout →
controls → readout → states → overlays → motion → responsive → accessibility)
and `assets/ui.js` (behaviour primitives). There are no inline styles or scripts
anywhere — the strict CSP forbids them — so every visual decision is a token or
a class.

```
tokens (:root)  →  base  →  chrome  →  panes  →  components  →  motion
```

---

## 1 · Personality

| | |
| --- | --- |
| **Feels like** | a measuring instrument, not a website: quiet, exact, unhurried |
| **Users** | developers and self-hosters handling a secret they understand |
| **Materials** | opaque paper (light) or graphite (dark); 1 px hairlines; no elevation except overlays |
| **Type** | system sans for prose, system mono for anything the user's data touches |
| **Colour** | ink + paper + one steel-blue accent; green/amber/red only for status |
| **Signature** | the *rule-and-gauge* motif: section titles sit on full-width hairlines, and the required-cookie meter is a six-cell instrument, not a progress bar |

Richness is deliberately not distributed. The only saturated surfaces in the
product are the coverage gauge, the primary button, and the payload block.

## 2 · Tokens

All tokens live in `:root`. The light palette is defined twice, on purpose: once
inside `@media (prefers-color-scheme: light)` (so the *first paint* already
matches the OS) and once for `[data-theme="light"]` (an explicit choice on a
dark-preferring OS). Both blocks are marked `@light-tokens:start/end`, and
`npm run check` fails if they drift apart.

| Group | Tokens | Notes |
| --- | --- | --- |
| Palette | `--bg`, `--bg-deep`, `--panel`, `--text`, `--text-strong`, `--muted`, `--faint` | light is warm paper (`#f6f5f1`), dark is graphite (`#0f1011`) |
| Accent | `--accent`, `--accent-strong`, `--accent-ink`, `--accent-soft`, `--accent-line` | steel blue; used for links, focus, selection, the gauge |
| Status | `--ok`, `--warn`, `--err` + `-soft` / `-line` | light theme darkens them so both themes clear AA |
| Surfaces | `--s-1 … --s-4`, `--s-hover`, `--row-hover` | four **opaque** steps: panel, raised, chrome, pressed |
| Edges | `--hairline`, `--hairline-strong` | 1 px separators; never a shadow where a line will do |
| Wells | `--well`, `--well-border` | inputs, code blocks, table head — recessed reading surfaces |
| Ink button | `--solid-ink`, `--solid-ink-hover`, `--solid-ink-text` | the single solid fill; inverted per theme |
| Geometry | `--radius-2xs 2`, `--radius-xs 4`, `--radius-sm 6`, `--radius-md 8`, `--radius-lg 12`, `--radius-xl 16`, `--radius-pill` | controls 6, panes 12, dialogs 16 |
| Spacing | `--sp-1 4` … `--sp-10 80` | a strict 4 px rhythm |
| Type | `--font-sans`, `--font-mono`, `--fs-display 36 / title 20 / head 14 / body 14.5 / small 13 / micro 11.5`, `--lh-tight/snug/body` | system fonts only — no web-font requests, ever |
| Depth | `--e-1`, `--e-2`, `--e-3`, `--e-ring`, `--e-halo` | overlays only; `-ring` is the focus ring, `-halo` separates a dot from its surface |
| Motion | `--t-instant 90`, `--t-quick 140`, `--t-standard 200`, `--t-slow 320`, `--t-sheet 240`, `--t-sweep 900`, `--t-pulse 1400` | all durations are tokens |
| Easing | `--ease-standard`, `--ease-out`, `--ease-in` | no bounce, no overshoot |
| Layout | `--content-max 1160`, `--header-h 60`, `--gutter 24` | |
| Layers | `--z-veil 20`, `--z-nav 30`, `--z-pop 40`, `--z-dialog 50` (native top layer), `--z-toast 60` | |

`npm run check` enforces the parts that used to rely on discipline:

* the two light blocks must stay byte-identical;
* browser chrome colours (`theme-color`, the web manifest) must equal `--bg`;
* **no raw duration** may appear outside a `--t-*` definition;
* every text/background pair must clear WCAG AA, and `--muted` must stay visibly
  apart from `--faint` so the hierarchy survives;
* every `border-radius` and every `box-shadow` must compose tokens, and every
  spacing declaration must sit on the 2 px/4 px rhythm;
* `[hidden] { display: none !important }` must exist — an author `display`
  declaration outranks the user agent's rule, and without the guard the regions
  the app hides would be painted anyway.

## 3 · Layout model

| Layer | Owner | Notes |
| --- | --- | --- |
| L0 | page background | flat `--bg`; the only ambient effect is a hairline scroll shadow (`.header-veil`) |
| L1 | `.workspace` | max 1160 px, 24 px gutters, an intro block then the workbench |
| L2 | `.pane` | the input pane and the result pane: 1 px border, 12 px radius, opaque `--panel` |
| L3 | sticky chrome | `.topbar` (60 px, hairline bottom), `.bottombar` (thumb bar ≤ 720 px) |
| L4 | `.popover` | options: anchored popover on desktop, bottom sheet ≤ 720 px |
| L5 | `dialog.sheet` | guide: native modal, 760 px, header / tabs / scrollable panel / footer |
| L6 | `.toast` | bottom-left on desktop, above the thumb bar on phones |

The workbench is `minmax(340px, 400px) 1fr` above 860 px and stacks below it. The
input pane is sticky on wide screens so it stays next to a long audit table.

Action rows adapt instead of shrinking: above 480 px the primary sits left and the
secondary actions right; at or below 480 px the primary spans the row and its
companions share one line under it, so no button ever gets narrower than its label.
The audit table keeps its markup and semantics on phones and scrolls sideways
inside its framed region, with a mono hint above it saying so.

## 4 · Components

* **Top bar** — brand, two underlined text tabs, options and theme icon buttons.
  A hairline and a 16 px scroll gradient appear once the page moves
  (`.topbar.is-scrolled`, `.header-veil.is-active`).
* **Buttons** — three weights and nothing else: `btn-primary` (solid ink),
  `btn-secondary` (panel + hairline), `btn-ghost` (text). Height 34 px (44 px on
  coarse pointers), 6 px radius, one hover surface, a brightness press. Disabled
  is a state, not a dimmer: `.btn-primary:disabled` drops to `--s-3` with a
  hairline and `--faint` text, so an inactive Convert reads as empty rather than
  as a washed-out primary.
* **Fields** — mono textarea on `--well` with a 1 px border; focus swaps the
  border to the accent and adds a 3 px soft ring. The character counter, format
  badge and stale marker update in place, never shifting layout.
* **Format badge** — a state dot plus `Detected: …` in mono; the dot turns accent
  and the chip tints once a format is recognised. The label carries the meaning.
* **Dropzone** — a dashed hairline row that becomes a solid accent line on hover,
  drag-over or focus; a 2 px sweep runs only while a file is being read.
* **Panes** — one bordered surface per job. Section titles (`Required cookies`,
  `Cookies found`, `Generated payload`) sit on a hairline that spans the pane.
* **Coverage gauge** — six cells in an 8 px track; fill scales with `--progress`
  on `transform`, ticks are drawn with a repeating gradient, and the count is
  spelled out (`6/6`) so colour is never the only signal. It turns green only at
  full coverage.
* **Checklist** — one row per required cookie: status glyph, mono name, domain,
  text badge. Status is icon + word + colour, never colour alone.
* **Audit table** — sticky header on `--well`, 6 px vertical rhythm, 11 px mono
  cells, mono values masked by default; one click reveals one cell, the toggle
  reveals all. Domains ellipsise at 150 px, values keep a 112 px floor, and
  expiry prints the date with a relative line (`in 12 days`, `expired`) that only
  appears within 45 days of expiry — a countdown is only worth a line when it
  changes a decision.
* **Notes & banners** — banners are a neutral `--s-2` surface with a 3 px status
  edge, so the colour is one deliberate mark instead of a tinted slab; notes are
  plain text with a status dot and mono headings, except the placeholder warning,
  the one note that keeps a tint because it changes what you should do next.
  Banners are `role="status"`.
* **Inline code** — mono at 0.92 em with no pill, no border and no fill: in a
  design that already sets every value in mono, a grey chip on `gemini.google.com`
  inside a sentence is noise. Code blocks keep their own surface.
* **Segmented control** — a 26 px well with two buttons; the active one is a
  raised panel with `box-shadow: --e-1`.
* **Switch** — 34 × 20 px track, 12 px knob, accent when on; the whole row is the
  label, so the touch target is 44 px.
* **Popover / dialog / tabs** — hairline borders, one shadow token, underline tabs
  driven by `aria-selected`, focus returned to the trigger on close.
* **Empty state** — real product content: the six required cookie names and the
  payload shape, plus two actions. No illustration.
* **404 page** — same tokens, `script-src 'none'`, a ruled block with the code,
  the message and two actions; it needs no JavaScript to be visible.

## 5 · Motion

* 90 ms for state flips, 140 ms for hover/press, 200 ms for overlays, 320 ms for
  entrances, 240 ms for the dialog. All from tokens.
* Only `transform`, `opacity` and `filter` animate; nothing animates layout, blur
  or colour-with-layout.
* Entrances are one short fade-and-rise per pane (40 ms apart), once. There is no
  parallax, pulsing, marquee or pointer tracking.
* `.reveal` never hides content: an unrevealed element is only offset by 4 px
  and eases to its place, so a slow observer, a script-less page or a screenshot
  taken mid-boot can never show a blank pane.
* `prefers-reduced-motion: reduce` removes every transition and animation without
  changing layout or behaviour.

## 6 · Accessibility

* Semantic landmarks (`header`, `main`, `footer`, labelled sections), one `<h1>`.
* Skip link to the converter; a single global `:focus-visible` ring (`--focus`,
  2 px, 2 px offset) that is never removed on interactive elements.
* Live regions: `role="status"` on the banner, `aria-live="polite"` on the toast
  stack; the popover tracks `aria-expanded`, the tab list is a real ARIA tablist
  (arrow keys, Home/End, roving `tabindex`).
* The audit table has a `<caption>` and `scope="col"` headers; masked values never
  leak into the accessibility tree.
* Colour is never the only signal: every status has a word and a glyph, and the
  coverage meter has a numeric label.
* Contrast is measured by `npm run check` in both themes; `--muted`/`--faint` are
  kept at least 1.25× apart so secondary text still reads as secondary.
* Touch targets: every control declares a ≥ 44 px target inside
  `@media (pointer: coarse)`.
* `prefers-reduced-transparency`, `prefers-contrast`, `prefers-reduced-motion`,
  `forced-colors` and print all have explicit rules; print re-declares the palette
  and keeps only the payload.

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

* Name the thing: *Cookie export*, *Required cookies*, *Generated payload*.
* Buttons are verbs: *Convert*, *Copy JSON*, *Load sample*, *Reset to defaults*.
* Errors state what happened and what to do next (`error` + `hint`), never just
  "invalid input".
* Say what is true instead of what sounds safe: "no upload, no network request,
  no storage of cookie values" rather than "bank-level security".
* The payload is described as a password, because that is what it is.
* No decorative superlatives, no exclamation marks, no emoji.
