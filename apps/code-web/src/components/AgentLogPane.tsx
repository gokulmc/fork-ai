'use client';
import { useEffect, useRef, useState } from 'react';
import type { ForkNode } from '@/lib/types';
import { getAgentRun, ApiError, type AgentEvent, type AgentRun, type Project } from '@/lib/api';
import { modelDisplayName } from '@/lib/utils';
import { kindLabel } from '@/lib/kindLabels';
import { BranchPopup } from './BranchPopup';
import { Code, GitBranch, ArrowUpRight, AlertCircle } from './Icons';

interface AgentLogPaneProps {
  node: ForkNode; // kind CODE or BRANCH
  events?: AgentEvent[]; // live in-memory log while streaming (agentLogs[node.id] in App.tsx)
  project: Project | null;
  idToken: string;
  sessionId: string;
  onImplement: () => void; // "Implement" (BRANCH) / "Continue" (CODE, once its own run is done, or to recover an expired workspace) — focuses the bottom composer
  onRunResolved?: (nodeId: string, run: AgentRun) => void; // mid-run poll (see effect below) reached 'done'/'error'
  onRetryRun?: (nodeId: string) => void; // CODE only — re-run a failed agent run in place
  onForkBranch?: (fromNodeId: string, branchName: string) => void; // opens BranchPopup off the commit pill
}

interface PillRect { left: number; top: number; width: number; height: number; bottom: number; }

// Sub-cent amounts must never print as "$0.00" (reads as free/broken).
function formatUsd(usd: number): string {
  if (usd < 0.01) return '< $0.01';
  return `$${usd.toFixed(2)}`;
}

