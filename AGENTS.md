<!-- bmad:context -->
<!-- Verified 2026-09-07 against d5dcc3d. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Shamal

Browser dune-bashing driving game. TypeScript, Three.js + Rapier
(`@dimforge/rapier3d-compat`), Vite, deployed to Vercel. Full creative/product
vision (tone, physics feel target, Ahmed's dialogue rules) lives in `CLAUDE.md` at
the repo root — read it before touching vehicle feel, world design, or narrative
content; this block does not restate it. BMad planning artifacts (PRD, architecture
spine, UX spines, epics/stories, sprint status) live under
`_bmad-output/planning-artifacts/` and `_bmad-output/implementation-artifacts/`.

## Where things are

- Composition root: `src/engine/Game.ts` constructs and wires every other system
  (vehicle, world, terrain, audio, narrative, ui, input, settings) — a new system
  gets wired there, not self-registered.
- Architecture invariants (module boundaries, ownership rules):
  `_bmad-output/planning-artifacts/architecture/architecture-shamal-2026-09-07/ARCHITECTURE-SPINE.md`
- Remaining/open work and its status: `_bmad-output/planning-artifacts/epics.md` and
  `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Running and verifying

- `npm run build` runs `tsc --noEmit && vite build` — typecheck gates the build;
  `vite build` alone skips it.
- No test suite exists (`package.json` has no `test` script) — don't assume
  `npm test` runs anything.
- `npm run dev` starts the Vite dev server.

## Conventions that differ from defaults

- Sibling systems (`vehicle/`, `world/`, `terrain/`, `audio/`, `narrative/`, `ui/`,
  `input/`, `settings/`) may only `import type` from each other's public shapes,
  never import another's class/instance directly — only `engine/Game.ts` may
  construct and call into them.
- Only `settings/Settings.ts` and `settings/Progress.ts` read/write the shared
  `GameSettings`/`Progress` `localStorage` keys; a module needing its own local
  persisted state uses a private, uniquely-prefixed key instead.
- Only `engine/Game.ts`'s render loop calls `RAPIER.World.step()` — nothing else
  steps or owns a second physics clock.

## Known pitfalls

- Rapier's `setWheelBrake` takes an impulse, not a force (unlike
  `setWheelEngineForce`, which Rapier scales by the timestep internally) — passing
  newtons straight in applies them ~60x over and dumps angular momentum into a
  nose-over.
- CSS `columns: 2` inside a `max-height` scroll container fragments content into
  columns placed off-screen to the side rather than reflowing — use CSS Grid for
  multi-column panels instead.
- `THREE.InstancedMesh.instanceColor` is RGB only and cannot carry alpha — scaling
  color under normal blending to fake transparency renders solid dark shapes instead
  of fading; use a real per-instance alpha attribute.

<!-- /bmad:context -->
