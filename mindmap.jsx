// Mind map — SVG tree with depth-aware shading. Defaults to vertical (top-down).
const { useState, useRef, useEffect, useMemo, useCallback } = React;

const NODE_W = 192;
const NODE_H = 58;
const DEPTH_GAP = 64;   // between successive layers
const SIBLING_GAP = 18; // between siblings within a layer
const PAD = 48;

function layoutTree(nodes, rootId, layout = "vertical") {
  // Build child map
  const childMap = {};
  Object.values(nodes).forEach(n => { childMap[n.id] = []; });
  Object.values(nodes).forEach(n => {
    if (n.parentId && childMap[n.parentId]) childMap[n.parentId].push(n.id);
  });
  Object.keys(childMap).forEach(k => {
    childMap[k].sort((a, b) => (nodes[a].createdAt || 0) - (nodes[b].createdAt || 0));
  });

  // Depth per node
  const depthMap = {};
  function setDepth(id, d) {
    depthMap[id] = d;
    (childMap[id] || []).forEach(k => setDepth(k, d + 1));
  }
  if (nodes[rootId]) setDepth(rootId, 0);

  // Subtree width (count of leaf siblings)
  const subtreeRows = {};
  function leaves(id) {
    if (subtreeRows[id] !== undefined) return subtreeRows[id];
    const kids = childMap[id] || [];
    if (kids.length === 0) { subtreeRows[id] = 1; return 1; }
    let s = 0;
    kids.forEach(k => { s += leaves(k); });
    subtreeRows[id] = s;
    return s;
  }
  leaves(rootId);

  // Assign positions
  const pos = {};
  function place(id, depth, topRow) {
    const rows = subtreeRows[id];
    const centerRow = topRow + rows / 2;
    if (layout === "vertical") {
      // Root at top, branches downward
      pos[id] = {
        x: centerRow * (NODE_W + SIBLING_GAP),
        y: depth * (NODE_H + DEPTH_GAP),
      };
    } else {
      // Root at left, branches to the right
      pos[id] = {
        x: depth * (NODE_W + DEPTH_GAP),
        y: centerRow * (NODE_H + SIBLING_GAP),
      };
    }
    let row = topRow;
    (childMap[id] || []).forEach(k => {
      place(k, depth + 1, row);
      row += subtreeRows[k];
    });
  }
  place(rootId, 0, 0);

  // Bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  Object.values(pos).forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + NODE_H);
  });

  return { pos, bounds: { minX, minY, maxX, maxY }, childMap, depthMap };
}

