# Test coverage: what was wrong, and what now guards it

> **Status: implemented.** This began as an analysis of a codebase with no
> tests. Everything in §4 has since been built and everything in §3 fixed —
> `npm test` runs 225 tests across 8 files in about 1.5 seconds. §1 and §2
> describe the situation that motivated the work and are kept as the rationale;
> §7 records what shipped.

## 1. The state of play, before this

There were no tests. Not "thin coverage" — zero test files, zero test
dependencies, zero CI.

| | |
|---|---|
| Test files | 0 |
| Test framework | none in `package.json` |
| CI workflow | no `.github/` directory |
| Only automated gate | `tsc --noEmit`, via `npm run build` |
| TypeScript under `src/` | ~19,000 lines across 74 files |

`tsc` is a real gate and it passed clean, but it only checks that types line up.
Every behavioural claim in this codebase — that the sand grips the way §2 says,
that Ahmed doesn't repeat himself, that a save from last week still loads — was
unverified except by driving the game and looking.

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

## 3. Five live defects found while writing this

To check that the argument above isn't theoretical, here is what a few hours of
reading turned up in code that was on `main`. All five are now fixed, each with
the test that fails without the fix.

### 3.1 Progress is shared across regions, and switching regions deletes it *(fixed)*

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

**Fixed** by scoping the key: `dune.progress.v2.${regionId}`, so the two deserts
cannot see each other's saves at all. The per-region id filter stays, because it
is still the right defence against a stale blob naming a retired POI. A legacy
`v1` blob is migrated once into whichever region the player last left off in —
which is what `activeRegion()` reports at first load, since settings restore the
region before progress loads — and then removed.

`tests/progress.test.ts` covers both halves. Against the old implementation five
of its nine cases fail, including `expected 2 to be +0` for the false credit and
`expected [] to deeply equal [ 'fossilbed', 'tomb' ]` for the deletion.

### 3.2 The majlis card has been showing a placeholder for its whole life *(fixed)*

`POI_INFO.majlis.photo` is `'/photos/majlis.jpg'`. The file on disk is
`public/photos/majilis.jpg` — `majilis`, with the `i` transposed. The request
404s.

Nobody noticed because `PoiCard` has a deliberate graceful fallback
(`src/ui/PoiCard.ts:67`): on image error it retries `.svg`, and `majlis.svg`
exists. So the card renders the in-palette placeholder postcard and looks
entirely intentional. The real photograph has never been seen.

That fallback is good design, and it is exactly why this needed a test rather
than an eyeball: the failure mode was built to be invisible.

**Fixed** by renaming the file to `majlis.jpg` — the reference was spelled
correctly and matches the `PoiKind`, as every other photo does. Guarded by
`tests/poiData.test.ts`, which walks `POI_INFO` and every per-POI `info`
override and asserts each `photo` path exists under `public/`.

### 3.3 Two pairs of Fossil Rock POIs have overlapping trigger radii *(fixed)*

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

Liwa and Al Badayer are clean.

**Fixed** by moving two POIs rather than shrinking their triggers — the radius
is how prominent a landmark is, and a smaller one is a worse answer than a
better position. The Ramp moves onto the sculpted ramp's eastern flank at
(-10, -190) instead of sitting in the gap between it and the rock, and the Old
Race Track moves to (-300, 620), which also takes it off the flank of the
sculpted dune at (-520, 430) — a camel track wants the flat. Guarded by an
all-pairs assertion in `tests/poiData.test.ts`.

### 3.4 `callPoi` will emit `undefined` if a POI ships with no lines *(fixed)*

`src/narrative/Director.ts:319` reads `poi.lines[0]` with no guard. All 30 POIs
had at least one line, so this was latent rather than live — but it was one
careless data edit from putting the literal string `undefined` on screen as a
radio subtitle.

**Fixed** by returning early on an empty pool. The discovery still counts — the
compass and the counter are driven by the visit, not by Ahmed — he just has
nothing to say. The data-invariant sweep asserts a non-empty pool as well, so
the content bug is caught even though it can no longer reach the screen.

### 3.5 `smoothstep` returns `NaN` for a degenerate window *(fixed)*

Found by the test written for it, which is the honest way to report it.
`smoothstep(edge0, edge1, x)` divides by `edge1 - edge0`. Off the window the
resulting infinities clamp to 0 and 1 correctly, but at `edge0 === edge1 === x`
it is 0/0, and `clamp01` passes `NaN` straight through.

Nothing in the tree currently calls it with equal edges. But the edges are
frequently region-derived tuning numbers, and a `NaN` from this function lands
in the height field as a hole in the world and a physics explosion — from two
values a region author happened to set equal. **Fixed** by collapsing the
degenerate case to the step it is already reaching for: `x < edge0 ? 0 : 1`.

## 4. The tiers, as built

Ranked by defect-caught-per-line-of-test. Everything in tiers 1–3 runs in Node
with no browser, no WebGL, and no Rapier.

### Tier 1 — Data invariants *(highest value, lowest cost)*

`tests/poiData.test.ts` and `tests/ahmedLines.test.ts`, 104 cases.

Three of the five defects above are data problems, as was the shipped
arrival-card bug. Iterating `REGIONS`:

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

`tests/progress.test.ts` and `tests/settings.test.ts`, 36 cases, against the
`Map`-backed stub in `tests/localStorageStub.ts`.

`loadSettings` is 75 lines of hand-written per-field validation
(`src/settings/Settings.ts:109`) and `loadProgress` was the source of §3.1.
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

