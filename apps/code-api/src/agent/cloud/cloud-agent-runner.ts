import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import type { DiffSummary } from '@/dynamo/dynamo.interfaces';
import type { AgentRunner, AgentRunFinal, RunnerYield } from '../agent-runner';
import type { AgentRunContext } from '../mock-agent.service';
import { translateAgentMessage, extractResult } from '../local/claude-events';
import {
  FlyProvider,
  SANDBOX_EXPIRES_AT_METADATA_KEY,
  SANDBOX_ACTIVE_UNTIL_METADATA_KEY,
  type SandboxHandle,
} from './fly-provider';

// NOTE: nothing here may import from ../local/local-agent-runner — its
// top-level `@anthropic-ai/claude-agent-sdk` import is a devDependency absent
// from prod images, and pulling it in transitively would defeat the lazy
// dynamic import() agent.module.ts uses to keep the cloud path SDK-free.
// claude-events.ts is deliberately SDK-free (see its header), so it's safe.

export interface CloudAgentRunnerConfig {
  apiToken: string;
  orgSlug: string;
  image: string;
  // Tried in order by FlyProvider.create on insufficient_capacity — see
  // SandboxCreateOpts.regions. agent.module.ts resolves this from
  // FLY_REGIONS, falling back to [FLY_REGION] when unset.
  regions: string[];
  anthropicApiKey: string;
  // Minutes a successful run's sandbox survives past done, so the user can
  // open the workspace afterward — see SANDBOX_TTL_MINUTES / sandbox-sweep.ts.
  ttlMinutes: number;
  // When set, a successful run additionally tags the sandbox with the instant
  // the agent finished (SANDBOX_ACTIVE_UNTIL_METADATA_KEY), so the sweep can
  // split-bill active vs idle. Blaxel sets this; Fly omits it (flat billing) —
  // leaving it undefined keeps the Fly path byte-for-byte unchanged.
  trackActiveWindow?: boolean;
  // ADR-0004 machine billing — invoked only on the error/no-result path,
  // where THIS runner is the one actually destroying the sandbox (the
  // success path leaves it alive; sandbox-sweep.ts bills it later at true
  // destroy). agent.module.ts wires this to UsersService.billMachineUsage.
  onMachineDestroyBill?: (args: {
    sub: string;
    sandboxId: string;
    sessionId: string;
    nodeId: string;
    createdAt: string;
    destroyAtMs: number;
  }) => Promise<void>;
}

// Shapes emitted by the in-machine runner's SSE stream — kept in sync by hand
// with tools/spikes/cloud-sandbox/image/runner.mjs's sseSend calls.
type RunnerEvent =
  | { type: 'vscode-ready' }
  | { type: 'warn'; message: string }
  | { type: 'stderr'; text: string }
  | { type: 'claude'; line: unknown }
  | { type: 'claude-raw'; text: string }
  | { type: 'error'; message: string }
  | {
      type: 'result';
      sha: string;
      baseSha: string;
      diffSummary: DiffSummary;
      exitCode: number;
      pushed: boolean;
      pushError?: string;
      // ADR-0004 — set by runner.mjs when claude's own `--max-budget-usd`
      // stopped the run (stream result line subtype `error_max_budget_usd`).
      budgetExceeded?: boolean;
      // ADR-0004 — claude's own reported `total_cost_usd` for the run,
      // forwarded verbatim off the sandbox's `result` frame. This is the
      // authoritative cost basis nodes.service.ts bills from (see
      // AgentRunFinal.claudeCostUsd) — undefined only for the rare case
      // claude never emitted its own stream-json result line at all.
      claudeCostUsd?: number;
    };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// system/init carries the resolved model directly; assistant messages carry it
// on message.model — either can arrive first depending on turn structure.
// (Duplicated from local-agent-runner.ts — see the import note above.)
function extractModel(msg: unknown): string | undefined {
  if (!isRecord(msg)) return undefined;
  if (typeof msg.model === 'string') return msg.model;
  if (msg.type === 'assistant' && isRecord(msg.message) && typeof msg.message.model === 'string') {
    return msg.message.model as string;
  }
  return undefined;
}

function firstLine(text: string): string {
  return text.split('\n')[0].trim().slice(0, 72);
}

// Runs one CODE-node agent run inside a fresh single-use Fly Machine sandbox:
// provision app+machine, POST the instruction to the in-machine runner, relay
// its claude stream-json lines as AgentEvents. On success the sandbox is left
// running — tagged with a TTL expiry so the user can open its VS Code
// afterward — and sandbox-sweep.ts reaps it later. On error (or a stream that
// never produced a result) it's destroyed immediately in finally, same as
// before: an orphaned machine bills until someone notices (a client-crash
// orphan once ran ~22h; see the spike README).
export class CloudAgentRunner implements AgentRunner {
  private readonly logger = new Logger(CloudAgentRunner.name);
  private readonly provider: Pick<FlyProvider, 'create' | 'destroy' | 'setMetadata'>;

