# Project: DUNE (working title)

A relaxing open-world dune-bashing driving game for the browser (desktop and mobile web, responsive), in the visual and tonal tradition of *Firewatch* — but set in the UAE desert. No combat, no fail states, no timers. The player drives across a vast stylized dune landscape while an oud-led ambient score plays and an occasional radio call-in from Ahmed — a good-natured, weary local police officer — gives the world texture. The goal is decompression, not challenge.

---

## 1. Core Concept

- **Genre:** Open-world driving / walking-sim adjacent ("driving-sim")
- **Mood:** Meditative, warm, unhurried. Golden-hour light, wind over sand, engine hum, oud strings.
- **Setting:** A fictionalized stretch of UAE desert — dunes, wadis, the occasional distant landmark (pylons, a Bedouin camp silhouette, oil-road strip, mountains at the horizon like Hajar). Not a licensed real-world map; inspired by Liwa/Al Ain/Sharjah backcountry.
- **Player fantasy:** You're alone (or nearly alone) in a 4x4, dune bashing at your own pace, guided loosely by radio call-ins from Ahmed and your own curiosity.
- **No fail state.** No lap timer, no damage model that ends a run, no enemies. Getting stuck in soft sand is a *moment*, not a punishment — reverse and rock out of it.

---

## 2. Vehicle Physics & Driving Feel — Core Value

This is the single most important system in the game. Everything else (art, audio, narrative) supports the feeling of driving; if this feels wrong, nothing else compensates. Budget prototype time accordingly (see §10, phase 1) and don't move to world/art/narrative passes until this feels right.

**Fidelity target:** arcade-forgiving, Forza Horizon-offroad inspired — accessible and fun to pick up immediately, but with *real* weight-transfer and suspension behavior underneath so dunes feel physically convincing rather than like a flat-plane racer with a height-mapped floor. Not a full sim (not BeamNG-depth), but not weightless either.

**Vehicle:** modeled after a **Nissan Patrol Super Safari** — boxy, high-clearance, live-axle-era silhouette. This is a visual reference for the low-poly model (proportions, stance, wheel arches, roofline), not a licensed asset; model it independently in the flat-shaded style rather than using any official Nissan 3D assets, badging, or trademarked design files.

