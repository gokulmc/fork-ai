'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { listMyBlogSubmissions } from '@/lib/api';

// Appears next to "Write a post" only for logged-in users who have submitted at
// least one post. Links to their personal submissions page.
export function MySubmissionsLink() {
  const { data: session, status } = useSession();
  const idToken = (session as { idToken?: string } | null)?.idToken ?? '';
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !idToken) return;
    let alive = true;
    listMyBlogSubmissions(idToken)
      .then((s) => { if (alive) setCount(s.length); })
      .catch(() => {});
    return () => { alive = false; };
  }, [status, idToken]);

  if (!count) return null; // hidden while loading, logged out, or none submitted
  return (
    <Link href="/blog/submissions" className="blog-nav-mine">
      📋 My posts ({count})
    </Link>
  );
}
