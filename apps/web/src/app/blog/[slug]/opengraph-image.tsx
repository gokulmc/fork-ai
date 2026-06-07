import { brandCard } from '@/lib/og-card';
import { POSTS } from '@/content/blog';
import { getPublishedPost } from '@/lib/api';

export { size, contentType } from '@/lib/og-card';
export const alt = 'fork ai blog';

export function generateStaticParams() {
  return Object.keys(POSTS).map((slug) => ({ slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let title = POSTS[slug]?.meta.title;
  if (!title) {
    const community = await getPublishedPost(slug);
    title = community?.title ?? 'fork ai';
  }
  return brandCard({ eyebrow: 'fork ai blog', title });
}
