import type { MetadataRoute } from 'next';

const SITE = 'https://forkai.in';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    { url: `${SITE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/welcome`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE}/privacy-policy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
