import { brandCard } from '@/lib/og-card';

export { size, contentType } from '@/lib/og-card';
export const alt = 'fork ai — a branching AI research workspace';

export default function Image() {
  return brandCard({
    title: 'Ask once. Branch forever.',
    subtitle: 'A branching AI research workspace — every answer becomes a map you can explore.',
  });
}
