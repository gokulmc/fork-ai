import { App } from '@/components/App';
import { auth } from '@/auth';

const FALLBACK_TOPICS = [
  'How do neural networks actually learn?',
  'What caused the fall of the Roman Republic?',
  'Explain the theory of plate tectonics',
  'How does mRNA vaccine technology work?',
];

async function fetchTopics(): Promise<string[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'}/topics`,
      { cache: 'no-store' },
    );
    if (!res.ok) return FALLBACK_TOPICS;
    const data = (await res.json()) as { topics: string[] };
    return data.topics?.length ? data.topics : FALLBACK_TOPICS;
  } catch {
    return FALLBACK_TOPICS;
  }
}

export default async function Page() {
  // auth() reads the Cognito session cookie server-side (JWT verify, no DB call).
  // initiallyAuthed lets App render the SSR-crawlable hero for logged-out
  // visitors while keeping the neutral loading spinner for returning users.
  const [topics, session] = await Promise.all([fetchTopics(), auth()]);
  return <App initialTopics={topics} initiallyAuthed={!!session} />;
}