// A diff-less no-run CODE node is either an imported commit (has `imported`)
// or the synthetic merge commit `mergePrNode` creates (real commit, no agent
// run, not imported) — there's no separate MERGE-kind node to key off here.
function ProvenanceCard({ node, project }: { node: ForkNode; project: Project | null }) {
  const shortSha = node.commitSha ? node.commitSha.slice(0, 7) : null;
  const ghUrl = project && node.commitSha ? `${project.repoRef.url}/commit/${node.commitSha}` : null;
  return (
    <div className="provenance-card">
      <p className="provenance-card-message">{node.commitMessage || node.title || '—'}</p>
      <div className="provenance-card-meta">
        <span>{new Date(node.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
        {shortSha && <span>{shortSha}</span>}
      </div>
      {ghUrl && (
        <a className="provenance-card-link" href={ghUrl} target="_blank" rel="noopener noreferrer">
          View full diff on GitHub <ArrowUpRight size={11} />
        </a>
      )}
    </div>
  );
}

// Payload is `unknown` on the wire — in practice the mock agent always emits a
// plain string, but render defensively (compact JSON for anything else).
function payloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  try { return JSON.stringify(payload); } catch { return String(payload); }
}

// Finds the first string value in a tool call's `args` object, regardless of
// its key name (`path`, `command`, `cmd`, …) — the mock agent's schema for
// `args` isn't fixed, so matching by position is more robust than by key.
function firstStringArg(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  for (const v of Object.values(args as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// A `tool_call` payload is sometimes a JSON-serialized `{ tool_name, args }`
// object (as a string, or already parsed) rather than a plain human sentence.
// Turn that into a short human-readable line, keeping the raw JSON available
// for anyone who wants the full detail. Returns null for anything that isn't
// this shape, so the caller can fall back to the plain raw rendering.
function humanizeToolCall(payload: unknown): { human: string; raw: string } | null {
  let obj: unknown = payload;
  if (typeof payload === 'string') {
    try { obj = JSON.parse(payload); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const raw = JSON.stringify(obj);
  if (typeof rec.tool_name === 'string') {
    const toolName = rec.tool_name;
    const arg = firstStringArg(rec.args) ?? '';
    if (toolName === 'fs.writeFile') return { human: `Wrote ${arg}`, raw };
    if (toolName === 'fs.readFile') return { human: `Read ${arg}`, raw };
    if (toolName === 'exec.exec') return { human: `Ran: ${arg}`, raw };
    return { human: `${toolName}(${arg})`, raw };
  }
  // Persisted runs store just the args object (no tool_name wrapper) — infer
  // the verb from the arg shape so fetched logs humanize the same as live ones.
  if (typeof rec.path === 'string') {
    return { human: `${typeof rec.content === 'string' ? 'Wrote' : 'Read'} ${rec.path}`, raw };
  }
  if (typeof rec.command === 'string') return { human: `Ran: ${rec.command}`, raw };
  return null;
}

// One-line step row (dot + bold verb + muted detail), replacing the old
// two-line tool_call/tool_result pair — see fix-agent-timeline.html.
function TimelineStep({ event }: { event: AgentEvent }) {
  if (event.kind === 'truncated') {
    const p = event.payload as Record<string, unknown> | undefined;
    const msg = p && typeof p === 'object' && 'message' in p ? String(p.message) : 'earlier output omitted';
    return <div className="log-line log-line--truncated">··· {msg} ···</div>;
  }
  const parsed = humanizeToolCall(event.payload);
  if (parsed) {
    return (
      <div className="timeline-step">
        <span className="timeline-step-dot" />
        <div className="timeline-step-body">
          <span className="timeline-step-verb">{parsed.human}</span>
          <details className="log-line-raw">
            <summary>raw</summary>
            <pre>{parsed.raw}</pre>
          </details>
        </div>
      </div>
    );
  }
  const isTerminal = event.kind === 'terminal' && typeof event.payload === 'string';
  return (
    <div className="timeline-step">
      <span className="timeline-step-dot" />
      <div className="timeline-step-body">
        {isTerminal ? <div className="log-line log-line--terminal">{event.payload as string}</div> : payloadText(event.payload)}
      </div>
    </div>
  );
}

export function AgentLogPane({ node, events, project, idToken, sessionId, onImplement, onRunResolved, onRetryRun, onForkBranch }: AgentLogPaneProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [fetchedEvents, setFetchedEvents] = useState<AgentEvent[] | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [branchPopupRect, setBranchPopupRect] = useState<PillRect | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [costOpen, setCostOpen] = useState(false);

  const hasLiveLog = !!events?.length;
  const log = hasLiveLog ? events! : (fetchedEvents ?? []);
  // Imported/merge commits and a bare BRANCH lane never had an agent run —
  // the page reads as real provenance, not a failed/empty run, for those.
  const hasRun = node.agentStatus === 'running' || node.agentStatus === 'done' || node.agentStatus === 'error';

  // Heartbeat/boot-phase events (seq<0, descending) are a live SSE-only signal —
  // never persisted (see nodes.service.ts) — so they only ever appear in the
  // live `events` prop, never in a fetched/polled log. Real steps (seq>=0)
  // render as the timeline; the latest heartbeat (if any) replaces in place as
  // one status line instead of appending a growing pile of "Working…" rows.
  const steps = log.filter(e => e.seq >= 0);
  const latestHeartbeat = [...log].reverse().find(e => e.seq < 0);

  // A run that failed before producing a single real step never got past
  // provisioning/boot — there's no log or diff to show, so the status line
  // itself carries the reason (see fix-failure-states.html's boot-failure case).
  const isBootFailure = node.agentStatus === 'error' && steps.length === 0;

  // Reset transcript-fetch state AND the disclosure's expanded/collapsed state
  // when the active node changes — AgentLogPane isn't remounted on node switch
  // (same JSX slot in App.tsx), so local state must be reset explicitly.
  useEffect(() => {
    setFetchedEvents(null);
    setFetchError(false);
    setLogExpanded(false);
    setCostOpen(false);
    if (node.kind !== 'CODE' || hasLiveLog) return;
    if (node.agentStatus !== 'done' && node.agentStatus !== 'error') return;
    let cancelled = false;
    setFetchLoading(true);
    getAgentRun(idToken, sessionId, node.id)
      .then(run => { if (!cancelled) setFetchedEvents(run.events); })
      .catch(() => { if (!cancelled) { setFetchedEvents([]); setFetchError(true); } })
      .finally(() => { if (!cancelled) setFetchLoading(false); });
    return () => { cancelled = true; };
  }, [node.id, node.kind, node.agentStatus, hasLiveLog, idToken, sessionId]);

  // A page reload mid-run has no SSE connection to resume — the node comes back
  // from loadSession with agentStatus still 'running' and no live `events` prop.
  // Poll the persisted AgentRun (server flushes it every 10 events/2s) until it
  // resolves, so the pane shows real progress instead of a static "Starting…".
  useEffect(() => {
    if (node.kind !== 'CODE' || node.agentStatus !== 'running' || hasLiveLog) return;
    let cancelled = false;
    const poll = () => {
      getAgentRun(idToken, sessionId, node.id)
        .then(run => {
          if (cancelled) return;
          setFetchedEvents(run.events);
          if (run.status !== 'running') {
            clearInterval(intervalId);
            onRunResolved?.(node.id, run);
          }
        })
        .catch(err => {
          // The temp node never made it to the DB (e.g. the create call itself
          // failed before the `init` SSE event) — stop polling a dead endpoint.
          if (!cancelled && err instanceof ApiError && err.status === 404) clearInterval(intervalId);
        });
    };
    const intervalId = setInterval(poll, 2500);
    poll();
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [node.id, node.kind, node.agentStatus, hasLiveLog, idToken, sessionId, onRunResolved]);

  useEffect(() => {
    if (node.agentStatus !== 'running') return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, node.agentStatus]);

  const shortSha = node.commitSha ? node.commitSha.slice(0, 7) : null;

  if (node.kind === 'BRANCH') {
    return (
      <div className="agent-pane agent-pane--reduced">
        <div className="ws-meta">
          <span className="pill pill-kind pill-kind--branch"><GitBranch size={12} className="ic" /> {kindLabel('BRANCH')}</span>
          {node.branchName && <span className="commit-pill">⎇ {node.branchName}{shortSha ? ` · ${shortSha}` : ''}</span>}
        </div>
        <p className="ws-instruction-card">Forked from <code>{shortSha ?? '—'}</code></p>
        <button className="proj-btn-primary" onClick={onImplement}>
          <Code size={13} /> Implement
        </button>
      </div>
    );
  }

  const canForkFromPill = !!onForkBranch && !!node.commitSha;
  const workspaceActive = node.workspace?.kind === 'cloud' && !!node.workspaceExpiresAt && Date.now() < new Date(node.workspaceExpiresAt).getTime();
  const workspaceExpired = node.workspace?.kind === 'cloud' && !workspaceActive;
  const hasCost = hasRun && !!node.runCostUsd;
  const totalKnown = node.machineCostUsd != null;
  const totalCost = (node.runCostUsd ?? 0) + (node.machineCostUsd ?? 0);
  const diffFilesCount = node.diffSummary?.filesChanged;

  return (
    <div className="agent-pane">
      <div className="ws-meta">
        <span className="pill pill-kind pill-kind--code"><Code size={12} className="ic" /> {kindLabel('CODE')}</span>
        {node.branchName && (
          canForkFromPill ? (
            <button
              type="button"
              className={`commit-pill commit-pill--clickable${branchPopupRect ? ' commit-pill--open' : ''}`}
              aria-haspopup="dialog"
              title="Fork a branch from this commit"
              onClick={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setBranchPopupRect({ left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom });
              }}
            >
              ⎇ {node.branchName}{shortSha ? ` · ${shortSha}` : ''}
              <GitBranch size={10} className="commit-pill-fork-ic" />
            </button>
          ) : (
            <span className="commit-pill">⎇ {node.branchName}{shortSha ? ` · ${shortSha}` : ''}</span>
          )
        )}
        {node.model && <span className="pill">✳ {modelDisplayName(node.model)}</span>}
        {hasRun ? (
          <span className={`agent-status${node.agentStatus === 'error' ? ' agent-status--error' : ''}`}>
            <span className={`status-dot status-dot--${node.agentStatus}`} />
            {isBootFailure ? 'Sandbox failed to start' : node.agentStatus}
          </span>
        ) : (
          // No agent run happened here — imported history and a merge commit
          // are real provenance, not a failed/missing run, so the status slot
          // gets an honest neutral chip instead of a misleading green dot.
          <span className="mock-tag">{node.imported ? 'imported' : 'merge'}</span>
        )}
        {isBootFailure && onRetryRun && (
          <button className="timeline-retry-btn" onClick={() => onRetryRun(node.id)}>↻ Retry</button>
        )}
        {node.agentStatus !== 'running' && (
          <button className="pill pill-code-cta" onClick={onImplement}>
            <Code size={12} className="ic" /> Continue
          </button>
        )}
      </div>
      {branchPopupRect && onForkBranch && (
        <BranchPopup
          rect={branchPopupRect}
          fromSha={shortSha ?? '—'}
          onSubmit={name => { onForkBranch(node.id, name); setBranchPopupRect(null); }}
          onClose={() => setBranchPopupRect(null)}
        />
      )}

      {/* Selectable so a highlight over the instruction or the diff summary can
          spawn an Ask AI branch (Phase G) — both tagged sectionId="agentlog".
          The tool-call transcript itself is transient run detail, not
          highlightable source text, so it stays outside this wrapper. */}
      <div data-section-id="agentlog" className="agent-log-selectable">
        <p className="ws-instruction-card">{node.query || node.commitMessage || '—'}</p>
      </div>

      {/* Once a run is done, the transcript collapses behind a disclosure and
          the diff summary is promoted to the visual "hero" — the point of a
          finished run is the result, not the blow-by-blow. Still-running or
          still-erroring nodes keep the transcript expanded (it IS the point,
          there). */}
      {node.agentStatus === 'done' && steps.length > 0 && (
        <button
          type="button"
          className="timeline-disclosure"
          aria-expanded={logExpanded}
          onClick={() => setLogExpanded(o => !o)}
        >
          <span className="timeline-disclosure-caret">{logExpanded ? '▾' : '▸'}</span> Activity
          <span className="timeline-disclosure-count">
            ({steps.length} step{steps.length === 1 ? '' : 's'}{diffFilesCount ? ` · ${diffFilesCount} file${diffFilesCount === 1 ? '' : 's'}` : ''})
          </span>
        </button>
      )}

      {node.diffSummary ? (
        <div data-section-id="agentlog" className="agent-log-selectable">
          <div className="ws-block-label">Diff summary</div>
          <div className={`diff-summary${node.agentStatus === 'done' ? ' diff-summary--hero' : ''}`}>
            <div className="diff-summary-head">
              {node.diffSummary.filesChanged} file{node.diffSummary.filesChanged === 1 ? '' : 's'} changed,{' '}
              <span className="diff-add-text">+{node.diffSummary.additions}</span>{' '}
              <span className="diff-del-text">−{node.diffSummary.deletions}</span>
            </div>
            <ul className="diff-file-list">
              {node.diffSummary.files.map(f => (
                <li className="diff-file-row" key={f.path}>
                  <span className={`diff-status diff-status--${f.status.charAt(0).toLowerCase()}`}>{f.status.charAt(0).toUpperCase()}</span>
                  <span className="diff-file-path">{f.path}</span>
                  <span className="diff-file-counts">
                    {f.additions > 0 && <span className="diff-add-text">+{f.additions}</span>}
                    {f.deletions > 0 && <span className="diff-del-text">−{f.deletions}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : !hasRun ? (
        <>
          <div className="ws-block-label">{node.imported ? 'Imported from GitHub' : 'Merge commit'}</div>
          <ProvenanceCard node={node} project={project} />
        </>
      ) : null}

      {/* No-run nodes (imported/merge) never had a log; a boot failure has none
          to show either. A finished run hides its transcript behind the
          disclosure above unless the user expands it. */}
      {hasRun && !isBootFailure && (node.agentStatus !== 'done' || logExpanded) && (
        <div className="ws-block-label">Agent log</div>
      )}
      {hasRun && !isBootFailure && (node.agentStatus !== 'done' || logExpanded) && (
        <div className="term-panel" ref={logRef}>
          {steps.length === 0 && fetchLoading && <div className="log-line log-line--text agent-log-shimmer">Loading run…</div>}
          {steps.length === 0 && !fetchLoading && node.agentStatus === 'running' && !latestHeartbeat && (
            <div className="log-line log-line--text agent-log-shimmer">Starting…</div>
          )}
          {steps.length === 0 && !fetchLoading && node.agentStatus !== 'running' && fetchError && (
            <div className="log-line log-line--text agent-log-error-note">Couldn&rsquo;t load this run.</div>
          )}
          {steps.map(e => <TimelineStep key={e.seq} event={e} />)}
          {node.agentStatus === 'running' && latestHeartbeat && (
            <div className="timeline-working" aria-live="polite">
              <span className="timeline-working-dot" />{payloadText(latestHeartbeat.payload)}
            </div>
          )}
          {node.agentStatus === 'error' && (
            <div className="timeline-step timeline-step--error">
              <span className="timeline-step-dot timeline-step-dot--error" />
              <div className="timeline-step-body">
                <span className="timeline-step-verb">Run failed</span>
                <div className="timeline-step-error-panel">
                  <span className="timeline-step-error-reason">{node.error || 'The agent run failed.'}</span>
                  {onRetryRun && <button className="timeline-retry-btn" onClick={() => onRetryRun(node.id)}>↻ Retry</button>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {node.budgetExceeded && (
        <div className="ws-error ws-error--muted">
          <AlertCircle size={16} className="ic" />
          <span>Run stopped at the budget limit — partial work was committed.</span>
        </div>
      )}

      <div className="ws-footer">
        {project && node.commitSha && (
          <>
            <a className="gh-btn" href={`${project.repoRef.url}/commit/${node.commitSha}`} target="_blank" rel="noopener noreferrer">
              View on GitHub <ArrowUpRight size={12} />
            </a>
            {/* Only mock/synthesized repos get the "mock" tag — a real 'github'
                repo's commitSha/url are genuine, so the link should read as real. */}
            {project.repoRef.provider !== 'github' && <span className="mock-tag">mock</span>}
            {node.pushed === true && <span className="state-chip state-chip--pushed"><span className="status-dot" />Pushed ✓</span>}
            {node.pushed === false && (
              <span className="state-chip state-chip--sandbox-only" title={node.pushError}><span className="status-dot" />commit only in sandbox</span>
            )}
          </>
        )}
        {/* Evaluated at render, not on a re-render tick — a link that's just
            past its expiry when clicked simply 404s on the sandbox (harmless,
            already-torn-down machine), so staleness between renders is fine. */}
        {workspaceActive && node.workspace?.kind === 'cloud' && (
          <a className="state-chip state-chip--ws-active" href={node.workspace.vscodeUrl} target="_blank" rel="noopener noreferrer">
            <span className="status-dot" />Workspace active
          </a>
        )}
        {workspaceExpired && <span className="state-chip state-chip--ws-expired">🕐 Workspace expired</span>}
        {/* Electron wiring (openInEditor) is Phase B — for now the local path
            is informational only. */}
        {node.workspace?.kind === 'local' && <span className="ws-footer-note">{node.workspace.path}</span>}

        {hasCost && (
          <div className="cost-total-wrap">
            <div className={`cost-total-group${costOpen ? ' cost-total-group--open' : ''}`}>
              <button type="button" className="cost-total" aria-expanded={costOpen} onClick={() => setCostOpen(o => !o)}>
                ≈ {totalKnown ? formatUsd(totalCost) : `${formatUsd(node.runCostUsd!)}+`}
              </button>
              <div className="cost-popover" role="tooltip">
                <div className="cost-popover-row"><span>AI{node.model ? ` (${modelDisplayName(node.model)})` : ''}</span><span>{formatUsd(node.runCostUsd!)}</span></div>
                <div className="cost-popover-row"><span>Compute</span><span>{totalKnown ? formatUsd(node.machineCostUsd!) : 'accruing…'}</span></div>
              </div>
            </div>
            {!totalKnown && <span className="cost-note">compute still accruing</span>}
          </div>
        )}
      </div>
      {workspaceExpired && (
        <p className="ws-footer-note ws-footer-note--wide">
          Continuing starts a fresh sandbox from this commit — nothing you&rsquo;ve built is lost.{' '}
          <button type="button" className="ws-footer-note-action" onClick={onImplement}>Continue →</button>
        </p>
      )}
    </div>
  );
}
