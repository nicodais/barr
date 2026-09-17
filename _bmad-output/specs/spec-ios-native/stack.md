# iOS native shell — technical notes

Implementation-shaped detail supporting SPEC.md's capabilities. Non-binding on approach where marked, but the facts below are load-bearing for whoever writes the architecture/stories.

## Existing code this epic touches, not replaces

- `src/input/Haptics.ts` — web-Vibration-API based; `supported` is hardcoded `false` on iOS since Safari has no `navigator.vibrate`. CAP-4 adds a native branch — feature-detect the JS bridge (e.g. `window.webkit?.messageHandlers?.shamalHaptics`) the same way `supported` already feature-detects `navigator.vibrate` — reusing the existing priority/shape system (`P.ui/texture/event/land/rollover`). Do not redesign the cue vocabulary; map each existing pattern to a native call on the Swift side.
- `src/ui/PhotoBar.ts` — Save/Share currently use a `Blob` + `<a download>` link and `navigator.share`. Both are unreliable inside a WKWebView. CAP-5 swaps the native path to a JS↔Swift bridge call carrying the captured image data, handled natively.
- `src/input/TouchSource.ts` — already implements the iOS 13+ `DeviceOrientationEvent.requestPermission()` gesture-gated pattern. CAP-3 verifies this works unmodified inside the hand-rolled WKWebView before writing any new code; see the matching Open Question in SPEC.md — this depends on the content-loading mechanism chosen for CAP-1.
- `public/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable.png`, `apple-touch-icon.png`, `manifest.webmanifest` — existing marks from prior web/PWA-lite work. CAP-6's native icon set and launch screen should derive from these, not commission new art.
- No external asset fetches exist in `src/` (verified by grep — only credit-text strings and the `GAME_URL` constant reference `https://`); `public/` is ~2.1MB and entirely local. CAP-2 (offline play) should hold without an asset-loading redesign.

## Native Xcode/Swift shell shape (confirm during architecture/story-writing, not fixed by this spec)

- A single-view iOS App target (SwiftUI `App`/`UIViewControllerRepresentable`, or plain UIKit — either is fine) hosting one `WKWebView` that fills the screen.
- **Content loading (Open Question in SPEC.md):** either
  - a `WKURLSchemeHandler` registered on the `WKWebViewConfiguration` serving files out of the app bundle under a custom scheme (e.g. `shamal://`), which most closely mirrors how a real static-site origin behaves (stable origin for `localStorage`, no `file://` sandboxing quirks); or
  - `webView.loadFileURL(_:allowingReadAccessTo:)` pointing at a bundled copy of `dist/`, which is simpler to wire but has a `file://` origin, which some web APIs and permission prompts treat differently.
  Decide before CAP-1 is implemented, since CAP-2/CAP-3 both depend on it.
- **JS↔Swift bridge:** a single `WKScriptMessageHandler` (e.g. registered as `shamalNative`) that the web side posts typed messages to (`{type: 'haptics', pattern: [...]}`, `{type: 'photoSave', data: '<base64>'}`, etc.), and that calls back into the page via `evaluateJavaScript` for responses. Keep this bridge thin — it is transport only, not business logic; the existing `Haptics.ts` pattern/priority logic and `PhotoBar.ts` UI stay in TypeScript.
- **Haptics (CAP-4):** native side maps incoming patterns to `UIImpactFeedbackGenerator` / `UINotificationFeedbackGenerator` for simple cues, or `CoreHaptics` (`CHHapticEngine`) if the existing multi-tap patterns (e.g. rollover's five-beat pattern) need closer fidelity than the two feedback generators give.
- **Photo save/share (CAP-5):** native side uses `PHPhotoLibrary.shared().performChanges { PHAssetCreationRequest... }` for Save (requires `NSPhotoLibraryAddUsageDescription` in Info.plist) and `UIActivityViewController` for Share, both triggered from the bridge message carrying the captured image data from `PhotoMode.ts`'s existing `capture(): Promise<Blob>`.
- **Icon/launch screen (CAP-6):** standard Xcode Asset Catalog `AppIcon` set (all required sizes) plus a `LaunchScreen` storyboard or SwiftUI launch view, both derived from the existing `public/icon.svg` mark.
- **Safe area / status bar (CAP-7):** the web content already needs to respect `env(safe-area-inset-*)` via CSS the same way any responsive mobile web layout would; the native shell additionally controls status-bar style via the hosting `UIViewController`'s `preferredStatusBarStyle` / `prefersStatusBarHidden`.

## Info.plist / capability declarations likely needed

- `NSPhotoLibraryAddUsageDescription` — required once CAP-5 writes to Photos.
- Privacy manifest (`PrivacyInfo.xcprivacy`) — Apple's "required reason" API declarations are primarily triggered by third-party SDKs; with no Capacitor/Cordova dependency and no other third-party frameworks, this project's own obligation here is expected to be minimal (just the app's own justified API usage, e.g. Photos). Re-confirm against current Apple documentation during CAP-10.
- Orientation/device-motion: iOS does not require an `NSMotionUsageDescription` entry for `DeviceOrientationEvent` specifically (that's the separate Core Motion API), but this should be re-verified during CAP-3's real-device spike, since Apple's requirements here have shifted before, and WKWebView's handling of this web API may differ from Safari's.

## Existing architecture constraints this must respect

See `../../planning-artifacts/architecture/architecture-shamal-2026-09-07/ARCHITECTURE-SPINE.md` AD-1 through AD-7 (composition-root wiring, type-only cross-system imports, single physics clock, `GameSettings`/`Progress` as the only shared `localStorage` blobs, `activeRegion` source of truth, shared input abstraction). None of them are expected to change shape for this epic — the native shell is a thin host around the existing build, not a new architectural layer inside it.

CAP-6 (icon/launch screen) and CAP-7 (safe-area/native chrome) should stay inside `../../planning-artifacts/ux-designs/ux-shamal-2026-09-07/DESIGN.md`'s existing token family (UX-DR1–UX-DR4: warm/low-contrast colors, single accent, shape system) rather than introducing iOS-default chrome that breaks the established look.
