---
name: Shamal
description: Warm, low-contrast, flat-shaded desert UI over a Firewatch-style 3D world — the interface reads as diegetic instrumentation, not a game menu.
status: final
created: 2026-09-07
updated: 2026-09-07
colors:
  sand: '#e8b98a'
  ink: '#2b211a'
  panel: 'rgba(28, 21, 16, 0.82)'
  panel-line: 'rgba(255, 224, 190, 0.16)'
  text: '#f6e7d4'
  accent: '#f0a860'
  panel-high-contrast: 'rgba(12, 9, 7, 0.95)'
  panel-line-high-contrast: 'rgba(255, 236, 214, 0.5)'
  text-high-contrast: '#fffaf3'
  accent-high-contrast: '#ffc98a'
  chip-active-fill: 'rgba(224, 154, 100, 0.18)'
typography:
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: '13px'
  label:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: '10px'
    fontWeight: 700
    letterSpacing: '0.18em'
  value:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: '13.5px'
    fontWeight: 650
  micro:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: '9px'
    letterSpacing: '0.06em'
rounded:
  sm: '8px'
  chip: '9px'
  md: '11px'
  lg: '14px'
  pill: '999px'
  circle: '50%'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '18px'
  panel-padding: '12px 16px'
  chip-padding: '9px 16px'
components:
  panel:
    background: '{colors.panel}'
    border: '1px solid {colors.panel-line}'
    radius: '{rounded.lg}'
    padding: '{spacing.panel-padding}'
  chip:
    background: 'rgba(255, 255, 255, 0.04)'
    border: '1px solid {colors.panel-line}'
    radius: '{rounded.chip}'
    padding: '{spacing.chip-padding}'
    text: '{typography.value}'
    hover-background: 'rgba(255, 255, 255, 0.09)'
    active-border: '{colors.accent}'
    active-background: '{colors.chip-active-fill}'
    active-text: '{colors.accent}'
  subtitle-line:
    color: '{colors.text}'
    text: '{typography.body}'
    background: 'transparent'
  hud-readout:
    color: '{colors.text}'
    text: '{typography.label}'
---

# DESIGN.md: Shamal

`[ASSUMPTION]` This spine was reverse-engineered from the shipped implementation
(`src/style.css`, `src/brand.ts`) rather than elicited fresh, per the user's Fast-path,
full-autonomy choice for this whole documentation pass. Tokens above are the *actual*
values in production, not proposals — treat any change to them as a real visual change
to a shipped game, not a free edit.

## Brand & Style

Shamal's interface follows *Firewatch*'s discipline: the UI is instrumentation on a
dashboard, not a menu system layered over a game. Every panel, chip, and readout is
low-contrast and warm — dark, translucent, sand-toned — so it recedes behind the
desert's golden light rather than competing with it. Nothing in the UI uses a cool
color, a hard white, or a saturated hue; the one deliberate accent (`{colors.accent}`,
a warm amber-orange) is reserved for the single thing that should catch the eye in a
given moment, never applied broadly. There is no logo mark, no chrome, no drop shadows
mimicking depth beyond what the panel's own translucency implies — the flat-shaded 3D
world underneath is the visual statement; the UI's job is to stay out of its way.

## Colors

- **`{colors.sand}` (`#e8b98a`)** — the page/body background beneath the 3D canvas,
  visible only during load or letterboxing. Never used for UI text or panel fills — it
  is the color of the world, not the interface.
- **`{colors.ink}` (`#2b211a`)** — the darkest tone in the palette; the base note
  `{colors.panel}` is derived from at low opacity. Not used as a flat fill anywhere
  currently.
- **`{colors.panel}` (`rgba(28, 21, 16, 0.82)`)** — the fill for every UI surface: HUD
  readouts, the settings menu, POI cards, chip backgrounds. 82% opacity by design, so
  the desert is always faintly visible through the chrome — the interface never fully
  occludes the world it's reporting on.
- **`{colors.panel-line}` (`rgba(255, 224, 190, 0.16)`)** — the hairline border on
  every panel and chip. Barely-there by default; this is the value the high-contrast
  mode (§ below) exists specifically to strengthen.
- **`{colors.text}` (`#f6e7d4`)** — primary text color across all UI surfaces: a warm
  off-white, never pure white, keeping every readout in the same warm family as the
  world.
- **`{colors.accent}` (`#f0a860`)** — reserved for the one active/selected/highlighted
  element at a time (e.g. the currently-active quality chip, an armed control). Not a
  secondary text color and not used decoratively.
