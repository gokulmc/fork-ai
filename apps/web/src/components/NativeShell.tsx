'use client';
import { useEffect } from 'react';

interface PluginListenerHandle { remove: () => Promise<void>; }
interface CapacitorAppPlugin {
  addListener: (
    eventName: 'backButton',
    cb: (event: { canGoBack: boolean }) => void,
  ) => Promise<PluginListenerHandle>;
  minimizeApp: () => Promise<void>;
}
declare global {
  interface Window { Capacitor?: { Plugins?: { App?: CapacitorAppPlugin } }; }
}

export function NativeShell() {
  useEffect(() => {
    const app = window.Capacitor?.Plugins?.App;
    if (!app) return;                    // website or old shell build — inert
    let handle: PluginListenerHandle | null = null;
    let removed = false;
    void app.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void app.minimizeApp();       // minimize, don't kill
    }).then(h => { if (removed) void h.remove(); else handle = h; });
    return () => { removed = true; void handle?.remove(); };
  }, []);
  return null;
}
