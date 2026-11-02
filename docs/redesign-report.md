# Redesign report — Gemini Cookie Converter 2.4.0

A record of the audit, the direction, the implementation passes, the validation
and the refinement passes that turned this app from a liquid-glass demo into a
working instrument — and then, at the author's direction, re-skinned that
instrument in a **spatial glass** material system without changing a single
behaviour.

> Design philosophy adapted from [Unslop](https://github.com/heydamir/unslop) by
> Damir Sokolovsky (@heydamir), licensed under CC BY 4.0: strip the effects,
> decide what the product is, and let structure, type and spacing carry the
> interface. Nothing was copied; the method was.

---

## 1 · What this product actually is

**A one-job tool that runs entirely in the tab.**

You have a Gemini cookie export — a Netscape `cookies.txt`, an extension JSON
dump, a `Cookie:` header, a `Set-Cookie:` header, or a "Copy as cURL" command.
You want the exact two-key payload `gemini-web2api` expects:

```json
{ "cookie": "SID=…; HSID=…; __Secure-1PSID=…", "sapisid": "…" }
```

The app parses, validates and audits that export, shows you six required cookies
and their coverage, names what is missing or expired, and hands you JSON you can
copy or download. No server, no upload, no analytics, no dependencies, no build
step — `index.html` plus four files in `assets/`, gated by a strict CSP
(`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:`).

**The journeys that must survive any visual change** (all verified after the
redesign, not just the homepage):

| Journey | Path |
| --- | --- |
| Paste → convert | textarea → 150 ms format detection → Convert (or <kbd>Ctrl</kbd>+<kbd>↵</kbd>) |
| File → convert | dropzone click/browse or drag-drop → same pipeline |
| Sample → convert | five "load sample" entries in the guide → real parsing, not mock data |
| Audit | required-cookie checklist, six-cell coverage gauge, filterable table, masked values, notes, skipped-lines disclosure |
| Take it away | Copy JSON, `cookie.json`, `cookie.txt` |
| Reset | Clear with Undo toast |
| Options | extra Google cookies, allow expired cookies, reset to defaults |
| Help | Guide dialog with five tabs, plus the on-page three-step list |
| Theme | system / light / dark, persisted, `theme-color` in lockstep |
| Offline | service worker precache, PWA manifest, maskable icon |

**Hard constraints I did not touch:** parsing and payload logic
(`assets/converter.js`), the API/route surface (there is none — it is static),
the CSP, the test contracts (`#banner` variants, `check-ok`/`check-missing`,
`#output.value`, `#report-count`, table cell order), the version lockstep, the
zero-dependency policy and the absence of a build step.

---

## 2 · The audit, in priority order

The starting point was the v2.3.0 "liquid glass" interface. I read the code
before judging it: 13 `backdrop-filter` declarations, 28 gradient declarations,
a grain layer, a drifting ambient field, a pointer-following highlight on every
button, a gliding nav pill, and **nine glass surfaces of three different blur
radii on one page** (`glass-lg` topbar, two `glass-md` cards, three `glass-sm`
step cards, five `glass-sm` chips).

### P1 — Things that cost the user the task

| # | Where | What was wrong | Impact |
| --- | --- | --- | --- |
| 1 | `.reveal` on the input card, result card, step cards and guide head | Content started at `opacity: 0` and only appeared when an `IntersectionObserver` fired | A blank pane on a slow observer, a script-less client, or a screenshot taken mid-boot. On a phone the result pane could look empty while it held a conversion. |
| 2 | Convert button, `scheduleInputMeta()` | The button was re-enabled by the 150 ms format-detection debounce | Paste and click quickly and you hit a disabled button. The primary action could feel dead exactly when the user was fastest. |
| 3 | Scroll-spy, `initNavTracking()` | Observed `<main>`, which *contains* the guide section | Scrolling down to the guide and back to the top left the nav reading "Guide". Persistent, wrong state in the only navigation on the page. |

### P2 — Things that cost attention on every visit

| # | Where | What was wrong | Impact |
| --- | --- | --- | --- |
| 4 | `.bg`, `.bg-grain`, `.header-veil`, `.brand-mark::after`, `.btn.has-shine::after` | Five decorative layers, plus a pointer highlight on every button | Every surface competed with the data. On a low-end phone the blur stack was the most expensive thing on the page. |
| 5 | `.section-title`, `.kicker`, `.step-index`, table headers | Uppercase with `letter-spacing: 0.09em` in four places | Shouted labels on a tool that should whisper; uppercase mono also reads slower than the sentence-case it replaced. |
| 6 | `.chip-row` (5 chips), `.steps-grid` (3 glass cards), both `glass-md` cards | Four blocks of the same rounded, blurred material stacked down the page | Nothing said "this is the tool" and "this is reference material". Repetition read as a template. |

### P3 — Things that cost legibility in the audit itself

| # | Where | What was wrong | Impact |
| --- | --- | --- | --- |
| 7 | Cookie table, five columns in a 660 px column | Generic cell sizing; the value column collapsed first, domain wrapped, expiry was one long string | The table was the payoff of the whole app and the hardest thing to read. |
| 8 | Format/empty state copy | "Private" for the payload, `0 B / 5.0 MB` chrome, "comment line(s)" | Vague where it needed to be blunt (a payload *is* a password) and literal where it needed to be quiet (a counter at 0 B). |
| 9 | Icon set | A `sparkle` symbol used as decoration | An icon that means nothing is an emoji in wireframe clothing. |

### P4 — Small but visible

10. Nav indicator animated between items instead of marking state.
11. `Clear` and `How to find these` were the same visual weight as real actions.
12. Table rows hovered on a fill that broke the hairline grid.
13. The empty result pane was a large card with a small illustration and no
    information — the best place in the app to teach the payload shape, wasted.

**What was already good and stayed:** semantic landmarks and ARIA labelling,
visible focus rings, the reduced-motion / reduced-transparency / forced-colours /
print rules, keyboard access to every control, the six-cookie domain logic, the
masked-values privacy default, the PWA/offline path and the 404 page. A redesign
that broke those would have been a downgrade.

---

## 3 · The direction: a workbench, in glass

Two movements, in order.

**First, structure.** A lab instrument on a desk: one input pane, one result pane,
a table you can audit, an empty result pane that is a *stage* rather than a
placard, and a guide behind a real dialog. Hierarchy from structure, type and
spacing — not from effects. That audit and that rebuild stand: the information
architecture, the type scale, the table, the gauge, the copy and every behaviour
below are still what ships.

**Second, material.** With the structure holding, the interface was re-skinned on
a spatial-glass language: a slow field of colour behind the page, translucent
panes with a lit top edge, a floating capsule of chrome, capsule controls and one
lit primary action. The discipline that keeps glass from becoming decoration is
that **containers may be glass; data may not**. The table, the payload, the status
colours and the gauge sit on flat fills inside the glass, so a number never has to
compete with a blur.

### Colour system (real tokens, `assets/style.css`)

| Role | Dark | Light |
| --- | --- | --- |
| Canvas / deep | `#080a0e` / `#05070a` | `#f2f4f7` / `#ecf0f5` |
| Panel (glass) | `rgba(21,25,34,.68)` | `rgba(255,255,255,.66)` |
| Surface steps | `rgba(255,255,255,.045 → .11)` | `rgba(255,255,255,.66 → .82)`, `#ffffff`, `#e7ecf3` |
| Well (fields, table head) | `rgba(6,8,12,.55)` | `rgba(255,255,255,.62)` |
| Floating (overlays) | `rgba(22,26,35,.82)` | `rgba(252,253,255,.88)` |
| Text / strong | `#f6f7f9` / `#ffffff` | `#171a20` / `#0a0d12` |
| Muted / faint | `#a8afbb` / `#7f8896` | `#4d5560` / `#636b77` |
| Accent / strong | `#91c5ff` / `#b9d9ff` | `#0f63c8` / `#0a56b0` |
| Violet (gauge, field) | `#b9adff` | `#6658bf` |
| Lit capsule | `#d6e9ff → #8fc4f7`, ink `#06111d` | `#277bdc → #1267ca`, ink `#ffffff` |
| OK / warn / error | `#73d9a4` / `#f0c27a` / `#ef9a9a` | `#1b6f47` / `#7a5410` / `#a8322a` |
| Hairline / lit edge | `rgba(255,255,255,.09)` / `.17` | `rgba(19,27,40,.085)` / `.92` |

Four surface steps chosen by layer, never by taste; one accent for interaction;
one saturated fill in the whole product (the lit capsule). Semantic colours are a
3 px edge or a 5 px dot, never a wash — a tinted slab reads muddy in dark mode and
turns a status into decoration.

The light theme is not the dark theme dimmed: it is the same object on a paper-grey
desk, with a blue accent and white glass, and it is defined twice (media query and
`[data-theme]`) so first paint and an explicit choice agree.

### Type

| Token | Size | Use |
| --- | --- | --- |
| `--fs-display` | 40 (32 ≤ 860 px, 28 ≤ 560 px) | the one H1 on the page |
| H2 | 21 | section titles |
| `--fs-title` | 15 | pane titles |
| `--fs-body` | 15 | prose, controls |
| `--fs-small` | 13.5 | notes, secondary prose |
| `--fs-micro` | 12 | labels, metadata (tracked caps on micro-labels) |
| table | 11 mono | user data |

System sans for prose; system mono for **everything the user's data touches** —
cookie names, domains, expiry, payload, paths, formats, counts. Tabular numerals
for every number. Display tracking is tightened to −0.045em; uppercase survives
only on true micro-labels and on names that are uppercase in the source.

### Space, shape, depth

4 px rhythm (`--sp-1` … `--sp-10`); radii 6 / 10 / 14 / 20 / 28 / 36 / pill, so
controls are capsules, fields are 20, panes are 28 and overlays are 36. Three
elevations, each carrying a lit inset top edge (`--e-1/2/3`). Blur comes in three
sizes for three jobs: fields, panes, overlays.

### Components

Floating capsule header (brand tile, wordmark, context label, nav pills, icon
buttons); three button weights where the primary is the lit capsule; mono wells
with an accent focus ring; glass panes with sheen and lit edge; a flat sticky-header
table with masked cells; a pill coverage gauge; status as neutral surface + 3 px
edge; a native `<dialog>` for the guide; a popover that becomes a sheet on phones;
a floating thumb bar; glass toasts.

### The signature detail

**The six-cell coverage gauge.** Six cells in a 10 px pill track, filled with an
accent→violet gradient, turning green only at full coverage, with the count
spelled out beside it (`6/6`) so colour is never the only signal. It is where the
interface is allowed to be a little beautiful, and it earns it: it answers the
app's real question — *can I convert yet?* — at a glance.

### Motion

160 / 280 / 400 ms, transform/opacity/colour only, entrances once per pane.
`.reveal` is transform-only: an element is offset 4 px and eases into place,
**never hidden**. The ambient field drifts on 52–72 s cycles and is the only
continuous motion; `prefers-reduced-motion` removes every animation and
transition, including that one.

### Voice

Plain, specific, second person. "This payload is a password." "Six cookies from
`gemini.google.com` are all it needs." Named after what the user does, not what
the code calls it.

---

## 4 · The implementation passes

Each pass touched real files; nothing was mocked and no data was hardcoded.

The rebuild was nine passes over structure and behaviour. The later re-skin was
eleven section passes over `assets/style.css`, in dependency order — tokens → base
→ ambient field → chrome → layout → controls → readout → states → overlays →
motion → responsive → accessibility — with `npm run check` green after every one
and a screenshot review between them. Each visual defect that review found is
listed in §6.

**1 · Spacing and alignment.** Introduced the 4 px token scale and applied it to
every padding, gap and margin in `assets/style.css`; aligned pane heads, section
titles and action rows to a shared 16 px gutter; gave the intro block a
measure-limited lede (~68 ch). Removed the `spacing: 0.5px` drift that came from
ad-hoc rem values.

**2 · Colours and surfaces.** Replaced the glass stack with four opaque surface
steps, one accent, hairline borders, and a single solid ink fill. Rewrote
`theme-color` and the webmanifest to the new `--bg`; kept the light token block
byte-identical between the system-preference and manual-theme blocks (the gate
checks this).

**3 · Icons and controls.** Rebuilt the sprite (23 single-stroke symbols, one
deleted: `sparkle`). Buttons now come in three weights with a 34 px / 44 px
(coarse pointer) height; icon buttons are 32 px with a visible hover surface; the
switch, segmented control, tabs and popover were redrawn on the same tokens.

**4 · Copy.** Rewrote the intro, empty state, notes, banner messages, option
descriptions, guide, footer and 404. Killed "private" in favour of "password";
made the empty state teach the payload; made the readout say what happened
("*6 cookies parsed · 2 ms · 2 comment lines*") instead of repeating the format
the input badge already names; pluralised properly.

**5 · Typography.** One hierarchy (36/24/20/14.5/13/11.5), `line-height` 1.16 for
display and 1.6 for body, `-0.02em` tracking on display sizes only, tabular
numerals, mono for data. Removed the uppercase + `0.09em` treatment from every
label.

**6 · Layout and IA.** The page is now: intro → workbench (two panes side by side
above 860 px, stacked below) → guide (three ruled steps + five-row format list) →
footer. The input pane is sticky on wide screens so it stays beside a long audit
table. On phones the primary action spans the row and its companions share the
next line; the table keeps its semantics and scrolls sideways inside its frame,
with a one-line hint above it.

**7 · Component details.** Disabled states, hover surfaces, focus rings, sticky
table header, masked cells that reveal one at a time (and a switch that reveals
all), the sample-loading flow, the popover/sheet behaviour, the toast stack, the
skeleton for large inputs, and the `stale` marker when the textarea changes after
a conversion.

**8 · Data presentation.** The audit table is the payoff, so it got the work:
11 px mono cells, domains ellipsised at 150 px, a 112 px floor on values, expiry
split into the date plus a relative line that only appears within 45 days
(`in 12 days`, `expired`) — a countdown is only worth a line when it changes a
decision. The checklist keeps name / domain / status in three aligned columns.
Measured column widths in a 660 px wrap: 163 / 145 / 98 / 134 / 119 px, no
horizontal overflow on desktop.

**9 · Motion.** One short fade-and-rise per pane (40 ms apart), 90 ms state
flips, 140 ms hover, 200 ms overlays, 240 ms dialog, a sweep only while a file is
being read. All from tokens; all removed under `prefers-reduced-motion`.

Also rewritten: `404.html` (same tokens, `script-src 'none'`), the favicon and
maskable icon (monochrome cookie on graphite), `docs/design.md` (the design
system, now authoritative), `docs/changelog.md`, the READMEs and the testing
guide.

---

## 5 · Validation

| Check | Command | Result |
| --- | --- | --- |
| Repository gate | `npm run check` | **34 passed, 0 warnings, 0 failures** |
| Behaviour | `npm test` | **110 passed, 0 failed** (0 cancelled, 0 skipped) |
| Both | `npm run verify` | green |

The gate is not a formality: it locks the version in five files, validates every
element id and icon reference, the status-class / CSS pairing, `theme-color`
against `--bg`, AA contrast for text on surfaces and tints, duration tokens only,
44 px coarse-pointer targets, `[hidden] !important`, token-only radii and shadows,
the 4 px rhythm, the CSP, the absence of dynamic `innerHTML`/`eval`, the twin
light-token blocks, committed cookies, stray `console.log`/`TODO`, and an
asset-size ceiling.

**Run for real, in Chromium** (puppeteer-core + a headless build, `prefers-color-scheme`
emulated per shot):

* **Widths 320 / 360 / 390 / 414 / 768 / 1024 / 1280 / 1440** — screenshotted
  after a conversion, with `document.scrollWidth === clientWidth` confirmed at
  every width (no horizontal page scroll anywhere).
* **Both themes** on the workbench, the result pane, the guide, the table, the
  dialog, the options sheet and the 404.
* **Journeys replayed**: sample-curl → convert → copy, sample-json → convert →
  download, paste → convert, clear → undo, options toggles, guide tabs, theme
  toggle, nav scroll-spy down *and back up*.
* **No page errors, no console errors** in any run.
* **Keyboard**: tab order reaches the skip link, nav, options, theme, dropzone,
  textarea, Convert, samples; the focus ring is visible on every stop; the dialog
  traps focus and returns it to its trigger.
* **Reduced motion**: full page screenshotted — every element present, no
  zero-opacity leftovers.
* **Forced colours / print**: rules exist and hide decoration rather than content.

---

## 6 · Senior-designer refinement pass

The last pass was not "more design"; it was looking at real renders and fixing
what they showed. Six defects, one of which was shipping.

1. **Blank panes (P1).** The phone full-page screenshot showed empty regions
   where content should be. Cause: `.reveal` started at `opacity: 0`. Fix:
   entrance is transform-only at `@media (scripting: enabled)` — 4 px offset,
   never hidden. Content can no longer be invisible, whatever the observer does.
2. **Dead Convert after paste (P1).** `scheduleInputMeta()` now sets both Convert
   buttons' `disabled` from input emptiness *before* the 150 ms debounce, so the
   primary action is never dead in the window right after a paste.
3. **Stale nav (P1).** The observer now watches `.workbench` instead of `<main>`,
   which contains the guide. Verified by scrolling down and back: `converter` →
   `guide` → `converter`.
4. **Squeezed table (P2).** Cells restyled, domain cells ellipsised, values given
   a floor, expiry split into date + relative. Then the relative line was
   suppressed beyond 45 days, which turned seven two-line rows into seven
   single-line rows and removed the need for a 420 px cap to ever bite.
5. **Muddy banners (P2).** Tinted fills read brown in dark mode. Banners became a
   neutral `--s-2` surface with a 3 px status edge — one deliberate mark instead
   of a wash. The one tint that survived is the placeholder warning, because it
   changes what you should do next.
6. **Phones (P2).** Primary actions span their row and secondary actions share
   the next; a long format badge wraps instead of being clipped at 320 px; the
   table says "Swipe for flags and values" instead of ending in a half-cut
   column; `.exp-rel` and the keyboard hint are dropped at 560/480 px.

Judgement calls, recorded so they are not mistaken for oversights:

* **The table scrolls on phones instead of becoming cards.** Restacking a `<tr>`
  into a grid loses table semantics in some screen readers, and this app's
  accessibility contract is stronger than the aesthetic gain. The hint plus the
  framed, keyboard-reachable scroll region are the compromise.
* **Inline `code` lost its grey pill.** In a design where every data value is
  already mono, a chip inside a sentence is noise. Code *blocks* keep their own
  surface.
* **Duplicate format lists are kept.** The empty result pane lists the six
  cookies and the payload shape (it is the stage); the guide lists the five
  input formats with provenance and a sample action (it is the reference). Two
  jobs, two presentations, no repeated card grid.
* **Only two flourishes, and they are earned.** The ambient field (which is
  nearly invisible until you stop moving) and the six-cell gauge. Everything else
  — the brand mark, the pane heads, the table header, the banners — refuses
  gradient on purpose, which is what makes the lit capsule read as *the* action.
* **No blur inside a data surface.** The glass stops at the pane edge: table,
  payload and status keep flat fills and full contrast, and print and reduced
  transparency flatten the rest.

Final state: `npm run verify` green, 34/34 checks, 110/110 tests, no console
errors, no horizontal overflow from 320 px to 1440 px, in both themes.

---

## Appendix · Where things live

| File | Role |
| --- | --- |
| `index.html` | one page, 23-symbol sprite, two panes, guide, footer, thumb bar, guide dialog |
| `assets/style.css` | the design system: tokens → layout → components → states → motion → responsive → media/print |
| `assets/app.js` | wiring and rendering; parsing untouched |
| `assets/converter.js` | pure parsing and payload building (unchanged) |
| `assets/ui.js` | `window.UI`: icons, toasts, popover, dialog, tabs, reveal, number roll |
| `scripts/check.js` | the 34-assertion repository gate |
| `tests/` | 110 TAP tests over the converter and the DOM stub |
| `docs/design.md` | the authoritative design document |
| `sw.js`, `site.webmanifest`, `_headers` | offline path, theme colour, security headers |
