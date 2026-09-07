---
title: Shamal
created: 2026-09-07
updated: 2026-09-07
status: final
---

# PRD: Shamal (شمال)

## 0. Document Purpose

This PRD documents Shamal for whoever builds on it next — future sessions of this
project's own developer, AI coding agents (this repo is worked on primarily with
Claude Code), and any future collaborator. It is written retroactively: as of
2026-09-07 the game is already substantially built (17 of 20 tracked backlog items
shipped, three playable regions), so this PRD's job is to give that existing build a
stable spine — Glossary-anchored vocabulary, features grouped with globally-numbered
FRs — that `bmad-ux`, `bmad-architecture`, and `bmad-create-epics-and-stories` can build
against consistently, and that catches drift from `CLAUDE.md` (the original creative/
technical brief, still the deeper source on tone and physics feel) as the game evolves.
It builds on, and does not duplicate, `brief.md` at
`../briefs/brief-shamal-2026-09-07/brief.md`.

## 1. Vision

Shamal is a relaxing, open-world dune-bashing driving game for the browser, set in a
fictionalized stretch of UAE desert, in the visual and tonal tradition of *Firewatch*.
The player drives a low-poly 4x4 across a large stylized dune landscape with no combat,
no fail state, and no timer — an oud-led ambient score plays, and Ahmed, a good-natured,
weary local police officer, occasionally checks in by radio. The goal is decompression:
a session ends because the player chose to stop, not because anything ran out.

The system that has to work for any of this to matter is the driving itself — real
weight transfer, per-wheel suspension, sand traction that varies with dune steepness,
and damage-free rollover that reads as "whoa, okay" rather than a punishment. Everything
else — the four regions, Ahmed's radio calls, the photo mode — exists to give that
physical feeling a world worth being alone in.

## 2. Target User

### 2.1 Jobs To Be Done

- Unwind for a short, unstructured stretch of time without being tested, scored, or
  timed — the same job *Firewatch*, *A Short Hike*, and *Proteus* fill for exploration,
  applied to driving.
- `[ASSUMPTION]` For a Gulf/UAE audience specifically: see a real local landscape and
  pastime (dune bashing) rendered with specific, respectful detail rather than generic
  desert-level dressing.
