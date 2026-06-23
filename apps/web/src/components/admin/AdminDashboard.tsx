'use client';

import { useSession, signOut } from 'next-auth/react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  adminApi,
  isAdminToken,
  pingHealth,
  type AdminMetrics,
  type AdminUser,
  type AdminPayment,
  type AdminUserDetail,
  type AdminAuditEntry,
  type AdminDeployment,
  type HealthStatus,
  type ProviderSpend,
  type DayMetrics,
  type BlogSubmission,
} from '@/lib/api';
import { LineChart, BarChart, Sparkline, PieChart, type PieSlice } from './charts';

type Tab = 'overview' | 'users' | 'payments' | 'audit' | 'submissions' | 'analytics';

const C = { accent: '#6366f1', green: '#22c55e', sky: '#38bdf8', amber: '#f59e0b', pink: '#ec4899', violet: '#8b5cf6' };
const PIE_COLORS = [C.violet, C.sky, C.amber, C.green, C.pink, C.accent, '#14b8a6', '#f97316'];
// Map a {label: count} record to pie slices (sorted desc), cycling the palette.
const toSlices = (counts: Record<string, number>): PieSlice[] =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: PIE_COLORS[i % PIE_COLORS.length] }));

const PROVIDERS: { key: keyof ProviderSpend; label: string; color: string }[] = [
  { key: 'anthropic', label: 'Claude', color: C.amber },
  { key: 'gemini', label: 'Gemini', color: C.sky },
  { key: 'deepseek', label: 'DeepSeek', color: C.green },
  { key: 'glm', label: 'GLM', color: C.violet },
];
const RANGES: { key: string; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: Infinity },
];
// UTC date cutoff (inclusive) for a rolling window of N days; '' means all-time.
const cutoffDate = (days: number): string => {
  if (!isFinite(days)) return '';
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
};

const usd = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const num = (n: number) => (n ?? 0).toLocaleString();
const date = (iso: string) => (iso ? new Date(iso).toLocaleString() : '—');
const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const uptime = (s: number) => {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};

export function AdminDashboard() {
  const { data: authSession, status } = useSession();
  const idToken = authSession?.idToken ?? '';
  const [tab, setTab] = useState<Tab>('overview');

  if (status === 'loading') {
    return <Shell health={null} authed={false}><div className="ad-empty">Loading…</div></Shell>;
  }

  // Not signed in at all — send them to log in.
  if (status === 'unauthenticated' || !idToken) {
    return (
      <Shell health={null} authed={false}>
        <div className="ad-card" style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ margin: 0 }}>Sign in required</h2>
          <p className="ad-muted">You must be signed in as an admin to view this area.</p>
          <a className="ad-link" href="/">Go to sign in →</a>
        </div>
      </Shell>
    );
  }

  // Signed in, but token lacks the `admins` group claim.
  if (!isAdminToken(idToken)) {
    return (
      <Shell health={null} authed>
        <div className="ad-card" style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ margin: 0 }}>Restricted</h2>
          <p className="ad-muted">This account isn’t an admin. Sign in with an admin account.</p>
          <button className="ad-btn" onClick={() => signOut({ callbackUrl: '/' })}>Sign out</button>
        </div>
      </Shell>
    );
  }

  return (
    <ShellLive idToken={idToken} tab={tab} setTab={setTab}>
      {tab === 'overview' && <Overview idToken={idToken} />}
      {tab === 'users' && <Users idToken={idToken} />}
      {tab === 'payments' && <Payments idToken={idToken} />}
      {tab === 'audit' && <Audit idToken={idToken} />}
      {tab === 'submissions' && <Submissions idToken={idToken} />}
      {tab === 'analytics' && <Analytics />}
    </ShellLive>
  );
}

// ── PostHog product analytics (shared-dashboard embed) ────────────────────────

