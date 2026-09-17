---
title: Shamal — Experience
status: final
created: 2026-09-07
updated: 2026-09-07
sources:
  - ../../prds/prd-shamal-2026-09-07/prd.md
  - DESIGN.md
---

# EXPERIENCE.md: Shamal

`[ASSUMPTION]` Reverse-engineered from the shipped implementation and `CLAUDE.md`
under the same Fast-path, full-autonomy mode as `DESIGN.md` — behavior described here
is what the game currently does, not a proposal.

## Foundation

**Form factor:** responsive web, desktop and mobile browser, single build (PRD §8
Cross-Cutting NFRs, Platform). No native app, no separate mobile build — layout and
control scheme adapt to viewport/input capability at runtime.

**UI system:** none inherited — a bespoke, minimal, largely non-panel-based UI (see
`DESIGN.md` Brand & Style). Most information is diegetic (a dashboard compass, radio
subtitles) rather than menu-driven; the one true menu surface is the settings panel.

**Rendering substrate:** the UI is DOM/CSS layered over a full-viewport Three.js
canvas (`#viewport`). Nearly every UI element is either transparent-background text
directly over the 3D world (Ahmed's subtitles, HUD numbers) or a translucent panel
(`{components.panel}`) that intentionally lets the world show through.

## Information Architecture

Shamal has no traditional page/screen hierarchy — it is one continuous world view with
overlaid, mostly-transient UI. Surfaces:

- **Region select** — pre-drive: choose among Liwa, Fossil Rock, Al Badayer, Lahbab (PRD
  FR-9). Entry point before the world view.
- **World view (primary surface)** — the 3D canvas, always present once driving
  begins. Carries: HUD readout (speed, compass), Ahmed's subtitle line (transient, only
  during a call-in), the soft-guided POI compass cue (transient).
- **Settings / menu panel** — an overlay panel (not a route) reachable at any time,
  never pausing the underlying drive. Rows: Sound, Music, Vehicle & world (effects
  volume — PRD FR-30), Quality (tier chips + live diagnostics readout, PRD FR-27),
  Time of day (named-time chips + a "Moving" auto-advance chip), Accessibility
  (text size, high-contrast toggle, reduced-motion respects OS setting).
- **Photo mode overlay** — a modal-feeling but non-blocking state layered on the world
  view: free-look camera, filter/vignette controls, save action (PRD FR-26).
- **Touch control-scheme picker** — a one-time prompt on first touch session (PRD
  FR-24), not a persistent surface.

**Closure check:** every PRD FR maps to one of the surfaces above; every surface is
reached by at least one Key Flow below. No surface exists that a journey doesn't visit,
and no stated need (PRD §2.3 UJs) lacks a surface.

## Voice and Tone

Brand posture lives in `DESIGN.md` Brand & Style (warm, low-contrast, diegetic). The
one voice that matters for microcopy is **Ahmed's** (PRD §4.4, `CLAUDE.md` §13):

- One-liners only. No multi-sentence monologues — a moment needing more is two
  separate short call-ins.
- Sarcastic and teasing, never mean; dry timing, quick.
- Arabic phrases (habibi, yalla, wallah, khalas, mashallah) used functionally, never
  decoratively.
- No fourth-wall breaks — Ahmed never references the game as a game.
- Every other piece of UI copy (settings labels, chip text) is plain, short,
  functional English — Ahmed is the only character; the interface itself has no voice
  of its own.

## Component Patterns

Visual specs live in `DESIGN.md` Components; this section is the *behavior* layered on
those visuals.

- **Panel (`{components.panel}`)** — opens/closes without pausing the world
  simulation or driving input underneath it (§ Interaction Primitives). Multiple rows
  can be open/scrolled at once; no modal backdrop dims the world.
- **Chip (`{components.chip}`)** — single-select within its row (e.g. one quality
  tier active at a time, one named time-of-day active at a time). Selecting a chip
  applies immediately — no separate "confirm" step anywhere in the menu.
- **Subtitle line (`{components.subtitle-line}`)** — appears on an Ahmed call-in
  trigger (static-cue sound first), the line auto-types or appears instantly (under
  reduced motion), holds, then auto-fades. Never requires a dismiss tap. A second,
  shorter static cue plays on sign-off, coincident with the fade.
- **HUD readout (`{components.hud-readout}`)** — always-on speed/compass; the
  diagnostics extension (fps, draw calls, quality tier, step-down count) only ticks
  while the settings panel is open, to avoid the cost of measuring every frame when
  nobody's watching it (PRD FR-27).
- **Touch thumb cluster** — three circular controls (photo, reset, held handbrake),
  positioned as a stacked group opposite the steering control, and repositions to
  whichever side the steering control is *not* occupying (handedness-aware).

## State Patterns

- **Driving (default/persistent state).** The world simulates continuously; nothing
  in the game ever fully pauses it except backgrounding the browser tab. Menu, photo
  mode, and Ahmed call-ins all layer over this state rather than suspending it (PRD
  §1 Vision: "never pauses the driving").
