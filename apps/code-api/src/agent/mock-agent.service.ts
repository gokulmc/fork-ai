import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { LlmService } from '@/llm/llm.service';
import { BRANCH_DEFAULT_MODEL } from '@/llm/models';
import { pluginLine } from '@/projects/plugin-catalog';
import type { DiffSummary, RepoRef } from '@/dynamo/dynamo.interfaces';
import type { AgentEvent } from './agent-run.util';

// The runner interface the future real sandboxed runtime will implement in
// place of this mock — see docs/forkai-code/adr/0001. Any field added here must
// be something a real agent run can actually supply.
export interface AgentRunContext {
  instruction: string;
  planDoc: string | null;
  branchName: string;
  baseCommitSha: string | null;
  repoRef: RepoRef | null;
  plugins: string[];
  ancestorCodeSummaries: Array<{ commitMessage: string; filePaths: string[]; additions: number; deletions: number }>;
  model?: string;
  attachments?: Array<{ name: string; content: string }>;
  runId?: string; // the CODE nodeId — workspace naming / log correlation
  // Where a real (local/cloud) runner finds or creates its working copy — the
  // mock ignores all of it. cloneUrl/localPath are set from a real project's
  // repoRef (nodes.service.ts's resolveRunRepo) or, dev-only, straight from
  // LOCAL_AGENT_REPO_PATH/URL env. `init` is provider 'new' — no repo exists
  // yet, so the runner `git init`s an empty one instead of cloning (see
  // runner.mjs / CloudAgentRunner).
  repo?: { cloneUrl?: string; localPath?: string; authToken?: string; init?: { defaultBranch: string } };
}

export interface AgentRunResult {
  commitMessage: string;
  diffSummary: DiffSummary;
  events: AgentEvent[];
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// The five real event kinds the mock (and, eventually, a real sandboxed run) may
// emit. 'truncated' is excluded — it's a synthetic marker serializeEventsCapped
// inserts on the DB side, never something the agent itself produces.
const REAL_EVENT_KINDS = new Set<AgentEvent['kind']>(['text', 'tool_call', 'tool_result', 'terminal', 'file_edit']);

interface ParsedTranscript {
  commitMessage: string;
  diffSummary: DiffSummary;
  events: Array<{ kind: AgentEvent['kind']; payload: string }>;
}

@Injectable()
export class MockAgentService {
  private readonly logger = new Logger(MockAgentService.name);

  constructor(private readonly llm: LlmService) {}

  // One real LLM call simulates a full agent run's transcript. Malformed JSON
  // gets one retry; a deterministic LlmService failure (e.g. a length-limit
  // cut-off) is not retried, matching callJson's truncation handling.
  async generate(ctx: AgentRunContext): Promise<AgentRunResult> {
    const prompt = this.buildPrompt(ctx);
    const model = ctx.model ?? BRANCH_DEFAULT_MODEL;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= 1; attempt++) {
      const { rawText, usage } = await this.llm.generateAgentTranscript(prompt, model);
      try {
        const parsed = this.parseAndValidate(rawText);
        return {
          commitMessage: parsed.commitMessage,
          diffSummary: parsed.diffSummary,
          events: parsed.events.map((e, i) => ({ seq: i, ts: new Date().toISOString(), kind: e.kind, payload: e.payload })),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          model,
        };
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`Mock agent transcript attempt ${attempt + 1} failed to validate: ${lastError.message}`);
      }
    }

