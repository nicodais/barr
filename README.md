# In the Barr

Relaxing open-world dune-bashing for the browser. See [CLAUDE.md](CLAUDE.md) for the full design brief.

**Current phase: 5 complete, 6 ready to ship.** Driving feel, the streamed world, audio,
Ahmed's radio and the ten POIs are all in, along with photo mode, touch controls,
adaptive quality and the responsive pass. The build is configured for Vercel but has
not been deployed — see [Deploying](#deploying).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build into dist/
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | throttle / brake (brake becomes reverse at a stop) |
| `A` / `D` | steer |
| `Space` | handbrake (rears only, pivots the truck) |
| `Q` / `E` | swing the camera |
| `R` | put the truck back on its wheels |
| `P` / `Esc` | photo mode in / out |
| `T` | options and tuning panel |

Gamepad is auto-detected and takes over whenever it's actually being used — left stick
steers, triggers are the pedals. Touch schemes are phase 5.

**Invert steering** is under `T` → Controls, and persists across reloads. It's applied in
`InputManager` after all sources are aggregated, so it covers keyboard, gamepad and the
phase 5 touch schemes without the vehicle controller knowing anything about it (§7).
Full key remapping is a phase 5 job.

On touch devices the **thumbstick position** (bottom-left / -middle / -right) can be changed
from a small bar pinned to the top-right, or under `T` → Stick position. It's a persisted
setting of its own, independent of the wheel/tilt **pedal side** — both live in
`GameSettings`.

## Tuning

`T` opens live sliders for every feel parameter. Changes apply immediately and persist to
`localStorage`, so you can tune mid-dune without losing your position. **Copy values**
dumps the current set as JSON to paste into
[`src/vehicle/VehicleTuning.ts`](src/vehicle/VehicleTuning.ts) once you find something good.

The brief is explicit that this gets tuned by feel rather than by chasing real suspension
specs, so the defaults are a starting point, not a target.

## Where the feel comes from

Rapier's raycast vehicle controller supplies per-wheel suspension and a slip-based tyre
model. Everything layered on top lives in [`src/vehicle/Vehicle.ts`](src/vehicle/Vehicle.ts):

- **Gravity is 12 m/s², not 9.81.** At real gravity the truck reads as floaty and skips
  contact across undulations. This is the single biggest lever on feeling planted — but it
  cannot be changed alone. Every force scales with it (`G_SCALE` in
  [`VehicleTuning.ts`](src/vehicle/VehicleTuning.ts)); raise gravity while leaving engine
  force behind and a 30° face needs more thrust than the engine has, silently killing the
  momentum climb. Scaling them together is dynamic similarity: identical ride height and
  identical climbable slopes, with everything playing out ~1.24x faster.
- **Weight transfer** falls out of an explicit low centre of mass plus a deliberately low
  roll inertia — the truck leans over time rather than snapping.
- **Ground contact** is geometric, not dynamic. Rapier's raycast wheels find the ground
  only within `suspensionRest + wheelRadius` of the hard point, so that reach — not the
  damping — is what decides whether the truck tracks a dip or skips over it.
- **Drifting** needs three things together, and any one alone fails. `hardpackGrip`/
  `sandGrip` are friction-*circle* radii (roughly a tyre's friction coefficient, so
  physical values sit near 1 — much above that and the tyres never saturate).
  `rearGripBias` shrinks the rear circle so the back lets go first, otherwise both axles
  saturate together and you get understeer. And `yawAssist` pulls rotation toward the rate
  the steering actually commands, which is what makes a slide recoverable instead of a
  spin that continues after you straighten up. Measured: steer 0.3 tracks clean at 3° of
  slip, steer 0.7 drifts to 26°, soft sand slides further than hardpack at equal input,
  and every case settles back to ~1°.

### Two Rapier gotchas that cost real time here

- **`setWheelBrake` takes an impulse, not a force** — unlike `setWheelEngineForce`, which
  Rapier scales by the timestep internally. Passing newtons straight in applies them ~60x
  over, cancelling all forward velocity within a couple of steps and dumping the angular
  momentum into a nose-over. The tuning stays in newtons and is converted at the call site.
- **Steering lock must fall off faster than linearly.** A 2.9m wheelbase at 70 km/h with
  20° of lock describes an 8m radius — about 4g of lateral demand, which no tyre supplies,
  so the truck saturates and spins on any input at all.

## The vehicle

[`vehicleMesh.ts`](src/vehicle/vehicleMesh.ts) builds the truck from primitives: stepped
bonnet, upright greenhouse with amber glazing, black arch flares and sliders, roof rack with
a cargo box, and a tailgate-mounted spare.

Proportions follow a Patrol Super Safari as a **visual reference only**. There is
deliberately **no badging or maker's mark of any kind** — §11 rules out reproducing
trademarked identifiers even when the silhouette is exactly the thing being evoked, so the
reference's flank badge is not reproduced.

Two things worth keeping in mind if you edit it:

- **All static bodywork merges to one mesh per material.** ~40 primitives become 11 meshes
  (plus wheels, which move); the whole truck is 21 meshes and 2.4k triangles. Add parts
  freely — they cost geometry, not draw calls.
- **Glass is emissive, not just coloured.** Under plain Lambert a windscreen angled away
  from a low sun goes nearly black and reads as a hole in the truck. The reference treats
  every window as one flat amber fill, so the material carries its own light.

Body dimensions are free to overhang the collider — bumpers, flares and the spare all do.
**The physics box and wheel positions are unchanged**, so re-modelling never touches the
handling.

## Selling ground contact

Correct physics are not enough on their own: with nothing marking the point of contact the
truck reads as hovering regardless of what the solver is doing. Three cues, all driven from
the wheels' **world-space contact points** rather than the body, so they appear exactly
where rubber meets sand and vanish the instant it doesn't:

| | file | says |
| --- | --- | --- |
| Dust | [`DustSystem.ts`](src/vehicle/DustSystem.ts) | touching *now* — volume scales with speed and sand softness |
| Contact patch | [`ContactShadow.ts`](src/vehicle/ContactShadow.ts) | touching *here* — fades out within ~90ms of takeoff |
| Tyre tracks | [`TrackSystem.ts`](src/vehicle/TrackSystem.ts) | touched *there* — ribbons break across jumps |

The sun's cast shadow cannot do this job alone. At the low sun angles this game lives in it
lands metres to the side, leaving nothing under the vehicle. Its `shadow.normalBias` was
also 0.6 — pushing the lookup 60cm along the surface normal and visibly detaching the
shadow from the truck; it's now 0.08, with a tighter shadow frustum to match.
- **Sand traction** samples a softness field per wheel contact point and blends grip,
  side-grip and sink drag. Windward faces pack firm; lee/slip faces stay loose.
- **Momentum climbs** come from `climbBleed`: soft sand robs power in proportion to how
  nose-up you are. Measured on a 37° face, a run-up crosses it while bleeding 97 → 46 km/h;
  from a standstill the same face cannot be climbed at all and the truck slides back.
  Reading the dune is a real skill, not an abstraction.
- **Rollover** is real but consequence-free. Past `rollThreshold` for `rollRecoverDelay`,
  the truck is set gently back on its wheels *at the same spot*, facing the way it was
  going. No damage model exists anywhere in the codebase.

## The world

A curated region at the heart of a procedurally **endless** dune field.
[`src/terrain/height.ts`](src/terrain/height.ts) is a pure, deterministic field — the
physics colliders, the render chunks and the traction model all read the same function.
It has an asymmetric dune profile (long windward ramp, short slip face capped near sand's
~32° angle of repose), a secondary cross-dune train, sabkha flats between dune fields, a
small firm pan at spawn for baseline testing, and four hand-sculpted landmarks. Chunks
stream around the player with no world bound, so the dunes run to the horizon in every
direction. The region is instead closed by a soft edge:
[`WorldBoundary`](src/engine/WorldBoundary.ts) fades the screen to a warm haze once the
player drives well past the outermost POIs (~760m out on either axis) and, at full fade,
sets the truck back down inside the region facing the centre — damage-free, never blocking,
and never a wall or a void.

Every built landmark stands on a **graded pad**: inside its footprint the ground is flat at
the pad's height, with a blend ring easing back into the dunes (`PAD_FOOTPRINTS` in
[`height.ts`](src/terrain/height.ts)). This is what fits the POIs to the landscape —
multi-piece structures need flat ground under their whole footprint, and because the pads
live in `heightAt` itself, the render chunks, physics heightfields and landmark colliders
all agree by construction. Scattered dressing outside a pad (survey stakes, tripods) is
still settled onto the terrain per piece. Landmarks are authored as dozens of readable
primitives but **baked to one mesh per material** at startup — unbaked they blow the
draw-call budget (§8) on their own.

