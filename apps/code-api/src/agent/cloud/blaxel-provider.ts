import { Logger } from '@nestjs/common';
import { SandboxInstance } from '@blaxel/core';
import {
  SANDBOX_APP_PREFIX,
  SANDBOX_EXPIRES_AT_METADATA_KEY,
  SANDBOX_ACTIVE_UNTIL_METADATA_KEY,
  SANDBOX_SUB_METADATA_KEY,
  SANDBOX_SESSION_METADATA_KEY,
  SANDBOX_NODE_METADATA_KEY,
  type SandboxCreateOpts,
  type SandboxHandle,
  type SandboxMachineInfo,
} from './fly-provider';

// Blaxel counterpart of FlyProvider — same structural contract (the callers in
// cloud-agent-runner.ts and sandbox-sweep.ts depend on Pick<>s of it), so a
// Blaxel run reuses the entire CloudAgentRunner loop and the generic sweep with
// no changes on their side. Unlike Fly's raw-fetch approach, Blaxel exposes a
// typed TS SDK (@blaxel/core) that owns previews/metadata/listing, so this uses
// it directly (the sanctioned interface) rather than hand-rolling REST.
//
// The sandbox runs the SAME infra/sandbox-image runner.mjs control server on
// port 8080; we reach it through a PUBLIC Blaxel preview URL (the analog of
// Fly's public <app>.fly.dev), still bearer-authed by the per-run RUN_TOKEN in
// the /__forkai/run body — the preview being public only exposes the same
// surface Fly's public edge already did.

// Matches infra/sandbox-image/runner.mjs — the one public port (openvscode is
// reverse-proxied through it, see fly-provider.ts's RUNNER_PORT note).
const RUNNER_PORT = 8080;
// Fixed preview name per sandbox — one sandbox serves exactly one preview.
const PREVIEW_NAME = 'forkai';