function MindMap({ nodes, rootId, activeId, onSelect, onContextMenu, layout = "vertical", loadingIds = new Set() }) {
  const svgRef = useRef(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [drag, setDrag] = useState(null);
  const [size, setSize] = useState({ w: 600, h: 600 });
  const I = window.Icons;

  // Measure container
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const { pos, bounds, childMap, depthMap } = useMemo(
    () => layoutTree(nodes, rootId, layout),
    [nodes, rootId, layout]
  );

  // Keep a live ref to the current view so animations read fresh values
  const viewRef = useRef(view);
  viewRef.current = view;
  const animFrame = useRef(null);

  function animateTo(targetTx, targetTy, targetScale, dur = 380) {
    cancelAnimationFrame(animFrame.current);
    const startTx = viewRef.current.tx;
    const startTy = viewRef.current.ty;
    const startScale = viewRef.current.scale;
    const startT = performance.now();
    function step(now) {
      const k = Math.min(1, (now - startT) / dur);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      setView({
        tx: startTx + (targetTx - startTx) * e,
        ty: startTy + (targetTy - startTy) * e,
        scale: startScale + (targetScale - startScale) * e,
      });
      if (k < 1) animFrame.current = requestAnimationFrame(step);
    }
    animFrame.current = requestAnimationFrame(step);
  }
  useEffect(() => () => cancelAnimationFrame(animFrame.current), []);

  // Initial fit-to-view — runs once per layout change, when nodes first appear
  const lastFitKey = useRef("");
  const fitDone = useRef(false);
  useEffect(() => {
    const layoutKey = `${layout}|${size.w}x${size.h}`;
    // Re-fit when layout direction changes (user toggles vertical/horizontal)
    if (lastFitKey.current === layoutKey) return;
    lastFitKey.current = layoutKey;
    if (!Object.keys(nodes).length) { fitDone.current = false; return; }
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0 || size.w <= 0 || size.h <= 0) return;
    const scale = Math.min(1, Math.min((size.w - PAD * 2) / bw, (size.h - PAD * 2) / bh));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setView({
      tx: size.w / 2 - cx * scale,
      ty: size.h / 2 - cy * scale,
      scale,
    });
    fitDone.current = true;
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, size.w, size.h, layout]);

  // Auto-pan to focus the active node whenever activeId changes
  useEffect(() => {
    if (!activeId || !pos[activeId] || size.w <= 0) return;
    if (!fitDone.current) return;
    const target = pos[activeId];
    const cx = target.x + NODE_W / 2;
    const cy = target.y + NODE_H / 2;
    // Zoom in a touch if the user is currently very zoomed out, otherwise hold scale
    const targetScale = Math.max(viewRef.current.scale, 0.85);
    const targetTx = size.w / 2 - cx * targetScale;
    const targetTy = size.h / 2 - cy * targetScale;
    animateTo(targetTx, targetTy, targetScale, 420);
  }, [activeId, pos[activeId]?.x, pos[activeId]?.y, size.w, size.h]);

  const onPointerDown = (e) => {
    if (e.target.closest(".mm-node")) return;
    cancelAnimationFrame(animFrame.current);
    setDrag({ x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    setView(v => ({ ...v, tx: drag.tx + (e.clientX - drag.x), ty: drag.ty + (e.clientY - drag.y) }));
  };
  const onPointerUp = () => setDrag(null);

  const onWheel = (e) => {
    e.preventDefault();
    cancelAnimationFrame(animFrame.current);
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView(v => {
      const newScale = clamp(v.scale * factor, 0.3, 2.5);
      const k = newScale / v.scale;
      return {
        scale: newScale,
        tx: mx - (mx - v.tx) * k,
        ty: my - (my - v.ty) * k,
      };
    });
  };

  const zoomBy = (mul) => {
    setView(v => {
      const newScale = clamp(v.scale * mul, 0.3, 2.5);
      const cx = size.w / 2, cy = size.h / 2;
      const k = newScale / v.scale;
      return {
        scale: newScale,
        tx: cx - (cx - v.tx) * k,
        ty: cy - (cy - v.ty) * k,
      };
    });
  };

  const fitView = () => {
    if (!Object.keys(nodes).length || size.w <= 0) return;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0) return;
    const scale = Math.min(1, Math.min((size.w - PAD * 2) / bw, (size.h - PAD * 2) / bh));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    animateTo(size.w / 2 - cx * scale, size.h / 2 - cy * scale, scale, 380);
  };

  // Edges
  const edges = [];
  Object.keys(childMap).forEach(pid => {
    childMap[pid].forEach(cid => {
      const a = pos[pid], b = pos[cid];
      if (!a || !b) return;
      if (layout === "vertical") {
        const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2, y2 = b.y;
        const my = (y1 + y2) / 2;
        edges.push({ pid, cid, d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` });
      } else {
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
        const x2 = b.x, y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        edges.push({ pid, cid, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` });
      }
    });
  });

  const isOnPath = (pid, cid) => {
    let cur = activeId;
    while (cur) {
      if (cur === cid && nodes[cur]?.parentId === pid) return true;
      cur = nodes[cur]?.parentId;
    }
    return false;
  };

  return (
    <>
      <div className="mindmap-header">
        <span className="label">
          {I?.Map ? <I.Map size={13}/> : null}
          {Object.keys(nodes).length} {Object.keys(nodes).length === 1 ? "node" : "nodes"}
        </span>
        <div className="zoom">
          <button onClick={() => zoomBy(0.85)} title="Zoom out">{I?.Minus ? <I.Minus size={13}/> : "−"}</button>
          <span className="val">{Math.round(view.scale * 100)}%</span>
          <button onClick={() => zoomBy(1.15)} title="Zoom in">{I?.Plus ? <I.Plus size={13}/> : "+"}</button>
          <button onClick={fitView} title="Fit to view">{I?.Maximize ? <I.Maximize size={13}/> : "fit"}</button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="mindmap-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {edges.map((e, i) => (
            <path key={i} d={e.d} className={`branch ${isOnPath(e.pid, e.cid) ? "active" : ""}`} />
          ))}
          {Object.values(nodes).map(n => {
            const p = pos[n.id];
            if (!p) return null;
            const isActive = n.id === activeId;
            const depth = depthMap[n.id] ?? 0;
            const isRoot = depth === 0;
            const loading = loadingIds.has(n.id);
            const NodeIcon = pickIcon(I, n.kind, isRoot);
            const kicker = isRoot ? "Root" : (n.kind === "ASK" ? "Branch" : n.kind === "DEEPER" ? "Deeper" : "Branch");
            return (
              <g
                key={n.id}
                className={`mm-node ${isActive ? "active" : ""} ${isRoot ? "root" : ""} ${loading ? "loading" : ""}`}
                data-depth={Math.min(depth, 6)}
                transform={`translate(${p.x} ${p.y})`}
                onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(n.id, e.clientX, e.clientY); }}
              >
                <rect className="pill" x="0" y="0" width={NODE_W} height={NODE_H} rx="8" />
                <foreignObject x="0" y="0" width={NODE_W} height={NODE_H} className="mm-fo">
                  <div xmlns="http://www.w3.org/1999/xhtml" className="mm-card">
                    <div className="mm-card-ic">
                      {n.emoji
                        ? <span className="mm-emoji">{n.emoji}</span>
                        : (NodeIcon ? <NodeIcon size={16}/> : null)}
                    </div>
                    <div className="mm-card-text">
                      <div className="mm-kicker">{kicker}</div>
                      <div className="mm-label" title={n.title || "Untitled"}>{n.title || "Untitled"}</div>
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
    </>
  );
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function pickIcon(I, kind, isRoot) {
  if (!I) return null;
  if (isRoot) return I.Hash;
  if (kind === "ASK") return I.Sparkles;
  if (kind === "DEEPER") return I.CornerDownRight;
  return I.GitBranch;
}

window.MindMap = MindMap;
