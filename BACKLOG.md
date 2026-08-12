# Shamal — backlog

Twenty items, ordered by what would hurt most if left alone. Everything here is
grounded in the current code rather than general advice: file paths and measured
numbers are given where they exist, and where something is unverified it says so.

Sizes are rough: **S** = an afternoon, **M** = a day or two, **L** = a week-ish.

**Status: 13 of 20 done.** Items marked ✅ have shipped; the notes under them
record what the work actually found, which in three cases was not what the item
predicted. Two items are blocked on a decision rather than on effort, one needs
hardware nobody here has, and three are large.

---

## 1. Broken now

The first two were regressions introduced when the `T` tuning panel was removed
from player builds. It was the only UI for several settings, and two of them did
not get relocated.

### 1. ✅ Effects volume has no UI at all — **S**

`settings.effectsVolume` was read at boot and pinned at its default of `0.7`
forever, with nothing in a production build able to set it.

*Done:* a `Vehicle & world` row in `MenuPanel`, alongside Sound and Music.

### 2. ✅ The day never advances — **S**

`TimeOfDay.autoAdvance` defaulted to `false` and its only toggle lived on the
tuning panel, so the entire 20-minute cycle — keyframes, blue hour, the moonlit
night, the haze curve — was dead code in shipped builds.

*Done:* on by default, with a `Moving` chip at the head of the Time of day row.
Picking a named time freezes the sun there, which is also the answer to the
open question about a moving sun changing the light you framed a photo in — one
tap parks it. It also gave Ahmed something to notice; see item 16.

### 3. ✅ Photo mode is unreachable on touch — **M**

`togglePhotoMode()` was bound to `KeyP` and nothing else, so the one feature
built to spread the game was invisible to the audience most likely to spread it.

*Done:* see item 4.

### 4. ✅ No handbrake on touch — **S**

### 5. ✅ No reset on touch — **S**

*Done, all three together:* a stacked cluster on the thumb opposite the stick —
photo, reset, and a held handbrake — following the stick to whichever side it
isn't on. Verified on a 412×883 touch viewport: the held handbrake pulls the
truck from 61.9 to 1.5 kph and releases clean.

---

## 2. Unvalidated

### 6. Play it on a real phone — **S, and it still outranks everything below**

§2 makes driving feel the core value of the game, and it has never been
validated on hardware that renders above ~5 fps. Every visual check in this
project was software-rendered. Open questions only a device answers: does the
weight transfer read, does a stalled climb feel like a decision or a bug, does
the `sinkDrag` fix make the buggy and the pickup feel as different as their
numbers now say, and is the rollover a "whoa, okay" or an irritation.

**Blocked on hardware, not effort.** Item 7 now exists specifically to make this
session productive when someone does it.

### 7. ✅ Frame rate across the three quality tiers — **S**

*Done:* a line under the Quality chips reporting the resolved tier, live fps,
draw calls, and a step-down count once it is non-zero. It ticks only while the
panel is open, because a single reading of fps is a coin toss.

This existed nowhere reachable before: the HUD's stats grid carries fps and
draw calls but is `display: none` on touch viewports — the exact devices where
the 60fps target of §8 has never been measured — and a phone has no console.

### 8. ✅ Short and landscape viewports — **S**

*Done:* the menu goes two-up under 500px of height. On a 667×375 screen that
took the hidden portion from 599px of 894 down to 286px.

Worth remembering: the first attempt used `columns: 2`, and multi-column inside
a `max-height` scroll container fragments into as many columns as it needs and
puts the extras off to the **side**. The panel reported no vertical overflow
while six of its twelve rows were simply not on screen. Grid is correct here,
and both axes are measured now.

---

## 3. Driving feel (§2)

### 9. ✅ Per-vehicle engine notes — **M**

*Done:* `src/audio/engineVoices.ts`, a per-body table over the existing
three-oscillator synth — where the fundamental sits and how far it climbs, the
harmonic mix, and the number and length of the gears. No sample data.

Measured across a 0–40 m/s sweep: idle fundamentals span 44 Hz (the low-geared
diesel single cab) to 128 Hz (the thumper), the pickup makes three shifts to
40 m/s where the bike makes five, and the lowpass cutoff runs 1769 Hz on the
diesel to 4464 on the open buggy.

### 10. ✅ Tyre-pressure audio — **S**

*Done:* a hiss going down with the filter sweeping as the pressure drops, and a
chugging 12V compressor going up, finished by the clunk of the chuck coming
off. Both last exactly as long as the axis takes to walk — 1.5s for one step,
3.0s for two.

### 11. Cockpit camera — **L**

Parked three times now. Needs an interior modelled for each body, and five of
the seven are still empty shells. The soft top has one, which makes it the
natural place to prototype.

### 12. Per-body footprint — **L, high risk**

Track, wheelbase, collider extents and the four wheel hard-points are fixed in
`VehicleTuning`, built once in the `Vehicle` constructor and never rebuilt on a
body change. Consequences: the quad was abandoned, the bike is drawn at a 2.9m
wheelbase (roughly twice a real one), and the bike's physics runs on four
raycasts so it is far more stable than two wheels should be. Fixing it means
recreating the collider and wheel set on every body change — surgery on the one
system §2 calls the core value. Worth doing only if more vehicles are the plan.