    throw new InternalServerErrorException(`Mock agent produced an invalid transcript after retry: ${lastError?.message ?? 'unknown error'}`);
  }

  private buildPrompt(ctx: AgentRunContext): string {
    const repo = ctx.repoRef ? `${ctx.repoRef.owner}/${ctx.repoRef.repo}` : 'an unspecified repository';
    const planSection = ctx.planDoc ? `\n\nPlan context:\n${ctx.planDoc}` : '';
    const priorCommits = ctx.ancestorCodeSummaries.length
      ? `\n\nPrior commits on this branch (most recent first):\n${ctx.ancestorCodeSummaries
          .map((c) => `- "${c.commitMessage}" (${c.filePaths.join(', ') || 'no files recorded'}, +${c.additions}/-${c.deletions})`)
          .join('\n')}`
      : '';
    const toolsSection = ctx.plugins.length
      ? `\n\nEnabled project plugins:\n${ctx.plugins.map(pluginLine).map((l) => `- ${l}`).join('\n')}`
      : '\n\nNo additional tools are enabled.';
    const attachmentsSection = ctx.attachments?.length
      ? `\n\n${ctx.attachments.map((a) => `--- Attached file: ${a.name} ---\n\`\`\`\n${a.content}\n\`\`\``).join('\n\n')}`
      : '';

    return `You are simulating a coding agent working in repo ${repo} on branch "${ctx.branchName}". Task: ${ctx.instruction}.${planSection}${priorCommits}${toolsSection}${attachmentsSection}

Return ONLY valid JSON, no prose, no markdown fences. Shape:
{
  "commitMessage": "a realistic, concise git commit message for the change",
  "diffSummary": {
    "filesChanged": <number>,
    "additions": <number>,
    "deletions": <number>,
    "files": [ { "path": "relative/file/path.ts", "status": "added" | "modified" | "deleted", "additions": <number>, "deletions": <number> } ]
  },
  "events": [ { "kind": "text" | "tool_call" | "tool_result" | "terminal" | "file_edit", "payload": "..." } ]
}

Produce between 20 and 35 events forming a plausible transcript of the agent's work: reading relevant files, following the enabled plugins where natural to the task, running the toolchain (installs, a brief FAILING test excerpt followed by a PASSING one after a fix), editing files with realistic paths for this repo, and short first-person "text" reflections. Every "payload" must be a plain string — stringify any structured content. File paths in "events" and "diffSummary.files" must be consistent with each other and with the repo. Escape double-quotes inside JSON strings.`;
  }

  // Mirrors LlmService.parseJson's fence-stripping + brace-extraction, then
  // strictly validates the agent-transcript shape (wrong kinds and non-string
  // payloads are rejected, not coerced) and recomputes diffSummary's totals from
  // the files array — the model's own arithmetic is never trusted.
  private parseAndValidate(raw: string): ParsedTranscript {
    let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    const parsed = JSON.parse(text) as Record<string, unknown>;

    if (typeof parsed.commitMessage !== 'string' || !parsed.commitMessage.trim()) {
      throw new Error('missing or empty commitMessage');
    }

    const diffRaw = parsed.diffSummary as Record<string, unknown> | undefined;
    if (!diffRaw || !Array.isArray(diffRaw.files)) {
      throw new Error('missing diffSummary.files');
    }
    const files = diffRaw.files.map((f) => {
      const file = f as Record<string, unknown>;
      if (
        typeof file.path !== 'string' ||
        typeof file.status !== 'string' ||
        typeof file.additions !== 'number' ||
        typeof file.deletions !== 'number'
      ) {
        throw new Error('malformed diffSummary.files entry');
      }
      return { path: file.path, status: file.status, additions: file.additions, deletions: file.deletions };
    });
    const diffSummary: DiffSummary = {
      filesChanged: files.length,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      files,
    };

    if (!Array.isArray(parsed.events) || !parsed.events.length) {
      throw new Error('missing events');
    }
    const events = parsed.events.map((e) => {
      const ev = e as Record<string, unknown>;
      if (typeof ev.kind !== 'string' || !REAL_EVENT_KINDS.has(ev.kind as AgentEvent['kind'])) {
        throw new Error(`bad event kind "${String(ev.kind)}"`);
      }
      if (typeof ev.payload !== 'string') {
        throw new Error('event payload must be a string');
      }
      return { kind: ev.kind as AgentEvent['kind'], payload: ev.payload };
    });

    return { commitMessage: parsed.commitMessage, diffSummary, events };
  }
}