**Core physics requirements:**
- **Weight transfer:** visible body roll on sidehills and cresting dunes, nose-dip under braking, squat under acceleration. This is the main thing that sells "big, heavy 4x4" over "go-kart with a skin."
- **Suspension travel:** generous wheel articulation over uneven dune faces — wheels should visibly hang and compress independently (Rapier's vehicle controller with per-wheel raycast/suspension) rather than the body rigidly following terrain average.
- **Sand traction model:** distinct from hard-pack — wheels sink slightly and lose grip progressively on steep/soft faces, momentum matters more than steering input at speed (you drift wide on loose sand, not carve tight lines). Traction should vary by dune-face steepness and a simple "softness" value per terrain chunk, not be uniform everywhere.
- **Momentum on dune faces:** climbing a steep face bleeds speed fast and can stall the climb if you don't carry enough run-up — a real dune-bashing skill (reading the dune, picking your line, carrying momentum) should translate into the driving feel, not be abstracted away.
- **Sidehill/rollover risk — real mechanic, no damage:** driving across a steep dune face at an angle should generate genuine tip/rollover risk (body roll pushed far enough triggers an actual rollover), because that tension is core to the dune-bashing fantasy. Critically: **rollover has zero damage consequence.** On rollover, auto-flip the vehicle upright after a short beat (with a bit of dust FX and maybe a wry Ahmed line queued for later), reset it gently on its wheels, and let the player keep driving immediately. The moment should read as "whoa, okay" — never as a fail state, penalty, or progress loss.
- **No damage model at all, in any scenario:** no dents, no mechanical failure, no need to visit a "repair" anything. This keeps rollover, hard landings, and rock scrapes purely tension-and-release rather than punishing.
- **Airtime:** cresting a dune at speed should be able to produce brief, satisfying airtime with visible suspension compression on landing — floaty enough to feel good, not so floaty it feels disconnected from weight.

**Tuning philosophy:** favor "feels heavy and satisfying" over "feels accurate." Iterate primarily by feel/playtesting once the base Rapier vehicle controller is in (raycast wheels, per-wheel suspension spring/damper, simple slip-based tire model), not by chasing real-world suspension specs.

---

## 3. Platform & Tech Stack

- **Engine:** Three.js (WebGL), running directly in the browser — no native wrapper. Ships as a static site (HTML/CSS/JS bundle), deployed to **Vercel**.
- **Physics:** Rapier (via `@dimforge/rapier3d-compat` WASM build) for vehicle dynamics and terrain collision — chosen over Cannon.js for better vehicle-suspension support and solid WASM performance across desktop and mobile browsers.
- **Responsive target:** desktop browsers (Chrome, Safari, Firefox, Edge) and mobile browsers (Safari iOS, Chrome Android), 60fps target on desktop, graceful degrade on mobile (see §8). Layout and control scheme adapt to viewport/input capability at runtime rather than being a separate build.
- **Audio:** Web Audio API, layered ambient system (see §6).
- **Persistence:** `localStorage` for settings, unlocked waypoints, photo-mode capture metadata.
- **Language:** TypeScript throughout. No framework (React/Vue) needed for the 3D layer — vanilla TS + Three.js, bundled with Vite. A thin DOM/CSS layer for menus/HUD is fine (plain HTML/CSS, no framework, to keep things light and dependency-free).
- **Build/dev tooling:** Vite for local dev server + bundling — fast iteration, static build output deployed to Vercel (zero-config for a Vite static site; connect the repo and ship on push).

---

## 4. Visual Style

- **Firewatch-literal direction:** low-poly, flat-shaded geometry, no PBR realism. Large flat color fields, baked ambient occlusion via vertex color or simple gradient shaders, warm limited palette (ochre, rust, dusty rose, deep indigo shadows).
- **Lighting:** single dominant directional light (sun) + soft sky ambient. Time-of-day system biased toward golden hour and blue hour — the "always slightly magic hour" look, like Firewatch's forest.
- **Dunes:** procedurally generated heightfield terrain, low-poly faceted shading (flat normals per triangle, not smoothed) so dune ridges read as crisp graphic shapes, not photoreal sand.
- **Skybox:** gradient-based procedural sky (not a photo skybox) to match the flat-shaded illustration language.
- **Vehicle:** a single well-modeled low-poly 4x4, styled after a Nissan Patrol Super Safari (boxy proportions, high clearance, live-axle stance — see §2 for the full physics/reference brief) with a small dust/sand particle trail (billboarded sprites, not full particle sim, for perf).
- **UI:** minimal, diegetic where possible (a dashboard compass, a CB-radio-style call indicator) rather than menu-heavy HUD.

---

## 5. World & Gameplay Loop

- **World structure:** one large seamless heightfield region (~4–6km²) rather than procedurally infinite — curated with 7 hand-placed points of interest (POIs) for v1, mixing grounded/historical spots with a couple of playful ones so the world has texture without turning into a checklist:
  1. **The Old Falaj** — a stretch of ancient irrigation channel, half-buried, poking out of the sand where you'd least expect water ever ran.
  2. **Ghaf Tree Ridge** — a lone, genuinely old ghaf tree (UAE's national tree) improbably still alive on a high ridge, the only shade for kilometers.
  3. **The Watchtower Ruin** — a crumbling old stone watchtower on a rocky outcrop, once used to watch for raiders, now just watching 4x4s get stuck.
  4. **Old Campsite Ruins** — fire-ring stones and flattened ground from a long-abandoned Bedouin camp.
  5. **The Survey Pylons** — a scatter of 1970s-era oil-survey markers and a rusted pylon line, monument to an exploration that didn't pan out.
  6. **Ahmed's Tea Stand** *(playful)* — a tiny, genuinely-in-use makeshift tea stand parked in the middle of nowhere. Turns out this is where Ahmed actually goes on break.
  7. **The Famous Dune** *(playful)* — one specific dune ridge that's inexplicably become an Instagram pilgrimage spot, tire tracks and abandoned tripods included.
  
  Chunked terrain streaming (tile-based LOD) to keep it mobile-friendly.
- **Loose narrative delivery — Ahmed:** the unseen contact is Ahmed, a local police officer keeping half an eye on the dune-bashing traffic in his patch — good-natured, a little worn down, comedically exasperated at how often people get themselves lost or stuck out here. His voice is never actually voiced: a call-in is signaled purely by a radio static/click "kssshhht" sound cue (see §6), and his side of the conversation (plus the player's implied context) scrolls live as text at the bottom of the screen, like subtitles without audio — a deliberate Firewatch-radio feel without the VO production overhead. Dialogue is sparse and ambient, never blocking — it plays over the driving, never pauses it, and the text auto-advances/fades rather than waiting on input.
- **Waypoints:** soft-guided, not objective-marker driven. Ahmed's scrolling text might say something like "there's a ridge past the old well, try not to end up in it" — a subtle compass/dashboard cue nudges the player, but nothing is mandatory and there's no fail/success state for skipping it.
- **Dune bashing feel:** the core physical joy — cresting a dune with real weight transfer, controlled slides in soft sand, momentum-dependent climbs, genuine (damage-free) rollover tension on steep sidehills, the crunch/hiss of tires on sand via audio. Full requirements in §2 — this is the system to get right before anything else.
- **Photo mode:** free-look camera, filter/vignette options, save + share — fits the relaxation/exploration fantasy well and is cheap to build on top of the existing camera rig.
- **Session shape:** no forced structure. Player can drive for 5 minutes or 45. A light "chapter" feel can emerge from Ahmed's call-in pacing (he goes quiet for stretches, then a new snippet unlocks near a new POI) without ever gating movement.

---

## 6. Audio Design

- **Score:** oud-led ambient/instrumental score, slow, drone-adjacent, minimal percussion — think "traditional instrument, ambient production," not upbeat or metered. Should be able to loop/crossfade seamlessly and layer with world audio.
- **Adaptive layering:** base ambient bed (wind, distant space) always playing; oud layer fades in during driving/exploration; both duck slightly under an incoming radio call.
- **Diegetic audio:** engine note (RPM-linked), sand/tire foley (different sand densities = different tone), wind intensity tied to speed and dune elevation.
- **Ahmed's radio calls:** no voice acting at all — a single "kssshhht" radio-static/click sound cue plays when Ahmed keys up, then his lines (and any implied player-side context) scroll as live text at the bottom of the screen, timed like subtitles but with no audio underneath. Keeps the narrative pass cheap to iterate (just text data, no VO pipeline) while still landing the CB-radio feel. A second, shorter static cue plays when he signs off.

---

## 7. Controls

All input methods drive the same underlying input abstraction (`SteeringInput: -1..1`, `ThrottleInput: 0..1`, `BrakeInput: 0..1`) so the vehicle controller is control-scheme-agnostic. The game auto-detects available input and lets the player switch at any time in options.

1. **Keyboard + mouse (desktop default):** WASD/arrow keys for steering + throttle/brake, mouse-drag for free-look camera in photo mode.
2. **Gamepad (desktop/any browser with Gamepad API):** left stick steering, triggers/face buttons for throttle/brake — auto-detected on connect via the standard Gamepad API, with a connection toast/prompt.
3. **Touch (mobile browser):** on first touch-capable session, prompt a one-time picker between:
   - Virtual joystick (single analog stick, handedness option)
   - On-screen steering wheel (drag-rotate widget + pedals)
   - Tilt steering (device orientation API for steering, on-screen pedals for throttle/brake)

Detection logic: default to keyboard/mouse on non-touch desktop viewports, default to virtual joystick on touch viewports, and always allow gamepad to override either when a controller is detected — since gamepad input can arrive on both desktop and mobile browsers.

---

## 8. Performance Targets

- 60fps target on modern desktop browsers; 60fps target on mobile browsers too, with a practical floor of phones from the last ~2 years (higher floor chosen deliberately to protect visual quality rather than stretch to older hardware).
- Adaptive quality: detect device/GPU tier at load (or via a runtime fps-based auto-adjust) and scale shadow resolution, draw distance, and particle density accordingly rather than shipping a single fixed-quality build.
- Terrain: chunked heightfield with distance-based LOD, frustum culling, no per-frame full-terrain regeneration.
- Draw call budget: keep scene under ~150 draw calls per frame via geometry merging/instancing (especially dune tiles and any repeated dressing like rocks/scrub); tighten further on mobile-tier profile.
- Texture-light approach: flat-shaded/vertex-color materials reduce texture memory pressure — helps both mobile GPU limits and initial page load size.
- Load size: keep initial bundle + first-terrain-chunk payload reasonable for web delivery (target a first-interaction budget, e.g. a few seconds on decent broadband) since there's no app-store pre-install — assets stream in as needed rather than all upfront.
- Profile on real mobile Safari/Chrome early, not just desktop — mobile WebGL performance characteristics differ meaningfully from desktop.

---

## 9. Project Structure (proposed)

```
/src
  /engine        - Three.js scene setup, renderer, camera rig, time-of-day system
  /terrain       - heightfield generation, chunk streaming, LOD
  /vehicle       - Rapier vehicle controller, input abstraction, camera-follow
  /audio         - Web Audio graph, ambient layering, radio-chatter trigger system
  /narrative     - POI/trigger definitions, Ahmed's dialogue data (text only), scrolling-text UI system
  /ui            - HUD, menus, control-scheme picker, photo mode UI
  /input         - keyboard/gamepad/touch (joystick, wheel, tilt) handlers -> shared input abstraction
  /data          - world config, POI coordinates, dialogue scripts (JSON)
/public          - static assets served as-is (favicon, manifest, etc.)
/assets
  /models        - low-poly vehicle, props (well, camp, pylons, rocks)
  /audio         - oud score stems, ambient beds, radio static/click cues, foley
  /shaders       - flat-shade terrain shader, sky gradient shader
CLAUDE.md
```

---

## 10. Development Phases

1. **Prototype (movement feel first):** flat gray-box terrain plus a few sculpted dune shapes (flat alone won't validate weight transfer/rollover), vehicle controller built to the full spec in §2 — weight transfer, per-wheel suspension, sand traction, momentum-dependent climbing, damage-free rollover — tuned by feel before anything else is built. Keyboard/mouse wired to the shared input abstraction first (fastest to iterate on desktop), then gamepad and touch schemes layered in. No art, no audio. This phase doesn't end until the driving feel is genuinely satisfying. Runs via `vite dev` locally.
2. **World pass:** procedural dune heightfield + chunk streaming + flat-shaded terrain shader + sky system + time-of-day.
3. **Audio pass:** ambient bed + oud score integration + engine/tire foley + adaptive mixing.
4. **Narrative pass:** POI placement (5–7 for v1), radio-static trigger system, Ahmed's scripted dialogue (text-only, comedic/weary tone), scrolling-text UI.
5. **Polish/UX:** photo mode, responsive layout pass (desktop + mobile viewport), control-scheme auto-detection/picker, settings persistence, adaptive-quality performance pass across device tiers.
6. **Build & deploy:** production `vite build`, deployed to Vercel (connect repo, auto-deploy on push to main; preview deployments on branches/PRs for testing builds before they go live).

---

## 11. Explicit Non-Goals (v1)

- No multiplayer.
- No procedurally infinite world (curated single region only).
- No combat, damage-based fail states, or scoring/leaderboards.
- No native app wrapper in v1 (browser-only for now; Electron/Capacitor wrapping is a later-stage option, not current scope).
- No official/licensed Nissan assets, badging, or trademarked design files — the Patrol Super Safari is a visual reference only; the model is built independently in-house.
- No photoreal/PBR rendering — flat-shaded stays flat-shaded even under scrutiny; resist scope creep toward realism.

---

## 12. Open Questions (to resolve before/during prototype phase)

- Exact wording/count of Ahmed's line pool beyond the starter set in §13 — expand as POIs get finalized during the narrative pass.
- Whether Ahmed ever references the player by name/nickname, or stays generic ("ya sir," "champion," etc.) throughout — pick during the narrative pass once POI content is locked.

---

## 13. Ahmed — Character & Line Bible

**Who he is:** local police officer covering the dune-bashing stretch of desert. Not a ranger, not a tour guide — a working cop who'd honestly rather be somewhere with air conditioning, but keeps half an eye on the radio for people who wander off track or get bogged down in soft sand. He's seen every way a 4x4 can get stuck and is no longer impressed by any of them.

**Voice:** Emirati English with light Arabic phrases mixed in naturally (*habibi, yalla, wallah, khalas, mashallah*) — not overloaded, just enough to place him. Sarcastic and teasing toward the player, but never mean-spirited; the teasing comes from familiarity, like he's talked a hundred people through this same drive. Dry delivery, quick timing.

**Format rules:**
- Always preceded by the "kssshhht" static cue, always closed by a shorter static cue on sign-off.
- **One-liners only** — no multi-sentence monologues. If a moment needs more, it's two separate short call-ins, not one long one.
- Scrolls as text at the bottom of the screen, no VO.
- Draw randomly from category pools below to avoid repetition on replay; retire a line for the session once used, cycle back if the pool runs out.

**Starter line pool (expand during narrative pass):**

*Sign-on / general check-ins (not tied to a POI):*
- "Ahmed. Radio check. You're still upright, I hope."
- "Nobody's called this in yet, so either you're fine or you're just not answering."
- "Quiet day. Try to keep it that way."
- "Nice of you to actually go where the road isn't."

*Approaching a POI — written to be specific to each one, not interchangeable:*
- **The Old Falaj:** "That's the falaj. Older than the road you didn't take to get here."
- **Ghaf Tree Ridge:** "That tree's older than both of us. Don't be the reason it isn't anymore."
- **The Watchtower Ruin:** "Old watchtower. Whoever built it had a better view than my station does."
- **Old Campsite Ruins:** "People lived out here before air conditioning existed. Show some respect."
- **The Survey Pylons:** "Seventies oil survey. They were wrong. Markers stayed anyway."
- **Ahmed's Tea Stand:** "That's my actual tea stand. If I'm not on shift, I'm probably right there."
- **The Famous Dune:** "This dune has more photos of it than my entire family. I've never understood why."

*Player stuck / idle too long:*
- "That's sand. It does that."
- "Reverse, then forward. It's not a puzzle."
- "I've written this exact report eleven times this month."

*Driving fast / cresting dunes:*
- "Slow down. This isn't a rally."
- "I saw that jump. I'm choosing to ignore it."

*Sign-off:*
- "Ahmed out. Try not to need me again today."
- "Khalas. Go on then."
- "I've got tea waiting. Drive safe, habibi."

**Tone guardrails:**
- Jokes land on specificity, not on the accent or the Arabic — the humor is Ahmed being a tired cop with dry timing, not "funny because foreign."
- Each Arabic word earns its place (functional, inferable from context) rather than decorating a line for flavor.
- POI lines reference something real/concrete about that spot — no generic filler that could be swapped between locations.
- He's tired, not cruel — affectionate exasperation, not contempt.
- No fourth-wall breaks about the game itself — he stays fully in-world.
