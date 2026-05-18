// Right-pane workspace: sections, hover-to-go-deeper, text selection menu, follow-up popup
const { useState: useStateWS, useEffect: useEffectWS, useRef: useRefWS, useCallback: useCallbackWS } = React;

function Section({ idx, section, node, onDeeper, deeperLoading, sectionChildren, onChildClick, calloutsForSection, onRemoveCallout }) {
  const num = String(idx + 1).padStart(2, "0");
  const I = window.Icons;
  const bodyRef = useRefWS(null);

  const html = useMemoMD(section.body);

  // Run syntax highlighting on code blocks after each render
  useEffectWS(() => {
    if (!bodyRef.current) return;
    // Tag language onto <pre> so CSS can show a chip in the corner
    bodyRef.current.querySelectorAll("pre").forEach(pre => {
      const codeEl = pre.querySelector("code");
      const cls = codeEl?.className || "";
      const m = cls.match(/language-([a-zA-Z0-9+\-_#]+)/);
      if (m) pre.setAttribute("data-lang", m[1]);
    });
    if (!window.hljs) return;
    bodyRef.current.querySelectorAll("pre code:not(.hljs)").forEach(el => {
      try { window.hljs.highlightElement(el); } catch(e) {}
    });
  }, [html]);

  return (
    <section
      className="section appear"
      data-section-id={section.id}
      style={{ animationDelay: `${idx * 70}ms` }}
    >
      <div className="section-head">
        <span className="section-num">{num}</span>
        <h2 data-section-heading>{section.heading}</h2>
        <button
          className={`deeper-btn ${deeperLoading ? "loading" : ""}`}
          onClick={() => onDeeper(section)}
          disabled={deeperLoading}
          aria-label="Go deeper on this section"
          title="Go deeper — creates a child node"
        >
          {deeperLoading ? (
            <><span className="spinner"></span> Thinking…</>
          ) : (
            <><I.CornerDownRight size={13}/> Go deeper</>
          )}
        </button>
      </div>
      <div
        className="section-body md"
        data-section-id={section.id}
        data-section-heading={section.heading}
        ref={bodyRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {calloutsForSection?.length > 0 && (
        <div className="section-callouts">
          {calloutsForSection.map(c => (
            <div key={c.id} className="inline-callout">
              <I.Lightbulb size={18} className="ic"/>
              <div className="body">
                <div className="kicker">Callout</div>
                {c.text}
              </div>
              <button className="close" onClick={() => onRemoveCallout(c.id)} title="Remove">
                <I.X size={14}/>
              </button>
            </div>
          ))}
        </div>
      )}
      {sectionChildren?.length > 0 && (
        <div className="section-children">
          {sectionChildren.map(c => (
            <button key={c.id} className="chip" onClick={() => onChildClick(c.id)}>
              <I.Branch size={13} className="ic"/>
              {c.title}
              <I.ChevronRight size={11}/>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// Memoized markdown render via marked.js. Safe-ish — section.body is from our own
// LLM and rendered in our trusted context. Marked sanitizes minimally; we trust input.
function useMemoMD(src) {
  return React.useMemo(() => {
    if (!src) return "";
    if (!window.marked) return src.split(/\n\n+/).map(p => `<p>${escapeHTML(p)}</p>`).join("");
    try {
      window.marked.setOptions({ gfm: true, breaks: false });
      return window.marked.parse(src);
    } catch (e) {
      return `<p>${escapeHTML(src)}</p>`;
    }
  }, [src]);
}

function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function SkeletonSections() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ marginBottom: 32, paddingLeft: 34 }}>
          <div className="skel-line" style={{ width: "40%", height: 22, marginLeft: -34 }}></div>
          <div className="skel-line"></div>
          <div className="skel-line"></div>
          <div className="skel-line" style={{ width: "80%" }}></div>
        </div>
      ))}
    </>
  );
}

const HL_BG_COLORS = ["#fef08a", "#bbf7d0", "#bae6fd", "#fbcfe8", "#e5e5e5"];
const HL_FG_COLORS = [
  { value: null, label: "Default" },
  { value: "#b91c1c", label: "Red" },
  { value: "#1d4ed8", label: "Blue" },
  { value: "#047857", label: "Green" },
];

function HighlightMenu({ rect, onAction, onClose, lastColors }) {
  const I = window.Icons;
  const ref = useRefWS(null);
  const [pos, setPos] = useStateWS({ left: 0, top: 0 });
  useEffectWS(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.top - h - 10;
    if (top < 12) top = rect.bottom + 10;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    setPos({ left, top });
  }, [rect.left, rect.top, rect.width, rect.height]);

  useEffectWS(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fg = lastColors?.fg ?? null;
  const bg = lastColors?.bg ?? "#fef08a";

  return (
    <div ref={ref} className="hl-menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      <button className="primary" onClick={() => onAction("ask")} title="Ask a follow-up — creates a child node">
        <I.Sparkles size={14}/>
        Ask AI
      </button>
      <span className="sep"></span>
      <div className="hl-colors" title="Highlight color">
        {HL_BG_COLORS.map(c => (
          <button
            key={c}
            className={`hl-swatch ${bg === c ? "active" : ""}`}
            style={{ background: c }}
            onClick={() => onAction("highlight", { bg: c, fg })}
            title={`Highlight · ${c}`}
            aria-label={`Highlight background ${c}`}
          />
        ))}
      </div>
      <span className="sep"></span>
      <div className="hl-fg-colors" title="Text color">
        {HL_FG_COLORS.map((c, i) => (
          <button
            key={i}
            className={`hl-fg-swatch ${(fg ?? null) === c.value ? "active" : ""}`}
            style={{ color: c.value || "var(--ink)" }}
            onClick={() => onAction("highlight", { bg, fg: c.value })}
            title={`Text · ${c.label}`}
            aria-label={`Text color ${c.label}`}
          >A</button>
        ))}
      </div>
      <span className="sep"></span>
      <button onClick={() => onAction("note")} title="Save to Notes">
        <I.FileText size={14}/>
        Note
      </button>
      <button onClick={() => onAction("callout")} title="Pin as callout">
        <I.Lightbulb size={14}/>
        Callout
      </button>
      <button onClick={() => onAction("copy")} title="Copy">
        <I.Copy size={14}/>
      </button>
    </div>
  );
}

function FollowUpPop({ rect, sourceText, onSubmit, onClose, loading }) {
  const I = window.Icons;
  const ref = useRefWS(null);
  const taRef = useRefWS(null);
  const [q, setQ] = useStateWS("");
  const [pos, setPos] = useStateWS({ left: 0, top: 0 });

  useEffectWS(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = rect.top - h - 10;
    if (top < 12) top = 12;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    setPos({ left, top });
    setTimeout(() => taRef.current?.focus(), 30);
  }, [rect.left, rect.top, rect.width, rect.height]);

  useEffectWS(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && q.trim()) onSubmit(q.trim());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, onSubmit, onClose]);

  return (
    <div ref={ref} className="followup-pop" style={{ left: pos.left, top: pos.top }}>
      <div className="src">{truncateWS(sourceText, 180)}</div>
      <textarea
        ref={taRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask anything about this passage…"
        disabled={loading}
      />
      <div className="actions">
        <span className="hint">⌘ + ⏎ to send · Esc to close</span>
        <button
          className="btn-primary"
          disabled={!q.trim() || loading}
          onClick={() => onSubmit(q.trim())}
        >
          {loading ? (
            <><span className="spinner" style={{ width: 10, height: 10, border: "1.5px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }}></span> Asking…</>
          ) : (
            <><I.Sparkles size={13}/> Branch</>
          )}
        </button>
      </div>
    </div>
  );
}

function truncateWS(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

Object.assign(window, { Section, SkeletonSections, HighlightMenu, FollowUpPop });