// Blaxel sandbox names: lowercase alphanumeric + hyphens, ≤49 chars (SDK docs).
// A ULID runId lowercased + the 'forkai-sbx-' prefix (37 chars) fits.
function sandboxName(runId: string): string {
  return `${SANDBOX_APP_PREFIX}${runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 49);
}

export class BlaxelProvider {
  private readonly logger = new Logger(BlaxelProvider.name);
  private readonly region?: string;
  private readonly memoryMb: number;

  constructor(opts: { apiToken: string; workspace: string; region?: string; memoryMb?: number }) {
    // The @blaxel/core SDK authenticates purely off BL_API_KEY / BL_WORKSPACE in
    // the environment (common/settings.ts). Map our BLAXEL_* config onto them
    // here at construction (boot) so the deployment only has to set BLAXEL_*.
    if (!process.env.BL_API_KEY) process.env.BL_API_KEY = opts.apiToken;
    if (!process.env.BL_WORKSPACE) process.env.BL_WORKSPACE = opts.workspace;
    this.region = opts.region || undefined;
    this.memoryMb = opts.memoryMb ?? 4096;
  }

  async create(opts: SandboxCreateOpts): Promise<SandboxHandle> {
    const name = sandboxName(opts.runId);

    // Identity metadata baked in at create (ADR-0004) — see the fly-provider
    // SANDBOX_*_METADATA_KEY comment. On Blaxel these live in metadata.labels.
    const labels: Record<string, string> = {};
    if (opts.sub) labels[SANDBOX_SUB_METADATA_KEY] = opts.sub;
    if (opts.sessionId) labels[SANDBOX_SESSION_METADATA_KEY] = opts.sessionId;
    if (opts.nodeId) labels[SANDBOX_NODE_METADATA_KEY] = opts.nodeId;

    opts.onPhase?.('Provisioning sandbox…');
    let sandbox: SandboxInstance;
    try {
      sandbox = await SandboxInstance.createIfNotExists({
        name,
        image: opts.image,
        memory: this.memoryMb,
        ports: [{ target: RUNNER_PORT, protocol: 'HTTP' }],
        envs: Object.entries(opts.env).map(([k, value]) => ({ name: k, value })),
        ...(this.region ? { region: this.region } : {}),
        ...(Object.keys(labels).length ? { labels } : {}),
      });

      opts.onPhase?.('Booting sandbox…');
      await sandbox.wait({ maxWait: 120_000, interval: 2_000 });

      opts.onPhase?.('Creating preview…');
      const preview = await sandbox.previews.createIfNotExists({
        metadata: { name: PREVIEW_NAME },
        spec: { port: RUNNER_PORT, public: true },
      });
      const baseUrl = preview.spec.url;
      if (!baseUrl) throw new Error(`Blaxel preview for ${name} returned no URL`);
      const vscodeUrl = `${baseUrl}/?tkn=${opts.env.VSCODE_TOKEN}`;

      opts.onPhase?.('Starting agent…');
      await this.pollHealthz(baseUrl);

      return {
        sandboxId: `${name}:${name}`,
        baseUrl,
        vscodeUrl,
        createdAt: sandbox.metadata.createdAt ?? new Date().toISOString(),
      };
    } catch (err) {
      // Mirror FlyProvider.create's leak cleanup: anything after the sandbox
      // exists that throws would otherwise leave it billing — best-effort delete.
      this.logger.error(`create failed for ${name} — deleting sandbox to release resources: ${String(err)}`);
      await SandboxInstance.delete(name).catch((e) =>
        this.logger.error(`leak-cleanup delete ALSO failed for ${name}, delete manually: ${String(e)}`),
      );
      throw err;
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    const name = sandboxId.split(':')[0];
    if (!name) throw new Error(`Malformed sandboxId: ${sandboxId}`);
    await SandboxInstance.delete(name);
    this.logger.log(`destroyed sandbox ${sandboxId}`);
  }

  // Merge one label into the sandbox's existing labels (updateMetadata replaces
  // the label set, so read-merge-write to preserve the identity labels set at
  // create). Used by CloudAgentRunner to tag TTL expiry + the active-until
  // billing boundary on a successful run.
  async setMetadata(sandboxId: string, key: string, value: string): Promise<void> {
    const name = sandboxId.split(':')[0];
    if (!name) throw new Error(`Malformed sandboxId: ${sandboxId}`);
    const current = await SandboxInstance.get(name);
    const labels = { ...(current.metadata.labels ?? {}), [key]: value };
    await SandboxInstance.updateMetadata(name, { labels });
  }

  // Every forkai-sbx-* sandbox in the workspace — the sweep's sole enumeration.
  async listSandboxApps(): Promise<string[]> {
    const page = await SandboxInstance.list({ limit: 100 });
    const all = await page.autoPagingToArray({ limit: 1000 });
    return all.map((sb) => sb.metadata.name).filter((n): n is string => !!n && n.startsWith(SANDBOX_APP_PREFIX));
  }

  async destroyApp(appName: string): Promise<void> {
    try {
      await SandboxInstance.delete(appName);
      this.logger.log(`destroyed sandbox ${appName}`);
    } catch (err) {
      if (this.isNotFound(err)) {
        this.logger.log(`sandbox ${appName} already gone — treating as destroyed`);
        return;
      }
      throw err;
    }
  }

  // One "machine" per Blaxel sandbox (flat model, no Fly app/machine split) —
  // reads the identity + expiry/active-until labels back for the sweep. id ===
  // the sandbox name so the sweep's `${appName}:${m.id}` matches create()'s
  // `${name}:${name}` sandboxId exactly (the MACHINEBILL# idempotency key).
  async listMachines(appName: string): Promise<SandboxMachineInfo[]> {
    let sb: SandboxInstance;
    try {
      sb = await SandboxInstance.get(appName);
    } catch (err) {
      if (this.isNotFound(err)) return [];
      throw err;
    }
    const labels = sb.metadata.labels ?? {};
    return [
      {
        id: appName,
        createdAt: sb.metadata.createdAt ?? new Date().toISOString(),
        expiresAt: labels[SANDBOX_EXPIRES_AT_METADATA_KEY],
        activeUntil: labels[SANDBOX_ACTIVE_UNTIL_METADATA_KEY],
        sub: labels[SANDBOX_SUB_METADATA_KEY],
        sessionId: labels[SANDBOX_SESSION_METADATA_KEY],
        nodeId: labels[SANDBOX_NODE_METADATA_KEY],
      },
    ];
  }

  private isNotFound(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /404|not found/i.test(msg);
  }

  // Same public-edge healthz probe as FlyProvider.pollHealthz — proves the
  // preview routing (edge → sandbox → runner) works, not just that the process
  // booted.
  private async pollHealthz(baseUrl: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/__forkai/healthz`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return;
        lastErr = new Error(`healthz → ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`/__forkai/healthz never became reachable at ${baseUrl}: ${String(lastErr)}`);
  }
}
