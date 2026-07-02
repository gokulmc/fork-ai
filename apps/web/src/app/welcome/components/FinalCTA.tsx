'use client';
import { ArrowRight, ArrowLeft } from '@/components/Icons';
import { CookiePreferencesLink } from '@/components/CookiePreferencesLink';

// Beat: close the loop with the same tagline the live app uses.
export function FinalCTA() {
  return (
    <section className="wp-final">
      <h2 className="wp-h2 wp-final-h2">
        Ask once. <em>Branch</em> forever.
      </h2>
      <a className="wp-btn wp-btn-primary wp-final-cta" href="/">
        Try fork.ai free <ArrowRight size={14} />
      </a>
      <div className="wp-final-foot">
        <a href="/" className="wp-final-back">
          <ArrowLeft size={13} /> Back to fork.ai
        </a>
        <span className="wp-final-links">
          <a href="/blog">Blog</a>
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms">Terms</a>
          <CookiePreferencesLink />
        </span>
      </div>
    </section>
  );
}
