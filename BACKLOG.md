# Shamal — backlog

Twenty items, ordered by what would hurt most if left alone. Everything here is
grounded in the current code rather than general advice: file paths and measured
numbers are given where they exist, and where something is unverified it says so.

Sizes are rough: **S** = an afternoon, **M** = a day or two, **L** = a week-ish.

---

## 1. Broken now

The first two are regressions introduced when the `T` tuning panel was removed
from player builds. It was the only UI for several settings, and two of them did
not get relocated.

### 1. Effects volume has no UI at all — **S**

`settings.effectsVolume` is read at boot and on audio changes (`Game.ts`) but
nothing in a production build can set it. It is pinned at its default of `0.7`
forever. Engine, tyres, wind and impacts are a third of the mix and a player who
finds them too loud has no recourse.

*Fix:* an Effects row in `MenuPanel` alongside Sound and Music. Three steps,
same pattern.

### 2. The day never advances — **S**

`TimeOfDay.autoAdvance` defaults to `false` and its only toggle lived on the
tuning panel. So in production the sky is frozen at whichever preset the player
picked, and the entire 20-minute day/night cycle — keyframes, blue hour, the
moon-lit night, the haze curve — never runs unless someone happens to sit on a
region change. A large system is currently dead code in the shipped game.

*Fix:* decide whether the default should be `true`, and put the toggle in the
menu next to Time of day. Worth thinking about: a moving sun means the light you
framed a photo in changes under you.

### 3. Photo mode is unreachable on touch — **M**

`togglePhotoMode()` is bound to `KeyP` and nothing else. There is no button
anywhere in the touch UI. Mobile players — the majority of anyone arriving from
a shared link — cannot open photo mode, which means they cannot use the
watermark, the filters, or `navigator.share`. The one feature built specifically
to spread the game is invisible to the audience most likely to spread it.

*Fix:* a shutter button in the touch layer, or a menu entry. The `PhotoBar`
already works on touch once you are in.

### 4. No handbrake on touch — **S**

Under the joystick scheme the pedals are hidden and the stick carries steering
and throttle/brake. `input.handbrake` is only ever set by `Space`. Pivoting the
truck — a basic part of the driving vocabulary — is desktop-only.

*Fix:* a thumb button near the stick, or handbrake on a second touch.

### 5. No reset on touch — **S**

`KeyR` calls `vehicle.recover('manual')`. Rollovers auto-right themselves so
this is not usually needed, but a truck wedged nose-down between two dune faces
has no escape on a phone short of reloading.

---

## 2. Unvalidated

### 6. Play it on a real phone — **S, and it outranks everything below**

§2 makes driving feel the core value of the game, and it has never been
validated on hardware that renders above ~5 fps. Every visual check in this
project was software-rendered. Open questions only a device answers: does the
weight transfer read, does a stalled climb feel like a decision or a bug, does
the `sinkDrag` fix make the buggy and the pickup feel as different as their
numbers now say, and is the rollover a "whoa, okay" or an irritation.

### 7. Frame rate across the three quality tiers — **S**

`QualityWatchdog` drops a tier after 4s above 22ms. Nobody knows which tier real
phones land on, whether the watchdog thrashes, or whether the 60fps target in §8
is met at all. Instrument and read it off a device.

### 8. Short and landscape viewports — **S**

The menu is eleven rows. It fits 412×883 without scrolling; it has not been
opened on a 667px-tall phone or in landscape, where the touch controls, HUD and
menu all compete for a much shorter column.

---

## 3. Driving feel (§2)

### 9. Per-vehicle engine notes — **M**

Seven bodies share one `DrivingSound`. A 240kg single-cylinder bike and a
2.65-tonne V8 pickup are audibly identical, which quietly undoes a lot of what
the per-body tuning achieves — the engine note is how you read the traction
model by ear.

### 10. Tyre-pressure audio — **S**

Airing down takes 1.5s per step and is silent. A hiss over that window, and a
compressor thump on the way up, would do most of the remaining work of making it
feel like an act. The haptic cue is already there.

### 11. Cockpit camera — **L**

Parked twice. Needs an interior modelled for each body, and five of the seven
are still empty shells. The soft top now has one, which makes it the natural
place to prototype.

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

### 15. Daytime world traffic — **M**

The night convoys work and the day has nothing equivalent. A distant dust plume
tracking along a ridge would cost about what the convoys did. Deliberately
declined once already — the counter-argument is that it competes with the
solitude §1 is built on, so this needs a decision before it needs code.

### 16. Ahmed reacting to more state — **S**

He has 60 lines and reacts to POIs, weather, rollovers, getting stuck, speed,
airtime and tyre pressure. He does not react to which vehicle you chose, which
desert you are in, or the time of day — all cheap, all text-only, and vehicle
choice in particular is a joke that writes itself for the bike.

---

## 5. Craft and polish

### 17. Camel shadows are cast from undeformed geometry — **S**

`Camels` patches its material via `onBeforeCompile`, but the depth material used
for shadow casting gets no such patch. So a walking camel's shadow does not
swing its legs. Needs a custom depth material carrying the same vertex
displacement. The same applies to any future instanced animation.

### 18. Flat-shading quilts on low-relief ground — **M**

At grazing angles on flat ground the 2m render grid shows as a patchwork.
Measured: face normals there genuinely span 0–29°, so this is the art direction
meeting the LOD resolution rather than a shading bug. A smoothing-angle rule
would fix it and is a real art call — §4 says flat-shaded stays flat-shaded.

### 19. The 11.8MB score — **S**

`Barr Background Music.mp3` is the largest asset by 5×. It streams through an
`<audio>` element rather than blocking the load, so time-to-play is unaffected —
but `preload='auto'` means a phone on cellular pulls megabytes before the player
has decided to stay. `preload='metadata'` plus play-on-unlock would fix it. A
shorter loop or a lower bitrate would fix it further.

### 20. Accessibility pass — **M**

Nothing has been done here. Concretely: `prefers-reduced-motion` is honoured in
two CSS animations but not by the chase camera or the photo-mode filters; the
subtitle and hint text has no size control; the compass and POI card lean on the
same warm palette with no contrast alternative; and nothing has been checked
against a screen reader.

---

## Not on this list, and why

- **The Old Falaj being geographically odd in Liwa** — decided, deliberately
  kept. The map is explicitly fictionalised and Ahmed's line leans on it.
- **Leaderboards, damage, multiplayer, native wrapper** — §11 non-goals.
- **Photoreal rendering** — §11, and the palette work depends on it staying flat.
