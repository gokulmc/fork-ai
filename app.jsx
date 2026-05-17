// Main app — state, landing, composition
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "#525252",
  "density": "comfortable",
  "mapLayout": "vertical",
  "fontPair": "newsreader-geist"
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  "newsreader-geist": { serif: '"Newsreader", Georgia, serif', sans: '"Geist", system-ui, sans-serif', label: "Newsreader + Geist" },
  "spectral-inter":   { serif: '"Spectral", Georgia, serif',   sans: '"DM Sans", system-ui, sans-serif', label: "Spectral + DM Sans" },
  "fraunces-mono":    { serif: '"Fraunces", Georgia, serif',   sans: '"IBM Plex Sans", system-ui, sans-serif', label: "Fraunces + Plex" },
};

const ACCENTS = ["#525252", "#888888", "#2383e2", "#7a8c5a", "#b4683b"];

const EXAMPLES = [
  "How do neural networks actually learn?",
  "What caused the fall of the Roman Republic?",
  "Explain the theory of plate tectonics",
  "How does mRNA vaccine technology work?",
];

let _idCounter = 1;
const uid = () => `n${Date.now().toString(36)}_${_idCounter++}`;

function App() {
  const I = window.Icons;
  const [tweaks, setTweaks] = useTweaks(TWEAK_DEFAULTS);

  // Tree of nodes: { [id]: { id, parentId, title, kind, query, sections, createdAt, fromSection } }
  const [nodes, setNodes] = useState({});
  const [rootId, setRootId] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingNodes, setLoadingNodes] = useState(new Set());
  const [sectionLoading, setSectionLoading] = useState(null); // section id currently loading deeper
  const [globalError, setGlobalError] = useState(null);

  // Notes / callouts: { id, kind, text, fromTitle, nodeId, sectionId, createdAt }
  const [annotations, setAnnotations] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Selection state
  const [hlMenu, setHlMenu] = useState(null); // { rect, text, nodeId, sectionId }
  const [followUp, setFollowUp] = useState(null); // { rect, text, nodeId, sectionId, loading }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, nodeId }

  // Persistent highlights: per nodeId+sectionId, list of { text, bg, fg }
  const [persistentHl, setPersistentHl] = useState({});
  // Last-chosen highlight colors — clicking a swatch updates these and they become defaults.
  const [lastHlColors, setLastHlColors] = useState({ bg: "#fef08a", fg: null });

  const wsRef = useRef(null);

  // Apply tweaks to root
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tweaks.theme || "light");
    root.setAttribute("data-density", tweaks.density || "comfortable");
    root.style.setProperty("--accent", tweaks.accent || "#b4683b");
    const pair = FONT_PAIRS[tweaks.fontPair] || FONT_PAIRS["newsreader-geist"];
    root.style.setProperty("--serif", pair.serif);
    root.style.setProperty("--sans", pair.sans);
  }, [tweaks]);

  // Submit landing query
  const submitRootQuery = useCallback(async (query) => {
    setLoadingRoot(true);
    setGlobalError(null);
    const id = uid();
    setRootId(id);
    setActiveId(id);
    setNodes({
      [id]: {
        id, parentId: null,
        title: short5(query),
        kind: "QUERY",
        query,
        sections: [],
        createdAt: Date.now(),
        loading: true,
      },
    });
    const res = await window.LLM.answerQuery(query, 5);
    if (!res.ok) {
      setGlobalError(res.error);
      setLoadingRoot(false);
      setNodes(prev => ({ ...prev, [id]: { ...prev[id], loading: false, error: res.error } }));
      return;
    }
    const data = res.data;
    setNodes(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        title: short5(data.title || query),
        emoji: pickEmoji(data.emoji),
        lede: data.lede || "",
        sections: (data.sections || []).map(s => ({ ...s, id: uid() })),
        loading: false,
      },
    }));
    setLoadingRoot(false);
  }, []);

  const expandSectionAsChild = useCallback(async (parentNodeId, section) => {
    const parent = nodes[parentNodeId];
    if (!parent) return;
    const childId = uid();
    setSectionLoading(section.id);
    setLoadingNodes(prev => new Set(prev).add(childId));
    setNodes(prev => ({
      ...prev,
      [childId]: {
        id: childId,
        parentId: parentNodeId,
        title: short5(section.heading),
        kind: "DEEPER",
        query: section.heading,
        sections: [],
        createdAt: Date.now(),
        loading: true,
        fromSection: section.id,
        fromText: `${section.heading}: ${stripMarkdown(section.body).slice(0, 200)}…`,
      },
    }));
    setActiveId(childId);
    scrollWsTop();

    const res = await window.LLM.expandSection(parent.query, section.heading, section.body);
    setSectionLoading(null);
    setLoadingNodes(prev => { const n = new Set(prev); n.delete(childId); return n; });
    if (!res.ok) {
      setNodes(prev => ({ ...prev, [childId]: { ...prev[childId], loading: false, error: res.error } }));
      return;
    }
    const data = res.data;
    setNodes(prev => ({
      ...prev,
      [childId]: {
        ...prev[childId],
        title: short5(data.title || section.heading),
        emoji: pickEmoji(data.emoji),
        lede: data.lede || "",
        sections: (data.sections || []).map(s => ({ ...s, id: uid() })),
        loading: false,
      },
    }));
  }, [nodes]);

  const askFromHighlight = useCallback(async (question, source) => {
    const parent = nodes[source.nodeId];
    if (!parent) return;
    const childId = uid();
    setFollowUp(prev => prev ? { ...prev, loading: true } : null);
    setLoadingNodes(prev => new Set(prev).add(childId));

    setNodes(prev => ({
      ...prev,
      [childId]: {
        id: childId,
        parentId: source.nodeId,
        title: short5(question),
        kind: "ASK",
        query: question,
        sections: [],
        createdAt: Date.now(),
        loading: true,
        fromSection: source.sectionId,
        fromText: source.text,
      },
    }));

    const res = await window.LLM.followUpFromHighlight(parent.query, source.text, question);
    setLoadingNodes(prev => { const n = new Set(prev); n.delete(childId); return n; });

    if (!res.ok) {
      setNodes(prev => ({ ...prev, [childId]: { ...prev[childId], loading: false, error: res.error } }));
      setFollowUp(null);
      setActiveId(childId);
      scrollWsTop();
      return;
    }
    const data = res.data;
    setNodes(prev => ({
      ...prev,
      [childId]: {
        ...prev[childId],
        title: short5(data.title || question),
        emoji: pickEmoji(data.emoji),
        lede: data.lede || "",
        sections: (data.sections || []).map(s => ({ ...s, id: uid() })),
        loading: false,
      },
    }));
    setFollowUp(null);
    setActiveId(childId);
    scrollWsTop();
    // persistent highlight on the parent passage so the ASK trail is visible
    persistHighlight(source.nodeId, source.sectionId, source.text, lastHlColors.bg, lastHlColors.fg);
  }, [nodes, lastHlColors]);

  const scrollWsTop = () => {
    requestAnimationFrame(() => {
      wsRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const persistHighlight = (nodeId, sectionId, text, bg, fg) => {
    const key = `${nodeId}::${sectionId}`;
    const item = { text, bg: bg ?? null, fg: fg ?? null };
    setPersistentHl(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), item],
    }));
  };

  // === Text selection handling ===
  useEffect(() => {
    const onMouseUp = (e) => {
      // If the click target is inside a popup, leave it alone
      if (e.target.closest && (e.target.closest(".hl-menu") || e.target.closest(".followup-pop"))) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setHlMenu(null);
          return;
        }
        const text = sel.toString().trim();
        if (text.length < 3) { setHlMenu(null); return; }
        const range = sel.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        const sectionEl = container.closest?.("[data-section-id]");
        if (!sectionEl) { setHlMenu(null); return; }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) { setHlMenu(null); return; }
        const sectionId = sectionEl.getAttribute("data-section-id");
        setHlMenu({
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom },
          text,
          nodeId: activeId,
          sectionId,
        });
      }, 10);
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [activeId]);

  const handleHlAction = useCallback((action, payload) => {
    if (!hlMenu) return;
    const src = hlMenu;
    if (action === "copy") {
      navigator.clipboard?.writeText(src.text);
      setHlMenu(null);
      return;
    }
    if (action === "highlight") {
      const bg = payload?.bg ?? lastHlColors.bg;
      const fg = payload?.fg ?? lastHlColors.fg;
      setLastHlColors({ bg, fg });
      persistHighlight(src.nodeId, src.sectionId, src.text, bg, fg);
      setHlMenu(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (action === "note" || action === "callout") {
      const fromTitle = nodes[src.nodeId]?.title || "Untitled";
      setAnnotations(prev => [
        ...prev,
        { id: uid(), kind: action, text: src.text, fromTitle, nodeId: src.nodeId, sectionId: src.sectionId, createdAt: Date.now() },
      ]);
      if (action === "note") {
        persistHighlight(src.nodeId, src.sectionId, src.text, lastHlColors.bg, lastHlColors.fg);
      }
      setHlMenu(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (action === "ask") {
      setFollowUp({ rect: src.rect, text: src.text, nodeId: src.nodeId, sectionId: src.sectionId, loading: false });
      setHlMenu(null);
    }
  }, [hlMenu, nodes, lastHlColors]);

  // === Map node interactions ===
  const onMapSelect = (id) => { setActiveId(id); scrollWsTop(); };
  const onMapContext = (id, x, y) => setContextMenu({ x, y, nodeId: id });

  const renameNode = (id) => {
    const name = prompt("Rename node (max 5 words)", nodes[id]?.title);
    if (name && name.trim()) {
      setNodes(prev => ({ ...prev, [id]: { ...prev[id], title: short5(name.trim()) } }));
    }
    setContextMenu(null);
  };
  const deleteBranch = (id) => {
    if (id === rootId) {
      alert("Can't delete the root. Use New search to start over.");
      setContextMenu(null);
      return;
    }
    if (!confirm("Delete this branch and all its descendants?")) {
      setContextMenu(null);
      return;
    }
    // collect descendants
    const toDelete = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      Object.values(nodes).forEach(n => {
        if (toDelete.has(n.parentId) && !toDelete.has(n.id)) {
          toDelete.add(n.id);
          added = true;
        }
      });
    }
    const remaining = {};
    Object.values(nodes).forEach(n => { if (!toDelete.has(n.id)) remaining[n.id] = n; });
    setNodes(remaining);
    if (toDelete.has(activeId)) setActiveId(nodes[id].parentId || rootId);
    // clean annotations
    setAnnotations(prev => prev.filter(a => !toDelete.has(a.nodeId)));
    setContextMenu(null);
  };

  useEffect(() => {
    const onClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener("click", onClick);
      return () => window.removeEventListener("click", onClick);
    }
  }, [contextMenu]);

  // Active node display
  const active = activeId ? nodes[activeId] : null;
  const breadcrumbs = useMemo(() => {
    if (!activeId) return [];
    const arr = [];
    let cur = activeId;
    while (cur) {
      arr.unshift(nodes[cur]);
      cur = nodes[cur]?.parentId;
    }
    return arr;
  }, [activeId, nodes]);

  // children of active that came from a given section
  const childrenBySection = useMemo(() => {
    const m = {};
    Object.values(nodes).forEach(n => {
      if (n.parentId === activeId && n.fromSection) {
        (m[n.fromSection] = m[n.fromSection] || []).push(n);
      }
    });
    return m;
  }, [nodes, activeId]);

  // === Render highlight persistence inside sections ===
  useEffect(() => {
    if (!active) return;
    const root = wsRef.current;
    if (!root) return;
    // Clear old
    root.querySelectorAll(".persistent-hl").forEach(el => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
    root.querySelectorAll(".section-body[data-section-id]").forEach(body => {
      const sid = body.getAttribute("data-section-id");
      const key = `${activeId}::${sid}`;
      const hls = persistentHl[key];
      if (!hls || !hls.length) return;
      hls.forEach(item => wrapTextInElement(body, item));
    });
  }, [active, persistentHl, activeId]);

  if (!rootId) {
    return <Landing onSubmit={submitRootQuery} loading={loadingRoot} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">F</span> fork.ai
        </div>
        <div className="divider"></div>
        <div className="crumbs">
          {breadcrumbs.map((n, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <React.Fragment key={n.id}>
                {i > 0 && <span className="sep"><I.ChevronRight size={11}/></span>}
                <span
                  className={`crumb ${isLast ? "current" : ""}`}
                  onClick={() => !isLast && setActiveId(n.id)}
                  title={n.title}
                >
                  <I.PageIcon className="page-ic"/> {n.title}
                </span>
              </React.Fragment>
            );
          })}
        </div>
        <div className="tools">
          <button className="icon-btn" onClick={() => {
            if (confirm("Start over with a new query?")) {
              setNodes({}); setRootId(null); setActiveId(null);
              setAnnotations([]); setPersistentHl({});
            }
          }} title="New search">
            <I.Search size={14}/>
            New
          </button>
          <button className="icon-btn has-badge" onClick={() => setDrawerOpen(true)} title="Notes & Callouts">
            <I.Bookmark size={14}/>
            Notes
            {annotations.length > 0 && <span className="badge">{annotations.length}</span>}
          </button>
        </div>
      </header>

      <section className="mindmap-pane" data-screen-label="01 Mind Map">
        {Object.keys(nodes).length > 0 ? (
          <MindMap
            nodes={nodes}
            rootId={rootId}
            activeId={activeId}
            onSelect={onMapSelect}
            onContextMenu={onMapContext}
            layout={tweaks.mapLayout || "horizontal"}
            loadingIds={loadingNodes}
          />
        ) : (
          <div className="mm-empty">Mind map will populate as you branch</div>
        )}
      </section>

      <section className="workspace" ref={wsRef} data-screen-label="02 Workspace">
        <div className="workspace-inner">
          {active && (
            <>
              <div className="ws-meta">
                <span className="pill">
                  {active.kind === "ASK" ? <><I.Sparkles size={12} className="ic"/> Follow-up</>
                   : active.kind === "DEEPER" ? <><I.CornerDownRight size={12} className="ic"/> Deep dive</>
                   : <><I.Search size={12} className="ic"/> Query</>}
                </span>
                <span className="pill"><I.Hash size={12} className="ic"/> {active.sections.length || "—"} sections</span>
                {active.loading && (
                  <span className="thinking">Thinking<span className="dots"><span></span><span></span><span></span></span></span>
                )}
              </div>
              <h1 className="ws-title">{active.query}</h1>
              {active.lede && <p className="ws-lede">{active.lede}</p>}
              {active.fromText && (
                <div className="inline-callout" style={{ marginBottom: 24 }}>
                  <I.Quote size={18} className="ic"/>
                  <div className="body">
                    <div className="kicker">{active.kind === "ASK" ? "Branched from" : "Expanded from"}</div>
                    <em>{active.fromText}</em>
                  </div>
                </div>
              )}
              <hr className="ws-rule" />

              {active.error && (
                <div className="ws-error">
                  <I.AlertCircle size={16} className="ic"/>
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
                  onDeeper={(sec) => expandSectionAsChild(active.id, sec)}
                  deeperLoading={sectionLoading === s.id}
                  sectionChildren={childrenBySection[s.id] || []}
                  onChildClick={(cid) => { setActiveId(cid); scrollWsTop(); }}
                  calloutsForSection={annotations.filter(a => a.kind === "callout" && a.nodeId === active.id && a.sectionId === s.id)}
                  onRemoveCallout={(id) => setAnnotations(prev => prev.filter(x => x.id !== id))}
                />
              ))}
            </>
          )}
        </div>
      </section>

      {hlMenu && (
        <HighlightMenu
          rect={hlMenu.rect}
          lastColors={lastHlColors}
          onAction={handleHlAction}
          onClose={() => setHlMenu(null)}
        />
      )}
      {followUp && (
        <FollowUpPop
          rect={followUp.rect}
          sourceText={followUp.text}
          loading={followUp.loading}
          onClose={() => setFollowUp(null)}
          onSubmit={(q) => askFromHighlight(q, followUp)}
        />
      )}
      {contextMenu && (
        <div className="mm-context" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { onMapSelect(contextMenu.nodeId); setContextMenu(null); }}>
            <I.ArrowUpRight className="ic"/>
            Open
          </button>
          <button onClick={() => renameNode(contextMenu.nodeId)}>
            <I.Pencil className="ic"/>
            Rename
          </button>
          <div className="sep"></div>
          <button className="danger" onClick={() => deleteBranch(contextMenu.nodeId)}>
            <I.Trash className="ic"/>
            Delete branch
          </button>
        </div>
      )}

      <NotesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={annotations}
        onJump={(id) => { setActiveId(id); scrollWsTop(); setDrawerOpen(false); }}
        onRemove={(id) => setAnnotations(prev => prev.filter(a => a.id !== id))}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={tweaks.theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(v) => setTweaks("theme", v)} />
        <TweakRadio label="Density" value={tweaks.density} options={[{ value: "comfortable", label: "Cozy" }, { value: "compact", label: "Compact" }]} onChange={(v) => setTweaks("density", v)} />
        <TweakColor label="Accent" value={tweaks.accent} options={ACCENTS} onChange={(v) => setTweaks("accent", v)} />
        <TweakSection label="Typography" />
        <TweakSelect
          label="Font pairing"
          value={tweaks.fontPair}
          options={Object.entries(FONT_PAIRS).map(([v, p]) => ({ value: v, label: p.label }))}
          onChange={(v) => setTweaks("fontPair", v)}
        />
        <TweakSection label="Mind map" />
        <TweakRadio label="Layout" value={tweaks.mapLayout} options={[{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }]} onChange={(v) => setTweaks("mapLayout", v)} />
      </TweaksPanel>
    </div>
  );
}

