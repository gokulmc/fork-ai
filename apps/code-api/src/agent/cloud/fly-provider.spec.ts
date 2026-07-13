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
});
