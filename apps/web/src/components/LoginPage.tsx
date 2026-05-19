'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';

const CFG = {
  density: 0.7,
  jitter: 0.18,
  cellSize: 52,
  speed: 1.3,
  curveRatio: 0.25,
  curveDepth: 0.7,
};

type GNode = { id: number; x: number; y: number; row: number; col: number };
type Edge = { a: number; b: number; cx: number; cy: number };
type Graph = {
  W: number; H: number; COLS: number; ROWS: number;
  nodes: GNode[]; adj: number[][]; centerId: number;
  edgeList: Edge[]; edgeMap: Map<string, Edge>;
  pathActive: boolean; centerAnimId: number | null;
};

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const eKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function buildGraph(): Graph | null {
  const W = window.innerWidth;
  const H = window.innerHeight;
  let COLS = Math.max(9, Math.floor(W / CFG.cellSize));
  if (COLS % 2 === 0) COLS--;
  let ROWS = Math.max(11, Math.floor(H / CFG.cellSize));
  if (ROWS % 2 === 0) ROWS--;

  const padX = W * 0.06, padY = H * 0.08;
  const stepX = (W - padX * 2) / (COLS - 1);
  const stepY = (H - padY * 2) / (ROWS - 1);

  const nodes: GNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const j = CFG.jitter * Math.min(stepX, stepY);
      nodes.push({
        id: r * COLS + c,
        x: padX + c * stepX + (Math.random() * 2 - 1) * j,
        y: padY + r * stepY + (Math.random() * 2 - 1) * j,
        row: r, col: c,
      });
    }
  }

  const centerId = Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2);
  const adj: number[][] = Array.from({ length: nodes.length }, () => []);
  const edgeList: Edge[] = [];
  const edgeMap = new Map<string, Edge>();

  function addEdge(a: number, b: number) {
    if (a === b) return;
    const key = eKey(a, b);
    if (edgeMap.has(key) || adj[a].length >= 3 || adj[b].length >= 3) return;
    adj[a].push(b); adj[b].push(a);
    const na = nodes[a], nb = nodes[b];
    const dx = nb.x - na.x, dy = nb.y - na.y;
    const len = Math.hypot(dx, dy) || 1;
    let cx = (na.x + nb.x) / 2, cy = (na.y + nb.y) / 2;
    if (Math.random() < CFG.curveRatio) {
      const px = -dy / len, py = dx / len;
      const sign = Math.random() < 0.5 ? 1 : -1;
      const mag = (0.14 + Math.random() * 0.32) * CFG.curveDepth * len;
      cx += px * sign * mag; cy += py * sign * mag;
    }
    edgeMap.set(key, { a, b, cx, cy });
    edgeList.push({ a, b, cx, cy });
  }

  const order = shuffle(nodes.map(n => n.id));
  for (const id of order) {
    const node = nodes[id];
    const neighbors = shuffle(
      ([-1, 0, 1] as const).flatMap(dr =>
        ([-1, 0, 1] as const).flatMap(dc => {
          if (dr === 0 && dc === 0) return [];
          const nr = node.row + dr, nc = node.col + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return [];
          return [nr * COLS + nc];
        }),
      ),
    );
    const target = Math.random() < CFG.density ? 3 : 2;
    for (const nid of neighbors) {
      if (adj[id].length >= target) break;
      addEdge(id, nid);
    }
  }

  // Verify center can reach any top-row node
  const seen = new Set([centerId]);
  const q = [centerId];
  let reachable = false;
  while (q.length) {
    const n = q.shift()!;
    if (nodes[n].row === 0) { reachable = true; break; }
    for (const m of adj[n]) if (!seen.has(m)) { seen.add(m); q.push(m); }
  }
  if (!reachable) return buildGraph();

  return { W, H, COLS, ROWS, nodes, adj, centerId, edgeList, edgeMap, pathActive: false, centerAnimId: null };
}

interface LoginPageProps {
  onEnter?: () => void;
}

