'use client';

import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { signIn } from 'next-auth/react';

const SVG_NS = 'http://www.w3.org/2000/svg';

// LoginPage predates the theme system and was hard-coded white; resolve the
// palette from data-theme so dark mode doesn't flash a white page.
function lpPal() {
  const dark = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'dark';
  return dark
    ? { dark, paper: '#111111', ink: '#ededed', soft: '#9a9a9a', faint: (a: number) => `rgba(237,237,237,${a})` }
    : { dark, paper: '#ffffff', ink: '#0a0a0a', soft: '#555555', faint: (a: number) => `rgba(10,10,10,${a})` };
}

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

type Step = 'email' | 'password' | 'signup-password' | 'verify' | 'reset';

// Must match User Pool password policy
const PW_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{8,}$/;

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
  const graphTriggerRef = useRef<(() => void) | null>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('fork.ai.email') ?? '' : '');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [resetAvailable, setResetAvailable] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [gen, setGen] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const resetPwRef = useRef<HTMLInputElement>(null);

  // Focus the primary input when step changes
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [step]);

  // Update center-dot action for the current step
  useEffect(() => {
    switch (step) {
      case 'email':
        triggerRef.current = () => { if (email.trim()) void goToPassword(); };
        break;
      case 'password':
        triggerRef.current = () => void handlePasswordSubmit();
        break;
      case 'signup-password':
        triggerRef.current = () => void handleSignupSubmit();
        break;
      case 'verify':
        triggerRef.current = () => void handleVerifySubmit();
        break;
      case 'reset':
        triggerRef.current = () => void handleResetSubmit();
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, email, password, confirmPw, verifyCode]);

  const handleRegen = () => {
    setArrived(false); setBarHidden(false); setUiHidden(false);
    setStep('email'); setPassword(''); setConfirmPw(''); setVerifyCode(''); setError(null);
    setUserExists(null); setResetAvailable(false);
    setGen(g => g + 1);
  };

  async function goToPassword() {
    if (!email.trim()) return;
    setResetAvailable(false);
    setLoading(true);
    try {
      const res = await fetch('/api/cognito/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { exists?: boolean };
      setUserExists(data.exists ?? null);
    } catch {
      setUserExists(null);
    } finally {
      setLoading(false);
      setStep('password');
    }
  }

  async function handlePasswordSubmit() {
    if (!password.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cognito/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { idToken?: string; refreshToken?: string; expiresIn?: number; error?: string };
      if (data.error === 'UserNotFoundException') {
        setConfirmPw('');
        setStep('signup-password');
      } else if (data.error === 'UserNotConfirmedException') {
        // Account exists but email not yet verified — resend code and go to verify
        await fetch('/api/cognito/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }).catch(() => null);
        setVerifyCode('');
        setStep('verify');
      } else if (data.error === 'NotAuthorizedException') {
        setError('Incorrect password');
        setResetAvailable(true);
      } else if (data.error === 'ChallengeRequired') {
        setError('This account requires a password reset — use Sign Up to create a new account');
      } else if (data.error) {
        setError(data.error);
      } else {
        const result = await signIn('cognito-token', {
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          expiresAt: String(Date.now() + (data.expiresIn ?? 3600) * 1000),
          redirect: false,
        });
        if (result?.error) { setError(result.error); return; }
        localStorage.setItem('fork.ai.email', email);
        graphTriggerRef.current?.();
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignupSubmit() {
    if (!password.trim() || !confirmPw.trim() || loading) return;
    if (!PW_REGEX.test(password)) {
      setError('Min 8 chars · uppercase · lowercase · number · symbol (@$!%*?&_-#)');
      return;
    }
    if (password !== confirmPw) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cognito/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.error) {
        setError(data.error);
      } else {
        setStep('verify');
        setVerifyCode('');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifySubmit() {
    if (!verifyCode.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cognito/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verifyCode, password }),
      });
      const data = (await res.json()) as { idToken?: string; refreshToken?: string; expiresIn?: number; error?: string };
      if (data.error) {
        setError(data.error);
      } else {
        const result = await signIn('cognito-token', {
          idToken: data.idToken,
          refreshToken: data.refreshToken,
          expiresAt: String(Date.now() + (data.expiresIn ?? 3600) * 1000),
          redirect: false,
        });
        if (result?.error) { setError(result.error); return; }
        localStorage.setItem('fork.ai.email', email);
        graphTriggerRef.current?.();
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    try {
      await fetch('/api/cognito/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* silent */ }
  }

  // Forgot Password: sends a reset code, then moves to the combined `reset` step.
  async function handleForgotPassword() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cognito/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (data.error) {
        if (data.error === 'NotAuthorizedException' && /cannot be reset/i.test(data.message ?? '')) {
          setError('This account uses Google sign-in — use the Google button below.');
        } else if (data.error === 'LimitExceededException') {
          setError('Too many attempts. Please try again later.');
        } else {
          setError('Could not send a reset code. Try again.');
        }
        return;
      }
      setPassword(''); setConfirmPw(''); setVerifyCode('');
      setStep('reset');
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendReset() {
    try {
      await fetch('/api/cognito/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    } catch { /* silent */ }
  }

  // Confirms the reset code + new password (one call), then auto-logs-in via the server route.
  async function handleResetSubmit() {
    if (!verifyCode.trim() || !password.trim() || !confirmPw.trim() || loading) return;
    if (!PW_REGEX.test(password)) {
      setError('Min 8 chars · uppercase · lowercase · number · symbol (@$!%*?&_-#)');
      return;
    }
    if (password !== confirmPw) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cognito/confirm-forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verifyCode, password }),
      });
      const data = (await res.json()) as { idToken?: string; refreshToken?: string; expiresIn?: number; error?: string };
      if (data.error) {
        if (data.error === 'CodeMismatchException' || data.error === 'ExpiredCodeException') {
          setError('Invalid or expired code');
        } else if (data.error === 'InvalidPasswordException') {
          setError('Password does not meet requirements');
        } else if (data.error === 'LimitExceededException') {
          setError('Too many attempts. Please try again later.');
        } else {
          setError('Could not reset password. Try again.');
        }
        return;
      }
      const result = await signIn('cognito-token', {
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt: String(Date.now() + (data.expiresIn ?? 3600) * 1000),
        redirect: false,
      });
      if (result?.error) { setError(result.error); return; }
      localStorage.setItem('fork.ai.email', email);
      graphTriggerRef.current?.();
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

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

    const pal = lpPal();

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
        p.setAttribute('stroke', pal.faint(0.28));
        p.setAttribute('stroke-width', '1.6');
        p.setAttribute('stroke-linecap', 'round');
        gEdges!.appendChild(p);
      }

      for (const n of g.nodes) {
        if (n.id === g.centerId) continue;
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('cx', String(n.x)); c.setAttribute('cy', String(n.y));
        c.setAttribute('r', '3.2'); c.setAttribute('fill', pal.paper);
        c.setAttribute('stroke', pal.ink); c.setAttribute('stroke-width', '1.4');
        c.dataset.node = String(n.id);
        gNodes!.appendChild(c);
      }

      const ctr = g.nodes[g.centerId];

      const outerRing = document.createElementNS(SVG_NS, 'circle');
      outerRing.setAttribute('cx', String(ctr.x)); outerRing.setAttribute('cy', String(ctr.y));
      outerRing.setAttribute('r', '36'); outerRing.setAttribute('fill', 'none');
      outerRing.setAttribute('stroke', pal.faint(0.22)); outerRing.setAttribute('stroke-width', '1');
      outerRing.setAttribute('stroke-dasharray', '2 5'); outerRing.id = 'lp-cRingOuter';
      gCenter!.appendChild(outerRing);

      const innerRing = document.createElementNS(SVG_NS, 'circle');
      innerRing.setAttribute('cx', String(ctr.x)); innerRing.setAttribute('cy', String(ctr.y));
      innerRing.setAttribute('r', '22'); innerRing.setAttribute('fill', 'none');
      innerRing.setAttribute('stroke', pal.ink); innerRing.setAttribute('stroke-width', '1.2');
      innerRing.id = 'lp-cRingInner'; gCenter!.appendChild(innerRing);

      const seed = document.createElementNS(SVG_NS, 'circle');
      seed.setAttribute('cx', String(ctr.x)); seed.setAttribute('cy', String(ctr.y));
      seed.setAttribute('r', '7'); seed.setAttribute('fill', pal.paper);
      seed.setAttribute('stroke', pal.ink); seed.setAttribute('stroke-width', '1.6');
      seed.id = 'lp-cSeed'; gCenter!.appendChild(seed);

      const seedDot = document.createElementNS(SVG_NS, 'circle');
      seedDot.setAttribute('cx', String(ctr.x)); seedDot.setAttribute('cy', String(ctr.y));
      seedDot.setAttribute('r', '2.4'); seedDot.setAttribute('fill', pal.soft);
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

      let d = `M ${graph.nodes[pathIds[0]].x} ${graph.nodes[pathIds[0]].y}`;
      for (let i = 0; i < pathIds.length - 1; i++) {
        const e = graph.edgeMap.get(eKey(pathIds[i], pathIds[i + 1]))!;
        d += ` Q ${e.cx} ${e.cy} ${graph.nodes[pathIds[i + 1]].x} ${graph.nodes[pathIds[i + 1]].y}`;
      }

      const glow = document.createElementNS(SVG_NS, 'path');
      glow.setAttribute('d', d); glow.setAttribute('fill', 'none');
      glow.setAttribute('stroke', pal.soft); glow.setAttribute('stroke-width', '8');
      glow.setAttribute('stroke-linecap', 'round'); glow.setAttribute('stroke-linejoin', 'round');
      glow.setAttribute('opacity', '0.32'); glow.setAttribute('filter', 'url(#lp-bigglow)');
      gTrace!.appendChild(glow);

      const trace = document.createElementNS(SVG_NS, 'path');
      trace.setAttribute('d', d); trace.setAttribute('fill', 'none');
      trace.setAttribute('stroke', pal.soft); trace.setAttribute('stroke-width', '2.6');
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
      head.setAttribute('r', '6'); head.setAttribute('fill', pal.soft);
      head.setAttribute('filter', 'url(#lp-trace-glow)');
      gTrace!.appendChild(head);

      const dur = Math.max(900, Math.min(3800, (total / (540 * CFG.speed)) * 1000));
      trace.style.transition = `stroke-dashoffset ${dur}ms linear`;
      glow.style.transition = `stroke-dashoffset ${dur}ms linear`;
      requestAnimationFrame(() => {
        trace.setAttribute('stroke-dashoffset', '0');
        glow.setAttribute('stroke-dashoffset', '0');
      });

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
            document.getElementById('lp-cSeed')?.setAttribute('stroke', pal.soft);
            const dot = document.getElementById('lp-cSeedDot');
            if (dot) dot.setAttribute('r', '3.6');
          } else {
            const el = gNodes!.querySelector(`circle[data-node="${id}"]`);
            if (el) {
              el.setAttribute('stroke', pal.soft);
              el.setAttribute('stroke-width', '2');
              el.setAttribute('r', '4.2');
            }
          }
        }, (cumLens[i] / total) * dur);
      }

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
      flash.setAttribute('r', '4'); flash.setAttribute('fill', pal.soft);
      flash.setAttribute('opacity', '0.85'); flash.setAttribute('filter', 'url(#lp-bigglow)');
      gFX!.appendChild(flash);
      flash.animate(
        [{ r: '4', opacity: '0.85' }, { r: String(Math.max(W, H) * 0.95), opacity: '0' }] as Keyframe[],
        { duration: 1600, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
      );

      const flash2 = document.createElementNS(SVG_NS, 'circle');
      flash2.setAttribute('cx', String(end.x)); flash2.setAttribute('cy', String(end.y));
      flash2.setAttribute('r', '2'); flash2.setAttribute('fill', pal.soft);
      gFX!.appendChild(flash2);
      flash2.animate(
        [{ r: '2', opacity: '1' }, { r: '70', opacity: '0' }] as Keyframe[],
        { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
      );

      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('cx', String(end.x)); ring.setAttribute('cy', String(end.y));
      ring.setAttribute('r', '4'); ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', pal.soft); ring.setAttribute('stroke-width', '2');
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
        p.setAttribute('fill', pal.soft); p.setAttribute('filter', 'url(#lp-trace-glow)');
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
    graphTriggerRef.current = trigger;

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

  // Each step renders N stacked input rows (no submit arrows — Enter / the centre seed dot submit).
  type BarRow = {
    key: string; type: string; value: string; set: (v: string) => void;
    placeholder: string; autoComplete: string;
    ref: React.RefObject<HTMLInputElement | null>; onEnter: () => void;
  };
  const barRows: BarRow[] = (() => {
    switch (step) {
      case 'email':
        return [{ key: 'email', type: 'email', value: email, set: setEmail, placeholder: 'enter email to login or signup', autoComplete: 'email', ref: inputRef, onEnter: () => { if (email.trim()) void goToPassword(); } }];
      case 'password':
        return [{ key: 'password', type: 'password', value: password, set: setPassword, placeholder: 'enter password to login or signup', autoComplete: 'current-password', ref: inputRef, onEnter: () => void handlePasswordSubmit() }];
      case 'signup-password':
        return [
          { key: 'new', type: 'password', value: password, set: setPassword, placeholder: 'new password', autoComplete: 'new-password', ref: inputRef, onEnter: () => confirmRef.current?.focus() },
          { key: 'confirm', type: 'password', value: confirmPw, set: setConfirmPw, placeholder: 'confirm password', autoComplete: 'new-password', ref: confirmRef, onEnter: () => void handleSignupSubmit() },
        ];
      case 'verify':
        return [{ key: 'code', type: 'text', value: verifyCode, set: setVerifyCode, placeholder: 'verification code from email', autoComplete: 'one-time-code', ref: inputRef, onEnter: () => void handleVerifySubmit() }];
      case 'reset':
        return [
          { key: 'rcode', type: 'text', value: verifyCode, set: setVerifyCode, placeholder: 'reset code from email', autoComplete: 'one-time-code', ref: inputRef, onEnter: () => resetPwRef.current?.focus() },
          { key: 'rnew', type: 'password', value: password, set: setPassword, placeholder: 'new password', autoComplete: 'new-password', ref: resetPwRef, onEnter: () => confirmRef.current?.focus() },
          { key: 'rconfirm', type: 'password', value: confirmPw, set: setConfirmPw, placeholder: 'confirm new password', autoComplete: 'new-password', ref: confirmRef, onEnter: () => void handleResetSubmit() },
        ];
    }
  })();
  const barH = 44 + (barRows.length - 1) * 46;
  const pal = lpPal();

  return (
    <div style={{
      position: 'fixed', inset: 0, background: pal.paper, overflow: 'hidden',
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
            color: pal.faint(0.55), pointerEvents: 'none', userSelect: 'none',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: pal.soft, display: 'inline-block',
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
        display: 'flex', flexDirection: 'column',
        width: 'min(440px, 86vw)', height: barH,
        background: pal.paper, border: `1px solid ${pal.faint(0.20)}`,
        borderRadius: 4, overflow: 'hidden', zIndex: 4,
        boxShadow: `0 6px 24px ${pal.faint(0.06)}`,
        transition: 'opacity .55s ease, transform .55s ease, height .2s ease',
        opacity: barHidden ? 0 : 1,
        pointerEvents: barHidden ? 'none' : 'auto',
      }}>
        {/* Gives the browser's password manager a real username token so it
            doesn't fall back to using the password value as the username
            in the Save prompt on signup. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
        />

        {barRows.map((r, i) => (
          <div
            key={r.key}
            style={{
              display: 'flex', alignItems: 'stretch', flex: i === 0 ? '0 0 44px' : '0 0 46px',
              ...(i > 0 ? { borderTop: `1px solid ${pal.faint(0.10)}` } : null),
            }}
          >
            <input
              ref={r.ref}
              className="auth-input"
              type={r.type}
              value={r.value}
              onChange={e => { setError(null); r.set(e.target.value); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); r.onEnter(); } }}
              placeholder={r.placeholder}
              autoComplete={r.autoComplete}
              disabled={loading}
              style={{
                flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent',
                padding: '0 14px', fontFamily: 'inherit', fontSize: 11,
                letterSpacing: '0.04em', color: pal.ink,
              }}
            />
          </div>
        ))}
      </div>

      {/* Step label + error + back + resend */}
      {!barHidden && step !== 'email' && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, calc(-50% + 56px))',
          width: 'min(440px, 86vw)',
          display: 'flex', flexDirection: 'column', gap: 6,
          zIndex: 4,
        }}>
          {/* Step hint */}
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: pal.faint(0.32) }}>
            {step === 'password' && (userExists === false ? `signing up as ${email}` : `signing in as ${email}`)}
            {step === 'signup-password' && `creating account for ${email}`}
            {step === 'verify' && `verify ${email}`}
            {step === 'reset' && `reset password for ${email}`}
          </div>

          {/* Spam-folder hint */}
          {(step === 'verify' || step === 'reset') && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              fontSize: 11.5, letterSpacing: '0.02em', color: pal.faint(0.7), lineHeight: 1.5,
              background: pal.faint(0.045), border: `1px solid ${pal.faint(0.10)}`,
              borderLeft: `2px solid ${pal.faint(0.45)}`,
              borderRadius: 4, padding: '9px 11px',
            }}>
              <span aria-hidden style={{ fontSize: 13, lineHeight: 1.3 }}>✉</span>
              <span>
                We emailed you a code. If it&rsquo;s not in your inbox, <strong style={{ fontWeight: 600, color: pal.ink }}>check your spam folder</strong>.
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: 10, letterSpacing: '0.08em', color: '#c0392b' }}>{error}</div>
          )}

          {/* Actions row */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button
              onClick={() => { setStep('email'); setPassword(''); setConfirmPw(''); setVerifyCode(''); setError(null); setResetAvailable(false); }}
              style={subLinkStyle()}
            >
              ← back
            </button>
            {step === 'verify' && (
              <button onClick={() => void handleResendCode()} style={subLinkStyle()}>
                resend code
              </button>
            )}
            {step === 'reset' && (
              <button onClick={() => void handleResendReset()} style={subLinkStyle()}>
                resend code
              </button>
            )}
            {step === 'password' && resetAvailable && (
              <button onClick={() => void handleForgotPassword()} style={subLinkStyle()}>
                forgot password?
              </button>
            )}
          </div>
        </div>
      )}

      {/* Arrived screen */}
      {arrived && (
        <div
          onClick={e => { if (e.currentTarget === e.target) onEnterRef.current?.() ?? handleRegen(); }}
          style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 36,
            background: pal.paper, zIndex: 5,
          }}
        >
          <img
            // mark-dark-* is the light variant for dark backgrounds (same convention
            // as the dark favicons); the default mark is dark-on-transparent.
            src={pal.dark ? '/mark-dark-72.png' : '/mark-168.png'} alt="Fork"
            style={{ width: 56, height: 56, animation: 'lp-rise 1.4s 0.3s cubic-bezier(.2,.8,.2,1) both' }}
          />
          <div style={{
            fontSize: 10, letterSpacing: '0.45em', textTransform: 'uppercase' as const,
            color: pal.ink, animation: 'lp-rise 1.4s 0.6s cubic-bezier(.2,.8,.2,1) both',
          }}>arrived</div>
          <div style={{
            fontSize: 10, letterSpacing: '0.25em', color: pal.faint(0.28),
            textTransform: 'uppercase' as const, marginTop: -22,
            animation: 'lp-rise 1.4s 0.85s cubic-bezier(.2,.8,.2,1) both',
          }}>a clean slate</div>
        </div>
      )}
    </div>
  );
}

const uiRow: React.CSSProperties = { lineHeight: 1.8 };


const subLinkStyle = (): React.CSSProperties => ({
  background: 'none', border: 0, padding: 0, cursor: 'pointer',
  fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace",
  fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
  color: lpPal().faint(0.38),
});

function corner(pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties {
  return {
    position: 'fixed',
    ...(pos[0] === 't' ? { top: 28 } : { bottom: 28 }),
    ...(pos[1] === 'l' ? { left: 32 } : { right: 32 }),
    fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
    color: lpPal().faint(0.28), pointerEvents: 'none', userSelect: 'none', zIndex: 3,
  };
}