Terrain seams are watertight by construction, which took three fixes that all matter:
chunk positions are **world-space with every mesh at the identity transform** (per-chunk
transforms make the rasterizer's edge equations disagree sub-pixel and print hairline
cracks); edges facing a coarser LOD are **stitched onto that neighbour's chord** (and a
chunk rebuilds when a neighbour's LOD changes); and the crack-insurance skirts hang from a
**recessed top ring** — a skirt sharing its top vertices with the surface z-fights it and
draws a dashed line along every chunk boundary.

A slim **dashboard compass** ([`Compass`](src/ui/Compass.ts), §5) shows heading plus one
soft diamond toward the nearest undiscovered POI — no distance, no name, never an
objective marker — and a small found-counter. Discovery persists across sessions
([`Progress`](src/settings/Progress.ts), §3); Ahmed's call-ins stay once-per-session.

Two things worth knowing before editing it:

- **Noise frequencies are chosen against `WORLD_SIZE`.** The value-noise lattice is on
  integer units, so `frequency × WORLD_SIZE` is literally how many cells of variation
  exist across the whole map. Too low and the fbm is a near-constant everywhere.
- **Use `fbmRange`, not a bare `smoothstep` on `fbm`.** Raw value-noise fbm clusters hard
  around 0.5 and barely leaves 0.35–0.65, so a wide window returns ~0.5 everywhere and
  whatever it gates comes out uniformly mid-strength.

