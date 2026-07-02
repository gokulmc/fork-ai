'use client';
import { useRef } from 'react';
import { useSceneProgress } from '../useScrollProgress';

const BUBBLES: { role: 'user' | 'ai'; text: string }[] = [
  { role: 'user', text: 'green space + mental health, moderating factors?' },
  { role: 'ai', text: 'Socioeconomic status significantly moderates…' },
  { role: 'user', text: 'wait, what about measurement methods?' },
  { role: 'ai', text: 'Good question — most studies use self-report…' },
  { role: 'user', text: 'going back to the moderators thing —' },
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

        <h1 className="wp-h1 wp-reveal">It&rsquo;s 9 PM. The literature review is due Monday.</h1>
        <p className="wp-sub wp-reveal">
          Alex has forty tabs, a chat that stopped making sense at message thirty, and six hours
          of battery. The one answer that mattered is buried four tangents deep.
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
