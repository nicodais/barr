---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-shamal-2026-09-07/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-shamal-2026-09-07/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-shamal-2026-09-07/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-shamal-2026-09-07/EXPERIENCE.md
  - BACKLOG.md
---

# Shamal - Epic Breakdown

## Overview

This document decomposes Shamal's PRD, UX spines, and architecture spine into epics
and stories. `[ASSUMPTION]` Unlike a greenfield breakdown, most of the PRD's FRs are
**already shipped** — 18 of 20 items in `BACKLOG.md` are done, four regions are live
(a fourth, Lahbab, shipped 2026-09-07 after this document was first drafted).
This document therefore inventories all FRs/NFRs for coverage (so nothing is silently
forgotten), marks the shipped baseline as complete without manufacturing retroactive
stories for already-built work, and reserves real epic/story breakdown for the
genuinely remaining work: PRD §6.2 (Out of Scope for MVP), PRD §9 (Open Questions),
and `BACKLOG.md`'s three still-open items (6, 11, 12). Drafted Fast path, full
autonomy, with auto-confirmed checkpoints per the user's explicit choice for this
skill's otherwise-interactive menus.

## Requirements Inventory

### Functional Requirements

FR-1: Weight transfer under load — visible body roll, nose-dip, squat.
FR-2: Per-wheel suspension — independent raycast/spring-damper travel per wheel.
FR-3: Sand traction model — grip degrades with steepness/softness; momentum over steering at speed.
FR-4: Momentum-dependent climbing — steep faces bleed speed, can stall without run-up.
FR-5: Damage-free sidehill rollover — auto-uprights after a short beat, zero progress loss.
FR-6: No damage model — no dents, mechanical failure, or repair mechanic anywhere.
FR-7: Airtime and landing — brief airtime off dune crests, visible suspension compression on landing.
FR-8: Per-body tuning — distinct handling per vehicle body.
FR-9: Region selection — player chooses among available regions before driving.
FR-10: Chunked terrain streaming — tile-based LOD, no per-frame full regen.
FR-11: Distinct region character — measurably different dune wavelength/softness/palette per region.
FR-12: POI placement per region — 9-11 named, uniquely-lined POIs per region.
FR-13: Soft-guided waypoint cue — subtle compass nudge, never mandatory.
FR-14: Call-in delivery — static cue, scrolling text, no VO, non-blocking.
FR-15: Category-based line pools with no-repeat cycling per session.
FR-16: Region- and vehicle-aware remarks — keyed tables, armed/consumed at a quiet slot.
FR-17: Time-of-day band tracking — tracks both last-seen and last-spoken per band.
FR-18: Tone guardrails — no fourth-wall breaks, no "funny because foreign" humor.
FR-19: Adaptive audio layering — bed + oud fade in, duck under radio calls.
FR-20: Per-vehicle engine voice — distinct RPM-linked synth profile per body.
FR-21: Sand/tire foley — tone varies with sand density; tyre-pressure adjustment sound.
FR-22: Keyboard/mouse control — WASD/arrows + mouse-drag free-look.
FR-23: Gamepad control — standard Gamepad API, auto-detect, overrides other schemes.
FR-24: Touch control schemes — one-time picker: joystick / wheel / tilt.
FR-25: Full touch parity with desktop — photo mode, handbrake, reset all reachable on touch.
FR-26: Free-look capture — photo mode with filter/vignette and save.
FR-27: Quality tier resolution and live reporting — tier/fps/draw-calls readout, reachable on touch.
FR-28: Draw call budget — ~150/frame via merging/instancing, tighter on mobile.
FR-29: Reduced motion, screen-reader live region, text scale, high-contrast option.
FR-30: Settings persistence — audio, control scheme, quality, accessibility via localStorage.

### NonFunctional Requirements

NFR-1: 60fps target on modern desktop browsers.
NFR-2: 60fps target on mobile browsers, floor: phones from the last ~2 years. **Status: unvalidated on real hardware** (PRD §4.8, §9 OQ1).
NFR-3: Draw call budget ~150/frame, tightened further on mobile-tier profile (shared with FR-28).
NFR-4: Load size — initial bundle + first-terrain-chunk sized for a first-interaction budget of a few seconds on decent broadband; assets stream rather than load upfront.
NFR-5: Aesthetic/Tone — flat-shaded, low-poly, no PBR realism, warm limited palette, golden/blue-hour-biased lighting; Ahmed's voice guardrails are as load-bearing as rendering constraints.
NFR-6: Platform — browser-only (desktop Chrome/Safari/Firefox/Edge, mobile Safari iOS/Chrome Android), responsive at runtime, single build (no per-viewport build).

