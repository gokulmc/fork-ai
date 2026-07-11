'use client';

// "Cookie preferences" control — re-opens the consent banner so users can
// change or withdraw their choice. Renders nothing when analytics aren't
// configured (no GA id → no cookies to manage).
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export function CookiePreferencesLink({ className, style }: { className?: string; style?: React.CSSProperties }) {
  if (!GA_ID) return null;
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={() => window.dispatchEvent(new Event('forkai:cookie-preferences'))}
    >
      Cookie preferences
    </button>
  );
}
