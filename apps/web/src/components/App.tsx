'use client';
import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import type { ForkNode, Annotation, HlMenuState, FollowUpState, ContextMenuState } from '@/lib/types';
import { uid, short5, stripMarkdown } from '@/lib/utils';
import { useTweaks } from '@/hooks/useTweaks';
import {
  listSessions,
  getSession,
  createSessionStream,
  createNode,
  renameNode as apiRenameNode,
  deleteNode as apiDeleteNode,
  createAnnotation,
  deleteAnnotation as apiDeleteAnnotation,
  createHighlight,
  toForkNode,
  toAnnotation,
  toHlMap,
  type SessionSummary,
} from '@/lib/api';
import { MindMap } from './MindMap';
import { Section } from './Section';
import { SkeletonSections } from './SkeletonSections';
import { HighlightMenu } from './HighlightMenu';
import { FollowUpPop } from './FollowUpPop';
import { NotesDrawer } from './NotesDrawer';
import { Landing } from './Landing';
import { HistoryPage } from './HistoryPage';
import { TweaksPanel } from './TweaksPanel';
import {
  Search, Bookmark, ChevronRight, PageIcon, Sparkles, CornerDownRight, Hash,
  Quote, AlertCircle, ArrowUpRight, Pencil, Trash, Clock,
} from './Icons';

const TWEAK_DEFAULTS = {
  theme: 'light' as const,
  accent: '#525252',
  density: 'comfortable' as const,
  mapLayout: 'vertical' as const,
  fontPair: 'newsreader-geist',
};

const FONT_PAIRS: Record<string, { serif: string; sans: string; label: string }> = {
  'newsreader-geist': { serif: '"Newsreader", Georgia, serif', sans: '"Geist", system-ui, sans-serif', label: 'Newsreader + Geist' },
  'spectral-inter':   { serif: '"Spectral", Georgia, serif',   sans: '"DM Sans", system-ui, sans-serif',    label: 'Spectral + DM Sans' },
  'fraunces-mono':    { serif: '"Fraunces", Georgia, serif',   sans: '"IBM Plex Sans", system-ui, sans-serif', label: 'Fraunces + Plex' },
};

const ACCENTS = ['#525252', '#888888', '#2383e2', '#7a8c5a', '#b4683b'];
const FONT_PAIR_OPTIONS = Object.entries(FONT_PAIRS).map(([v, p]) => ({ value: v, label: p.label }));
// Stable empty array — prevents Section useMemo from recomputing (and innerHTML from resetting)
// when App re-renders for unrelated reasons (e.g. hlMenu open/close), which would clear selection.
const EMPTY_HLS: never[] = [];

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

