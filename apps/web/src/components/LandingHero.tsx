import { Search } from './Icons';

// Static, server-renderable hero. Shown as the logged-out loading state so the
// landing value proposition is present in the initial HTML for crawlers (App is
// a client component whose useSession() is 'loading' during SSR, which otherwise
// renders only a spinner). The interactive Landing replaces it the instant the
// auth status resolves. Logged-in returning users never see this — App keeps the
// neutral spinner for them so there's no landing flash while their session loads.
export function LandingHero() {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="landing-mark">A branching research workspace</div>
        <h1>Ask once. <em>Branch</em> forever.</h1>
        <p className="landing-sub">
          Type a question. Get an answer split into sections you can dive deeper into, highlight,
          and branch from. Every detour becomes a node on your mind map.
        </p>
        <div className="query-box">
          <span className="icon"><Search size={20} /></span>
          <input type="text" placeholder="Try: how does photosynthesis work?" readOnly />
        </div>
      </div>
      <div className="landing-foot">
        FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU
        <span className="landing-foot-links">
          <a href="/blog">Blog</a>
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms">Terms</a>
        </span>
      </div>
    </div>
  );
}
