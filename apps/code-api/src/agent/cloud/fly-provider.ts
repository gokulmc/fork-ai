import { Logger } from '@nestjs/common';

// Ported from tools/spikes/cloud-sandbox/src/fly-provider.ts (the live-verified
// spike), adapted for the API server: Nest Logger instead of console, and the
// spike's flyctl CLI fallback for IP allocation is REMOVED — the API server's
// Docker image has no `fly` binary or flyctl auth, and shelling out to an
// external CLI from request-handling code is an operational footgun (PATH
// dependency, interactive-auth prompts) acceptable only in a throwaway local
// spike. If the GraphQL mutation fails, we throw; create()'s cleanup deletes
// the app so nothing leaks.

// Public Machines API base — see https://docs.machines.dev/. The internal base
// (http://_api.internal:4280) is only reachable from inside another Fly app on
// the same org's 6PN network, so this provider always uses the public host.
const FLY_API_HOSTNAME = 'https://api.machines.dev';

// The runner's HTTP/SSE server (see tools/spikes/cloud-sandbox/image/runner.mjs).
const RUNNER_PORT = 8080;
// openvscode-server.
const VSCODE_PORT = 3000;
// External port the vscode service is published on. Fly's shared IPv4 only
// routes ports 80/443 to a single service — an app with a SECOND public
// service needs a dedicated IPv4 (confirmed live in the spike), so this
// provider always allocates a dedicated v4 — see allocateDedicatedIpv4.
const VSCODE_EXTERNAL_PORT = 10300;

export const SANDBOX_APP_PREFIX = 'forkai-sbx-';
// The shared base image's registry app — a permanent fixture, never a sandbox
// instance, so the sweep must never touch it.
const BASE_IMAGE_APP = 'forkai-sbx-base';

export interface SandboxCreateOpts {
  runId: string;
  image: string;
  region: string;
  env: Record<string, string>;
}

export interface SandboxHandle {
  sandboxId: string; // "<appName>:<machineId>"
  baseUrl: string; // https origin serving the runner's /healthz and /run (port 8080)
  vscodeUrl: string; // https origin serving openvscode-server (external 10300), includes ?tkn=
}

interface FlyMachineConfig {
  image: string;
  env: Record<string, string>;
  guest: { cpu_kind: 'shared'; cpus: number; memory_mb: number };
  services: Array<{
    protocol: 'tcp';
    internal_port: number;
    ports: Array<{ port: number; handlers: string[] }>;
    autostart?: boolean;
    autostop?: boolean;
  }>;
}

interface FlyMachine {
  id: string;
  state: string;
}

export class FlyProvider {
  private readonly logger = new Logger(FlyProvider.name);

  constructor(private readonly opts: { apiToken: string; orgSlug: string }) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async flyFetch(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${FLY_API_HOSTNAME}${path}`, { ...init, headers: this.headers() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Fly API ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
    }
    return res;
  }

  async create(opts: SandboxCreateOpts): Promise<SandboxHandle> {
    // Fly app names must be ≤63 chars of lowercase letters/numbers/dashes
    // ("Validation failed: Name under 63 chars using numbers, lowercase
    // letters and dashes" otherwise). runId is a ULID — uppercase Crockford
    // base32 — so lowercase it; a lowercased ULID is still unique.
    const appName = `${SANDBOX_APP_PREFIX}${opts.runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 63);

    await this.flyFetch('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ app_name: appName, org_slug: this.opts.orgSlug }),
    });

