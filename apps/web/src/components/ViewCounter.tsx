'use client';
import { useEffect, useState } from 'react';
import { getBlogViewCount, incrementBlogView } from '@/lib/api';

// Displays a post's view count and increments it once per browser session.
// Works for both curated (static) and community (dynamic) post pages.
export function ViewCounter({ slug }: { slug: string }) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    const key = `fork.ai.viewed.${slug}`;
    let counted = false;
    try {
      counted = !!sessionStorage.getItem(key);
      if (!counted) sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked — just count it */
    }
    (counted ? getBlogViewCount(slug) : incrementBlogView(slug)).then(setViews);
  }, [slug]);

  if (views === null) return null;
  return <>{views.toLocaleString()} {views === 1 ? 'view' : 'views'}</>;
}
