'use client';
import { useEffect, useState } from 'react';

// Chrome's beforeinstallprompt is not in the standard lib types.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'fork.ai.installDismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari uses the non-standard navigator.standalone.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// iOS has no beforeinstallprompt — installing is a manual Share → Add to Home
// Screen flow, and only Safari can do it (Chrome/Firefox on iOS cannot).
function isIosSafari() {
  const ua = window.navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = !/crios|fxios|edgios/i.test(ua);
  return ios && safari;
}

export function InstallPrompt() {
  // 'android' = native prompt available; 'ios' = manual instructions; null = hidden.
  const [mode, setMode] = useState<'android' | 'ios' | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Register the service worker (required for the Android install prompt).
    // Production only — in dev the cache-first /_next/static/* strategy can
    // serve a stale JS bundle across recompiles, since dev chunk URLs don't
    // change the way content-hashed prod URLs do.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // sessionStorage (not local): dismissing hides it for this visit but it
    // returns on the next fresh launch — and never once actually installed.
    if (isStandalone() || sessionStorage.getItem(DISMISS_KEY)) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's default mini-infobar; we show our own UI
      setDeferred(e as BeforeInstallPromptEvent);
      setMode('android');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS never fires the event, so surface the manual hint after a short delay.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) t = setTimeout(() => setMode('ios'), 2500);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setMode(null);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setMode(null);
  };

  return (
    <div className="install-sheet" role="dialog" aria-label="Add fork ai to your home screen">
      <img className="install-icon" src="/icon-192.png" alt="" width={44} height={44} />
      <div className="install-body">
        <div className="install-title">Add fork ai to your Home Screen</div>
        {mode === 'ios' ? (
          <div className="install-sub">
            Tap the Share button, then <strong>Add to Home Screen</strong>.
          </div>
        ) : (
          <div className="install-sub">Install the app for a full-screen, native feel.</div>
        )}
      </div>
      <div className="install-actions">
        <button className="install-x" onClick={dismiss}>{mode === 'ios' ? 'Got it' : 'Not now'}</button>
        {mode === 'android' && (
          <button className="install-go" onClick={install}>Install</button>
        )}
      </div>
    </div>
  );
}