### Additional Requirements

*(from `ARCHITECTURE-SPINE.md` — binding technical constraints any new story must respect, not new feature work)*

- AD-1: Only `src/engine/Game.ts` (composition root) may construct/wire a system from `vehicle/`, `world/`, `terrain/`, `audio/`, `narrative/`, `ui/`, `input/`.
- AD-2: Sibling systems exchange state only via type-only imports of each other's public shapes — never by importing another system's instance/behavior.
- AD-3: `src/data/*` stays inert — pure tables/types, no behavior, no imports of behavioral modules.
- AD-4: One physics clock — only `Game.ts`'s loop calls `RAPIER.World.step()`, fixed 60Hz, `MAX_SUBSTEPS = 5` cap.
- AD-5: `GameSettings`/`Progress` (in `settings/`) are the only shared, cross-cutting `localStorage` blobs; a module needing local-only persisted state must use its own uniquely-prefixed key, never the shared ones.
- AD-6: `terrain/regions.ts`'s `activeRegion` is the single source of truth for which region is loaded; only the boot/region-change path sets it.
- AD-7: Every control scheme resolves to the shared `SteeringInput`/`ThrottleInput`/`BrakeInput` triple before reaching gameplay code; no gameplay code imports a specific `*Source` class.
- Stack (pinned, current as of 2026-09-07): `three ^0.180.0`, `@dimforge/rapier3d-compat ^0.14.0`, `typescript ^5.7.3`, `vite ^6.0.7`.
- Deployment: static Vite build (`tsc --noEmit && vite build`) to Vercel; `three`/`rapier` split into their own `manualChunks`; `engine/Game` dynamically imported behind the region picker.
- **Brownfield, no starter template** — this is not a greenfield initialization; Epic 1 Story 1 conventions (starter-template setup) do not apply.
- **Deferred by the architecture spine, not decided here:** no CI/test suite exists yet (`package.json` has no `test` script) — flagged as a real gap, not assigned to an epic in this pass since no story requested it explicitly.

### UX Design Requirements

*(from `DESIGN.md` + `EXPERIENCE.md` — behavioral/visual constraints any new UI work must respect)*

