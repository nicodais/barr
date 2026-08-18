# Test coverage: where we are, and what to test first

## 1. The state of play

There are no tests. Not "thin coverage" — zero test files, zero test
dependencies, zero CI.

| | |
|---|---|
| Test files | 0 |
| Test framework | none in `package.json` |
| CI workflow | no `.github/` directory |
| Only automated gate | `tsc --noEmit`, via `npm run build` |
| TypeScript under `src/` | ~19,000 lines across 74 files |

`tsc` is a real gate and it currently passes clean, but it only checks that
types line up. Every behavioural claim in this codebase — that the sand grips
the way §2 says, that Ahmed doesn't repeat himself, that a save from last week
still loads — is unverified except by driving the game and looking.

## 2. What that has already cost

The commit log is largely a log of defects found by eye, after shipping:

- `5a8fb44` — "Stop the arrival cards claiming the wrong thing in the new regions"
- `401446a` — "Fix Al Badayer booting to a dead screen"
- `7afe2ac` — "Stop the motorcycle leaving a 4x4's footprint"
- `7887aa1` — "fix sinkDrag's units"
- `c6d53f2` — "Add a backlog, and record two regressions in it"

Two of those are worth dwelling on, because they say something about what kind
of tests would help.

**The arrival-card bug (`5a8fb44`).** `POI_INFO` is keyed by POI *kind*. Adding
a third region that reused existing kinds meant every Al Badayer POI silently
inherited Liwa's card — the game stood you in front of a live transmission line
and captioned it "The Oil Surveys… gave nothing back". Four cards were wrong.
Nothing failed; the text was just false. A single test asserting *every POI in
every region resolves a card whose title matches that POI* would have caught all
four at the moment the region was added.

**The `hash2` bug**, recorded in the docblock at `src/terrain/height.ts:55`.
Plain `*` overflowed float64 and rounded away the low bits, so the hash returned
`[0, 0.5]` with a mean of `0.25` instead of `0.5`. That "quietly starved every
`smoothstep` window downstream and flattened the whole world." It was found by
noticing the world looked wrong. A five-line statistical test — sample 10,000
points, assert the mean sits near 0.5 and the range spans `[0, 1)` — would have
caught it in milliseconds and pinned it to the right function.

This is the pattern: the failures here are **silent and semantic**, not crashes.
Nothing throws. The world is just flatter, or the card just lies. Those are
exactly the failures a type system cannot see and a playtest catches late.

## 3. Four live defects found while writing this

To check that the argument above isn't theoretical, here is what a few hours of
reading turned up in code that is on `main` right now.

### 3.1 Progress is shared across regions, and switching regions deletes it

`src/settings/Progress.ts` stores discoveries under one key, `dune.progress.v1`,
as a flat array of `PoiKind`. But POI kinds are deliberately reused between
regions — `ghaf`, `falaj`, `watchtower`, `teastand`, `famousdune`, `cameltrack`,
`falconry`, `coffeehearth`, `majlis` and `oasis` all appear in more than one.
`loadProgress` filters the stored array against `activeRegion().pois`, which the
comment describes as making it "region-scoped". It does not — the *key* is not
scoped, so there is one shared set.

Two consequences, both user-visible:

1. **False credit.** Find the ghaf and the falaj in Liwa, then switch to Fossil
   Rock: both ids survive the filter because Fossil Rock has its own ghaf and
   falaj. You arrive at a desert you have never driven with the counter reading
   2/10, and the compass refusing to point at two POIs you have not found.
2. **Silent deletion.** From that state, find `fossilbed` (Fossil Rock only) and
   switch back to Liwa. `loadProgress` drops `fossilbed`, because it is not a
   Liwa kind. The next discovery in Liwa calls `saveProgress`, which writes the
   filtered in-memory set back over the key. `fossilbed` is now gone from disk
   permanently.

The fix is a region-scoped key (`dune.progress.v1.${regionId}`) or storing a
`Record<RegionId, PoiKind[]>`. The test is about ten lines against a `Map`-backed
`localStorage` stub, and it is the single highest-value test in this document —
this is earned player state being destroyed.

### 3.2 The majlis card has been showing a placeholder for its whole life

`POI_INFO.majlis.photo` is `'/photos/majlis.jpg'`. The file on disk is
`public/photos/majilis.jpg` — `majilis`, with the `i` transposed. The request
404s.