- `[ASSUMPTION]` For the developer: a from-scratch physics/rendering project worth
  doing well, and — per `[[brief]]` — a project built and measured honestly rather than
  polished-over (see `BACKLOG.md`'s recurring "the premise was wrong" notes).

### 2.2 Non-Users (v1)

- Players seeking competitive, scored, or time-trial driving experiences — no lap
  timer, no leaderboard exists or is planned (§5).
- Players seeking a damage/mechanical-sim experience (BeamNG-depth) — the physics is
  arcade-forgiving with real weight underneath, not a full sim.

### 2.3 Key User Journeys

Lighter shape (hobby/solo scope; JTBD-restated form) per template guidance:

- **UJ-1. A player picks a region and just drives.** A player, decompressing after
  work, opens Shamal in a browser tab, picks Liwa from the region select, and drives
  for however long feels right — cresting dunes, sliding out in soft sand, occasionally
  hearing Ahmed's radio click in — with nothing on screen asking them to complete
  anything.
- **UJ-2. A player gets pulled toward a POI by Ahmed's line, not a marker.** Driving
  near the Old Well, the player hears Ahmed's static cue and a specific, place-grounded
  line about it; a subtle dashboard compass cue nudges them toward it, but nothing fails
  or interrupts if they ignore it and drive elsewhere instead.
- **UJ-3. A player rolls the truck on a sidehill and keeps going.** Taking a dune face
  at too sharp an angle, the truck's body roll tips past the point of no return and it
  rolls. After a short beat (dust FX, the truck auto-righted), the player is back on
  their wheels and driving again with zero progress lost — the moment reads as a
  surprise, not a failure.
- **UJ-4. A player captures and shares a moment.** Cresting the Famous Dune at golden
  hour, the player opens photo mode, frames a free-look shot, applies a filter, and
  saves it to share outside the game.
- **UJ-5. A mobile player drives one-handed on a touch screen.** On a phone browser, a
  first-time touch player is prompted once to pick a control scheme (virtual joystick,
  on-screen wheel, or tilt steering), then drives with a thumb cluster (photo / reset /
  held handbrake) that follows the stick to whichever side it isn't on.

## 3. Glossary

- **Region** — one large (~4-6km²) seamless dune heightfield with its own dune
  character (wavelength, field-floor softness, palette) and its own set of POIs. Four
  ship in the current build: Liwa, Fossil Rock, Al Badayer, Lahbab.
- **POI (Point of Interest)** — a hand-placed, named location within a region (e.g. The
  Old Falaj, Ahmed's Tea Stand) that Ahmed can reference with a specific radio line when
  the player nears it. Regions carry 7-11 POIs each.
- **Ahmed** — the unseen local police-officer contact. Never voiced; a "kssshhht" static
  cue precedes his lines, which scroll as subtitle-style text with no audio underneath,
  and a shorter static cue closes each call-in.
- **Call-in** — one triggered instance of Ahmed speaking: a category (sign-on,
  POI-specific, idle/stuck, fast-driving, sign-off), drawn randomly from that category's
  line pool, retired for the session once used.
- **Line pool** — the set of candidate lines for a given Ahmed category, region, or
  vehicle; category pools are flat, region/vehicle pools are keyed tables (per §16 of
  `BACKLOG.md`, to avoid generic filler that could apply to any truck or place).
- **Quality tier** — the resolved rendering fidelity level (low/mid/high, per device
  detection or runtime fps auto-adjust) controlling shadow resolution, draw distance,
  and particle density.
- **Chunk** — a streamed tile of a region's heightfield terrain, loaded/unloaded by
  distance for LOD and performance.
- **Sink drag** — the traction-model term that slows a vehicle as its tires sink into
  soft sand; varies by per-terrain-chunk "softness" and dune-face steepness.
- **Body** — a selectable vehicle (e.g. the Patrol-styled 4x4, a pickup, a motorcycle,
  a buggy); each has distinct engine-voice audio and tuning.
- **Input abstraction** — the shared `SteeringInput (-1..1)`, `ThrottleInput (0..1)`,
  `BrakeInput (0..1)` interface that keyboard, gamepad, and the three touch schemes all
  drive, keeping the vehicle controller control-scheme-agnostic.

## 4. Features

### 4.1 Vehicle Physics & Driving Feel

**Description:** The core system (per `CLAUDE.md` §2, which the project treats as
blocking all other work). A Rapier (`@dimforge/rapier3d-compat`, WASM) vehicle
controller with per-wheel raycast suspension delivers visible weight transfer (body
roll, nose-dip, squat), independent wheel articulation over uneven terrain, a
sand-traction model distinct from hard-pack, momentum-dependent dune climbing, and
damage-free sidehill rollover with auto-recovery. Realizes UJ-1, UJ-3.
`[ASSUMPTION]` tuning is iterated primarily by feel/playtesting, per `CLAUDE.md`'s
stated philosophy, rather than against a fixed numeric spec — so FRs below describe
observable behavior, not exact constants.

**Functional Requirements:**

#### FR-1: Weight transfer under load

The vehicle exhibits visible body roll on sidehills and dune crests, nose-dip under
braking, and squat under acceleration.

**Consequences (testable):**
- Body roll, pitch, and squat are visually distinguishable from a rigid, non-rolling
  body at normal driving speeds on a sloped dune face.

#### FR-2: Per-wheel suspension

Each wheel's suspension travels independently via raycast/spring-damper, so the body
does not rigidly follow the terrain average.

**Consequences (testable):**
- On an uneven dune face, at least one wheel visibly compresses while another extends
  at the same instant.

#### FR-3: Sand traction model

Wheel grip degrades progressively with dune-face steepness and a per-chunk softness
value; momentum matters more than steering input at speed.

**Consequences (testable):**
- The same steering input produces a wider slide arc on a steep/soft face than on
  packed ground.
- Per-vehicle: four-wheelers' lateral slide was explicitly halved from an earlier
  tuning pass (per recent commit history) to reduce excess slide versus the two-wheeler.

#### FR-4: Momentum-dependent climbing

Climbing a steep dune face bleeds speed and can stall the climb without sufficient
run-up.

**Consequences (testable):**
- Approaching a steep face below a threshold speed fails to crest and the vehicle loses
  forward momentum rather than climbing at constant speed regardless of entry speed.

#### FR-5: Damage-free sidehill rollover

Crossing a steep dune face at an angle can tip the vehicle into a genuine rollover;
rollover triggers dust FX, auto-uprights the vehicle after a short beat, and resumes
player control with zero progress or state loss. Realizes UJ-3.

**Consequences (testable):**
- No mechanical, cosmetic, or state penalty exists anywhere in the codebase as a
  consequence of rollover, hard landing, or collision (see FR-6, Non-Goals §5).
- Auto-recovery completes within a short, bounded beat (not player-triggered).

#### FR-6: No damage model

No dents, mechanical failure, or "repair" mechanic exists in any scenario.

**Consequences (testable):**
- No UI, state field, or game-over condition references vehicle damage or health.

#### FR-7: Airtime and landing

Cresting a dune at speed can produce brief airtime with visible suspension compression
on landing.

**Consequences (testable):**
- A jump off a dune crest above a speed threshold produces measurable air time before
  wheel contact resumes.

#### FR-8: Per-body tuning

Distinct vehicle bodies (4x4, pickup, motorcycle, buggy) have distinguishable handling
(e.g. `sinkDrag`, slide behavior) rather than sharing one tuning profile.

**Consequences (testable):**
- Motorcycle no longer leaves a four-wheeler's tire-track footprint (fixed per recent
  commit); its physics currently runs on four raycasts, a known simplification (see
  Open Questions, `BACKLOG.md` item 12).

**Notes:** `[NOTE FOR PM]` Backlog item 12 ("Per-body footprint") flags that track,
wheelbase, and collider extents are fixed at construction and not rebuilt per body —
the motorcycle in particular is more stable than two wheels should be. Deliberately
parked; worth doing only if more vehicles are the plan. Carried to §8 Open Questions.

### 4.2 World & Terrain

**Description:** One large, curated, seamless heightfield region at a time (not
procedurally infinite), chunk-streamed with distance-based LOD for mobile-friendly
performance. Four regions ship: Liwa, Fossil Rock, Al Badayer, Lahbab, each with a
distinct dune wavelength, field-floor softness, and palette. Realizes UJ-1.

**Functional Requirements:**

#### FR-9: Region selection

The player can choose among the available regions before driving begins.

**Consequences (testable):**
- Each of Liwa, Fossil Rock, Al Badayer, and Lahbab is independently selectable and
  loads its own terrain, palette, and POI set.

#### FR-10: Chunked terrain streaming

Terrain loads/unloads in tiles by distance, with no full-terrain regeneration on a
per-frame basis.

**Consequences (testable):**
- Draw calls and terrain memory stay bounded as the player drives across a region,
  rather than scaling with total region size.

#### FR-11: Distinct region character

Each region's dune generation parameters (wavelength, field-floor softness, palette)
are measurably different from the others.

**Consequences (testable):**
- Al Badayer measures a 96m dune wavelength against Liwa's 165m and a field floor of
  0.52 against Fossil Rock's 0.12 (measured values per `BACKLOG.md` item 13). Lahbab
  adds a fourth, distinct point: 105m wavelength, 0.38 field floor, and the steepest
  great-dune grade of the four (~28° mean, vs. Liwa's ~23° and Badayer's ~19°), added
  2026-09-07.

**Notes:** `[NOTE FOR PM]` Al Badayer's rim does not fully enclose the bowl as
originally intended (7 of 12 bearings run uphill from center, not the full ring) —
recorded as an accepted, measured limitation, not a defect to silently fix.

### 4.3 Points of Interest & Exploration

**Description:** Seven (or more, per region) hand-placed POIs mixing grounded/
historical beats with playful ones, giving the world texture without becoming a
checklist. Waypoints are soft-guided, never mandatory. Realizes UJ-2.

**Functional Requirements:**

#### FR-12: POI placement per region

Each region ships with a curated, named set of POIs (Liwa: 11; Fossil Rock: 10;
Al Badayer: 9, per `BACKLOG.md` item 14; Lahbab: 9, added 2026-09-07).

**Consequences (testable):**
- Every POI has a unique name, a fixed world position, and an Ahmed line pool specific
  to it (not shared/generic across POIs).

#### FR-13: Soft-guided waypoint cue

Proximity to an armed POI triggers a subtle compass/dashboard cue; no fail or success
state exists for ignoring it.

**Consequences (testable):**
- Skipping every POI cue in a session does not block progress, end the session, or
  surface any penalty state.

### 4.4 Ahmed's Narrative System

**Description:** The game's only narrative delivery mechanism: a text-only, non-voiced
radio call-in system. Never blocks or pauses driving. Line pools are keyed by category,
region, vehicle, and time-of-day band, with arming/consumption logic so multiple
triggers don't fire as a wall of text at once (per `BACKLOG.md` item 16). Realizes
UJ-1, UJ-2.

**Functional Requirements:**

#### FR-14: Call-in delivery

A call-in plays a static "kssshhht" cue, scrolls Ahmed's line as auto-advancing/fading
text at the bottom of the screen, and closes with a shorter static cue — with no audio
narration and no interruption to driving.

**Consequences (testable):**
- Text auto-advances/fades without requiring player input to dismiss.
- Driving input remains fully responsive during a call-in.

#### FR-15: Category-based line pools with no-repeat cycling

Lines draw randomly from their category pool and retire for the session once used,
cycling back only once the pool is exhausted.

**Consequences (testable):**
- No line repeats within a single session until its category pool has been fully
  cycled.

#### FR-16: Region- and vehicle-aware remarks

Region and vehicle line pools are keyed tables, not flat generic pools; a region/
vehicle remark is armed on selection and consumed at a later quiet slot rather than
fired immediately.

**Consequences (testable):**
- Selecting a region or vehicle does not immediately fire its remark; the remark is
  heard at the next eligible quiet slot.

#### FR-17: Time-of-day band tracking

Four time-of-day bands each track both last-*seen* and last actually-*spoken* state
independently, so a band crossed during a cooldown is not silently lost.

**Consequences (testable):**
- If a time-band remark is owed but suppressed by cooldown, it is still delivered on
  the next eligible slot, referencing the band the player is *currently* in (not the
  missed one).

#### FR-18: Tone guardrails

Ahmed's dialogue never breaks the fourth wall, never plays the accent or Arabic
phrases for humor (jokes land on specificity), and Arabic words are functional/
inferable from context rather than decorative.

**Consequences (testable):**
- `[ASSUMPTION]` This is an authoring/editorial constraint on line-pool content, not a
  runtime-enforceable one; verified by content review against `CLAUDE.md` §13's
  guardrails at line-pool authoring time.

### 4.5 Audio System

**Description:** Layered Web Audio graph: an oud-led ambient score, a base ambient bed
(wind, distant space), and diegetic engine/tire/wind foley, all adaptively mixed and
ducking under radio calls.

**Functional Requirements:**

#### FR-19: Adaptive layering

A base ambient bed plays continuously; the oud layer fades in during driving/
exploration; both duck under an incoming radio call.

**Consequences (testable):**
- Measured ducking occurs (a detectable level drop) on both bed and oud layers for the
  duration of an active call-in.

#### FR-20: Per-vehicle engine voice

Each vehicle body has a distinct RPM-linked engine note (fundamental frequency,
harmonic mix, gear count/length) via a three-oscillator synth table, not sampled audio.

**Consequences (testable):**
- Across a 0-40 m/s sweep, idle fundamentals differ by body: measured 44Hz (low-geared
  diesel single cab) to 128Hz (thumper); gear-shift counts to 40 m/s differ by body
  (pickup: 3, bike: 5); lowpass cutoff differs by body (1769Hz diesel to 4464Hz open
  buggy) — measured values per `BACKLOG.md` item 9.

#### FR-21: Sand/tire foley

Tire sound tone varies with sand density; a distinct tyre-pressure adjustment sound
(hiss + filter sweep down, compressor chug + clunk up) plays and scales in duration
with the number of axes adjusted.

**Consequences (testable):**
- Tyre-pressure sound duration measures 1.5s for one axis, 3.0s for two (per
  `BACKLOG.md` item 10).

### 4.6 Controls & Input

**Description:** A single input abstraction (§3 Glossary) driven by keyboard/mouse,
gamepad, or one of three touch schemes, auto-detected and switchable at any time.
Realizes UJ-5.

**Functional Requirements:**

#### FR-22: Keyboard/mouse control

WASD/arrow keys drive steering and throttle/brake; mouse-drag free-looks the camera in
photo mode. Default on non-touch desktop viewports.

#### FR-23: Gamepad control

Standard Gamepad API input (left stick steering, triggers/face buttons for throttle/
brake) is auto-detected on connect, with a connection prompt, and can override either
other scheme on any viewport.

#### FR-24: Touch control schemes

On first touch-capable session, the player is prompted once to choose among virtual
joystick (with handedness option), on-screen steering wheel, or tilt steering (device
orientation API), with on-screen pedals where the scheme doesn't cover throttle/brake.

**Consequences (testable):**
- The choice persists across sessions (see FR-30, `localStorage`).
- A stacked thumb cluster (photo mode toggle, reset, held handbrake) follows the
  steering control to whichever side it is not on.
- Verified on a 412×883 touch viewport: the held handbrake pulls the vehicle from 61.9
  to 1.5 kph and releases cleanly (per `BACKLOG.md` items 3-5).

#### FR-25: Full touch parity with desktop

Photo mode, handbrake, and reset are reachable on touch, not keyboard-only.

**Notes:** `[NOTE FOR PM]` This was a shipped regression fix (`BACKLOG.md` items 1-5):
removing the developer tuning panel silently broke effects-volume UI, day/night
auto-advance, and touch access to photo/handbrake/reset, since it was the only surface
several settings lived on. Recorded here so the same class of regression — a dev-only
panel quietly carrying player-facing functionality — is watched for going forward.

### 4.7 Photo Mode

**Description:** Free-look camera with filter/vignette options and save/share, built
on the existing camera rig. Realizes UJ-4.

**Functional Requirements:**

#### FR-26: Free-look capture

The player can enter photo mode, free-look the camera independent of the vehicle, apply
a filter/vignette, and save the resulting image.

**Consequences (testable):**
- Photo mode does not pause or end the driving session state underneath it.
- Photo mode is reachable via both keyboard (`KeyP`) and the touch thumb cluster (FR-24).

### 4.8 Adaptive Quality & Performance

**Description:** Device/GPU-tier detection at load plus a runtime fps-based
auto-adjust scales shadow resolution, draw distance, and particle density, targeting
60fps on both desktop and mobile browsers (phones from roughly the last two years).

**Functional Requirements:**

#### FR-27: Quality tier resolution and live reporting

The resolved quality tier, live fps, draw calls, and step-down count are visible while
a diagnostics panel is open, on both desktop and touch viewports.

**Consequences (testable):**
- The stats/tier readout is reachable on a touch viewport, not only via a desktop-only
  HUD grid (this was previously unreachable on touch — fixed per `BACKLOG.md` item 7).

#### FR-28: Draw call budget

The scene stays under approximately 150 draw calls per frame via geometry merging/
instancing (dune tiles, repeated dressing, roaming traffic), tightened further on the
mobile-tier profile.

**Feature-specific NFRs:**
- 60fps target on modern desktop browsers.
- 60fps target on mobile browsers, floor: phones from the last ~2 years.
- **Confirmed on real hardware 2026-09-07**: run manually across multiple physical
  devices, clean pass — the mobile 60fps target and the driving-feel bar (SM-1) both
  held outside the software-rendered dev-machine environment previous measurements
  were limited to. (`BACKLOG.md` item 6, formerly the single highest-priority open
  item, now closed.)

### 4.9 Accessibility

**Description:** A concrete accessibility pass beyond the base UI, covering motion,
screen readers, text scale, and contrast (per `BACKLOG.md` item 20).

**Functional Requirements:**

#### FR-29: Reduced motion, screen-reader support, text scale, contrast option

`prefers-reduced-motion` is respected for Ahmed's subtitle animation; a screen-reader
live region announces each full call-in line once; UI text scales via a `--ui-scale`
custom property across the three prose-bearing surfaces (Ahmed's lines, hints, POI
card); an opt-in high-contrast mode raises panel opacity and hairline visibility
without altering desert rendering.

**Consequences (testable):**
- Under reduced motion, a subtitle line renders whole and holds for the same total
  duration the typed animation would have taken (measured: 50 of 50 characters shown
  immediately vs. 10 of 50 at the 120ms/char typed rate).
- `[ASSUMPTION]` Not yet tested against an actual screen reader (stated directly in
  `BACKLOG.md` item 20) — carried to §8 Open Questions.

### 4.10 Settings & Persistence

**Description:** `localStorage`-backed persistence for settings, unlocked waypoints,
and photo-mode capture metadata.

**Functional Requirements:**

#### FR-30: Settings persistence

Audio (music/effects volume), control-scheme choice, quality tier override, and
accessibility options persist across sessions via `localStorage`.

**Consequences (testable):**
- Effects volume, previously unreachable in a production build (a regression;
  `BACKLOG.md` item 1), is now settable via a `Vehicle & world` row in the menu panel
  and persists on reload.

## 5. Non-Goals (Explicit)

- No multiplayer.
- No procedurally infinite world — curated single regions only, not endless
  generation.
- No combat, damage-based fail states, or scoring/leaderboards.
- No native app wrapper in v1 (browser-only; Electron/Capacitor is a later-stage
  option, not current scope).
- No official/licensed Nissan assets, badging, or trademarked design files — the
  Patrol Super Safari is a visual reference only, modeled independently.
- No photoreal/PBR rendering — flat-shaded stays flat-shaded even under scrutiny.
- No monetization mechanism of any kind. `[ASSUMPTION]` — not stated explicitly in
  `CLAUDE.md`, inferred from the complete absence of any monetization language in the
  source design doc and the project's framing as a passion/craft project.

## 6. MVP Scope

### 6.1 In Scope (shipped)

- Full vehicle physics per §4.1 across the available vehicle bodies, **confirmed on
  real mobile hardware 2026-09-07** (see §4.8, §7 SM-2).
- Four regions (Liwa, Fossil Rock, Al Badayer, Lahbab) with 9-11 POIs each.
- Ahmed's full narrative system: sign-on, POI, idle, fast-driving, sign-off, region,
  and vehicle line categories, with time-of-day band tracking.
- Full audio layering: ambient bed, oud score, per-vehicle engine voice, sand/tire
  foley, tyre-pressure adjustment sound.
- Full input coverage: keyboard/mouse, gamepad, and all three touch schemes, with
  full touch parity for photo mode, handbrake, and reset.
- Photo mode.
- Adaptive quality (device-tier detection + runtime fps auto-adjust) and a live
  diagnostics readout reachable on touch.
- Accessibility pass: reduced motion, screen-reader live region, text scaling,
  high-contrast option.
- Daytime world traffic (roaming vehicles rendered as dust plumes) and a day/night
  cycle with auto-advance and time-freeze-on-selection.

### 6.2 Out of Scope for MVP

- **Cockpit camera** (`BACKLOG.md` item 11) — deferred; needs an interior modeled per
  body, and 5 of 7 bodies are still empty shells.
- **True per-body vehicle footprint** (`BACKLOG.md` item 12) — deferred; explicitly
  scoped as "worth doing only if more vehicles are the plan."
- Additional regions beyond the four shipped.
- Additional vehicle bodies beyond the current roster.
- Screen-reader validation against real assistive technology (implemented but
  unverified — `BACKLOG.md` item 20).

## 7. Success Metrics

`[ASSUMPTION]` No formal analytics/metrics infrastructure is described anywhere in the
source material; these are process- and feel-level signals appropriate to a solo,
low-ceremony project, carried forward from `brief.md`'s Success Criteria rather than
invented fresh.

**Primary**
- **SM-1**: Driving-feel bar — informal playtesters describe cresting a dune, sliding
  in soft sand, or rolling over using the design's own vocabulary ("whoa, okay,"
  weight, momentum) without being prompted. Validates FR-1 through FR-8.
