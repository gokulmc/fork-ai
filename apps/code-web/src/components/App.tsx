'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSession, signOut, getSession as getAuthSession } from 'next-auth/react';
import type { ForkNode, Annotation, HlMenuState, FollowUpState, ContextMenuState, PersistentHighlight, HighlightRecord } from '@/lib/types';
import { uid, short5, stripMarkdown, stripCite, getRangeOffsets, modelDisplayName, cleanHeading } from '@/lib/utils';
import { rangeToMarkdown } from '@/lib/htmlToMarkdown';
import { collapseSegments } from '@/lib/collapseSegments';

const CSS_HL_SUPPORTED = typeof window !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS;

// One CSS named highlight per bg+fg combination so each color is independently styled
const HL_BG = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e5e5e5'];
const HL_FG = [null, '#b91c1c', '#1d4ed8', '#047857'];

// Reserved style for text that spawned an Ask-AI branch — a glow/lift rather than a
// flat fill (see ::highlight(fork-hl-branch) in globals.css). Stored as the highlight's
// bg so it renders consistently regardless of the last picked colour; never offered in
// the colour picker.
const BRANCH_HL = 'branch';

// Mirrors backend LEARN_KINDS (apps/code-api/src/nodes/node-grammar.ts) — used
// to gate the project first-question interstitial: a seeded project session has
// a CODE root (and maybe a HEAD child) but no learn-kind node until the user's
// first question lands.
const LEARN_KINDS = new Set<ForkNode['kind']>(['QUERY', 'DEEPER', 'ASK', 'MIX']);

// A node can be a Plan base when it's a learn kind, or a BRANCH node that
// already carries content — a plain fork BRANCH has nothing to plan from yet.
// A PLAN node is only ever spawned via the plan:true mix route, never the
// generic create-node grammar, so it isn't expressed in nodeGrammar.ts's
// canSpawn table.
function canBePlanBase(node: ForkNode | null | undefined): boolean {
  if (!node) return false;
  if (LEARN_KINDS.has(node.kind)) return true;
  return node.kind === 'BRANCH' && node.sections.length > 0;
}

// ProjectStart gate persistence — dismissal must survive reopening the same
// session (a plain boolean that reset on every sessionId change meant "Open
// map" forgot itself on next visit). Keyed by sessionId, capped so the list
// can't grow unbounded across a long-lived browser profile.
const PROJECT_START_DISMISSED_KEY = 'forkai-code.projectStartDismissed';
const PROJECT_START_DISMISSED_CAP = 50;

