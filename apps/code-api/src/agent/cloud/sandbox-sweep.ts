import type { Logger } from '@nestjs/common';
import type { FlyProvider } from './fly-provider';

const SWEEP_INTERVAL_MS = 5 * 60_000;
// Crashed-run hard cap: an app whose machine carries no expiry metadata
// (CloudAgentRunner's finally didn't get to tag it — a crash, or a machine
// predating this feature) is destroyed once it's older than this, mirroring
// the destroy-in-finally safety net for a run that never reached its own
// finally block either.
const NO_METADATA_MAX_AGE_MS = 30 * 60_000;

export interface SandboxSweepResult {
  destroyed: string[];
  kept: string[];
  failed: string[];
}

type SweepProvider = Pick<FlyProvider, 'listSandboxApps' | 'listMachines' | 'destroyApp'>;
type SweepLog = Pick<Logger, 'log' | 'warn' | 'error'>;

// Narrow interface (not the concrete UsersService import — this module lives
// under agent/, UsersService under users/) satisfied by
// UsersService.billMachineUsage/reconcileStaleHolds — see root CLAUDE.md's
// ADR-0004 note. Optional on both call sites below so a server with no
// billing wired (shouldn't happen once agent.module.ts wires it, but keeps
// this module's own tests billing-agnostic) just skips billing/reconciling.
export interface MachineBiller {
  billMachineUsage(sub: string, sandboxId: string, sessionId: string, nodeId: string, createdAtIso: string, destroyAtMs: number): Promise<void>;
  reconcileStaleHolds(cutoffMinutes?: number): Promise<void>;
}

// One reconciliation pass: for every forkai-sbx-* app (listSandboxApps already
// excludes the base image), destroy it once ALL of its machines are past
// their forkai_expires_at metadata, or — absent that metadata — older than
// NO_METADATA_MAX_AGE_MS. An app with no machines left (already torn down by
// a racing sweep) is left for the next tick rather than guessed at.
//
// Runs on >1 EB instance is expected, not a bug: destroyApp tolerates 404s,
// so two sweepers racing the same expired app both report success — no
// coordination/locking needed, same "rely on idempotency" pattern as the
// Dynamoose null-handling elsewhere in this codebase.
export async function sweepSandboxes(provider: SweepProvider, log: SweepLog, biller?: MachineBiller): Promise<SandboxSweepResult> {
  const result: SandboxSweepResult = { destroyed: [], kept: [], failed: [] };
  const now = Date.now();

  for (const appName of await provider.listSandboxApps()) {
    let machines;
    try {
      machines = await provider.listMachines(appName);
    } catch (err) {
      result.failed.push(appName);
      log.error(`sweep: failed to list machines for ${appName}: ${String(err)}`);
      continue;
    }

    if (!machines.length) {
      result.kept.push(appName);
      continue;
    }

    const allExpired = machines.every((m) =>
      m.expiresAt ? new Date(m.expiresAt).getTime() <= now : now - new Date(m.createdAt).getTime() >= NO_METADATA_MAX_AGE_MS,
    );
    if (!allExpired) {
      result.kept.push(appName);
      continue;
    }

    // Bill BEFORE destroy — full lifetime (create → now, incl. the idle TTL
    // window, per the locked decision) for every machine that carries
    // identity metadata (set at birth by FlyProvider, see
    // SANDBOX_*_METADATA_KEY). A bill failure never blocks the destroy below
    // (log + continue) — billMachineUsage's putMachineBill guard makes a
    // retry safe if this app's destroy is itself deferred (e.g. another
    // machine in it isn't expired yet, or destroyApp below fails), but if
    // destroy succeeds anyway this tick, this specific machine's cost is
    // lost — same bounded, tolerated gap as CloudAgentRunner's error-path
    // billing. sandboxId is built as "<appName>:<machineId>", matching
    // FlyProvider.create's SandboxHandle format exactly — this MUST agree
    // with CloudAgentRunner's own billing call, since it's the MACHINEBILL#
    // idempotency key; a mismatch would let the same machine be billed twice
    // under two different keys.
    if (biller) {
      for (const m of machines) {
        if (!m.sub || !m.sessionId || !m.nodeId) continue; // pre-feature or crashed-before-tag machine — destroyed, not billed
        try {
          await biller.billMachineUsage(m.sub, `${appName}:${m.id}`, m.sessionId, m.nodeId, m.createdAt, now);
        } catch (err) {
          log.error(`sweep: billMachineUsage failed for ${appName}:${m.id}: ${String(err)}`);
        }
      }
    }

    try {
      await provider.destroyApp(appName);
      result.destroyed.push(appName);
      log.log(`sweep: destroyed expired sandbox ${appName}`);
    } catch (err) {
      result.failed.push(appName);
      log.error(`sweep: failed to destroy ${appName}: ${String(err)}`);
    }
  }

  if (biller) {
    try {
      await biller.reconcileStaleHolds();
    } catch (err) {
      log.error(`sweep: reconcileStaleHolds failed: ${String(err)}`);
    }
  }

  return result;
}

// Wired from agent.module.ts's factory only when cloud is configured — an org
// with no sandboxes has nothing to sweep. Runs immediately (catches anything
// left over from before this server started) then every SWEEP_INTERVAL_MS;
// unref'd so the interval never keeps the process alive on shutdown.
export function startSandboxSweep(provider: SweepProvider, log: SweepLog, biller?: MachineBiller): void {
  const tick = () => {
    void sweepSandboxes(provider, log, biller).catch((err) => log.error(`sweep tick failed: ${String(err)}`));
  };
  tick();
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref();
}
