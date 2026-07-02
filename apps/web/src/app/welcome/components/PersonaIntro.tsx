'use client';
import { useInView } from './useInView';

// Beat: what Alex tried before fork.ai, and why it stopped working.
export function PersonaIntro() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section id="persona-intro" className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Alex&rsquo;s first move</div>
        <h2 className="wp-h2">A chat tab, then a mess</h2>
        <p className="wp-lede">
          Alex&rsquo;s first move was the obvious one — a chat tab. The first answer was great.
          By message thirty she couldn&rsquo;t tell which reply was about socioeconomic
          moderators and which was about measurement methodology. Scrolling up cost her more
          time than writing would have.
        </p>

        <div className="wp-compare">
          <div className="wp-compare-col wp-compare-fade">
            <div className="wp-compare-label">Linear chat</div>
            <div className="wp-chat-mock">
              <div className="wp-chat-bubble wp-chat-user">green space + mental health, moderating factors?</div>
              <div className="wp-chat-bubble wp-chat-ai">Socioeconomic status significantly moderates…</div>
              <div className="wp-chat-bubble wp-chat-user">wait, what about measurement methods?</div>
              <div className="wp-chat-bubble wp-chat-ai">Good question — most studies use self-report…</div>
              <div className="wp-chat-bubble wp-chat-user">going back to the moderators thing —</div>
              <div className="wp-chat-ellipsis">⋯ 30 messages later, still scrolling</div>
            </div>
          </div>
          <div className="wp-compare-col">
            <div className="wp-compare-label">fork.ai</div>
            <div className="wp-branch-mock">
              <div className="wp-branch-node wp-branch-root">Root question</div>
              <div className="wp-branch-node">Moderating factors</div>
              <div className="wp-branch-node">Measurement methods</div>
              <div className="wp-branch-node">Open questions</div>
            </div>
            <p className="wp-compare-note">
              Every thread Alex opens becomes its own node — so she can go as deep as she
              wants on one idea without losing the rest.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
