import Link from 'next/link';
import { ThemeScript } from '@/components/ThemeScript';
import { MySubmissionsLink } from '@/components/MySubmissionsLink';
import { BlogBackLink } from '@/components/BlogBackLink';

// Shared chrome + typography for the blog. Server component — fully static.
// Uses the app's design tokens (globals.css :root / [data-theme]) so the blog
// matches the rest of the app, including dark mode via the ThemeScript bootstrap.
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      <div className="blog-overlay">
        <style>{`
        .blog-overlay {
          position: fixed; inset: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
          background: var(--bg); padding: 40px 16px 96px;
          font-family: var(--sans); color: var(--ink);
        }
        .blog-wrap { width: 100%; max-width: 720px; margin: 0 auto; }
        .blog-nav {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 40px;
          font-family: var(--mono);
          font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
        }
        .blog-nav a { color: var(--ink-3); text-decoration: none; }
        .blog-nav a:hover { color: var(--ink); }
        .blog-back-btn {
          background: none; border: 0; padding: 0; cursor: pointer;
          font: inherit; letter-spacing: inherit; text-transform: inherit;
          color: var(--ink-3);
        }
        .blog-back-btn:hover { color: var(--ink); }
        .blog-nav-right { display: flex; align-items: center; gap: 14px; }
        .blog-sortbar { display: flex; justify-content: flex-end; margin: 0 0 18px; }
        .blog-sort {
          font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em;
          color: var(--ink); background: var(--paper);
          border: 1px solid var(--line-strong); border-radius: var(--radius);
          padding: 6px 28px 6px 10px; cursor: pointer;
          -webkit-appearance: none; appearance: none;
          background-image: linear-gradient(45deg, transparent 50%, var(--ink-3) 50%), linear-gradient(135deg, var(--ink-3) 50%, transparent 50%);
          background-position: calc(100% - 14px) 51%, calc(100% - 9px) 51%;
          background-size: 5px 5px, 5px 5px;
          background-repeat: no-repeat;
        }
        .blog-sort:hover { border-color: var(--ink-3); }
        .blog-nav a.blog-nav-write {
          color: var(--ink);
          border: 1px solid var(--line-strong);
          border-radius: var(--radius);
          padding: 7px 12px;
        }
        .blog-nav a.blog-nav-write:hover { background: var(--hover); color: var(--ink); }

        /* Index */
        .blog-h { font-family: var(--serif); font-weight: 400; font-size: 38px; line-height: 1.15; letter-spacing: -0.01em; margin: 0 0 8px; color: var(--ink); }
        .blog-lede { font-size: 16px; color: var(--ink-2); line-height: 1.6; margin: 0 0 40px; max-width: 60ch; }
        .post-card { display: block; padding: 22px 0; border-top: 1px solid var(--line); text-decoration: none; color: inherit; }
        .post-card:last-child { border-bottom: 1px solid var(--line); }
        .post-card h2 { font-family: var(--serif); font-weight: 400; font-size: 22px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.005em; color: var(--ink); }
        .post-card-emoji { font-family: "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif; margin-right: 10px; }
        .post-card:hover h2 { text-decoration: underline; }
        .post-card p { font-size: 14.5px; color: var(--ink-2); line-height: 1.55; margin: 0 0 8px; }
        .post-card .meta { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }

        /* Article */
        .post { font-size: 17px; line-height: 1.72; color: var(--ink); }
        .post-emoji { font-size: 44px; line-height: 1; margin: 0 0 16px; font-family: "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif; }
        .post h1 { font-family: var(--serif); font-weight: 400; font-size: 40px; line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 14px; color: var(--ink); }
        .post .post-meta { font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 40px; }
        .post h2 { font-family: var(--serif); font-weight: 400; font-size: 27px; line-height: 1.2; letter-spacing: -0.01em; margin: 44px 0 12px; color: var(--ink); }
        .post h2 a, .post h3 a { color: inherit; text-decoration: none; }
        .post h3 { font-size: 19px; font-weight: 600; margin: 30px 0 8px; color: var(--ink); }
        .post p { margin: 0 0 20px; }
        .post ul, .post ol { padding-left: 22px; margin: 0 0 20px; }
        .post li { margin: 0 0 8px; }
        .post a { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--line-strong); }
        .post a:hover { text-decoration-color: var(--ink); }
        .post strong { font-weight: 600; }
        .post code { font-family: var(--mono); font-size: 0.86em; background: var(--panel); padding: 1px 5px; border-radius: var(--radius-sm); }
        .post blockquote { margin: 0 0 20px; padding: 4px 0 4px 18px; border-left: 2px solid var(--line-strong); color: var(--ink-2); font-style: italic; }
        .post hr { border: 0; border-top: 1px solid var(--line); margin: 36px 0; }
        .post figure { margin: 30px 0 28px; }
        .post img { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--radius-lg); }
        .post figcaption { font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; color: var(--ink-3); margin-top: 10px; text-align: center; }
        .post .post-sources { font-size: 13.5px; color: var(--ink-3); line-height: 1.6; }

        /* End-of-post CTA */
        .post-cta { margin-top: 48px; padding: 28px 30px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg); }
        .post-cta p { margin: 0 0 14px; font-size: 15.5px; color: var(--ink-2); }
        .post-cta a.btn {
          display: inline-block; background: var(--ink); color: var(--bg); text-decoration: none;
          font-family: var(--mono); font-size: 11px;
          letter-spacing: 0.1em; text-transform: uppercase; padding: 11px 20px; border-radius: var(--radius);
        }

        @media (max-width: 768px) {
          .blog-overlay { padding: 28px 20px 80px; }
          .blog-h, .post h1 { font-size: 32px; }
        }
      `}</style>
        <div className="blog-wrap">
          <nav className="blog-nav">
            <BlogBackLink />
            <span className="blog-nav-right">
              <MySubmissionsLink />
              <Link href="/blog/submit" className="blog-nav-write">✍ Write a post</Link>
            </span>
          </nav>
          {children}
        </div>
      </div>
    </>
  );
}
