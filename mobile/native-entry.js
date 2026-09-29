/* Entry point bundled by esbuild into the single-file app.
 *
 * The app ships as one hand-concatenated IIFE, so `import('@capacitor/app')`
 * inside it can never resolve — a bare specifier has no loader in a WebView.
 * Instead we bundle the plugin wrappers here, once, and publish them on a
 * global that 12-native.js reads. This keeps the native layer feature-detected
 * with web fallbacks intact while making the plugins actually reachable.
 *
 * This file must live under mobile/ so esbuild resolves @capacitor/* from
 * mobile/node_modules rather than walking up to the repo root.
 */
import { App } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Preferences } from '@capacitor/preferences';

window.SFPlugins = {
  App,
  Camera,
  CameraResultType,
  CameraSource,
  Filesystem,
  Directory,
  Encoding,
  Share,
  Preferences
};
