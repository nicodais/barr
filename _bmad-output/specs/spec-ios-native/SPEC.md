---
id: SPEC-ios-native
companions: [stack.md, ../../planning-artifacts/architecture/architecture-shamal-2026-09-07/ARCHITECTURE-SPINE.md, ../../planning-artifacts/ux-designs/ux-shamal-2026-09-07/DESIGN.md]
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Shamal — Native iOS Build (Hand-Rolled Xcode/WKWebView)

## Why

Shamal ships today as a browser-only web app; `CLAUDE.md` explicitly named native wrapping a later-stage option, not v1 scope. That stage has arrived: this is a vision-to-realize spec to get the existing Vite/Three.js/Rapier web app running as a real iOS app and published to the App Store — not a rewrite of the game, and not built on a third-party wrapper framework (Capacitor/Cordova), but a small, hand-written native Xcode/Swift shell around the existing, unmodified web build, with native capabilities bridged in directly.

## Capabilities

- **CAP-1**
  - **intent:** The existing production web build runs unmodified inside a hand-built native Xcode iOS project — a WKWebView-based shell maintained in this repo, with no third-party native-wrapper framework dependency.
  - **success:** The `vite build` output loads inside the Xcode-run app with no blank screen, console error, or missing asset, and gameplay (drive, dune-bash, rollover, POIs, settings) is reachable end to end on simulator and a real device.
- **CAP-2**
  - **intent:** The app launches and plays fully offline once installed, since all gameplay assets are bundled locally rather than fetched from a remote origin.
  - **success:** A fresh install, with the device in airplane mode, completes a full drive session with no failed asset load.
- **CAP-3**
  - **intent:** The existing tilt-steer control (device orientation, with its iOS permission-request flow) works inside the hand-rolled WKWebView the same way it works in mobile Safari.
  - **success:** On a real device, the one-time orientation permission prompt appears and, once granted, tilt steering responds during a drive.
- **CAP-4**
  - **intent:** The rollover/landing/texture/UI haptic cues already defined in `Haptics.ts` fire via a native haptics call on iOS instead of being silently disabled.
  - **success:** `Haptics.supported` is `true` on a native iOS build, and a rollover produces a felt haptic pattern on a real device.
- **CAP-5**
  - **intent:** Photo mode's Save writes the captured image into the device's real Photos library, and Share opens the native iOS share sheet.
  - **success:** Tapping Save on a real device produces a new entry in Photos; tapping Share opens the native share sheet with the captured image attached.
- **CAP-6**
  - **intent:** A full native iOS icon set and a launch screen are supplied, visually consistent with Shamal's existing marks and art direction.
  - **success:** The installed app shows a correctly rendered icon at every size Xcode requires, and a launch screen appears with no default-white flash.
- **CAP-7**
  - **intent:** HUD, menus, and the touch control cluster respect iOS safe areas (notch/Dynamic Island, home indicator) and an appropriate status-bar style.
  - **success:** On a notched device, no HUD element or touch control is clipped or obscured by safe-area insets in either supported orientation.
- **CAP-8**
  - **intent:** An Apple Developer Program membership, App ID/bundle identifier, and signing certificates/provisioning profiles (development + distribution) are set up.
  - **success:** Xcode archives and signs a distribution build with no signing error.
- **CAP-9**
  - **intent:** A signed build is uploaded to App Store Connect and made available to internal testers via TestFlight.
  - **success:** An internal tester installs and runs the build through the TestFlight app.
- **CAP-10**
  - **intent:** Store listing metadata, the privacy nutrition label, and the required privacy manifest are prepared and the app is submitted for App Store review.
  - **success:** The app reaches "Waiting for Review" or better status in App Store Connect, with no rejection for missing metadata.

## Constraints

- Architecture spine AD-1–AD-7 remain binding: native bridge calls (haptics, photo save/share, orientation) are added behind the existing `input/`, `Haptics.ts`, and photo-mode module seams — never imported directly into gameplay code.
- No third-party native-wrapper framework (Capacitor, Cordova, or similar) is used. The iOS shell is a hand-written Swift/WKWebView Xcode project living in this repo, with a custom JS↔Swift bridge (e.g. `WKScriptMessageHandler`) for the native capabilities CAP-3–CAP-5 need.
- App icon and launch screen follow `CLAUDE.md` §4's flat-shaded, low-poly, warm-palette, no-PBR visual style — no photoreal or glossy iOS-style icon treatment.
- `GameSettings`/`Progress` `localStorage` persistence (AD-5) must survive inside the WKWebView's storage origin across app relaunches and app updates — this now depends on whichever content-loading mechanism the hand-rolled shell picks (see Open Questions), since there is no framework default to inherit.
- The already-validated 60fps mobile target (NFR-2) must not regress under WKWebView rendering; a real-device frame-rate spot-check inside the native shell is required, not assumed equivalent to mobile Safari.
- No monetization, in-app purchase, or push-notification capability may be introduced as part of App Store submission prep.

## Non-goals

- Using Capacitor, Cordova, or any other third-party native-wrapper framework — this project builds and maintains its own minimal native Xcode project and JS bridge instead.
- A full native rewrite of the game (renderer, physics, UI, audio in Swift/SceneKit/RealityKit/Metal) — explicitly declined; the web codebase is wrapped, not replaced.
- Android/Google Play build — out of scope for this epic.
- Electron/desktop wrapper — remains a separate later-stage item per `CLAUDE.md`.
- New gameplay content — no new vehicles, POIs, regions, or narrative lines; this is packaging/platform work only.
- Monetization, in-app purchases, and push notifications.
- A rewrite or architectural change to the existing web app — the native shell wraps the existing static build as-is.

## Success signal

Shamal is installable by a real user on a real iPhone through TestFlight, and the app has been submitted to Apple for App Store review with a complete, accurate listing — reachable end to end from `git clone` to "Waiting for Review" without a manual workaround at any step.

## Assumptions

- Minimum supported iOS version tracks the existing "~2-year-old phone" performance floor (`CLAUDE.md` §8 / NFR-2) rather than a separately negotiated OS floor; the exact version number is an implementation decision for architecture/story-writing, not fixed here.
- The app's bundle identifier and App Store Connect app name reuse "Shamal" / the project's existing branding (`src/brand.ts`), pending confirmation there is no App Store naming conflict.
- A WKWebView loading the bundled `dist/` output via a custom URL scheme or a Bundle-relative file URL is an acceptable content-loading mechanism; the exact mechanism is an architecture-step decision (see Open Questions), not fixed here.

## Open Questions

- Which WKWebView content-loading mechanism should the hand-rolled shell use — a `WKURLSchemeHandler` serving a custom scheme (e.g. `shamal://`), or `loadFileURL` off `Bundle.main`? Affects `localStorage` durability and matters for CAP-1–CAP-3 alike; Capacitor would have made this choice for us, so it now needs an explicit decision early.
- Who holds/pays for the Apple Developer Program membership (individual vs. organization account)? Affects App Store Connect setup and CAP-8.
- Does device-orientation permission (CAP-3) prompt correctly from whichever content-loading mechanism is chosen above? Needs a real-device spike before that story is estimated, and depends on the content-loading decision being made first.
- What App Store review risk does a driving game with rollover/crash-adjacent physics and a UAE setting carry (age rating, culturally-sensitive review feedback)? Unknown until a real submission is attempted.