## Life in the world

Three systems keep the desert from reading as an empty surface, and all of them
are instanced — together they add **6 draw calls**, not six hundred.

- **[`Scatter`](src/world/Scatter.ts)** — scrub, tussock grass and stones, ~760 instances
  live at any time. Placement is deterministic from a cell hash, so a bush is in the same
  spot every time you pass it and nothing is stored. Plants avoid slopes past ~24° and
  anything looser than 0.62 softness, and thin out inside dune fields: they grow in the
  corridors between, not on active faces. Cells fill in on a per-frame budget, because a
  full rebuild is a few thousand `heightAt` calls and would hitch on every boundary.
- **[`Birds`](src/world/Birds.ts)** — a dozen, high up, drifting. Deliberately sparse: one
  or two crossing the sky reads as a living desert, a wheeling flock reads as a bird level.
  The wingbeat is vertex displacement keyed off a per-instance phase, so they flap out of
  sync in a single draw call.
- **[`Wildlife`](src/world/Wildlife.ts)** — a gazelle herd that grazes, drifts, and breaks
  away when the truck comes within 62m. That flight response is the point: a herd that
  ignores you is scenery, one that notices you makes the desert somewhere you're visiting.
  The walk cycle is shader-driven off per-instance phase and gait, so there's no skeleton.

## Cameras and the ground