- **SM-2**: Mobile validation closes — the game is run on a real ~2-year-old phone and
  the 60fps target (§4.8) and sand/rollover feel are confirmed outside a
  software-rendered environment. Validates FR-27, FR-28's feature-specific NFRs.
  **Confirmed 2026-09-07** — clean pass across multiple physical devices.

**Secondary**
- **SM-3**: Unprompted sharing — photo-mode output or the game link itself is shared
  by someone outside the project to someone else without being asked. Validates FR-26.

**Counter-metrics (do not optimize)**
- **SM-C1**: Session length is not a target. Optimizing for longer sessions would
  contradict the explicit "5 minutes or 45 minutes, both are fine" design intent
  (`CLAUDE.md` §5) and risks introducing retention hooks the Non-Goals (§5) rule out.
  Counterbalances any temptation to read SM-1/SM-3 as engagement metrics.

## 8. Cross-Cutting NFRs

- **Performance:** 60fps target on both desktop and mobile browsers (mobile floor:
  phones from the last ~2 years, chosen to protect visual quality rather than stretch
  to older hardware). Draw call budget ~150/frame, tightened on mobile tier.
  **Confirmed on real mobile hardware 2026-09-07** across multiple physical devices,
  clean pass.
- **Load size:** initial bundle + first-terrain-chunk payload sized for a
  first-interaction budget of a few seconds on decent broadband; assets stream rather
  than load upfront.
