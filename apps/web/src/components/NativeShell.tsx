'use client';
import { useEffect } from 'react';
import type { PluginListenerHandle } from '@/lib/native';

export function NativeShell() {
  useEffect(() => {
    const app = window.Capacitor?.Plugins?.App;
    if (!app) return;                    // website or old shell build — inert
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    // The raw injected bridge returns the listener handle SYNCHRONOUSLY —
    // only @capacitor/app's npm wrapper promisifies it. Calling .then() on it
    // directly threw in the mount effect and crashed the whole app to the
    // root error boundary on every launch. Promise.resolve() accepts both.
    void Promise.resolve(
      app.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else void app.minimizeApp();     // minimize, don't kill
      }),
    ).then(h => { if (removed) void h?.remove?.(); else handle = h; });
    return () => { removed = true; void handle?.remove?.(); };
  }, []);
  return null;
}