`tests/terrain.test.ts` and `tests/vehicleMaths.test.ts`, 45 cases.

`src/terrain/height.ts` is 930 lines, explicitly documented as "deterministic and
side-effect free", and it is the ground truth that physics, rendering and the
traction model all read. It is the most consequential pure module in the repo and
the natural home for property-based assertions. These are deliberately property
assertions over a sampled grid rather than golden values — pinning the terrain to
a fixed output would break on every legitimate tuning change and teach everyone
to regenerate the fixture without reading it:

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

`tests/chunkAgreement.test.ts`, 32 cases.

`buildChunkGeometry` (render) and `buildChunkHeightSamples` (physics) sample
`heightAt` independently, at different resolutions, with separately written
coordinate arithmetic — one walks out from the chunk origin, the other from its
centre. (They index identically: `[iz + ix * (n+1)]` and `[ix * (n+1) + iz]` are
the same expression written two ways. It is the world coordinates that could
drift, not the layout.) If those ever disagree, the car drives on ground that is
not the ground you can see, which is a whole-game bug that no unit test of
either function alone would find.

One test: build both for the same chunk at `PHYSICS_RESOLUTION` and assert they
agree at every shared sample. The render path also applies LOD-seam stitching,
so the assertion is made against `FLAT_EDGES`.

They currently agree bitwise, across five chunks in all three regions. Perturbing
the physics sampler by half a metre fails all fifteen. A companion assertion ties
both back to `heightAt` itself — agreeing with each other but not with the world
would still be wrong — and it compares through `Math.fround`, since both builders
store into a `Float32Array` while `heightAt` computes in float64. That narrowing
is the storage format, not a disagreement about where the ground is.

The file also covers the watertight-seam claim in `buildChunkGeometry`'s
docblock: neighbouring chunks' shared edge vertices must be bitwise identical, or
the boundary shows as a hairline crack and prints a dashed shadow along itself.

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

One consequence worth naming: `InputManager` is not directly constructible in
Node, because the sources it owns reach for `window` on the way up. Rather than
pull in jsdom for it, `tests/inputManager.test.ts` reproduces the aggregation
rule against injected fake sources — gamepad wins when in use, otherwise the last
active source keeps control, and an idle-but-settling source keeps writing so
releasing a key doesn't snap the wheel straight. That rule is the part worth
pinning; the DOM plumbing around it is not.

## 5. Tooling, as set up

Vitest, because Vite is already the build tool — it resolves the existing
TypeScript and ESM setup with no extra configuration.

`vitest.config.ts` is kept separate from `vite.config.ts` so the app build never
carries the test config, and so the manual vendor chunking there cannot affect
how tests resolve `three` or Rapier. Everything under `tests/` runs in the
`node` environment.

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
  "build": "npm run typecheck && vitest run && vite build"
}
```

The type-check is split across two configs on purpose. The root `tsconfig.json`
still covers `src` alone with `types: ["vite/client"]`, so the game stays
strictly browser-typed and importing a node builtin from `src/` remains a type
error. `tsconfig.test.json` extends it for `tests/`, adding `vitest/globals` and
`node` — the POI suite legitimately reads `node:fs` to check that the files the
cards point at are really on disk.

No jsdom, no browser, no WebGL, no headless Chrome. The only environment shim is
`tests/localStorageStub.ts`, a `Map` behind the `Storage` interface with a
`failWrites` flag standing in for Safari private mode.

`.github/workflows/ci.yml` runs `npm run typecheck` and `npm test` on pushes to
`main` and on every pull request. It deliberately does not build — Vercel already
does that per branch; CI is the correctness gate that was missing.

## 6. What this catches

Each fix was verified by reverting it and watching the suite go red, rather than
by assuming the test would have caught it:

| Reverted | Result |
|---|---|
| `majilis.jpg` filename | 2 failures — `The Ruler's Majlis photo missing: /photos/majlis.jpg` |
| Fossil Rock POI positions | 1 failure — `The Fossil Bed overlaps The Ramp by 55m` |
| Region-scoped progress key | 5 failures, incl. `expected 2 to be +0` and `expected [] to deeply equal [ 'fossilbed', 'tomb' ]` |
| `smoothstep` degenerate guard | 1 failure — `NaN` at `edge0 === edge1 === x` |
| Physics sampler offset by 0.5 m | 15 failures across all three regions |

## 7. What shipped

| | |
|---|---|
| Test files | 8, plus one stub helper |
| Tests | 225 |
| Runtime | ~1.5 s |
| Environment | Node only |
| CI | typecheck + tests, on push to `main` and every PR |

Files:

```
tests/poiData.test.ts        POI bounds, distinct kinds, lines, radii, cards, photos
tests/ahmedLines.test.ts     pool coverage, duplicates, one-liner rule
tests/progress.test.ts       the §3.1 round trip, legacy migration, corrupt blobs
tests/settings.test.ts       validation, clamping, enum fallback, v3 migration, aliasing
tests/terrain.test.ts        hash2 distribution, smoothstep edges, field invariants
tests/vehicleMaths.test.ts   timeBand, mergeAxle, tyre pressure monotonicity
tests/chunkAgreement.test.ts physics/render agreement, watertight seams
tests/inputManager.test.ts   source aggregation and steering inversion
tests/localStorageStub.ts    the Map behind Storage
```

Not done, and deliberately left: the driving feel itself (§2) is a playtest, and
nothing here attempts to assert it.