// ============== Landing ==============
function Landing({ onSubmit, loading }) {
  const I = window.Icons;
  const [q, setQ] = useState("");
  const [leaving, setLeaving] = useState(false);
  const onGo = () => {
    if (!q.trim() || loading) return;
    setLeaving(true);
    setTimeout(() => onSubmit(q.trim()), 280);
  };
  return (
    <div className={`landing ${leaving ? "leaving" : ""}`}>
      <div className="landing-inner">
        <div className="landing-mark">A branching research workspace</div>
        <h1>Ask once. <em>Branch</em> forever.</h1>
        <p className="landing-sub">Type a question. Get an answer split into sections you can dive deeper into, highlight, and branch from. Every detour becomes a node on your mind map.</p>
        <div className="query-box">
          <span className="icon">
            <I.Search size={20}/>
          </span>
          <input
            type="text"
            autoFocus
            value={q}
            placeholder="Try: how does photosynthesis work?"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onGo()}
          />
          <button className="submit" disabled={!q.trim() || loading} onClick={onGo}>
            {loading ? (
              <><span className="spinner" style={{ width: 11, height: 11, border: "1.5px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }}></span> Thinking…</>
            ) : (
              <>Begin <I.ArrowRight size={13}/></>
            )}
          </button>
        </div>
        <div className="examples">
          {EXAMPLES.map(ex => (
            <button key={ex} className="chip" onClick={() => { setQ(ex); }}>
              {ex}
            </button>
          ))}
        </div>
      </div>
      <div className="landing-foot">FORK.AI · V0.1 · BRANCHING RESEARCH, BY YOU</div>
    </div>
  );
}

// ============== utils ==============
function pickEmoji(s) {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(trimmed)[Symbol.iterator]().next().value;
    return first?.segment || trimmed.slice(0, 2);
  } catch (e) {
    return Array.from(trimmed)[0] || null;
  }
}

function short5(s) {
  if (!s) return "Untitled";
  const words = s.replace(/[‘’“”"']/g, "").split(/\s+/).filter(Boolean);
  if (words.length <= 5) return words.join(" ");
  return words.slice(0, 5).join(" ");
}

function stripMarkdown(s) {
  if (!s) return "";
  return s
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[\s ]+/g, " ")
    .trim();
}

function wrapTextInElement(rootEl, item) {
  const target = typeof item === "string" ? item : item?.text;
  const bg = typeof item === "object" ? item.bg : null;
  const fg = typeof item === "object" ? item.fg : null;
  if (!target || target.length < 3) return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const matches = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(".persistent-hl")) continue;
    const idx = node.nodeValue.indexOf(target);
    if (idx >= 0) matches.push({ node, idx });
  }
  matches.forEach(({ node, idx }) => {
    try {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + target.length);
      const span = document.createElement("span");
      span.className = "persistent-hl";
      if (bg) span.style.background = bg;
      if (fg) span.style.color = fg;
      range.surroundContents(span);
    } catch (e) { /* range can't surround — skip */ }
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
