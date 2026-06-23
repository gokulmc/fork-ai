'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSession, signOut, getSession as getAuthSession } from 'next-auth/react';
import type { ForkNode, Annotation, HlMenuState, FollowUpState, ContextMenuState, PersistentHighlight, HighlightRecord } from '@/lib/types';
import { uid, short5, stripMarkdown, stripCite, getRangeOffsets, modelDisplayName, cleanHeading } from '@/lib/utils';
import { rangeToMarkdown } from '@/lib/htmlToMarkdown';

const CSS_HL_SUPPORTED = typeof window !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS;

// One CSS named highlight per bg+fg combination so each color is independently styled
const HL_BG = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e5e5e5'];
const HL_FG = [null, '#b91c1c', '#1d4ed8', '#047857'];

// Reserved style for text that spawned an Ask-AI branch — a glow/lift rather than a
// flat fill (see ::highlight(fork-hl-branch) in globals.css). Stored as the highlight's
// bg so it renders consistently regardless of the last picked colour; never offered in
// the colour picker.
const BRANCH_HL = 'branch';

function hlName(bg: string | null, fg: string | null | undefined): string {
  const b = (bg ?? '#fef08a').replace('#', '');
  const f = (fg ?? null)?.replace('#', '') ?? null;
  return f ? `fork-hl-${b}-${f}` : `fork-hl-${b}`;
}

const ALL_HL_NAMES = [...HL_BG.flatMap(bg => HL_FG.map(fg => hlName(bg, fg))), hlName(BRANCH_HL, null)];

function rangeFromOffsets(root: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let pos = 0;
  let startNode: Text | null = null, startOff = 0;
  let endNode: Text | null = null, endOff = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = (t.nodeValue ?? '').length;
    if (!startNode && pos + len > start) { startNode = t; startOff = start - pos; }
    if (startNode && pos + len >= end) { endNode = t; endOff = end - pos; break; }
    pos += len;
  }
  if (!startNode || !endNode) return null;
  const r = new Range();
  r.setStart(startNode, startOff);
  r.setEnd(endNode, endOff);
  return r;
}

// Map an API failure to error-banner copy + status. The status drives the CTA:
// 402/429 without auth → "Log in", anything else retryable → "Retry".
function nodeErrorDisplay(err: unknown, isGuestReq: boolean): { msg: string; status?: number; code?: string } {
  if (err instanceof ApiError) {
    if (err.status === 402) {
      return {
        msg: isGuestReq ? 'Trial limit reached — log in to keep exploring' : 'Out of credit — open Billing to recharge',
        status: 402,
      };
    }
    if (err.status === 429 && /throttler/i.test(err.message)) {
      return { msg: 'Too many requests — please wait a minute', status: 429 };
    }
    if (err.message) return { msg: err.message, status: err.status, code: err.code };
  }
  return { msg: 'Failed to load' };
}

// Retry context for a failed LLM node, keyed by the failed node's id.
type RetryInfo =
  | { kind: 'ROOT'; query: string }
  | { kind: 'DEEPER'; parentNodeId: string; section: { id: string; heading: string; body: string }; boost?: boolean }
  | { kind: 'ASK'; question: string; source: FollowUpState; boost?: boolean };
import { useTweaks } from '@/hooks/useTweaks';
import { initAnalytics, track, identifyUser } from '@/lib/analytics';
import { getCachedSession, putCachedSession, deleteCachedSession } from '@/lib/sessionCache';
import { buildNotionClipboard } from '@/lib/notion-clipboard';
import {
  listSessions,
  getSession,
  createSessionStream,
  createTrialSessionStream,
  createNode,
  renameNode as apiRenameNode,
  setNodeStar as apiSetNodeStar,
  deleteNode as apiDeleteNode,
  createAnnotation,
  deleteAnnotation as apiDeleteAnnotation,
  createHighlight,
  toForkNode,
  toAnnotation,
  toHlMap,
  toHighlightRecords,
  deleteHighlight,
  getNotionStatus,
  getNotionAuthUrl,
  searchNotionPages,
  pushToNotion,
  updateSessionNotionUrl,
  setUnauthorizedHandler,
  setSessionRefresher,
  shareApi,
  getMe,
  patchMe,
  registerReferral,
  ApiError,
  type SessionSummary,
  type NotionPage,
} from '@/lib/api';
import { OnboardingTour } from './OnboardingTour';
import { SkeletonSections } from './SkeletonSections';
import { HighlightMenu } from './HighlightMenu';
import { FollowUpPop } from './FollowUpPop';
import { NotesDrawer } from './NotesDrawer';
import { Landing } from './Landing';
import { LandingHero } from './LandingHero';
import { LoginPage } from './LoginPage';
import { HistoryPage } from './HistoryPage';
import { TweaksPanel } from './TweaksPanel';
import { AccountButton } from './AccountButton';
import { ShareButton } from './ShareButton';
import { MindMapPill } from './MindMapPill';
import {
  Search, Bookmark, ChevronRight, Sparkles, CornerDownRight, Hash,
  Quote, AlertCircle, ArrowUpRight, Pencil, Trash, Clock, LogIn,
} from './Icons';

// Code-split the session-only heavyweights out of the initial bundle: Section
// drags in marked + katex + highlight.js (~300KB) and MindMap the SVG engine —
// none of it is needed to paint Landing/History. Loaded on first session render.
const Section = dynamic(() => import('./Section').then(m => m.Section), { ssr: false });
const MindMap = dynamic(() => import('./MindMap').then(m => m.MindMap), {
  ssr: false,
  loading: () => <div className="mm-empty">Loading map…</div>,
});

const TWEAK_DEFAULTS = {
  theme: 'light' as const,
  accent: '#525252',
  density: 'compact' as const,
  mapLayout: 'vertical' as const,
  fontPair: 'newsreader-geist',
  answerStyle: 'verbose' as const,
  maxSections: 6,
  webSearch: true,
  branchModel: 'haiku' as const,
};

const FONT_PAIRS: Record<string, { serif: string; sans: string; label: string }> = {
  'newsreader-geist': { serif: '"Newsreader", Georgia, serif', sans: '"Geist", system-ui, sans-serif', label: 'Newsreader + Geist' },
  'spectral-inter':   { serif: '"Spectral", Georgia, serif',   sans: '"DM Sans", system-ui, sans-serif',    label: 'Spectral + DM Sans' },
  'fraunces-mono':    { serif: '"Fraunces", Georgia, serif',   sans: '"IBM Plex Sans", system-ui, sans-serif', label: 'Fraunces + Plex' },
};

const FONT_PAIR_OPTIONS = Object.entries(FONT_PAIRS).map(([v, p]) => ({ value: v, label: p.label }));

