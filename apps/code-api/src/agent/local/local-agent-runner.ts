import { Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { DiffSummary } from '@/dynamo/dynamo.interfaces';
import type { AgentRunner, AgentRunFinal, RunnerYield } from '../agent-runner';
import type { AgentRunContext } from '../mock-agent.service';
import { materializeWorkspace, removeWorkspace } from './workspace';
import { commitAll, diffSummaryBetween } from './git-diff';
import { translateAgentMessage, extractResult } from './claude-events';

export interface LocalAgentRunnerConfig {
  anthropicApiKey: string;
  openVsCode: boolean;
  keepWorkspace: boolean;
}

const ZERO_DIFF: DiffSummary = { filesChanged: 0, additions: 0, deletions: 0, files: [] };
const MAX_TURNS = 40;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// system/init carries the resolved model directly; assistant messages carry it
// on message.model — either can arrive first depending on turn structure.
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

// Runs Claude Code headless (via @anthropic-ai/claude-agent-sdk) against a real
// git clone, streaming its own transcript out as AgentEvents and committing its
// edits on completion. Dev-only — see agent.module.ts's AGENT_RUNNER=local guard.
export class LocalAgentRunner implements AgentRunner {
  private readonly logger = new Logger(LocalAgentRunner.name);

  constructor(private readonly cfg: LocalAgentRunnerConfig) {}

  async *run(ctx: AgentRunContext): AsyncIterable<RunnerYield> {
    if (!ctx.repo?.localPath && !ctx.repo?.cloneUrl) {
      throw new Error('LOCAL_AGENT_REPO_PATH or LOCAL_AGENT_REPO_URL required for AGENT_RUNNER=local');
    }
    const runId = ctx.runId ?? `no-id-${Date.now()}`;
    const { dir, baseSha } = await materializeWorkspace({
      runId,
      source: { localPath: ctx.repo.localPath, cloneUrl: ctx.repo.cloneUrl },
      baseCommitSha: ctx.baseCommitSha,
      branchName: ctx.branchName,
    });

    if (this.cfg.openVsCode) this.tryOpenVsCode(dir);

    let succeeded = false;
    try {
      let inputTokens = 0;
      let outputTokens = 0;
      let resultText = '';
      let sdkModel: string | undefined;

      const stream = query({
        prompt: this.buildPrompt(ctx),
        options: {
          cwd: dir,
          permissionMode: 'acceptEdits',
          allowedTools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
          maxTurns: MAX_TURNS,
          // env REPLACES the subprocess environment (not merged) — spread
          // process.env so PATH/HOME etc still reach the CLI subprocess.
          env: { ...process.env, ANTHROPIC_API_KEY: this.cfg.anthropicApiKey },
        },
      });

      for await (const msg of stream) {
        sdkModel = extractModel(msg) ?? sdkModel;
        for (const event of translateAgentMessage(msg)) {
          yield { type: 'event', event };
        }
        const result = extractResult(msg);
        if (result) {
          inputTokens = result.usage.inputTokens;
          outputTokens = result.usage.outputTokens;
          resultText = result.resultText;
        }
      }

      const commitMessage = firstLine(resultText) || ctx.instruction.slice(0, 72);
      const sha = await commitAll(dir, commitMessage);
      const diffSummary = sha ? await diffSummaryBetween(dir, baseSha, sha) : ZERO_DIFF;

      const final: AgentRunFinal = {
        commitMessage,
        commitSha: sha ?? baseSha,
        diffSummary,
        inputTokens,
        outputTokens,
        model: sdkModel ?? ctx.model ?? 'unknown',
        workspace: { kind: 'local', path: dir },
      };
      succeeded = true;
      yield { type: 'result', result: final };
    } finally {
      if (!succeeded) {
        this.logger.error(`Local agent run failed — workspace preserved for inspection: ${dir}`);
      } else if (!this.cfg.keepWorkspace) {
        await removeWorkspace(dir);
      }
    }
  }

  private buildPrompt(ctx: AgentRunContext): string {
    const planSection = ctx.planDoc ? `\n\nPlan context:\n${ctx.planDoc}` : '';
    return `${ctx.instruction}${planSection}\n\nWork only inside this repository checkout. Do NOT run \`git commit\`, \`git push\`, or change git config — the harness commits your changes after you finish.`;
  }

  private tryOpenVsCode(dir: string): void {
    try {
      const child = spawn('code', [dir], { detached: true, stdio: 'ignore' });
      // spawn's ENOENT (no `code` on PATH) surfaces async via 'error', not a thrown exception.
      child.on('error', (err) => this.logVsCodeFallback(dir, err));
      child.unref();
    } catch (err) {
      this.logVsCodeFallback(dir, err as Error);
    }
  }

  private logVsCodeFallback(dir: string, err: Error): void {
    this.logger.warn(`Could not open VS Code (${err.message}) — open manually: vscode://file/${dir}`);
  }
}
