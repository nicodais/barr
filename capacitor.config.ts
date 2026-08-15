import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell.
 *
 * Capacitor rather than a hand-rolled WKWebView host: the game is already a
 * self-contained static bundle with no network calls in it, so the only thing a
 * wrapper has to add is the handful of native capabilities a browser withholds —
 * durable storage, the share sheet, the Taptic Engine, the audio session. Those
 * are exactly the plugins this project pulls in, and nothing else.
 *
 * Everything is served from the bundle. No `server.url`, ever: pointing this at
 * the Vercel deployment would turn the app into a browser with the chrome
 * removed, which is both a guideline 4.2 rejection and a worse experience than
 * the website it was pretending not to be.
 */
const config: CapacitorConfig = {
  /**
   * Must match the App ID registered in the developer portal, and cannot be
   * changed after the first App Store submission — it is the app's identity to
   * Apple forever. `nicodais` rather than a product domain on purpose: bundle
   * IDs only have to be unique in Apple's registry, and tying it to the owner
   * rather than to a name that is still being decided means settling on a title
   * later costs nothing.
   */
  appId: 'com.nicodais.shamal',
  /** What sits under the icon on the home screen. Short enough not to elide. */
  appName: 'Shamal',
  webDir: 'dist',
  ios: {
    /**
     * The page is a fixed-size canvas with an absolutely-positioned HUD over it;
     * there is nothing to scroll. Left on, a hard drag anywhere drags the whole
     * document and the horizon peels away from the top of the screen.
     */
    scrollEnabled: false,
    /**
     * Safe areas are already handled in CSS — `viewport-fit=cover` in the
     * document and ~40 uses of `env(safe-area-inset-*)` in style.css. Letting
     * the webview inset the content as well would apply the notch allowance
     * twice and leave a band of background down each side in landscape.
     */
    contentInset: 'never',
  },
  /**
   * The sand colour, so the half-second between the launch screen and the first
   * rendered frame is the game's own palette rather than a flash of white.
   */
  backgroundColor: '#e8b98a',
};

export default config;