UX-DR1: Every UI color stays inside the warm, low-contrast token family (`{colors.sand,ink,panel,panel-line,text,accent}` + high-contrast variants) — no cool colors, no pure white/black anywhere in the interface.
UX-DR2: `{colors.accent}` reserved for exactly one active/selected element at a time — never a secondary text color or decoration.
UX-DR3: Typography roles (`label`/`value`/`micro`/`body`) applied per component category; only three prose surfaces (Ahmed's subtitle, hints, POI card) scale with `--ui-scale` — chips/HUD numbers do not.
UX-DR4: Shape system — panels/cards use soft corners (`{rounded.sm,md,lg}`); anything selectable/tappable uses full rounding (`{rounded.pill,circle}`); nothing uses a sharp corner.
UX-DR5: Non-blocking overlay rule — no UI element ever pauses driving input or world simulation, except the one-time first-touch control-scheme picker.
UX-DR6: Input abstraction consumed uniformly — no UI or gameplay component reads a scheme-specific input directly (mirrors AD-7).
UX-DR7: No confirm-dialogs anywhere in menu interactions — every chip/toggle applies immediately.
UX-DR8: The POI waypoint cue stays a subtle compass/dashboard nudge — never a hard on-screen marker.
UX-DR9: The touch thumb cluster (photo/reset/handbrake) repositions to whichever side the steering control is not occupying.
UX-DR10: Accessibility floor — reduced motion, screen-reader live region, text scale, high-contrast toggle (UI-chrome only, never re-grades the desert render).
UX-DR11: Viewport-height responsive collapse — under 500px height, settings menu reflows to a two-column CSS Grid (not `columns:`, which fragments content off-screen).
UX-DR12: Four EXPERIENCE.md open questions need resolving during implementation, not guessing: (a) whether a new call-in can interrupt one in progress, (b) whether world simulation continues under photo mode's free-look, (c) whether any orientation lock/layout exists beyond the height-collapse fix, (d) the exact chip active-state color token.

### FR Coverage Map

| Requirement(s) | Status | Epic |
| --- | --- | --- |
| FR-1 – FR-30, NFR-1, NFR-3 – NFR-6 | **Shipped** (verified against `BACKLOG.md`'s 17/20 done items and the live `src/` tree) | Epic 0 — Shipped Baseline (no new stories) |
| NFR-2 (mobile 60fps validation) | Open, highest priority | Epic 1 — Real-Device Mobile Validation |
| PRD §6.2 cockpit camera / per-body footprint (`BACKLOG.md` 11, 12) | Open, scope-gated | Epic 2 — Vehicle Fidelity Expansion |
| UX-DR12 (4 behavioral open questions), PRD §9 OQ4 (screen-reader verification) | Open | Epic 3 — UX Behavior Verification & Closure |
| PRD §9 OQ5, OQ6 (Ahmed naming convention, line-pool expansion) | Open, lower priority | Epic 4 — Narrative Content Expansion |

## Epic List

- **Epic 0 — Shipped Baseline.** All 30 FRs and 5 of 6 NFRs, as already built. Recorded
  for coverage completeness; no new stories.
- **Epic 1 — Real-Device Mobile Validation.** Close NFR-2, the single highest-priority
  open item project-wide.
- **Epic 2 — Vehicle Fidelity Expansion.** Cockpit camera and true per-body footprint,
  gated on a scope decision about whether more vehicle bodies are actually planned.
- **Epic 3 — UX Behavior Verification & Closure.** Resolve the four EXPERIENCE.md
  behavioral open questions and verify accessibility against real assistive tech.
- **Epic 4 — Narrative Content Expansion.** Expand Ahmed's line pool and decide the
  player-naming convention.

---

## Epic 0: Shipped Baseline

Everything in the FR Coverage Map marked **Shipped** — the full vehicle physics
system, four regions with POIs, Ahmed's narrative engine, the audio layers, full
input coverage, photo mode, adaptive quality, and the accessibility pass. `[NOTE FOR
PM]` No stories are generated for this epic: writing retroactive stories for already-
built, already-verified-in-production code would not produce testable acceptance
criteria anyone needs — it would just restate `BACKLOG.md`. This epic exists in the
breakdown purely so the FR Coverage Map is honest about what "100% FR coverage" means
here: verified-shipped, not planned.

## Epic 1: Real-Device Mobile Validation

Close the single highest-priority gap in the project: NFR-2 (60fps mobile target) has
never been confirmed outside a software-rendered dev machine. `BACKLOG.md` item 6
frames this as blocked on hardware access, not effort — so this epic's stories are
scoped to what becomes actionable the moment a device is available, per PRD §7 (SM-2)
and Architecture's Deferred section (explicitly calls this an operational/QA concern,
not an architecture one).

### Story 1.1: Run Shamal on a real ~2-year-old phone and capture baseline metrics

As the developer,
I want to run Shamal on real mobile hardware and capture the quality-tier readout
(FR-27) across all three regions,
So that NFR-2's 60fps mobile target is confirmed or disproven with real data instead
of a software-rendered proxy.

**Acceptance Criteria:**

**Given** a physical phone released within the last ~2 years, on cellular or wifi
**When** Shamal is loaded and driven for at least 2 minutes in each of Liwa, Fossil
Rock, and Al Badayer, with the diagnostics panel (FR-27) open
**Then** the resolved quality tier, live fps, draw calls, and step-down count are
recorded for each region
**And** any tier at which fps drops below 60 for a sustained period is noted with the
region and approximate in-world conditions (time of day, traffic density) at the time.

### Story 1.2: Validate the driving-feel bar (SM-1) on real hardware

As the developer,
I want to specifically assess weight transfer, sand traction, and rollover recovery
feel on real mobile hardware (not just frame rate),
So that PRD SM-1's driving-feel bar — the design's central success criterion — is
confirmed under real input latency and render conditions, not just simulated ones.

**Acceptance Criteria:**

**Given** the same real-device session as Story 1.1
**When** the player deliberately climbs a steep dune face below the momentum
threshold (FR-4), takes a sidehill angle steep enough to roll (FR-5), and drives
through soft sand at speed (FR-3)
**Then** each moment is assessed against the "whoa, okay" design intent (PRD §7 SM-1)
using touch input specifically, since touch is the control scheme most exposed to
real-device input latency
**And** any case where the feel diverges materially from desktop/dev-machine
testing is logged as a new open item, not silently absorbed.

### Story 1.3: Close or re-scope the mobile validation open item

As the developer,
I want to formally close PRD §9 Open Question 1 / `BACKLOG.md` item 6 based on
Stories 1.1–1.2's findings,
So that the project's "MVP complete" claim (PRD §6) is accurate rather than
provisional.

**Acceptance Criteria:**

**Given** Stories 1.1 and 1.2 are complete
**When** the findings are reviewed
**Then** either NFR-2 and SM-1 are marked confirmed in the PRD, or specific follow-up
stories are opened for whatever real-device gap was found (e.g. a lower quality-tier
threshold, a touch-input latency fix)
**And** `BACKLOG.md` item 6 is updated to reflect the outcome, consistent with the
project's own practice of recording when a premise turns out right or wrong.

## Epic 2: Vehicle Fidelity Expansion — **CLOSED 2026-09-07, roster held**

`BACKLOG.md` items 11 (cockpit camera) and 12 (per-body footprint) were both
explicitly parked pending a scope decision: "worth doing only if more vehicles are
the plan." Story 2.1 resolved that decision: **the vehicle roster stays at its
current bodies — no growth planned.** Consequently:

- **Story 2.2** (rebuild per-body collider/wheel-hardpoint construction) is
  **deferred indefinitely**, not scheduled. The motorcycle's four-raycast
  simplification (vs. genuine two-wheel dynamics) and its oversized wheelbase remain
  known, accepted limitations — there's no roster-growth pressure to justify the
  surgery `BACKLOG.md` item 12 itself calls "worth doing only if more vehicles are
  the plan."
- **Story 2.3** (cockpit camera) is **deferred indefinitely** on the same basis,
  since it was gated on the same roster-growth premise in this breakdown.

Revisit condition for both: if the roster decision changes (a new vehicle body gets
planned), re-open this epic — the two deferred stories below are left in place,
unmodified, for that trigger rather than deleted.

### Story 2.1: Decide whether the vehicle roster will grow

As the developer,
I want to explicitly decide whether Shamal's vehicle roster is expected to grow beyond
the current bodies,
So that Stories 2.2–2.3 either proceed with a clear target or the whole epic is
deferred without ambiguity.

**Acceptance Criteria:**

**Given** the current roster and `BACKLOG.md` items 11–12's stated rationale
**When** the decision is made
**Then** the outcome (grow the roster / hold at current roster) is recorded in the PRD
Open Questions section (§9) as resolved
**And** if the decision is "hold," Stories 2.2 and 2.3 below are marked deferred
indefinitely rather than left ambiguously open.

### Story 2.2: Rebuild per-body collider/wheel-hardpoint construction — **DEFERRED INDEFINITELY (2026-09-07): roster held at current bodies, see Epic 2 header**

As the developer,
I want vehicle track, wheelbase, collider extents, and wheel hard-points to be rebuilt
on every body change instead of fixed once at construction,
So that each vehicle body (especially the motorcycle, currently drawn at roughly twice
a real wheelbase and stabilized by four raycasts instead of genuine two-wheel
dynamics) reflects its real proportions and physics.

**Acceptance Criteria:**

**Given** Story 2.1 resolved to "grow the roster"
**When** the player switches vehicle body
**Then** `VehicleTuning`'s track, wheelbase, collider extents, and wheel hard-points
are reconstructed for the new body rather than reused from whichever body was built
first
**And** the motorcycle specifically no longer relies on a four-raycast stabilization
approximation.

### Story 2.3: Build a cockpit camera for at least one vehicle body — **DEFERRED INDEFINITELY (2026-09-07): roster held, see Epic 2 header**

As a player,
I want an interior cockpit camera view,
So that I can drive from inside the vehicle rather than only chase-cam.

**Acceptance Criteria:**

**Given** Story 2.1 resolved to "grow the roster" (or the existing roster is deemed
sufficient to justify one interior)
**When** the player switches to cockpit camera view
**Then** at least one vehicle body (the soft-top, identified in `BACKLOG.md` item 11 as
the natural first interior since it already has a partial one) renders a modeled
interior from a fixed in-cabin viewpoint
**And** the remaining bodies without a modeled interior either fall back gracefully
(e.g. chase cam) or are explicitly out of scope for this story, not silently broken.

## Epic 3: UX Behavior Verification & Closure — **Stories 3.1–3.3 CLOSED 2026-09-07**

Resolve `EXPERIENCE.md`'s four open behavioral questions (UX-DR12) and verify the
accessibility pass against real assistive technology (PRD §9 OQ4) — all currently
"implemented but unconfirmed" states, not missing features. Stories 3.1–3.3 were
closed by reading the actual source (no behavior changed, only documentation);
findings are recorded in `EXPERIENCE.md` State Patterns / Responsive & Platform and
`DESIGN.md` Components. Story 3.4 remains open — it needs a human with real assistive
technology, not a code read.

### Story 3.1: Define and verify call-in interrupt behavior

As a player,
I want a predictable behavior when a new Ahmed call-in becomes eligible while one is
already playing,
So that call-ins never overlap or garble on screen.

**Acceptance Criteria:**

**Given** an active call-in's subtitle line is still visible
**When** a second call-in becomes eligible (e.g. a new POI is entered)
**Then** the actual current behavior (interrupt-and-replace, or queue-until-signoff)
is confirmed by reading `narrative/Director.ts` and `narrative/RadioSubtitles.ts`
**And** the behavior is documented in `EXPERIENCE.md` (replacing the current
`[ASSUMPTION]` tag), with a follow-up story opened only if the confirmed behavior
does not match the non-blocking, non-garbled design intent.

### Story 3.2: Confirm whether world simulation continues under photo mode

As a player,
I want to know (and the team to confirm) whether time/world state keeps advancing
while I'm framing a photo,
So that photo mode's relationship to the "never pauses driving" design principle
(PRD §1 Vision) is accurate, not assumed.

**Acceptance Criteria:**

**Given** `engine/PhotoMode.ts` and `engine/Game.ts`'s frame loop
**When** photo mode is active
**Then** it's confirmed by reading the code whether `RAPIER.World.step()` and world
Colleague `update()` calls continue to run
**And** `EXPERIENCE.md`'s Photo Mode state pattern is updated to state the confirmed
behavior, removing its current `[ASSUMPTION]` tag.

### Story 3.3: Confirm orientation handling and the chip active-state token

As the developer,
I want the two smaller open UX questions (orientation lock/layout, and the chip
active-state color token) resolved,
So that `DESIGN.md`/`EXPERIENCE.md` fully match the shipped CSS rather than carrying
unconfirmed assumptions.

**Acceptance Criteria:**

**Given** `src/style.css` and any orientation-related media queries in the codebase
**When** both are inspected
**Then** the exact active/selected chip color token is recorded in `DESIGN.md`
Components, and any orientation-specific behavior (or its explicit absence) is
recorded in `EXPERIENCE.md` Responsive & Platform
**And** both files' `[ASSUMPTION]` tags for these two items are removed or replaced
with the confirmed answer.

### Story 3.4: Verify the accessibility pass against real assistive technology

As a player using a screen reader,
I want Shamal's accessibility features (PRD FR-29) to actually work with real
assistive technology, not just the intended implementation,
So that the reduced-motion, live-region, text-scale, and high-contrast features
deliver on their design intent.

**Acceptance Criteria:**

**Given** a real screen reader (e.g. VoiceOver or NVDA) running against a built copy
of Shamal
**When** an Ahmed call-in fires and the settings menu is opened/navigated
**Then** the `role="status"` live region announces the complete call-in line once,
and the menu-panel toggle's `aria-expanded` state is correctly read by the screen
reader
**And** any gap found is logged as a new story rather than silently left as a known
limitation.

## Epic 4: Narrative Content Expansion — **CLOSED 2026-09-07**

Lower priority than Epics 1–3; addresses PRD §9 Open Questions 5 and 6, both
explicitly left open in `CLAUDE.md` §12 pending decisions the narrative pass was
always going to need to make. Both stories are now closed — 4.1 turned out to already
be decided in shipped code (only `CLAUDE.md` was stale), 4.2 added 12 new lines
across the four highest-frequency triggers, verified with a clean `tsc --noEmit` and
`vite build`.

### Story 4.1: Decide Ahmed's player-naming convention — **DONE (already resolved in code)**

As the developer,
I want to decide whether Ahmed ever refers to the player by a name/nickname or stays
fully generic,
So that future line-pool additions are written consistently instead of drifting line
by line.

**Acceptance Criteria:**

**Given** the current line pool in `data/ahmedLines.ts` (entirely generic today, per
`CLAUDE.md` §13's starter pool)
**When** the decision is made
**Then** it's recorded in `CLAUDE.md` §12 (removing the open question) and in
`data/ahmedLines.ts` as a comment or convention note
**And** any newly authored lines from Story 4.2 follow the decided convention.

**Resolution (2026-09-07):** the decision was already made and documented in
`data/ahmedLines.ts`'s file comment — stays generic, rotates *habibi/ya sir/my
friend/champion*. `CLAUDE.md` §12 hadn't been updated to match; it now is.

### Story 4.2: Expand Ahmed's line pool — **DONE 2026-09-07**

As a player,
I want more variety in Ahmed's call-ins across repeated sessions,
So that lines feel less repetitive on longer or repeated play.

**Acceptance Criteria:**

**Given** the existing category, region, and vehicle line pools (FR-15, FR-16) and
the tone guardrails (FR-18, UX voice rules)
**When** new lines are authored
**Then** each new line passes the same guardrails as the starter set — one-liner only,
jokes land on specificity not accent/language, Arabic phrases functional not
decorative, no fourth-wall breaks
**And** the no-repeat cycling behavior (FR-15) is verified to still function correctly
with the larger pool size.