- **High-contrast variants** (`{colors.panel-high-contrast}`,
  `{colors.panel-line-high-contrast}`, `{colors.text-high-contrast}`,
  `{colors.accent-high-contrast}`) — an opt-in accessibility mode (EXPERIENCE.md
  Accessibility Floor) that raises panel opacity to 95% and hairline visibility to 50%
  alpha. Scoped to `body.high-contrast` and touches **UI chrome only** — the desert
  render is never re-graded, by explicit design intent (`src/style.css` inline
  comment: "the warm, low-contrast palette is the look... it only ever touches the UI
  chrome").

## Typography

No custom webfont is loaded — `{typography.body.fontFamily}` is the system UI stack
(`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`), a deliberate
performance/simplicity choice consistent with the project's texture-light, load-light
approach (PRD §8 Cross-Cutting NFRs). Every UI surface uses one of three roles:

- **`{typography.label}`** — small (10px), bold (700), heavily letter-spaced (0.18em)
  uppercase-style labels: section headers in the settings menu, category tags. Reads
  as instrumentation labeling, not prose.
- **`{typography.value}`** — the workhorse: chip text, control values, most on-screen
  numbers and short strings. 13-13.5px, semi-bold (650) for legibility against the
  panel's low contrast.
- **`{typography.micro}`** — 9px, lightly letter-spaced (0.06em): the smallest
  readouts (diagnostics panel numbers, fine print).
- **Ahmed's subtitle line, hints, and the POI card body** use `{typography.body}` and
  are the *only* three surfaces that scale with the player's Text Size accessibility
  setting (via the `--ui-scale` custom property) — chips and HUD numbers are sized to
  their containers and do not scale, since they're read at a glance, not read as
  prose.

## Layout & Spacing

Panels and chips share one spacing rhythm: `{spacing.panel-padding}` (12px vertical,
16px horizontal) for full panels, `{spacing.chip-padding}` (9px/16px) for chips, with
internal gaps typically `{spacing.2}`–`{spacing.3}` (8-12px) between adjacent elements
within a row. No explicit breakpoint system exists beyond one confirmed media query:
`@media (orientation: landscape) and (max-height: 500px)` collapses the settings menu
to a two-column grid (`BACKLOG.md` item 8) — responsiveness is handled per-surface
(this grid reflow, thumb-cluster repositioning) rather than through a named breakpoint
scale, and this DESIGN.md does not invent one that isn't in the code. **Confirmed
2026-09-07**: the collapse is gated on both orientation and height together, not
height alone as an earlier draft of this file assumed.

## Elevation & Depth

No drop-shadow or blur-based elevation system exists. Depth is communicated entirely
by `{colors.panel}`'s translucency (letting the 3D world show through) plus the
hairline `{colors.panel-line}` border — a flat, graphic approach consistent with the
game's flat-shaded 3D rendering (no PBR, no realistic shadow-casting UI chrome).

## Shapes

- **`{rounded.lg}` (14px)** — the primary panel/card radius (settings menu, POI card).
- **`{rounded.md}` (11px)** and **`{rounded.sm}` (8px)** — secondary surfaces and
  nested elements (sub-panels, smaller cards).
- **`{rounded.chip}` (9px)** — settings-menu chips (`.menu-chip`: quality tier,
  time-of-day). **Confirmed against `src/style.css` 2026-09-07** — chips are *not*
  fully pill-rounded; 9px sits close to `{rounded.sm}` but is its own value, not an
  alias. An earlier draft of this file incorrectly generalized chips to
  `{rounded.pill}`; corrected here.
- **`{rounded.pill}` (999px)** — reserved for standalone floating strips, not menu
  chips: the `#help` hint and the first-run toast (`.firstrun`).
- **`{rounded.circle}` (50%)** — circular touch controls (the thumb cluster: photo,
  reset, handbrake).

The rule: rectangular information surfaces get large, soft corners (`lg`/`md`/`sm`);
a settings-menu chip gets a small, distinct radius (`chip`) rather than full rounding;
a free-floating strip or a circular tap target goes fully rounded (`pill`/`circle`).
Nothing in the UI uses a sharp (0px) corner.

## Components

- **Panel** (`{components.panel}`) — the base surface for the settings menu and any
  multi-row grouping. `{colors.panel}` fill, 1px `{colors.panel-line}` border,
  `{rounded.lg}` corners, `{spacing.panel-padding}` internal padding.
- **Chip** (`{components.chip}`) — single control or single value (quality tier
  selector, time-of-day selector). `{rounded.chip}` (9px) corners, a faint white-alpha
  fill (`rgba(255,255,255,0.04)`, not `{colors.panel}`) that brightens slightly on
  hover (`rgba(255,255,255,0.09)`). **Active/selected state confirmed against
  `src/style.css` 2026-09-07** (`.menu-chip.is-active`): border switches to
  `{colors.accent}`, text switches to `{colors.accent}`, and the background fills
  with `{colors.chip-active-fill}` — a distinct warm-tinted translucent fill, not a
  literal alpha of `{colors.accent}` itself.
- **Subtitle line** (`{components.subtitle-line}`) — Ahmed's radio text. Transparent
  background (renders directly over the 3D world, no panel behind it), `{colors.text}`,
  `{typography.body}`. The one text surface deliberately *not* housed in a panel — it
  behaves like a caption, not a UI element.
- **HUD readout** (`{components.hud-readout}`) — speed, compass, diagnostics numbers.
  `{typography.label}` sizing, `{colors.text}`, no panel background on most instances
  (reads directly over the world like an analog gauge).

## Do's and Don'ts

- **Do** keep every UI color inside the warm, low-contrast family defined above — no
  cool colors, no pure white/black, anywhere in the interface.
- **Do** let the desert show through panels (82% opacity is load-bearing, not a
  placeholder value).
- **Do** reserve `{colors.accent}` for exactly one active/selected element at a time.
- **Don't** add drop shadows, gradients-as-depth, or any elevation cue beyond
  translucency + hairline border — it breaks the flat-shaded language shared with the
  3D world.
- **Don't** re-grade the desert's own rendering for high-contrast mode — that mode is
  UI-chrome-only by explicit design decision (see Colors, high-contrast variants).
- **Don't** introduce a second typeface or a decorative display font — the system-UI
  stack is a deliberate load-time and simplicity choice, not a placeholder.