  constructor(
    private readonly cfg: CloudAgentRunnerConfig,
    provider?: Pick<FlyProvider, 'create' | 'destroy' | 'setMetadata'>,
  ) {
    this.provider = provider ?? new FlyProvider({ apiToken: cfg.apiToken, orgSlug: cfg.orgSlug });
  }

  async *run(ctx: AgentRunContext): AsyncIterable<RunnerYield> {
    const cloneUrl = ctx.repo?.cloneUrl;
    const init = ctx.repo?.init;
    if (!cloneUrl && !init) {
      throw new Error(
        'AGENT_RUNNER=cloud requires a repo cloneUrl or init (LOCAL_AGENT_REPO_URL or a project repo URL/new-project init) — a localPath cannot be cloned from inside a Fly Machine',
      );
    }
    const runId = ctx.runId ?? `no-id-${Date.now()}`;
    const runToken = randomBytes(24).toString('base64url');
    const vscodeToken = randomBytes(24).toString('base64url');

    let sandbox: SandboxHandle | undefined;
    // Set together, right before the 'result' yield, so finally knows whether
    // to preserve+tag the sandbox (success) or destroy it (error / no result).
    let succeeded = false;
    let workspaceExpiresAt: string | undefined;
    try {
      sandbox = await this.provider.create({
        runId,
        image: this.cfg.image,
        regions: this.cfg.regions,
        // Billing identity (ADR-0004) — baked into the machine's metadata at
        // birth, see fly-provider.ts's SANDBOX_*_METADATA_KEY comment.
        sub: ctx.sub,
        sessionId: ctx.sessionId,
        nodeId: runId,
        // The platform ANTHROPIC_API_KEY is deliberately NOT in the machine env:
        // the sandbox's openvscode terminal runs as root, so anything in the
        // machine env is readable by the user mid-run (`cat /proc/1/environ`).
        // The key travels in the POST /run body (TLS + bearer-authed) and the
        // in-machine runner hands it only to the claude process. RUN_TOKEN and
        // VSCODE_TOKEN are per-run and low-value, so machine env is fine.
        env: { RUN_TOKEN: runToken, VSCODE_TOKEN: vscodeToken, IS_SANDBOX: '1' },
        // Real boot-progress (WS-F) — forwarded straight through to
        // FlyProvider.provisionInApp's onPhase? calls.
        onPhase: ctx.onPhase,
      });

      const res = await fetch(`${sandbox.baseUrl}/__forkai/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: cloneUrl,
          init,
          branch: ctx.branchName,
          baseRef: ctx.baseCommitSha ?? undefined,
          instruction: this.buildInstruction(ctx),
          anthropicApiKey: this.cfg.anthropicApiKey,
          // ADR-0004 redesign — claude's own native flags. `model` is the CLI
          // model string (alias or full id); `maxBudgetUsd` is claude's own
          // dollar cost cap, both passed straight through to `claude --model
          // ... --max-budget-usd ...` by runner.mjs. Field names match what
          // runner.mjs destructures.
          model: ctx.model,
          maxBudgetUsd: ctx.maxBudgetUsd,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`sandbox /run → ${res.status}: ${await res.text().catch(() => '')}`);
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let resultText = '';
      let sdkModel: string | undefined;
      let runnerResult: Extract<RunnerEvent, { type: 'result' }> | null = null;

      // Manual SSE frame parse (\n\n-delimited frames, `data: ` lines) — the
      // spike's consumeSSE logic inlined here, since a callback-based helper
      // doesn't compose with yield inside an async generator.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let evt: RunnerEvent;
          try {
            evt = JSON.parse(dataLine.slice('data: '.length)) as RunnerEvent;
          } catch {
            this.logger.warn(`unparseable SSE frame from sandbox: ${frame.slice(0, 200)}`);
            continue;
          }

          if (evt.type === 'claude') {
            sdkModel = extractModel(evt.line) ?? sdkModel;
            for (const event of translateAgentMessage(evt.line)) {
              yield { type: 'event', event };
            }
            const result = extractResult(evt.line);
            if (result) {
              inputTokens = result.usage.inputTokens;
              outputTokens = result.usage.outputTokens;
              resultText = result.resultText;
            }
          } else if (evt.type === 'result') {
            runnerResult = evt;
          } else if (evt.type === 'error') {
            // finally below destroys the sandbox before this propagates.
            throw new Error(`sandbox runner error: ${evt.message}`);
          } else if (evt.type === 'stderr') {
            this.logger.warn(`sandbox claude stderr: ${evt.text.trim()}`);
          } else if (evt.type === 'warn') {
            this.logger.warn(`sandbox: ${evt.message}`);
          }
          // vscode-ready / claude-raw → not part of the AgentEvent vocabulary
        }
        if (done) break;
      }