Nobody noticed because `PoiCard` has a deliberate graceful fallback
(`src/ui/PoiCard.ts:67`): on image error it retries `.svg`, and `majlis.svg`
exists. So the card renders the in-palette placeholder postcard and looks
entirely intentional. The real photograph has never been seen.

That fallback is good design, and it is exactly why this needs a test rather
than an eyeball: the failure mode was built to be invisible. A test that walks
`POI_INFO`, and every per-POI `info` override, and asserts each `photo` path
exists under `public/`, is about six lines and catches every future typo too.

### 3.3 Two pairs of Fossil Rock POIs have overlapping trigger radii

Computed from the coordinates in `src/data/fossilRockPois.ts`:

| Pair | Distance | Sum of radii | Overlap |
|---|---|---|---|
| `fossilbed` ↔ `famousdune` | 120 m | 175 m | 55 m |
| `ghaf` ↔ `cameltrack` | 104 m | 160 m | 56 m |

`Director.update` returns after firing one POI, and the `subtitles.busy` guard
stops the second talking over the first — so this is not garbled output. What it
does mean is that standing in one spot discovers two POIs, and because the POI
loop sits *above* the `cooldown` check (`src/narrative/Director.ts:134` vs `:143`),
POI call-ins bypass the cooldown entirely: Ahmed signs off from the first and
immediately keys back up for the second. §5 asks for dialogue that is "sparse and
ambient"; back-to-back call-ins from a standing start is the opposite of that.

Liwa and Al Badayer are clean. A test asserting no two POIs in a region have
overlapping radii is four lines and makes this a build failure rather than a
thing someone eventually notices.

### 3.4 `callPoi` will emit `undefined` if a POI ships with no lines

`src/narrative/Director.ts:319` reads `poi.lines[0]` with no guard. All 30 POIs
currently have at least one line, so this is latent rather than live — but it is
one careless data edit from putting the literal string `undefined` on screen as
a radio subtitle. It belongs in the same data-invariant sweep as 3.2 and 3.3.

## 4. Proposed priorities

Ranked by defect-caught-per-line-of-test. Everything in tiers 1–3 runs in Node
with no browser, no WebGL, and no Rapier.

### Tier 1 — Data invariants *(highest value, lowest cost)*

Three of the four defects above are data problems, as was the shipped
arrival-card bug. This is one file, perhaps 120 lines, iterating `REGIONS`:

- Every POI resolves a card, and the resolved title is not another region's
  (this is precisely the `5a8fb44` regression).
- Every `photo` path in `POI_INFO` and in every per-POI `info` override exists
  on disk under `public/`.
- Every POI has `lines.length >= 1`.
- No two POIs in a region have overlapping radii.
- Every POI sits inside `WORLD_HALF`.
- `AHMED_LINES` has a non-empty pool for all 15 `LinePool` keys; `AHMED_VEHICLE_LINES`
  covers all 7 `BodyId`s; `AHMED_REGION_LINES` covers all 3 `RegionId`s.
- No duplicate lines within a pool — a duplicate defeats the retire-and-recycle
  rule in §13, and re-reading a 30-line pool by eye at each edit does not scale.

Content is added to this game constantly, by hand, in parallel across three
regions. This tier turns the most common failure mode in the repo into a build
error.

### Tier 2 — Persistence and migration

`loadSettings` is 75 lines of hand-written per-field validation
(`src/settings/Settings.ts:109`) and `loadProgress` is the source of §3.1.
Both are pure functions of a string, so they need nothing but a `localStorage`
stub.

- The §3.1 round trip: discover in region A, switch to B, switch back, assert
  nothing was lost and nothing was falsely credited.
- Corrupt input: `loadSettings` on `"{"`, `"null"`, `"[]"`, and on a blob whose
  every field has the wrong type, returns defaults and does not throw.
- Out-of-range numerics clamp (`volume: 40` → `1`, `textScale: -3` → `0.8`).
- Retired enum values fall back rather than putting the game into a scheme that
  no longer exists.
- `sanitizeVehicleConfig` drops an unknown `body` — the comment at
  `vehicleConfig.ts:333` says shipping one leaves "the player with an invisible
  truck", which is a hard failure with no in-game recovery.
- The documented aliasing hazard at `Settings.ts:106`: mutating the loaded
  `vehicle` must not write through to `DEFAULT_VEHICLE`.
- The `handedness: 'right'` → `joystickPosition` migration still fires for a
  pre-`joystickPosition` save.

That last one matters because `STORAGE_KEY` is already at `v3`. There is real
migration logic here, and migration logic is only ever exercised by players who
have the old blob — never by whoever is developing.