[`cameraClearance.ts`](src/engine/cameraClearance.ts) keeps both the chase camera and photo
mode out of the terrain. There are two distinct failures that look identical from the
driver's seat, and only one of them is fixed by clamping the camera's height:

1. The camera sits below the surface — cresting a dune, or reversing into a bank.
2. The ground stays below the camera, but a ridge **between** camera and truck cuts through
   the view. No amount of clamping the camera's own position helps.

Both are solved by asking how high the camera must be for the straight line back to its
subject to clear the terrain along its whole length, sampled at six points.

The chase camera applies that to its *desired* position before smoothing, so it eases up a
rising dune rather than being shoved out of one, and rises about three times faster than it
falls — a sharp ridge is through the lens before a lazy ease has finished climbing it. A
hard floor after smoothing guarantees the result.

Verified over 3,234 samples — a full climb of the steepest sculpted face, a weaving drive
including a recovery snap, and 1,296 photo-mode orbits across six locations at every yaw,
lowest pitches and all distances. Zero frames below ground; worst clearance 1.50m, which is
the floor holding.

## Sky

Two things about [`Sky.ts`](src/engine/Sky.ts) that are easy to get backwards:

- **The gradient exponent below 1.0 pulls blue *down* toward the horizon**; above 1.0 lets
  the warm band climb. The chase camera only ever sees the lowest ~25° of sky, so this has
  to be low or the entire visible strip is warm.
- **The gradient runs horizon → pale → zenith, not horizon → zenith.** Blending a warm
  horizon straight into a blue zenith averages orange and blue into purple. Real skies pass
  through a desaturated haze band, so that band is constructed explicitly.

## Streaming

[`TerrainStreamer`](src/terrain/TerrainStreamer.ts) runs rendering and physics on separate
radii on purpose: colliders are expensive and only matter under the wheels (±256m, a 5×5
chunk ring), meshes are cheap and matter to the horizon (900m at four LODs). Chunk meshes
are indexed — `flatShading` derives per-face normals in the fragment shader, so the
faceted look costs no extra vertices. Mesh builds are budgeted per frame; terrain popping
in is better than a stutter.

Measured on a 376m drive at 68 km/h: worst frame 22.7ms, build queue never backed up,
peak 64 draw calls against the ~150 budget (§8).

A boot-time assertion raycasts the colliders against the height function and warns on
disagreement — a transposed sample layout or an off-by-half-a-chunk translation is
completely silent and just makes the truck float.

## Audio

**Every sound is synthesised — the game ships zero audio bytes.** No samples, no music
files, no voice. That keeps the payload tiny (§8) and sidesteps streaming audio on mobile
entirely. [`AudioEngine`](src/audio/AudioEngine.ts) runs four buses (world / score / radio
under a master) so the adaptive mix has something to move: the oud comes up while you're
driving and ducks under an incoming call (§6).

- **Engine** is a harmonic stack pitched off a faked gearbox, not a sample loop — it glides
  continuously with no crossfade seams, and the audible shift points are what make
  acceleration read as effort.
- **Tyres** are filtered noise whose tone tracks sand softness, so the traction model is
  audible as well as visible. **Wind** rises with speed.
- **The score** is generative in maqam Hijaz on D — the augmented second between Eb and F#
  is what places it geographically. It never repeats over a long drive.
- **Ahmed** is never voiced (§6): a squelch when he keys up, a shorter one when he signs
  off, and the line scrolls as text.

Two things to know before editing it. **Audio can only start from a user gesture**, so the
context is built on first input rather than at load. And **the pluck synthesis deliberately
avoids Karplus-Strong**: inside a Web Audio feedback cycle it diverged in practice even with
loop gain provably below unity, taking the mix to ~1e27. Additive synthesis has no feedback
path and cannot run away. There's a limiter on the master as a second line of defence.

## Narrative

