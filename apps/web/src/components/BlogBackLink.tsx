'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

// Context-aware back link in the blog nav:
// - /blog/submissions       → back to the blog index
// - /blog/submit & posts    → back to wherever the user came from (history)
// - blog index / elsewhere  → back to the app
export function BlogBackLink() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/blog/submissions') {
    return <Link href="/blog">← Blog</Link>;
  }

  // Write-a-post and individual post pages (/blog/<slug>).
  if (pathname && pathname.startsWith('/blog/')) {
    return (
      <button
        type="button"
        className="blog-back-btn"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/blog');
        }}
      >
        ← Back
      </button>
    );
  }

  return <Link href="/">← fork ai</Link>;
}
