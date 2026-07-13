import type { Metadata } from 'next';
import { StoryPage } from './components/StoryPage';

export const metadata: Metadata = {
  title: 'How forkai code works — plan-first AI coding agent',
  description: 'See how forkai code turns one task into a plan, a branching map of concepts and commits, and one reviewable PR at a time — no mega-diffs. Free to start, pay only for what you use.',
  alternates: { canonical: '/welcome' },
  openGraph: {
    type: 'website',
    title: 'forkai code — Ask once. Branch forever.',
    description: 'A plan-first AI coding-agent workspace. See it explained through a real coding session — from task to reviewed PR.',
    url: 'https://code.forkai.in/welcome',
    images: ['/api/og'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'forkai code — Ask once. Branch forever.',
    description: 'A plan-first AI coding-agent workspace, explained end to end.',
  },
};

export default function Page() {
  return <StoryPage />;
}
