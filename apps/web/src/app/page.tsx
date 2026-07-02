import type { Metadata } from 'next';
import { App } from '@/components/App';
import { auth } from '@/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const FALLBACK_TOPICS = [
  'How do neural networks actually learn?',
  'What caused the fall of the Roman Republic?',
  'Explain the theory of plate tectonics',
  'How does mRNA vaccine technology work?',
];

async function fetchTopics(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/topics`, { cache: 'no-store' });
    if (!res.ok) return FALLBACK_TOPICS;
    const data = (await res.json()) as { topics: string[] };
    return data.topics?.length ? data.topics : FALLBACK_TOPICS;
  } catch {
    return FALLBACK_TOPICS;
  }
}

// Overrides the site-wide metadata (title/description/OG/Twitter) when the
// page is a share link (?sk=<token>), so it unfurls with the session's own
// title, LLM-generated hook, and mind-map cover image. Any failure (invalid
// token, revoked share, slow API) returns {}, leaving layout.tsx's defaults.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ sk?: string }>;
}): Promise<Metadata> {
  const { sk } = await searchParams;
  if (!sk || !SHARE_TOKEN_RE.test(sk)) return {};

  try {
    const res = await fetch(`${API_BASE}/share/${sk}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return {};
    const s = await res.json();
    const hook: string = s.shareHook || s.lede || '';
    const title = `${s.emoji ? `${s.emoji} ` : ''}${s.title}`;
    // scale=2 (2400x1260) for a crisper preview on retina displays — still
    // well under every platform's OG image size limit (~50-120KB either way).
    const ogImage = `/api/og/share/${encodeURIComponent(sk)}?scale=2`;
    return {
      title,
      description: hook || undefined,
      openGraph: {
        // No `url` here — Next's resolver collapses any URL whose pathname is
        // "/" (true for every share link, since ?sk= lives on the root path)
        // down to the bare origin, which would misrepresent the share link as
        // forkai.in. og:url is optional per the OG spec; omitting it lets
        // crawlers fall back to the actual fetched URL.
        type: 'website',
        siteName: 'fork ai',
        locale: 'en_US',
        title,
        description: hook || undefined,
        images: [{ url: ogImage, width: 2400, height: 1260, alt: title }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description: hook || undefined,
        images: [ogImage],
      },
    };
  } catch {
    return {};
  }
}

export default async function Page() {
  // auth() reads the Cognito session cookie server-side (JWT verify, no DB call).
  // initiallyAuthed lets App render the SSR-crawlable hero for logged-out
  // visitors while keeping the neutral loading spinner for returning users.
  const [topics, session] = await Promise.all([fetchTopics(), auth()]);
  return <App initialTopics={topics} initiallyAuthed={!!session} />;
}