    // Anything after app-create that throws would otherwise leak the app AND
    // its dedicated IPv4 (which bills prorated) — observed live when machine
    // create 422'd with insufficient_capacity in bom. Best-effort delete the
    // app on the way out; app deletion releases its IPs.
    try {
      return await this.provisionInApp(appName, opts);
    } catch (err) {
      this.logger.error(`create failed after app create — deleting app ${appName} to release resources`);
      await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' }).catch((e) =>
        this.logger.error(`leak-cleanup app delete ALSO failed, delete manually: ${String(e)}`),
      );
      throw err;
    }
  }

  private async provisionInApp(appName: string, opts: SandboxCreateOpts): Promise<SandboxHandle> {
    await this.allocateDedicatedIpv4(appName);

    // Sized down-overridable because bom had no shared-2x/4096 capacity on the
    // first live attempt (422 insufficient_capacity, 2026-07-13).
    const cpus = Number(process.env.FLY_GUEST_CPUS ?? 2);
    const memoryMb = Number(process.env.FLY_GUEST_MEMORY_MB ?? 4096);

    // Both public services live on the one machine; 8080 is the runner's
    // SSE/health API, 3000 is openvscode-server.
    const config: FlyMachineConfig = {
      image: opts.image,
      env: opts.env,
      guest: { cpu_kind: 'shared', cpus, memory_mb: memoryMb },
      services: [
        {
          protocol: 'tcp',
          internal_port: RUNNER_PORT,
          ports: [
            { port: 80, handlers: ['http'] },
            { port: 443, handlers: ['tls', 'http'] },
          ],
          autostart: true,
          autostop: false,
        },
        {
          protocol: 'tcp',
          internal_port: VSCODE_PORT,
          ports: [{ port: VSCODE_EXTERNAL_PORT, handlers: ['tls', 'http'] }],
          autostart: true,
          autostop: false,
        },
      ],
    };

    const createRes = await this.flyFetch(`/v1/apps/${appName}/machines`, {
      method: 'POST',
      body: JSON.stringify({ region: opts.region, config }),
    });
    const machine = (await createRes.json()) as FlyMachine;

    // Machine create auto-launches; /wait is the documented way to block until
    // it's actually up. The image is ~900MB, so a cold pull can exceed one 60s
    // wait window — retry the wait a few times before giving up.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.flyFetch(`/v1/apps/${appName}/machines/${machine.id}/wait?state=started&timeout=60`);
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        this.logger.log(`machine not started yet (attempt ${attempt}/5, likely image pull) — retrying wait`);
      }
    }

    const baseUrl = `https://${appName}.fly.dev`;
    const vscodeUrl = `https://${appName}.fly.dev:${VSCODE_EXTERNAL_PORT}/?tkn=${opts.env.VSCODE_TOKEN}`;

    // Poll /healthz through the public edge — this is also the proof that edge
    // routing (app → dedicated IPv4 → service → machine) actually works, not
    // just that the machine process is up.
    await this.pollHealthz(baseUrl);

    return { sandboxId: `${appName}:${machine.id}`, baseUrl, vscodeUrl };
  }

  private async pollHealthz(baseUrl: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return;
        lastErr = new Error(`healthz → ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`/healthz never became reachable at ${baseUrl}: ${String(lastErr)}`);
  }

  // The Machines REST API has NO IP-allocation endpoint (its resource list is
  // exactly Apps/Machines/Volumes/Secrets/TLS Certificates/Tokens). Allocation
  // lives on Fly's undocumented GraphQL API (api.fly.io/graphql,
  // `allocateIpAddress` mutation — same bearer token; verified WORKING live in
  // the spike on 2026-07-13). No flyctl fallback here — see the header comment.
  private async allocateDedicatedIpv4(appName: string): Promise<void> {
    const query = `mutation($input: AllocateIPAddressInput!) {
      allocateIpAddress(input: $input) {
        ipAddress { id address type }
      }
    }`;
    const res = await fetch('https://api.fly.io/graphql', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query, variables: { input: { appId: appName, type: 'v4' } } }),
    });
    const json = (await res.json()) as { errors?: Array<{ message: string }> };
    if (!res.ok || json.errors?.length) {
      throw new Error(
        `GraphQL allocateIpAddress failed for ${appName}: ${json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`}`,
      );
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    const [appName, machineId] = sandboxId.split(':');
    if (!appName || !machineId) throw new Error(`Malformed sandboxId: ${sandboxId}`);

    try {
      await this.flyFetch(`/v1/apps/${appName}/machines/${machineId}?force=true`, { method: 'DELETE' });
    } catch (err) {
      this.logger.error(`machine destroy failed (continuing to app delete): ${String(err)}`);
    }

    // App delete releases the dedicated IPv4 — never skip it.
    await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' });
    this.logger.log(`destroyed sandbox ${sandboxId}`);
  }

  // Sandbox app names in this org, excluding the base-image app. Used only by
  // sweepOrphanSandboxes (cloud-agent-runner.ts) — never by the run path.
  async listSandboxApps(): Promise<string[]> {
    const res = await this.flyFetch(`/v1/apps?org_slug=${this.opts.orgSlug}`);
    const json = (await res.json()) as { apps?: Array<{ name: string }> };
    return (json.apps ?? [])
      .map((a) => a.name)
      .filter((name) => name.startsWith(SANDBOX_APP_PREFIX) && name !== BASE_IMAGE_APP);
  }

  // App-level force delete (tears down any machines inside and releases IPs).
  // The sweep only knows app names, not machine ids, hence no per-machine step.
  async destroyApp(appName: string): Promise<void> {
    await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' });
    this.logger.log(`destroyed app ${appName}`);
  }
}
