import type { Page } from '@playwright/test';
import { MockApi } from './mock-api';
import { mockAuth, type AuthMock } from './auth';
import { fullSession, userProfile, SID } from './data';

/**
 * Pre-seed localStorage before any page script runs.
 * - consent: suppress the cookie banner (it can intercept clicks)
 * - visited: `fork.ai.visited` decides whether a logged-out user sees
 *   LoginPage (returning) or Landing (new visitor)
 */
export async function primeStorage(
  page: Page,
  opts: { visited?: boolean; storage?: Record<string, string> } = {},
) {
  const { visited = true, storage = {} } = opts;
  await page.addInitScript(args => {
    try {
      localStorage.setItem('fork.ai.consent', 'granted');
      // Suppress the iOS/mobile PWA "Add to home screen" sheet — it overlays the
      // workspace and intercepts taps (InstallPrompt reads this sessionStorage key).
      sessionStorage.setItem('fork.ai.installDismissed', '1');
      if (args.visited) localStorage.setItem('fork.ai.visited', '1');
      for (const [k, v] of Object.entries(args.storage)) localStorage.setItem(k, v);
    } catch { /* storage may be unavailable in rare contexts */ }
  }, { visited, storage });
}

/** Default mocks every authed test needs (overridable via .on() afterwards — later registrations win). */
export function baseApi(): MockApi {
  return new MockApi()
    .on('GET /users/me', userProfile())
    .on('GET /sessions', [])
    .on(`GET /sessions/${SID}/share`, { active: false });
}

/**
 * Boot the app logged-in with an existing session restored from localStorage
 * (`fork.ai.session` / `fork.ai.node`) — the path every real refresh takes.
 * A URL `#hash` alone does NOT survive to the restore effect: the `view`
 * effect rewrites the URL to the bare pathname on first commit, before auth
 * settles. Returns once the workspace shows a node title.
 */
export async function gotoWorkspace(
  page: Page,
  api: MockApi,
  opts: { session?: Record<string, unknown>; nodeId?: string } = {},
): Promise<AuthMock> {
  const session = opts.session ?? fullSession();
  const sid = session.sessionId as string;
  api.on(`GET /sessions/${sid}`, session);
  const auth = await mockAuth(page);
  await primeStorage(page, {
    storage: {
      'fork.ai.session': sid,
      ...(opts.nodeId ? { 'fork.ai.node': opts.nodeId } : {}),
    },
  });
  await api.install(page);
  await page.goto('/');
  await page.locator('.ws-title').waitFor({ state: 'visible' });
  return auth;
}

/**
 * Programmatically select `[startChar, endChar)` of a section's rendered text
 * and fire mouseup — the exact signal App.tsx's selection effect listens for.
 * Playwright mouse-drag selection is flaky across fonts/wrapping; this is not.
 */
export async function selectSectionText(
  page: Page,
  sectionId: string,
  startChar: number,
  endChar: number,
): Promise<string> {
  // <Section> is code-split (next/dynamic) — the title paints before the
  // section bodies mount, so wait for the actual element first.
  await page.locator(`.section-body[data-section-id="${sectionId}"]`).waitFor({ state: 'visible' });
  const selected = await page.evaluate(({ sectionId, startChar, endChar }) => {
    const el = document.querySelector(`.section-body[data-section-id="${sectionId}"]`);
    if (!el) throw new Error(`section-body ${sectionId} not found`);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = new Range();
    let pos = 0, started = false;
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const len = (n.nodeValue ?? '').length;
      if (!started && pos + len > startChar) { range.setStart(n, startChar - pos); started = true; }
      if (started && pos + len >= endChar) { range.setEnd(n, endChar - pos); break; }
      pos += len;
    }
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return sel.toString();
  }, { sectionId, startChar, endChar });
  // App.tsx defers reading the selection by 10ms — wait for the menu to appear.
  await page.locator('.hl-menu--visible').waitFor({ state: 'visible' });
  return selected;
}

/** Open the Ask-AI follow-up popup from a fresh selection and submit a question. */
export async function askAiFromSelection(
  page: Page,
  sectionId: string,
  question: string,
  range: [number, number] = [0, 40],
) {
  await selectSectionText(page, sectionId, range[0], range[1]);
  await page.locator('.hl-menu--visible button', { hasText: 'Ask AI' }).click();
  const pop = page.locator('.followup-pop');
  await pop.waitFor({ state: 'visible' });
  await pop.locator('textarea').fill(question);
  await pop.locator('button.btn-primary').click();
}
