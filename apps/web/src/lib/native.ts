// Typings for the native bridge Capacitor injects at document-start as
// `window.Capacitor.Plugins.*` in the Android/iOS app shell. This is the ONLY
// place in apps/web that declares `Window.Capacitor` — no @capacitor/* npm
// deps here, since the web app is loaded remotely by a thin native shell
// (ADR-0008) and must stay buildable/runnable standalone.

export interface PluginListenerHandle {
  remove: () => Promise<void>;
}

export interface CapacitorAppPlugin {
  // The injected runtime returns the handle SYNCHRONOUSLY; only @capacitor/app's
  // npm wrapper promisifies it. Callers must Promise.resolve() the result —
  // calling .then() on it directly crashed the app shell (see issues.md).
  addListener(
    eventName: 'backButton',
    cb: (event: { canGoBack: boolean }) => void,
  ): PluginListenerHandle | Promise<PluginListenerHandle>;
  minimizeApp(): Promise<void>;
}

export interface CapacitorFilesystemPlugin {
  writeFile(options: { path: string; data: string; directory: string }): Promise<{ uri: string }>;
}

export interface CapacitorSharePlugin {
  share(options: { title?: string; files?: string[] }): Promise<unknown>;
}

export interface CapacitorHapticsPlugin {
  impact(options?: { style?: 'HEAVY' | 'MEDIUM' | 'LIGHT' }): Promise<void>;
  notification(options?: { type?: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
  selectionChanged(): Promise<void>;
}

export interface CapacitorPushPlugin {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register(): Promise<void>;
  // Same sync-handle caveat as CapacitorAppPlugin.addListener above.
  addListener(
    eventName: 'registration',
    cb: (token: { value: string }) => void,
  ): PluginListenerHandle | Promise<PluginListenerHandle>;
}

declare global {
  interface Window {
    Capacitor?: {
      Plugins?: {
        App?: CapacitorAppPlugin;
        Filesystem?: CapacitorFilesystemPlugin;
        Share?: CapacitorSharePlugin;
        Haptics?: CapacitorHapticsPlugin;
        PushNotifications?: CapacitorPushPlugin;
      };
    };
  }
}

// Saves a blob via the native Filesystem + Share plugins so a download lands
// somewhere real in the app (Android WebView drops <a download>/blob URLs
// silently — no DownloadListener in the shell — and has no Web Share API).
// Returns false immediately on the website or an app build older than this
// plugin pair, so callers can fall through to their existing web-only path.
export async function nativeDownload(blob: Blob, filename: string): Promise<boolean> {
  const filesystem = window.Capacitor?.Plugins?.Filesystem;
  const share = window.Capacitor?.Plugins?.Share;
  if (!filesystem || !share) return false; // browser, or an app build before this plugin shipped

  let uri: string;
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(',') + 1)); // strip the data:*;base64, prefix
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    ({ uri } = await filesystem.writeFile({ path: filename, data: base64, directory: 'CACHE' }));
  } catch {
    return false; // the bridge calls themselves are unusable
  }

  try {
    await share.share({ title: filename, files: [uri] });
  } catch {
    // User dismissed the share sheet — same as the iOS AbortError case, not a
    // failure: the file is already written to the cache directory.
  }
  return true;
}

// Optional chaining makes these automatic no-ops in the browser or an app
// build older than the Haptics plugin — callers never need to feature-check.
export function hapticImpact(style: 'HEAVY' | 'MEDIUM' | 'LIGHT' = 'MEDIUM'): void {
  window.Capacitor?.Plugins?.Haptics?.impact({ style }).catch(() => {});
}
export function hapticSuccess(): void {
  window.Capacitor?.Plugins?.Haptics?.notification({ type: 'SUCCESS' }).catch(() => {});
}
export function hapticTick(): void {
  window.Capacitor?.Plugins?.Haptics?.selectionChanged().catch(() => {});
}