      // A stream that ended without a result frame yields nothing further —
      // NodesService's "runner ended without a result" check handles that.
      // No commit means no workspace worth keeping either, so this falls
      // through to the finally's destroy branch (succeeded stays false).
      if (runnerResult) {
        workspaceExpiresAt = new Date(Date.now() + this.cfg.ttlMinutes * 60_000).toISOString();
        const final: AgentRunFinal = {
          commitMessage: firstLine(resultText) || ctx.instruction.slice(0, 72),
          runSummary: resultText.trim() || undefined,
          commitSha: runnerResult.sha,
          diffSummary: runnerResult.diffSummary,
          inputTokens,
          outputTokens,
          model: sdkModel ?? ctx.model ?? 'unknown',
          workspace: { kind: 'cloud', sandboxId: sandbox.sandboxId, vscodeUrl: sandbox.vscodeUrl },
          workspaceExpiresAt,
          // v1.1 push-back (ADR-0002 amendment) — pushError, when present, is
          // already redact()-ed by runner.mjs and also surfaced separately as
          // a 'warn' SSE frame (handled by the generic warn branch above), so
          // no extra logging is needed here.
          pushed: runnerResult.pushed,
          ...(runnerResult.pushError ? { pushError: runnerResult.pushError } : {}),
          ...(runnerResult.budgetExceeded ? { budgetExceeded: true } : {}),
          claudeCostUsd: runnerResult.claudeCostUsd,
        };
        succeeded = true;
        yield { type: 'result', result: final };
      }
    } finally {
      if (sandbox) {
        if (succeeded) {
          // Leave the sandbox running past this run — tag it with its expiry
          // instead of destroying, so sandbox-sweep.ts reaps it once it's
          // actually past TTL. Best-effort: a failed metadata write doesn't
          // fail the run — the sweep's age-based hard cap for metadata-less
          // machines is the fallback (see sandbox-sweep.ts).
          try {
            await this.provider.setMetadata(sandbox.sandboxId, SANDBOX_EXPIRES_AT_METADATA_KEY, workspaceExpiresAt!);
            // Blaxel-only (trackActiveWindow): mark where active compute ended so
            // the sweep bills create→now as active and now→destroy as idle. now
            // ≈ agent-finish (the 'result' yield fired just before this finally).
            // Best-effort like the expiry tag: a miss just means the split biller
            // treats the whole lifetime as active (see billBlaxelMachineUsage).
            if (this.cfg.trackActiveWindow) {
              await this.provider.setMetadata(sandbox.sandboxId, SANDBOX_ACTIVE_UNTIL_METADATA_KEY, new Date().toISOString());
            }
          } catch (err) {
            this.logger.warn(
              `failed to tag expiry on sandbox ${sandbox.sandboxId} — sweep will fall back to its age-based hard cap: ${String(err)}`,
            );
          }
        } else {
          let destroyed = false;
          try {
            await this.provider.destroy(sandbox.sandboxId);
            destroyed = true;
          } catch (err) {
            const [appName] = sandbox.sandboxId.split(':');
            this.logger.error(
              `failed to destroy sandbox ${sandbox.sandboxId} — ORPHANED and billing until swept (fly apps destroy ${appName} --yes): ${String(err)}`,
            );
          }
          // Bill machine lifetime here ONLY on this (error/no-result) path,
          // and only once destroy actually succeeded — a failed destroy
          // leaves the machine alive for the sweep to bill later instead. The
          // success branch above bills nothing (see class doc comment).
          // ctx.sub absent (shouldn't happen for cloud) skips billing rather
          // than writing a bad record. A billing failure is swallowed — it
          // must never mask the run's own error already propagating out of
          // this generator — and just means the sweep never gets a shot at
          // this sandboxId either, since it's already destroyed; logged loud.
          if (destroyed && ctx.sub) {
            try {
              await this.cfg.onMachineDestroyBill?.({
                sub: ctx.sub,
                sandboxId: sandbox.sandboxId,
                sessionId: ctx.sessionId ?? '',
                nodeId: runId,
                createdAt: sandbox.createdAt,
                destroyAtMs: Date.now(),
              });
            } catch (err) {
              this.logger.error(`onMachineDestroyBill failed for destroyed sandbox ${sandbox.sandboxId} — machine cost went unbilled: ${String(err)}`);
            }
          }
        }
      }
    }
  }

  // Matches LocalAgentRunner.buildPrompt word-for-word. The no-git-commit rule
  // is load-bearing, not cosmetic: the in-machine runner only commits if the
  // tree is dirty after the agent exits — an agent that self-commits mid-run
  // leaves a clean tree and the run silently reports sha === baseSha.
  private buildInstruction(ctx: AgentRunContext): string {
    const planSection = ctx.planDoc ? `\n\nPlan context:\n${ctx.planDoc}` : '';
    const okrSection = ctx.okr
      ? `\n\nObjective: ${ctx.okr.objective}\nKey results:\n${ctx.okr.keyResults.map((kr) => `- ${kr}`).join('\n')}`
      : '';
    return `${ctx.instruction}${planSection}${okrSection}\n\nWork only inside this repository checkout. Do NOT run \`git commit\`, \`git push\`, or change git config — the harness commits your changes after you finish.`;
  }
}
