'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import type { ForkNode, Annotation, HlMenuState, FollowUpState, ContextMenuState, PersistentHighlight, HighlightRecord } from '@/lib/types';
import { uid, short5, stripMarkdown, getRangeOffsets } from '@/lib/utils';

const CSS_HL_SUPPORTED = typeof window !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS;

// One CSS named highlight per bg+fg combination so each color is independently styled
const HL_BG = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e5e5e5'];
const HL_FG = [null, '#b91c1c', '#1d4ed8', '#047857'];

function hlName(bg: string | null, fg: string | null | undefined): string {
  const b = (bg ?? '#fef08a').replace('#', '');
  const f = (fg ?? null)?.replace('#', '') ?? null;
  return f ? `fork-hl-${b}-${f}` : `fork-hl-${b}`;
}

const ALL_HL_NAMES = HL_BG.flatMap(bg => HL_FG.map(fg => hlName(bg, fg)));

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
import { useTweaks } from '@/hooks/useTweaks';
import { buildNotionClipboard } from '@/lib/notion-clipboard';
import {
  listSessions,
  getSession,
  createSessionStream,
  createTrialSessionStream,
  createNode,
  renameNode as apiRenameNode,
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
  shareApi,
  getMe,
  patchMe,
  ApiError,
  type SessionSummary,
  type NotionPage,
} from '@/lib/api';
import { OnboardingTour } from './OnboardingTour';
import { MindMap } from './MindMap';
import { Section } from './Section';
import { SkeletonSections } from './SkeletonSections';
import { HighlightMenu } from './HighlightMenu';
import { FollowUpPop } from './FollowUpPop';
import { NotesDrawer } from './NotesDrawer';
import { Landing } from './Landing';
import { LoginPage } from './LoginPage';
import { HistoryPage } from './HistoryPage';
import { TweaksPanel } from './TweaksPanel';
import { AccountButton } from './AccountButton';
import { ShareButton } from './ShareButton';
import {
  Search, Bookmark, ChevronRight, Sparkles, CornerDownRight, Hash,
  Quote, AlertCircle, ArrowUpRight, Pencil, Trash, Clock,
} from './Icons';

