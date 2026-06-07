import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { POSTS } from '@/content/blog';
import { getPublishedPost } from '@/lib/api';
import { renderUserMarkdown } from '@/lib/markdown';
import { ViewCounter } from '@/components/ViewCounter';

const SITE = 'https://forkai.in';

// Curated MDX slugs are pre-rendered; approved community slugs render on demand.
export function generateStaticParams() {
  return Object.keys(POSTS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const curated = POSTS[slug];
  if (curated) {
    const { meta } = curated;
    return {
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
      alternates: { canonical: `/blog/${meta.slug}` },
      openGraph: {
        type: 'article',
        title: meta.title,
        description: meta.description,
        url: `${SITE}/blog/${meta.slug}`,
        publishedTime: meta.date,
        modifiedTime: meta.updated ?? meta.date,
      },
      twitter: { card: 'summary_large_image', title: meta.title, description: meta.description },
    };
  }

  const community = await getPublishedPost(slug);
  if (!community) return {};
  const description = community.summary || community.title;
  return {
    title: community.title,
    description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: 'article',
      title: community.title,
      description,
      url: `${SITE}/blog/${slug}`,
      publishedTime: community.createdAt,
    },
    twitter: { card: 'summary_large_image', title: community.title, description },
  };
}

function fmt(date: string): string {
  const d = new Date(date.length <= 10 ? `${date}T00:00:00Z` : date);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const curated = POSTS[slug];

  // ── Curated MDX post ────────────────────────────────────────────────────────
  if (curated) {
    const { meta } = curated;
    const { default: Body } = await curated.load();
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          headline: meta.title,
          description: meta.description,
          datePublished: meta.date,
          dateModified: meta.updated ?? meta.date,
          author: { '@type': 'Organization', name: 'fork ai', url: SITE },
          publisher: { '@type': 'Organization', name: 'fork ai', logo: { '@type': 'ImageObject', url: `${SITE}/mark-168.png` } },
          image: `${SITE}/blog/${meta.slug}/opengraph-image`,
          mainEntityOfPage: `${SITE}/blog/${meta.slug}`,
          keywords: meta.keywords.join(', '),
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Blog', item: `${SITE}/blog` },
            { '@type': 'ListItem', position: 2, name: meta.title, item: `${SITE}/blog/${meta.slug}` },
          ],
        },
      ],
    };

    return (
      <article className="post">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <div className="post-emoji">{meta.emoji}</div>
        <h1>{meta.title}</h1>
        <p className="post-meta">
          {fmt(meta.date)} · {meta.readingMinutes} min read · <ViewCounter slug={slug} />
        </p>
        <Body />
        <div className="post-cta">
          <p>fork ai turns any question into a branching map you can explore, highlight, and keep. Try it free.</p>
          <Link className="btn" href="/">Start researching →</Link>
        </div>
      </article>
    );
  }

  // ── Community (user-submitted, approved) post ───────────────────────────────
  const community = await getPublishedPost(slug);
  if (!community) notFound();
  const html = renderUserMarkdown(community.body);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: community.title,
        description: community.summary || community.title,
        datePublished: community.createdAt,
        author: { '@type': 'Organization', name: 'fork ai community', url: SITE },
        publisher: { '@type': 'Organization', name: 'fork ai', logo: { '@type': 'ImageObject', url: `${SITE}/mark-168.png` } },
        image: `${SITE}/blog/${slug}/opengraph-image`,
        mainEntityOfPage: `${SITE}/blog/${slug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Blog', item: `${SITE}/blog` },
          { '@type': 'ListItem', position: 2, name: community.title, item: `${SITE}/blog/${slug}` },
        ],
      },
    ],
  };

  return (
    <article className="post">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="post-emoji">{community.emoji}</div>
      <h1>{community.title}</h1>
      <p className="post-meta">
        Community · {fmt(community.createdAt)} · <ViewCounter slug={slug} />
      </p>
      {community.summary && (
        <p style={{ fontSize: 19, color: 'var(--ink-2)', fontStyle: 'italic', margin: '0 0 26px' }}>{community.summary}</p>
      )}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <div className="post-cta">
        <p>fork ai turns any question into a branching map you can explore, highlight, and keep. Try it free.</p>
        <Link className="btn" href="/">Start researching →</Link>
      </div>
    </article>
  );
}
