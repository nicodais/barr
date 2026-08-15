import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Getting a photo out of the game, on a platform where the browser's way of
 * doing it does not work.
 *
 * The browser way is an `<a download>` click, and in WKWebView it is a **silent
 * no-op** — no file, no error, no prompt. The button reported "Saved" and
 * nothing was saved, which is worse than the feature being missing. The Web
 * Share API is not a fallback either: it is unreliable inside a webview and
 * `navigator.canShare` cannot be trusted to tell you in advance.
 *
 * So on native the file goes through the filesystem and the system share sheet
 * instead. That route was chosen over a photo-library plugin deliberately:
 * writing directly to Photos needs `NSPhotoLibraryAddUsageDescription` and
 * throws a permission prompt at someone who only wanted a screenshot, whereas
 * the share sheet already has "Save Image" in it and needs no permission at
 * all. The player performs the save themselves, and the same sheet gets them
 * Messages, AirDrop and Instagram for free.
 *
 * The cache directory rather than documents: this is a handoff, not a library.
 * Once the sheet has taken the file the app has no further use for it, and iOS
 * can reclaim the cache whenever it likes.
 */

/** True inside the iOS app, false on the web. */
export const isNative = Capacitor.isNativePlatform();

export type ExportResult = 'shared' | 'cancelled' | 'failed';

/**
 * Writes the capture into the app container and hands it to the share sheet.
 *
 * Only meaningful when {@link isNative}; the browser keeps its existing
 * `navigator.share` / `<a download>` path, which works there.
 */
export async function shareNative(
  blob: Blob,
  filename: string,
  text: string,
  url: string,
  title: string,
): Promise<ExportResult> {
  let uri: string;
  try {
    const { uri: written } = await Filesystem.writeFile({
      path: filename,
      // Filesystem takes base64, not a Blob, so the PNG makes one trip through
      // a data URL. A 1-2MB capture is a few milliseconds and happens once per
      // shutter press, which is nowhere near often enough to be worth avoiding.
      data: await toBase64(blob),
      directory: Directory.Cache,
    });
    uri = written;
  } catch {
    return 'failed';
  }

  try {
    // Text and URL alongside the file, not just the file — same reasoning as
    // the web path: several share targets keep one and drop the other, and a
    // photo that lands somewhere with no way back to the game misses the point.
    await Share.share({ title, text, url, files: [uri] });
    return 'shared';
  } catch {
    // The plugin rejects when the sheet is dismissed, which is the common case
    // and is not an error. There is no way to tell a dismissal from a genuine
    // failure here, so it is reported as the harmless one.
    return 'cancelled';
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // readAsDataURL gives "data:image/png;base64,...."; the plugin wants only
      // what follows the comma.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
