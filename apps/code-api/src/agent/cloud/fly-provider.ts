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

// The runner's HTTP/SSE server (see infra/sandbox-image/runner.mjs) — the
// ONLY public service on the machine. runner.mjs reverse-proxies openvscode
// (127.0.0.1:3000, not published here) through this same port, so a shared
// IPv4 suffices — see allocateSandboxIps.
const RUNNER_PORT = 8080;

export const SANDBOX_APP_PREFIX = 'forkai-sbx-';
// The shared base image's registry app — a permanent fixture, never a sandbox
// instance, so the sweep must never touch it.
const BASE_IMAGE_APP = 'forkai-sbx-base';

// Machine metadata key CloudAgentRunner tags a successful run's sandbox with —
// sandbox-sweep.ts reconciles against this (via listMachines' config.metadata)
// instead of name-prefix+age alone. Exported so both sides use the same key.
export const SANDBOX_EXPIRES_AT_METADATA_KEY = 'forkai_expires_at';

export interface SandboxCreateOpts {
  runId: string;
  image: string;
  // Tried in order; provisionInApp only advances to the next one on an
  // insufficient_capacity error (any other failure fails fast). At least one
  // entry required — the caller (agent.module.ts) falls back to [FLY_REGION]
  // when FLY_REGIONS is unset.
  regions: string[];
  env: Record<string, string>;
}

export interface SandboxHandle {
  sandboxId: string; // "<appName>:<machineId>"
  baseUrl: string; // https origin serving the runner's /__forkai/* control API (port 8080)
  vscodeUrl: string; // baseUrl, proxied to openvscode-server by the runner — includes ?tkn=
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
  created_at?: string;
  config?: { metadata?: Record<string, string> };
}

export interface SandboxMachineInfo {
  id: string;
  createdAt: string;
  // Present only once CloudAgentRunner has tagged a successful run's machine —
  // absent for a crashed run or a machine created before this feature shipped.
  expiresAt?: string;
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
    const res = await this.fetchWithRetry(`${FLY_API_HOSTNAME}${path}`, { ...init, headers: this.headers() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Fly API ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
    }
    return res;
  }

