'use client';
import { useEffect, useRef, useState } from 'react';
import type { ForkNode } from '@/lib/types';
import { getAgentRun, ApiError, type AgentEvent, type AgentRun, type Project } from '@/lib/api';
import { modelDisplayName } from '@/lib/utils';
import { kindLabel } from '@/lib/kindLabels';
import { Code, GitBranch, ArrowUpRight, Sparkles, AlertCircle } from './Icons';

interface AgentLogPaneProps {
  node: ForkNode; // kind CODE or BRANCH
  events?: AgentEvent[]; // live in-memory log while streaming (agentLogs[node.id] in App.tsx)
  project: Project | null;
  idToken: string;
  sessionId: string;
  onImplement: () => void; // "Implement" (BRANCH) / "Continue" (CODE, once its own run is done) — focuses the bottom composer
  onAskAboutCommit: (question: string) => void; // CODE only
  askLoading: boolean;
  onRunResolved?: (nodeId: string, run: AgentRun) => void; // mid-run poll (see effect below) reached 'done'/'error'
  onRetryRun?: (nodeId: string) => void; // CODE only — re-run a failed agent run in place
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

function LogLine({ event }: { event: AgentEvent }) {
  if (event.kind === 'truncated') {
    const p = event.payload as Record<string, unknown> | undefined;
    const msg = p && typeof p === 'object' && 'message' in p ? String(p.message) : 'earlier output omitted';
    return <div className="log-line log-line--truncated">··· {msg} ···</div>;
  }
  if (event.kind === 'tool_call') {
    const parsed = humanizeToolCall(event.payload);
    if (parsed) {
      return (
        <div className="log-line log-line--tool_call">
          <div>→ {parsed.human}</div>
          <details className="log-line-raw">
            <summary>raw</summary>
            <pre>{parsed.raw}</pre>
          </details>
        </div>
      );
    }
    return <div className="log-line log-line--tool_call">→ {payloadText(event.payload)}</div>;
  }
  // file_edit/terminal events carry serialized args JSON as their payload
  // (full file bodies inline) — humanize those the same way as tool_call so
  // the log reads as actions, not escaped JSON.
  if ((event.kind === 'file_edit' || event.kind === 'terminal' || event.kind === 'text') && typeof event.payload === 'string' && event.payload.trimStart().startsWith('{')) {
    const parsed = humanizeToolCall(event.payload);
    if (parsed) {
      return (
        <div className="log-line log-line--tool_call">
          <div>→ {parsed.human}</div>
          <details className="log-line-raw">
            <summary>raw</summary>
            <pre>{parsed.raw}</pre>
          </details>
        </div>
      );
    }
  }
  return <div className={`log-line log-line--${event.kind}`}>{payloadText(event.payload)}</div>;
}

export function AgentLogPane({ node, events, project, idToken, sessionId, onImplement, onAskAboutCommit, askLoading, onRunResolved, onRetryRun }: AgentLogPaneProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [fetchedEvents, setFetchedEvents] = useState<AgentEvent[] | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [askQ, setAskQ] = useState('');

  const hasLiveLog = !!events?.length;
  const log = hasLiveLog ? events! : (fetchedEvents ?? []);

  // If nothing streamed into this session (e.g. a page reload landed on an
  // already-finished CODE node), fetch the persisted AgentRun once.
  useEffect(() => {
    setFetchedEvents(null);
    if (node.kind !== 'CODE' || hasLiveLog) return;
    if (node.agentStatus !== 'done' && node.agentStatus !== 'error') return;
    let cancelled = false;
    setFetchLoading(true);
    getAgentRun(idToken, sessionId, node.id)
      .then(run => { if (!cancelled) setFetchedEvents(run.events); })
      .catch(() => { if (!cancelled) setFetchedEvents([]); })
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
        <p className="ws-instruction">Forked from <code>{shortSha ?? '—'}</code></p>
        <button className="proj-btn-primary" onClick={onImplement}>
          <Code size={13} /> Implement
        </button>
      </div>
    );
  }

  return (
    <div className="agent-pane">
      <div className="ws-meta">
        <span className="pill pill-kind pill-kind--code"><Code size={12} className="ic" /> {kindLabel('CODE')}</span>
        {node.branchName && <span className="commit-pill">⎇ {node.branchName}{shortSha ? ` · ${shortSha}` : ''}</span>}
        {node.model && <span className="pill">✳ {modelDisplayName(node.model)}</span>}
        <span className="agent-status">
          <span className={`status-dot status-dot--${node.agentStatus ?? 'done'}`} />
          {node.agentStatus ?? 'done'}
        </span>
        {node.agentStatus !== 'running' && (
          <button className="pill pill-code-cta" onClick={onImplement}>
            <Code size={12} className="ic" /> Continue
          </button>
        )}
      </div>

      {/* Selectable so a highlight over the instruction or the agent log can
          spawn an Ask AI branch (Phase G) — the diff summary and footer below
          stay outside, matching the rest of the workspace's select-body-only rule.
          Split into two wrappers (both tagged sectionId="agentlog") so the diff
          summary — the review artifact — can render between the instruction and
          the log, which is comparatively supporting detail. */}
      <div data-section-id="agentlog" className="agent-log-selectable">
        <p className="ws-instruction">{node.query}</p>
      </div>

      {node.diffSummary && (
        <>
          <div className="ws-block-label">Diff summary</div>
          <div className="diff-summary">
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
        </>
      )}

      <div data-section-id="agentlog" className="agent-log-selectable">
        <div className="ws-block-label">Agent log</div>
        <div className="term-panel" ref={logRef}>
          {log.length === 0 && fetchLoading && <div className="log-line log-line--text agent-log-shimmer">Loading run…</div>}
          {log.length === 0 && !fetchLoading && node.agentStatus === 'running' && (
            <div className="log-line log-line--text agent-log-shimmer">Starting…</div>
          )}
          {log.map(e => <LogLine key={e.seq} event={e} />)}
        </div>
      </div>

      {/* Outside the selectable wrapper — an interactive control, not source text
          to branch from, matching the diff summary/footer convention above. */}
      {node.agentStatus === 'error' && (
        <div className="ws-error">
          <AlertCircle size={16} className="ic" />
          <span>{node.error || 'The agent run failed.'}</span>
          {onRetryRun && (
            <button className="ws-error-btn" onClick={() => onRetryRun(node.id)}>Retry</button>
          )}
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
          </>
        )}
      </div>

      {node.agentStatus !== 'running' && (
        <div className="agent-ask-row">
          <input
            className="agent-ask-input"
            type="text"
            placeholder="Ask about this commit…"
            value={askQ}
            onChange={e => setAskQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && askQ.trim() && !askLoading) {
                onAskAboutCommit(askQ.trim());
                setAskQ('');
              }
            }}
          />
          <button
            className="agent-ask-btn"
            disabled={!askQ.trim() || askLoading}
            onClick={() => { onAskAboutCommit(askQ.trim()); setAskQ(''); }}
          >
            {askLoading ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Sparkles size={13} />}
          </button>
        </div>
      )}
    </div>
  );
}
