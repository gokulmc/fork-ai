import { App } from '@/components/App';
import { auth } from '@/auth';

// Static code-flavored examples for the query box — code-api has no /topics
// endpoint (that was a fork.ai-research-only route, stripped from this fork;
// see issues.md).
const EXAMPLE_TOPICS = [
  'Add rate limiting to my API',
  'Set up JWT auth on this Express app',
  'Migrate this class component to hooks',
  'Add retry logic around this API call',
];

export default async function Page() {
  // auth() reads the Cognito session cookie server-side (JWT verify, no DB call).
  // initiallyAuthed lets App render the SSR-crawlable hero for logged-out
  // visitors while keeping the neutral loading spinner for returning users.
  const session = await auth();
  return <App initialTopics={EXAMPLE_TOPICS} initiallyAuthed={!!session} />;
}
