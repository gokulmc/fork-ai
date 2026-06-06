'use client';
import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';

export function Providers({ children }: { children: React.ReactNode }) {
  // iOS Safari ignores the viewport's user-scalable=no, so it still pinch-zooms
  // every page. Safari exposes its pinch through the non-standard `gesture*`
  // events — preventing them disables native page zoom document-wide. The mind
  // map drives its own zoom from raw touch events (not gesture events) and is
  // unaffected; per-surface `touch-action` already blocks pinch on the rest.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    document.addEventListener('gestureend', stop, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
      document.removeEventListener('gestureend', stop);
    };
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
