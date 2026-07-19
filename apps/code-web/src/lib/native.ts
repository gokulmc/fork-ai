// Typings for the native bridge Capacitor injects at document-start as
// `window.Capacitor.Plugins.*` in the Android/iOS app shell. This is the ONLY
// place in apps/code-web that declares `Window.Capacitor` — no @capacitor/*
// npm deps here, since the web app is loaded remotely by a thin native shell
// and must stay buildable/runnable standalone.
//
// Ported from apps/web/src/lib/native.ts — code-web only needs the push +
// haptics surface so far (no Filesystem/Share/App download helpers here).

export interface PluginListenerHandle {
  remove: () => Promise<void>;
}

export interface CapacitorHapticsPlugin {
  impact(options?: { style?: 'HEAVY' | 'MEDIUM' | 'LIGHT' }): Promise<void>;
  notification(options?: { type?: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
  selectionChanged(): Promise<void>;
}

export interface CapacitorPushPlugin {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register(): Promise<void>;
  // The injected runtime returns the listener handle SYNCHRONOUSLY; only
  // @capacitor/*'s npm wrapper promisifies it. Callers must Promise.resolve()
  // the result — calling .then() on it directly crashed the app shell in
  // apps/web (see its issues.md).
  addListener(
    eventName: 'registration',
    cb: (token: { value: string }) => void,
  ): PluginListenerHandle | Promise<PluginListenerHandle>;
}

declare global {
  interface Window {
    Capacitor?: {
      Plugins?: {
        Haptics?: CapacitorHapticsPlugin;
        PushNotifications?: CapacitorPushPlugin;
      };
    };
  }
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
