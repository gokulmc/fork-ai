'use client';
import { useEffect, useState } from 'react';
import Script from 'next/script';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const KEY = 'fork.ai.consent';

// GA4 loads ONLY after explicit consent (GDPR-friendly, and consistent with the
// privacy policy). Renders nothing at all when no GA id is configured.
export function CookieConsent() {
  // undefined = not yet read from localStorage (avoids hydration mismatch);
  // null = undecided (show banner); 'granted' | 'denied' = decided.
  const [consent, setConsent] = useState<'granted' | 'denied' | null | undefined>(undefined);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    setConsent(stored === 'granted' || stored === 'denied' ? stored : null);
  }, []);

  // Re-open the banner so users can change/withdraw consent (fired by the
  // "Cookie preferences" link in the footer / privacy policy).
  useEffect(() => {
    const reopen = () => setConsent(null);
    window.addEventListener('forkai:cookie-preferences', reopen);
    return () => window.removeEventListener('forkai:cookie-preferences', reopen);
  }, []);

  if (!GA_ID || consent === undefined || consent === 'denied') return null;

  const decide = (value: 'granted' | 'denied') => {
    const prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, value);
    setConsent(value);
    // Withdrawing previously-granted consent: drop GA cookies and reload so the
    // analytics scripts fully unload.
    if (prev === 'granted' && value === 'denied') {
      document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0].trim();
        if (name.startsWith('_ga')) document.cookie = `${name}=; Max-Age=0; path=/`;
      });
      window.location.reload();
    }
  };

  return (
    <>
      {consent === 'granted' && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
          </Script>
        </>
      )}

      {consent === null && (
        <div
          role="dialog"
          aria-label="Cookie consent"
          style={{
            position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 9999,
            margin: '0 auto', maxWidth: 560,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            background: 'var(--paper)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-3)', padding: '14px 16px',
            fontFamily: 'var(--sans)',
            fontSize: 13, lineHeight: 1.5, color: 'var(--ink)',
          }}
        >
          <span style={{ flex: 1, minWidth: 220, color: 'var(--ink-2)' }}>
            We use privacy-friendly analytics to improve fork ai. No tracking until you accept.{' '}
            <a href="/privacy-policy" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
              Learn more
            </a>
            .
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => decide('denied')} style={btn(false)}>Decline</button>
            <button onClick={() => decide('granted')} style={btn(true)}>Accept</button>
          </div>
        </div>
      )}
    </>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    fontFamily: 'var(--mono)',
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    padding: '8px 14px', borderRadius: 'var(--radius)',
    border: primary ? '0' : '1px solid var(--line-strong)',
    background: primary ? 'var(--ink)' : 'transparent',
    color: primary ? 'var(--bg)' : 'var(--ink-2)',
  };
}
