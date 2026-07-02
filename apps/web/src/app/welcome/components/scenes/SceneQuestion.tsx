'use client';
import { useEffect, useRef, useState } from 'react';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { ROOT_QUERY, SECTIONS } from '../storyContent';

const TYPE_SPEED_MS = 28;

// Beat: Alex asks her real question and gets a structured, sectioned answer.
// The query types itself in, then sections stream in one by one — this is
// the moment the constellation gets its first star (the root question).
export function SceneQuestion() {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const { addNode } = useStory();

  const [typed, setTyped] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const [streamDone, setStreamDone] = useState(false);
  const [playId, setPlayId] = useState(0);
  const rootAddedRef = useRef(false);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    rootAddedRef.current = false;
    setTyped('');
    setTypingDone(false);
    setRevealedCount(0);
    setStreamDone(false);

    let i = 0;
    const typeNext = () => {
      if (cancelled) return;
      i += 1;
      setTyped(ROOT_QUERY.slice(0, i));
      if (i >= ROOT_QUERY.length) {
        setTypingDone(true);
        if (!rootAddedRef.current) {
          rootAddedRef.current = true;
          addNode({ id: 'root', parentId: null, label: 'Root question', kind: 'story' });
        }
        streamSections();
        return;
      }
      window.setTimeout(typeNext, TYPE_SPEED_MS);
    };

    const streamSections = () => {
      let n = 0;
      const revealNext = () => {
        if (cancelled) return;
        n += 1;
        setRevealedCount(n);
        if (n >= SECTIONS.length) {
          setStreamDone(true);
          return;
        }
        window.setTimeout(revealNext, 650);
      };
      window.setTimeout(revealNext, 500);
    };

    window.setTimeout(typeNext, 350);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, playId, addNode]);

  return (
    <section id="scene-question" data-time="1274" className="wp-scene wp-scene-question">
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">9:14 PM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">One question, asked differently.</h2>

        <div ref={ref} className={`wp-qbox-wrap ${inView ? 'wp-in-view' : ''}`}>
          <div className="wp-qbox">
            <span className="wp-qbox-text">{typed}</span>
            {!typingDone && <span className="wp-caret" />}
          </div>

          <div className="wp-demo-card">
            {SECTIONS.slice(0, revealedCount).map(s => (
              <div key={s.num} className="wp-demo-section wp-demo-section-in">
                <div className="wp-demo-section-heading">{s.num} · {s.heading}</div>
                <p>{s.body}</p>
              </div>
            ))}
            {typingDone && revealedCount < SECTIONS.length && (
              <div className="wp-thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          {streamDone && (
            <button
              type="button"
              className="wp-btn-outline wp-replay-btn"
              onClick={() => setPlayId(id => id + 1)}
            >
              ↺ Replay
            </button>
          )}

          {streamDone && (
            <p className="wp-why">№1 — A research flow you can&rsquo;t get lost in. Sections, not scroll.</p>
          )}
        </div>
      </div>
    </section>
  );
}
