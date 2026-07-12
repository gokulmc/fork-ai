import type { Metadata } from 'next';
import { StoryPage } from './components/StoryPage';

export const metadata: Metadata = {
  title: 'How forkai code works — for students & researchers',
  description: 'See how forkai code turns one question into a branching mind map — structured answers, go-deeper branches, live mind maps, and Notion export. Free to start, pay only for what you use.',
  alternates: { canonical: '/welcome' },
  openGraph: {
    type: 'website',
    title: 'forkai code — Ask once. Branch forever.',
    description: 'A branching research workspace for students and researchers. See it explained through a real research session.',
    url: 'https://code.forkai.in/welcome',
    images: ['/api/og'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'forkai code — Ask once. Branch forever.',
    description: 'A branching research workspace for students and researchers.',
  },
};

export default function Page() {
  return <StoryPage />;
}
