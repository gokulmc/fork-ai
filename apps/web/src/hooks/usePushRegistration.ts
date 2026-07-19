import { useEffect, useRef } from 'react';
import { registerDevice } from '@/lib/api';
import type { PluginListenerHandle } from '@/lib/native';

// Registers for native push notifications once an authed session exists.
// No-ops on the website and on app builds without the PushNotifications
// plugin. Re-running on every app launch is correct: APNs tokens rotate,
// and iOS only shows the permission dialog once — later requestPermissions
// calls just resolve with the existing decision.
export function usePushRegistration(idToken: string | undefined): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    const push = window.Capacitor?.Plugins?.PushNotifications;
    if (!idToken || !push) return;

    let handle: PluginListenerHandle | null = null;
    let cancelled = false;

    // Attach the listener before requesting permissions so no registration
    // event can arrive before we're listening for it.
    Promise.resolve(
      push.addListener('registration', (token) => {
        if (cancelled || registeredRef.current) return;
        registeredRef.current = true;
        registerDevice(idToken, token.value).catch(() => {});
      }),
    ).then(h => { handle = h; });

    push.requestPermissions()
      .then(({ receive }) => { if (receive === 'granted' && !cancelled) return push.register(); })
      .catch(() => {});

    return () => {
      cancelled = true;
      // Promise.resolve() per the native.ts sync-listener caveat — the injected
      // runtime returns the handle synchronously, calling .then() on it directly
      // crashed the shell once.
      handle?.remove().catch(() => {});
    };
  }, [idToken]);
}