- **Call-in active.** A transient overlay state on top of Driving: subtitle line
  visible, ambient/oud audio ducked (PRD FR-19), driving input fully live throughout.
  Ends automatically on the sign-off static cue — no player action required or
  possible to end it early. **Confirmed against `narrative/Director.ts` 2026-09-07**:
  a new call-in never interrupts one in progress — `Director.update()` checks
  `subtitles.busy` first and returns immediately if a line is showing, so any newly
  eligible call-in (a POI entered mid-line, a stuck timer firing) simply isn't
  evaluated until the current one clears, then fires on the next tick. There is no
  explicit queue data structure; the effect is the same as one (never overlaps, never
  drops silently — a still-relevant trigger like an unvisited POI just re-evaluates
  true once free), except a purely time-based trigger (e.g. the stuck timer) can reset
  during the wait and simply not re-fire.
- **Rolled over / recovering.** Triggered by FR-5 (sidehill rollover). Player input is
  presumably suspended for the short auto-recovery beat `[ASSUMPTION]`, then returns
  to normal Driving state with zero persisted penalty — no separate "crashed" screen
  or state exists.
- **Photo mode.** Entered/exited via toggle (`KeyP` or touch cluster). Camera control
  switches from vehicle-follow to free-look. **Confirmed against `engine/Game.ts`'s
  frame loop 2026-09-07**: world simulation continues running underneath, not frozen
  for the shot — `world.step()` and virtually every world Colleague (`terrain`,
  `scatter`, `birds`, `wildlife`, `camels`, `timeOfDay`, `weather`, `dust`, `avalanche`,
  `tracks`, `director`) update unconditionally regardless of `photo.active`. Only
  three things are explicitly suppressed while photo mode is active: (1) the player's
  own driving input is swapped for a neutral `frozenInput`, so the vehicle can't be
  steered/throttled — physics still simulates around it (gravity, settling); (2) the
  world-boundary respawn check is skipped, since the free camera is allowed to roam
  past where the truck itself would trigger a respawn; (3) the POI arrival card hides
  and the first-run hint is suppressed, both cosmetic. Ahmed can still key up (and
  will duck the audio, per FR-19) while the player is framing a shot.
