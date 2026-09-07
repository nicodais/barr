---
title: "Product Brief: Shamal"
status: final
created: 2026-09-07
updated: 2026-09-07
---

# Product Brief: Shamal (شمال)

## Executive Summary

Shamal is a relaxing, open-world dune-bashing driving game for the browser, set in a
fictionalized stretch of UAE desert. It plays in the visual and tonal tradition of
*Firewatch*: flat-shaded low-poly art, golden-hour light, an oud-led ambient score, and
a loose, text-only radio narrative from Ahmed, a good-natured, weary local police
officer keeping half an eye on the dune-bashing traffic. There is no combat, no lap
timer, no damage model, and no fail state — the player drives a Nissan Patrol-inspired
4x4 across a large stylized dune landscape at their own pace, guided only by curiosity
and Ahmed's occasional check-ins. The goal is decompression, not challenge.

What makes Shamal worth building is the combination of two things that rarely appear
together: a physics-driven off-road feel with real weight transfer, suspension travel,
and damage-free rollover risk (the tactile core of actual dune bashing), delivered
entirely in a browser tab with no install and no engine license. `[ASSUMPTION]` The
project exists first as a solo passion/craft project — a chance to do right by a
specific place and a specific low-key cultural voice (Emirati English, a working cop,
not a tour guide) rather than the generic desert-level dressing games usually reach for.

`[ASSUMPTION]` This brief is written retroactively: as of 2026-09-07 the project is
already well past prototype. Per `BACKLOG.md`, 17 of 20 tracked backlog items are
shipped, three full regions exist (Liwa, Fossil Rock, Al Badayer), and the vehicle
physics, audio, narrative, accessibility, and adaptive-quality systems described below
are implemented and playable, not merely planned. Its purpose is to give the existing
build a durable planning spine — PRD, architecture, epics/stories — that downstream
BMad work and AI coding agents can build against consistently, not to pitch a new idea.

## The Problem

Two related gaps, both `[ASSUMPTION]` since no formal user research exists yet:

- **The genre gap.** Driving/off-road games mostly sit at one of two poles: hardcore
  simulation (BeamNG-depth damage and tuning) or arcade action (races, scores, timers,
  crashes-as-spectacle). There is very little in the "walking-sim energy, but you're
  driving" space that *Firewatch*, *A Short Hike*, or *Proteus* occupy for on-foot
  exploration — a game whose entire point is that nothing is testing you.
- **The representation gap.** The UAE desert and dune-bashing culture — a real,
  widely-practiced local pastime — rarely appears in games except as generic sand-level
  dressing for a military shooter or a racer, stripped of any specific voice or place.
  Players who know this landscape have nothing built with the same care a Wyoming
  fire lookout got in *Firewatch*.