### Tier 3 — Terrain field and pure vehicle maths

`src/terrain/height.ts` is 930 lines, explicitly documented as "deterministic and
side-effect free", and it is the ground truth that physics, rendering and the
traction model all read. It is the most consequential pure module in the repo and
the natural home for property-based assertions:

- `hash2` — mean ≈ 0.5 over a large sample, range within `[0, 1)`, well
  distributed across buckets. **This is the regression test for the bug the file
  already documents at line 55.**
- `clamp01` and `smoothstep` at and beyond their edges; `smoothstep` when
  `edge0 === edge1` (currently a divide by zero → `NaN` propagating into the
  height field).
- `heightAt` returns finite values across a dense grid in all three regions —
  `NaN` here becomes a hole in the world and a physics explosion.
- Determinism: same input, same output, and stable across a `refreshRegion()`
  round trip.
- The angle-of-repose guarantee the file's header claims by construction:
  sample gradients across a region and assert nothing exceeds ~33° outside the
  regions explicitly allowed to.
- `timeBand` (`Director.ts:370`) is documented as gapless — assert that directly
  by sweeping `t` from `-2` to `+2`, which also covers the negative-modulo
  normalisation.
- `crestNear`, `softnessAt`, `surfaceAt` return in-range values.
- `mergeAxle` (`twoWheeled.ts`) — the merged normal is unit length, and a merged
  contact requires both wheels down. This is the `7afe2ac` regression.
- `pressureAxis` / `psiAt` / `softnessScale` are monotonic across the three
  pressure steps, and `pressureTuning` moves grip, drag and climb bleed in the
  directions the docblock promises.

### Tier 4 — Physics/render agreement *(one test, disproportionate value)*

`buildChunkGeometry` (render) and `buildChunkHeightSamples` (physics) sample
`heightAt` independently, at different resolutions, with different index
orderings — `[iz + ix * (n+1)]` versus `[ix * (n+1) + iz]`. If those ever
disagree, the car drives on ground that is not the ground you can see, which is
a whole-game bug that no unit test of either function alone would find.

One test: build both for the same chunk at `PHYSICS_RESOLUTION` and assert they
agree at every shared sample. Note that the render path also applies LOD-seam
stitching, so the assertion needs to be made against `FLAT_EDGES`.

### Explicitly not worth testing

Being clear about this so the tiers above don't drift into a coverage-percentage
exercise:

- Three.js scene construction. Asserting that `createLandmarks()` returns a
  `Group` with 47 children tests nothing anyone cares about and breaks on every
  art change.
- Rapier stepping. Integration-level, slow, and the tuning targets are "feels
  heavy and satisfying" (§2) — that is a playtest, not an assertion.
- DOM layout in `src/ui/`. Would need jsdom for weak assertions about markup
  that changes constantly.
- Audio graph wiring. Needs a `WebAudio` mock to verify very little.

The line is roughly: **test the things that can be silently, factually wrong.**
Not the things that can only look bad.

## 5. Tooling

Vitest, because Vite is already the build tool — it reuses `vite.config.ts` and
resolves the existing TypeScript and ESM setup with no extra configuration.

```
npm i -D vitest
```

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "build": "tsc --noEmit && vitest run && vite build"
}
```

Tiers 1–3 need no environment beyond Node; only the persistence tests need a
`localStorage` stub, which is about eight lines of `Map`. No jsdom, no browser,
no WebGL, no headless Chrome.

Then a GitHub Actions workflow on push and PR running `tsc --noEmit` and
`vitest run`. Vercel already builds preview deployments per branch, so the CI
job is purely the correctness gate the pipeline currently lacks.

## 6. Suggested sequence

| Step | Work | Catches |
|---|---|---|
| 1 | Vitest + CI workflow | — (enables everything else) |
| 2 | Tier 1 data invariants | §3.2, §3.3, §3.4, and the `5a8fb44` class |
| 3 | Fix §3.1, with the round-trip test that proves it | destroyed player progress |
| 4 | Tier 2 persistence and migration | corrupt/legacy saves, invisible truck |
| 5 | Tier 3 terrain and vehicle maths | the `hash2` class, `NaN` in the world |
| 6 | Tier 4 physics/render agreement | invisible-ground divergence |

Steps 1–3 are the ones that pay for themselves immediately: they are perhaps a
day of work, they fix live defects, and they put a gate in front of the kind of
content edit this project makes most often.