- **Aesthetic and Tone:** low-poly, flat-shaded geometry throughout; no PBR realism;
  warm limited palette (ochre, rust, dusty rose, deep indigo shadows); single dominant
  directional light biased toward golden/blue hour. Ahmed's voice guardrails (§4.4,
  FR-18) are as load-bearing as any rendering constraint — the tone is a product
  requirement, not flavor text.
- **Platform:** browser-only (desktop Chrome/Safari/Firefox/Edge, mobile Safari iOS/
  Chrome Android), responsive at runtime rather than a separate build per viewport.

## 9. Open Questions

1. ~~Real mobile-device validation~~ — **RESOLVED 2026-09-07.** Run manually across
   multiple physical devices; clean pass, no issues found. NFR-2 and SM-1/SM-2 are
   confirmed (see §4.8, §6.1, §7, §8). Kept here, struck through, rather than
   renumbered, since other artifacts (`epics.md` Epic 1) cite this as "PRD §9 OQ1."
2. ~~Cockpit camera~~ — **RESOLVED 2026-09-07: deferred indefinitely.** The vehicle
   roster is held at its current bodies — no growth planned — so the interior-modeling
   work `BACKLOG.md` item 11 requires isn't justified right now. Revisit if the roster
   decision changes.
3. ~~Per-body vehicle footprint~~ — **RESOLVED 2026-09-07: deferred indefinitely**,
   same roster decision as #2. The motorcycle's four-raycast simplification (vs.
   two-wheel dynamics) and its oversized wheelbase (`BACKLOG.md` item 12) remain
   known, accepted limitations rather than a scheduled fix.
