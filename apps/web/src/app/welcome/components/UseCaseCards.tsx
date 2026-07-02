'use client';
import { FileText, Map, Bookmark } from '@/components/Icons';
import { useInView } from './useInView';

const CARDS = [
  {
    icon: FileText,
    title: 'Students',
    body: 'Coursework, problem sets, and papers due at 11:59pm. Ask, branch, and keep what matters — without forty browser tabs.',
  },
  {
    icon: Map,
    title: 'Researchers',
    body: 'Literature reviews, methodology deep-dives, comparing papers. Keep every thread traceable back to the exact question or quote that started it.',
  },
  {
    icon: Bookmark,
    title: 'Notion & PKM users',
    body: 'Already living in Notion, Obsidian, or a Zettelkasten? Research sessions land as structured pages and diagrams — not a transcript you’ll never reopen.',
  },
];

// Beat: zoom out from Alex to who else this is for.
export function UseCaseCards() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Who it&rsquo;s for</div>
        <h2 className="wp-h2">Alex isn&rsquo;t the only one</h2>
        <div className="wp-usecase-grid">
          {CARDS.map(c => (
            <div key={c.title} className="wp-usecase-card">
              <c.icon size={20} />
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
