import { sweepSandboxes, startSandboxSweep, type MachineBiller } from './sandbox-sweep';
import type { SandboxMachineInfo } from './fly-provider';

// The sweep's two boundaries are mocked exactly like cloud-agent-runner.spec's
// provider mock — no real Fly calls.

function mkLog() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function machine(overrides: Partial<SandboxMachineInfo> = {}): SandboxMachineInfo {
  return { id: 'machine1', createdAt: new Date().toISOString(), ...overrides };
}

function mkBiller(): { billMachineUsage: jest.Mock; reconcileStaleHolds: jest.Mock } & MachineBiller {
  return {
    billMachineUsage: jest.fn().mockResolvedValue(undefined),
    reconcileStaleHolds: jest.fn().mockResolvedValue(undefined),
  };
}

describe('sweepSandboxes', () => {
  it('destroys an app past its expiry metadata, keeps one whose expiry is still ahead', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-expired', 'forkai-sbx-live']),
      listMachines: jest.fn(async (appName: string) =>
        appName === 'forkai-sbx-expired'
          ? [machine({ expiresAt: new Date(Date.now() - 60_000).toISOString() })]
          : [machine({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })],
      ),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };

    const result = await sweepSandboxes(provider, mkLog());

    expect(result.destroyed).toEqual(['forkai-sbx-expired']);
    expect(result.kept).toEqual(['forkai-sbx-live']);
    expect(provider.destroyApp).toHaveBeenCalledTimes(1);
    expect(provider.destroyApp).toHaveBeenCalledWith('forkai-sbx-expired');
  });

  it('keeps a no-metadata machine younger than the crashed-run hard cap, destroys one older than it', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-young', 'forkai-sbx-old']),
      listMachines: jest.fn(async (appName: string) =>
        appName === 'forkai-sbx-young'
          ? [machine({ createdAt: new Date(Date.now() - 5 * 60_000).toISOString() })] // 5 min old, no expiresAt
          : [machine({ createdAt: new Date(Date.now() - 45 * 60_000).toISOString() })], // 45 min old, no expiresAt — past the 30-min cap
      ),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };

    const result = await sweepSandboxes(provider, mkLog());

    expect(result.kept).toEqual(['forkai-sbx-young']);
    expect(result.destroyed).toEqual(['forkai-sbx-old']);
  });

  it('never lists or destroys forkai-sbx-base — trusts listSandboxApps to have already excluded it', async () => {
    const provider = {
      // Real FlyProvider.listSandboxApps() filters forkai-sbx-base out itself;
      // this simulates that contract already being honoured.
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-real']),
      listMachines: jest.fn().mockResolvedValue([machine({ expiresAt: new Date(Date.now() - 1000).toISOString() })]),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };

    await sweepSandboxes(provider, mkLog());

    expect(provider.listMachines).not.toHaveBeenCalledWith('forkai-sbx-base');
    expect(provider.destroyApp).not.toHaveBeenCalledWith('forkai-sbx-base');
  });

  it('leaves an app with no machines left for the next tick instead of guessing', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-empty']),
      listMachines: jest.fn().mockResolvedValue([]),
      destroyApp: jest.fn(),
    };

    const result = await sweepSandboxes(provider, mkLog());

    expect(result.kept).toEqual(['forkai-sbx-empty']);
    expect(provider.destroyApp).not.toHaveBeenCalled();
  });

  it('records a failed destroy without throwing, so one bad app does not block the rest of the sweep', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-a', 'forkai-sbx-b']),
      listMachines: jest.fn().mockResolvedValue([machine({ expiresAt: new Date(Date.now() - 1000).toISOString() })]),
      destroyApp: jest.fn(async (appName: string) => {
        if (appName === 'forkai-sbx-a') throw new Error('boom');
      }),
    };

    const result = await sweepSandboxes(provider, mkLog());

    expect(result.failed).toEqual(['forkai-sbx-a']);
    expect(result.destroyed).toEqual(['forkai-sbx-b']);
  });

  it('records a failed listMachines without throwing', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-broken']),
      listMachines: jest.fn().mockRejectedValue(new Error('Fly API GET → 500: boom')),
      destroyApp: jest.fn(),
    };

    const result = await sweepSandboxes(provider, mkLog());

    expect(result.failed).toEqual(['forkai-sbx-broken']);
    expect(provider.destroyApp).not.toHaveBeenCalled();
  });

  // ── ADR-0004 billing ────────────────────────────────────────────────────

  it('bills each identity-bearing machine before destroying its app, using the "<appName>:<machineId>" sandboxId', async () => {
    const createdAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-expired']),
      listMachines: jest.fn().mockResolvedValue([
        machine({ id: 'machine1', createdAt, expiresAt: new Date(Date.now() - 1000).toISOString(), sub: 'user-1', sessionId: 'sess-1', nodeId: 'node-1' }),
      ]),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };
    const biller = mkBiller();
    const callOrder: string[] = [];
    biller.billMachineUsage.mockImplementation(async () => {
      callOrder.push('bill');
    });
    provider.destroyApp.mockImplementation(async () => {
      callOrder.push('destroy');
    });

    await sweepSandboxes(provider, mkLog(), biller);

    expect(biller.billMachineUsage).toHaveBeenCalledWith('user-1', 'forkai-sbx-expired:machine1', 'sess-1', 'node-1', createdAt, expect.any(Number));
    expect(callOrder).toEqual(['bill', 'destroy']); // billed BEFORE destroy
  });

  it('destroys but does not bill a machine with no identity metadata (pre-feature or crashed before tagging)', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-expired']),
      listMachines: jest.fn().mockResolvedValue([machine({ expiresAt: new Date(Date.now() - 1000).toISOString() })]),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };
    const biller = mkBiller();

    const result = await sweepSandboxes(provider, mkLog(), biller);

    expect(biller.billMachineUsage).not.toHaveBeenCalled();
    expect(result.destroyed).toEqual(['forkai-sbx-expired']);
  });

  it('continues to destroy when billMachineUsage rejects (bill failure never blocks the destroy)', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-expired']),
      listMachines: jest.fn().mockResolvedValue([
        machine({ expiresAt: new Date(Date.now() - 1000).toISOString(), sub: 'user-1', sessionId: 'sess-1', nodeId: 'node-1' }),
      ]),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };
    const biller = mkBiller();
    biller.billMachineUsage.mockRejectedValue(new Error('ledger down'));

    const result = await sweepSandboxes(provider, mkLog(), biller);

    expect(result.destroyed).toEqual(['forkai-sbx-expired']);
    expect(provider.destroyApp).toHaveBeenCalledTimes(1);
  });

  it('calls reconcileStaleHolds once per sweep tick regardless of what was swept', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue([]),
      listMachines: jest.fn(),
      destroyApp: jest.fn(),
    };
    const biller = mkBiller();

    await sweepSandboxes(provider, mkLog(), biller);

    expect(biller.reconcileStaleHolds).toHaveBeenCalledTimes(1);
  });

  it('a failing reconcileStaleHolds does not fail the sweep or throw', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue([]),
      listMachines: jest.fn(),
      destroyApp: jest.fn(),
    };
    const biller = mkBiller();
    biller.reconcileStaleHolds.mockRejectedValue(new Error('down'));

    await expect(sweepSandboxes(provider, mkLog(), biller)).resolves.toEqual({ destroyed: [], kept: [], failed: [] });
  });

  it('skips billing and reconciliation entirely when no biller is wired', async () => {
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue(['forkai-sbx-expired']),
      listMachines: jest.fn().mockResolvedValue([
        machine({ expiresAt: new Date(Date.now() - 1000).toISOString(), sub: 'user-1', sessionId: 'sess-1', nodeId: 'node-1' }),
      ]),
      destroyApp: jest.fn().mockResolvedValue(undefined),
    };

    const result = await sweepSandboxes(provider, mkLog()); // no biller arg

    expect(result.destroyed).toEqual(['forkai-sbx-expired']);
  });
});

describe('startSandboxSweep', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sweeps immediately on start, then again on the 5-minute interval', async () => {
    jest.useFakeTimers();
    const provider = {
      listSandboxApps: jest.fn().mockResolvedValue([]),
      listMachines: jest.fn(),
      destroyApp: jest.fn(),
    };

    startSandboxSweep(provider, mkLog());
    await Promise.resolve(); // flush the immediate tick's microtask

    expect(provider.listSandboxApps).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5 * 60_000);
    await Promise.resolve();

    expect(provider.listSandboxApps).toHaveBeenCalledTimes(2);
  });
});
