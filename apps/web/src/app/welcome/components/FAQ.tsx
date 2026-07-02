'use client';
import { useState } from 'react';
import { ChevronRight } from '@/components/Icons';
import { useInView } from './useInView';

const QUESTIONS = [
  {
    q: 'Do I need to sign up?',
    a: 'No — your first session is free, up to 5 nodes, no account needed. Sign up later and any guest branches you made are automatically yours.',
  },
  {
    q: 'Is the pricing calculator exact?',
    a: 'No — it’s an estimate based on a typical multi-section answer. Actual cost depends on question complexity and which model you pick per branch.',
  },
  {
    q: 'What happens when my credit runs out?',
    a: 'You can top up any time. Nothing is lost — your session stays saved, you just can’t create new branches until you add credit.',
  },
  {
    q: 'Can I export to Notion?',
    a: 'Yes — a whole session pushes as a real Notion page, with a mind-map diagram at the top and every branch as a collapsible section underneath.',
  },
  {
    q: 'Which AI models does fork.ai use?',
    a: 'Claude, Gemini, DeepSeek, and GLM — you pick the model for each branch. The first question always uses a fast default.',
  },
];

// Beat: none — this is the practical/skeptical-visitor section.
export function FAQ() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="wp-section">
      <div ref={ref} className={`wp-reveal ${inView ? 'wp-in-view' : ''}`}>
        <div className="wp-kicker">Questions</div>
        <h2 className="wp-h2">Frequently asked</h2>
        <div className="wp-faq">
          {QUESTIONS.map((item, i) => (
            <div key={item.q} className="wp-faq-item">
              <button
                type="button"
                className="wp-faq-q"
                onClick={() => setOpenIdx(v => (v === i ? null : i))}
                aria-expanded={openIdx === i}
              >
                <ChevronRight size={14} className={openIdx === i ? 'wp-chevron-open' : ''} />
                {item.q}
              </button>
              {openIdx === i && <p className="wp-faq-a">{item.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
