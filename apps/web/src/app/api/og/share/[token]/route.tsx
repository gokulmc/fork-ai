import { brandCard } from '@/lib/og-card';
import { shareCard, ShareSession, SHARE_OG_CACHE_CONTROL } from '@/lib/og-share-card';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

// Crawlers that already cached this image URL must always get a valid PNG —
// invalid/revoked tokens and upstream failures fall back to the generic
// brand card, never a 4xx/5xx.
function fallbackCard() {
  return brandCard({
    title: 'Ask once. Branch forever.',
    subtitle: 'A branching AI research workspace — every answer becomes a map you can explore.',
    headers: { 'Cache-Control': SHARE_OG_CACHE_CONTROL },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return fallbackCard();

  // Crawlers get the standard 1200×630; the Share button's download link asks
  // for scale=2 so the saved file looks crisp used elsewhere (LinkedIn post,
  // print). Clamped to keep render cost/output size bounded.
  const requestedScale = Number(new URL(req.url).searchParams.get('scale'));
  const scale = Number.isFinite(requestedScale) ? Math.min(3, Math.max(1, Math.round(requestedScale))) : 1;

  try {
    const res = await fetch(`${API_BASE}/share/${token}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return fallbackCard();
    const session = (await res.json()) as ShareSession;
    return shareCard(session, scale);
  } catch {
    return fallbackCard();
  }
}