function ResearchingScreen({ sessions }: { sessions: SessionSummary[] }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (sessions.length < 2) return;
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % sessions.length);
        setVisible(true);
      }, 350);
    }, 2800);
    return () => clearInterval(timer);
  }, [sessions.length]);

  const s = sessions[idx];

  return (
    <div className="auth-screen">
      <div className="researching-wrap">
        <div className="researching-spinner">
          <span className="spinner-lg" />
          <span className="researching-label">Thinking…</span>
        </div>
        {s && (
          <div className={`researching-card${visible ? ' visible' : ''}`}>
            <span className="session-card-emoji">{s.emoji}</span>
            <div className="session-card-body">
              <div className="session-card-title">{s.title}</div>
              <div className="session-card-lede">{stripCite(s.lede)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// True when the viewport is phone-sized (matches the globals.css @media breakpoint).
// Starts false so server render and desktop agree; flips after mount on a phone.
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function App({ initialTopics = [], initiallyAuthed = false }: { initialTopics?: string[]; initiallyAuthed?: boolean }) {
  const { data: authSession, status } = useSession();
  const idToken = authSession?.idToken ?? '';

  // Guest mode — set from ?sk= query param or localStorage trial token on mount; cleared after claim
  const [guestToken, setGuestToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const sk = new URLSearchParams(window.location.search).get('sk');
    if (sk) return sk;
    return localStorage.getItem('fork.ai.trial');
  });
  const [invalidLink, setInvalidLink] = useState(false);
  const [invalidLinkCountdown, setInvalidLinkCountdown] = useState(3);

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useState<'landing' | 'history'>(() => {
    if (typeof window === 'undefined') return 'landing';
    return new URLSearchParams(window.location.search).get('view') === 'history' ? 'history' : 'landing';
  });
  const [showLogin, setShowLogin] = useState(false);
  // Set when a guest explicitly chooses to sign in mid-session (e.g. clicks
  // "Login to Save"). Overrides the guest-token bypass on the login gate so
  // LoginPage renders even while guestToken is set. Cleared once the guest is
  // authenticated, at which point the claim effect runs.
  const [forceLogin, setForceLogin] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  // Show login whenever a previously-authenticated user's session is unauthenticated (covers logout → re-login).
  // New visitors (no fork.ai.visited in localStorage) go to Landing instead.
  useEffect(() => {
    if (status === 'unauthenticated' && !!localStorage.getItem('fork.ai.visited')) setShowLogin(true);
  }, [status]);

  // Capture ?ref= referral slug from URL into localStorage on mount so it
  // survives Google OAuth redirects and the trial → signup flow.
  useEffect(() => {
    const refSlug = new URLSearchParams(window.location.search).get('ref');
    if (refSlug) localStorage.setItem('fork.ai.referral', refSlug);
  }, []);

  // Auto sign-out on a 401 — but only after a token-refresh retry fails (see setSessionRefresher).
  useEffect(() => { setUnauthorizedHandler(() => void signOut()); }, []);
  // On a 401, apiFetch first asks for a fresh id_token and retries. getSession() forces a
  // /api/auth/session fetch → the jwt callback refreshes an expired token → returns the new one,
  // so a stale-token 401 mid-use recovers silently instead of bouncing the user to login.
  useEffect(() => { setSessionRefresher(async () => (await getAuthSession())?.idToken ?? null); }, []);

  // PostHog — no-op without NEXT_PUBLIC_POSTHOG_KEY
  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => {
    if (status === 'authenticated' && authSession?.user?.email) {
      identifyUser(authSession.user.email, authSession.user.email);
    }
  }, [status, authSession?.user?.email]);

  // Sign out when the refresh token itself has expired (30-day limit reached)
  useEffect(() => { if (authSession?.error === 'RefreshTokenExpired') void signOut(); }, [authSession?.error]);

  // Keep ?view=history in the URL so refresh lands on the right page
  useEffect(() => {
    if (view === 'history') {
      history.replaceState(null, '', '?view=history');
    } else {
      const params = new URLSearchParams(window.location.search);
      params.delete('view');
      const qs = params.toString();
      history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    }
  }, [view]);

  // Session list (shown on history page)
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Active research session
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, ForkNode>>({});
  const [rootId, setRootId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Nodes the user has read — active for ≥2s (debounced). Drives the bold
  // corner-bracket marker on the mind map. Persisted per session in localStorage.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  // Start in loading state if hash, localStorage, or ?sk= share token present — prevents landing flash on refresh
  const [loadingRoot, setLoadingRoot] = useState(() => {
    if (typeof window === 'undefined') return false;
    const hasSk = !!new URLSearchParams(window.location.search).get('sk');
    const hasTrial = !!localStorage.getItem('fork.ai.trial');
    return !!(window.location.hash.slice(1) || localStorage.getItem('fork.ai.session') || hasSk || hasTrial);
  });
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [sectionLoading, setSectionLoading] = useState<string | null>(null);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [hlMenu, setHlMenu] = useState<HlMenuState | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Transient "Ask AI" pill revealed by hovering/tapping the active node's title.
  // Auto-hides 5s after the last reveal; never persisted (resets on refresh).
  const [titleAskVisible, setTitleAskVisible] = useState(false);
  const titleAskTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleAskBtnRef = useRef<HTMLButtonElement>(null);
  const revealTitleAsk = useCallback(() => {
    setTitleAskVisible(true);
    if (titleAskTimer.current) clearTimeout(titleAskTimer.current);
    titleAskTimer.current = setTimeout(() => setTitleAskVisible(false), 5000);
  }, []);
  useEffect(() => () => { if (titleAskTimer.current) clearTimeout(titleAskTimer.current); }, []);
  useEffect(() => { setTitleAskVisible(false); }, [activeId]);

  const [persistentHl, setPersistentHl] = useState<Record<string, PersistentHighlight[]>>({});
  const [highlightsList, setHighlightsList] = useState<HighlightRecord[]>([]);
  const [lastHlColors, setLastHlColors] = useState<{ bg: string; fg: string | null }>({ bg: '#fef08a', fg: null });

  const [notionPickerOpen, setNotionPickerOpen] = useState(false);
  const [notionPages, setNotionPages] = useState<NotionPage[]>([]);
  const [notionPagesLoading, setNotionPagesLoading] = useState(false);
  const [notionQuery, setNotionQuery] = useState('');
  const [notionSaving, setNotionSaving] = useState(false);
  const [notionSavedUrl, setNotionSavedUrl] = useState<string | null>(null);
  const [notionError, setNotionError] = useState<string | null>(null);

  // Onboarding tour — default true to suppress flash before API responds
  const [hasOnboarded, setHasOnboarded] = useState(true);
  const [tourPhase, setTourPhase] = useState<'landing' | 'session'>('landing');

  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [rootQueryOutOfCredit, setRootQueryOutOfCredit] = useState(false);

  const wsRef = useRef<HTMLElement>(null);
  const wsInnerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);

  // Always-current refs so branch callbacks never close over stale sessionId / guestToken.
  // useCallback re-creation lags one render behind state commits in some codepaths.
  const sessionIdRef = useRef(sessionId);
  const guestTokenRef = useRef(guestToken);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { guestTokenRef.current = guestToken; }, [guestToken]);
  // The branch/root-query callbacks intentionally omit `tweaks` from their deps
  // (so they aren't recreated on every tweak change). Read the live values through
  // a ref to avoid a stale closure that would send the previously-selected
  // model / sectionCount / webSearch.
  const tweaksRef = useRef(tweaks);
  useEffect(() => { tweaksRef.current = tweaks; }, [tweaks]);

  // Read once — stable across renders.
  const initSplitRef = useRef(
    typeof window !== 'undefined'
      ? (() => { const s = Number(localStorage.getItem('fork.ai.split')); return s >= 30 && s <= 60 ? s : 36; })()
      : 36,
  );

  // Re-run when rootId changes so we catch the moment the .app div actually mounts.
  useLayoutEffect(() => {
    appRef.current?.style.setProperty('--map-width', `${initSplitRef.current}%`);
  }, [rootId]);

  // ── Mobile / narrow-viewport: hide the mind map behind a toggle ─────────────
  // The mind-map pane is hidden by default on narrow screens (CSS @media); the
  // floating pill swaps to a full-screen map. Init false so SSR/desktop match.
  const isNarrow = useIsNarrow();
  const [mapOpen, setMapOpen] = useState(false);

  // `Section` is code-split (next/dynamic), so on a cold session load the
  // highlight layout-effect below runs before any `.section-body` exists and
  // finds nothing to paint — and none of its other deps change when the chunk
  // later mounts. Flip this once the chunk is loaded so the effect re-runs after
  // the section DOM is committed; otherwise saved highlights stay invisible
  // until the first selection nudges `hlMenu`.
  const [sectionReady, setSectionReady] = useState(false);
  useEffect(() => { import('./Section').then(() => setSectionReady(true)).catch(() => {}); }, []);
  // Reset the swap whenever we leave narrow mode or the session empties.
  useEffect(() => { if (!isNarrow || Object.keys(nodes).length === 0) setMapOpen(false); }, [isNarrow, nodes]);

  // Left-edge swipe-right slides the mind map in, tracking the finger (drawer
  // reveal), then settles open/closed on release. The gesture starts on an
  // invisible edge zone (.mm-swipe-zone) so text selection can't hijack it.
  // Closing stays on the pill so we don't fight the map's own pan gesture.
  const mapPaneRef = useRef<HTMLElement | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeDx = useRef(0);

  const onSwipeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    swipeStart.current = { x: e.clientX, y: e.clientY };
    swipeDx.current = 0;
    if (mapPaneRef.current) mapPaneRef.current.style.transition = 'none'; // follow finger 1:1
  }, []);
  const onSwipeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeStart.current, pane = mapPaneRef.current;
    if (!s || !pane) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (swipeDx.current === 0 && Math.abs(dy) > Math.abs(dx)) return; // mostly vertical → let it scroll
    const w = window.innerWidth;
    const clamped = Math.max(0, Math.min(dx, w));
    swipeDx.current = clamped;
    pane.style.transform = `translateX(${(clamped / w - 1) * 100}%)`;
  }, []);
  const onSwipeEnd = useCallback(() => {
    const pane = mapPaneRef.current;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1;
    const open = swipeDx.current > w * 0.3; // past ~⅓ → settle open
    if (pane) { pane.style.transition = ''; pane.style.transform = open ? 'translateX(0)' : 'translateX(-100%)'; }
    swipeStart.current = null; swipeDx.current = 0;
    setMapOpen(open);
  }, []);

  // Keep the pane's slide position in sync with mapOpen for pill-driven toggles,
  // and clear the inline transform on desktop so the normal grid pane is restored.
  useEffect(() => {
    const pane = mapPaneRef.current;
    if (!pane) return;
    if (!isNarrow) { pane.style.transform = ''; pane.style.transition = ''; return; }
    pane.style.transform = mapOpen ? 'translateX(0)' : 'translateX(-100%)';
  }, [mapOpen, isNarrow]);

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.setAttribute('data-resizing', '1');
  }, []);

  const onDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !appRef.current) return;
    const rect = appRef.current.getBoundingClientRect();
    const clamped = Math.min(60, Math.max(30, (e.clientX - rect.left) / rect.width * 100));
    // Direct DOM mutation — zero React re-renders, eliminates node-position jitter.
    appRef.current.style.setProperty('--map-width', `${clamped.toFixed(2)}%`);
  }, []);

  const onDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.removeAttribute('data-resizing');
    if (!appRef.current) return;
    const current = parseFloat(appRef.current.style.getPropertyValue('--map-width') || '36');
    localStorage.setItem('fork.ai.split', String(Math.round(current)));
  }, []);

  // ── Apply tweaks to document root ────────────────────────────────────────

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', tweaks.theme);
    root.setAttribute('data-density', tweaks.density);
    root.style.setProperty('--accent', tweaks.accent);
    const pair = FONT_PAIRS[tweaks.fontPair] ?? FONT_PAIRS['newsreader-geist'];
    root.style.setProperty('--serif', pair.serif);
    root.style.setProperty('--sans', pair.sans);
  }, [tweaks]);

  // ── Load session list + onboarding state once idToken is available ──────────

  useEffect(() => {
    if (!idToken) return;
    setLoadingSessions(true);
    listSessions(idToken)
      .then(setSessions)
      .catch(err => console.error('Failed to load sessions', err))
      .finally(() => setLoadingSessions(false));
  }, [idToken]);

  const hasRegisteredReferralRef = useRef(false);
  useEffect(() => {
    if (!idToken) return;
    getMe(idToken)
      .then(me => {
        setHasOnboarded(me.hasOnboarded ?? false);
        setCreditBalance(me.creditUsd ?? null);
        // Register referral AFTER upsert completes (getMe triggers upsert server-side).
        // Running this inside then() prevents the race where POST /users/me/referrer
        // arrives before the user record exists and recordReferral exits early.
        if (!hasRegisteredReferralRef.current) {
          const stored = localStorage.getItem('fork.ai.referral');
          if (stored) {
            hasRegisteredReferralRef.current = true;
            registerReferral(idToken, stored)
              .then(() => localStorage.removeItem('fork.ai.referral'))
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [idToken]);

  // Cache-first balance refresh: re-reads the live balance after a billed op so the
  // account/billing panels reflect spend instead of a stale once-at-login value.
  // Only overwrites on success — a failed refetch leaves the last-known balance intact.
  const refreshCredit = useCallback(() => {
    if (!idToken) return;
    getMe(idToken)
      .then(me => setCreditBalance(me.creditUsd ?? null))
      .catch(() => {});
  }, [idToken]);

  // Transition tour to session phase when workspace first loads
  useEffect(() => {
    if (rootId && tourPhase === 'landing') setTourPhase('session');
  }, [rootId, tourPhase]);

  const scrollWsTop = useCallback(() => {
    requestAnimationFrame(() => {
      wsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  // ── Rehydrate a session from the API ─────────────────────────────────────

  // Tracks whether the workspace has already been painted from IndexedDB so
  // loadSession can skip the loadingRoot flash when auth settles later.
  const hasCachePaintedRef = useRef(false);

  // Pre-auth cache paint: reads IndexedDB before useSession() settles (~1.5s delay).
  // On a warm cache this makes the workspace visible in <300ms instead of ~2.5s.
  // The auth-gated loadSession still runs afterwards to get the authoritative API data.
  useEffect(() => {
    const savedSession = localStorage.getItem('fork.ai.session');
    if (!savedSession) return;
    getCachedSession(savedSession).then(cached => {
      if (!cached || !Object.keys(cached.nodes).length) return;
      if (hasCachePaintedRef.current) return; // auth-gated path beat us
      hasCachePaintedRef.current = true;
      const savedNode = localStorage.getItem('fork.ai.node') ?? undefined;
      const activeTarget = (savedNode && cached.nodes[savedNode]) ? savedNode : cached.rootId;
      setSessionId(cached.sessionId);
      setNodes(cached.nodes);
      setRootId(cached.rootId);
      setActiveId(activeTarget);
      setAnnotations(cached.annotations);
      setPersistentHl(cached.persistentHl);
      setHighlightsList(cached.highlightsList);
      setNotionSavedUrl(cached.notionPageUrl);
      setLoadingRoot(false);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally once on mount

  const loadSession = useCallback(async (sid: string, targetNodeId?: string) => {
    // Skip the loading overlay if the early-paint already showed the workspace.
    if (!hasCachePaintedRef.current) setLoadingRoot(true);
    // Cache-first: paint the last local snapshot instantly (IndexedDB), then let
    // the network result below — always authoritative — replace it when it lands.
    let paintedFromCache = false;
    try {
      const cached = await getCachedSession(sid);
      if (cached && Object.keys(cached.nodes).length) {
        const activeTarget = (targetNodeId && cached.nodes[targetNodeId]) ? targetNodeId : cached.rootId;
        hasCachePaintedRef.current = true;
        setSessionId(cached.sessionId);
        setNodes(cached.nodes);
        setRootId(cached.rootId);
        setActiveId(activeTarget);
        setAnnotations(cached.annotations);
        setPersistentHl(cached.persistentHl);
        setHighlightsList(cached.highlightsList);
        setNotionSavedUrl(cached.notionPageUrl);
        setLoadingRoot(false);
        paintedFromCache = true;
      }
    } catch { /* cache is best-effort — fall through to the network */ }
    try {
      const session = await getSession(idToken, sid);
      const forkNodes = session.nodes.map(toForkNode);
      const nodeMap: Record<string, ForkNode> = {};
      for (const n of forkNodes) nodeMap[n.id] = n;
      const root = forkNodes.find(n => n.parentId === null);
      const activeTarget = (targetNodeId && nodeMap[targetNodeId]) ? targetNodeId : (root?.id ?? null);
      setSessionId(session.sessionId);
      setNodes(nodeMap);
      setRootId(root?.id ?? null);
      // Don't yank the user off a node they navigated to while the cache copy
      // was showing — keep the current node if it still exists server-side.
      setActiveId(prev => (prev && nodeMap[prev]) ? prev : activeTarget);
      setAnnotations(session.annotations.map(toAnnotation));
      setPersistentHl(toHlMap(session.highlights));
      setHighlightsList(toHighlightRecords(session.highlights, nodeMap));
      setNotionSavedUrl(session.notionPageUrl ?? null);
    } catch (err) {
      console.error('Failed to load session', err);
      // A stale stored session id that no longer loads (deleted / not ours) would
      // otherwise re-fail on every visit and strand the loader — clear the pointer
      // so we self-heal to Landing. Only on a definitive 404/403, not a network blip.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        localStorage.removeItem('fork.ai.session');
        localStorage.removeItem('fork.ai.node');
        deleteCachedSession(sid).catch(() => {});
        // The session is gone server-side — drop the ghost we painted from cache.
        if (paintedFromCache) {
          setSessionId(null); setNodes({}); setRootId(null); setActiveId(null);
        }
      }
    } finally {
      setLoadingRoot(false);
    }
  }, [idToken]);


  // When a guest logs in while a guestToken is active, claim the session then reload it under their auth
  const hasClaimedRef = useRef(false);
  useEffect(() => {
    if (status !== 'authenticated' || !idToken || !guestToken || hasClaimedRef.current) return;
    hasClaimedRef.current = true;
    shareApi.claimSession(guestToken, idToken)
      .then(summary => {
        localStorage.removeItem('fork.ai.trial');
        setGuestToken(null);
        setIsTrial(false);
        track('guest_claimed');
        return loadSession(summary.sessionId);
      })
      .catch(err => console.error('Failed to claim session after login', err));
  }, [status, idToken, guestToken, loadSession]);

  // ── Persist active session to URL hash + localStorage (survive refresh) ────

  // Track whether we've ever had a session this mount — only clear storage on
  // explicit navigation away (not on cold mount where sessionId starts as null).
  const hadSessionRef = useRef(false);
  useEffect(() => {
    if (sessionId) {
      hadSessionRef.current = true;
      const hash = `${sessionId}${activeId && activeId !== rootId ? `/${activeId}` : ''}`;
      history.replaceState(null, '', `#${hash}`);
      localStorage.setItem('fork.ai.session', sessionId);
      if (activeId) localStorage.setItem('fork.ai.node', activeId);
    } else if (hadSessionRef.current) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      localStorage.removeItem('fork.ai.session');
      localStorage.removeItem('fork.ai.node');
    }
  }, [sessionId, activeId, rootId]);

  // Write-through local snapshot (IndexedDB): keep the device copy current as
  // sections stream in and branches/highlights change, so the next launch paints
  // instantly from cache. Loading/optimistic nodes are stripped — their temp ids
  // don't exist server-side and a restored spinner would hang forever.
  useEffect(() => {
    if (!sessionId || !rootId || !nodes[rootId]) return;
    const t = setTimeout(() => {
      const settled: Record<string, ForkNode> = {};
      for (const [id, n] of Object.entries(nodes)) {
        if (!n.loading) settled[id] = n;
      }
      if (!settled[rootId]) return;
      putCachedSession({
        sessionId, rootId, nodes: settled, annotations, persistentHl, highlightsList,
        notionPageUrl: notionSavedUrl, savedAt: Date.now(),
      }).catch(() => {});
    }, 400); // debounce: streaming sections update `nodes` rapidly
    return () => clearTimeout(t);
  }, [sessionId, rootId, nodes, annotations, persistentHl, highlightsList, notionSavedUrl]);

  // Restore "read" markers for the active session (reset on session switch).
  useEffect(() => {
    if (!sessionId) { setReadIds(new Set()); return; }
    try {
      const raw = localStorage.getItem(`fork.ai.read::${sessionId}`);
      setReadIds(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setReadIds(new Set()); }
  }, [sessionId]);

  // Mark a node "read" once it has stayed the active node for ≥5s (debounced).
  useEffect(() => {
    if (!activeId || !sessionId) return;
    const id = activeId;
    const t = setTimeout(() => {
      setReadIds(prev => {
        if (prev.has(id)) return prev;
        const next = new Set(prev).add(id);
        try { localStorage.setItem(`fork.ai.read::${sessionId}`, JSON.stringify([...next])); } catch { /* quota */ }
        return next;
      });
    }, 5000);
    return () => clearTimeout(t);
  }, [activeId, sessionId]);

  // Restore on first load — prefer URL hash, fall back to localStorage
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (status !== 'authenticated' || !idToken) return;
    if (hasRestoredRef.current) return;
    const hash = window.location.hash.slice(1);
    if (hash) {
      const [sid, nid] = hash.split('/');
      if (sid) { hasRestoredRef.current = true; loadSession(sid, nid); return; }
    }
    const savedSession = localStorage.getItem('fork.ai.session');
    const savedNode = localStorage.getItem('fork.ai.node') ?? undefined;
    if (!savedSession) return;
    hasRestoredRef.current = true;
    loadSession(savedSession, savedNode);
  }, [status, idToken, loadSession]);

  // Safety net: loadingRoot is initialised true whenever a stored key/hash exists,
  // but no restore effect runs once auth settles to logged-out — without this the
  // ResearchingScreen would hang forever (the "stuck loading until I clear storage" bug).
  useEffect(() => {
    if (status === 'unauthenticated' && !guestToken) setLoadingRoot(false);
  }, [status, guestToken]);

  // ── Guest mode: load shared session via ?sk= token ───────────────────────
  // The ?sk= token stays in the URL so refresh keeps the guest in the session.
  // The token is the share link by design — anyone with the URL already has
  // access — so keeping it visible is not a leak.
  const hasLoadedShareRef = useRef(false);
  useEffect(() => {
    if (!guestToken || hasLoadedShareRef.current || status === 'loading') return;
    hasLoadedShareRef.current = true;

    if (status === 'authenticated' && idToken) {
      // Already logged in — claim immediately then load via normal auth path
      shareApi.claimSession(guestToken, idToken)
        .then(summary => {
          localStorage.removeItem('fork.ai.trial');
          setGuestToken(null);
          setIsTrial(false);
          return loadSession(summary.sessionId);
        })
        .catch(err => {
          console.error('Failed to claim shared session', err);
          setLoadingRoot(false);
        });
    } else {
      // Guest (unauthenticated) — load directly via share token
      setLoadingRoot(true);
      shareApi.getSession(guestToken)
        .then(session => {
          const forkNodes = session.nodes.map(toForkNode);
          const nodeMap: Record<string, ForkNode> = {};
          for (const n of forkNodes) nodeMap[n.id] = n;
          const root = forkNodes.find(n => n.parentId === null);
          setSessionId(session.sessionId);
          setNodes(nodeMap);
          setRootId(root?.id ?? null);
          setActiveId(root?.id ?? null);
          setAnnotations(session.annotations.map(toAnnotation));
          setPersistentHl(toHlMap(session.highlights));
          setHighlightsList(toHighlightRecords(session.highlights, nodeMap));
          setNotionSavedUrl(session.notionPageUrl ?? null);
          setShowLogin(false);
          setIsTrial(session.isTrial ?? false);
        })
        .catch(err => {
          console.error('Failed to load shared session', err);
          // Stale/invalid trial token — drop it so the invalid-link → login bounce can't recur.
          localStorage.removeItem('fork.ai.trial');
          setInvalidLink(true);
          setInvalidLinkCountdown(3);
        })
        .finally(() => setLoadingRoot(false));
    }
  }, [guestToken, status, idToken, loadSession]);

  // ── Invalid share link countdown → redirect to login ─────────────────────
  useEffect(() => {
    if (!invalidLink) return;
    if (invalidLinkCountdown <= 0) { setGuestToken(null); setInvalidLink(false); return; }
    const t = setTimeout(() => setInvalidLinkCountdown(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [invalidLink, invalidLinkCountdown]);

  // ── Persist highlights (optimistic + background API sync) ─────────────────

  const persistHighlight = useCallback(
    (nodeId: string, sectionId: string, text: string, bg: string | null, fg: string | null, start: number, end: number) => {
      const key = `${nodeId}::${sectionId}`;
      const tempId = uid();
      setPersistentHl(prev => ({
        ...prev,
        [key]: [...(prev[key] ?? []), { hlId: tempId, text, start, end, bg: bg ?? null, fg: fg ?? null }],
      }));
      const fromTitle = nodes[nodeId]?.title ?? 'Untitled';
      setHighlightsList(prev => [...prev, { hlId: tempId, text, nodeId, sectionId, fromTitle }]);

      if (sessionId) {
        const hlPromise = guestToken && !idToken
          ? shareApi.createHighlight(guestToken, { nodeId, sectionId, text, start, end, bg: bg ?? null, fg: fg ?? null })
          : idToken
            ? createHighlight(idToken, sessionId, { nodeId, sectionId, text, start, end, bg: bg ?? null, fg: fg ?? null })
            : null;
        hlPromise
          ?.then(apiHl => {
            const realId = ((apiHl as unknown as Record<string, unknown>)['hlId'] as string) ?? apiHl.id;
            setPersistentHl(prev => ({
              ...prev,
              [key]: (prev[key] ?? []).map(h => h.hlId === tempId ? { ...h, hlId: realId } : h),
            }));
            setHighlightsList(prev => prev.map(h => h.hlId === tempId ? { ...h, hlId: realId } : h));
          })
          .catch(err => console.error('Failed to persist highlight', err));
      }
    },
    [nodes, sessionId, idToken, guestToken],
  );

  const removeHighlight = useCallback((hlId: string) => {
    setPersistentHl(prev => {
      const next: Record<string, PersistentHighlight[]> = {};
      for (const [key, list] of Object.entries(prev)) {
        const filtered = list.filter(h => h.hlId !== hlId);
        if (filtered.length) next[key] = filtered;
      }
      return next;
    });
    setHighlightsList(prev => prev.filter(h => h.hlId !== hlId));
    if (sessionId) {
      if (guestToken && !idToken) {
        shareApi.deleteHighlight(guestToken, hlId).catch(err => console.error('Failed to delete highlight', err));
      } else if (idToken) {
        deleteHighlight(idToken, sessionId, hlId).catch(err => console.error('Failed to delete highlight', err));
      }
    }
  }, [sessionId, idToken, guestToken]);

  const toggleStar = useCallback((node: ForkNode) => {
    if (node.loading || node.error) return;
    const next = !node.starred;
    setNodes(prev => prev[node.id] ? { ...prev, [node.id]: { ...prev[node.id], starred: next } } : prev);
    if (!sessionId) return;
    if (guestToken && !idToken) {
      shareApi.setNodeStar(guestToken, node.id, next).catch(err => console.error('Failed to star node', err));
    } else if (idToken) {
      apiSetNodeStar(idToken, sessionId, node.id, next).catch(err => console.error('Failed to star node', err));
    }
  }, [sessionId, idToken, guestToken]);

  // ── Start a new root research session (streaming) ────────────────────────

  const retryInfoRef = useRef<Record<string, RetryInfo>>({});

  const submitRootQuery = useCallback(async (query: string) => {
    const tempId = uid();
    const optimisticNode: ForkNode = {
      id: tempId,
      parentId: null,
      kind: 'QUERY',
      title: '',
      emoji: null,
      query,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: Date.now(),
      loading: true,
    };

    // Show workspace immediately with optimistic node
    setNodes({ [tempId]: optimisticNode });
    setRootId(tempId);
    setActiveId(tempId);
    setSessionId(null);
    setAnnotations([]);
    setPersistentHl({});
    setHighlightsList([]);
    setLoadingRoot(true);

    try {
      let realNodeId = tempId;
      // Captured from the meta event so the done handler can use them
      // without reading from nodes state (reading inside a setNodes updater
      // causes the updater to run multiple times, duplicating setSessions calls).
      let metaTitle = '';
      let metaEmoji: string | null = null;
      let metaLede = '';

      const isTrialQuery = !idToken && !guestToken;
      track('root_query', { trial: isTrialQuery, webSearch: tweaksRef.current.webSearch });
      const streamFn = isTrialQuery
        ? (cb: Parameters<typeof createSessionStream>[4]) => createTrialSessionStream(query, tweaksRef.current.maxSections, tweaksRef.current.webSearch, cb)
        : (cb: Parameters<typeof createSessionStream>[4]) => createSessionStream(idToken, query, tweaksRef.current.maxSections, tweaksRef.current.webSearch, cb);

      await streamFn((event) => {
        if (event.type === 'init') {
          // Backend has persisted the session + token up-front. Adopt them NOW so
          // the URL hash updates and a refresh mid-stream restores the real session
          // (instead of dropping to Landing). The done handler still swaps tempId.
          realNodeId = event.nodeId;
          setSessionId(event.sessionId);
          if (event.token) {
            localStorage.setItem('fork.ai.trial', event.token);
            localStorage.removeItem('fork.ai.pending');
            hasLoadedShareRef.current = true;
            setGuestToken(event.token);
            setIsTrial(true);
          }
        } else if (event.type === 'meta') {
          metaTitle = event.title;
          metaEmoji = event.emoji;
          metaLede = event.lede;
          setNodes(prev => {
            const node = prev[tempId];
            if (!node) return prev;
            return { ...prev, [tempId]: { ...node, title: event.title, emoji: event.emoji, lede: event.lede } };
          });
        } else if (event.type === 'section') {
          setNodes(prev => {
            const node = prev[tempId];
            if (!node) return prev;
            return { ...prev, [tempId]: { ...node, sections: [...node.sections, { id: event.id, heading: event.heading, body: event.body }] } };
          });
        } else if (event.type === 'done') {
          realNodeId = event.nodeId;
          setSessionId(event.sessionId);
          // Swap temp ID for the real node ID. Citation-processed bodies + sources
          // (web search) only arrive at done — apply them over the raw streamed sections.
          const doneSections = event.sections;
          const doneSources = event.sources;
          setNodes(prev => {
            const node = prev[tempId];
            if (!node) return prev;
            const realNode: ForkNode = {
              ...node,
              id: realNodeId,
              loading: false,
              ...(doneSections ? { sections: doneSections } : {}),
              ...(doneSources?.length ? { sources: doneSources } : {}),
            };
            const next: Record<string, ForkNode> = {};
            for (const [k, v] of Object.entries(prev)) {
              next[k === tempId ? realNodeId : k] = k === tempId ? realNode : v;
            }
            return next;
          });
          setRootId(realNodeId);
          setActiveId(realNodeId);
          refreshCredit();
          // Patch any open UI state that was anchored to the optimistic temp ID
          setHlMenu(prev => prev?.nodeId === tempId ? { ...prev, nodeId: realNodeId } : prev);
          setFollowUp(prev => prev?.nodeId === tempId ? { ...prev, nodeId: realNodeId } : prev);
          // Prepend to session list — called directly (not inside a setNodes updater)
          // to avoid React running the updater multiple times and duplicating entries.
          setSessions(s => {
            if (s.some(x => x.sessionId === event.sessionId)) return s;
            return [{
              sessionId: event.sessionId,
              title: metaTitle,
              emoji: metaEmoji ?? '',
              lede: metaLede,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              nodeCount: 1,
              highlightCount: 0,
            }, ...s];
          });
          // Store trial token so the session survives page refresh.
          // Mark hasLoadedShareRef so the share load effect doesn't re-fetch
          // the session (which would briefly show ResearchingScreen again and
          // create a window where branches silently fail).
          if (isTrialQuery && event.token) {
            localStorage.setItem('fork.ai.trial', event.token);
            hasLoadedShareRef.current = true;
            setGuestToken(event.token);
            setIsTrial(true);
          }
        }
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 402 && idToken) {
        setRootQueryOutOfCredit(true);
        setNodes({});
        setRootId(null);
        setActiveId(null);
      } else {
        // Keep the failed node on screen with the actual reason and a Retry
        // (or Log in) CTA instead of silently dumping the user back to Landing.
        console.error('Failed to create session', err);
        const { msg, status } = nodeErrorDisplay(err, !idToken);
        track('node_error', { kind: 'QUERY', status, message: msg });
        retryInfoRef.current[tempId] = { kind: 'ROOT', query };
        setNodes(prev => prev[tempId]
          ? { ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: status } }
          : prev);
      }
    } finally {
      setLoadingRoot(false);
      // Ensure loading flag is cleared on the node
      setNodes(prev => {
        const entries = Object.entries(prev);
        if (!entries.some(([, v]) => v.loading)) return prev;
        const next: Record<string, ForkNode> = {};
        for (const [k, v] of entries) next[k] = v.loading ? { ...v, loading: false } : v;
        return next;
      });
    }
  }, [idToken, guestToken]);

  // ── Branch: Go Deeper ─────────────────────────────────────────────────────

  const expandSectionAsChild = useCallback(async (parentNodeId: string, section: ForkNode['sections'][0], reuseNodeId?: string, boost?: boolean) => {
    const sid = sessionIdRef.current;
    const gt = guestTokenRef.current;
    if (!sid || (!idToken && !gt)) return;
    const parent = nodes[parentNodeId];
    if (!parent) return;

    // Retry reuses the failed node's id so the card flips back to loading in place.
    const tempId = reuseNodeId ?? uid();
    const heading = cleanHeading(section.heading);
    setSectionLoading(section.id);
    setLoadingNodes(prev => new Set(prev).add(tempId));
    setNodes(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        parentId: parentNodeId,
        title: short5(heading),
        kind: 'DEEPER',
        query: heading,
        emoji: null,
        lede: '',
        sections: [],
        fromSection: section.id,
        fromText: `${heading}: ${stripMarkdown(section.body).slice(0, 200)}…`,
        createdAt: Date.now(),
        loading: true,
      },
    }));
    // Notion export goes stale as soon as the branch tree changes — backend
    // clears notionPageUrl inside createNode (works for guest writes too).
    if (notionSavedUrl) setNotionSavedUrl(null);
    setActiveId(tempId);
    scrollWsTop();

    try {
      const nodePayload = {
        kind: 'DEEPER' as const,
        parentNodeId,
        fromSection: section.id,
        query: heading,
        sectionBody: section.body,
        sectionCount: tweaksRef.current.maxSections,
        webSearch: tweaksRef.current.webSearch,
        verbose: tweaksRef.current.answerStyle === 'verbose',
        model: tweaksRef.current.branchModel,
        ...(boost ? { boost: true } : {}),
      };
      const apiNode = gt && !idToken
        ? await shareApi.createNode(gt, nodePayload)
        : await createNode(idToken, sid, nodePayload);
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      setActiveId(realNode.id);
      refreshCredit();
      track('branch_created', { kind: 'DEEPER', model: tweaksRef.current.branchModel, guest: !!gt && !idToken });
    } catch (err) {
      const isGuestReq = !!gt && !idToken;
      const { msg, status, code } = nodeErrorDisplay(err, isGuestReq);
      track('node_error', { kind: 'DEEPER', status, message: msg, guest: isGuestReq });
      // A guest can't Retry a Cut-Off (same budget → cut off again), so don't offer it;
      // an authed Cut-Off retries with a doubled budget (boost). See ADR-0009.
      const truncated = code === 'OUTPUT_TRUNCATED';
      if (status !== 402 && !(truncated && isGuestReq)) {
        retryInfoRef.current[tempId] = { kind: 'DEEPER', parentNodeId, section, boost: truncated };
      }
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: status, errorCode: code } }));
    } finally {
      setSectionLoading(null);
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
    }
  }, [nodes, idToken, scrollWsTop, notionSavedUrl]);

  // ── Branch: Ask AI from highlight ────────────────────────────────────────

  const askFromHighlight = useCallback(async (question: string, source: FollowUpState, reuseNodeId?: string, boost?: boolean) => {
    const sid = sessionIdRef.current;
    const gt = guestTokenRef.current;
    if (!sid || (!idToken && !gt)) return;
    const parent = nodes[source.nodeId];
    if (!parent) return;

    // Retry reuses the failed node's id so the card flips back to loading in place.
    const tempId = reuseNodeId ?? uid();
    setFollowUp(prev => prev ? { ...prev, loading: true } : null);
    setLoadingNodes(prev => new Set(prev).add(tempId));
    setNodes(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        parentId: source.nodeId,
        title: short5(question),
        kind: 'ASK',
        query: question,
        emoji: null,
        lede: '',
        sections: [],
        fromSection: source.sectionId,
        fromText: source.text,
        createdAt: Date.now(),
        loading: true,
      },
    }));
    // Backend clears notionPageUrl inside createNode — frontend only updates UI.
    if (notionSavedUrl) setNotionSavedUrl(null);

    try {
      const nodePayload = {
        kind: 'ASK' as const,
        parentNodeId: source.nodeId,
        fromSection: source.sectionId,
        query: question,
        highlightText: source.text,
        sectionCount: tweaksRef.current.maxSections,
        webSearch: tweaksRef.current.webSearch,
        verbose: tweaksRef.current.answerStyle === 'verbose',
        model: tweaksRef.current.branchModel,
        ...(boost ? { boost: true } : {}),
      };
      const apiNode = gt && !idToken
        ? await shareApi.createNode(gt, nodePayload)
        : await createNode(idToken, sid, nodePayload);
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      // Stay on current node — but if the user already opened the loading
      // node, follow the id swap so its panel doesn't blank out (tempId is gone).
      setActiveId(prev => (prev === tempId ? realNode.id : prev));
      // Branch source gets the reserved glow style, not the last picked highlighter colour.
      persistHighlight(source.nodeId, source.sectionId, source.text, BRANCH_HL, null, source.start, source.end);
      refreshCredit();
      track('branch_created', { kind: 'ASK', model: tweaksRef.current.branchModel, guest: !!gt && !idToken });
    } catch (err) {
      const isGuestReq = !!gt && !idToken;
      const { msg, status, code } = nodeErrorDisplay(err, isGuestReq);
      track('node_error', { kind: 'ASK', status, message: msg, guest: isGuestReq });
      // A guest can't Retry a Cut-Off (same budget → cut off again), so don't offer it;
      // an authed Cut-Off retries with a doubled budget (boost). See ADR-0009.
      const truncated = code === 'OUTPUT_TRUNCATED';
      if (status !== 402 && !(truncated && isGuestReq)) {
        retryInfoRef.current[tempId] = { kind: 'ASK', question, source, boost: truncated };
      }
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: status, errorCode: code } }));
    } finally {
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
      // Only close the popup that triggered THIS request — a newer Q2 popup must survive.
      setFollowUp(prev => {
        if (!prev) return null;
        if (prev.nodeId === source.nodeId && prev.sectionId === source.sectionId && prev.text === source.text) return null;
        return prev;
      });
    }
  }, [nodes, idToken, scrollWsTop, persistHighlight, notionSavedUrl]);

  // ── Retry a failed LLM node ───────────────────────────────────────────────

  const retryNode = useCallback((failedId: string) => {
    const info = retryInfoRef.current[failedId];
    if (!info) return;
    delete retryInfoRef.current[failedId];
    track('retry_clicked', { kind: info.kind });
    if (info.kind === 'ROOT') void submitRootQuery(info.query);
    else if (info.kind === 'DEEPER') void expandSectionAsChild(info.parentNodeId, info.section, failedId, info.boost);
    else void askFromHighlight(info.question, info.source, failedId, info.boost);
  }, [submitRootQuery, expandSectionAsChild, askFromHighlight]);

  // ── Text selection → highlight menu ──────────────────────────────────────

  useEffect(() => {
    // Fires on both mouseup (pointer) and touchend (touch long-press selection) —
    // without the touch path the highlight menu never appears on phones.
    const onSelectEnd = (e: Event) => {
      if ((e.target as Element).closest?.('.hl-menu') || (e.target as Element).closest?.('.followup-pop')) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setHlMenu(null); return; }
        const text = sel.toString().trim();
        if (text.length < 3) { setHlMenu(null); return; }
        const range = sel.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : (range.commonAncestorContainer as Node).parentElement!;
        const sectionEl = container.closest?.('[data-section-id]') as HTMLElement | null;
        if (!sectionEl) { setHlMenu(null); return; }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) { setHlMenu(null); return; }
        const sectionId = sectionEl.getAttribute('data-section-id')!;

        // Compute character offsets for robust re-application on reload
        const bodyEl = sectionEl.classList.contains('section-body')
          ? sectionEl
          : sectionEl.querySelector('.section-body');
        const offsets = bodyEl ? getRangeOffsets(bodyEl, range) : null;

        setHlMenu({
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom },
          text,
          markdown: rangeToMarkdown(range),
          nodeId: activeId!,
          sectionId,
          start: offsets?.start ?? 0,
          end: offsets?.end ?? 0,
        });
      }, 10);
    };
    document.addEventListener('mouseup', onSelectEnd);
    document.addEventListener('touchend', onSelectEnd);
    return () => {
      document.removeEventListener('mouseup', onSelectEnd);
      document.removeEventListener('touchend', onSelectEnd);
    };
  }, [activeId]);

  // Cmd/Ctrl+A → select the whole reading pane (the active node's content) as one
  // contiguous range, instead of the document. Skips editable targets so Cmd+A in
  // the query box / inputs keeps native behaviour.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a' || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return;
      const inner = wsInnerRef.current;
      const bodies = inner?.querySelectorAll<HTMLElement>('.section-body');
      if (!inner || !bodies || !bodies.length) return;
      const sel = window.getSelection();
      if (!sel) return;
      e.preventDefault();

      // The user-select CSS makes everything but .section-body unselectable, so
      // the selected *text* is body-only; spanning the bodies anchors the menu at
      // the first line of prose.
      const single = bodies.length === 1;
      const range = document.createRange();
      if (single) range.selectNodeContents(bodies[0]);
      else { range.setStartBefore(bodies[0]); range.setEndAfter(bodies[bodies.length - 1]); }
      sel.removeAllRanges();
      sel.addRange(range);

      // Keyboard selection doesn't fire mouseup, so the highlight/Ask-AI menu
      // (which listens on mouseup) must be popped here. Offsets only resolve
      // within a single body; a multi-section select-all uses start=end=0 — Ask
      // AI / Callout / Copy still work (like the title pill), Highlight won't paint.
      const text = sel.toString().trim();
      if (text.length < 3) return;
      const rects = range.getClientRects();
      const r = rects.length ? rects[0] : range.getBoundingClientRect();
      const offsets = single ? getRangeOffsets(bodies[0], range) : null;
      setHlMenu({
        rect: { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom },
        text,
        markdown: rangeToMarkdown(range),
        nodeId: activeId!,
        sectionId: bodies[0].getAttribute('data-section-id')!,
        start: offsets?.start ?? 0,
        end: offsets?.end ?? 0,
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeId]);

  // Native Cmd/Ctrl+C (and right-click → Copy) over section prose copies markdown,
  // matching the highlight-menu copy button. Only overrides selections inside a
  // section body — inputs (no window selection) and other panes fall through to
  // the browser default.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null;
      if (!el || !(el.closest('.section-body') || el.querySelector('.section-body'))) return;
      const md = rangeToMarkdown(range);
      if (!md) return;
      e.clipboardData.setData('text/plain', md);
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  // Clear hlMenu on mousedown so useLayoutEffect runs before paint — Safari won't
  // repaint CSS.highlights after a deferred (post-paint) mutation, so we must
  // clear temp-hl before the browser draws the frame that follows the click.
  useEffect(() => {
    if (!hlMenu) return;
    const onPointerStart = (e: Event) => {
      const target = e.target as Element;
      if (target.closest?.('.hl-menu') || target.closest?.('.followup-pop')) return;
      // Empty temp-hl synchronously, here in the pointer-down handler, rather than
      // leaving it to the reactive layout effect: on mobile that React commit can
      // land after the gesture has already repainted, and a highlight mutated after
      // a painted frame won't repaint away — so the grey overlay would linger.
      if (CSS_HL_SUPPORTED) {
        CSS.highlights.set('temp-hl', new Highlight());
        // Safari/WebKit keeps the stale ::highlight() layer painted even after the
        // registry is emptied (Chrome repaints fine). Nudge the content subtree so
        // WebKit actually repaints and drops the grey. The opacity change is
        // imperceptible and reverted next frame.
        const content = document.querySelector('.workspace-inner') as HTMLElement | null;
        if (content) {
          content.style.opacity = '0.9999';
          requestAnimationFrame(() => { content.style.opacity = ''; });
        }
      }
      setHlMenu(null);
    };
    document.addEventListener('mousedown', onPointerStart);
    document.addEventListener('touchstart', onPointerStart);
    return () => {
      document.removeEventListener('mousedown', onPointerStart);
      document.removeEventListener('touchstart', onPointerStart);
    };
  }, [hlMenu]);

  // Single effect owns all named highlights so they are always re-registered together.
  useLayoutEffect(() => {
    if (!CSS_HL_SUPPORTED) return;

    // Persistent highlights — one Highlight object per bg+fg color combination
    const colorGroups = new Map<string, Highlight>();
    if (activeId) {
      const prefix = `${activeId}::`;
      for (const [key, list] of Object.entries(persistentHl)) {
        if (!key.startsWith(prefix)) continue;
        const sectionId = key.slice(prefix.length);
        const sectionEl = document.querySelector(`.section-body[data-section-id="${sectionId}"]`);
        if (!sectionEl) continue;
        for (const h of list) {
          if (h.start == null || h.end == null) continue;
          const r = rangeFromOffsets(sectionEl, h.start, h.end);
          if (!r) continue;
          const name = hlName(h.bg, h.fg);
          if (!colorGroups.has(name)) colorGroups.set(name, new Highlight());
          colorGroups.get(name)!.add(r);
        }
      }
    }
    ALL_HL_NAMES.forEach(n => CSS.highlights.delete(n));
    colorGroups.forEach((hl, name) => CSS.highlights.set(name, hl));

    // temp-hl — current uncommitted selection
    if (hlMenu && hlMenu.start < hlMenu.end) {
      const sectionEl = document.querySelector(`.section-body[data-section-id="${hlMenu.sectionId}"]`);
      if (sectionEl) {
        const r = rangeFromOffsets(sectionEl, hlMenu.start, hlMenu.end);
        if (r) CSS.highlights.set('temp-hl', new Highlight(r));
        // Safari won't repaint on delete — empty Highlight forces a style recalc
        else CSS.highlights.set('temp-hl', new Highlight());
      } else {
        CSS.highlights.set('temp-hl', new Highlight());
      }
    } else {
      CSS.highlights.set('temp-hl', new Highlight());
    }

    return () => {
      ALL_HL_NAMES.forEach(n => CSS.highlights.delete(n));
      CSS.highlights.delete('temp-hl');
    };
  }, [persistentHl, activeId, hlMenu, sectionReady]);

  const handleHlAction = useCallback((action: string, payload?: { bg: string; fg: string | null }) => {
    if (!hlMenu) return;
    const src = hlMenu;

    if (action === 'copy') {
      navigator.clipboard?.writeText(src.markdown || src.text);
      setHlMenu(null);
      return;
    }

    if (action === 'highlight') {
      const bg = payload?.bg ?? lastHlColors.bg;
      const fg = payload?.fg ?? lastHlColors.fg;
      setLastHlColors({ bg, fg });
      persistHighlight(src.nodeId, src.sectionId, src.text, bg, fg, src.start, src.end);
      setHlMenu(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    if (action === 'callout') {
      const fromTitle = nodes[src.nodeId]?.title ?? 'Untitled';
      const tempId = uid();
      const newAnn: Annotation = {
        id: tempId,
        kind: 'callout',
        text: src.text,
        fromTitle,
        nodeId: src.nodeId,
        sectionId: src.sectionId,
        createdAt: Date.now(),
      };
      setAnnotations(prev => [...prev, newAnn]);
      track('callout_created');
      setHlMenu(null);
      window.getSelection()?.removeAllRanges();

      if (sessionId && idToken) {
        createAnnotation(idToken, sessionId, {
          kind: 'callout',
          text: src.text,
          fromTitle,
          nodeId: src.nodeId,
          sectionId: src.sectionId,
        })
          .then(apiAnn => {
            setAnnotations(prev => prev.map(a => a.id === tempId ? toAnnotation(apiAnn) : a));
          })
          .catch(err => console.error('Failed to save annotation', err));
      }
      return;
    }

    if (action === 'ask') {
      setFollowUp({ rect: src.rect, text: src.text, nodeId: src.nodeId, sectionId: src.sectionId, start: src.start, end: src.end, loading: false });
      setHlMenu(null);
    }
  }, [hlMenu, nodes, lastHlColors, sessionId, idToken, persistHighlight]);

  // ── Map interactions ──────────────────────────────────────────────────────

  const onMapSelect = (id: string) => { setActiveId(id); scrollWsTop(); };
  const onMapContext = (id: string, x: number, y: number) => setContextMenu({ x, y, nodeId: id });

  const renameNodeLocal = (id: string) => {
    const name = prompt('Rename node (max 5 words)', nodes[id]?.title);
    if (!name?.trim()) { setContextMenu(null); return; }
    const title = short5(name.trim());
    setNodes(prev => ({ ...prev, [id]: { ...prev[id], title } }));
    setContextMenu(null);
    if (sessionId && idToken) {
      apiRenameNode(idToken, sessionId, id, title).catch(err => console.error('Failed to rename node', err));
    }
  };

  const deleteBranch = (id: string) => {
    if (id === rootId) {
      alert("Can't delete the root. Use New search to start over.");
      setContextMenu(null);
      return;
    }
    if (!confirm('Delete this branch and all its descendants?')) {
      setContextMenu(null);
      return;
    }
    const toDelete = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      Object.values(nodes).forEach(n => {
        if (toDelete.has(n.parentId!) && !toDelete.has(n.id)) { toDelete.add(n.id); added = true; }
      });
    }
    const remaining: Record<string, ForkNode> = {};
    Object.values(nodes).forEach(n => { if (!toDelete.has(n.id)) remaining[n.id] = n; });
    setNodes(remaining);
    if (toDelete.has(activeId!)) setActiveId(nodes[id]?.parentId ?? rootId);
    setAnnotations(prev => prev.filter(a => !toDelete.has(a.nodeId)));
    setContextMenu(null);

    // Server-side delete (backend handles descendant cleanup)
    if (sessionId && idToken) {
      apiDeleteNode(idToken, sessionId, id).catch(err => console.error('Failed to delete node', err));
    }
  };

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
    if (sessionId && idToken) {
      apiDeleteAnnotation(idToken, sessionId, id).catch(err => console.error('Failed to delete annotation', err));
    }
  }, [sessionId, idToken]);


  useEffect(() => {
    if (!contextMenu) return;
    const onClick = () => setContextMenu(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [contextMenu]);

  // ── Save to Notion ────────────────────────────────────────────────────────

  // After OAuth redirect back, open the picker automatically
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('notion') === 'connected') {
      window.history.replaceState({}, '', window.location.pathname);
      setNotionPickerOpen(true);
    }
  }, []);

  // Load page list whenever picker opens or search query changes
  useEffect(() => {
    if (!notionPickerOpen || !idToken) return;
    setNotionPagesLoading(true);
    searchNotionPages(idToken, notionQuery)
      .then(pages => { setNotionPages(pages); setNotionPagesLoading(false); })
      .catch(() => { setNotionPages([]); setNotionPagesLoading(false); });
  }, [notionPickerOpen, notionQuery, idToken]);

  const openNotionPicker = useCallback(async () => {
    if (!idToken) {
      // Guest trying to save — show LoginPage. Claim effect auto-loads the
      // session under the new auth identity after sign-in completes.
      setForceLogin(true);
      return;
    }
    setNotionError(null);
    try {
      const { connected } = await getNotionStatus(idToken);
      if (!connected) {
        // Fetch the OAuth URL (needs Bearer token), then redirect the browser to Notion
        const { url } = await getNotionAuthUrl(idToken);
        window.location.href = url;
        return;
      }
    } catch {
      setNotionError('Could not reach server');
      return;
    }
    setNotionSavedUrl(null);
    setNotionPickerOpen(true);
  }, [idToken]);

  // Push the session to Notion. parentPageId omitted → new top-level page.
  const doNotionPush = useCallback(async (parentPageId?: string) => {
    if (!rootId || !idToken) return;
    setNotionPickerOpen(false);
    setNotionSaving(true);
    setNotionError(null);
    try {
      const { blocks, childrenMap } = buildNotionClipboard(nodes, rootId, persistentHl, annotations);
      const title = nodes[rootId]?.title ?? 'fork ai research';
      const { url } = await pushToNotion(idToken, title, blocks, childrenMap, parentPageId);
      setNotionSavedUrl(url);
      track('notion_export');
      if (sessionId) {
        updateSessionNotionUrl(idToken, sessionId, url).catch(err => console.error('Failed to persist Notion URL', err));
      }
    } catch (err) {
      // Workspace-root create denied (integration lacks workspace access) → guide the user.
      const denied = err instanceof ApiError && err.message.includes('NOTION_WORKSPACE_DENIED');
      setNotionError(denied
        ? 'Reconnect Notion and grant workspace access, or pick an existing page'
        : 'Failed to save — try again');
    } finally {
      setNotionSaving(false);
    }
  }, [nodes, rootId, persistentHl, annotations, idToken, sessionId]);

  const saveToNotionPage = useCallback((page: NotionPage) => doNotionPush(page.id), [doNotionPush]);
  const createNotionPage = useCallback(() => doNotionPush(), [doNotionPush]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const active = activeId ? nodes[activeId] : null;

  const breadcrumbs = useMemo(() => {
    if (!activeId) return [] as ForkNode[];
    const arr: ForkNode[] = [];
    let cur: string | null = activeId;
    while (cur) {
      const n: ForkNode | undefined = nodes[cur];
      if (!n) break;
      arr.unshift(n);
      cur = n.parentId;
    }
    return arr;
  }, [activeId, nodes]);

  const childrenBySection = useMemo(() => {
    const m: Record<string, ForkNode[]> = {};
    Object.values(nodes).forEach(n => {
      if (n.parentId === activeId && n.fromSection) {
        (m[n.fromSection] = m[n.fromSection] ?? []).push(n);
      }
    });
    return m;
  }, [nodes, activeId]);

  // Highlights are now baked into Section's HTML by Section.tsx (DOMParser approach).
  // No manual DOM manipulation needed here.

  // ── Auth loading ──────────────────────────────────────────────────────────

  if (status === 'loading') {
    // SSR + first client paint: logged-out visitors (and crawlers) get the
    // static hero so the landing copy is in the initial HTML. `initiallyAuthed`
    // comes from the server-read session cookie, so it matches on hydration and
    // returning users keep the neutral spinner — no landing flash while their
    // session loads (preserves the loadingRoot no-flash behaviour).
    if (!initiallyAuthed) return <LandingHero />;
    return (
      <div className="auth-screen">
        <span className="spinner-lg" />
      </div>
    );
  }

  if (invalidLink) {
    return (
      <div className="auth-screen">
        <div className="invalid-link-msg">
          <span className="invalid-link-icon">🔗</span>
          <p>Link not valid</p>
          <p className="invalid-link-sub">Redirecting to login in {invalidLinkCountdown}…</p>
        </div>
      </div>
    );
  }

  // ── Landing / history / loading ───────────────────────────────────────────

  const goHome = () => { setRootId(null); setNodes({}); setSessionId(null); setActiveId(null); setView('landing'); };
  const isGuest = !!(guestToken && !idToken);
  const showTour = !hasOnboarded && status === 'authenticated' && !guestToken;
  const restartTour = status === 'authenticated' && idToken
    ? () => patchMe(idToken, { hasOnboarded: false }).catch(() => {}).finally(() => window.location.reload())
    : undefined;
  const tourEl = showTour ? (
    <OnboardingTour
      phase={tourPhase}
      idToken={idToken}
      onDone={() => setHasOnboarded(true)}
    />
  ) : null;
  const persistentBrand = (
    <div className="app-brand" onClick={isGuest ? undefined : goHome} title={isGuest ? 'fork ai' : 'Go to home'} style={isGuest ? { cursor: 'default' } : undefined}>
      <span className="brand-logo" aria-hidden="true" /> fork ai
    </div>
  );

  // New visitors (no fork.ai.visited) bypass the login gate — they go to Landing first.
  // Returning users who are logged out see LoginPage (gate uses status + showLogin).
  // Guests with a share/trial token skip the login gate — UNLESS forceLogin is set.
  // Gate stays true through the post-login animation: it only flips off when
  // both `showLogin` and `forceLogin` have been cleared by onEnter (1500ms after
  // signIn succeeds), preserving the existing graph animation.
  const isNewVisitor = typeof window !== 'undefined' && !localStorage.getItem('fork.ai.visited');
  if (forceLogin || (!guestToken && !isNewVisitor && (status === 'unauthenticated' || showLogin))) {
    return (
      <LoginPage
        onEnter={() => {
          localStorage.setItem('fork.ai.visited', '1');
          track('login_completed');
          setShowLogin(false);
          setForceLogin(false);
        }}
      />
    );
  }

  if (!rootId) {
    let inner;
    // A pending guest/trial session must never fall through to Landing while it
    // loads (or while SSR — which can't read localStorage — has rendered Landing).
    // Keep the loading screen until the session resolves or the token is cleared.
    if (loadingRoot || (guestToken && !invalidLink)) inner = <ResearchingScreen sessions={sessions} />;
    else if (view === 'history') inner = (
      <HistoryPage
        sessions={sessions}
        loading={loadingSessions}
        onLoadSession={loadSession}
        onBack={() => setView('landing')}
      />
    );
    else inner = (
      <Landing
        onSubmit={q => { setRootQueryOutOfCredit(false); submitRootQuery(q); }}
        loading={loadingRoot}
        onShowHistory={() => setView('history')}
        outOfCredit={rootQueryOutOfCredit}
        initialTopics={initialTopics}
        loggedIn={status === 'authenticated'}
        onLogin={() => setForceLogin(true)}
      />
    );
    return <>{persistentBrand}{inner}<AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} /><TweaksPanel tweaks={tweaks} setTweak={setTweak} fontPairOptions={FONT_PAIR_OPTIONS} onRestartTour={restartTour} userEmail={authSession?.user?.email ?? ''} userName={authSession?.user?.name ?? ''} />{tourEl}</>;
  }

  // ── Workspace ─────────────────────────────────────────────────────────────

  return (
    <>
      {persistentBrand}
      <AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} />
    <div className="app" ref={appRef} data-map-open={mapOpen ? '1' : undefined}>
      <header className="topbar">
        <div className="crumbs">
          {rootId && nodes[rootId]?.emoji && (
            <span className="crumb-emoji" style={{ lineHeight: 1 }}>{nodes[rootId].emoji}</span>
          )}
          {/* On phones show only the root title (ellipsized in CSS) to avoid a long,
              overflowing trail; desktop keeps the full breadcrumb path. */}
          {(isNarrow ? breadcrumbs.slice(0, 1) : breadcrumbs).map((n, i, arr) => {
            const isLast = i === arr.length - 1;
            return (
              <span key={n.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span className="sep"><ChevronRight size={11} /></span>}
                <span
                  className={`crumb${isLast ? ' current' : ''}`}
                  onClick={() => !isLast && setActiveId(n.id)}
                  title={n.title}
                >
                  {n.title}
                </span>
              </span>
            );
          })}
        </div>
        <div className="tools">
          {idToken && (
            <button data-tour="tour-history" className="icon-btn" onClick={() => { setView('history'); setRootId(null); setNodes({}); setSessionId(null); }} title="Research history">
              <Clock size={14} /> History
            </button>
          )}
          {guestToken && !idToken && (
            <button
              className="icon-btn"
              onClick={() => setForceLogin(true)}
              title="Sign in to save this session to your account"
            >
              <LogIn size={14} /> Login to Save
            </button>
          )}
          {sessionId && idToken && (
            <span data-tour="tour-share">
              <ShareButton sessionId={sessionId} idToken={idToken} />
            </span>
          )}
          {/* Notes is hidden on phones (mobile nav stays minimal) — desktop keeps it. */}
          {!isNarrow && (
            <button className="icon-btn has-badge" onClick={() => setDrawerOpen(true)} title="Highlights & Callouts">
              <Bookmark size={14} /> Notes
              {(annotations.length + highlightsList.length) > 0 && <span className="badge">{annotations.length + highlightsList.length}</span>}
            </button>
          )}
        </div>
      </header>

      <section className="mindmap-pane" ref={mapPaneRef}>
        {Object.keys(nodes).length > 0 ? (
          <MindMap
            nodes={nodes}
            rootId={rootId}
            activeId={activeId}
            onSelect={onMapSelect}
            onContextMenu={onMapContext}
            layout={tweaks.mapLayout}
            loadingIds={loadingNodes}
            readIds={readIds}
            onSaveToNotion={openNotionPicker}
            notionSaving={notionSaving}
            notionSavedUrl={notionSavedUrl}
            notionError={notionError}
            onClearNotionError={() => setNotionError(null)}
          />
        ) : (
          <div className="mm-empty">Mind map will populate as you branch</div>
        )}
      </section>

      <div
        className="pane-divider"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
      />

      <section className="workspace" ref={wsRef}>
        <div className="workspace-inner" ref={wsInnerRef}>
          {active && (
            <>
              <div className="ws-meta">
                <button
                  type="button"
                  data-tour="tour-star"
                  className={`pill pill-kind${active.starred ? ' starred' : ''}`}
                  onClick={() => toggleStar(active)}
                  title={active.starred ? 'Starred — click to unstar' : 'Star this node'}
                >
                  {active.kind === 'ASK'
                    ? <><Sparkles size={12} className="ic" /> Follow-up</>
                    : active.kind === 'DEEPER'
                      ? <><CornerDownRight size={12} className="ic" /> Deep dive</>
                      : <><Search size={12} className="ic" /> Query</>}
                </button>
                {active.kind === 'QUERY' && (
                  <span className="pill"><Hash size={12} className="ic" /> {active.sections.length || '—'} sections</span>
                )}
                {active.model ? <span className="pill">✳ {modelDisplayName(active.model)}</span> : null}
                {active.sources?.length ? <span className="pill pill-search">🔍 Web search</span> : null}
                {titleAskVisible && !active.loading && !active.error && active.sections.length > 0 && (
                  <button
                    ref={titleAskBtnRef}
                    className="pill pill-ask"
                    onMouseEnter={() => { if (titleAskTimer.current) clearTimeout(titleAskTimer.current); }}
                    onMouseLeave={revealTitleAsk}
                    onClick={() => {
                      const r = titleAskBtnRef.current?.getBoundingClientRect();
                      const rect = r
                        ? { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom }
                        : { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
                      setFollowUp({
                        rect,
                        text: active.lede || active.title || active.query,
                        nodeId: active.id,
                        sectionId: active.sections[0].id,
                        start: 0,
                        end: 0,
                        loading: false,
                      });
                      setTitleAskVisible(false);
                      if (titleAskTimer.current) clearTimeout(titleAskTimer.current);
                    }}
                  >
                    <Sparkles size={12} className="ic" /> Ask AI
                  </button>
                )}
                {active.loading && (
                  <span className="thinking">
                    Thinking<span className="dots"><span /><span /><span /></span>
                  </span>
                )}
              </div>
              <div className="ws-title-row" onMouseEnter={revealTitleAsk} onClick={revealTitleAsk}>
                <h1 className="ws-title">{active.title || active.query}</h1>
                {active.title && active.title !== active.query && (
                  <span className="ws-query-label">{active.query}</span>
                )}
              </div>
              {active.lede && <p className="ws-lede">{stripCite(active.lede)}</p>}
              {active.fromText && (
                <div className="inline-callout" style={{ marginBottom: 24 }}>
                  <Quote size={18} className="ic" />
                  <div className="body">
                    <div className="kicker">{active.kind === 'ASK' ? 'Branched from' : 'Expanded from'}</div>
                    <em>{stripMarkdown(active.fromText)}</em>
                  </div>
                </div>
              )}
              <hr className="ws-rule" />

              {active.error && (
                <div className="ws-error">
                  <AlertCircle size={16} className="ic" />
                  <span>Sorry — {active.error}</span>
                  {(active.errorStatus === 402 || active.errorStatus === 429) && !idToken ? (
                    <button className="ws-error-btn" onClick={() => setForceLogin(true)}>Log in</button>
                  ) : retryInfoRef.current[active.id] ? (
                    <button className="ws-error-btn" onClick={() => retryNode(active.id)}>Retry</button>
                  ) : null}
                </div>
              )}
              {active.loading && !active.sections.length && <SkeletonSections />}

              {active.sections.map((s, i) => (
                <Section
                  key={s.id}
                  idx={i}
                  section={s}
                  node={active}
                  onDeeper={sec => expandSectionAsChild(active.id, sec)}
                  deeperLoading={sectionLoading === s.id}
                  sectionChildren={childrenBySection[s.id] ?? []}
                  onChildClick={cid => { setActiveId(cid); scrollWsTop(); }}
                  calloutsForSection={annotations.filter(a => a.kind === 'callout' && a.nodeId === active.id && a.sectionId === s.id)}
                  onRemoveCallout={removeAnnotation}
                />
              ))}
              {active.sources?.length ? (
                <div className="ws-sources">
                  <div className="ws-sources-label">Sources</div>
                  <ol className="ws-sources-list">
                    {active.sources.map((src, i) => (
                      <li key={i}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {isNarrow && Object.keys(nodes).length > 0 && (
        <MindMapPill open={mapOpen} onToggle={() => setMapOpen(o => !o)} />
      )}
      {isNarrow && !mapOpen && Object.keys(nodes).length > 0 && (
        <div
          className="mm-swipe-zone"
          onPointerDown={onSwipeDown}
          onPointerMove={onSwipeMove}
          onPointerUp={onSwipeEnd}
          onPointerCancel={onSwipeEnd}
        />
      )}

      <HighlightMenu
        visible={!!hlMenu}
        rect={hlMenu?.rect ?? { left: 0, top: 0, width: 0, height: 0, bottom: 0 }}
        lastColors={lastHlColors}
        onAction={(action, payload) => handleHlAction(action, payload)}
        onClose={() => setHlMenu(null)}
      />
      {followUp && (
        <FollowUpPop
          rect={followUp.rect}
          sourceText={followUp.text}
          loading={followUp.loading}
          onClose={() => setFollowUp(null)}
          onSubmit={q => askFromHighlight(q, followUp)}
        />
      )}

      {contextMenu && (
        <div
          className="mm-context"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { onMapSelect(contextMenu.nodeId); setContextMenu(null); }}>
            <ArrowUpRight className="ic" /> Open
          </button>
          <button onClick={() => renameNodeLocal(contextMenu.nodeId)}>
            <Pencil className="ic" /> Rename
          </button>
          <div className="sep" />
          <button className="danger" onClick={() => deleteBranch(contextMenu.nodeId)}>
            <Trash className="ic" /> Delete branch
          </button>
        </div>
      )}

      <NotesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        highlights={highlightsList}
        callouts={annotations}
        onJump={id => { setActiveId(id); scrollWsTop(); setDrawerOpen(false); }}
        onRemoveHighlight={removeHighlight}
        onRemoveCallout={removeAnnotation}
      />

      <TweaksPanel
        tweaks={tweaks}
        setTweak={setTweak}
        fontPairOptions={FONT_PAIR_OPTIONS}
        onRestartTour={restartTour}
        userEmail={authSession?.user?.email ?? ''}
        userName={authSession?.user?.name ?? ''}
      />

      {notionPickerOpen && (
        <div className="notion-picker-overlay" onClick={() => setNotionPickerOpen(false)}>
          <div className="notion-picker" onClick={e => e.stopPropagation()}>
            <div className="notion-picker-header">
              <span>Save to Notion — pick a page</span>
              <button className="notion-picker-close" onClick={() => setNotionPickerOpen(false)}>✕</button>
            </div>
            <input
              className="notion-picker-search"
              placeholder="Search pages…"
              autoFocus
              value={notionQuery}
              onChange={e => setNotionQuery(e.target.value)}
            />
            <ul className="notion-picker-list">
              <li className="notion-picker-create">
                <button onClick={createNotionPage}>
                  <span className="notion-picker-title">+ Create a new page</span>
                </button>
              </li>
              {notionPagesLoading && (
                <li className="notion-picker-empty">Loading…</li>
              )}
              {!notionPagesLoading && notionPages.length === 0 && (
                <li className="notion-picker-empty">No existing pages — create a new one above</li>
              )}
              {!notionPagesLoading && notionPages.map(page => (
                <li key={page.id}>
                  <button onClick={() => saveToNotionPage(page)}>
                    <span className="notion-picker-title">{page.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>

    {isTrial && Object.keys(nodes).length >= 5 && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: 'var(--bg)', border: '1px solid var(--line-strong)',
          borderRadius: 12, padding: '32px 36px',
          maxWidth: 420, width: '90%', textAlign: 'center',
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Free session limit reached</h2>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Login or signup to continue — your session will be saved to your account.
          </p>
          <button
            style={{
              width: '100%', background: 'var(--ink)', color: 'var(--bg)',
              border: 0, borderRadius: 6, padding: '10px 0',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={() => setForceLogin(true)}
          >
            Login / Sign up
          </button>
        </div>
      </div>
    )}

    {tourEl}
    </>
  );
}