const TWEAK_DEFAULTS = {
  theme: 'light' as const,
  accent: '#525252',
  density: 'compact' as const,
  mapLayout: 'vertical' as const,
  fontPair: 'newsreader-geist',
  maxSections: 6,
  webSearch: true,
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
              <div className="session-card-lede">{s.lede}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function App({ initialTopics = [] }: { initialTopics?: string[] }) {
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

  // Auto sign-out on any 401 (expired Cognito id_token)
  useEffect(() => { setUnauthorizedHandler(() => void signOut()); }, []);

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
  const appRef = useRef<HTMLDivElement>(null);

  // Always-current refs so branch callbacks never close over stale sessionId / guestToken.
  // useCallback re-creation lags one render behind state commits in some codepaths.
  const sessionIdRef = useRef(sessionId);
  const guestTokenRef = useRef(guestToken);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { guestTokenRef.current = guestToken; }, [guestToken]);

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

  useEffect(() => {
    if (!idToken) return;
    getMe(idToken)
      .then(me => {
        setHasOnboarded(me.hasOnboarded ?? false);
        setCreditBalance(me.creditUsd ?? null);
      })
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

  const loadSession = useCallback(async (sid: string, targetNodeId?: string) => {
    setLoadingRoot(true);
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
      setActiveId(activeTarget);
      setAnnotations(session.annotations.map(toAnnotation));
      setPersistentHl(toHlMap(session.highlights));
      setHighlightsList(toHighlightRecords(session.highlights, nodeMap));
      setNotionSavedUrl(session.notionPageUrl ?? null);
    } catch (err) {
      console.error('Failed to load session', err);
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

  // ── Start a new root research session (streaming) ────────────────────────

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
      const streamFn = isTrialQuery
        ? (cb: Parameters<typeof createSessionStream>[4]) => createTrialSessionStream(query, tweaks.maxSections, tweaks.webSearch, cb)
        : (cb: Parameters<typeof createSessionStream>[4]) => createSessionStream(idToken, query, tweaks.maxSections, tweaks.webSearch, cb);

      await streamFn((event) => {
        if (event.type === 'meta') {
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
          // Swap temp ID for the real node ID
          setNodes(prev => {
            const node = prev[tempId];
            if (!node) return prev;
            const realNode: ForkNode = { ...node, id: realNodeId, loading: false };
            const next: Record<string, ForkNode> = {};
            for (const [k, v] of Object.entries(prev)) {
              next[k === tempId ? realNodeId : k] = k === tempId ? realNode : v;
            }
            return next;
          });
          setRootId(realNodeId);
          setActiveId(realNodeId);
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
      if (err instanceof ApiError && err.status === 402) {
        setRootQueryOutOfCredit(true);
      } else {
        console.error('Failed to create session', err);
      }
      setNodes({});
      setRootId(null);
      setActiveId(null);
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

  const expandSectionAsChild = useCallback(async (parentNodeId: string, section: ForkNode['sections'][0]) => {
    const sid = sessionIdRef.current;
    const gt = guestTokenRef.current;
    if (!sid || (!idToken && !gt)) return;
    const parent = nodes[parentNodeId];
    if (!parent) return;

    const tempId = uid();
    setSectionLoading(section.id);
    setLoadingNodes(prev => new Set(prev).add(tempId));
    setNodes(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        parentId: parentNodeId,
        title: short5(section.heading),
        kind: 'DEEPER',
        query: section.heading,
        emoji: null,
        lede: '',
        sections: [],
        fromSection: section.id,
        fromText: `${section.heading}: ${stripMarkdown(section.body).slice(0, 200)}…`,
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
        query: section.heading,
        sectionBody: section.body,
        sectionCount: tweaks.maxSections,
        webSearch: tweaks.webSearch,
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
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 402
        ? 'Out of credit — open Billing to recharge'
        : 'Failed to load. Try again.';
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg } }));
    } finally {
      setSectionLoading(null);
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
    }
  }, [nodes, idToken, scrollWsTop, notionSavedUrl]);

  // ── Branch: Ask AI from highlight ────────────────────────────────────────

  const askFromHighlight = useCallback(async (question: string, source: FollowUpState) => {
    const sid = sessionIdRef.current;
    const gt = guestTokenRef.current;
    if (!sid || (!idToken && !gt)) return;
    const parent = nodes[source.nodeId];
    if (!parent) return;

    const tempId = uid();
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
        sectionCount: tweaks.maxSections,
        webSearch: tweaks.webSearch,
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
      // Stay on current node — user navigates via mind map chip
      persistHighlight(source.nodeId, source.sectionId, source.text, lastHlColors.bg, lastHlColors.fg, source.start, source.end);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 402
        ? 'Out of credit — open Billing to recharge'
        : 'Failed to load. Try again.';
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg } }));
    } finally {
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
      // Only close the popup that triggered THIS request — a newer Q2 popup must survive.
      setFollowUp(prev => {
        if (!prev) return null;
        if (prev.nodeId === source.nodeId && prev.sectionId === source.sectionId && prev.text === source.text) return null;
        return prev;
      });
    }
  }, [nodes, idToken, lastHlColors, scrollWsTop, persistHighlight, notionSavedUrl]);

  // ── Text selection → highlight menu ──────────────────────────────────────

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
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
          nodeId: activeId!,
          sectionId,
          start: offsets?.start ?? 0,
          end: offsets?.end ?? 0,
        });
      }, 10);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [activeId]);

  // Clear hlMenu on mousedown so useLayoutEffect runs before paint — Safari won't
  // repaint CSS.highlights after a deferred (post-paint) mutation, so we must
  // clear temp-hl before the browser draws the frame that follows the click.
  useEffect(() => {
    if (!hlMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest?.('.hl-menu') || target.closest?.('.followup-pop')) return;
      setHlMenu(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
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
  }, [persistentHl, activeId, hlMenu]);

  const handleHlAction = useCallback((action: string, payload?: { bg: string; fg: string | null }) => {
    if (!hlMenu) return;
    const src = hlMenu;

    if (action === 'copy') {
      navigator.clipboard?.writeText(src.text);
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

  const saveToNotionPage = useCallback(async (page: NotionPage) => {
    if (!rootId || !idToken) return;
    setNotionPickerOpen(false);
    setNotionSaving(true);
    setNotionError(null);
    try {
      const { blocks, childrenMap } = buildNotionClipboard(nodes, rootId, persistentHl, annotations);
      const title = nodes[rootId]?.title ?? 'fork ai research';
      const { url } = await pushToNotion(idToken, title, blocks, childrenMap, page.id);
      setNotionSavedUrl(url);
      if (sessionId) {
        updateSessionNotionUrl(idToken, sessionId, url).catch(err => console.error('Failed to persist Notion URL', err));
      }
    } catch {
      setNotionError('Failed to save — try again');
    } finally {
      setNotionSaving(false);
    }
  }, [nodes, rootId, persistentHl, annotations, idToken]);

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
          setShowLogin(false);
          setForceLogin(false);
        }}
      />
    );
  }

  if (!rootId) {
    let inner;
    if (loadingRoot) inner = <ResearchingScreen sessions={sessions} />;
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
      />
    );
    return <>{persistentBrand}{inner}<AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} /><TweaksPanel tweaks={tweaks} setTweak={setTweak} fontPairOptions={FONT_PAIR_OPTIONS} onRestartTour={restartTour} userEmail={authSession?.user?.email ?? ''} userName={authSession?.user?.name ?? ''} />{tourEl}</>;
  }

  // ── Workspace ─────────────────────────────────────────────────────────────

  return (
    <>
      {persistentBrand}
      <AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} />
    <div className="app" ref={appRef}>
      <header className="topbar">
        <div className="crumbs">
          {rootId && nodes[rootId]?.emoji && (
            <span style={{ fontSize: 16, lineHeight: 1 }}>{nodes[rootId].emoji}</span>
          )}
          {breadcrumbs.map((n, i) => {
            const isLast = i === breadcrumbs.length - 1;
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
              <Bookmark size={14} /> Login to Save
            </button>
          )}
          {sessionId && idToken && (
            <span data-tour="tour-share">
              <ShareButton sessionId={sessionId} idToken={idToken} />
            </span>
          )}
          <button className="icon-btn has-badge" onClick={() => setDrawerOpen(true)} title="Highlights & Callouts">
            <Bookmark size={14} /> Notes
            {(annotations.length + highlightsList.length) > 0 && <span className="badge">{annotations.length + highlightsList.length}</span>}
          </button>
        </div>
      </header>

      <section className="mindmap-pane">
        {Object.keys(nodes).length > 0 ? (
          <MindMap
            nodes={nodes}
            rootId={rootId}
            activeId={activeId}
            onSelect={onMapSelect}
            onContextMenu={onMapContext}
            layout={tweaks.mapLayout}
            loadingIds={loadingNodes}
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
        <div className="workspace-inner">
          {active && (
            <>
              <div className="ws-meta">
                <span className="pill">
                  {active.kind === 'ASK'
                    ? <><Sparkles size={12} className="ic" /> Follow-up</>
                    : active.kind === 'DEEPER'
                      ? <><CornerDownRight size={12} className="ic" /> Deep dive</>
                      : <><Search size={12} className="ic" /> Query</>}
                </span>
                <span className="pill"><Hash size={12} className="ic" /> {active.sections.length || '—'} sections</span>
                {active.sources?.length ? <span className="pill pill-search">🔍 Web search</span> : null}
                {active.loading && (
                  <span className="thinking">
                    Thinking<span className="dots"><span /><span /><span /></span>
                  </span>
                )}
              </div>
              <div className="ws-title-row">
                <h1 className="ws-title">{active.title || active.query}</h1>
                {active.title && active.title !== active.query && (
                  <span className="ws-query-label">{active.query}</span>
                )}
              </div>
              {active.lede && <p className="ws-lede">{active.lede}</p>}
              {active.fromText && (
                <div className="inline-callout" style={{ marginBottom: 24 }}>
                  <Quote size={18} className="ic" />
                  <div className="body">
                    <div className="kicker">{active.kind === 'ASK' ? 'Branched from' : 'Expanded from'}</div>
                    <em>{active.fromText}</em>
                  </div>
                </div>
              )}
              <hr className="ws-rule" />

              {active.error && (
                <div className="ws-error">
                  <AlertCircle size={16} className="ic" />
                  <span>Sorry — {active.error}. Try again.</span>
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
              {notionPagesLoading && (
                <li className="notion-picker-empty">Loading…</li>
              )}
              {!notionPagesLoading && notionPages.length === 0 && (
                <li className="notion-picker-empty">No pages found</li>
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
