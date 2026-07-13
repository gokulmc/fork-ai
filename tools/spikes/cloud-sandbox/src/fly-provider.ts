import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SandboxCreateOpts, SandboxHandle, SandboxProvider } from './provider.js';

const execFileAsync = promisify(execFile);

// Public Machines API base — see https://docs.machines.dev/ (verified via
// WebFetch during this spike). The internal base (http://_api.internal:4280)
// is only reachable from inside another Fly app on the same org's 6PN network,
// not from a laptop, so this spike always uses the public host.
const FLY_API_HOSTNAME = 'https://api.machines.dev';

// The runner's HTTP/SSE server (see image/runner.mjs).
const RUNNER_PORT = 8080;
// openvscode-server.
const VSCODE_PORT = 3000;
// External port the vscode service is published on. Fly's shared IPv4 only
// routes ports 80/443 to a single service — an app with a SECOND public
// service (any other internal port) needs a dedicated IPv4, confirmed via
// https://community.fly.io/t/allocating-ipv4-address/12956 and the Fly docs'
// "Public Network Services" page: "An app with multiple services needs a
// dedicated global IPv4 address; a shared one won't work with multiple
// services." So this provider always allocates a dedicated (non-shared) v4
// for the sandbox app — see allocateDedicatedIpv4 below. Documented further
// in the README's "Port-mapping + IP-allocation notes" section.
const VSCODE_EXTERNAL_PORT = 10300;

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

export class FlyProvider implements SandboxProvider {
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
    const appName = `forkai-sbx-${opts.runId}`;

    // 1. Create the app.
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
      console.error(`[fly] create failed after app create — deleting app ${appName} to release resources`);
      await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' }).catch((e) =>
        console.error(`[fly] leak-cleanup app delete ALSO failed, delete manually: ${String(e)}`),
      );
      throw err;
    }
  }

  private async provisionInApp(appName: string, opts: SandboxCreateOpts): Promise<SandboxHandle> {
    // 2. Allocate a dedicated IPv4 (see VSCODE_EXTERNAL_PORT comment above for
    // why shared won't do — two public services on one app).
    await this.allocateDedicatedIpv4(appName);

    // Sized down-overridable because bom had no shared-2x/4096 capacity on the
    // first live attempt (422 insufficient_capacity).
    const cpus = Number(process.env.FLY_GUEST_CPUS ?? 2);
    const memoryMb = Number(process.env.FLY_GUEST_MEMORY_MB ?? 4096);

    // 3. Create the machine. Both public services live on the one machine;
    // 8080 is the runner's SSE/health API, 3000 is openvscode-server.
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

    // 4. Wait for the machine to report started (machine create auto-launches
    // unless skip_launch is set, but the /wait endpoint is the documented way
    // to block until it's actually up rather than racing the healthz poll).
    // The image is ~900MB, so a cold pull can exceed one 60s wait window —
    // retry the wait a few times before giving up.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.flyFetch(`/v1/apps/${appName}/machines/${machine.id}/wait?state=started&timeout=60`);
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        console.log(`[fly] machine not started yet (attempt ${attempt}/5, likely image pull) — retrying wait`);
      }
    }

    const baseUrl = `https://${appName}.fly.dev`;
    const vscodeUrl = `https://${appName}.fly.dev:${VSCODE_EXTERNAL_PORT}/?tkn=${opts.env.VSCODE_TOKEN}`;

    // 5. Poll /healthz through the public edge — this is also the proof that
    // edge routing (app → dedicated IPv4 → service → machine) actually works,
    // not just that the machine process is up.
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

  // The Machines REST API (api.machines.dev) has NO documented IP-allocation
  // endpoint — confirmed against https://docs.machines.dev/ during this spike:
  // it only lists Apps, Machines, Volumes, Secrets, TLS Certificates, Tokens.
  // IP allocation lives on Fly's undocumented GraphQL API (api.fly.io/graphql,
  // `allocateIpAddress` mutation — see
  // https://community.fly.io/t/does-graphql-allocateipaddress-create-a-shared-or-dedicated-ipv4-address/24050)
  // or in flyctl. This spike tries the GraphQL mutation first (same bearer
  // token works there) and falls back to shelling out to the `fly` CLI, since
  // the GraphQL surface is unofficial and could change shape without notice.
  private async allocateDedicatedIpv4(appName: string): Promise<void> {
    const query = `mutation($input: AllocateIPAddressInput!) {
      allocateIpAddress(input: $input) {
        ipAddress { id address type }
      }
    }`;
    try {
      const res = await fetch('https://api.fly.io/graphql', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ query, variables: { input: { appId: appName, type: 'v4' } } }),
      });
      const json = (await res.json()) as { errors?: Array<{ message: string }> };
      if (!res.ok || json.errors?.length) {
        throw new Error(json.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`);
      }
      console.log('[fly] dedicated IPv4 allocated via GraphQL allocateIpAddress');
      return;
    } catch (graphqlErr) {
      // Fall back to flyctl.
      try {
        await execFileAsync('fly', ['ips', 'allocate-v4', '-a', appName]);
        console.log(`[fly] dedicated IPv4 allocated via flyctl fallback (GraphQL failed: ${String(graphqlErr)})`);
        return;
      } catch (cliErr) {
        throw new Error(
          `Could not allocate a dedicated IPv4 for ${appName}. GraphQL mutation failed (${String(
            graphqlErr,
          )}) and the \`fly\` CLI fallback also failed (${String(
            cliErr,
          )}). Install flyctl (https://fly.io/docs/flyctl/install/) and run ` +
            `\`fly ips allocate-v4 -a ${appName}\` manually, then re-run with an existing app.`,
        );
      }
    }
  }

  async destroy(sandboxId: string): Promise<void> {
    const [appName, machineId] = sandboxId.split(':');
    if (!appName || !machineId) throw new Error(`Malformed sandboxId: ${sandboxId}`);

    try {
      await this.flyFetch(`/v1/apps/${appName}/machines/${machineId}?force=true`, { method: 'DELETE' });
      console.log(`[fly] destroyed machine ${machineId}`);
    } catch (err) {
      console.error(`[fly] machine destroy failed (continuing to app delete): ${String(err)}`);
    }

    await this.flyFetch(`/v1/apps/${appName}?force=true`, { method: 'DELETE' });
    console.log(`[fly] deleted app ${appName}`);
  }
}