4. Screen-reader validation — accessibility pass is implemented (FR-29) but never
   tested against real assistive technology.
5. ~~Whether Ahmed ever references the player by name/nickname~~ — **RESOLVED
   2026-09-07 (discovered already decided in shipped code):** he stays fully generic
   (*habibi, ya sir, my friend, champion*). `data/ahmedLines.ts`'s own file comment
   already carried the rationale — no player-name input exists anywhere in the game,
   and one would add exactly the friction §1 rules out. `CLAUDE.md` §12 was simply
   stale; updated to match.
6. ~~Exact wording/count of Ahmed's line pool~~ — **RESOLVED 2026-09-07: no fixed
   target, ongoing.** Expanded the four highest-frequency triggers (`stuck`, `fast`,
   `airborne`, `rollover`) by 3 lines each — the ones a long or repeated session
   actually reaches the recycle point on, per the pool-sizing rule already documented
   in `data/ahmedLines.ts`. More can be added anytime under the same tone guardrails
   (FR-18); this is deliberately open-ended, not a one-time count to hit.

## 10. Assumptions Index

- §1/§2.1 — Vision framing assumes this is primarily a solo passion/craft project
  rather than one with external funding or growth targets.
- §2.1 — JTBD for a Gulf/UAE audience and for "the developer as a user" are inferred,
  not sourced from user research.
- §4.1 FR-8 Notes — tuning philosophy note assumes feel/playtest iteration continues
  as the primary tuning method going forward, per `CLAUDE.md`'s stated philosophy.
- §4.4 FR-18 — tone guardrails treated as an editorial/authoring constraint rather
  than something runtime-enforceable.
- §5 — no-monetization non-goal inferred from absence of monetization language in
  `CLAUDE.md`, not an explicit statement.
- §7 — all Success Metrics are inferred process/feel signals, not sourced from any
  stated metrics program.