[`Director`](src/narrative/Director.ts) decides when Ahmed keys up. It is mostly governors
rather than triggers — a global cooldown, one-shot POIs, a much longer cooldown on ambient
chatter, and a rule that nothing ever talks over anything else. **Silence is the default
state**; §5 wants him sparse and ambient, going quiet for long stretches.

Ambient lines live in [`ahmedLines.ts`](src/data/ahmedLines.ts) and are retired once used so
a session doesn't repeat itself (§13). POI lines live with the POIs in
[`pois.ts`](src/data/pois.ts): each spot carries an **ordered pool** of beats — usually
"what it is", then "why it matters" — that Ahmed delivers as one call-in (a single key-up,
consecutive lines, then a sign-off), so a place can teach its own history while every line
stays a one-liner. Many lean into the desert heritage of the UAE — the falaj, the ruler's
majlis, the ghaf, falconry, the camel track. Nothing blocks: the subtitle types in over the
driving, holds, and fades, and you can drive straight past a call-in and miss it.

The ten landmarks in [`Landmarks.ts`](src/world/Landmarks.ts) are **solid**:
`createLandmarkColliders` builds static Rapier colliders sized to each one's load-bearing
masses — the tower, the ghaf trunk, the pylon legs, the camel-track posts — so the truck
bumps them instead of driving through. Collision stays **damage-free** (§11): it's tactile,
never a fail state, and small dressing (cups, stakes, canopy, the fallen tripod) is left
collider-free so nothing snags on an invisible box.

## Touch, quality and photo mode

**Touch** ([`TouchSource`](src/input/TouchSource.ts)) offers all three schemes from §7 —
thumbstick with a handedness option, steering wheel with pedals, and tilt. Every widget
tracks touches by `identifier` rather than index: a steering thumb and a throttle thumb on
one screen makes multi-touch the normal case, and index-based tracking breaks the instant a
finger lifts. Tilt calibrates its neutral point to the first reading rather than assuming
the phone is held flat, and requests the iOS 13+ sensor permission from a gesture.

**Adaptive quality** ([`Quality.ts`](src/engine/Quality.ts)) picks an opening tier from the
device, then a frame-time watchdog only ever steps *down*. Automatic upgrades pump — raise,
drop below the threshold, lower, recover, raise — so downgrade-only converges and anyone
who wants more picks a tier by hand. Physics collider radius is deliberately *not* scaled:
a cheap tier that let the truck fall through the world would be a bug, not a setting.

**Photo mode** grades through a real post-process pass, not a CSS filter on the canvas. A
CSS filter is a compositor effect — it looks correct on screen and is entirely absent from
the saved file. Capture happens in the same frame as its render, because without
`preserveDrawingBuffer` the buffer is cleared on composite and a later capture comes back
blank.

## Deploying

Configured but **not deployed** — that needs your Vercel account.

```bash
npm run build     # typecheck + static build into dist/
npx vercel        # or connect the repo at vercel.com/new
```

[`vercel.json`](vercel.json) sets the framework, build command and long-lived cache headers
for hashed assets. Vendor code is split into `three` and `rapier` chunks so an app change
re-downloads ~30 kB rather than ~900 kB.

This isn't a git repo yet; `git init` and push before connecting Vercel if you want
auto-deploy on main and preview builds on branches (§10 phase 6).

## Known gaps

- **The `rapier` chunk is 761 kB gzipped** — it inlines its WASM as base64, which costs
  ~33% over the raw binary. Moving to `@dimforge/rapier3d` with `vite-plugin-wasm` is the
  single biggest remaining win on load size (§8), and now that vendor code is split it can
  be done without touching anything else.
- **Gamepad support has never been tested against real hardware.** The mapping follows the
  standard layout but nobody has held a controller.
- **Not profiled on real mobile Safari/Chrome**, which §8 asks for early. The quality tiers
  and touch schemes are verified in an emulated viewport only — that proves the layout and
  the plumbing, not the frame rate or how the controls actually feel under a thumb.
- Photo mode composes around the truck only; there's no detached free-fly camera.