- **Stuck (soft sand).** Not a distinct system state — no UI change, no game-state
  flag. It's purely a physical consequence of FR-3/FR-4 the player recovers from by
  driving (reverse, then forward), matching the "not a puzzle" design intent
  (`CLAUDE.md`'s Ahmed line: "Reverse, then forward. It's not a puzzle.").

## Interaction Primitives

- **Non-blocking overlays.** The cardinal rule across every surface: nothing in the
  UI ever takes driving input away from the player or halts world simulation, except
  the one-time touch control-scheme picker on first session (which necessarily
  precedes any driving input existing yet).
- **Input abstraction (PRD §3 Glossary).** Every control scheme — keyboard/mouse,
  gamepad, virtual joystick, on-screen wheel, tilt — resolves to the same
  `SteeringInput (-1..1)`, `ThrottleInput (0..1)`, `BrakeInput (0..1)` triple. No
  UI or game-logic component reads a scheme-specific input directly.
- **Auto-detect, always-overridable.** Keyboard/mouse is default on non-touch desktop,
  virtual joystick default on touch; a connected gamepad overrides either at any time,
  on any viewport (PRD FR-23).
- **No confirm-dialogs.** Every menu action (chip select, toggle) applies immediately;
  nothing in the game asks the player to confirm a choice.
- **Waypoint cue, not a marker.** The POI nudge (PRD FR-13) is a subtle dashboard/
  compass cue, never a hard on-screen arrow or objective marker — matching the
  soft-guidance design intent (PRD §5 loose narrative delivery).

## Accessibility Floor

Visual contrast specifics live in `DESIGN.md` (high-contrast token set); behavior
here:

- **Reduced motion.** `prefers-reduced-motion` is read from the OS and, when set,
  Ahmed's subtitle line renders whole immediately rather than character-typing, held
  for the same total duration the typed version would have taken (PRD FR-29).
- **Screen reader.** The visible subtitle line is `aria-hidden` (its typed-character
  animation would otherwise stutter through a screen reader); a sibling
  `role="status"` live region announces the complete line once, at call-in start. The
  canvas carries a label; the menu-panel toggle button reports `aria-expanded`.
  `[ASSUMPTION]` Implemented but never verified against real assistive technology
  (PRD §9 Open Question 4) — treat as unconfirmed, not proven.
- **Text scale.** A `--ui-scale` multiplier, set from a Text Size row in the
  accessibility settings, applies only to the three prose-bearing surfaces (Ahmed's
  subtitle, hints, the POI card) — chips and HUD numbers are deliberately excluded
  (sized to their containers, read at a glance).
- **High contrast.** Opt-in toggle; see `DESIGN.md` Colors, high-contrast variants,
  for the exact token swap. UI-chrome-only by design — never re-grades the 3D world.
- **Touch parity.** Every action reachable on desktop (photo mode, handbrake, reset)
  is reachable on touch via the thumb cluster — this was a shipped regression fix
  (PRD FR-25 Notes) and is treated as a floor, not a nice-to-have.

## Responsive & Platform

*(Triggered: the product explicitly spans desktop and mobile web with runtime-adaptive
layout, not separate builds — PRD §8.)*

- **Viewport height collapse.** **Confirmed against `src/style.css` 2026-09-07**: the
  exact rule is `@media (orientation: landscape) and (max-height: 500px)` — the
  settings menu reflows to a two-column CSS Grid (not `columns:` — the latter was
  tried and fragmented content off-screen sideways; see `BACKLOG.md` item 8) so all
  rows stay reachable without excess scrolling. The collapse is gated on
  **orientation and height together**, not height alone — a tall-but-narrow portrait
  viewport under 500px does not trigger it.
- **Touch vs. pointer input.** Detected at runtime, not at build time; the same
  bundle serves both, per PRD §8's "adapt at runtime rather than being a separate
  build."
- **Orientation.** **Confirmed 2026-09-07**: no orientation lock and no rotate-prompt
  exist anywhere in the codebase (searched `src/style.css` for every `landscape`/
  `portrait` reference). The one orientation-specific behavior in the entire game is
  the viewport-height collapse rule immediately above; portrait play at any height,
  and landscape play above 500px height, both use the single-column layout.
- **Performance-driven quality, not just layout.** Responsive here isn't only visual —
  the adaptive-quality system (PRD FR-27/FR-28) is itself a runtime-responsive
  behavior, scaling render fidelity to the detected device tier alongside the layout
  changes above.

## Key Flows

Named-protagonist journeys mirrored from PRD §2.3 (same UJ IDs), with the climax beat
made explicit for UX purposes:

- **UJ-1. A player picks a region and just drives.** *(Mirrors PRD UJ-1.)* Entry:
  region-select surface, no prior state. Path: pick Liwa → world view loads → HUD
  readout appears → player drives freely, no objective surfaced. **Climax:** the
  player realizes nothing is asking anything of them — the absence of a task is the
  payoff, not a specific screen. Resolution: session ends whenever the player closes
  the tab; nothing to save or complete.
- **UJ-2. Ahmed pulls a player toward a POI.** *(Mirrors PRD UJ-2.)* Entry: mid-drive,
  near an armed POI. Path: static cue plays → subtitle line names the Old Well
  specifically → compass cue nudges (Interaction Primitives, "not a marker"). **Climax:**
  the player recognizes the compass nudge as optional and either follows it or doesn't,
  with the game visibly indifferent either way. Resolution: back to plain driving,
  whether or not the POI was visited.
- **UJ-3. A rollover resolves itself.** *(Mirrors PRD UJ-3.)* Entry: mid-drive, sidehill
  angle exceeds the tip threshold (FR-5). Path: visible body-roll tips past recovery →
  dust FX → short auto-recovery beat → control returns. **Climax:** the "whoa, okay"
  moment — surprise without stakes, the beat State Patterns describes above.
  Resolution: driving resumes with zero persisted state change.
- **UJ-4. A photo gets captured and shared.** *(Mirrors PRD UJ-4.)* Entry: mid-drive,
  scenic moment (e.g. cresting the Famous Dune at golden hour). Path: toggle photo
  mode → free-look reframes the shot → apply a filter → save. **Climax:** the saved
  image itself, carrying the in-world watermark (`src/brand.ts` `GAME_URL_SHORT`) so a
  shared photo always points back to the game. Resolution: photo mode closes, driving
  resumes exactly where it left off.
- **UJ-5. A mobile player drives one-handed.** *(Mirrors PRD UJ-5.)* Entry: first
  touch-capable session, no control scheme chosen yet. Path: one-time picker (virtual
  joystick / wheel / tilt) → thumb cluster appears on the side opposite the steering
  control → player drives with the chosen scheme. **Climax:** the held-handbrake
  interaction working as expected under a thumb — the measured case (PRD FR-24: 61.9
  to 1.5 kph, clean release) that proved touch parity wasn't just theoretical.
  Resolution: choice persists (`localStorage`, PRD FR-30); no re-prompt on return
  visits.

## Open Questions

All four items originally listed here were resolved 2026-09-07 by reading the actual
source (`narrative/Director.ts`, `engine/Game.ts`'s frame loop, `src/style.css`); see
State Patterns (Call-in active, Photo mode), Responsive & Platform (Orientation), and
`DESIGN.md` Components (Chip) for the confirmed answers. One accessibility item
remains genuinely open, since it needs a human with real assistive technology rather
than a code read:

1. Screen-reader verification (Accessibility Floor, above; PRD §9 Open Question 4) —
   the `role="status"` live region and `aria-expanded` toggle are implemented but
   have never been run against a real screen reader (VoiceOver/NVDA). Owner: project
   developer. Revisit: when that verification pass happens.
