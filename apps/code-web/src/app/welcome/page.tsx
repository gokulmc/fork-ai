import type { Metadata } from 'next';
import { StoryPage } from './components/StoryPage';

export const metadata: Metadata = {
  title: 'How fork ai works — for students & researchers',
  description: 'See how fork ai turns one question into a branching mind map — structured answers, go-deeper branches, live mind maps, and Notion export. Free to start, pay only for what you use.',
  alternates: { canonical: '/welcome' },
  openGraph: {
    type: 'website',
    title: 'fork ai — Ask once. Branch forever.',
    description: 'A branching research workspace for students and researchers. See it explained through a real research session.',
    url: 'https://forkai.in/welcome',
    images: ['/api/og'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'fork ai — Ask once. Branch forever.',
    description: 'A branching research workspace for students and researchers.',
  },
};

export default function Page() {
  return <StoryPage />;
}