  // One retry for a transient network failure reaching api.machines.dev — a
  // live ETIMEDOUT/fetch-failure blip has twice killed an entire agent run
  // (surfaced to the user as friendlyLlmError's generic network message) when
  // an immediate retry would have succeeded. Deliberately narrow: this only
  // catches fetch() itself rejecting (DNS/connect/socket failure) — an
  // HTTP-status error (422 insufficient_capacity, etc.) means fetch already
  // resolved, so it's thrown by flyFetch's !res.ok check above and never
  // reaches here. createMachineWithRegionFallback's region fallback is
  // unaffected either way.
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (!this.isTransientNetworkError(err)) throw err;
      this.logger.warn(`transient network error calling ${url} — retrying once: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 500));
      return fetch(url, init);
    }
  }

  private isTransientNetworkError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|network/i.test(msg);
  }

  private isNotFound(err: unknown): boolean {
    return err instanceof Error && /→ 404:/.test(err.message);
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

    // Anything after app-create that throws would otherwise leak the app —
    // observed live when machine create 422'd with insufficient_capacity in
    // bom. Best-effort delete the app on the way out; app deletion releases
    // its IPs (shared v4 costs nothing, but the IPv6 allocation and the
    // machine itself still would).
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
    await this.allocateSandboxIps(appName);

    // Sized down-overridable because bom had no shared-2x/4096 capacity on the
    // first live attempt (422 insufficient_capacity, 2026-07-13).
    const cpus = Number(process.env.FLY_GUEST_CPUS ?? 2);
    const memoryMb = Number(process.env.FLY_GUEST_MEMORY_MB ?? 4096);

    // The ONE public service on the machine — runner.mjs reverse-proxies
    // openvscode (127.0.0.1:3000) through this same port, so there is no
    // second service to publish (see infra/sandbox-image/README.md).
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
      ],
    };

    const machine = await this.createMachineWithRegionFallback(appName, opts.regions, config);

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
    const vscodeUrl = `${baseUrl}/?tkn=${opts.env.VSCODE_TOKEN}`;

    // Poll the runner's own healthz through the public edge — this is also
    // the proof that edge routing (app → shared IPv4 → service → machine)
    // actually works, not just that the machine process is up.
    await this.pollHealthz(baseUrl);

    return { sandboxId: `${appName}:${machine.id}`, baseUrl, vscodeUrl };
  }

  // Tries opts.regions in order, advancing only on insufficient_capacity (the
  // 422 the spike hit live in bom for shared-cpu-2x) — any other error fails
  // fast rather than burning through the whole list. IP allocation happens
  // once in the caller, before this loop, since it's app-scoped, not
  // region-scoped.
  private async createMachineWithRegionFallback(appName: string, regions: string[], config: FlyMachineConfig): Promise<FlyMachine> {
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      try {
        const createRes = await this.flyFetch(`/v1/apps/${appName}/machines`, {
          method: 'POST',
          body: JSON.stringify({ region, config }),
        });
        return (await createRes.json()) as FlyMachine;
      } catch (err) {
        const isLastRegion = i === regions.length - 1;
        if (!this.isInsufficientCapacity(err) || isLastRegion) throw err;
        this.logger.warn(`region ${region} insufficient_capacity — falling back to ${regions[i + 1]}`);
      }
    }
    throw new Error('createMachineWithRegionFallback called with an empty regions list');
  }

  private isInsufficientCapacity(err: unknown): boolean {
    return err instanceof Error && /→ 422:/.test(err.message) && /insufficient_capacity/i.test(err.message);
  }

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

  // The Machines REST API has NO IP-allocation endpoint (its resource list is
  // exactly Apps/Machines/Volumes/Secrets/TLS Certificates/Tokens). Allocation
  // lives on Fly's undocumented GraphQL API (api.fly.io/graphql, same
  // `allocateIpAddress` mutation used for both — verified against flyctl's own
  // source, since the shared-v4 shape isn't in the public docs). A shared IPv4
  // now suffices because the machine publishes exactly one service (see
  // provisionInApp) — no flyctl fallback here, see the header comment. IPv6 is
  // allocated alongside it (standard practice, free) so IPv6-only networks can
  // still resolve the app.
  private async allocateSandboxIps(appName: string): Promise<void> {
    await this.allocateIp(appName, 'shared_v4', `allocateIpAddress(input: $input) { app { sharedIpAddress } }`);
    await this.allocateIp(appName, 'v6', `allocateIpAddress(input: $input) { ipAddress { id address type } }`);
  }

  // `type` changes both the GraphQL variable AND which sub-selection is valid
  // on the response (a shared v4 has no per-address IpAddress record — it's
  // exposed as App.sharedIpAddress instead — while v4/v6/private_v6 do), so
  // the response shape is passed in per call rather than shared.
  private async allocateIp(appName: string, type: 'shared_v4' | 'v6', selection: string): Promise<void> {
    const res = await fetch('https://api.fly.io/graphql', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        query: `mutation($input: AllocateIPAddressInput!) { ${selection} }`,
        variables: { input: { appId: appName, type } },
      }),
    });
    const json = (await res.json()) as { errors?: Array<{ message: string }> };
    if (!res.ok || json.errors?.length) {
      throw new Error(
        `GraphQL allocateIpAddress(${type}) failed for ${appName}: ${json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`}`,
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

    // App delete releases its IPs — never skip it.
    await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' });
    this.logger.log(`destroyed sandbox ${sandboxId}`);
  }

  // Sets one machine-metadata key. Used by CloudAgentRunner to tag a
  // successful run's sandbox with its TTL expiry (see
  // SANDBOX_EXPIRES_AT_METADATA_KEY) instead of destroying it.
  async setMetadata(sandboxId: string, key: string, value: string): Promise<void> {
    const [appName, machineId] = sandboxId.split(':');
    if (!appName || !machineId) throw new Error(`Malformed sandboxId: ${sandboxId}`);
    await this.flyFetch(`/v1/apps/${appName}/machines/${machineId}/metadata/${key}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
  }

  // Sandbox app names in this org, excluding the base-image app. Used only by
  // sandbox-sweep.ts — never by the run path.
  async listSandboxApps(): Promise<string[]> {
    const res = await this.flyFetch(`/v1/apps?org_slug=${this.opts.orgSlug}`);
    const json = (await res.json()) as { apps?: Array<{ name: string }> };
    return (json.apps ?? [])
      .map((a) => a.name)
      .filter((name) => name.startsWith(SANDBOX_APP_PREFIX) && name !== BASE_IMAGE_APP);
  }

  // App-level force delete (tears down any machines inside and releases IPs).
  // The sweep only knows app names, not machine ids, hence no per-machine step.
  // Tolerates 404 (already gone) as success — the sweep may run on >1 EB
  // instance, so a second sweeper racing the same expired app is expected,
  // not an error.
  async destroyApp(appName: string): Promise<void> {
    try {
      await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' });
      this.logger.log(`destroyed app ${appName}`);
    } catch (err) {
      if (this.isNotFound(err)) {
        this.logger.log(`app ${appName} already gone (404) — treating as destroyed`);
        return;
      }
      throw err;
    }
  }

  // Per-app machine list, including each machine's TTL expiry metadata (if
  // CloudAgentRunner tagged it) — sandbox-sweep.ts's sole read path. The
  // Machines API embeds config.metadata directly in the list response, so no
  // second per-machine metadata GET is needed. Tolerates 404 (app already
  // destroyed by a racing sweep) by returning no machines, same idempotency
  // reasoning as destroyApp.
  async listMachines(appName: string): Promise<SandboxMachineInfo[]> {
    let res: Response;
    try {
      res = await this.flyFetch(`/v1/apps/${appName}/machines`);
    } catch (err) {
      if (this.isNotFound(err)) return [];
      throw err;
    }
    const machines = (await res.json()) as FlyMachine[];
    return machines.map((m) => ({
      id: m.id,
      createdAt: m.created_at ?? new Date(0).toISOString(),
      expiresAt: m.config?.metadata?.[SANDBOX_EXPIRES_AT_METADATA_KEY],
    }));
  }
}
