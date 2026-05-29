'use client';
import { useEffect, useRef } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ACCENT = '#5f5f5f';
const DENSITY = 0.7;
const JITTER = 0.16;
const CELL_SIZE = 56;
const SEPARATION = 0.6;

type NodeData = { id: number; x: number; y: number; row: number; col: number };
type EdgeData = { a: number; b: number; cx: number; cy: number };
type SegEl = { main: SVGPathElement; glow: SVGPathElement };

export function ForkTraceGame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';

    // ── inject keyframe styles ──────────────────────────────────────────
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes ft-blink{0%,100%{opacity:.35}50%{opacity:1}}
      @keyframes ft-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      @keyframes ft-traceShake{0%,100%{transform:translateX(0)}18%{transform:translateX(-4px)}38%{transform:translateX(4px)}58%{transform:translateX(-3px)}78%{transform:translateX(2px)}}
      @keyframes ft-legalPulse{0%,100%{opacity:.16}50%{opacity:.4}}
      .ft-legal-ring{animation:ft-legalPulse 1.5s ease-in-out infinite}
      .ft-shake{animation:ft-traceShake .34s ease}
    `;
    document.head.appendChild(styleEl);

    // ── SVG stage ──────────────────────────────────────────────────────
    const stage = document.createElementNS(SVG_NS, 'svg');
    Object.assign(stage.style, { position: 'absolute', inset: '0', display: 'block', touchAction: 'none', cursor: 'crosshair' });
    container.appendChild(stage);

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="ft-trace-glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1.6" result="b1"/>
        <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="ft-bigglow" x="-300%" y="-300%" width="700%" height="700%">
        <feGaussianBlur stdDeviation="10"/>
      </filter>`;
    stage.appendChild(defs);

    const gEdges = document.createElementNS(SVG_NS, 'g');
    const gHints = document.createElementNS(SVG_NS, 'g');
    const gTrace = document.createElementNS(SVG_NS, 'g');
    const gEnds  = document.createElementNS(SVG_NS, 'g');
    const gHead  = document.createElementNS(SVG_NS, 'g');
    const gFX    = document.createElementNS(SVG_NS, 'g');
    stage.append(gEdges, gHints, gTrace, gEnds, gHead, gFX);

    // ── HUD ──────────────────────────────────────────────────────────────
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;top:16px;right:16px;font-family:var(--mono);font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink-3);text-align:right;pointer-events:none;z-index:3;transition:opacity .4s';
    hud.innerHTML = `<div id="ft-state">// pick the lit start</div><div>moves <span id="ft-moves" style="color:var(--ink)">0</span> · par <span id="ft-par" style="color:var(--ink)">—</span></div>`;
    container.appendChild(hud);

    // ── bottom hint ───────────────────────────────────────────────────
    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--ink-3);pointer-events:none;z-index:3;white-space:nowrap;transition:opacity .4s';
    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;background:${ACCENT};animation:ft-blink 1.6s ease-in-out infinite;flex-shrink:0`;
    hint.appendChild(dot);
    hint.appendChild(Object.assign(document.createElement('span'), { textContent: 'trace from start to target' }));
    container.appendChild(hint);

    // ── toolbar ───────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:none;gap:10px;z-index:4';
    const btnStyle = 'font-family:var(--mono);font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--ink-2);background:var(--bg);border:1px solid var(--line-strong);padding:9px 15px;cursor:pointer;border-radius:3px;transition:color .2s,border-color .2s';
    toolbar.innerHTML = `<button id="ft-undo" style="${btnStyle}" disabled>↶ undo</button><button id="ft-new" style="${btnStyle}">↺ new puzzle</button>`;
    container.appendChild(toolbar);

    // ── win overlay ───────────────────────────────────────────────────
    const winOverlay = document.createElement('div');
    winOverlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;opacity:0;pointer-events:none;z-index:5;background:var(--bg)';
    const winBtnStyle = `font-family:var(--mono);font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:var(--ink-2);background:none;border:1px solid var(--line-strong);padding:11px 20px;cursor:pointer;opacity:0`;
    winOverlay.innerHTML = `
      <div id="ft-win-title" style="font-family:var(--mono);font-size:10px;letter-spacing:0.45em;text-transform:uppercase;color:var(--ink);opacity:0"></div>
      <div id="ft-win-stat" style="font-family:var(--mono);font-size:10px;letter-spacing:0.25em;color:${ACCENT};text-transform:uppercase;margin-top:-16px;opacity:0"></div>
      <button id="ft-win-btn" style="${winBtnStyle}">↺  new puzzle</button>`;
    container.appendChild(winOverlay);

    // ── game state ─────────────────────────────────────────────────────
    let W = 0, H = 0, COLS = 0, ROWS = 0, stepX = 0, stepY = 0;
    let nodes: NodeData[] = [];
    let adj: number[][] = [];
    let edgeList: EdgeData[] = [];
    let edgeMap = new Map<string, EdgeData>();
    let startId = 0, targetId = 0, par = 0;
    let path: number[] = [];
    let segEls: SegEl[] = [];
    let dragging = false;
    let lastHover = -1;
    let won = false;
    let locked = false;
    let solved = 0;
    let streak = 0;
    let endpointAnimHandle: number | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let shakeTimer: ReturnType<typeof setTimeout> | null = null;
    const rafHandles = new Set<number>();

    function raf(fn: FrameRequestCallback) {
      const h = requestAnimationFrame(fn);
      rafHandles.add(h);
      return h;
    }

    function edgeKey(a: number, b: number) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

    function shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // ── graph build ───────────────────────────────────────────────────
    function buildGraph(): boolean {
      const rect = container!.getBoundingClientRect();
      W = rect.width; H = rect.height;
      if (W < 10 || H < 10) return false;

      stage.setAttribute('viewBox', `0 0 ${W} ${H}`);
      stage.setAttribute('width', String(W));
      stage.setAttribute('height', String(H));

      const CELL = Math.max(40, CELL_SIZE);
      COLS = Math.max(7, Math.floor(W / CELL));
      if (COLS % 2 === 0) COLS--;
      ROWS = Math.max(7, Math.floor(H / CELL));
      if (ROWS % 2 === 0) ROWS--;

      const padX = W * 0.07, padY = H * 0.10;
      stepX = (W - padX * 2) / (COLS - 1);
      stepY = (H - padY * 2) / (ROWS - 1);

      nodes = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const id = r * COLS + c;
          const j = JITTER * Math.min(stepX, stepY);
          const x = padX + c * stepX + (Math.random() * 2 - 1) * j;
          const y = padY + r * stepY + (Math.random() * 2 - 1) * j;
          nodes.push({ id, x, y, row: r, col: c });
        }
      }

      adj = Array.from({ length: nodes.length }, () => [] as number[]);
      edgeList = [];
      edgeMap = new Map();

      function addEdge(a: number, b: number): boolean {
        if (a === b) return false;
        const key = edgeKey(a, b);
        if (edgeMap.has(key) || adj[a].length >= 3 || adj[b].length >= 3) return false;
        adj[a].push(b); adj[b].push(a);
        const na = nodes[a], nb = nodes[b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const len = Math.hypot(dx, dy) || 1;
        let cx = (na.x + nb.x) / 2, cy = (na.y + nb.y) / 2;
        if (Math.random() < 0.28) {
          const px = -dy / len, py = dx / len;
          const sign = Math.random() < 0.5 ? 1 : -1;
          const mag = (0.12 + Math.random() * 0.26) * 0.7 * len;
          cx += px * sign * mag; cy += py * sign * mag;
        }
        const edge: EdgeData = { a, b, cx, cy };
        edgeMap.set(key, edge);
        edgeList.push(edge);
        return true;
      }

      const order = nodes.map(n => n.id);
      shuffle(order);
      for (const id of order) {
        const node = nodes[id];
        const neighbors: number[] = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = node.row + dr, nc = node.col + dc;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
            neighbors.push(nr * COLS + nc);
          }
        }
        shuffle(neighbors);
        const targetDeg = Math.random() < DENSITY ? 3 : 2;
        for (const nid of neighbors) {
          if (adj[id].length >= targetDeg) break;
          addEdge(id, nid);
        }
      }
      return true;
    }

    function bfs(src: number): number[] {
      const dist = new Array<number>(nodes.length).fill(-1);
      dist[src] = 0;
      const q = [src];
      while (q.length) {
        const n = q.shift()!;
        for (const m of adj[n]) if (dist[m] === -1) { dist[m] = dist[n] + 1; q.push(m); }
      }
      return dist;
    }

    function choosePuzzle(): boolean {
      let best: { s: number; t: number; par: number } | null = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const s = Math.floor(Math.random() * nodes.length);
        if (adj[s].length < 2) continue;
        const dist = bfs(s);
        let maxD = 0;
        for (const d of dist) if (d > maxD) maxD = d;
        if (maxD < 3) continue;
        const desired = Math.max(3, Math.min(maxD, Math.round(maxD * SEPARATION)));
        let bestT = -1, bestGap = Infinity;
        for (let i = 0; i < dist.length; i++) {
          if (dist[i] < 3) continue;
          const gap = Math.abs(dist[i] - desired);
          if (gap < bestGap || (gap === bestGap && Math.random() < 0.5)) { bestGap = gap; bestT = i; }
        }
        if (bestT === -1) continue;
        const cand = { s, t: bestT, par: dist[bestT] };
        if (!best || cand.par > best.par) best = cand;
        if (best.par >= desired) break;
      }
      if (!best) return false;
      startId = best.s; targetId = best.t; par = best.par;
      return true;
    }

    // ── render ────────────────────────────────────────────────────────
    function mkEl<T extends SVGElement>(parent: Element, tag: string, attrs: Record<string, string | number>): T {
      const el = document.createElementNS(SVG_NS, tag) as T;
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      parent.appendChild(el);
      return el;
    }

    function render() {
      gEdges.innerHTML = ''; gHints.innerHTML = ''; gTrace.innerHTML = '';
      gEnds.innerHTML = ''; gHead.innerHTML = ''; gFX.innerHTML = '';

      for (const e of edgeList) {
        const na = nodes[e.a], nb = nodes[e.b];
        mkEl(gEdges, 'path', { d: `M ${na.x} ${na.y} Q ${e.cx} ${e.cy} ${nb.x} ${nb.y}`, fill: 'none', stroke: 'var(--line-strong)', 'stroke-width': 1.4, 'stroke-linecap': 'round' });
      }

      for (const n of nodes) {
        const c = mkEl<SVGCircleElement>(gEdges, 'circle', { cx: n.x, cy: n.y, r: 3, fill: 'var(--bg)', stroke: 'var(--ink)', 'stroke-width': 1.3, 'stroke-opacity': 0.55 });
        c.dataset.node = String(n.id);
      }

      drawEndpoints();
      drawHead();
      updateHUD();
      startEndpointAnim();
    }

    function nodeEl(id: number) {
      return gEdges.querySelector<SVGCircleElement>(`circle[data-node="${id}"]`);
    }

    function mkRing(parent: Element, x: number, y: number, r: number, id: string | null, dash: string | null) {
      const c = mkEl<SVGCircleElement>(parent, 'circle', { cx: x, cy: y, r, fill: 'none', stroke: ACCENT, 'stroke-width': 1.4 });
      if (dash) c.setAttribute('stroke-dasharray', dash);
      if (id) c.id = id;
      return c;
    }

    function mkLabel(parent: Element, x: number, y: number, txt: string) {
      const t = mkEl(parent, 'text', { x, y, 'text-anchor': 'middle', fill: ACCENT, 'font-family': 'var(--mono)', 'font-size': 8.5, 'letter-spacing': 2.5, opacity: 0.75 });
      t.textContent = txt;
    }

    function drawEndpoints() {
      gEnds.innerHTML = '';
      const s = nodes[startId], t = nodes[targetId];
      // start
      mkRing(gEnds, s.x, s.y, 30, 'ft-sOuter', '2 5');
      mkRing(gEnds, s.x, s.y, 18, 'ft-sInner', null);
      mkEl(gEnds, 'circle', { cx: s.x, cy: s.y, r: 6.5, fill: ACCENT });
      mkLabel(gEnds, s.x, s.y - 40, 'START');
      // target
      mkRing(gEnds, t.x, t.y, 30, 'ft-tOuter', '2 5');
      mkRing(gEnds, t.x, t.y, 18, 'ft-tMid', null);
      mkRing(gEnds, t.x, t.y, 8, null, null);
      const ch1 = mkEl(gEnds, 'line', { x1: t.x - 13, y1: t.y, x2: t.x + 13, y2: t.y, stroke: ACCENT, 'stroke-width': 1, 'stroke-opacity': 0.5 });
      void ch1;
      const ch2 = mkEl(gEnds, 'line', { x1: t.x, y1: t.y - 13, x2: t.x, y2: t.y + 13, stroke: ACCENT, 'stroke-width': 1, 'stroke-opacity': 0.5 });
      void ch2;
      mkLabel(gEnds, t.x, t.y - 40, 'TARGET');
    }

    function drawHead() {
      gHead.innerHTML = '';
      if (!path.length) return;
      const cur = nodes[path[path.length - 1]];
      const h = mkEl<SVGCircleElement>(gHead, 'circle', { cx: cur.x, cy: cur.y, r: 6, fill: ACCENT, filter: 'url(#ft-trace-glow)' });
      h.id = 'ft-headDot';
    }

    function startEndpointAnim() {
      if (endpointAnimHandle !== null) { cancelAnimationFrame(endpointAnimHandle); rafHandles.delete(endpointAnimHandle); }
      let t = 0;
      function tick() {
        t += 0.016;
        const p = (Math.sin(t * 1.7) + 1) / 2;
        const so = document.getElementById('ft-sOuter') as SVGCircleElement | null;
        const to = document.getElementById('ft-tOuter') as SVGCircleElement | null;
        if (so) { so.setAttribute('r', String(30 + p * 7)); so.setAttribute('opacity', String(0.55 - p * 0.32)); }
        if (to) { to.setAttribute('r', String(30 + p * 7)); to.setAttribute('opacity', String(0.55 - p * 0.32)); }
        if (!locked) { endpointAnimHandle = raf(tick); }
      }
      endpointAnimHandle = raf(tick);
    }

    function updateHints() {
      gHints.innerHTML = '';
      if (!path.length || won || locked) return;
      const cur = path[path.length - 1];
      for (const m of adj[cur]) {
        if (path.includes(m) && m !== path[path.length - 2]) continue;
        const n = nodes[m];
        const ring = mkEl<SVGCircleElement>(gHints, 'circle', { cx: n.x, cy: n.y, r: 9, fill: 'none', stroke: ACCENT, 'stroke-width': m === path[path.length - 2] ? 1 : 1.4 });
        if (m === path[path.length - 2]) ring.setAttribute('stroke-dasharray', '1 3');
        ring.className.baseVal = 'ft-legal-ring';
      }
    }

    function setState(s: string) {
      const el = document.getElementById('ft-state');
      if (el) el.textContent = s;
    }

    function updateHUD() {
      const movesEl = document.getElementById('ft-moves');
      const parEl   = document.getElementById('ft-par');
      if (movesEl) movesEl.textContent = String(Math.max(0, path.length - 1));
      if (parEl)   parEl.textContent = par != null ? String(par) : '—';
      const undoBtn = document.getElementById('ft-undo') as HTMLButtonElement | null;
      if (undoBtn) undoBtn.disabled = path.length < 1;
    }

    // ── tracing ───────────────────────────────────────────────────────
    function nodeAt(px: number, py: number): number {
      const thresh = Math.min(stepX, stepY) * 0.58;
      let best = -1, bestD = thresh;
      for (const n of nodes) {
        const d = Math.hypot(n.x - px, n.y - py);
        if (d < bestD) { bestD = d; best = n.id; }
      }
      return best;
    }

    function pointerPos(e: PointerEvent) {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function setNodeLit(id: number, lit: boolean) {
      if (id === startId || id === targetId) return;
      const el = nodeEl(id);
      if (!el) return;
      if (lit) {
        el.setAttribute('stroke', ACCENT); el.setAttribute('stroke-opacity', '1');
        el.setAttribute('stroke-width', '2'); el.setAttribute('r', '4.2');
      } else {
        el.setAttribute('stroke', 'var(--ink)'); el.setAttribute('stroke-opacity', '0.55');
        el.setAttribute('stroke-width', '1.3'); el.setAttribute('r', '3');
      }
    }

    function drawSegment(a: number, b: number) {
      const e = edgeMap.get(edgeKey(a, b))!;
      const na = nodes[a], nb = nodes[b];
      const d = `M ${na.x} ${na.y} Q ${e.cx} ${e.cy} ${nb.x} ${nb.y}`;

      const glow = mkEl<SVGPathElement>(gTrace, 'path', { d, fill: 'none', stroke: ACCENT, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.26, filter: 'url(#ft-bigglow)' });
      const main = mkEl<SVGPathElement>(gTrace, 'path', { d, fill: 'none', stroke: ACCENT, 'stroke-width': 2.6, 'stroke-linecap': 'round', filter: 'url(#ft-trace-glow)' });

      const len = main.getTotalLength();
      for (const el of [main, glow]) {
        el.style.strokeDasharray = String(len);
        el.style.strokeDashoffset = String(len);
        el.style.transition = 'stroke-dashoffset 150ms linear';
      }
      raf(() => { main.style.strokeDashoffset = '0'; glow.style.strokeDashoffset = '0'; });
      segEls.push({ main, glow });
    }

    function illegal(id: number) {
      setState('// not linked');
      gTrace.classList.remove('ft-shake');
      void (gTrace as Element).getBoundingClientRect();
      gTrace.classList.add('ft-shake');
      if (shakeTimer) clearTimeout(shakeTimer);
      shakeTimer = setTimeout(() => {
        gTrace.classList.remove('ft-shake');
        if (!won && !locked) setState(path.length ? '// tracing' : '// pick the lit start');
      }, 360);
      if (id >= 0 && id !== startId && id !== targetId) {
        const el = nodeEl(id);
        if (el) {
          const r0 = parseFloat(el.getAttribute('r') || '3');
          el.setAttribute('stroke', '#e23b3b');
          el.setAttribute('stroke-width', '2.4');
          el.setAttribute('stroke-opacity', '1');
          el.animate([{ r: r0 } as Keyframe, { r: r0 + 2.5 } as Keyframe, { r: r0 } as Keyframe], { duration: 320, easing: 'ease-out' });
          setTimeout(() => {
            const restore = path.includes(id);
            el.setAttribute('stroke', restore ? ACCENT : 'var(--ink)');
            el.setAttribute('stroke-width', '1.3');
            el.setAttribute('stroke-opacity', restore ? '1' : '0.55');
          }, 330);
        }
      }
    }

    function visit(id: number) {
      if (won || locked || id < 0) return;

      if (!path.length) {
        if (id === startId) { path = [startId]; drawHead(); updateHints(); setState('// tracing'); updateHUD(); }
        else illegal(id);
        return;
      }

      const cur = path[path.length - 1];
      if (id === cur) return;

      if (path.length >= 2 && id === path[path.length - 2]) {
        const removed = path.pop()!;
        const seg = segEls.pop();
        if (seg) { seg.main.remove(); seg.glow.remove(); }
        setNodeLit(removed, false);
        drawHead(); updateHints(); updateHUD();
        return;
      }

      if (path.includes(id)) { illegal(id); return; }

      if (adj[cur].includes(id)) {
        path.push(id);
        drawSegment(cur, id);
        setNodeLit(id, true);
        drawHead();
        if (id === targetId) win();
        else { updateHints(); updateHUD(); }
      } else {
        illegal(id);
      }
    }

    // ── win sequence ──────────────────────────────────────────────────
    function win() {
      won = true; locked = true;
      const moves = path.length - 1;
      const perfect = moves === par;
      if (perfect) streak++; else streak = 0;
      solved++;
      setState(perfect ? '// perfect trace' : '// connected');
      updateHUD();
      gHints.innerHTML = '';
      toolbar.style.display = 'none';
      onBreakthrough(nodes[targetId], perfect, moves);
    }

    function onBreakthrough(end: NodeData, perfect: boolean, moves: number) {
      const headEl = document.getElementById('ft-headDot');
      const big = Math.max(W, H);

      const flash = mkEl<SVGCircleElement>(gFX, 'circle', { cx: end.x, cy: end.y, r: 4, fill: ACCENT, opacity: 0.85, filter: 'url(#ft-bigglow)' });
      flash.animate([{ r: 4, opacity: 0.9 } as Keyframe, { r: big * 1.05, opacity: 0 } as Keyframe],
        { duration: 1700, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });

      const ring = mkEl<SVGCircleElement>(gFX, 'circle', { cx: end.x, cy: end.y, r: 4, fill: 'none', stroke: ACCENT, 'stroke-width': 2, opacity: 0.8 });
      ring.animate([{ r: 4, opacity: 0.8 } as Keyframe, { r: big * 0.8, opacity: 0 } as Keyframe],
        { duration: 1800, easing: 'cubic-bezier(.18,.7,.2,1)', fill: 'forwards' });

      const count = perfect ? 40 : 30;
      for (let i = 0; i < count; i++) {
        const p = mkEl<SVGCircleElement>(gFX, 'circle', { cx: end.x, cy: end.y, r: 1.4 + Math.random() * 2.4, fill: ACCENT, filter: 'url(#ft-trace-glow)' });
        const angle = (Math.PI * 2) * (i / count) + Math.random() * 0.4;
        const dist = 120 + Math.random() * 280;
        p.animate([
          { cx: end.x, cy: end.y, opacity: 1 } as Keyframe,
          { cx: end.x + Math.cos(angle) * dist, cy: end.y + Math.sin(angle) * dist, opacity: 0 } as Keyframe,
        ], { duration: 1300 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
      }

      if (headEl) headEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
      setTimeout(() => blowOut(end, perfect, moves), 680);
    }

    function blowOut(impact: NodeData, perfect: boolean, moves: number) {
      setState('// transcending');
      hud.style.opacity = '0';
      hint.style.opacity = '0';

      const circles = [
        ...Array.from(gEdges.querySelectorAll<SVGCircleElement>('circle[data-node]')),
        ...Array.from(gEnds.querySelectorAll<SVGCircleElement>('circle')),
      ];
      for (const el of circles) {
        const cx = parseFloat(el.getAttribute('cx') || '0');
        const cy = parseFloat(el.getAttribute('cy') || '0');
        const dx = cx - impact.x, dy = cy - impact.y;
        let d = Math.hypot(dx, dy); if (d < 0.5) d = 0.5;
        const force = 300 + Math.random() * 360;
        const tx = (dx / d) * force, ty = (dy / d) * force - 50;
        const o0 = parseFloat(el.getAttribute('opacity') || '1');
        el.animate([
          { cx, cy, opacity: o0 } as Keyframe,
          { cx: cx + tx, cy: cy + ty, opacity: 0 } as Keyframe,
        ], { duration: 1500 + Math.random() * 400, easing: 'cubic-bezier(.32,0,.4,1)', fill: 'forwards' });
      }

      Array.from(gEnds.querySelectorAll<SVGElement>('line, text')).forEach(el =>
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' }));
      Array.from(gEdges.querySelectorAll<SVGPathElement>('path')).forEach(p =>
        p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, delay: Math.random() * 350, easing: 'ease-out', fill: 'forwards' }));

      setTimeout(() => {
        gTrace.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1100, fill: 'forwards' });
        gFX.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1100, fill: 'forwards' });
      }, 600);

      setTimeout(() => {
        const titleEl = document.getElementById('ft-win-title');
        const statEl  = document.getElementById('ft-win-stat');
        const btnEl   = document.getElementById('ft-win-btn');
        if (titleEl) { titleEl.textContent = perfect ? 'perfect trace' : 'connected'; titleEl.style.animation = 'ft-rise 1.4s 0.3s cubic-bezier(.2,.8,.2,1) forwards'; }
        if (statEl)  { statEl.textContent = `${moves} moves · par ${par}` + (streak > 1 ? ` · streak ${streak}` : ''); statEl.style.animation = 'ft-rise 1.4s 0.6s cubic-bezier(.2,.8,.2,1) forwards'; }
        if (btnEl)   { btnEl.style.animation = 'ft-rise 1.2s 1.0s ease forwards'; }
        winOverlay.style.opacity = '1';
        winOverlay.style.pointerEvents = 'auto';
      }, 1400);
    }

    // ── new puzzle ────────────────────────────────────────────────────
    function newPuzzle() {
      winOverlay.style.opacity = '0';
      winOverlay.style.pointerEvents = 'none';

      // reset win overlay
      ['ft-win-title', 'ft-win-stat', 'ft-win-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.animation = 'none'; el.style.opacity = '0'; }
      });

      hud.style.opacity = '1';
      hint.style.opacity = '1';
      won = false; locked = false; path = []; segEls = [];
      toolbar.style.display = 'flex';

      let ok = buildGraph() && choosePuzzle();
      for (let g = 0; !ok && g < 10; g++) ok = buildGraph() && choosePuzzle();
      render();
      setState('// pick the lit start');
    }

    // ── pointer events ────────────────────────────────────────────────
    const onDown = (e: PointerEvent) => {
      if (locked) return;
      const { x, y } = pointerPos(e);
      dragging = true; lastHover = -1;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      const id = nodeAt(x, y);
      if (id >= 0) { lastHover = id; visit(id); }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || locked) return;
      const { x, y } = pointerPos(e);
      const id = nodeAt(x, y);
      if (id !== lastHover) { lastHover = id; if (id >= 0) visit(id); }
    };
    const onUp = (e: PointerEvent) => {
      dragging = false; lastHover = -1;
      try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);

    const onKey = (e: KeyboardEvent) => {
      if (locked) return;
      if ((e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') && path.length >= 2) {
        e.preventDefault(); visit(path[path.length - 2]);
      } else if (e.key === 'r' || e.key === 'R') {
        newPuzzle();
      }
    };
    window.addEventListener('keydown', onKey);

    document.getElementById('ft-undo')?.addEventListener('click', () => {
      if (locked) return;
      if (path.length >= 2) visit(path[path.length - 2]);
      else if (path.length === 1) {
        setNodeLit(path[0], false);
        path = []; segEls.forEach(s => { s.main.remove(); s.glow.remove(); }); segEls = [];
        gHints.innerHTML = ''; gHead.innerHTML = ''; updateHUD(); setState('// pick the lit start');
      }
    });
    document.getElementById('ft-new')?.addEventListener('click', () => newPuzzle());
    document.getElementById('ft-win-btn')?.addEventListener('click', () => newPuzzle());

    // ── resize observer ───────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (locked || path.length > 0) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => newPuzzle(), 220);
    });
    ro.observe(container);

    // ── boot ─────────────────────────────────────────────────────────
    toolbar.style.display = 'flex';
    let ok = buildGraph() && choosePuzzle();
    for (let g = 0; !ok && g < 10; g++) ok = buildGraph() && choosePuzzle();
    render();

    return () => {
      for (const h of rafHandles) cancelAnimationFrame(h);
      rafHandles.clear();
      if (shakeTimer) clearTimeout(shakeTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      styleEl.remove();
    };
  }, []);

  return <div ref={containerRef} className="fork-trace-game" />;
}
