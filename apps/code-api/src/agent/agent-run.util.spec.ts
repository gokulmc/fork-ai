import { AgentEvent, serializeEventsCapped } from './agent-run.util';

function makeEvent(seq: number, bodySize = 10): AgentEvent {
  return { seq, ts: '2026-01-01T00:00:00.000Z', kind: 'text', payload: 'x'.repeat(bodySize) };
}

describe('serializeEventsCapped', () => {
  it('returns the plain JSON unchanged when under the cap', () => {
    const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
    expect(serializeEventsCapped(events)).toBe(JSON.stringify(events));
  });

  it('drops middle events and inserts a marker when over the cap', () => {
    // Each event ~1KB; 500 of them (~500KB) comfortably exceeds the 300KB cap.
    const events = Array.from({ length: 500 }, (_, i) => makeEvent(i, 1000));
    const json = serializeEventsCapped(events);
    const parsed = JSON.parse(json) as AgentEvent[];

    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(300_000);
    expect(parsed.length).toBeLessThan(events.length);
    expect(parsed.some((e) => e.kind === 'truncated')).toBe(true);
    // Earliest and latest events are preserved for replay.
    expect(parsed[0].seq).toBe(0);
    expect(parsed[parsed.length - 1].seq).toBe(499);
  });

  it('never exceeds the cap even with a handful of oversized events', () => {
    const events = [makeEvent(0, 400_000), makeEvent(1, 400_000), makeEvent(2, 400_000)];
    const json = serializeEventsCapped(events);
    const parsed = JSON.parse(json) as AgentEvent[];
    expect(parsed.some((e) => e.kind === 'truncated')).toBe(true);
    expect(parsed[0].seq).toBe(0);
    expect(parsed[parsed.length - 1].seq).toBe(2);
  });
});
