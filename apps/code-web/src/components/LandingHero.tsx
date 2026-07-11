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
        <div className="landing-mark">Plan-first coding, by you</div>
        <h1>Program like an actual programmer.<em>One shot never works.</em></h1>
        <p className="landing-sub">
          Learn the concepts, synthesize a plan, then watch the agent commit one focused step at a
          time — reviewable, branchable, never a single unreviewable mega-diff.
        </p>
        <div className="query-box">
          <span className="icon"><Search size={20} /></span>
          <input type="text" placeholder="Try: add rate limiting to my API" readOnly />
        </div>
      </div>
      <div className="landing-foot">
        FORKAI CODE · V0.2 · PLAN-FIRST CODING, BY YOU
        <span className="landing-foot-links">
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms">Terms</a>
        </span>
      </div>
    </div>
  );
}
