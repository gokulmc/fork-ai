'use client';
import { useRef } from 'react';
import { useSceneProgress } from '../useScrollProgress';

const BUBBLES: { role: 'user' | 'ai'; text: string }[] = [
  { role: 'user', text: 'rate limit my express api, per-user' },
  { role: 'ai', text: 'You could use express-rate-limit with a fixed window…' },
  { role: 'user', text: 'wait, what about multiple instances behind a load balancer' },
  { role: 'ai', text: 'Good question — you’d want a shared store like Redis…' },
  { role: 'user', text: 'going back to the sliding window thing —' },
];

export function Prologue() {
  const ref = useRef<HTMLElement>(null);
  useSceneProgress(ref);

  return (
    <section
      id="scene-prologue"
      data-time="1262"
      className="wp-scene wp-scene-prologue"
      ref={ref}
    >
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">SUN · 9:02 PM</span>
          <span className="wp-stamp-rule" />
        </div>

        <h1 className="wp-h1 wp-reveal">It&rsquo;s 9 PM. The rate limiter ships tomorrow.</h1>
        <p className="wp-sub wp-reveal">
          Alex has forty Stack Overflow tabs open, a chat that stopped making sense at message
          thirty, and a demo in twelve hours. The one diff that mattered is buried six edits deep.
        </p>

        <div className="wp-chat">
          {BUBBLES.map((b, i) => (
            <div key={i} className={`wp-bubble wp-bubble-${b.role}`}>
              {b.text}
            </div>
          ))}
        </div>
        <div className="wp-fade-line">⋯ 30 messages later, still scrolling</div>

        <p className="wp-closing-line">She closes the tab. Starts over — differently.</p>
      </div>
    </section>
  );
}
