'use client';
import { useState, useEffect, useCallback } from 'react';
import { shareApi } from '@/lib/api';
import { Link, LinkOff } from './Icons';

interface Props {
  sessionId: string;
  idToken: string;
}

type State = 'idle' | 'loading' | 'active' | 'copied' | 'revoking';

export function ShareButton({ sessionId, idToken }: Props) {
  const [state, setState] = useState<State>('idle');
  const [token, setToken] = useState<string | null>(null);

  // Load existing share status on mount / when session changes
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    shareApi.getShareStatus(idToken, sessionId)
      .then(({ active, token: t }) => {
        if (cancelled) return;
        if (active && t) { setToken(t); setState('active'); }
        else setState('idle');
      })
      .catch(() => { if (!cancelled) setState('idle'); });
    return () => { cancelled = true; };
  }, [sessionId, idToken]);

  const handleShare = useCallback(async () => {
    if (state === 'active' && token) {
      // Copy existing link
      const url = `${window.location.origin}/?sk=${token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      setState('copied');
      setTimeout(() => setState('active'), 1500);
      return;
    }

    setState('loading');
    let mintedToken = '';
    try {
      // navigator.clipboard.write() must be invoked synchronously within the
      // click's user-activation window. Safari (and modern Chrome) revoke that
      // window the instant an `await` yields back to the event loop — which
      // happens here while the token is minted over the network — so a plain
      // `await ... ; await navigator.clipboard.writeText(url)` silently fails
      // on the first click and only succeeds on a second click (no network
      // delay before the write on the already-active fast path above).
      // Passing a Promise<Blob> to ClipboardItem is the documented workaround:
      // the write() call itself stays inside the gesture while the promise
      // (which mints the token) resolves asynchronously.
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': (async () => {
              const { token: newToken } = await shareApi.generateShareToken(idToken, sessionId);
              mintedToken = newToken;
              return new Blob([`${window.location.origin}/?sk=${newToken}`], { type: 'text/plain' });
            })(),
          }),
        ]);
      } else {
        const { token: newToken } = await shareApi.generateShareToken(idToken, sessionId);
        mintedToken = newToken;
        await navigator.clipboard.writeText(`${window.location.origin}/?sk=${newToken}`);
      }
      setToken(mintedToken);
      setState('copied');
      setTimeout(() => setState('active'), 1500);
    } catch {
      if (mintedToken) {
        // Token minted fine; only the clipboard write failed — the link still
        // works, it just wasn't auto-copied.
        setToken(mintedToken);
        setState('active');
      } else {
        setState('idle');
      }
    }
  }, [state, token, idToken, sessionId]);

  const handleRevoke = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState('revoking');
    try {
      await shareApi.revokeShareToken(idToken, sessionId);
      setToken(null);
      setState('idle');
    } catch {
      setState('active');
    }
  }, [idToken, sessionId]);

  if (state === 'loading' || state === 'revoking') {
    return (
      <button className="icon-btn" disabled title="Share">
        <Link size={14} /> <span className="spinner-sm" />
      </button>
    );
  }

  if (state === 'copied') {
    return (
      <button className="icon-btn share-btn--active" title="Link copied">
        <Link size={14} /> Copied!
      </button>
    );
  }

  if (state === 'active') {
    return (
      <span className="share-btn-group">
        <button className="icon-btn share-btn--active" onClick={handleShare} title="Copy share link">
          <Link size={14} /> Shared
        </button>
        <button className="icon-btn share-btn--stop" onClick={handleRevoke} title="Stop sharing">
          <LinkOff size={14} />
        </button>
      </span>
    );
  }

  return (
    <button className="icon-btn" onClick={handleShare} title="Share this session">
      <Link size={14} /> Share
    </button>
  );
}