function readDismissedProjectStarts(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROJECT_START_DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function isProjectStartDismissed(sessionId: string): boolean {
  return readDismissedProjectStarts().includes(sessionId);
}

function markProjectStartDismissed(sessionId: string): void {
  if (typeof window === 'undefined') return;
  const ids = readDismissedProjectStarts();
  if (ids.includes(sessionId)) return;
  ids.push(sessionId);
  if (ids.length > PROJECT_START_DISMISSED_CAP) ids.splice(0, ids.length - PROJECT_START_DISMISSED_CAP);
  try { localStorage.setItem(PROJECT_START_DISMISSED_KEY, JSON.stringify(ids)); } catch { /* best-effort — worst case dismissal doesn't survive reload */ }
}

// A session is "effectively empty" (ProjectStart-eligible) only when it has no
// nodes at all, or a single unfilled seeded root (parentless, no sections, not
// mid-stream). Any other content — CODE commits, branches, a filled root, or a
// learn node — means real work already exists, so the gate below skips
// straight to the workspace instead of hiding it behind the interstitial.
// Trade-off (recorded, not a bug): an imported-repo project whose commits
// have no learn node yet now opens the workspace directly and never sees
// ProjectStart.
function isProjectSessionEmpty(nodes: Record<string, ForkNode>): boolean {
  const all = Object.values(nodes);
  if (all.length === 0) return true;
  if (all.length > 1) return false;
  const only = all[0];
  return only.parentId === null && only.sections.length === 0 && !only.loading;
}

// Client-side mirror of the backend's findLaneBranchName (nodes.service.ts) —
// walks parentId upward (inclusive) to the nearest ancestor carrying a
// branchName. Used only for the PR overlay's confirm-text preview; the actual
// lane resolution that decides what gets merged happens server-side in
// createPrNode, so a mismatch here would just show a wrong preview, never a
// wrong merge.
function resolveLaneBranchName(nodes: Record<string, ForkNode>, fromId: string | null): string | null {
  let cur = fromId;
  while (cur) {
    const n = nodes[cur];
    if (!n) break;
    if (n.branchName) return n.branchName;
    cur = n.parentId;
  }
  return null;
}

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
function nodeErrorDisplay(err: unknown): { msg: string; status?: number; code?: string } {
  if (err instanceof ApiError) {
    if (err.status === 402) {
      return { msg: 'Out of credit — open Billing to recharge', status: 402 };
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
  | { kind: 'ROOT_IN_SESSION'; sessionId: string; query: string }
  | { kind: 'DEEPER'; parentNodeId: string; section: { id: string; heading: string; body: string }; boost?: boolean }
  | { kind: 'ASK'; question: string; source: FollowUpState; boost?: boolean }
  | { kind: 'ASK_COMMIT'; parentNodeId: string; question: string };
import { useTweaks } from '@/hooks/useTweaks';
import { initAnalytics, track, identifyUser } from '@/lib/analytics';
import { getCachedSession, putCachedSession, deleteCachedSession } from '@/lib/sessionCache';
import {
  listSessions,
  getSession,
  createSessionStream,
  createRootQueryInSessionStream,
  createDocumentSessionStream,
  createNode,
  createMixNode,
  createBranchNode,
  createPrNode,
  mergePr,
  createCodeNodeStream,
  listProjects,
  createProject,
  getProject,
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
  deleteSession as apiDeleteSession,
  setUnauthorizedHandler,
  setSessionRefresher,
  getMe,
  ApiError,
  type SessionSummary,
  type DocumentStreamEvent,
  type StreamEvent,
  type Project,
  type CreateProjectPayload,
  type AgentEvent,
  type AgentRun,
} from '@/lib/api';
import { canSpawn } from '@/lib/nodeGrammar';
import { kindLabel } from '@/lib/kindLabels';
import { SkeletonSections } from './SkeletonSections';
import { HighlightMenu } from './HighlightMenu';
import { FollowUpPop, SHORTHANDS } from './FollowUpPop';
import { NotesDrawer } from './NotesDrawer';
import { Landing } from './Landing';
import { LandingHero } from './LandingHero';
import { LoginPage } from './LoginPage';
import { HistoryPage } from './HistoryPage';
import { TweaksPanel } from './TweaksPanel';
import { AccountButton } from './AccountButton';
import { MindMapPill } from './MindMapPill';
import { NewProjectModal, synthesizeNewRepoRef } from './NewProjectModal';
import { ProjectStart } from './ProjectStart';
import { AgentLogPane } from './AgentLogPane';
import { PrPane } from './PrPane';
import { CodeComposer, type CodeComposerHandle, type ComposerAttachment } from './CodeComposer';
import {
  Search, Bookmark, ChevronRight, Sparkles, CornerDownRight, Hash,
  Quote, AlertCircle, ArrowUpRight, Pencil, Trash, Clock, FileText, Home,
  Blend, Filter, X as XIcon, ClipboardList, Code, GitBranch, GitMerge,
} from './Icons';
import { exportNodePdf } from '@/lib/sessionPdf';

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
  fontPair: 'newsreader-geist',
  answerStyle: 'verbose' as const,
  maxSections: 6,
  webSearch: false,
  branchModel: 'gemini-flash-lite' as const,
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

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useState<'landing' | 'history'>(() => {
    if (typeof window === 'undefined') return 'landing';
    return new URLSearchParams(window.location.search).get('view') === 'history' ? 'history' : 'landing';
  });
  const [showLogin, setShowLogin] = useState(false);
  // Set when the user explicitly chooses to sign in from a page that otherwise
  // bypasses the login gate (e.g. a new visitor clicking "Login" on Landing).
  // Cleared by LoginPage's onEnter once sign-in completes.
  const [forceLogin, setForceLogin] = useState(false);
  // Show login whenever a previously-authenticated user's session is unauthenticated (covers logout → re-login).
  // New visitors (no fork.ai.visited in localStorage) go to Landing instead.
  useEffect(() => {
    if (status === 'unauthenticated' && !!localStorage.getItem('fork.ai.visited')) setShowLogin(true);
  }, [status]);

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

  // Keep ?view=history in the URL so refresh lands on the right page. Push a
  // real entry the first time we enter history (so back can return to where
  // we came from); replace when we're already there — page load straight on
  // ?view=history, or popping back into it — to avoid a redundant duplicate.
  useEffect(() => {
    if (view === 'history') {
      const alreadyThere = new URLSearchParams(window.location.search).get('view') === 'history';
      if (alreadyThere) history.replaceState(null, '', '?view=history');
      else history.pushState(null, '', '?view=history');
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
  const [pdfExporting, setPdfExporting] = useState(false);
  // Projects (shown on the projects page — replaces Landing for authed users)
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  // The Project behind the active session, if any — needed for repo deep-links
  // (AgentLogPane's "View on GitHub") and the plugins display. Null for a plain
  // research session (not every session belongs to a project).
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  // Active research session
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, ForkNode>>({});
  const [rootId, setRootId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Nodes the user has read — active for ≥2s (debounced). Drives the bold
  // corner-bracket marker on the mind map. Persisted per session in localStorage.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  // Collapsed commit-chain segments (repo-import full history) — stores which
  // segments the user has manually EXPANDED (default is collapsed), so a
  // fresh session always opens with long import chains folded away. See
  // lib/collapseSegments.ts.
  const [expandedSegIds, setExpandedSegIds] = useState<Set<string>>(new Set());
  // Start in loading state if hash or localStorage session present — prevents landing flash on refresh
  const [loadingRoot, setLoadingRoot] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!(window.location.hash.slice(1) || localStorage.getItem('fork.ai.session'));
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

  // ── Mixer / Plan select-mode state ──────────────────────────────────────────
  const [selectMode, setSelectMode] = useState<'mixer' | 'plan' | 'pr' | null>(null);
  const [mixerSelectedIds, setMixerSelectedIds] = useState<string[]>([]);
  const [mixerQuestion, setMixerQuestion] = useState('');
  const [mixerAnimating, setMixerAnimating] = useState(false);
  const [mixerCollapsing, setMixerCollapsing] = useState(false);
  // Refs to each SVG node <g> element — used to compute ghost start positions
  const nodeRefs = useRef<Map<string, SVGGElement>>(new Map());

  // PR select-mode (Phase F) — two-step flow, separate from mixer/plan's
  // multi-select mechanics: prSourceId is set on step 1 (pick the commit),
  // prTargetId on step 2 (pick any node on the target branch), then the
  // overlay's Confirm button fires confirmPr.
  const [prSourceId, setPrSourceId] = useState<string | null>(null);
  const [prTargetId, setPrTargetId] = useState<string | null>(null);
  const [prSubmitting, setPrSubmitting] = useState(false);
  const [prConfirmError, setPrConfirmError] = useState<string | null>(null);

  const exitMixer = useCallback(() => {
    setSelectMode(null);
    setMixerSelectedIds([]);
    setMixerQuestion('');
    setMixerAnimating(false);
    setMixerCollapsing(false);
    setPrSourceId(null);
    setPrTargetId(null);
    setPrSubmitting(false);
    setPrConfirmError(null);
  }, []);

  // ── Code-node (git-graph rail) state ──────────────────────────────────────
  // Live agent-event log per CODE node, keyed by node id — populated while
  // createCodeNodeStream streams; AgentLogPane falls back to GET .../agent-run
  // when a node has no in-memory log (e.g. a reload landed on a finished run).
  const [agentLogs, setAgentLogs] = useState<Record<string, AgentEvent[]>>({});
  const composerRef = useRef<CodeComposerHandle>(null);
  const [codeSubmitLoading, setCodeSubmitLoading] = useState(false);
  const [askCommitLoading, setAskCommitLoading] = useState(false);
  // { nodeId } tags the error to the MERGE node it happened on, so PrPane only
  // shows it while that node is still active — navigating away silently clears it.
  const [prMergeError, setPrMergeError] = useState<{ nodeId: string; message: string } | null>(null);
  const [prMerging, setPrMerging] = useState(false);

  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [rootQueryOutOfCredit, setRootQueryOutOfCredit] = useState(false);

  const wsRef = useRef<HTMLElement>(null);
  const wsInnerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);

  // Always-current ref so branch callbacks never close over a stale sessionId.
  // useCallback re-creation lags one render behind state commits in some codepaths.
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  // Same pattern for rootId — consumeRootStream reads it (project-query 402
  // recovery) without needing rootId in its own dependency array.
  const rootIdRef = useRef(rootId);
  useEffect(() => { rootIdRef.current = rootId; }, [rootId]);
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

  useEffect(() => {
    if (!idToken) return;
    setLoadingProjects(true);
    listProjects(idToken)
      .then(setProjects)
      .catch(err => console.error('Failed to load projects', err))
      .finally(() => setLoadingProjects(false));
  }, [idToken]);

  // handleCreateProject is declared further down (after openProject and
  // submitFillRoot, which it calls) — see the "Hook ordering caveat" in root
  // CLAUDE.md: a hook that closes over another hook declared later in the
  // component throws `ReferenceError: Cannot access '...' before initialization`.

  // GitHub OAuth callback landing: code-api's /github/callback redirects back
  // here with ?github=connected|error. Strip it immediately (it's a one-shot
  // signal, not app state worth keeping in the URL) and surface it — connected
  // auto-opens the New Project modal so the picker shows the linked repos.
  const [githubJustConnected, setGithubJustConnected] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gh = params.get('github');
    if (!gh) return;
    params.delete('github');
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
    if (gh === 'connected') setGithubJustConnected(true);
    else console.warn('GitHub connection failed');
  }, []);

  // The New Project modal (attach an existing GitHub repo, or start a fresh
  // one) — hosted here rather than inside Landing so the githubJustConnected
  // round-trip above (which always lands back on Landing, the OAuth redirect
  // target strips any ?view=history) can auto-open it without Landing needing
  // its own idToken plumbing. HistoryPage still hosts its own separate copy.
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  useEffect(() => { if (githubJustConnected) setShowNewProjectModal(true); }, [githubJustConnected]);

  // Project first-question gate: a seeded project session loads WITH nodes (a
  // CODE root, maybe a HEAD child) — shown when there's no learn-kind node yet.
  // "Open map ↗" locally dismisses it so imported history stays browsable
  // without answering. Reset whenever the active session changes.
  const [projectStartDismissed, setProjectStartDismissed] = useState(false);
  // Re-check persisted dismissal on session change — do NOT reset to false
  // unconditionally, or a project already dismissed forgets that on reopen.
  useEffect(() => { setProjectStartDismissed(sessionId ? isProjectStartDismissed(sessionId) : false); }, [sessionId]);

  useEffect(() => {
    if (!idToken) return;
    getMe(idToken)
      .then(me => setCreditBalance(me.creditUsd ?? null))
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
      setLoadingRoot(false);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally once on mount

  // Returns the loaded root node id (or null) so callers that need it before the
  // next node create — e.g. handleCreateProject's fill-root kickoff — don't have
  // to race rootIdRef against this function's own state updates settling.
  const loadSession = useCallback(async (sid: string, targetNodeId?: string): Promise<string | null> => {
    // Skip the loading overlay if the early-paint already showed the workspace.
    if (!hasCachePaintedRef.current) setLoadingRoot(true);
    // Cache-first: paint the last local snapshot instantly (IndexedDB), then let
    // the network result below — always authoritative — replace it when it lands.
    let paintedFromCache = false;
    let cachedRootId: string | null = null;
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
        setLoadingRoot(false);
        paintedFromCache = true;
        cachedRootId = cached.rootId;
      }
    } catch { /* cache is best-effort — fall through to the network */ }
    try {
      const session = await getSession(idToken, sid);
      const forkNodes = session.nodes.map(toForkNode);
      const nodeMap: Record<string, ForkNode> = {};
      for (const n of forkNodes) nodeMap[n.id] = n;
      const root = forkNodes.find(n => n.parentId === null);
      // No explicit target (fresh load, not a deep-link) — land on an in-progress
      // CODE run rather than the root, so a mid-run refresh resumes where it left
      // off instead of stranding the user on a finished ancestor.
      const runningNode = targetNodeId ? undefined : forkNodes.find(n => n.agentStatus === 'running');
      const activeTarget = (targetNodeId && nodeMap[targetNodeId]) ? targetNodeId : (runningNode?.id ?? root?.id ?? null);
      setSessionId(session.sessionId);
      setNodes(nodeMap);
      setRootId(root?.id ?? null);
      // Don't yank the user off a node they navigated to while the cache copy
      // was showing — keep the current node if it still exists server-side.
      // Exception: an in-progress CODE run always wins. The cache-paint block
      // above already set activeId (usually to the root) before this network
      // apply runs, so "prev exists in nodeMap" can't distinguish user
      // navigation from our own cache paint — and the running node's pane is
      // what re-attaches polling after a mid-run reload.
      setActiveId(prev => runningNode ? runningNode.id : ((prev && nodeMap[prev]) ? prev : activeTarget));
      setAnnotations(session.annotations.map(toAnnotation));
      setPersistentHl(toHlMap(session.highlights));
      setHighlightsList(toHighlightRecords(session.highlights, nodeMap));
      // A session opened from History (or restored from a URL hash/localStorage)
      // carries no Project in memory — refetch it whenever the session belongs to
      // one, so ProjectStart gating and AgentLogPane's "View on GitHub" link work
      // the same as opening via openProject(). Cleared for a plain session so a
      // stale project from a previous session doesn't linger.
      if (session.projectId) {
        getProject(idToken, session.projectId).then(setActiveProject).catch(() => setActiveProject(null));
      } else {
        setActiveProject(null);
      }
      return root?.id ?? null;
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
        return null;
      }
      // Network blip, cache already painted a root — fall back to that rather
      // than reporting no root at all.
      return cachedRootId;
    } finally {
      setLoadingRoot(false);
    }
  }, [idToken]);

  // Opening a project = load its (possibly empty) session + remember the
  // Project itself. Sets it synchronously (loadSession's own projectId-based
  // refetch would otherwise land a frame later) and returns loadSession's
  // promise — resolving to the loaded root node id — so callers that need it
  // before proceeding (handleCreateProject's fill-root kickoff) can await it
  // instead of racing rootIdRef against loadSession's state updates settling.
  const openProject = useCallback((project: Project) => {
    setActiveProject(project);
    return loadSession(project.sessionId);
  }, [loadSession]);

  // ── Persist active session to URL hash + localStorage (survive refresh) ────

  // Track whether we've ever had a session this mount — only clear storage on
  // explicit navigation away (not on cold mount where sessionId starts as null).
  const hadSessionRef = useRef(false);
  // Captures whether the URL already had a session hash at the moment this
  // component mounted — read synchronously during render, so it runs before
  // the `view` effect's mount-time replaceState (above) has a chance to strip
  // it. That effect always rewrites the URL to drop any hash whenever `view`
  // isn't 'history', which fires on every cold mount — including a reload on
  // a `#sessionId` URL — well before auth settles and this effect's own
  // `window.location.hash` check below would otherwise run. Without this,
  // reloading on a session hash would look identical to a fresh landing→
  // session transition (hash empty) and incorrectly push instead of replace.
  const hadHashAtLoadRef = useRef(typeof window !== 'undefined' && !!window.location.hash);
  useEffect(() => {
    if (sessionId) {
      hadSessionRef.current = true;
      const hash = `${sessionId}${activeId && activeId !== rootId ? `/${activeId}` : ''}`;
      // Empty hash means this is an entry transition (landing → session, a
      // cold restore from localStorage, or opening a session from History) —
      // push a real history entry so back can return to where the user came
      // from instead of leaving the app. A non-empty hash (or one that was
      // present at load, see hadHashAtLoadRef above) means we're already
      // inside a session (reload-with-hash, or navigating between nodes) —
      // replace in place, as before. A relative '#...' URL keeps the current
      // path + query string, only the hash changes.
      const hadHash = hadHashAtLoadRef.current || !!window.location.hash;
      hadHashAtLoadRef.current = false; // one-shot — later runs rely on the live hash only
      if (hadHash) history.replaceState(null, '', `#${hash}`);
      else history.pushState(null, '', `#${hash}`);
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
        savedAt: Date.now(),
      }).catch(() => {});
    }, 400); // debounce: streaming sections update `nodes` rapidly
    return () => clearTimeout(t);
  }, [sessionId, rootId, nodes, annotations, persistentHl, highlightsList]);

  // Restore "read" markers for the active session (reset on session switch).
  useEffect(() => {
    if (!sessionId) { setReadIds(new Set()); return; }
    try {
      const raw = localStorage.getItem(`fork.ai.read::${sessionId}`);
      setReadIds(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setReadIds(new Set()); }
  }, [sessionId]);

  // Restore which commit-chain segments the user expanded (reset on session
  // switch — a fresh session always opens fully collapsed).
  useEffect(() => {
    if (!sessionId) { setExpandedSegIds(new Set()); return; }
    try {
      const raw = localStorage.getItem(`fork.ai.collapsed.${sessionId}`);
      setExpandedSegIds(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setExpandedSegIds(new Set()); }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    try { localStorage.setItem(`fork.ai.collapsed.${sessionId}`, JSON.stringify([...expandedSegIds])); } catch { /* quota */ }
  }, [expandedSegIds, sessionId]);

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
    if (status === 'unauthenticated') setLoadingRoot(false);
  }, [status]);

  // ── Hardware/browser back navigates in-app instead of exiting ────────────
  // Paired with the pushState calls above (session entry, history-view entry):
  // once those give the page a real history depth > 1, the native shell's
  // backButton handler calls history.back() instead of always minimizing.
  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        const [sid] = hash.split('/');
        if (idToken && sid && sid !== sessionId) loadSession(sid);
        return;
      }
      setRootId(null); setNodes({}); setSessionId(null); setActiveId(null);
      setView(new URLSearchParams(window.location.search).get('view') === 'history' ? 'history' : 'landing');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [sessionId, idToken, loadSession]);

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

      if (sessionId && idToken) {
        createHighlight(idToken, sessionId, { nodeId, sectionId, text, start, end, bg: bg ?? null, fg: fg ?? null })
          .then(apiHl => {
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
    [nodes, sessionId, idToken],
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
    if (sessionId && idToken) {
      deleteHighlight(idToken, sessionId, hlId).catch(err => console.error('Failed to delete highlight', err));
    }
  }, [sessionId, idToken]);

  const handleDeleteSession = useCallback(async (sid: string) => {
    if (!idToken) return;
    setSessions(prev => prev.filter(s => s.sessionId !== sid));
    try {
      await apiDeleteSession(idToken, sid);
      if (sessionId === sid) {
        setSessionId(null);
        setNodes({});
        setRootId(null);
        setActiveId(null);
        setActiveProject(null);
        setView('landing');
      }
    } catch (err) {
      console.error('Failed to delete session', err);
      // Restore removed session by re-fetching
      listSessions(idToken).then(setSessions).catch(() => undefined);
    }
  }, [idToken, sessionId]);

  const toggleStar = useCallback((node: ForkNode) => {
    if (node.loading || node.error) return;
    const next = !node.starred;
    setNodes(prev => prev[node.id] ? { ...prev, [node.id]: { ...prev[node.id], starred: next } } : prev);
    if (!sessionId || !idToken) return;
    apiSetNodeStar(idToken, sessionId, node.id, next).catch(err => console.error('Failed to star node', err));
  }, [sessionId, idToken]);

  // ── Start a new root research session (streaming) ────────────────────────

  const retryInfoRef = useRef<Record<string, RetryInfo>>({});

  // Shared SSE-consumption loop for a root-query stream — used both by a
  // brand-new session (submitRootQuery, via createSessionStream) and a query
  // into an existing empty project session (submitProjectQuery, via
  // createRootQueryInSessionStream). Both event vocabularies are identical
  // (StreamEvent); only how the stream is *started*, and what to retry on
  // failure, differ — those are the two params callers supply.
  const consumeRootStream = useCallback(async (
    tempId: string,
    starter: (onEvent: (event: StreamEvent) => void) => Promise<void>,
    retryInfo: RetryInfo,
  ) => {
    // A query into an EXISTING (seeded project) session must not adopt the
    // streamed node as root — the root stays the project's CODE root — and a
    // failure must only drop the failed optimistic node, not the whole tree.
    const isProjectQuery = retryInfo.kind === 'ROOT_IN_SESSION';
    try {
      let realNodeId = tempId;
      // Captured from the meta event so the done handler can use them
      // without reading from nodes state (reading inside a setNodes updater
      // causes the updater to run multiple times, duplicating setSessions calls).
      let metaTitle = '';
      let metaEmoji: string | null = null;
      let metaLede = '';

      await starter((event) => {
        if (event.type === 'init') {
          // Backend has persisted the session up-front. Adopt its id NOW so
          // the URL hash updates and a refresh mid-stream restores the real session
          // (instead of dropping to Landing). The done handler still swaps tempId.
          realNodeId = event.nodeId;
          setSessionId(event.sessionId);
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
          const doneModel = event.model;
          setNodes(prev => {
            const node = prev[tempId];
            if (!node) return prev;
            // Defensive: the fill-root match (an empty BRANCH project root) makes
            // the backend resolve the query onto an id that ALREADY exists in
            // `nodes` (the root itself), distinct from tempId. Merging the
            // optimistic temp node's fields over that entry would overwrite its
            // real parentId/kind with the temp node's (parentId: rootId itself,
            // kind: QUERY) — a root whose parent is its own id infinite-loops
            // buildChildMap. Merge the streamed content onto the EXISTING node
            // instead and drop the temp entry. Ordinary (non-collision) callers
            // are unaffected — this only fires when the two ids actually collide.
            const existing = realNodeId !== tempId ? prev[realNodeId] : undefined;
            if (existing) {
              const merged: ForkNode = {
                ...existing,
                loading: false,
                ...(doneModel ? { model: doneModel } : {}),
                ...(doneSections ? { sections: doneSections } : {}),
                ...(doneSources?.length ? { sources: doneSources } : {}),
              };
              const next = { ...prev, [realNodeId]: merged };
              delete next[tempId];
              return next;
            }
            const realNode: ForkNode = {
              ...node,
              id: realNodeId,
              loading: false,
              ...(doneModel ? { model: doneModel } : {}),
              ...(doneSections ? { sections: doneSections } : {}),
              ...(doneSources?.length ? { sources: doneSources } : {}),
            };
            const next: Record<string, ForkNode> = {};
            for (const [k, v] of Object.entries(prev)) {
              next[k === tempId ? realNodeId : k] = k === tempId ? realNode : v;
            }
            return next;
          });
          if (!isProjectQuery) setRootId(realNodeId);
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
        }
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setRootQueryOutOfCredit(true);
        if (isProjectQuery) {
          // Only the failed optimistic node goes — the project's imported
          // CODE/BRANCH/PLAN tree must survive an out-of-credit first question.
          setNodes(prev => { const next = { ...prev }; delete next[tempId]; return next; });
          setActiveId(rootIdRef.current);
        } else {
          setNodes({});
          setRootId(null);
          setActiveId(null);
        }
      } else {
        // Keep the failed node on screen with the actual reason and a Retry
        // CTA instead of silently dumping the user back to Landing.
        console.error('Failed to create session', err);
        const { msg, status } = nodeErrorDisplay(err);
        track('node_error', { kind: 'QUERY', status, message: msg });
        retryInfoRef.current[tempId] = retryInfo;
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
  }, [refreshCredit]);

  const submitRootQuery = useCallback(async (query: string) => {
    if (!idToken) { setForceLogin(true); return; }
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

    track('root_query', { webSearch: tweaksRef.current.webSearch });
    await consumeRootStream(
      tempId,
      onEvent => createSessionStream(idToken, query, tweaksRef.current.maxSections, tweaksRef.current.webSearch, onEvent),
      { kind: 'ROOT', query },
    );
  }, [idToken, consumeRootStream]);

  // First query inside an empty Project session — the session already exists
  // (ProjectsService.create → SessionsService.createEmpty), so this streams
  // into it via POST /sessions/:id/stream rather than minting a new session.
  const submitProjectQuery = useCallback(async (sid: string, query: string, reuseTempId?: string) => {
    if (!idToken) { setForceLogin(true); return; }
    const tempId = reuseTempId ?? uid();
    const optimisticNode: ForkNode = {
      id: tempId,
      // The session already has a CODE root (seeded on project creation) — the
      // first question lands as its child, never a new root.
      parentId: rootIdRef.current,
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

    // Merge, never wipe — the project's imported CODE/BRANCH/PLAN tree must
    // survive the optimistic add. rootId is untouched: it stays the project's
    // CODE root, not this new QUERY node.
    setNodes(prev => ({ ...prev, [tempId]: optimisticNode }));
    setActiveId(tempId);
    setLoadingRoot(true);

    track('root_query', { webSearch: tweaksRef.current.webSearch, project: true });
    await consumeRootStream(
      tempId,
      onEvent => createRootQueryInSessionStream(idToken, sid, {
        query,
        sectionCount: tweaksRef.current.maxSections,
        webSearch: tweaksRef.current.webSearch,
      }, onEvent),
      { kind: 'ROOT_IN_SESSION', sessionId: sid, query },
    );
  }, [idToken, consumeRootStream]);

  // Fills an already-existing, still-empty BRANCH root with the LLM answer to
  // its rootQuery (D1/D3 — a from-scratch "new repo" project). Unlike
  // submitRootQuery/submitProjectQuery this never creates an optimistic temp
  // node: the root node already exists (seeded by ProjectsService.create,
  // already in `nodes` via the loadSession that ran right before this is
  // called) and keeps the same id throughout — events just patch it in place.
  // `rootNodeId` is the source of truth (callers get it from openProject's/
  // loadSession's return value); rootIdRef is only a fallback for the rare
  // caller that hasn't threaded the id through yet — reading the ref alone
  // races loadSession's state settling and silently drops the query.
  const submitFillRoot = useCallback(async (sid: string, query: string, rootNodeId?: string | null) => {
    if (!idToken) return;
    const nodeId = rootNodeId ?? rootIdRef.current;
    if (!nodeId) return;

    setNodes(prev => prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], loading: true } } : prev);
    setLoadingRoot(true);

    track('root_query', { webSearch: tweaksRef.current.webSearch, project: true, newRepo: true });
    try {
      await createRootQueryInSessionStream(idToken, sid, {
        query,
        sectionCount: tweaksRef.current.maxSections,
        webSearch: tweaksRef.current.webSearch,
      }, event => {
        if (event.type === 'meta') {
          setNodes(prev => {
            const node = prev[nodeId];
            if (!node) return prev;
            return { ...prev, [nodeId]: { ...node, title: event.title, emoji: event.emoji, lede: event.lede } };
          });
        } else if (event.type === 'section') {
          setNodes(prev => {
            const node = prev[nodeId];
            if (!node) return prev;
            return { ...prev, [nodeId]: { ...node, sections: [...node.sections, { id: event.id, heading: event.heading, body: event.body }] } };
          });
        } else if (event.type === 'done') {
          const doneSections = event.sections;
          const doneSources = event.sources;
          const doneModel = event.model;
          setNodes(prev => {
            const node = prev[nodeId];
            if (!node) return prev;
            return {
              ...prev,
              [nodeId]: {
                ...node,
                loading: false,
                ...(doneModel ? { model: doneModel } : {}),
                ...(doneSections ? { sections: doneSections } : {}),
                ...(doneSources?.length ? { sources: doneSources } : {}),
              },
            };
          });
          refreshCredit();
        }
      });
    } catch (err) {
      console.error('Failed to fill project root', err);
      const { msg, status } = nodeErrorDisplay(err);
      setNodes(prev => prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], loading: false, error: msg, errorStatus: status } } : prev);
    } finally {
      setLoadingRoot(false);
    }
  }, [idToken, refreshCredit]);

  const handleCreateProject = useCallback(async (payload: CreateProjectPayload): Promise<void> => {
    const project = await createProject(idToken, payload);
    setProjects(prev => [project, ...prev]);
    const loadedRootId = await openProject(project);
    // No ProjectStart interstitial for a from-scratch project — the opening
    // question was already asked in the modal, so stream straight into the map.
    if (project.repoRef.provider === 'new' && payload.rootQuery) {
      void submitFillRoot(project.sessionId, payload.rootQuery, loadedRootId);
    }
  }, [idToken, openProject, submitFillRoot]);

  // Landing (authed): a plain query kicks off a from-scratch project rather
  // than a plain research session — same synthesized repoRef the NewProjectModal
  // "New repo" tab uses, just skipping the modal since the query box already
  // asked the opening question. Project name follows the same ≤5-word/≤60-char
  // truncation style used elsewhere for titles (short5 + a hard char cap).
  const submitLandingProject = useCallback(async (query: string, plugins: string[]) => {
    const name = short5(query).slice(0, 60);
    setLoadingRoot(true);
    try {
      await handleCreateProject({ name, repoRef: synthesizeNewRepoRef(name), plugins, rootQuery: query });
    } catch (err) {
      console.error('Failed to create project from query', err);
      setLoadingRoot(false);
    }
  }, [handleCreateProject]);

  // Restores a query typed on Landing while logged out. The onSubmit wiring
  // below stashes it here before forcing the login screen — submitRootQuery's
  // own `!idToken` bail would otherwise just drop it — and this effect replays
  // it as a from-scratch project once auth settles. Must be declared after
  // submitLandingProject (see root CLAUDE.md's hook-ordering caveat: an effect
  // closing over a useCallback declared later throws in the temporal dead zone).
  const pendingQueryFiredRef = useRef(false);
  useEffect(() => {
    if (status !== 'authenticated' || !idToken || pendingQueryFiredRef.current) return;
    const raw = localStorage.getItem('forkai-code.pendingQuery');
    if (!raw) return;
    pendingQueryFiredRef.current = true; // guard against StrictMode's double-invoke
    localStorage.removeItem('forkai-code.pendingQuery');
    try {
      const { query, plugins } = JSON.parse(raw) as { query: string; plugins: string[] };
      void submitLandingProject(query, plugins);
    } catch { /* malformed stash — nothing to replay */ }
  }, [status, idToken, submitLandingProject]);

  // ── Document upload: build a whole mind-map in one stream ──────────────────
  // Authed-only (Landing routes guests to login). Mirrors submitRootQuery's
  // optimistic/persist-first shape, but the backend streams the whole tree:
  // init → skeleton (all nodes loading at once) → node-done (root→leaf) → done.
  const submitDocument = useCallback(async (documentText: string, fileName: string) => {
    if (!idToken) return;

    const tempRootId = uid();
    const optimisticRoot: ForkNode = {
      id: tempRootId,
      parentId: null,
      kind: 'QUERY',
      title: fileName.replace(/\.[^.]+$/, ''),
      emoji: null,
      query: fileName,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: Date.now(),
      loading: true,
    };

    setNodes({ [tempRootId]: optimisticRoot });
    setRootId(tempRootId);
    setActiveId(tempRootId);
    setSessionId(null);
    setAnnotations([]);
    setPersistentHl({});
    setHighlightsList([]);
    setLoadingRoot(true);

    let rootNodeId = tempRootId;
    track('document_upload', { chars: documentText.length });

    try {
      await createDocumentSessionStream(
        idToken,
        documentText,
        fileName,
        tweaksRef.current.maxSections,
        tweaksRef.current.webSearch,
        tweaksRef.current.answerStyle === 'verbose',
        tweaksRef.current.branchModel,
        (event: DocumentStreamEvent) => {
          if (event.type === 'init') {
            // Session persisted up-front; adopt its id (URL hash) and swap the
            // optimistic temp root for the real one so a refresh mid-extraction restores it.
            rootNodeId = event.nodeId;
            setSessionId(event.sessionId);
            setNodes(prev => {
              const node = prev[tempRootId];
              if (!node) return prev;
              const next: Record<string, ForkNode> = {};
              for (const [k, v] of Object.entries(prev)) {
                next[k === tempRootId ? event.nodeId : k] = k === tempRootId ? { ...node, id: event.nodeId } : v;
              }
              return next;
            });
            setRootId(event.nodeId);
            setActiveId(event.nodeId);
          } else if (event.type === 'skeleton') {
            // Render the whole tree shape at once — every node loading.
            const map: Record<string, ForkNode> = {};
            event.nodes.forEach((n, i) => {
              map[n.id] = {
                id: n.id,
                parentId: n.parentId,
                kind: n.kind,
                title: n.title,
                emoji: n.emoji,
                query: n.title,
                lede: '',
                sections: [],
                fromSection: null,
                fromText: null,
                createdAt: Date.now() + i, // preserve server BFS order for sibling sort
                loading: true,
              };
            });
            setNodes(map);
            setRootId(rootNodeId);
            setActiveId(rootNodeId);
          } else if (event.type === 'node-done') {
            const node = toForkNode(event.node);
            setNodes(prev => ({ ...prev, [node.id]: node }));
          } else if (event.type === 'done') {
            setSessionId(event.sessionId);
            refreshCredit();
            setSessions(s => {
              if (s.some(x => x.sessionId === event.sessionId)) return s;
              return [{
                sessionId: event.sessionId,
                title: event.title,
                emoji: event.emoji,
                lede: event.lede,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                nodeCount: event.nodeCount,
                highlightCount: 0,
              }, ...s];
            });
          }
        },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setRootQueryOutOfCredit(true);
        setNodes({});
        setRootId(null);
        setActiveId(null);
      } else {
        console.error('Failed to build session from document', err);
        const { msg, status } = nodeErrorDisplay(err);
        track('node_error', { kind: 'QUERY', status, message: msg });
        setNodes(prev => prev[rootNodeId]
          ? { ...prev, [rootNodeId]: { ...prev[rootNodeId], loading: false, error: msg, errorStatus: status } }
          : prev);
      }
    } finally {
      setLoadingRoot(false);
      // Clear any lingering loading flags (e.g. a node that never streamed back).
      setNodes(prev => {
        const entries = Object.entries(prev);
        if (!entries.some(([, v]) => v.loading)) return prev;
        const next: Record<string, ForkNode> = {};
        for (const [k, v] of entries) next[k] = v.loading ? { ...v, loading: false } : v;
        return next;
      });
    }
  }, [idToken]);

  // ── Branch: Go Deeper ─────────────────────────────────────────────────────

  const expandSectionAsChild = useCallback(async (parentNodeId: string, section: ForkNode['sections'][0], reuseNodeId?: string, boost?: boolean) => {
    const sid = sessionIdRef.current;
    if (!sid || !idToken) return;
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
      const apiNode = await createNode(idToken, sid, nodePayload);
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      setActiveId(realNode.id);
      refreshCredit();
      track('branch_created', { kind: 'DEEPER', model: tweaksRef.current.branchModel });
    } catch (err) {
      const { msg, status, code } = nodeErrorDisplay(err);
      track('node_error', { kind: 'DEEPER', status, message: msg });
      // A Cut-Off retries with a doubled budget (boost). See ADR-0009.
      const truncated = code === 'OUTPUT_TRUNCATED';
      if (status !== 402) {
        retryInfoRef.current[tempId] = { kind: 'DEEPER', parentNodeId, section, boost: truncated };
      }
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: status, errorCode: code } }));
    } finally {
      setSectionLoading(null);
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
    }
  }, [nodes, idToken, scrollWsTop]);

  // ── Branch: Ask AI from highlight ────────────────────────────────────────

  const askFromHighlight = useCallback(async (question: string, source: FollowUpState, reuseNodeId?: string, boost?: boolean) => {
    const sid = sessionIdRef.current;
    if (!sid || !idToken) return;
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
      const apiNode = await createNode(idToken, sid, nodePayload);
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
      // Branch source gets the reserved glow style, not the last picked highlighter
      // colour — except the agent-log pseudo-section, which isn't real section
      // content and has no persisted-highlight rendering path (Phase G: ask-only).
      if (source.sectionId !== 'agentlog') {
        persistHighlight(source.nodeId, source.sectionId, source.text, BRANCH_HL, null, source.start, source.end);
      }
      refreshCredit();
      track('branch_created', { kind: 'ASK', model: tweaksRef.current.branchModel });
    } catch (err) {
      const { msg, status, code } = nodeErrorDisplay(err);
      track('node_error', { kind: 'ASK', status, message: msg });
      // A Cut-Off retries with a doubled budget (boost). See ADR-0009.
      const truncated = code === 'OUTPUT_TRUNCATED';
      if (status !== 402) {
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
  }, [nodes, idToken, scrollWsTop, persistHighlight]);

  // ── Branch: fork a new lane off a CODE node's commit pill ─────────────────

  const forkBranch = useCallback(async (nodeId: string, branchName: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !idToken) return;
    const parent = nodes[nodeId];
    if (!parent) return;

    const tempId = uid();
    setNodes(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        parentId: nodeId,
        title: `Fork: ${branchName}`,
        kind: 'BRANCH',
        query: branchName,
        emoji: null,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        createdAt: Date.now(),
        loading: true,
        branchName,
      },
    }));
    setActiveId(tempId);
    scrollWsTop();
    setLoadingNodes(prev => new Set(prev).add(tempId));

    try {
      const apiNode = await createBranchNode(idToken, sid, { parentNodeId: nodeId, branchName });
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      setActiveId(realNode.id);
      refreshCredit();
      track('branch_created', { kind: 'BRANCH' });
    } catch (err) {
      const { msg, status, code } = nodeErrorDisplay(err);
      track('node_error', { kind: 'BRANCH', status, message: msg });
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: status, errorCode: code } }));
    } finally {
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
    }
  }, [nodes, idToken, scrollWsTop]);

  // ── PR: open + merge (git-graph select-mode 'pr') ─────────────────────────
  // No optimistic node — unlike the other branch flows, a PR isn't created
  // until the user explicitly confirms in the overlay, so there's nothing to
  // show mid-flight; a failure is surfaced via prConfirmError in the overlay
  // itself instead of on a temp node.

  const confirmPr = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || !idToken || !prSourceId || !prTargetId) return;
    setPrSubmitting(true);
    setPrConfirmError(null);
    try {
      const apiNode = await createPrNode(idToken, sid, { sourceNodeId: prSourceId, targetNodeId: prTargetId });
      const mergeNode = toForkNode(apiNode);
      setNodes(prev => ({ ...prev, [mergeNode.id]: mergeNode }));
      setActiveId(mergeNode.id);
      scrollWsTop();
      refreshCredit();
      track('branch_created', { kind: 'MERGE' });
      exitMixer();
    } catch (err) {
      const { msg } = nodeErrorDisplay(err);
      setPrConfirmError(msg);
    } finally {
      setPrSubmitting(false);
    }
  }, [idToken, prSourceId, prTargetId, exitMixer, scrollWsTop]);

  const mergeOpenPr = useCallback(async (nodeId: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !idToken) return;
    setPrMerging(true);
    setPrMergeError(null);
    try {
      const { mergeNode: apiMergeNode, commitNode: apiCommitNode } = await mergePr(idToken, sid, nodeId);
      const mergeNode = toForkNode(apiMergeNode);
      const commitNode = toForkNode(apiCommitNode);
      setNodes(prev => ({ ...prev, [mergeNode.id]: mergeNode, [commitNode.id]: commitNode }));
      track('branch_created', { kind: 'MERGE' });
    } catch (err) {
      const { msg } = nodeErrorDisplay(err);
      setPrMergeError({ nodeId, message: msg });
    } finally {
      setPrMerging(false);
    }
  }, [idToken]);

  // ── CODE node: "Implement"/"Continue" — runs the mocked coding agent ─────

  const submitCodeNode = useCallback(async (instruction: string, attachments: ComposerAttachment[], reuseNodeId?: string) => {
    const sid = sessionIdRef.current;
    // Retry re-runs against the failed node's own parent — activeId at that
    // point is the failed CODE node itself (AgentLogPane renders for `active`).
    const parentNodeId = reuseNodeId ? (nodes[reuseNodeId]?.parentId ?? null) : activeId;
    if (!sid || !idToken || !parentNodeId) return;
    const parent = nodes[parentNodeId];
    if (!parent) return;

    // Retry reuses the failed node's id so the card flips back to loading in place.
    const tempId = reuseNodeId ?? uid();
    setNodes(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        parentId: parentNodeId,
        title: short5(instruction),
        kind: 'CODE',
        query: instruction,
        emoji: null,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: null,
        createdAt: Date.now(),
        loading: true,
        agentStatus: 'running',
      },
    }));
    setActiveId(tempId);
    scrollWsTop();
    setLoadingNodes(prev => new Set(prev).add(tempId));
    setCodeSubmitLoading(true);

    let realNodeId = tempId;
    try {
      await createCodeNodeStream(
        idToken,
        sid,
        { parentNodeId, instruction, model: tweaksRef.current.branchModel, attachments: attachments.length ? attachments : undefined },
        (event) => {
          if (event.type === 'branch-init') {
            // A parallel instruction auto-forked a BRANCH node ahead of the CODE
            // node below — drop it straight into state (it's already fully
            // persisted, not a loading placeholder) so the map shows the fork.
            const branch = toForkNode(event.node);
            setNodes(prev => ({ ...prev, [branch.id]: branch }));
          } else if (event.type === 'init') {
            // Real node is already persisted (agentStatus 'running') — swap the
            // temp id now so the map shows the node on its lane immediately.
            const real = toForkNode(event.node);
            realNodeId = real.id;
            setNodes(prev => {
              const next = { ...prev };
              delete next[tempId];
              next[real.id] = { ...real, loading: true };
              return next;
            });
            setActiveId(prev => (prev === tempId ? real.id : prev));
            setAgentLogs(prev => ({ ...prev, [real.id]: [] }));
            setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); n.add(real.id); return n; });
          } else if (event.type === 'agent-event') {
            setAgentLogs(prev => ({ ...prev, [realNodeId]: [...(prev[realNodeId] ?? []), event.event] }));
          } else if (event.type === 'commit') {
            setNodes(prev => prev[realNodeId]
              ? { ...prev, [realNodeId]: { ...prev[realNodeId], commitSha: event.sha, branchName: event.branchName, commitMessage: event.message, diffSummary: event.diffSummary } }
              : prev);
          } else if (event.type === 'done') {
            const real = toForkNode(event.node);
            setNodes(prev => ({ ...prev, [realNodeId]: { ...real, loading: false } }));
            refreshCredit();
            track('branch_created', { kind: 'CODE', model: tweaksRef.current.branchModel });
          }
        },
      );
    } catch (err) {
      const { msg, status, code } = nodeErrorDisplay(err);
      track('node_error', { kind: 'CODE', status, message: msg });
      setNodes(prev => prev[realNodeId]
        ? { ...prev, [realNodeId]: { ...prev[realNodeId], loading: false, error: msg, errorStatus: status, errorCode: code, agentStatus: 'error' } }
        : prev);
    } finally {
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); n.delete(realNodeId); return n; });
      setCodeSubmitLoading(false);
    }
  }, [nodes, idToken, activeId, scrollWsTop, refreshCredit]);

  // AgentLogPane's own Retry (for a failed run) — separate from the generic
  // retryInfoRef/ws-error banner mechanism, since CODE nodes never render into
  // that banner (they render via AgentLogPane, which has its own error strip).
  const onRetryRun = useCallback((nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return;
    void submitCodeNode(node.query, [], nodeId);
  }, [nodes, submitCodeNode]);

  // AgentLogPane polls the persisted AgentRun on a mid-run refresh (no SSE to
  // resume into) and calls this once it resolves — patch in what the 'done'/
  // 'error' SSE event would have applied, since that event never reached this tab.
  const handleRunResolved = useCallback((nodeId: string, run: AgentRun) => {
    setNodes(prev => {
      const node = prev[nodeId];
      if (!node) return prev;
      const patch: Partial<ForkNode> = { agentStatus: run.status, loading: false };
      if (run.commitSha !== undefined) patch.commitSha = run.commitSha;
      if (run.branchName !== undefined) patch.branchName = run.branchName;
      if (run.commitMessage !== undefined) patch.commitMessage = run.commitMessage;
      if (run.diffSummary !== undefined) patch.diffSummary = run.diffSummary;
      // The persist-first placeholder title (query.slice(0,60)) never got replaced
      // because the `done` SSE event never reached this tab — derive it from the
      // commit message the same way nodes.service.ts does server-side (nodes.service.ts:766).
      if (run.commitMessage && node.title === node.query.slice(0, 60)) {
        patch.title = run.commitMessage.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || node.title;
      }
      return { ...prev, [nodeId]: { ...node, ...patch } };
    });
  }, []);

  // "Ask about this commit" on a CODE node's AgentLogPane — spawns an ASK node
  // with no highlight selection, so the commit message stands in as the anchor
  // text (the ASK route requires non-empty highlightText).
  const askAboutCommit = useCallback(async (nodeId: string, question: string, reuseNodeId?: string) => {
    const sid = sessionIdRef.current;
    if (!sid || !idToken) return;
    const parent = nodes[nodeId];
    if (!parent) return;
    const anchorText = parent.commitMessage || parent.title;

    // Retry reuses the failed node's id so the card flips back to loading in place.
    const tempId = reuseNodeId ?? uid();
    setAskCommitLoading(true);
    setLoadingNodes(prev => new Set(prev).add(tempId));
    setNodes(prev => ({
      ...prev,
      [tempId]: {
        id: tempId,
        parentId: nodeId,
        title: short5(question),
        kind: 'ASK',
        query: question,
        emoji: null,
        lede: '',
        sections: [],
        fromSection: null,
        fromText: anchorText,
        createdAt: Date.now(),
        loading: true,
      },
    }));
    try {
      const apiNode = await createNode(idToken, sid, {
        kind: 'ASK',
        parentNodeId: nodeId,
        fromSection: '',
        query: question,
        highlightText: anchorText,
        sectionCount: tweaksRef.current.maxSections,
        webSearch: tweaksRef.current.webSearch,
        verbose: tweaksRef.current.answerStyle === 'verbose',
        model: tweaksRef.current.branchModel,
      });
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      setActiveId(realNode.id);
      scrollWsTop();
      refreshCredit();
      track('branch_created', { kind: 'ASK', model: tweaksRef.current.branchModel });
    } catch (err) {
      const { msg, status, code } = nodeErrorDisplay(err);
      track('node_error', { kind: 'ASK', status, message: msg });
      if (status !== 402) {
        retryInfoRef.current[tempId] = { kind: 'ASK_COMMIT', parentNodeId: nodeId, question };
      }
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: status, errorCode: code } }));
    } finally {
      setAskCommitLoading(false);
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
    }
  }, [nodes, idToken, scrollWsTop, refreshCredit]);

  // ── Retry a failed LLM node ───────────────────────────────────────────────

  const retryNode = useCallback((failedId: string) => {
    const info = retryInfoRef.current[failedId];
    if (!info) return;
    delete retryInfoRef.current[failedId];
    track('retry_clicked', { kind: info.kind });
    if (info.kind === 'ROOT') void submitRootQuery(info.query);
    else if (info.kind === 'ROOT_IN_SESSION') void submitProjectQuery(info.sessionId, info.query, failedId);
    else if (info.kind === 'DEEPER') void expandSectionAsChild(info.parentNodeId, info.section, failedId, info.boost);
    else if (info.kind === 'ASK_COMMIT') void askAboutCommit(info.parentNodeId, info.question, failedId);
    else void askFromHighlight(info.question, info.source, failedId, info.boost);
  }, [submitRootQuery, submitProjectQuery, expandSectionAsChild, askFromHighlight, askAboutCommit]);

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

  // Escape exits mixer/plan select mode
  useEffect(() => {
    if (!selectMode) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') exitMixer(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [selectMode, exitMixer]);

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

  const onMapSelect = (id: string) => {
    if (id.startsWith('seg:')) {
      setExpandedSegIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setActiveId(id);
    scrollWsTop();
  };
  const onMapContext = (id: string, x: number, y: number) => setContextMenu({ x, y, nodeId: id });

  const onMixerSelect = useCallback((id: string) => {
    setMixerSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }, []);

  const spawnMix = useCallback(async () => {
    const isPlanMode = selectMode === 'plan';
    // Plan mode may spawn from the base node alone — zero selected sources is valid.
    if (!activeId || !sessionId || !idToken || !mixerQuestion.trim()) return;
    if (!isPlanMode && mixerSelectedIds.length === 0) return;

    const trimmed = mixerQuestion.trim();
    const expanded = SHORTHANDS[trimmed] ?? trimmed;
    if (expanded !== trimmed) setMixerQuestion(expanded);

    // Phase 1 (0–0.5s): collapse the input panel into the button
    setMixerCollapsing(true);

    // Measure positions for ghost animation
    const baseEl = nodeRefs.current.get(activeId);
    const ghostData = mixerSelectedIds.map(id => {
      const el = nodeRefs.current.get(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const baseRect = baseEl?.getBoundingClientRect();
      return { id, rect, baseRect };
    }).filter(Boolean) as Array<{ id: string; rect: DOMRect; baseRect?: DOMRect }>;

    // Phase 2 (0.5s): spawn ghost divs and animate them toward A
    await new Promise<void>(resolve => setTimeout(resolve, 500));

    const baseRect = baseEl?.getBoundingClientRect();
    if (baseRect && ghostData.length > 0) {
      const container = document.createElement('div');
      container.className = 'mixer-ghost-container';
      document.body.appendChild(container);

      const ghosts = ghostData.map(({ id, rect }) => {
        const gh = document.createElement('div');
        gh.className = 'mixer-ghost';
        gh.textContent = nodes[id]?.title ?? '';
        gh.style.left = `${rect.left}px`;
        gh.style.top = `${rect.top}px`;
        gh.style.width = `${rect.width}px`;
        gh.style.height = `${rect.height}px`;
        container.appendChild(gh);
        return gh;
      });

      // Trigger animation: scale down + translate to base node
      requestAnimationFrame(() => {
        ghosts.forEach(gh => {
          const tx = baseRect.left + baseRect.width / 2 - (parseFloat(gh.style.left) + parseFloat(gh.style.width) / 2);
          const ty = baseRect.top + baseRect.height / 2 - (parseFloat(gh.style.top) + parseFloat(gh.style.height) / 2);
          gh.style.transform = `translate(${tx}px, ${ty}px) scale(0.3)`;
          gh.style.opacity = '0';
        });
      });

      // Phase 3 (2.1s): ghosts arrive, pulse A's card
      await new Promise<void>(resolve => setTimeout(resolve, 2100));
      container.remove();

      if (baseEl) {
        const cardEl = baseEl.querySelector<SVGGElement>('.mm-node-anim');
        if (cardEl) {
          cardEl.classList.add('mixer-pulse');
          setTimeout(() => cardEl.classList.remove('mixer-pulse'), 400);
        }
      }
    }

    // Phase 4: start shake animation + fire API call
    setMixerAnimating(true);
    const baseCardEl = baseEl?.querySelector<SVGGElement>('.mm-node-anim');
    if (baseCardEl) baseCardEl.classList.add('mixer-shaking');

    const tempId = uid();
    const optimisticNode: ForkNode = {
      id: tempId,
      parentId: activeId,
      kind: isPlanMode ? 'PLAN' : 'MIX',
      title: isPlanMode ? 'Planning…' : 'Synthesizing…',
      emoji: null,
      query: expanded,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: Date.now(),
      loading: true,
    };
    setNodes(prev => ({ ...prev, [tempId]: optimisticNode }));
    setLoadingNodes(prev => new Set([...prev, tempId]));

    try {
      const result = await createMixNode(idToken, sessionId, {
        parentNodeId: activeId,
        sourceNodeIds: mixerSelectedIds,
        query: expanded,
        sectionCount: tweaksRef.current.maxSections,
        model: tweaksRef.current.branchModel,
        ...(isPlanMode ? { plan: true } : {}),
      });

      const realNode = toForkNode(result);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });

      // Pop-in animation on the new node (target the inner .mm-node-anim group, not the
      // foreignObject's .mm-card div — see the Safari note on .mm-node-anim in MindMap.tsx)
      setTimeout(() => {
        const el = nodeRefs.current.get(realNode.id);
        const newCardEl = el?.querySelector<SVGGElement>('.mm-node-anim');
        if (newCardEl) {
          newCardEl.classList.add('mixer-pop');
          setTimeout(() => newCardEl.classList.remove('mixer-pop'), 400);
        }
      }, 50);

      setActiveId(realNode.id);
      scrollWsTop();
    } catch (err) {
      const { msg } = nodeErrorDisplay(err);
      setNodes(prev => ({
        ...prev,
        [tempId]: { ...prev[tempId], loading: false, error: msg, errorStatus: err instanceof ApiError ? err.status : undefined },
      }));
    } finally {
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
      if (baseCardEl) baseCardEl.classList.remove('mixer-shaking');
      exitMixer();
    }
  }, [activeId, sessionId, idToken, mixerSelectedIds, mixerQuestion, selectMode, nodes, exitMixer, scrollWsTop]);

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

  // ── Derived state ─────────────────────────────────────────────────────────

  // Nodes a collapse pass must never fold into a segment's hidden interior —
  // the active node (covers a URL-hash deep link landing mid-chain too, since
  // collapseSegments treats a protected node's chain as un-extendable past it)
  // and whatever's mid-selection in mixer/plan mode.
  const segProtectedIds = useMemo(
    () => new Set([activeId, ...mixerSelectedIds].filter((id): id is string => !!id)),
    [activeId, mixerSelectedIds],
  );
  const { displayNodes } = useMemo(
    () => collapseSegments(nodes, expandedSegIds, segProtectedIds),
    [nodes, expandedSegIds, segProtectedIds],
  );

  const active = activeId ? nodes[activeId] : null;
  // The mixer/plan base node is always the current activeId (fixed for the
  // duration of a select-mode session — selecting nodes doesn't change activeId).
  const showPlan = !!idToken && canBePlanBase(active);
  // PR needs at least two branches (distinct branchName values) to merge
  // between — every rail node that carries one contributes, so this is a
  // simple distinct-count rather than needing to filter by rail kind first.
  const showPr = useMemo(() => {
    if (!idToken) return false;
    const branchNames = new Set(Object.values(nodes).map(n => n.branchName).filter((b): b is string => !!b));
    return branchNames.size >= 2;
  }, [idToken, nodes]);
  // MERGE never spawns via the bottom composer (canSpawn(MERGE,'CODE') is true
  // per node-grammar.ts, but the merge commit is only ever produced
  // deterministically by mergeOpenPr — see PrPane's own Merge button).
  const showComposer = !!active && active.kind !== 'MERGE' && canSpawn(active.kind, 'CODE');
  // A from-scratch project's root is a BRANCH node the LLM answer streams
  // into (D3) — once it has sections (or is mid-stream), it renders like a
  // normal learn node instead of the empty-BRANCH AgentLogPane stub.
  const branchHasContent = !!active && active.kind === 'BRANCH' && (active.sections.length > 0 || !!active.loading);

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

  // ── Landing / history / loading ───────────────────────────────────────────

  const goHome = () => { setRootId(null); setNodes({}); setSessionId(null); setActiveId(null); setActiveProject(null); setView('landing'); };
  const persistentBrand = (
    <div className="app-brand" onClick={goHome} title="Go to home">
      <span className="brand-logo" aria-hidden="true" /> forkai code
    </div>
  );

  // New visitors (no fork.ai.visited) bypass the login gate — they go to Landing first.
  // Returning users who are logged out see LoginPage (gate uses status + showLogin).
  // `forceLogin` short-circuits the new-visitor bypass so Landing's own "Login"
  // button can summon LoginPage. Gate stays true through the post-login animation:
  // it only flips off when both `showLogin` and `forceLogin` have been cleared by
  // onEnter (1500ms after signIn succeeds), preserving the existing graph animation.
  const isNewVisitor = typeof window !== 'undefined' && !localStorage.getItem('fork.ai.visited');
  if (forceLogin || (!isNewVisitor && (status === 'unauthenticated' || showLogin))) {
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
    if (loadingRoot) inner = <ResearchingScreen sessions={sessions} />;
    // Landing is home again for everyone — History is a regular page reached
    // via Landing's own History button (or a logged-out visitor's, same as before).
    else if (view === 'history') inner = (
      <HistoryPage
        sessions={sessions}
        loading={loadingSessions}
        onLoadSession={loadSession}
        onDeleteSession={handleDeleteSession}
        idToken={idToken}
        onCreateProject={handleCreateProject}
      />
    );
    else inner = (
      <Landing
        onSubmit={(q, plugins) => {
          setRootQueryOutOfCredit(false);
          // Authed: the query becomes a from-scratch project's opening question.
          // Logged-out: stash it and force the login screen directly — routing
          // through submitRootQuery would hit its own `!idToken` bail and just
          // discard the query. The stash is replayed by the pendingQuery effect
          // once auth settles (see submitLandingProject).
          if (status === 'authenticated') {
            void submitLandingProject(q, plugins);
          } else {
            localStorage.setItem('forkai-code.pendingQuery', JSON.stringify({ query: q, plugins }));
            setForceLogin(true);
          }
        }}
        onSubmitDocument={(text, fileName) => { setRootQueryOutOfCredit(false); submitDocument(text, fileName); }}
        loading={loadingRoot}
        onShowHistory={() => setView('history')}
        outOfCredit={rootQueryOutOfCredit}
        initialTopics={initialTopics}
        onLogin={() => setForceLogin(true)}
        loggedIn={status === 'authenticated'}
        onOpenNewProject={status === 'authenticated' ? () => setShowNewProjectModal(true) : undefined}
      />
    );
    return (
      <>
        {persistentBrand}
        {inner}
        {showNewProjectModal && idToken && (
          <NewProjectModal
            idToken={idToken}
            onClose={() => setShowNewProjectModal(false)}
            onCreate={async payload => { await handleCreateProject(payload); setShowNewProjectModal(false); }}
          />
        )}
        <AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} />
        <TweaksPanel tweaks={tweaks} setTweak={setTweak} fontPairOptions={FONT_PAIR_OPTIONS} userEmail={authSession?.user?.email ?? ''} userName={authSession?.user?.name ?? ''} />
      </>
    );
  }

  // A seeded project session loads straight into the Workspace below (rootId
  // is already the imported CODE root) — intercept here, before the commit map
  // renders, but ONLY when the session is effectively empty (see
  // isProjectSessionEmpty above). The gate is computed purely from `nodes`,
  // not from rootBranch.kind/sections or a LEARN_KINDS scan — a content-ful
  // session (CODE commits, branches, a filled root, learn nodes) always skips
  // straight to the workspace, so `activeProject` arriving a frame late via
  // getProject on reopen can never flip an already-content-ful session into
  // this interstitial (activeProject && sessionId stay prerequisites only
  // because ProjectStart needs the project object to render).
  const rootBranch = rootId ? nodes[rootId] : null;
  if (activeProject && sessionId && !projectStartDismissed && isProjectSessionEmpty(nodes)) {
    return (
      <>
        {persistentBrand}
        <ProjectStart
          project={activeProject}
          loading={loadingRoot}
          onSubmit={q => {
            setRootQueryOutOfCredit(false);
            // An empty BRANCH root (from-scratch project whose opening question
            // wasn't asked yet — reached via History rather than the New Project
            // modal) must fill the EXISTING root via the backend's fill-root match,
            // not spawn a new optimistic QUERY child: the stream's init/done events
            // then carry the root's own id, and consumeRootStream's temp-id swap
            // would otherwise clobber the root's parentId/kind with the temp
            // node's, making the root its own parent (see consumeRootStream).
            if (rootBranch && rootBranch.kind === 'BRANCH' && rootBranch.sections.length === 0) {
              void submitFillRoot(sessionId, q, rootId);
            } else {
              void submitProjectQuery(sessionId, q);
            }
          }}
          onOpenMap={() => {
            if (sessionId) markProjectStartDismissed(sessionId);
            setProjectStartDismissed(true);
          }}
        />
        <AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} />
        <TweaksPanel tweaks={tweaks} setTweak={setTweak} fontPairOptions={FONT_PAIR_OPTIONS} userEmail={authSession?.user?.email ?? ''} userName={authSession?.user?.name ?? ''} />
      </>
    );
  }

  // ── Workspace ─────────────────────────────────────────────────────────────

  return (
    <>
      {persistentBrand}
      <AccountButton creditBalance={creditBalance} onCreditUpdated={setCreditBalance} />
    <div className="app" ref={appRef} data-map-open={mapOpen ? '1' : undefined}>
      <header className="topbar">
        <div className="crumbs">
          {rootId && nodes[rootId]?.emoji && /\p{Emoji}/u.test(nodes[rootId].emoji!) && (
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
          {isNarrow && Object.keys(nodes).length > 0 && (
            <button className="icon-btn" onClick={goHome} title="New research">
              <Home size={14} /> Home
            </button>
          )}
          {idToken && (
            <button data-tour="tour-history" className="icon-btn" onClick={() => { setView('history'); setRootId(null); setNodes({}); setSessionId(null); setActiveProject(null); }} title="Research history">
              <Clock size={14} /> History
            </button>
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
            nodes={displayNodes}
            rootId={rootId}
            activeId={activeId}
            onSelect={onMapSelect}
            onContextMenu={onMapContext}
            onForkBranch={forkBranch}
            loadingIds={loadingNodes}
            readIds={readIds}
            selectMode={selectMode}
            mixerBaseId={activeId}
            mixerSelectedIds={mixerSelectedIds}
            onMixerSelect={onMixerSelect}
            onMixerToggleMode={() => selectMode === 'mixer' ? exitMixer() : setSelectMode('mixer')}
            onPlanToggleMode={() => selectMode === 'plan' ? exitMixer() : setSelectMode('plan')}
            showMixer={!!idToken}
            showPlan={showPlan}
            showPr={showPr}
            onPrToggleMode={() => selectMode === 'pr' ? exitMixer() : setSelectMode('pr')}
            prSourceId={prSourceId}
            prTargetId={prTargetId}
            onPrSourceSelect={id => setPrSourceId(id)}
            onPrTargetSelect={id => setPrTargetId(id)}
            nodeRefs={nodeRefs}
          />
        ) : (
          <div className="mm-empty">Mind map will populate as you branch</div>
        )}

        {/* ── PR overlay — separate two-step flow, own overlay shell ───── */}
        {selectMode === 'pr' && (
          <div className="mixer-overlay mixer-overlay--pr">
            {!prSourceId ? (
              <p className="mixer-hint"><GitMerge size={13} className="ic" /> Select the commit to merge (source)</p>
            ) : !prTargetId ? (
              <p className="mixer-hint"><GitMerge size={13} className="ic" /> Click any node on the target branch</p>
            ) : (
              <div className="pr-confirm-row">
                <span className="pr-confirm-text">
                  Merge <strong>{resolveLaneBranchName(nodes, prSourceId) ?? '—'}</strong> into <strong>{resolveLaneBranchName(nodes, prTargetId) ?? '—'}</strong>?
                </span>
                {prConfirmError && <p className="pr-merge-error">{prConfirmError}</p>}
                <div className="pr-confirm-actions">
                  <button className="mm-mixer-btn" onClick={() => setPrTargetId(null)}>Back</button>
                  <button className="mixer-spawn-btn pr-confirm-btn" disabled={prSubmitting} onClick={() => void confirmPr()}>
                    {prSubmitting ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <><GitMerge size={13} /> Confirm</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Mixer/Plan overlay — floats over the mind map ─────────────── */}
        {(selectMode === 'mixer' || selectMode === 'plan') && (
          <div className={`mixer-overlay${mixerCollapsing ? ' mixer-overlay--collapsing' : ''}${selectMode === 'plan' ? ' mixer-overlay--plan' : ''}`}>
            {mixerSelectedIds.length === 0 && selectMode === 'mixer' ? (
              <p className="mixer-hint">
                <Filter size={13} className="ic" /> Click nodes to select them for synthesis (up to 5)
              </p>
            ) : (
              <>
                {mixerSelectedIds.length > 0 && (
                  <div className="mixer-chips">
                    {mixerSelectedIds.map(sid => (
                      <span key={sid} className="mixer-chip">
                        <span className="mixer-chip-label">{nodes[sid]?.title ?? sid}</span>
                        <button
                          className="mixer-chip-remove"
                          onClick={() => setMixerSelectedIds(prev => prev.filter(x => x !== sid))}
                          aria-label={`Remove ${nodes[sid]?.title}`}
                        ><XIcon size={10} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {selectMode === 'plan' && mixerSelectedIds.length === 0 && !mixerCollapsing && (
                  <p className="mixer-hint">
                    <ClipboardList size={13} className="ic" /> Optionally click nodes to include as extra context (up to 5)
                  </p>
                )}
                <div className={`mixer-question-row${mixerCollapsing ? ' mixer-question-row--hidden' : ''}`}>
                  <input
                    className="mixer-question-input"
                    type="text"
                    placeholder={selectMode === 'plan' ? 'What should the plan achieve?' : 'What should I synthesize?'}
                    value={mixerQuestion}
                    onChange={e => setMixerQuestion(e.target.value)}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && mixerQuestion.trim() && !mixerAnimating) {
                        e.preventDefault();
                        void spawnMix();
                      }
                    }}
                  />
                  <button
                    className="mixer-spawn-btn"
                    disabled={!mixerQuestion.trim() || mixerAnimating}
                    onClick={() => void spawnMix()}
                  >
                    {mixerAnimating
                      ? <span className="spinner" style={{ width: 11, height: 11 }} />
                      : selectMode === 'plan'
                        ? <><ClipboardList size={13} /> Plan &amp; Spawn</>
                        : <><Blend size={13} /> Mix &amp; Spawn</>}
                  </button>
                </div>
                <span className="mixer-shortcut-hint">⌘ + ⏎ to {selectMode === 'plan' ? 'plan' : 'mix'} · Esc to cancel</span>
              </>
            )}
          </div>
        )}
      </section>

      <div
        className="pane-divider"
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
      />

      <section className="workspace" ref={wsRef}>
        <div className={`workspace-inner${showComposer ? ' workspace-inner--composer' : ''}`} ref={wsInnerRef}>
          {active && (active.kind === 'CODE' || (active.kind === 'BRANCH' && !branchHasContent)) && sessionId && (
            <AgentLogPane
              node={active}
              events={agentLogs[active.id]}
              project={activeProject}
              idToken={idToken}
              sessionId={sessionId}
              onImplement={() => composerRef.current?.focus()}
              onAskAboutCommit={q => askAboutCommit(active.id, q)}
              askLoading={askCommitLoading}
              onRunResolved={handleRunResolved}
              onRetryRun={onRetryRun}
            />
          )}
          {active && active.kind === 'MERGE' && (
            <PrPane
              node={active}
              sourceNode={active.mergeFromNodeId ? nodes[active.mergeFromNodeId] ?? null : null}
              mergedCommitNode={Object.values(nodes).find(n => n.parentId === active.id && n.kind === 'CODE') ?? null}
              merging={prMerging}
              mergeError={prMergeError && prMergeError.nodeId === active.id ? prMergeError.message : null}
              onMerge={() => void mergeOpenPr(active.id)}
              onOpenCommit={id => { setActiveId(id); scrollWsTop(); }}
            />
          )}
          {active && active.kind !== 'CODE' && active.kind !== 'MERGE' && (active.kind !== 'BRANCH' || branchHasContent) && (
            <>
              <div className="ws-meta">
                <button
                  type="button"
                  data-tour="tour-star"
                  className={`pill pill-kind${active.starred ? ' starred' : ''}`}
                  onClick={() => toggleStar(active)}
                  title={active.starred ? 'Starred — click to unstar' : 'Star this node'}
                >
                  {/* CODE, and an empty BRANCH, never reach this block — they render via AgentLogPane above. */}
                  {active.kind === 'ASK'
                    ? <><Sparkles size={12} className="ic" /> {kindLabel('ASK')}</>
                    : active.kind === 'DEEPER'
                      ? <><CornerDownRight size={12} className="ic" /> {kindLabel('DEEPER')}</>
                      : active.kind === 'MIX'
                        ? <><Blend size={12} className="ic" /> {kindLabel('MIX')}</>
                        : active.kind === 'PLAN'
                          ? <><ClipboardList size={12} className="ic" /> {kindLabel('PLAN')}</>
                          : active.kind === 'BRANCH'
                            ? <><GitBranch size={12} className="ic" /> {kindLabel('BRANCH')}</>
                            : <><Search size={12} className="ic" /> {kindLabel('QUERY')}</>}
                </button>
                {active.kind === 'QUERY' && (
                  <span className="pill"><Hash size={12} className="ic" /> {active.sections.length || '—'} sections</span>
                )}
                {active.model ? <span className="pill">✳ {modelDisplayName(active.model)}</span> : null}
                {active.sources?.length ? <span className="pill pill-search">🔍 Web search</span> : null}
                {titleAskVisible && !active.loading && !active.error && active.sections.length > 0 && (
                  <button
                    className="pill pill-pdf"
                    title="Export to PDF"
                    disabled={pdfExporting}
                    onClick={async () => {
                      setPdfExporting(true);
                      try { await exportNodePdf(active); }
                      catch (err) { console.error('PDF export failed', err); }
                      finally { setPdfExporting(false); }
                    }}
                  >
                    {pdfExporting
                      ? <><span className="spinner" style={{ width: 10, height: 10 }} /> PDF</>
                      : <><FileText size={11} className="ic" /> PDF</>}
                  </button>
                )}
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
                {/* Only PLAN and a filled/filling BRANCH root reach here (CODE and an
                    empty BRANCH render via AgentLogPane, which has its own
                    Implement/Continue trigger) — canSpawn still gates it explicitly
                    so this stays correct if that ever changes. */}
                {!active.loading && !active.error && canSpawn(active.kind, 'CODE') && (
                  <button className="pill pill-code-cta" onClick={() => composerRef.current?.focus()}>
                    <Code size={12} className="ic" /> Implement
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
              {active.fromText && active.kind !== 'MIX' && (
                <div
                  className="inline-callout inline-callout--nav"
                  style={{ marginBottom: 24, cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  title="Go to parent node"
                  onClick={() => active.parentId && setActiveId(active.parentId)}
                  onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && active.parentId) setActiveId(active.parentId); }}
                >
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
        {showComposer && (
          <CodeComposer
            ref={composerRef}
            onSubmit={(instruction, attachments) => void submitCodeNode(instruction, attachments)}
            disabled={codeSubmitLoading}
          />
        )}
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
        askOnly={hlMenu?.sectionId === 'agentlog'}
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
        userEmail={authSession?.user?.email ?? ''}
        userName={authSession?.user?.name ?? ''}
      />
    </div>
    </>
  );
}
