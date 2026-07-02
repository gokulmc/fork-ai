'use client';
import { useState } from 'react';
import { Copy, Check } from '@/components/Icons';
import { useInView } from './useInView';

const FAKE_LINK = 'https://forkai.in/s/8f2a1c';

// Beat: Monday morning — the advisor opens the link and branches as a guest.
export function SharingDemo() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(FAKE_LINK);
    } catch {
      // Clipboard API unavailable in this context — the link is still visible/selectable.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Monday morning</div>
        <h2 className="wp-h2">Share the map, no account needed</h2>
        <p className="wp-lede">
          Alex sends the link to her advisor, who opens it and branches straight away — no
          login, no waiting.
        </p>
        <div className="wp-share-demo">
          <div className="wp-share-row">
            <input className="wp-share-input" readOnly value={FAKE_LINK} aria-label="Share link" />
            <button type="button" className="wp-btn wp-btn-ghost wp-share-copy" onClick={onCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="wp-share-avatars">
            <div className="wp-avatar">AL</div>
            <div className="wp-avatar wp-avatar-guest">AD</div>
            <div className="wp-share-avatars-label">Alex · Advisor (guest, no account)</div>
          </div>
        </div>
        <p className="wp-compare-note">
          If the advisor signs up later, anything they added on the shared map is automatically
          theirs. First session is free — up to 5 nodes before anyone&rsquo;s asked to log in.
        </p>
      </div>
    </section>
  );
}
