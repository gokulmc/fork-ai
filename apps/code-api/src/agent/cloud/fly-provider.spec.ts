import { FlyProvider } from './fly-provider';

// FlyProvider's only external boundary is global fetch — the Machines REST
// API (api.machines.dev), Fly's undocumented GraphQL IP-allocation API
// (api.fly.io/graphql), and the public healthz poll all go through it, so one
// URL/method-routed mock covers all three, same "mock the boundary" approach
// as cloud-agent-runner.spec.ts.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('FlyProvider.create', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let provider: FlyProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new FlyProvider({ apiToken: 'fly-token', orgSlug: 'personal' });
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  // Routes every call a happy-path (or region-fallback) create() makes.
  // `insufficientIn` marks which regions 422 with insufficient_capacity on
  // machine create — every other call always succeeds.
  function mockRoutes(insufficientIn: string[] = []) {
    const insufficient = new Set(insufficientIn);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === 'https://api.machines.dev/v1/apps' && method === 'POST') return jsonResponse(200, {});
      if (url === 'https://api.fly.io/graphql') return jsonResponse(200, { data: { allocateIpAddress: {} } });
      if (/\/v1\/apps\/[^/]+\/machines$/.test(url) && method === 'POST') {
        const { region } = JSON.parse(init!.body as string) as { region: string };
        if (insufficient.has(region)) {
          return jsonResponse(422, { error: 'insufficient_capacity: no shared-cpu-2x capacity in region' });
        }
        return jsonResponse(200, { id: 'machine1', state: 'created' });
      }
      if (url.includes('/wait?state=started')) return jsonResponse(200, { ok: true });
      if (url.endsWith('/__forkai/healthz')) return jsonResponse(200, { ok: true });
      if (method === 'DELETE') return jsonResponse(200, {});
      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    });
  }

  it('allocates a shared IPv4 + IPv6 (no dedicated v4) and returns a portless vscodeUrl proxied through baseUrl', async () => {
    mockRoutes();

    const handle = await provider.create({ runId: 'run01', image: 'img', regions: ['sin'], env: { VSCODE_TOKEN: 'vtok' } });

    const ipCalls = fetchMock.mock.calls.filter(([url]) => url === 'https://api.fly.io/graphql');
    expect(ipCalls).toHaveLength(2);
    const types = ipCalls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { variables: { input: { type: string } } }).variables.input.type);
    expect(types.sort()).toEqual(['shared_v4', 'v6']);

    expect(handle.baseUrl).toBe('https://forkai-sbx-run01.fly.dev');
    expect(handle.vscodeUrl).toBe('https://forkai-sbx-run01.fly.dev/?tkn=vtok');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/__forkai/healthz'))).toBe(true);
  });

  it('creates the machine with exactly one service (8080 → 80/443), never a second vscode service', async () => {
    mockRoutes();

    await provider.create({ runId: 'run02', image: 'img', regions: ['sin'], env: {} });

    const [, machineInit] = fetchMock.mock.calls.find(
      ([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST',
    )!;
    const body = JSON.parse((machineInit as RequestInit).body as string) as { config: { services: unknown[] } };
    expect(body.config.services).toEqual([
      { protocol: 'tcp', internal_port: 8080, ports: [{ port: 80, handlers: ['http'] }, { port: 443, handlers: ['tls', 'http'] }], autostart: true, autostop: false },
    ]);
  });

  // ── ADR-0004 billing identity ───────────────────────────────────────────

  it('bakes sub/sessionId/nodeId into the machine config.metadata AT CREATE (atomic, no extra POST)', async () => {
    mockRoutes();

    await provider.create({ runId: 'run08', image: 'img', regions: ['sin'], env: {}, sub: 'user-1', sessionId: 'sess-1', nodeId: 'node-1' });

    const [, machineInit] = fetchMock.mock.calls.find(
      ([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST',
    )!;
    const body = JSON.parse((machineInit as RequestInit).body as string) as { config: { metadata?: Record<string, string> } };
    expect(body.config.metadata).toEqual({ forkai_sub: 'user-1', forkai_session_id: 'sess-1', forkai_node_id: 'node-1' });
    // No separate metadata-setting call — identity travels in the create body itself.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/metadata/'))).toBe(false);
  });

  it('omits config.metadata entirely when no billing identity is supplied', async () => {
    mockRoutes();

    await provider.create({ runId: 'run09', image: 'img', regions: ['sin'], env: {} });

    const [, machineInit] = fetchMock.mock.calls.find(
      ([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST',
    )!;
    const body = JSON.parse((machineInit as RequestInit).body as string) as { config: { metadata?: Record<string, string> } };
    expect(body.config.metadata).toBeUndefined();
  });

  it("returns the Fly machine-create response's created_at on the handle", async () => {
    const createdAt = '2026-07-13T09:00:00.000Z';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === 'https://api.machines.dev/v1/apps' && method === 'POST') return jsonResponse(200, {});
      if (url === 'https://api.fly.io/graphql') return jsonResponse(200, { data: { allocateIpAddress: {} } });
      if (/\/v1\/apps\/[^/]+\/machines$/.test(url) && method === 'POST') return jsonResponse(200, { id: 'machine1', state: 'created', created_at: createdAt });
      if (url.includes('/wait?state=started')) return jsonResponse(200, { ok: true });
      if (url.endsWith('/__forkai/healthz')) return jsonResponse(200, { ok: true });
      if (method === 'DELETE') return jsonResponse(200, {});
      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    });

    const handle = await provider.create({ runId: 'run10', image: 'img', regions: ['sin'], env: {} });

    expect(handle.createdAt).toBe(createdAt);
  });

  it('falls back to the current time when the machine-create response omits created_at', async () => {
    mockRoutes(); // the shared route's machine response has no created_at
    const before = Date.now();

    const handle = await provider.create({ runId: 'run11', image: 'img', regions: ['sin'], env: {} });

    expect(new Date(handle.createdAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('falls back to the next region on insufficient_capacity, without re-allocating IPs', async () => {
    mockRoutes(['sin']);

    await provider.create({ runId: 'run03', image: 'img', regions: ['sin', 'bom'], env: {} });

    const machineCalls = fetchMock.mock.calls.filter(([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST');
    expect(machineCalls).toHaveLength(2);
    expect((JSON.parse((machineCalls[0][1] as RequestInit).body as string) as { region: string }).region).toBe('sin');
    expect((JSON.parse((machineCalls[1][1] as RequestInit).body as string) as { region: string }).region).toBe('bom');

    const ipCalls = fetchMock.mock.calls.filter(([url]) => url === 'https://api.fly.io/graphql');
    expect(ipCalls).toHaveLength(2); // once total, not once per region attempt
  });

  it('does not retry a non-capacity error, and still cleans up the app', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === 'https://api.machines.dev/v1/apps' && method === 'POST') return jsonResponse(200, {});
      if (url === 'https://api.fly.io/graphql') return jsonResponse(200, { data: {} });
      if (/\/machines$/.test(url) && method === 'POST') return jsonResponse(500, { error: 'internal server error' });
      if (method === 'DELETE') return jsonResponse(200, {});
      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    });

    await expect(provider.create({ runId: 'run04', image: 'img', regions: ['sin', 'bom'], env: {} })).rejects.toThrow();

    const machineCalls = fetchMock.mock.calls.filter(([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST');
    expect(machineCalls).toHaveLength(1); // no fallback for a non-capacity error

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE')).toBe(true);
  });

  it('throws once every region is exhausted on insufficient_capacity, and cleans up the app', async () => {
    mockRoutes(['sin', 'bom']);

    await expect(provider.create({ runId: 'run05', image: 'img', regions: ['sin', 'bom'], env: {} })).rejects.toThrow(/insufficient_capacity/);

    const machineCalls = fetchMock.mock.calls.filter(([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST');
    expect(machineCalls).toHaveLength(2);

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE')).toBe(true);
  });

  it('retries once on a transient network error (fetch rejection) and succeeds', async () => {
    let appCreateCalls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === 'https://api.machines.dev/v1/apps' && method === 'POST') {
        appCreateCalls++;
        if (appCreateCalls === 1) throw new Error('fetch failed: ETIMEDOUT');
        return jsonResponse(200, {});
      }
      if (url === 'https://api.fly.io/graphql') return jsonResponse(200, { data: { allocateIpAddress: {} } });
      if (/\/v1\/apps\/[^/]+\/machines$/.test(url) && method === 'POST') return jsonResponse(200, { id: 'machine1', state: 'created' });
      if (url.includes('/wait?state=started')) return jsonResponse(200, { ok: true });
      if (url.endsWith('/__forkai/healthz')) return jsonResponse(200, { ok: true });
      if (method === 'DELETE') return jsonResponse(200, {});
      throw new Error(`unexpected fetch in test: ${method} ${url}`);
    });

    const handle = await provider.create({ runId: 'run06', image: 'img', regions: ['sin'], env: { VSCODE_TOKEN: 'vtok' } });

    expect(handle.baseUrl).toBe('https://forkai-sbx-run06.fly.dev');
    expect(appCreateCalls).toBe(2); // one transient rejection, one retry
  });

  it('does not retry an HTTP-status error (422 insufficient_capacity) via the network-retry path — only region fallback governs it', async () => {
    mockRoutes(['sin']); // the only region, so no fallback is available either

    await expect(provider.create({ runId: 'run07', image: 'img', regions: ['sin'], env: {} })).rejects.toThrow(/insufficient_capacity/);

    const machineCalls = fetchMock.mock.calls.filter(([url, init]) => /\/machines$/.test(String(url)) && (init as RequestInit)?.method === 'POST');
    expect(machineCalls).toHaveLength(1); // fetch resolved (422), so fetchWithRetry's catch never fires
  });
});

describe('FlyProvider.listMachines', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let provider: FlyProvider;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new FlyProvider({ apiToken: 'fly-token', orgSlug: 'personal' });
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it('maps expiry AND billing identity out of config.metadata', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, [
        {
          id: 'machine1',
          state: 'started',
          created_at: '2026-07-13T09:00:00.000Z',
          config: { metadata: { forkai_expires_at: '2026-07-13T09:30:00.000Z', forkai_sub: 'user-1', forkai_session_id: 'sess-1', forkai_node_id: 'node-1' } },
        },
        // A pre-feature / crashed-before-tag machine — no identity metadata at all.
        { id: 'machine2', state: 'started', created_at: '2026-07-13T09:05:00.000Z', config: { metadata: {} } },
      ]),
    );

    const machines = await provider.listMachines('forkai-sbx-run01');

    expect(machines).toEqual([
      { id: 'machine1', createdAt: '2026-07-13T09:00:00.000Z', expiresAt: '2026-07-13T09:30:00.000Z', sub: 'user-1', sessionId: 'sess-1', nodeId: 'node-1' },
      { id: 'machine2', createdAt: '2026-07-13T09:05:00.000Z', expiresAt: undefined, sub: undefined, sessionId: undefined, nodeId: undefined },
    ]);
  });

  // Money-correctness fix I3: a missing created_at previously fell back to
  // the epoch (1970), which billMachineUsage would turn into ~1.7 BILLION
  // seconds of machine time. Falling back to "now" instead yields ~0
  // billable seconds — matching the FlyProvider.create fallback's intent.
  it('falls back to ~now (not the epoch) when a listed machine has no created_at', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, [{ id: 'machine1', state: 'started', config: { metadata: {} } }]),
    );
    const before = Date.now();

    const machines = await provider.listMachines('forkai-sbx-broken');

    expect(machines).toHaveLength(1);
    const createdAtMs = new Date(machines[0].createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(before);
    // Sanity check against the actual regression: epoch-0 would be ~1.7e12 ms behind "now".
    expect(Date.now() - createdAtMs).toBeLessThan(5000);
  });
});