---

## 4. World and content

### 13. A third region — **M**

`RegionSpec` made another map a data file, and that work is done and proven
(digest `1257698436` confirmed the refactor was behaviour-identical). Al Badayer's
bowl or the deep Empty Quarter would both drive unlike Liwa and Fossil Rock.

### 14. More POIs, and more per region — **M**

Liwa has 11, Fossil Rock fewer. §5 called for 7 as a v1 target and the world has
outgrown that. The rebuilt five set a quality bar the rest should meet.

### 15. Daytime world traffic — **M, needs a decision first**

The night convoys work and the day has nothing equivalent. A distant dust plume
tracking along a ridge would cost about what the convoys did. Deliberately
declined once already — the counter-argument is that it competes with the
solitude §1 is built on. **This needs a call before it needs code.**

### 16. ✅ Ahmed reacting to more state — **S**

*Done:* three lines per vehicle, three per region, and four bands of the day.
Vehicle and region lines are keyed tables rather than flat pools, because a line
that could be about any truck is the generic filler §13's guardrails rule out.

Two things the work turned up. Vehicle and region remarks have to be *armed* and
consumed by a later quiet slot rather than spoken on the spot — you pick a
desert, then a truck, then he signs on, and firing all three at once is a wall
of text over the first ten seconds of a game about decompression. And the time
band needs two fields, not one: tracking only the band last *seen* meant a
crossing landing inside a cooldown was consumed silently and lost for the rest
of the cycle. Tracking what he has actually *said* separately keeps it owed, and
re-reads the band when the slot opens — so if he was busy through dusk and it is
dark now, he talks about the dark.

---

## 5. Craft and polish

### 17. ✅ Camel shadows are cast from undeformed geometry — **S**

*Done:* the gait GLSL is shared by the lit material and a `MeshDepthMaterial`
handed to the mesh as `customDepthMaterial`. Confirmed by capturing what
three.js compiles: at the high tier the shadow-pass vertex shader now contains
`aGait`, `legMask` and `uTime`, and previously contained none of them.

Two things learned while verifying, both worth keeping: the directional shadow
frustum is **55m half-width around the truck** and the herd spawns hundreds of
metres out, so this only ever shows when you drive right up to one — and never
at all on the low tier, where `shadows: false`, which is what `detectTier` gives
most phones. Anything instanced and animated added later needs the same depth
material; there is no warning when it's missing, only a shadow that doesn't move.

### 18. Flat-shading quilts on low-relief ground — **M, needs a decision first**

At grazing angles on flat ground the 2m render grid shows as a patchwork.
Measured: face normals there genuinely span 0–29°, so this is the art direction
meeting the LOD resolution rather than a shading bug. A smoothing-angle rule
would fix it and is **a real art call** — §4 says flat-shaded stays flat-shaded.

### 19. ✅ The 11.8MB score — **S, and the premise was wrong**

The item claimed `preload='auto'` made a phone on cellular pull megabytes before
the player had decided to stay. Measured against the production build over four
runs, that is not what happens. Nothing is fetched at page load or at the map
picker — the audio graph is only built on a gesture, and those listeners don't
exist until `Game` has loaded. Once driving starts, 2.8–4.2MB of the 11.79MB
arrives in the first 30 seconds under *either* setting; the spread is run-to-run
noise, not the flag. `preload` stops mattering the moment `play()` is called,
which here is immediately after construction.

*Done:* set to `'metadata'` anyway, so a future refactor that builds the element
without playing it can't quietly pull twelve megabytes — but recorded as a
safety property, not a saving. The only real lever on a 16-minute ~98kbps track
is a shorter loop or a lower bitrate, which is an asset decision, not a code one.

### 20. ✅ Accessibility pass — **M**

*Done:* four concrete things where there had been none.

- `prefers-reduced-motion` reaches the subtitles. The line appears whole and
  holds for exactly as long as the typed version would have — 10 of 50
  characters at 120ms normally, 50 of 50 under reduce.
- A screen-reader live region. The visible line is `aria-hidden`, because
  announcing it as it typed produced a stutter; a `role="status"` sibling
  carries the whole line once, when he keys up. The canvas has a label and the
  menu button reports `aria-expanded`.
- Text size, as a `--ui-scale` custom property over the three surfaces carrying
  prose — Ahmed's lines, the hints, the POI card. Not the chips or the HUD,
  which are sized to their containers.
- A contrast row, opt-in and touching only the UI chrome, never the desert:
  panels 82% → 95% opacity, hairlines 16% → 50%.

Still untested against an actual screen reader.

---

## Not on this list, and why

- **The Old Falaj being geographically odd in Liwa** — decided, deliberately
  kept. The map is explicitly fictionalised and Ahmed's line leans on it.
- **Leaderboards, damage, multiplayer, native wrapper** — §11 non-goals.
- **Photoreal rendering** — §11, and the palette work depends on it staying flat.
