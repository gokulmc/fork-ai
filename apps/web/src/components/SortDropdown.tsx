'use client';
import { useRouter } from 'next/navigation';

// Sort control for the blog index. The server reads ?sort and renders the order;
// this just navigates. `current` comes from the server so no useSearchParams /
// Suspense boundary is needed.
export function SortDropdown({ current }: { current: 'views' | 'latest' }) {
  const router = useRouter();
  return (
    <select
      className="blog-sort"
      value={current}
      onChange={(e) => router.push(`/blog?sort=${e.target.value}`)}
      aria-label="Sort posts"
    >
      <option value="views">Most viewed</option>
      <option value="latest">Latest</option>
    </select>
  );
}