function Analytics() {
  const url = process.env.NEXT_PUBLIC_POSTHOG_DASHBOARD_URL;
  if (!url) {
    return (
      <div className="ad-card" style={{ padding: 32 }}>
        <p className="ad-muted">
          Product analytics isn&apos;t wired up yet. In PostHog open the dashboard →
          Share → enable public sharing, then set <code>NEXT_PUBLIC_POSTHOG_DASHBOARD_URL</code> to
          the embed URL and rebuild.
        </p>
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title="PostHog analytics"
      allowFullScreen
      style={{ width: '100%', height: 'calc(100vh - 190px)', border: 0, borderRadius: 12, background: '#fff' }}
    />
  );
}

// ── Shell with live health pill ───────────────────────────────────────────────

function ShellLive({ idToken, tab, setTab, children }: { idToken: string; tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => pingHealth().then((h) => { if (alive) setHealth(h); });
    tick();
    const id = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const email = tokenEmail(idToken);

  return (
    <Shell health={health} authed email={email}>
      <nav className="ad-tabs">
        {(['overview', 'users', 'payments', 'audit', 'submissions', 'analytics'] as Tab[]).map((t) => (
          <button key={t} className={`ad-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {children}
    </Shell>
  );
}

function Shell({ health, authed, email, children }: { health: HealthStatus | null; authed: boolean; email?: string; children: React.ReactNode }) {
  return (
    <div className="ad-root">
      <style>{STYLE}</style>
      <header className="ad-header">
        <div className="ad-brand">
          <span className="ad-logo">◆</span>
          <span>fork ai <b>admin</b></span>
        </div>
        <div className="ad-headright">
          <StatusPill health={health} />
          {email && <span className="ad-muted ad-whoami">{email}</span>}
          <a className="ad-link" href="/">app ↗</a>
          {authed && <button className="ad-btn ad-btn-logout" onClick={() => signOut({ callbackUrl: '/' })}>Log out</button>}
        </div>
      </header>
      <main className="ad-main">{children}</main>
    </div>
  );
}

function StatusPill({ health }: { health: HealthStatus | null }) {
  const ok = health?.ok;
  const cls = health == null ? 'pending' : ok ? 'up' : 'down';
  const label = health == null ? 'checking…' : ok ? 'API online' : (health.status || 'offline');
  return (
    <div className={`ad-pill ${cls}`} title={health?.commit ? `commit ${health.commit}` : ''}>
      <span className="ad-dot" />
      <span>{label}</span>
      {health?.ok && <span className="ad-pill-meta">{health.latencyMs}ms</span>}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ idToken }: { idToken: string }) {
  const [m, setM] = useState<AdminMetrics | null>(null);
  const [cfg, setCfg] = useState<{ signupCreditUsd: number; referralCreditUsd: number; creditMultiplier: number } | null>(null);
  const [rangeKey, setRangeKey] = useState('today');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [day, setDay] = useState<string | null>(null);

  const load = useCallback((fresh = false) => {
    if (fresh) setBusy(true);
    return adminApi.getMetrics(idToken, fresh)
      .then(setM)
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, [idToken]);

  useEffect(() => {
    load();
    adminApi.getConfig(idToken).then(setCfg).catch(() => {});
  }, [idToken, load]);

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!m) return <div className="ad-empty">Loading metrics…</div>;

  const s = m.series;
  const labels = s.map((d) => d.date);

  // Spend within the selected window — total + per-provider, derived from the daily series.
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  const from = cutoffDate(range.days);
  const win = s.filter((d) => d.date >= from);
  const winTotal = win.reduce((a, d) => a + d.llmSpendUsd, 0);
  const winProviders = PROVIDERS.map((p) => ({
    ...p,
    cost: win.reduce((a, d) => a + (d.spendByProvider?.[p.key] ?? 0), 0),
  }));
  const cards = [
    { label: 'Users', value: num(m.userCount), spark: s.map((d) => d.users), color: C.sky },
    { label: 'Sessions', value: num(m.sessionCount), spark: s.map((d) => d.sessions), color: C.accent },
    { label: 'Nodes', value: num(m.nodeCount), spark: s.map((d) => d.nodes), color: C.violet },
    { label: 'Revenue', value: usd(m.revenueUsd), spark: s.map((d) => d.revenueUsd), color: C.green },
    { label: 'LLM spend', value: usd(m.llmSpendUsd), spark: s.map((d) => d.llmSpendUsd), color: C.amber },
    { label: 'Outstanding credit', value: usd(m.outstandingCreditUsd), spark: [], color: C.pink },
  ];

  return (
    <div className="ad-grid-main">
      <div className="ad-stats">
        {cards.map((c) => (
          <div key={c.label} className="ad-card ad-stat">
            <div className="ad-stat-label">{c.label}</div>
            <div className="ad-stat-value">{c.value}</div>
            {c.spark.length > 1 && <div className="ad-stat-spark"><Sparkline points={c.spark} color={c.color} width={120} height={30} /></div>}
          </div>
        ))}
      </div>

      <div className="ad-card">
        <div className="ad-card-head">
          <h3>LLM spend</h3>
          <div className="ad-spend-controls">
            <button className="ad-refresh" onClick={() => load(true)} disabled={busy} title="Refresh — bypasses the 60s cache">
              <span className={busy ? 'ad-spin' : ''}>↻</span> Refresh
            </button>
            <div className="ad-seg">
              {RANGES.map((r) => (
                <button key={r.key} className={`ad-seg-btn ${r.key === rangeKey ? 'on' : ''}`} onClick={() => setRangeKey(r.key)}>{r.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="ad-spend-total">{usd(winTotal)}</div>
        <div className="ad-spend-body">
          <PieChart slices={winProviders.map((p) => ({ label: p.label, value: p.cost, color: p.color }))} fmt={usd} />
          <div className="ad-prov-list">
            {winProviders.map((p) => {
              const pct = winTotal > 0 ? (p.cost / winTotal) * 100 : 0;
              return (
                <div key={p.key} className="ad-prov-row">
                  <span className="ad-prov-name"><span className="ad-legend-dot" style={{ background: p.color }} />{p.label}</span>
                  <span className="ad-prov-track"><span className="ad-prov-fill" style={{ width: `${pct}%`, background: p.color }} /></span>
                  <span className="ad-prov-cost">{usd(p.cost)}<span className="ad-prov-pct">{pct.toFixed(0)}%</span></span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ad-card">
        <div className="ad-card-head">
          <h3>Activity over time</h3>
          <Legend items={[{ label: 'Sessions', color: C.accent }, { label: 'New users', color: C.sky }]} />
        </div>
        {s.length ? (
          <LineChart
            labels={labels}
            series={[
              { label: 'Sessions', color: C.accent, points: s.map((d) => d.sessions) },
              { label: 'Users', color: C.sky, points: s.map((d) => d.users) },
            ]}
          />
        ) : <div className="ad-empty">No data yet</div>}
      </div>

      <div className="ad-two">
        <div className="ad-card">
          <div className="ad-card-head"><h3>Nodes created / day</h3></div>
          {s.length ? <BarChart labels={labels} points={s.map((d) => d.nodes)} color={C.violet} onBarClick={(i) => setDay(s[i].date)} /> : <div className="ad-empty">No data</div>}
        </div>
        <div className="ad-card">
          <div className="ad-card-head"><h3>LLM spend / day</h3></div>
          {s.length ? <BarChart labels={labels} points={s.map((d) => d.llmSpendUsd)} color={C.amber} fmt={(n) => `$${n.toFixed(1)}`} onBarClick={(i) => setDay(s[i].date)} /> : <div className="ad-empty">No data</div>}
        </div>
      </div>

      {day && <DayDetail idToken={idToken} date={day} onClose={() => setDay(null)} />}

      {cfg && (
        <div className="ad-card">
          <div className="ad-card-head"><h3>Billing config</h3></div>
          <table className="ad-table">
            <tbody>
              <tr><td>Signup credit</td><td>{usd(cfg.signupCreditUsd)}</td></tr>
              <tr><td>Referral credit</td><td>{usd(cfg.referralCreditUsd)}</td></tr>
              <tr><td>Credit multiplier</td><td>{cfg.creditMultiplier}×</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <DeploymentPanel idToken={idToken} />
    </div>
  );
}

// ── Day drill-down ─────────────────────────────────────────────────────────────

// Reached by clicking a bar on the Nodes/day or LLM-spend/day histograms — shows
// who drove that day's usage and what they asked. Both histograms open this same drawer.
function DayDetail({ idToken, date: day, onClose }: { idToken: string; date: string; onClose: () => void }) {
  const [data, setData] = useState<DayMetrics | null>(null);
  const [err, setErr] = useState('');
  const [userSub, setUserSub] = useState<string | null>(null);

  useEffect(() => { adminApi.getDayMetrics(idToken, day).then(setData).catch((e) => setErr(String(e))); }, [idToken, day]);

  return (
    <>
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ad-card-head">
          <h3>{shortDate(day)}</h3>
          <button className="ad-link" onClick={onClose}>✕</button>
        </div>
        {err && <div className="ad-err">{err}</div>}
        {!data ? <div className="ad-empty">Loading…</div> : (
          <>
            <p className="ad-muted">
              {num(data.totals.eventCount)} LLM calls · spent {usd(data.totals.costUsd)} · {num(data.totals.inputTokens)} / {num(data.totals.outputTokens)} tokens (in/out)
            </p>

            <section className="ad-section">
              <h4>By type</h4>
              <PieChart slices={toSlices(data.totals.byKind)} />
            </section>

            <section className="ad-section">
              <h4>By model</h4>
              <PieChart slices={toSlices(data.totals.byModel)} />
            </section>

            <section className="ad-section">
              <h4>Users <span className="ad-count">{data.users.length}</span></h4>
              {data.users.length ? (
                <table className="ad-table ad-subtable">
                  <thead><tr><th>Email</th><th>Calls</th><th>Tokens (in/out)</th><th>Cost</th></tr></thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.sub} onClick={() => setUserSub(u.sub)} title="Open user">
                        <td>{u.email || u.sub.slice(0, 12) + '…'}</td>
                        <td className="ad-mono">{num(u.eventCount)}</td>
                        <td className="ad-mono">{num(u.inputTokens)} / {num(u.outputTokens)}</td>
                        <td>{usd(u.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="ad-muted">No usage this day.</p>}
            </section>

            <section className="ad-section">
              <h4>Queries <span className="ad-count">{data.topics.length}</span></h4>
              {data.topics.length ? data.topics.map((t, i) => (
                <div key={i} className="ad-listrow">
                  <span className="ad-listrow-main"><span className="ad-tag">{t.kind}</span> {t.query || t.title || '(untitled)'}</span>
                  <span className="ad-muted ad-listrow-meta">{t.model} · {t.email || t.sub.slice(0, 8) + '…'}</span>
                </div>
              )) : <p className="ad-muted">No queries this day.</p>}
            </section>
          </>
        )}
      </div>
    </div>
    {userSub && <UserDetail idToken={idToken} sub={userSub} onClose={() => setUserSub(null)} onChanged={() => {}} />}
    </>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="ad-legend">
      {items.map((i) => (
        <span key={i.label}><span className="ad-legend-dot" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

// ── Deployment panel ──────────────────────────────────────────────────────────

function DeploymentPanel({ idToken }: { idToken: string }) {
  const [dep, setDep] = useState<AdminDeployment | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    adminApi.getDeployment(idToken).then(setDep).catch((e) => setErr(String(e)));
    const tick = () => pingHealth().then(setHealth);
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [idToken]);

  return (
    <div className="ad-card">
      <div className="ad-card-head">
        <h3>Deployment</h3>
        <span className={`ad-pill ${health == null ? 'pending' : health.ok ? 'up' : 'down'}`}>
          <span className="ad-dot" />{health == null ? 'checking' : health.ok ? 'live' : 'down'}
        </span>
      </div>
      {err && <div className="ad-err">{err}</div>}
      <div className="ad-dep-grid">
        <Field label="Version" value={dep?.version ?? '…'} />
        <Field label="Commit" value={dep ? short(dep.commit) : '…'} mono />
        <Field label="Environment" value={dep?.env ?? '…'} />
        <Field label="Region" value={dep?.region ?? '…'} />
        <Field label="Uptime" value={dep ? uptime(dep.uptimeSec) : '…'} />
        <Field label="Started" value={dep ? date(dep.startedAt) : '…'} />
        <Field label="Health latency" value={health?.ok ? `${health.latencyMs} ms` : '—'} />
        <Field label="Live commit" value={health?.commit ? short(health.commit) : '—'} mono />
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="ad-field">
      <div className="ad-field-label">{label}</div>
      <div className="ad-field-value" style={mono ? { fontFamily: 'var(--mono, monospace)' } : undefined}>{value}</div>
    </div>
  );
}
const short = (c: string) => (c && c.length > 10 && c !== 'dev' ? c.slice(0, 7) : c);

function tokenEmail(idToken: string): string {
  try {
    const p = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (p.email as string) ?? '';
  } catch {
    return '';
  }
}

// ── Users ──────────────────────────────────────────────────────────────────

function Users({ idToken }: { idToken: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    adminApi.listUsers(idToken).then((p) => setUsers(p.items)).catch((e) => setErr(String(e)));
  }, [idToken]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!users) return <div className="ad-empty">Loading users…</div>;

  return (
    <div className="ad-card ad-tablecard">
      <div className="ad-card-head"><h3>Users <span className="ad-count">{users.length}</span></h3></div>
      <table className="ad-table">
        <thead><tr><th>Email</th><th>Credit</th><th>Location</th><th>Joined</th></tr></thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.sub || u.email || i} onClick={() => u.sub && setSelected(u.sub)}>
              <td>{u.email}</td>
              <td>{usd(u.creditUsd ?? 0)}</td>
              <td>{[u.signupCity, u.signupCountry].filter(Boolean).join(', ') || '—'}</td>
              <td>{date(u.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && <UserDetail idToken={idToken} sub={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function UserDetail({ idToken, sub, onClose, onChanged }: { idToken: string; sub: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reload = useCallback(() => { adminApi.getUser(idToken, sub).then(setDetail).catch((e) => setErr(String(e))); }, [idToken, sub]);
  useEffect(() => { reload(); }, [reload]);

  const submitCredit = async () => {
    const n = parseFloat(amount);
    if (Number.isNaN(n)) return;
    setBusy(true);
    try { await adminApi.adjustCredit(idToken, sub, n, mode); setAmount(''); reload(); onChanged(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const removeSession = async (sessionId: string) => {
    if (!confirm('Delete this session and all its content? This cannot be undone.')) return;
    setBusy(true);
    try { await adminApi.deleteSession(idToken, sub, sessionId); reload(); onChanged(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="ad-overlay" onClick={onClose}>
      <div className="ad-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="ad-card-head">
          <h3>{detail?.user.email ?? sub}</h3>
          <button className="ad-link" onClick={onClose}>✕</button>
        </div>
        {err && <div className="ad-err">{err}</div>}
        {!detail ? <div className="ad-empty">Loading…</div> : (
          <>
            <p className="ad-muted">Credit {usd(detail.user.creditUsd ?? 0)} · joined {date(detail.user.createdAt)}</p>

            <section className="ad-section">
              <h4>Adjust credit</h4>
              <div className="ad-row-controls">
                <select value={mode} onChange={(e) => setMode(e.target.value as 'add' | 'set')} className="ad-input">
                  <option value="add">Add (delta)</option>
                  <option value="set">Set (absolute)</option>
                </select>
                <input className="ad-input" style={{ width: 120 }} type="number" step="0.01" placeholder="USD" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <button className="ad-btn ad-btn-primary" disabled={busy} onClick={submitCredit}>Apply</button>
              </div>
            </section>

            <section className="ad-section">
              <h4>Sessions <span className="ad-count">{detail.sessions.length}</span></h4>
              {detail.sessions.map((s) => (
                <div key={s.sessionId} className="ad-listrow">
                  <span>{s.emoji} {s.title || '(untitled)'}</span>
                  <button className="ad-btn ad-btn-danger" disabled={busy} onClick={() => removeSession(s.sessionId)}>Delete</button>
                </div>
              ))}
              {!detail.sessions.length && <p className="ad-muted">No sessions.</p>}
            </section>

            <section className="ad-section">
              <h4>
                Usage <span className="ad-count">{detail.usage.length}</span>
                <span className="ad-usage-total">spent {usd(detail.usage.reduce((s, e) => s + (e.costUsd ?? 0), 0))}</span>
              </h4>
              {detail.usage.length ? (
                <table className="ad-table ad-subtable">
                  <thead><tr><th>Type</th><th>Tokens (in/out)</th><th>Cost</th><th>When</th></tr></thead>
                  <tbody>
                    {detail.usage.map((e) => (
                      <tr key={e.usageId}>
                        <td><span className="ad-tag">{e.kind ?? '—'}</span></td>
                        <td className="ad-mono">{num(e.inputTokens ?? 0)} / {num(e.outputTokens ?? 0)}</td>
                        <td>{usd(e.costUsd)}</td>
                        <td className="ad-muted">{date(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="ad-muted">No usage yet.</p>}
            </section>

            <section className="ad-section">
              <h4>Payments <span className="ad-count">{detail.payments.length}</span></h4>
              {detail.payments.map((p) => (
                <div key={p.paymentId} className="ad-listrow"><span>{usd(p.amountUsd)}</span><span className="ad-muted">{date(p.createdAt)}</span></div>
              ))}
              {!detail.payments.length && <p className="ad-muted">No payments.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────────

function Payments({ idToken }: { idToken: string }) {
  const [items, setItems] = useState<AdminPayment[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminApi.listPayments(idToken).then((p) => setItems(p.items)).catch((e) => setErr(String(e))); }, [idToken]);

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!items) return <div className="ad-empty">Loading payments…</div>;

  return (
    <div className="ad-card ad-tablecard">
      <div className="ad-card-head"><h3>Payments <span className="ad-count">{items.length}</span></h3></div>
      {items.length === 0 ? (
        <div className="ad-empty">No payments recorded yet — no one has topped up via Razorpay.</div>
      ) : (
        <table className="ad-table">
          <thead><tr><th>Amount</th><th>INR</th><th>User</th><th>Payment ID</th><th>Date</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.paymentId}>
                <td>{usd(p.amountUsd)}</td>
                <td>₹{(p.amountInr / 100).toFixed(2)}</td>
                <td className="ad-mono">{p.sub.slice(0, 12)}…</td>
                <td className="ad-mono">{p.paymentId}</td>
                <td>{date(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Audit ─────────────────────────────────────────────────────────────────────

function Submissions({ idToken }: { idToken: string }) {
  const [subs, setSubs] = useState<BlogSubmission[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { adminApi.listBlogSubmissions(idToken).then(setSubs).catch((e) => setErr(String(e))); }, [idToken]);

  const act = (id: string, status: 'approved' | 'rejected') => {
    adminApi.updateBlogSubmissionStatus(idToken, id, status)
      .then(() => setSubs((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, status } : x)) : prev)))
      .catch((e) => setErr(String(e)));
  };

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!subs) return <div className="ad-empty">Loading…</div>;

  return (
    <div className="ad-card ad-tablecard">
      <div className="ad-card-head"><h3>Blog submissions <span className="ad-count">{subs.length}</span></h3></div>
      {subs.length === 0 ? (
        <div className="ad-empty">No submissions yet.</div>
      ) : (
        <table className="ad-table">
          <thead><tr><th></th><th>Title</th><th>Author</th><th>Status</th><th>When</th><th></th></tr></thead>
          <tbody>
            {subs.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td style={{ fontSize: 18 }}>{s.emoji}</td>
                  <td>{s.title}</td>
                  <td>{s.authorEmail}</td>
                  <td><span className="ad-tag">{s.status}</span></td>
                  <td>{date(s.createdAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      {s.status !== 'approved' && <button className="ad-link" style={{ color: '#15803d' }} onClick={() => act(s.id, 'approved')}>Approve</button>}
                      {s.status !== 'rejected' && <button className="ad-link" style={{ color: '#c0392b' }} onClick={() => act(s.id, 'rejected')}>Reject</button>}
                      <button className="ad-link" onClick={() => setOpenId(openId === s.id ? null : s.id)}>{openId === s.id ? 'Hide' : 'Read'}</button>
                    </div>
                  </td>
                </tr>
                {openId === s.id && (
                  <tr>
                    <td colSpan={6}>
                      <div style={{ padding: '10px 6px', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, maxWidth: 760 }}>
                        {s.summary && <p style={{ fontStyle: 'italic', opacity: 0.75, margin: '0 0 12px' }}>{s.summary}</p>}
                        {s.body}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Audit({ idToken }: { idToken: string }) {
  const [entries, setEntries] = useState<AdminAuditEntry[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminApi.listAudit(idToken).then(setEntries).catch((e) => setErr(String(e))); }, [idToken]);

  if (err) return <div className="ad-card ad-err">{err}</div>;
  if (!entries) return <div className="ad-empty">Loading…</div>;

  return (
    <div className="ad-card ad-tablecard">
      <div className="ad-card-head"><h3>Audit log <span className="ad-count">{entries.length}</span></h3></div>
      {entries.length === 0 ? (
        <div className="ad-empty">No admin actions recorded yet.</div>
      ) : (
        <table className="ad-table">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.auditId}>
                <td>{date(e.createdAt)}</td>
                <td>{e.actorEmail}</td>
                <td><span className="ad-tag">{e.action}</span></td>
                <td className="ad-mono">{e.targetSub.slice(0, 12)}…</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const STYLE = `
.ad-root {
  --admin-bg: #0b0d12; --admin-card: #14171f; --admin-border: #232733;
  --admin-text: #e7e9ee; --admin-muted: #8b93a7; --admin-grid: #1e2230; --admin-accent: ${C.accent};
  /* Own scroll container: the app sets a global body{overflow:hidden} for the workspace,
     so the admin page must scroll itself rather than relying on the (locked) page scroll. */
  height: 100vh; overflow-y: auto; background:
    radial-gradient(1200px 500px at 80% -10%, rgba(99,102,241,0.12), transparent),
    radial-gradient(900px 500px at -10% 10%, rgba(139,92,246,0.10), transparent),
    var(--admin-bg);
  color: var(--admin-text); font-family: var(--sans, system-ui, sans-serif);
}
.ad-header { position: sticky; top: 0; z-index: 10; display: flex; justify-content: space-between; align-items: center;
  padding: 14px 24px; backdrop-filter: blur(12px); background: rgba(11,13,18,0.7); border-bottom: 1px solid var(--admin-border); }
.ad-brand { display: flex; align-items: center; gap: 10px; font-size: 16px; letter-spacing: 0.2px; }
.ad-brand b { font-weight: 700; }
.ad-logo { color: var(--admin-accent); font-size: 18px; }
.ad-headright { display: flex; align-items: center; gap: 16px; }
.ad-main { max-width: 1100px; margin: 0 auto; padding: 24px; }
.ad-tabs { display: flex; gap: 6px; margin-bottom: 22px; }
.ad-tab { padding: 8px 16px; border-radius: 9px; border: 1px solid transparent; background: transparent; color: var(--admin-muted);
  cursor: pointer; font-size: 14px; font-weight: 500; transition: all .15s; }
.ad-tab:hover { color: var(--admin-text); background: rgba(255,255,255,0.04); }
.ad-tab.on { color: #fff; background: linear-gradient(135deg, ${C.accent}, ${C.violet}); border-color: transparent; }
.ad-card { background: var(--admin-card); border: 1px solid var(--admin-border); border-radius: 14px; padding: 18px;
  box-shadow: 0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.25); }
.ad-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.ad-card-head h3 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.2px; }
.ad-card-head h4, .ad-section h4 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--admin-muted); }
.ad-count { color: var(--admin-muted); font-weight: 500; margin-left: 6px; }
.ad-grid-main { display: flex; flex-direction: column; gap: 18px; }
.ad-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
.ad-stat { display: flex; flex-direction: column; gap: 4px; }
.ad-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--admin-muted); }
.ad-stat-value { font-size: 26px; font-weight: 700; }
.ad-stat-spark { margin-top: 6px; opacity: 0.9; }
.ad-two { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 760px) { .ad-two { grid-template-columns: 1fr; } }
.ad-legend { display: flex; gap: 14px; font-size: 12px; color: var(--admin-muted); }
.ad-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ad-legend-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.ad-dep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.ad-field-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--admin-muted); margin-bottom: 3px; }
.ad-field-value { font-size: 14px; font-weight: 600; }
.ad-tablecard { padding: 0; overflow: hidden; }
.ad-tablecard .ad-card-head { padding: 16px 18px 0; }
.ad-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.ad-table th { text-align: left; padding: 10px 18px; color: var(--admin-muted); font-weight: 500; font-size: 12px;
  text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid var(--admin-border); }
.ad-table td { padding: 11px 18px; border-bottom: 1px solid var(--admin-grid); }
.ad-table tbody tr { cursor: pointer; transition: background .12s; }
.ad-table tbody tr:hover { background: rgba(99,102,241,0.07); }
.ad-mono { font-family: var(--mono, monospace); font-size: 12px; color: var(--admin-muted); }
.ad-tag { background: rgba(99,102,241,0.16); color: #c7d2fe; padding: 2px 8px; border-radius: 6px; font-size: 12px; }
.ad-muted { color: var(--admin-muted); font-size: 13px; }
.ad-link { color: var(--admin-accent); text-decoration: none; font-size: 14px; background: none; border: none; cursor: pointer; }
.ad-link:hover { text-decoration: underline; }
.ad-empty { color: var(--admin-muted); padding: 40px; text-align: center; font-size: 14px; }
.ad-err { color: #fca5a5; background: rgba(239,68,68,0.1); padding: 12px 16px; border-radius: 8px; font-size: 13px; }
.ad-pill { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 600;
  border: 1px solid var(--admin-border); }
.ad-pill .ad-dot { width: 8px; height: 8px; border-radius: 50%; }
.ad-pill.up { color: #86efac; background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.3); }
.ad-pill.up .ad-dot { background: ${C.green}; box-shadow: 0 0 0 0 rgba(34,197,94,0.6); animation: ad-pulse 1.8s infinite; }
.ad-pill.down { color: #fca5a5; background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); }
.ad-pill.down .ad-dot { background: #ef4444; }
.ad-pill.pending { color: var(--admin-muted); }
.ad-pill.pending .ad-dot { background: var(--admin-muted); }
.ad-pill-meta { color: var(--admin-muted); font-weight: 500; }
@keyframes ad-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); } 70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
.ad-section { margin-top: 20px; }
.ad-row-controls { display: flex; gap: 8px; align-items: center; }
.ad-input { padding: 8px 11px; border-radius: 8px; border: 1px solid var(--admin-border); background: #0e1118; color: var(--admin-text); font-size: 14px; }
.ad-btn { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--admin-border); background: transparent; color: var(--admin-text); cursor: pointer; font-size: 14px; }
.ad-btn-primary { background: linear-gradient(135deg, ${C.accent}, ${C.violet}); border: none; color: #fff; font-weight: 600; }
.ad-btn-primary:disabled { opacity: 0.5; }
.ad-btn-danger { color: #fca5a5; border-color: rgba(239,68,68,0.3); font-size: 12px; padding: 5px 10px; }
.ad-listrow { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--admin-grid); font-size: 14px; }
.ad-listrow-main { min-width: 0; overflow-wrap: anywhere; }
.ad-listrow-meta { flex-shrink: 0; white-space: nowrap; font-size: 12px; }
.ad-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; justify-content: flex-end; z-index: 50; backdrop-filter: blur(2px); }
.ad-drawer { width: min(540px, 94vw); height: 100%; overflow-y: auto; overflow-x: hidden; padding: 22px; background: var(--admin-card); border-left: 1px solid var(--admin-border); }
.ad-drawer .ad-subtable td { overflow-wrap: anywhere; }
.ad-pie { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.ad-pie-legend { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex: 1; }
.ad-pie-li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.ad-pie-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad-pie-val { margin-left: auto; padding-left: 10px; color: var(--admin-muted); font-weight: 600; white-space: nowrap; }
.ad-pie-pct { color: var(--admin-muted); font-weight: 500; margin-left: 8px; }
.ad-spend-body { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.ad-spend-body .ad-prov-list { flex: 1; min-width: 220px; }
.ad-whoami { font-size: 13px; }
.ad-btn-logout { padding: 5px 12px; font-size: 13px; border-color: rgba(239,68,68,0.3); color: #fca5a5; }
.ad-btn-logout:hover { background: rgba(239,68,68,0.1); }
.ad-usage-total { float: right; color: var(--admin-muted); font-weight: 500; font-size: 12px; }
.ad-subtable { font-size: 12.5px; }
.ad-subtable th { padding: 6px 8px; }
.ad-subtable td { padding: 7px 8px; }
.ad-spend-controls { display: flex; gap: 10px; align-items: center; }
.ad-refresh { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 8px;
  border: 1px solid var(--admin-border); background: transparent; color: var(--admin-muted); cursor: pointer; font-size: 12.5px; font-weight: 500; transition: all .15s; }
.ad-refresh:hover:not(:disabled) { color: var(--admin-text); border-color: var(--admin-accent); }
.ad-refresh:disabled { opacity: 0.6; cursor: default; }
.ad-spin { display: inline-block; animation: ad-rotate 0.7s linear infinite; }
@keyframes ad-rotate { to { transform: rotate(360deg); } }
.ad-seg { display: flex; gap: 4px; background: rgba(255,255,255,0.04); padding: 3px; border-radius: 9px; }
.ad-seg-btn { padding: 5px 11px; border-radius: 7px; border: none; background: transparent; color: var(--admin-muted);
  cursor: pointer; font-size: 12.5px; font-weight: 500; transition: all .15s; }
.ad-seg-btn:hover { color: var(--admin-text); }
.ad-seg-btn.on { background: linear-gradient(135deg, ${C.accent}, ${C.violet}); color: #fff; }
.ad-spend-total { font-size: 30px; font-weight: 700; margin: 2px 0 16px; }
.ad-prov-list { display: flex; flex-direction: column; gap: 12px; }
.ad-prov-row { display: grid; grid-template-columns: 110px 1fr 120px; align-items: center; gap: 12px; font-size: 13.5px; }
.ad-prov-name { display: inline-flex; align-items: center; gap: 7px; }
.ad-prov-track { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; }
.ad-prov-fill { display: block; height: 100%; border-radius: 999px; transition: width .3s ease; }
.ad-prov-cost { text-align: right; font-weight: 600; white-space: nowrap; }
.ad-prov-pct { color: var(--admin-muted); font-weight: 500; margin-left: 8px; }
@media (max-width: 600px) { .ad-whoami { display: none; } .ad-prov-row { grid-template-columns: 80px 1fr 96px; } }
`;
