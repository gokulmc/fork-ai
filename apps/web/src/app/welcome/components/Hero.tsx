'use client';
import { ArrowRight } from '@/components/Icons';
import { HeroMindMapSVG } from './HeroMindMapSVG';

// Beat: cold open — Alex, Sunday 9pm, 40 tabs, a chapter due Monday.
export function Hero() {
  return (
    <section className="wp-hero">
      <div className="wp-hero-copy">
        <div className="wp-eyebrow">A branching research workspace</div>
        <h1 className="wp-h1">
          It&rsquo;s 9pm. Alex has a literature review due Monday and forty tabs open.
        </h1>
        <p className="wp-hero-sub">This is what happens when she asks fork.ai instead.</p>
        <div className="wp-hero-ctas">
          <a className="wp-btn wp-btn-primary" href="/">
            Try it free <ArrowRight size={14} />
          </a>
          <a className="wp-btn wp-btn-ghost" href="#persona-intro">
            See how it works ↓
          </a>
        </div>
        <div className="wp-hero-foot">No signup needed for a first session</div>
      </div>
      <div className="wp-hero-visual">
        <HeroMindMapSVG />
      </div>
    </section>
  );
}
