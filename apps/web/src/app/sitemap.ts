import type { MetadataRoute } from 'next';
import { POST_LIST } from '@/content/blog';
import { listPublishedPosts } from '@/lib/api';

const SITE = 'https://forkai.in';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/welcome`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE}/blog`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE}/privacy-policy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const posts: MetadataRoute.Sitemap = POST_LIST.map((p) => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: p.updated ?? p.date,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  const published = await listPublishedPosts();
  const community: MetadataRoute.Sitemap = published.map((p) => ({
    url: `${SITE}/blog/${p.slug}`,
    lastModified: p.createdAt,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...posts, ...community];
}