export function App() {
  const { data: authSession, status } = useSession();
  // Auth disabled for local testing — guard bypassed on API side, so any non-empty token works
  const idToken = authSession?.idToken ?? 'dev-bypass';

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useState<'landing' | 'history'>('landing');

  // Session list (shown on history page)
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Active research session
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, ForkNode>>({});
  const [rootId, setRootId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Start in loading state if URL hash has a session ID — prevents landing flash on refresh
  const [loadingRoot, setLoadingRoot] = useState(() =>
    typeof window !== 'undefined' ? !!window.location.hash.slice(1) : false
  );
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [sectionLoading, setSectionLoading] = useState<string | null>(null);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [hlMenu, setHlMenu] = useState<HlMenuState | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [persistentHl, setPersistentHl] = useState<Record<string, Array<{ text: string; bg: string | null; fg: string | null }>>>({});
  const [lastHlColors, setLastHlColors] = useState<{ bg: string; fg: string | null }>({ bg: '#fef08a', fg: null });

  const wsRef = useRef<HTMLElement>(null);

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

  // ── Load session list once idToken is available ───────────────────────────

  useEffect(() => {
    setLoadingSessions(true);
    listSessions(idToken)
      .then(setSessions)
      .catch(err => console.error('Failed to load sessions', err))
      .finally(() => setLoadingSessions(false));
  }, [idToken]);

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
    } catch (err) {
      console.error('Failed to load session', err);
    } finally {
      setLoadingRoot(false);
    }
  }, [idToken]);

  // ── Persist active session to localStorage (survive refresh) ─────────────

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('fork.ai.session', sessionId);
      if (activeId) localStorage.setItem('fork.ai.node', activeId);
    } else {
      localStorage.removeItem('fork.ai.session');
      localStorage.removeItem('fork.ai.node');
    }
  }, [sessionId, activeId]);

  // Restore on first load — only if nothing is already loading
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    const savedSession = localStorage.getItem('fork.ai.session');
    const savedNode = localStorage.getItem('fork.ai.node') ?? undefined;
    if (!savedSession) return;
    hasRestoredRef.current = true;
    loadSession(savedSession, savedNode);
  }, [loadSession]);

  // ── Persist highlights (optimistic + background API sync) ─────────────────

  const persistHighlight = useCallback(
    (nodeId: string, sectionId: string, text: string, bg: string | null, fg: string | null) => {
      const key = `${nodeId}::${sectionId}`;
      setPersistentHl(prev => ({
        ...prev,
        [key]: [...(prev[key] ?? []), { text, bg: bg ?? null, fg: fg ?? null }],
      }));
      if (sessionId && idToken) {
        createHighlight(idToken, sessionId, { nodeId, sectionId, text, bg: bg ?? null, fg: fg ?? null })
          .catch(err => console.error('Failed to persist highlight', err));
      }
    },
    [sessionId, idToken],
  );

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
    setLoadingRoot(true);

    try {
      let realNodeId = tempId;

      await createSessionStream(idToken, query, 5, (event) => {
        if (event.type === 'meta') {
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
          // Add to session list
          setNodes(prev => {
            const node = prev[realNodeId];
            if (!node) return prev;
            setSessions(s => [{
              sessionId: event.sessionId,
              title: node.title,
              emoji: node.emoji ?? '',
              lede: node.lede,
              createdAt: new Date(node.createdAt).toISOString(),
              updatedAt: new Date(node.createdAt).toISOString(),
              nodeCount: 1,
            }, ...s]);
            return prev;
          });
        }
      });
    } catch (err) {
      console.error('Failed to create session', err);
      // Clear the failed optimistic node
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
  }, [idToken]);

  // ── Branch: Go Deeper ─────────────────────────────────────────────────────

  const expandSectionAsChild = useCallback(async (parentNodeId: string, section: ForkNode['sections'][0]) => {
    if (!sessionId || !idToken) return;
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
    setActiveId(tempId);
    scrollWsTop();

    try {
      const apiNode = await createNode(idToken, sessionId, {
        kind: 'DEEPER',
        parentNodeId,
        fromSection: section.id,
        query: section.heading,
        sectionBody: section.body,
      });
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      setActiveId(realNode.id);
    } catch (err) {
      console.error('Failed to expand section', err);
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: 'Failed to load. Try again.' } }));
    } finally {
      setSectionLoading(null);
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
    }
  }, [nodes, sessionId, idToken, scrollWsTop]);

  // ── Branch: Ask AI from highlight ────────────────────────────────────────

  const askFromHighlight = useCallback(async (question: string, source: FollowUpState) => {
    if (!sessionId || !idToken) return;
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

    try {
      const apiNode = await createNode(idToken, sessionId, {
        kind: 'ASK',
        parentNodeId: source.nodeId,
        fromSection: source.sectionId,
        query: question,
        highlightText: source.text,
      });
      const realNode = toForkNode(apiNode);
      setNodes(prev => {
        const next = { ...prev };
        delete next[tempId];
        next[realNode.id] = realNode;
        return next;
      });
      // Stay on current node — user navigates via mind map chip
      persistHighlight(source.nodeId, source.sectionId, source.text, lastHlColors.bg, lastHlColors.fg);
    } catch (err) {
      console.error('Failed to ask from highlight', err);
      setNodes(prev => ({ ...prev, [tempId]: { ...prev[tempId], loading: false, error: 'Failed to load. Try again.' } }));
    } finally {
      setLoadingNodes(prev => { const n = new Set(prev); n.delete(tempId); return n; });
      setFollowUp(null);
    }
  }, [nodes, sessionId, idToken, lastHlColors, scrollWsTop, persistHighlight]);

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
        // Wrap the selection in a .temp-hl span directly in the DOM so the visual
        // persists even after Safari clears the native selection on any repaint.
        try {
          const span = document.createElement('span');
          span.className = 'temp-hl';
          range.surroundContents(span);
        } catch { /* range spans element boundaries — skip visual, menu still works */ }
        setHlMenu({
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom },
          text,
          nodeId: activeId!,
          sectionId,
        });
      }, 10);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [activeId]);

  // Clean up .temp-hl spans when the menu closes (if a real highlight was applied,
  // Section's innerHTML was already reset by dangerouslySetInnerHTML, so this is a no-op).
  useLayoutEffect(() => {
    if (hlMenu) return;
    document.querySelectorAll('.temp-hl').forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }, [hlMenu]);

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
      persistHighlight(src.nodeId, src.sectionId, src.text, bg, fg);
      setHlMenu(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    if (action === 'note' || action === 'callout') {
      const fromTitle = nodes[src.nodeId]?.title ?? 'Untitled';
      const tempId = uid();
      const newAnn: Annotation = {
        id: tempId,
        kind: action as 'note' | 'callout',
        text: src.text,
        fromTitle,
        nodeId: src.nodeId,
        sectionId: src.sectionId,
        createdAt: Date.now(),
      };
      setAnnotations(prev => [...prev, newAnn]);
      if (action === 'note') persistHighlight(src.nodeId, src.sectionId, src.text, lastHlColors.bg, lastHlColors.fg);
      setHlMenu(null);
      window.getSelection()?.removeAllRanges();

      if (sessionId && idToken) {
        createAnnotation(idToken, sessionId, {
          kind: action,
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
      setFollowUp({ rect: src.rect, text: src.text, nodeId: src.nodeId, sectionId: src.sectionId, loading: false });
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

  const startNewSession = useCallback(() => {
    if (!confirm('Start a new research session? Your current one is saved.')) return;
    setNodes({});
    setRootId(null);
    setActiveId(null);
    setSessionId(null);
    setAnnotations([]);
    setPersistentHl({});
    if (idToken) {
      listSessions(idToken).then(setSessions).catch(err => console.error(err));
    }
  }, [idToken]);

  useEffect(() => {
    if (!contextMenu) return;
    const onClick = () => setContextMenu(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [contextMenu]);

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

  // ── Landing / history / loading ───────────────────────────────────────────

  if (!rootId) {
    if (loadingRoot) {
      return <ResearchingScreen sessions={sessions} />;
    }
    if (view === 'history') {
      return (
        <HistoryPage
          sessions={sessions}
          loading={loadingSessions}
          onLoadSession={loadSession}
          onBack={() => setView('landing')}
          onNewSearch={() => setView('landing')}
        />
      );
    }
    return (
      <Landing
        onSubmit={submitRootQuery}
        loading={loadingRoot}
        onShowHistory={() => setView('history')}
      />
    );
  }

  // ── Workspace ─────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          style={{ cursor: 'pointer' }}
          onClick={() => { setRootId(null); setNodes({}); setSessionId(null); setActiveId(null); setView('landing'); }}
          title="Go to home"
        >
          <span className="mark">F</span> fork.ai
        </div>
        <div className="divider" />
        <div className="crumbs">
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
                  <PageIcon className="page-ic" /> {n.title}
                </span>
              </span>
            );
          })}
        </div>
        <div className="tools">
          <button className="icon-btn" onClick={startNewSession} title="New search">
            <Search size={14} /> New
          </button>
          <button className="icon-btn" onClick={() => { setView('history'); setRootId(null); setNodes({}); setSessionId(null); }} title="Research history">
            <Clock size={14} /> History
          </button>
          <button className="icon-btn has-badge" onClick={() => setDrawerOpen(true)} title="Notes & Callouts">
            <Bookmark size={14} /> Notes
            {annotations.length > 0 && <span className="badge">{annotations.length}</span>}
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
          />
        ) : (
          <div className="mm-empty">Mind map will populate as you branch</div>
        )}
      </section>

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
                  highlights={persistentHl[`${activeId}::${s.id}`] ?? EMPTY_HLS}
                  onDeeper={sec => expandSectionAsChild(active.id, sec)}
                  deeperLoading={sectionLoading === s.id}
                  sectionChildren={childrenBySection[s.id] ?? []}
                  onChildClick={cid => { setActiveId(cid); scrollWsTop(); }}
                  calloutsForSection={annotations.filter(a => a.kind === 'callout' && a.nodeId === active.id && a.sectionId === s.id)}
                  onRemoveCallout={removeAnnotation}
                />
              ))}
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
        items={annotations}
        onJump={id => { setActiveId(id); scrollWsTop(); setDrawerOpen(false); }}
        onRemove={removeAnnotation}
      />

      <TweaksPanel
        tweaks={tweaks}
        setTweak={setTweak}
        fontPairOptions={FONT_PAIR_OPTIONS}
        accentOptions={ACCENTS}
      />
    </div>
  );
}