The cost of the status quo is not urgent or financial — nobody is losing money to this
gap — it is an absence: a decompression game set here, with this tone, does not exist
yet, and the people who would want it (both the ambient-game audience and a Gulf
audience who'd recognize the specifics) have no equivalent to point to.

## The Solution

A single large (~4-6km² per region), curated dune-heightfield world per region, driven
in a low-poly 4x4 with a Rapier-based vehicle controller tuned for weight transfer,
per-wheel suspension, sand traction, and momentum-dependent climbing (see
`CLAUDE.md` §2 for the full physics brief — this is treated as the single most
important system in the game). Seven hand-placed points of interest per region mix
grounded/historical beats (an old falaj, a watchtower ruin, an abandoned campsite) with
playful ones (Ahmed's actual tea stand, an Instagram-famous dune), so the world has
texture without becoming a checklist. Ahmed's radio calls — static cue, scrolling
subtitle-style text, no voice acting — deliver a loose, non-blocking narrative layer
keyed to region, vehicle, time of day, and player state (idle, fast driving, POI
proximity), pulling from category-based line pools rather than a linear script.

Photo mode, adaptive quality (device-tier detection plus a runtime fps auto-adjust),
and full keyboard/gamepad/touch input support round out the experience so it holds up
across desktop and mobile browsers without a separate build.

## What Makes This Different

- **No fail state, played straight.** Rollover, getting stuck in soft sand, and hard
  landings are all real physical events with real consequences for *momentum and
  line-choice*, but zero consequence for *progress* — no damage model exists anywhere
  in the game (`CLAUDE.md` §2, §11). Most games that claim "no fail state" also flatten
  the physical stakes; Shamal keeps the tension (the game reads as "whoa, okay," not
  "nothing happened").
- **Real weight underneath an arcade-forgiving surface.** The tuning target is
  explicitly Forza Horizon-offroad-inspired, not BeamNG-sim, but with genuine
  suspension/traction simulation under the hood rather than a flat-plane racer with a
  height-mapped floor.
- **Zero-install, browser-native, and still physically simulated.** Three.js + Rapier
  (WASM) in a static Vite build deployed to Vercel — no engine license, no app-store
  gate, shareable as a link. `[ASSUMPTION]` This is the unfair advantage as much as
  anything creative: most games with this level of physical simulation are downloads.
- **A specific, respectful voice, not scenery.** Ahmed's dialogue rules (§13 of
  `CLAUDE.md`) explicitly forbid "funny because foreign" humor — jokes land on
  specificity (a real place, a real complaint about the job) not on the accent or the
  Arabic. This is an execution discipline, not a technical moat, and the brief says so
  plainly rather than dressing it up as one.
- **Honest, not polished-first.** `BACKLOG.md` is unusually candid about premises that
  turned out wrong once measured (three separate backlog items record "the premise was
  wrong" after instrumenting the actual behavior) — the project prioritizes measuring
  real behavior over assuming it, which is itself a differentiator in how it's built.

## Who This Serves

**Primary:** players who already seek out *Firewatch*, *A Short Hike*, *Proteus*, and
similar decompression/ambient games — people who want a beautiful place to be in, not a
task to complete. Success for them looks like an unstructured 5–45 minute session that
ends because they chose to stop, not because anything ran out.

**Secondary:** `[ASSUMPTION]` a Gulf/UAE audience (and diaspora) who recognize the
specifics — Liwa, Al Ain, the falaj system, dune-bashing itself as a genuine local
pastime — and haven't seen it treated with this much care in a game before. Success for
them looks like recognition ("that's actually how it feels/sounds") rather than mere
representation.

**Tertiary:** people curious about dune bashing who've never done it — the game as a
low-stakes preview of a real activity.

## Success Criteria

`[ASSUMPTION]` — no formal metrics exist yet; these are inferred from the project's
own stated priorities (CLAUDE.md §2, §10) and framed for a solo-dev, low-ceremony
context rather than a funded product with growth targets:

- **Driving feel bar:** playtesters (even informal ones) describe cresting a dune,
  sliding in soft sand, and rolling over in terms that match the design intent —
  "whoa, okay," weight, momentum — without being prompted. This is the gate
  `CLAUDE.md` §2 already treats as blocking all other work.
- **Device validation closes.** Backlog item 6 — "play it on a real phone" — is
  currently the single highest-priority open item, explicitly blocked on hardware
  rather than effort. Success includes actually running the game on a real
  ~2-year-old phone and confirming the 60fps mobile target (§8) and the sand/rollover
  feel hold up outside a software-rendered dev machine.
- **It gets shared.** Photo mode output (or just the link itself) gets sent by someone
  outside the project to someone else, unprompted.
- **The build stays honest.** `BACKLOG.md`'s practice of recording when a premise
  turned out wrong continues — a soft, process-level signal that the project is still
  measuring rather than assuming.

## Scope

**In, and already largely shipped** (per `BACKLOG.md`, 17/20 items done):
- Full vehicle physics per `CLAUDE.md` §2: weight transfer, per-wheel suspension, sand
  traction, momentum-dependent climbing, damage-free rollover.
- Three regions — Liwa, Fossil Rock, Al Badayer — each with distinct dune character and
  7–11 POIs.
- Ahmed's radio narrative system: region-, vehicle-, and time-of-day-aware line pools.
- Photo mode, adaptive quality tiers, full keyboard/gamepad/touch input, an
  accessibility pass (reduced-motion, screen-reader live region, UI text scaling,
  high-contrast option).
- Daytime world traffic (roaming vehicles as dust plumes), a day/night cycle with
  auto-advance.

**In, still open:**
- Real-device validation on mobile (backlog item 6) — the current top priority.
- Whatever the architecture/epics passes below surface as gaps against `CLAUDE.md`.

**Explicitly out** (per `CLAUDE.md` §11 and `BACKLOG.md`'s "not on this list"):
- Multiplayer, damage-based fail states, scoring/leaderboards.
- A native app wrapper (browser-only for v1).
- Photoreal/PBR rendering — the flat-shaded look is a commitment, not a placeholder.
- Licensed/official Nissan assets — the Patrol Super Safari is a visual reference only.
- Cockpit camera and true per-body vehicle footprint (backlog items 11–12) — both
  identified as large, parked, and "worth doing only if more vehicles are the plan,"
  i.e. deliberately deferred pending a scope decision, not forgotten.

## Vision

`[ASSUMPTION]` — CLAUDE.md does not state a 2-3 year vision explicitly; this extends
its stated trajectory rather than inventing a new one. If the driving feel and Ahmed's
voice land, Shamal grows by adding more curated regions in the same disciplined,
measure-then-ship style `BACKLOG.md` already models, rather than by adding systems
(scoring, progression, multiplayer) the design explicitly rejects. A believable next
horizon: a small roster of additional vehicle silhouettes (once backlog item 12's
per-body footprint work is worth doing), a cockpit camera view, and enough regions that
picking where to drive today becomes its own small ritual — while staying exactly as
small, install-free, and fail-state-free as it is now.
