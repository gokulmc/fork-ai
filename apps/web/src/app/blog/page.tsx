import type { Metadata } from 'next';
import Link from 'next/link';
import { POST_LIST } from '@/content/blog';
import { listPublishedPosts, listBlogViews } from '@/lib/api';
import { SortDropdown } from '@/components/SortDropdown';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Essays on AI research, mind maps, LLM workflows, and turning questions into knowledge you can keep — from the team and community behind fork ai.',
  alternates: { canonical: '/blog' },
  openGraph: {
    type: 'website',
    title: 'fork ai blog',
    description: 'Essays on AI research, mind maps, and LLM workflows.',
    url: 'https://forkai.in/blog',
  },
};

// Sorted by live view counts, so the index is rendered per-request.
export const dynamic = 'force-dynamic';

interface Card {
  slug: string;
  emoji: string;
  title: string;
  description: string;
  date: string;
  views: number;
  kind: 'curated' | 'community';
  readingMinutes?: number;
}

function fmt(date: string): string {
  const d = new Date(date);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function snippet(s: string, n = 150): string {
  const t = s.replace(/[#>*_`~]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

export default async function BlogIndex({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const sortBy: 'views' | 'latest' = sort === 'latest' ? 'latest' : 'views';
  const [published, views] = await Promise.all([listPublishedPosts(), listBlogViews()]);

  const curated: Card[] = POST_LIST.map((p) => ({
    slug: p.slug,
    emoji: p.emoji,
    title: p.title,
    description: p.description,
    date: p.date,
    views: views[p.slug] ?? 0,
    kind: 'curated',
    readingMinutes: p.readingMinutes,
  }));

  const community: Card[] = published.map((p) => ({
    slug: p.slug,
    emoji: p.emoji || '📝',
    title: p.title,
    description: p.summary || snippet(p.body),
    date: p.createdAt,
    views: views[p.slug] ?? 0,
    kind: 'community',
  }));

  const all = [...curated, ...community].sort((a, b) =>
    sortBy === 'latest'
      ? a.date < b.date
        ? 1
        : a.date > b.date
          ? -1
          : 0
      : b.views - a.views || (a.date < b.date ? 1 : -1),
  );

  return (
    <article>
      <h1 className="blog-h">The fork ai blog</h1>
      <p className="blog-lede">
        Notes on AI research, mind maps, and the art of turning one question into a map of answers.
      </p>
      <div className="blog-sortbar">
        <SortDropdown current={sortBy} />
      </div>
      {all.map((p) => (
        <Link key={p.slug} href={`/blog/${p.slug}`} className="post-card">
          <h2><span className="post-card-emoji">{p.emoji}</span>{p.title}</h2>
          <p>{p.description}</p>
          <span className="meta">
            {p.kind === 'community' ? 'Community · ' : ''}
            {fmt(p.date)}
            {typeof p.readingMinutes === 'number' ? ` · ${p.readingMinutes} min read` : ''}
            {` · ${p.views.toLocaleString()} ${p.views === 1 ? 'view' : 'views'}`}
          </span>
        </Link>
      ))}
    </article>
  );
}
