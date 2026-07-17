'use client';
import { useEffect, useRef, useState } from 'react';
import type { ForkNode } from '@/lib/types';
import { getAgentRun, updateNode, ApiError, type AgentEvent, type AgentRun, type Project } from '@/lib/api';
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
  onForkBranch?: (fromNodeId: string, title: string) => void; // opens BranchPopup off the commit pill
  onOkrChange?: (nodeId: string, okr: NonNullable<ForkNode['okr']>) => void; // BRANCH only — OKR editor save (#220)
}

// Progressive Objective → Key Results editor for the BRANCH pane's dead space
// (#220). `key={node.id}` at the call site remounts this on every branch
// switch so local draft state never leaks between nodes. Saves are
// optimistic (onOkrChange fires immediately, matching App.tsx's
// persistHighlight pattern) — a failed PATCH shows an inline error but
// doesn't roll back the optimistic UI, since the OKR is low-stakes and the
// user can just retry by editing again.
function OkrEditor({ node, idToken, sessionId, onOkrChange }: {
  node: ForkNode;
  idToken: string;
  sessionId: string;
  onOkrChange?: (nodeId: string, okr: NonNullable<ForkNode['okr']>) => void;
}) {
  const [editing, setEditing] = useState(!!node.okr);
  const [objective, setObjective] = useState(node.okr?.objective ?? '');
  const [keyResults, setKeyResults] = useState<string[]>(node.okr?.keyResults ?? []);
  const [error, setError] = useState<string | null>(null);
  const lastSavedObjective = useRef(node.okr?.objective ?? '');

  function save(nextObjective: string, nextKeyResults: string[]) {
    const trimmed = nextObjective.trim();
    if (!trimmed) return; // objective required — nothing to persist yet
    const okr = { objective: trimmed, keyResults: nextKeyResults.map(k => k.trim()).filter(Boolean) };
    lastSavedObjective.current = trimmed;
    onOkrChange?.(node.id, okr); // optimistic — map card updates immediately
    setError(null);
    updateNode(idToken, sessionId, node.id, { okr }).catch(() => setError('Could not save — try again'));
  }

  if (!editing) {
    return (
      <div className="okr-editor okr-editor--empty">
        <span className="okr-empty-text">🎯 No objective set for this branch yet.</span>
        <button type="button" className="okr-empty-btn" onClick={() => setEditing(true)}>+ Set objective</button>
      </div>
    );
  }

  return (
    <div className="okr-editor">
      <div className="okr-editor-label">🎯 Branch objective</div>
      <label className="okr-field-label" htmlFor={`okr-objective-${node.id}`}>Objective</label>
      <textarea
        id={`okr-objective-${node.id}`}
        className="okr-objective-input"
        rows={2}
        value={objective}
        placeholder="What is this branch trying to achieve?"
        onChange={e => setObjective(e.target.value)}
        onBlur={() => { if (objective.trim() !== lastSavedObjective.current) save(objective, keyResults); }}
      />
      {!objective.trim() && <p className="okr-validation">Objective is required to save.</p>}
      {error && <p className="okr-validation okr-validation--error">{error}</p>}

      <div className="okr-kr-section">
        <label className="okr-field-label">Key results</label>
        {keyResults.map((kr, i) => (
          <div className="okr-kr-row" key={i}>
            <span className="okr-kr-bullet">{i + 1}</span>
            <input
              className="okr-kr-input"
              type="text"
              value={kr}
              onChange={e => setKeyResults(prev => prev.map((v, j) => (j === i ? e.target.value : v)))}
              onBlur={() => save(objective, keyResults)}
            />
            <button
              type="button"
              className="okr-kr-delete"
              aria-label="Remove key result"
              onClick={() => {
                const next = keyResults.filter((_, j) => j !== i);
                setKeyResults(next);
                save(objective, next);
              }}
            >×</button>
          </div>
        ))}
        <button type="button" className="okr-kr-add" onClick={() => setKeyResults(prev => [...prev, ''])}>
          ＋ Add key result
        </button>
      </div>
    </div>
  );
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

// A `tool_call` payload is a JSON-serialized object — either `{ tool_name,
// args }` (mock agent) or `{ name, inputSummary }` (LocalAgentRunner, via
// claude-events.ts) — as a string, or already parsed. Splits it into a tool
// name + a one-line arg summary for the Claude-Code-style "● Tool(arg)"
// bullet. Returns null for anything that isn't this shape, so the caller can
// fall back to treating the payload as a plain sentence.
function humanizeToolCall(payload: unknown): { name: string; arg: string } | null {
  let obj: unknown = payload;
  if (typeof payload === 'string') {
    try { obj = JSON.parse(payload); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.tool_name === 'string') {
    return { name: rec.tool_name, arg: firstStringArg(rec.args) ?? '' };
  }
  if (typeof rec.name === 'string') {
    return { name: rec.name, arg: firstStringArg(rec.inputSummary) ?? '' };
  }
  // Persisted runs store just the args object (no name wrapper) — infer the
  // verb from the arg shape so fetched logs humanize the same as live ones.
  if (typeof rec.path === 'string') {
    return { name: typeof rec.content === 'string' ? 'Write' : 'Read', arg: rec.path };
  }
  if (typeof rec.command === 'string') return { name: 'Bash', arg: rec.command };
  return null;
}

// The mock agent's tool_call payloads are often a free first-person sentence
// ("Reading package.json to check dependencies") rather than JSON — when
// humanizeToolCall can't parse a structured shape, fall back to splitting off
// the leading word as the "tool name" so the bullet still reads as
// `Bold-word(rest of sentence)` instead of one long undifferentiated line.
function toolCallLabel(event: AgentEvent): { name: string; arg: string } {
  const parsed = humanizeToolCall(event.payload);
  if (parsed) return parsed;
  const text = payloadText(event.payload).trim();
  const spaceIdx = text.indexOf(' ');
  if (spaceIdx > 0 && spaceIdx <= 24) return { name: text.slice(0, spaceIdx), arg: text.slice(spaceIdx + 1) };
  return { name: 'Tool', arg: text };
}

function truncatedMessage(payload: unknown): string {
  const p = payload as Record<string, unknown> | undefined;
  return p && typeof p === 'object' && 'message' in p ? String(p.message) : 'earlier output omitted';
}

// Assistant prose — plain text, no markdown parsing (AgentLogPane is
// intentionally not code-split with a markdown lib).
function AssistantBubble({ text }: { text: string }) {
  return (
    <div className="cc-msg cc-msg--assistant">
      <div className="cc-msg-body">{text}</div>
    </div>
  );
}

// A `tool_result` / `terminal` / `file_edit` payload — collapsed to a
// one-line summary by default (Claude-Code-style ⎿), click to expand the
// full text. `indent` distinguishes a result paired under a preceding
// tool_call (indented, branch glyph) from a standalone/unpaired one.
function CollapsibleResult({ event, indent, expanded, onToggle }: {
  event: AgentEvent; indent: boolean; expanded: boolean; onToggle: () => void;
}) {
  const text = payloadText(event.payload);
  const nonEmptyLines = text.split('\n').filter(l => l.trim().length > 0);
  const firstLine = nonEmptyLines[0] ?? text;
  const extraLines = Math.max(0, nonEmptyLines.length - 1);
  const truncatedFirst = firstLine.length > 140;
  const hasMore = extraLines > 0 || truncatedFirst;
  const summary = truncatedFirst ? `${firstLine.slice(0, 140)}…` : firstLine;
  const suffix = extraLines > 0 ? `  +${extraLines} more line${extraLines === 1 ? '' : 's'}` : '';
  const kindClass = event.kind === 'terminal' ? ' cc-tool-result--terminal' : '';
  return (
    <div className={`cc-tool-result${indent ? ' cc-tool-result--indent' : ''}${kindClass}`}>
      {indent && <span className="cc-tool-result-branch">⎿</span>}
      <div className="cc-tool-result-body">
        {hasMore ? (
          <button type="button" className="cc-tool-result-summary" onClick={onToggle} aria-expanded={expanded}>
            <span className="cc-tool-result-caret">{expanded ? '▾' : '▸'}</span>
            {expanded ? firstLine : `${summary}${suffix}`}
          </button>
        ) : (
          <span className="cc-tool-result-summary cc-tool-result-summary--static">{summary || '(empty)'}</span>
        )}
        {expanded && <pre className="cc-tool-result-full">{text}</pre>}
      </div>
    </div>
  );
}

// "● ToolName(arg)" bullet, with its paired result (if any) rendered indented
// beneath it.
function ToolCallLine({ event, result, expanded, onToggle }: {
  event: AgentEvent; result: AgentEvent | null; expanded: boolean; onToggle: () => void;
}) {
  const { name, arg } = toolCallLabel(event);
  return (
    <div className="cc-tool">
      <div className="cc-tool-call">
        <span className="cc-tool-bullet">●</span>
        <span className="cc-tool-name">{name}</span>
        {arg && <span className="cc-tool-args">({arg})</span>}
      </div>
      {result && <CollapsibleResult event={result} indent expanded={expanded} onToggle={onToggle} />}
    </div>
  );
}

interface CallGroup { call: AgentEvent; result: AgentEvent | null; }

type TranscriptItem =
  | { key: string; type: 'assistant'; text: string }
  | { key: string; type: 'call'; group: CallGroup }
  | { key: string; type: 'result'; event: AgentEvent }
  | { key: string; type: 'truncated'; event: AgentEvent };

// Threads the flat AgentEvent log into a chat-shaped structure: consecutive
// `text` events merge into one assistant bubble; a `tool_result` / `terminal`
// / `file_edit` event pairs with the most recently emitted unmatched
// `tool_call` (there's no id on either side to match by — see root
// CLAUDE.md's AgentEvent shape — so this is purely positional); anything
// left over renders as its own standalone line.
function buildTranscript(steps: AgentEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let openCall: CallGroup | null = null;
  let pendingText: { seq: number; parts: string[] } | null = null;

  const flushText = () => {
    if (pendingText) {
      items.push({ key: `text-${pendingText.seq}`, type: 'assistant', text: pendingText.parts.join('\n\n') });
      pendingText = null;
    }
  };

  for (const event of steps) {
    if (event.kind === 'text') {
      const text = payloadText(event.payload).trim();
      if (!text) continue;
      if (pendingText) pendingText.parts.push(text);
      else pendingText = { seq: event.seq, parts: [text] };
      continue;
    }
    flushText();
    if (event.kind === 'truncated') {
      items.push({ key: `trunc-${event.seq}`, type: 'truncated', event });
      openCall = null;
      continue;
    }
    if (event.kind === 'tool_call') {
      const group: CallGroup = { call: event, result: null };
      items.push({ key: `call-${event.seq}`, type: 'call', group });
      openCall = group;
      continue;
    }
    // tool_result | terminal | file_edit — pair to the last open call, else standalone
    if (openCall && !openCall.result) openCall.result = event;
    else items.push({ key: `result-${event.seq}`, type: 'result', event });
  }
  flushText();
  return items;
}

export function AgentLogPane({ node, events, project, idToken, sessionId, onImplement, onRunResolved, onRetryRun, onForkBranch, onOkrChange }: AgentLogPaneProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [fetchedEvents, setFetchedEvents] = useState<AgentEvent[] | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [branchPopupRect, setBranchPopupRect] = useState<PillRect | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());

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
  // "M tools" in the transcript footer counts every action-taking event kind,
  // not just literal tool_call — terminal/file_edit are tool invocations too.
  const toolCount = steps.filter(e => e.kind === 'tool_call' || e.kind === 'terminal' || e.kind === 'file_edit').length;

  function toggleResult(seq: number) {
    setExpandedResults(prev => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq); else next.add(seq);
      return next;
    });
  }

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
    setExpandedResults(new Set());
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
        <OkrEditor key={node.id} node={node} idToken={idToken} sessionId={sessionId} onOkrChange={onOkrChange} />
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
  // A workspace that has already expired (the sweep that bills machineCostUsd
  // fires ~20min after it goes cold — see types.ts) but still shows no
  // machineCostUsd is a genuine gap, not "still accruing": the sweep either
  // hasn't run yet for an unrelated reason or lost the bill. Don't blind-
  // assert machineCostUsd! for it — show the total as AI-only, no provisional
  // "+", and suppress the accruing note (#211).
  const machineCostLost = workspaceExpired && !totalKnown;
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
        <p className="ws-instruction-card cc-msg--user">{node.query || node.commitMessage || '—'}</p>
      </div>

      {/* The agent's own prose summary of what it did — surfaced at the top of a
          finished run's pane, above the diff/transcript detail. Selectable so an
          Ask-AI branch can spawn from a highlight over it (sectionId="agentlog",
          mirroring the instruction card above). */}
      {node.agentStatus === 'done' && node.runSummary && (
        <div data-section-id="agentlog" className="agent-log-selectable">
          <div className="ws-block-label">Summary</div>
          <p className="run-summary">{node.runSummary}</p>
        </div>
      )}

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
        <div className="term-panel cc-transcript" ref={logRef}>
          {steps.length === 0 && fetchLoading && <div className="log-line log-line--text agent-log-shimmer">Loading run…</div>}
          {steps.length === 0 && !fetchLoading && node.agentStatus === 'running' && !latestHeartbeat && (
            <div className="log-line log-line--text agent-log-shimmer">Starting…</div>
          )}
          {steps.length === 0 && !fetchLoading && node.agentStatus !== 'running' && fetchError && (
            <div className="log-line log-line--text agent-log-error-note">Couldn&rsquo;t load this run.</div>
          )}
          {buildTranscript(steps).map(item => {
            if (item.type === 'assistant') return <AssistantBubble key={item.key} text={item.text} />;
            if (item.type === 'truncated') {
              return <div key={item.key} className="log-line log-line--truncated">··· {truncatedMessage(item.event.payload)} ···</div>;
            }
            if (item.type === 'call') {
              const { call, result } = item.group;
              return (
                <ToolCallLine
                  key={item.key}
                  event={call}
                  result={result}
                  expanded={result ? expandedResults.has(result.seq) : false}
                  onToggle={() => result && toggleResult(result.seq)}
                />
              );
            }
            return (
              <CollapsibleResult
                key={item.key}
                event={item.event}
                indent={false}
                expanded={expandedResults.has(item.event.seq)}
                onToggle={() => toggleResult(item.event.seq)}
              />
            );
          })}
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
          {steps.length > 0 && (
            <div className="cc-transcript-footer">
              ↳ {steps.length} step{steps.length === 1 ? '' : 's'} · {toolCount} tool{toolCount === 1 ? '' : 's'}
              {hasCost && ` · ${totalKnown || machineCostLost ? formatUsd(totalCost) : `${formatUsd(node.runCostUsd!)}+`}`}
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
                ≈ {totalKnown || machineCostLost ? formatUsd(totalCost) : `${formatUsd(node.runCostUsd!)}+`}
              </button>
              <div className="cost-popover" role="tooltip">
                <div className="cost-popover-row"><span>AI{node.model ? ` (${modelDisplayName(node.model)})` : ''}</span><span>{formatUsd(node.runCostUsd!)}</span></div>
                <div className="cost-popover-row"><span>Compute</span><span>{totalKnown ? formatUsd(node.machineCostUsd!) : machineCostLost ? 'n/a' : 'accruing…'}</span></div>
              </div>
            </div>
            {!totalKnown && !machineCostLost && <span className="cost-note">compute still accruing</span>}
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