export function LoginPage({ onEnter }: LoginPageProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gEdgesRef = useRef<SVGGElement>(null);
  const gNodesRef = useRef<SVGGElement>(null);
  const gTraceRef = useRef<SVGGElement>(null);
  const gCenterRef = useRef<SVGGElement>(null);
  const gFXRef = useRef<SVGGElement>(null);
  const triggerRef = useRef<(() => void) | null>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  const [email, setEmail] = useState('');
  const [barHidden, setBarHidden] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [gen, setGen] = useState(0);

  const handleRegen = () => {
    setArrived(false); setBarHidden(false); setUiHidden(false);
    setGen(g => g + 1);
  };

  useEffect(() => {
    const svgEl = svgRef.current;
    const gEdges = gEdgesRef.current;
    const gNodes = gNodesRef.current;
    const gTrace = gTraceRef.current;
    const gCenter = gCenterRef.current;
    const gFX = gFXRef.current;
    if (!svgEl || !gEdges || !gNodes || !gTrace || !gCenter || !gFX) return;

    let graph = buildGraph();
    if (!graph) return;

    function applyGraph(g: Graph) {
      svgEl!.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
      svgEl!.setAttribute('width', String(g.W));
      svgEl!.setAttribute('height', String(g.H));
      for (const el of [gEdges!, gNodes!, gTrace!, gCenter!, gFX!]) el.innerHTML = '';

      for (const e of g.edgeList) {
        const na = g.nodes[e.a], nb = g.nodes[e.b];
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', `M ${na.x} ${na.y} Q ${e.cx} ${e.cy} ${nb.x} ${nb.y}`);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', 'rgba(10,10,10,0.28)');
        p.setAttribute('stroke-width', '1.6');
        p.setAttribute('stroke-linecap', 'round');
        gEdges!.appendChild(p);
      }

      for (const n of g.nodes) {
        if (n.id === g.centerId) continue;
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', String(n.x)); c.setAttribute('cy', String(n.y));
        c.setAttribute('r', '3.2'); c.setAttribute('fill', '#ffffff');
        c.setAttribute('stroke', '#0a0a0a'); c.setAttribute('stroke-width', '1.4');
        c.dataset.node = String(n.id);
        gNodes!.appendChild(c);
      }

      const ctr = g.nodes[g.centerId];

      const outerRing = document.createElementNS(SVG_NS, 'circle');
      outerRing.setAttribute('cx', String(ctr.x)); outerRing.setAttribute('cy', String(ctr.y));
      outerRing.setAttribute('r', '36'); outerRing.setAttribute('fill', 'none');
      outerRing.setAttribute('stroke', 'rgba(10,10,10,0.22)'); outerRing.setAttribute('stroke-width', '1');
      outerRing.setAttribute('stroke-dasharray', '2 5'); outerRing.id = 'lp-cRingOuter';
      gCenter!.appendChild(outerRing);

      const innerRing = document.createElementNS(SVG_NS, 'circle');
      innerRing.setAttribute('cx', String(ctr.x)); innerRing.setAttribute('cy', String(ctr.y));
      innerRing.setAttribute('r', '22'); innerRing.setAttribute('fill', 'none');
      innerRing.setAttribute('stroke', '#0a0a0a'); innerRing.setAttribute('stroke-width', '1.2');
      innerRing.id = 'lp-cRingInner'; gCenter!.appendChild(innerRing);

      const seed = document.createElementNS(SVG_NS, 'circle');
      seed.setAttribute('cx', String(ctr.x)); seed.setAttribute('cy', String(ctr.y));
      seed.setAttribute('r', '7'); seed.setAttribute('fill', '#ffffff');
      seed.setAttribute('stroke', '#0a0a0a'); seed.setAttribute('stroke-width', '1.6');
      seed.id = 'lp-cSeed'; gCenter!.appendChild(seed);

      const seedDot = document.createElementNS(SVG_NS, 'circle');
      seedDot.setAttribute('cx', String(ctr.x)); seedDot.setAttribute('cy', String(ctr.y));
      seedDot.setAttribute('r', '2.4'); seedDot.setAttribute('fill', '#555555');
      seedDot.id = 'lp-cSeedDot'; gCenter!.appendChild(seedDot);

      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('cx', String(ctr.x)); hit.setAttribute('cy', String(ctr.y));
      hit.setAttribute('r', '52'); hit.setAttribute('fill', 'transparent');
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', () => triggerRef.current?.());
      gCenter!.appendChild(hit);
    }

    function startAnim(g: Graph) {
      if (g.centerAnimId) cancelAnimationFrame(g.centerAnimId);
      let t = 0;
      function tick() {
        t += 0.016;
        const p = (Math.sin(t * 1.6) + 1) / 2;
        const outer = document.getElementById('lp-cRingOuter');
        const inner = document.getElementById('lp-cRingInner');
        const dot = document.getElementById('lp-cSeedDot');
        if (outer) { outer.setAttribute('r', String(36 + p * 8)); outer.setAttribute('opacity', String(0.5 - p * 0.32)); }
        if (inner) inner.setAttribute('r', String(22 + p * 1.5));
        if (dot) dot.setAttribute('r', String(2.2 + p * 0.9));
        if (!g.pathActive) g.centerAnimId = requestAnimationFrame(tick);
      }
      g.centerAnimId = requestAnimationFrame(tick);
    }

    function trigger() {
      if (!graph || graph.pathActive) return;

      // Random walk from center to any top-row node
      const pathIds = (() => {
        const visited = new Set([graph.centerId]);
        const path = [graph.centerId];
        while (path.length) {
          const cur = path[path.length - 1];
          if (graph.nodes[cur].row === 0) return path;
          const ns = graph.adj[cur].filter(n => !visited.has(n));
          if (!ns.length) { path.pop(); continue; }
          const next = ns[Math.floor(Math.random() * ns.length)];
          visited.add(next); path.push(next);
        }
        return null;
      })();
      if (!pathIds) return;

      graph.pathActive = true;

      // Build path d-string using shared edge control points
      let d = `M ${graph.nodes[pathIds[0]].x} ${graph.nodes[pathIds[0]].y}`;
      for (let i = 0; i < pathIds.length - 1; i++) {
        const e = graph.edgeMap.get(eKey(pathIds[i], pathIds[i + 1]))!;
        d += ` Q ${e.cx} ${e.cy} ${graph.nodes[pathIds[i + 1]].x} ${graph.nodes[pathIds[i + 1]].y}`;
      }

      const glow = document.createElementNS(SVG_NS, 'path');
      glow.setAttribute('d', d); glow.setAttribute('fill', 'none');
      glow.setAttribute('stroke', '#555555'); glow.setAttribute('stroke-width', '8');
      glow.setAttribute('stroke-linecap', 'round'); glow.setAttribute('stroke-linejoin', 'round');
      glow.setAttribute('opacity', '0.32'); glow.setAttribute('filter', 'url(#lp-bigglow)');
      gTrace!.appendChild(glow);

      const trace = document.createElementNS(SVG_NS, 'path');
      trace.setAttribute('d', d); trace.setAttribute('fill', 'none');
      trace.setAttribute('stroke', '#555555'); trace.setAttribute('stroke-width', '2.6');
      trace.setAttribute('stroke-linecap', 'round'); trace.setAttribute('stroke-linejoin', 'round');
      trace.setAttribute('filter', 'url(#lp-trace-glow)');
      gTrace!.appendChild(trace);

      const total = trace.getTotalLength();
      for (const el of [trace, glow]) {
        el.setAttribute('stroke-dasharray', String(total));
        el.setAttribute('stroke-dashoffset', String(total));
      }

      const sp = trace.getPointAtLength(0);
      const head = document.createElementNS(SVG_NS, 'circle');
      head.setAttribute('cx', String(sp.x)); head.setAttribute('cy', String(sp.y));
      head.setAttribute('r', '6'); head.setAttribute('fill', '#555555');
      head.setAttribute('filter', 'url(#lp-trace-glow)');
      gTrace!.appendChild(head);

      const dur = Math.max(900, Math.min(3800, (total / (540 * CFG.speed)) * 1000));
      trace.style.transition = `stroke-dashoffset ${dur}ms linear`;
      glow.style.transition = `stroke-dashoffset ${dur}ms linear`;
      requestAnimationFrame(() => {
        trace.setAttribute('stroke-dashoffset', '0');
        glow.setAttribute('stroke-dashoffset', '0');
      });

      // Compute cumulative arc lengths to time node lighting
      const cumLens: number[] = [0];
      const probe = document.createElementNS(SVG_NS, 'path');
      let dp = `M ${graph.nodes[pathIds[0]].x} ${graph.nodes[pathIds[0]].y}`;
      probe.setAttribute('d', dp); gTrace!.appendChild(probe);
      for (let i = 0; i < pathIds.length - 1; i++) {
        const e = graph.edgeMap.get(eKey(pathIds[i], pathIds[i + 1]))!;
        dp += ` Q ${e.cx} ${e.cy} ${graph.nodes[pathIds[i + 1]].x} ${graph.nodes[pathIds[i + 1]].y}`;
        probe.setAttribute('d', dp); cumLens.push(probe.getTotalLength());
      }
      probe.remove();

      for (let i = 0; i < pathIds.length; i++) {
        setTimeout(() => {
          const id = pathIds[i];
          if (id === graph!.centerId) {
            document.getElementById('lp-cSeed')?.setAttribute('stroke', '#555555');
            const dot = document.getElementById('lp-cSeedDot');
            if (dot) dot.setAttribute('r', '3.6');
          } else {
            const el = gNodes!.querySelector(`circle[data-node="${id}"]`);
            if (el) {
              el.setAttribute('stroke', '#555555');
              el.setAttribute('stroke-width', '2');
              el.setAttribute('r', '4.2');
            }
          }
        }, (cumLens[i] / total) * dur);
      }

      // Animate head along trace
      const t0 = performance.now();
      function animHead(t: number) {
        const f = Math.min((t - t0) / dur, 1);
        const pt = trace.getPointAtLength(f * total);
        head.setAttribute('cx', String(pt.x)); head.setAttribute('cy', String(pt.y));
        if (f < 1) { requestAnimationFrame(animHead); }
        else { breakthrough(graph!.nodes[pathIds![pathIds!.length - 1]], head); }
      }
      requestAnimationFrame(animHead);
    }

    function breakthrough(end: GNode, head: SVGCircleElement) {
      const { W, H } = graph!;

      const flash = document.createElementNS(SVG_NS, 'circle');
      flash.setAttribute('cx', String(end.x)); flash.setAttribute('cy', String(end.y));
      flash.setAttribute('r', '4'); flash.setAttribute('fill', '#555555');
      flash.setAttribute('opacity', '0.85'); flash.setAttribute('filter', 'url(#lp-bigglow)');
      gFX!.appendChild(flash);
      flash.animate(
        [{ r: '4', opacity: '0.85' }, { r: String(Math.max(W, H) * 0.95), opacity: '0' }] as Keyframe[],
        { duration: 1600, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
      );

      const flash2 = document.createElementNS(SVG_NS, 'circle');
      flash2.setAttribute('cx', String(end.x)); flash2.setAttribute('cy', String(end.y));
      flash2.setAttribute('r', '2'); flash2.setAttribute('fill', '#555555');
      gFX!.appendChild(flash2);
      flash2.animate(
        [{ r: '2', opacity: '1' }, { r: '70', opacity: '0' }] as Keyframe[],
        { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
      );

      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('cx', String(end.x)); ring.setAttribute('cy', String(end.y));
      ring.setAttribute('r', '4'); ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#555555'); ring.setAttribute('stroke-width', '2');
      ring.setAttribute('opacity', '0.8');
      gFX!.appendChild(ring);
      ring.animate(
        [{ r: '4', opacity: '0.8', strokeWidth: '2' }, { r: String(Math.max(W, H) * 0.7), opacity: '0', strokeWidth: '0.2' }] as Keyframe[],
        { duration: 1800, easing: 'cubic-bezier(.18,.7,.2,1)', fill: 'forwards' },
      );

      for (let i = 0; i < 26; i++) {
        const p = document.createElementNS(SVG_NS, 'circle');
        p.setAttribute('cx', String(end.x)); p.setAttribute('cy', String(end.y));
        p.setAttribute('r', String(1.4 + Math.random() * 2.2));
        p.setAttribute('fill', '#555555'); p.setAttribute('filter', 'url(#lp-trace-glow)');
        gFX!.appendChild(p);
        const angle = (Math.PI * 2) * (i / 26) + Math.random() * 0.4;
        const dist = 110 + Math.random() * 260;
        p.animate(
          [
            { cx: String(end.x), cy: String(end.y), opacity: '1' },
            { cx: String(end.x + Math.cos(angle) * dist), cy: String(end.y + Math.sin(angle) * dist), opacity: '0' },
          ] as Keyframe[],
          { duration: 1300 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
        );
      }

      head.animate([{ opacity: '1' }, { opacity: '0' }] as Keyframe[], { duration: 600, fill: 'forwards' });
      setTimeout(() => blowOut(end), 650);
    }

    function blowOut(impact: GNode) {
      setBarHidden(true);
      setUiHidden(true);

      for (const n of graph!.nodes) {
        const dx = n.x - impact.x, dy = n.y - impact.y;
        const d = Math.max(0.5, Math.hypot(dx, dy));
        const force = 280 + Math.random() * 340;
        const tx = (dx / d) * force, ty = (dy / d) * force - 50;
        const els: Element[] = n.id === graph!.centerId
          ? (['lp-cRingOuter', 'lp-cRingInner', 'lp-cSeed', 'lp-cSeedDot'] as const)
              .map(id => document.getElementById(id))
              .filter((el): el is HTMLElement => el !== null)
          : Array.from(gNodes!.querySelectorAll(`circle[data-node="${n.id}"]`));
        els.forEach(el =>
          el.animate(
            [
              { opacity: '1', cx: String(n.x), cy: String(n.y) },
              { opacity: '0', cx: String(n.x + tx), cy: String(n.y + ty) },
            ] as Keyframe[],
            { duration: 1500 + Math.random() * 400, easing: 'cubic-bezier(.32,.0,.4,1)', fill: 'forwards' },
          ),
        );
      }

      gEdges!.querySelectorAll('path').forEach(p =>
        p.animate(
          [{ opacity: '1' }, { opacity: '0' }] as Keyframe[],
          { duration: 800, delay: Math.random() * 350, easing: 'ease-out', fill: 'forwards' },
        ),
      );

      setTimeout(() => {
        gTrace!.animate([{ opacity: '1' }, { opacity: '0' }] as Keyframe[], { duration: 1100, fill: 'forwards' });
        gFX!.animate([{ opacity: '1' }, { opacity: '0' }] as Keyframe[], { duration: 1100, fill: 'forwards' });
      }, 600);

      setTimeout(() => {
        setArrived(true);
        setTimeout(() => { setArrived(false); onEnterRef.current?.(); }, 1500);
      }, 1400);
    }

    applyGraph(graph);
    startAnim(graph);
    triggerRef.current = trigger;

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      if (graph?.pathActive) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        graph = buildGraph();
        if (graph) { applyGraph(graph); startAnim(graph); }
      }, 200);
    };
    window.addEventListener('resize', onResize);

    return () => {
      if (graph?.centerAnimId) cancelAnimationFrame(graph.centerAnimId);
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
    };
  }, [gen]);

  const handleLogin = () => triggerRef.current?.();

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#ffffff', overflow: 'hidden',
      fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
    }}>
      <style>{`
        @keyframes lp-blink { 0%,100%{opacity:.35} 50%{opacity:1} }
        @keyframes lp-rise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* SVG canvas */}
      <svg ref={svgRef} style={{ position: 'fixed', inset: 0, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="lp-trace-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.6" result="b1" />
            <feMerge><feMergeNode in="b1" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="lp-bigglow" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>
        <g ref={gEdgesRef} />
        <g ref={gNodesRef} />
        <g ref={gTraceRef} />
        <g ref={gCenterRef} />
        <g ref={gFXRef} />
      </svg>

      {/* Corner UI labels */}
      {!uiHidden && (
        <>
          <div style={corner('tl')}>
            <div style={uiRow}>FORK · NODE NETWORK</div>
            <div style={uiRow}>v 0.1 · ENTER</div>
          </div>
          <div style={corner('tr')}>
            <div style={{ ...uiRow, textAlign: 'right' }}>// idle</div>
            <div style={{ ...uiRow, textAlign: 'right' }}>seed @ center</div>
          </div>
          <div style={corner('bl')}>
            <div style={uiRow}>degree ≤ 3</div>
          </div>
          <div style={corner('br')}>
            <div style={{ ...uiRow, textAlign: 'right' }}>curves · diagonals</div>
          </div>
          <div style={{
            position: 'fixed', bottom: 38, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 10,
            letterSpacing: '0.22em', textTransform: 'uppercase' as const,
            color: 'rgba(10,10,10,0.55)', pointerEvents: 'none', userSelect: 'none',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#555555', display: 'inline-block',
              boxShadow: '0 0 12px rgba(85,85,85,0.35)', animation: 'lp-blink 1.6s ease-in-out infinite',
            }} />
            <span>tap the seed</span>
          </div>
        </>
      )}

      {/* Login bar */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: barHidden ? 'translate(-50%, calc(-50% - 115px))' : 'translate(-50%, calc(-50% - 100px))',
        display: 'flex', alignItems: 'stretch',
        width: 'min(440px, 86vw)', height: 44,
        background: '#ffffff', border: '1px solid rgba(10,10,10,0.20)',
        borderRadius: 4, overflow: 'hidden', zIndex: 4,
        boxShadow: '0 6px 24px rgba(10,10,10,0.06)',
        transition: 'opacity .55s ease, transform .55s ease',
        opacity: barHidden ? 0 : 1,
        pointerEvents: barHidden ? 'none' : 'auto',
      }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLogin(); } }}
          placeholder="enter email-id to login & signup   | or"
          autoComplete="email"
          style={{
            flex: 3, minWidth: 0, border: 0, outline: 0, background: 'transparent',
            padding: '0 14px', fontFamily: 'inherit', fontSize: 11,
            letterSpacing: '0.04em', color: '#0a0a0a',
          }}
        />
        <button
          onClick={handleLogin}
          type="button"
          aria-label="Login with Google"
          style={{
            flex: 1, border: 0, borderLeft: '1px solid rgba(10,10,10,0.12)',
            background: 'transparent', fontFamily: 'inherit', fontSize: 9,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'rgba(10,10,10,0.78)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 7, padding: '0 8px', whiteSpace: 'nowrap',
          }}
        >
          <svg viewBox="0 0 18 18" style={{ width: 12, height: 12, flexShrink: 0 }} aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          <span>Login with Google</span>
        </button>
      </div>

      {/* Arrived screen */}
      {arrived && (
        <div
          onClick={e => { if (e.currentTarget === e.target) onEnterRef.current?.() ?? handleRegen(); }}
          style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 36,
            background: '#ffffff', zIndex: 5,
          }}
        >
          <img
            src="/logo.svg" alt="Fork"
            style={{ width: 56, height: 56, animation: 'lp-rise 1.4s 0.3s cubic-bezier(.2,.8,.2,1) both' }}
          />
          <div style={{
            fontSize: 10, letterSpacing: '0.45em', textTransform: 'uppercase' as const,
            color: '#0a0a0a', animation: 'lp-rise 1.4s 0.6s cubic-bezier(.2,.8,.2,1) both',
          }}>arrived</div>
          <div style={{
            fontSize: 10, letterSpacing: '0.25em', color: 'rgba(10,10,10,0.28)',
            textTransform: 'uppercase' as const, marginTop: -22,
            animation: 'lp-rise 1.4s 0.85s cubic-bezier(.2,.8,.2,1) both',
          }}>a clean slate</div>
        </div>
      )}
    </div>
  );
}

const uiRow: React.CSSProperties = { lineHeight: 1.8 };

function corner(pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties {
  return {
    position: 'fixed',
    ...(pos[0] === 't' ? { top: 28 } : { bottom: 28 }),
    ...(pos[1] === 'l' ? { left: 32 } : { right: 32 }),
    fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
    color: 'rgba(10,10,10,0.28)', pointerEvents: 'none', userSelect: 'none', zIndex: 3,
  };
}
