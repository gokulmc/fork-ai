import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { FlyProvider } from './fly-provider.js';
import { translateAgentMessage } from './claude-events.js';

interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}
interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: DiffFile[];
}

// Shapes emitted by image/runner.mjs's SSE stream. Kept in sync by hand — see
// the header comment there.
type RunnerEvent =
  | { type: 'vscode-ready' }
  | { type: 'warn'; message: string }
  | { type: 'stderr'; text: string }
  | { type: 'claude'; line: unknown }
  | { type: 'claude-raw'; text: string }
  | { type: 'error'; message: string }
  | { type: 'result'; sha: string; baseSha: string; diffSummary: DiffSummary; exitCode: number };

const t0 = Date.now();
let lastT = t0;
function phase(label: string): void {
  const now = Date.now();
  const total = ((now - t0) / 1000).toFixed(1);
  const delta = ((now - lastT) / 1000).toFixed(1);
  lastT = now;
  console.log(`[+${delta}s / t=${total}s] ${label}`);
}

async function consumeSSE<T>(
  url: string,
  token: string,
  body: unknown,
  onEvent: (evt: T) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`POST ${url} → ${res.status}: ${await res.text().catch(() => '')}`);
  }

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
      try {
        onEvent(JSON.parse(dataLine.slice('data: '.length)) as T);
      } catch {
        console.error('[spike] could not parse SSE frame:', frame);
      }
    }
    if (done) break;
  }
}

async function headersCheck(url: string): Promise<void> {
  console.log(`[headers-check] GET ${url}`);
  const res = await fetch(url, { redirect: 'manual' });
  console.log(`  status: ${res.status}`);
  console.log(`  x-frame-options: ${res.headers.get('x-frame-options') ?? '(not set)'}`);
  console.log(`  content-security-policy: ${res.headers.get('content-security-policy') ?? '(not set)'}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      instruction: { type: 'string' },
      branch: { type: 'string', default: 'spike-1' },
      image: { type: 'string' },
      keep: { type: 'boolean', default: false },
      'headers-check': { type: 'string' },
    },
  });

  if (values['headers-check']) {
    await headersCheck(values['headers-check']);
    return;
  }

  const repo = values.repo;
  const instruction = values.instruction;
  if (!repo || !instruction) {
    console.error(
      'Usage: npx tsx src/run-spike.ts --repo <cloneUrl> --instruction "..." [--branch spike-1] [--image <ref>] [--keep]',
    );
    console.error('   or: npx tsx src/run-spike.ts --headers-check <vscodeUrl>');
    process.exit(1);
  }

  const apiToken = process.env.FLY_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const image = values.image ?? process.env.FLY_SANDBOX_IMAGE;
  const orgSlug = process.env.FLY_ORG ?? 'personal';
  const region = process.env.FLY_REGION ?? 'bom';
  if (!apiToken) throw new Error('FLY_API_TOKEN is required (see README — `fly tokens create org`)');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is required');
  if (!image) throw new Error('--image or FLY_SANDBOX_IMAGE is required (e.g. registry.fly.io/forkai-sbx-base:latest)');

  const runId = randomBytes(4).toString('hex');
  const runToken = randomBytes(24).toString('base64url');
  const vscodeToken = randomBytes(24).toString('base64url');

  phase(`starting run ${runId} (region ${region}, image ${image})`);

  const provider = new FlyProvider({ apiToken, orgSlug });
  let sandbox: Awaited<ReturnType<FlyProvider['create']>> | undefined;

  try {
    sandbox = await provider.create({
      runId,
      image,
      region,
      // IS_SANDBOX=1: the container runs as root, and Claude Code refuses
      // --dangerously-skip-permissions under root unless this is set.
      env: { ANTHROPIC_API_KEY: anthropicKey, RUN_TOKEN: runToken, VSCODE_TOKEN: vscodeToken, IS_SANDBOX: '1' },
    });
    phase(`app + machine created, /healthz OK — sandboxId ${sandbox.sandboxId}`);
    console.log('');
    console.log(`  >>> openvscode-server: ${sandbox.vscodeUrl}`);
    console.log(`  >>> open this NOW to watch the agent work`);
    console.log('');

    let firstAgentEventSeen = false;
    let resultEvent: Extract<RunnerEvent, { type: 'result' }> | null = null;

    await consumeSSE<RunnerEvent>(
      `${sandbox.baseUrl}/run`,
      runToken,
      { repoUrl: repo, branch: values.branch, instruction },
      (evt) => {
        if (evt.type === 'vscode-ready') {
          phase('openvscode-server ready');
        } else if (evt.type === 'warn') {
          console.warn(`[warn] ${evt.message}`);
        } else if (evt.type === 'stderr') {
          process.stderr.write(`[claude stderr] ${evt.text}`);
        } else if (evt.type === 'claude') {
          if (!firstAgentEventSeen) {
            firstAgentEventSeen = true;
            phase('time-to-first-agent-event');
          }
          for (const e of translateAgentMessage(evt.line)) {
            console.log(`  [${e.kind}] ${typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload)}`);
          }
        } else if (evt.type === 'claude-raw') {
          console.log(`  [claude-raw] ${evt.text}`);
        } else if (evt.type === 'error') {
          console.error(`[runner error] ${evt.message}`);
        } else if (evt.type === 'result') {
          resultEvent = evt;
        }
      },
    );

    phase('SSE stream closed');
    if (resultEvent) {
      const r: Extract<RunnerEvent, { type: 'result' }> = resultEvent;
      console.log('');
      console.log(`  commit sha:    ${r.sha}`);
      console.log(`  base sha:      ${r.baseSha}`);
      console.log(`  exit code:     ${r.exitCode}`);
      console.log(
        `  files changed: ${r.diffSummary.filesChanged} (+${r.diffSummary.additions}/-${r.diffSummary.deletions})`,
      );
      for (const f of r.diffSummary.files) {
        console.log(`    ${f.status.padEnd(9)} ${f.path} (+${f.additions}/-${f.deletions})`);
      }
    } else {
      console.warn('[spike] stream closed without a result event');
    }
  } finally {
    const wallMs = Date.now() - t0;
    if (sandbox && !values.keep) {
      phase('destroying sandbox');
      await provider.destroy(sandbox.sandboxId);
    } else if (sandbox) {
      const [flyAppName] = sandbox.sandboxId.split(':');
      console.log(`[spike] --keep set, leaving sandbox up: ${sandbox.sandboxId}`);
      console.log(`         remember to destroy it manually: fly apps destroy ${flyAppName ?? sandbox.sandboxId} --yes`);
    }
    const wallMinutes = wallMs / 60_000;
    // $0.00051/min is a rough placeholder for a shared-cpu-2x/4096mb machine —
    // verify against https://fly.io/docs/about/pricing/ before trusting this number.
    const costEstimate = wallMinutes * 0.00051;
    console.log('');
    console.log(`  wall time: ${(wallMs / 1000).toFixed(1)}s (${wallMinutes.toFixed(2)} min)`);
    console.log(`  cost estimate: $${costEstimate.toFixed(4)} (wall minutes × $0.00051/min, unverified — see README)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
