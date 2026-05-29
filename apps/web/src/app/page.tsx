import { App } from '@/components/App';

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
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return FALLBACK_TOPICS;
    const data = (await res.json()) as { topics: string[] };
    return data.topics?.length ? data.topics : FALLBACK_TOPICS;
  } catch {
    return FALLBACK_TOPICS;
  }
}

export default async function Page() {
  const topics = await fetchTopics();
  return <App initialTopics={topics} />;
}
