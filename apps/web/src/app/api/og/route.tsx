import { brandCard } from '@/lib/og-card';

// Default site-wide OG image, referenced from layout.tsx metadata. Previously
// a file-convention app/opengraph-image.tsx — moved to a route handler because
// Next.js file-convention metadata overrides config-based openGraph.images
// (and cascades to every descendant route), which would have made the
// per-share image in page.tsx's generateMetadata unreachable.
export function GET() {
  return brandCard({
    title: 'Ask once. Branch forever.',
    subtitle: 'A branching AI research workspace — every answer becomes a map you can explore.',
  });
}
