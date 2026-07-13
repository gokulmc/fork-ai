import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import type { DiffSummary } from '@/dynamo/dynamo.interfaces';
import type { AgentRunner, AgentRunFinal, RunnerYield } from '../agent-runner';
import type { AgentRunContext } from '../mock-agent.service';
import { translateAgentMessage, extractResult } from '../local/claude-events';
import { FlyProvider, type SandboxHandle } from './fly-provider';

// NOTE: nothing here may import from ../local/local-agent-runner — its
// top-level `@anthropic-ai/claude-agent-sdk` import is a devDependency absent
// from prod images, and pulling it in transitively would defeat the lazy
// dynamic import() agent.module.ts uses to keep the cloud path SDK-free.
// claude-events.ts is deliberately SDK-free (see its header), so it's safe.

export interface CloudAgentRunnerConfig {
  apiToken: string;
  orgSlug: string;
  image: string;
  region: string;
  anthropicApiKey: string;
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
  | { type: 'result'; sha: string; baseSha: string; diffSummary: DiffSummary; exitCode: number };

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
// its claude stream-json lines as AgentEvents, and ALWAYS destroy the sandbox
// in finally (success and error) — an orphaned machine bills until someone
// notices (a client-crash orphan once ran ~22h; see the spike README).
export class CloudAgentRunner implements AgentRunner {
  private readonly logger = new Logger(CloudAgentRunner.name);
  private readonly provider: Pick<FlyProvider, 'create' | 'destroy'>;

  constructor(
    private readonly cfg: CloudAgentRunnerConfig,
    provider?: Pick<FlyProvider, 'create' | 'destroy'>,
  ) {
    this.provider = provider ?? new FlyProvider({ apiToken: cfg.apiToken, orgSlug: cfg.orgSlug });
  }

  async *run(ctx: AgentRunContext): AsyncIterable<RunnerYield> {
    if (!ctx.repo?.cloneUrl) {
      throw new Error(
        'AGENT_RUNNER=cloud requires a repo cloneUrl (LOCAL_AGENT_REPO_URL or a project repo URL) — a localPath cannot be cloned from inside a Fly Machine',
      );
    }
    const cloneUrl = ctx.repo.cloneUrl;
    const runId = ctx.runId ?? `no-id-${Date.now()}`;
    const runToken = randomBytes(24).toString('base64url');
    const vscodeToken = randomBytes(24).toString('base64url');

    let sandbox: SandboxHandle | undefined;
    try {
      sandbox = await this.provider.create({
        runId,
        image: this.cfg.image,
        region: this.cfg.region,
        // The platform ANTHROPIC_API_KEY is deliberately NOT in the machine env:
        // the sandbox's openvscode terminal runs as root, so anything in the
        // machine env is readable by the user mid-run (`cat /proc/1/environ`).
        // The key travels in the POST /run body (TLS + bearer-authed) and the
        // in-machine runner hands it only to the claude process. RUN_TOKEN and
        // VSCODE_TOKEN are per-run and low-value, so machine env is fine.
        env: { RUN_TOKEN: runToken, VSCODE_TOKEN: vscodeToken, IS_SANDBOX: '1' },
      });

      const res = await fetch(`${sandbox.baseUrl}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${runToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: cloneUrl,
          branch: ctx.branchName,
          baseRef: ctx.baseCommitSha ?? undefined,
          instruction: this.buildInstruction(ctx),
          anthropicApiKey: this.cfg.anthropicApiKey,
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
      if (runnerResult) {
        const final: AgentRunFinal = {
          commitMessage: firstLine(resultText) || ctx.instruction.slice(0, 72),
          commitSha: runnerResult.sha,
          diffSummary: runnerResult.diffSummary,
          inputTokens,
          outputTokens,
          model: sdkModel ?? ctx.model ?? 'unknown',
          workspace: { kind: 'cloud', sandboxId: sandbox.sandboxId, vscodeUrl: sandbox.vscodeUrl },
        };
        yield { type: 'result', result: final };
      }
    } finally {
      if (sandbox) {
        try {
          await this.provider.destroy(sandbox.sandboxId);
        } catch (err) {
          const [appName] = sandbox.sandboxId.split(':');
          this.logger.error(
            `failed to destroy sandbox ${sandbox.sandboxId} — ORPHANED and billing until swept (fly apps destroy ${appName} --yes): ${String(err)}`,
          );
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
    return `${ctx.instruction}${planSection}\n\nWork only inside this repository checkout. Do NOT run \`git commit\`, \`git push\`, or change git config — the harness commits your changes after you finish.`;
  }
}

const sweepLogger = new Logger('CloudSandboxSweep');

// Destroys every leftover forkai-sbx-* app (except the base image). Exported
// but deliberately NOT called anywhere — a scheduled orphan sweep is a
// follow-up (see ADR-0001 amendment); wiring one blindly would reap sandboxes
// another live process still owns. destroy-in-finally above is the primary
// leak defence; this helper exists for manual/operator use.
export async function sweepOrphanSandboxes(
  provider: Pick<FlyProvider, 'listSandboxApps' | 'destroyApp'>,
): Promise<{ swept: string[]; failed: string[] }> {
  const swept: string[] = [];
  const failed: string[] = [];
  for (const name of await provider.listSandboxApps()) {
    try {
      await provider.destroyApp(name);
      swept.push(name);
    } catch (err) {
      failed.push(name);
      sweepLogger.error(`failed to destroy ${name}: ${String(err)}`);
    }
  }
  return { swept, failed };
}
