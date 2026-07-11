// One entry in an AgentRunItem.events stream — a CODE node's agent run persists
// its full event log as one JSON-serialized string (see AgentRunItem in
// dynamo.interfaces.ts). 'truncated' is a synthetic kind only ever produced by
// serializeEventsCapped below, marking where events were dropped.
export interface AgentEvent {
  seq: number;
  ts: string;
  kind: 'text' | 'tool_call' | 'tool_result' | 'terminal' | 'file_edit' | 'truncated';
  payload: unknown;
}

// DynamoDB items cap out at 400KB; leave headroom for the rest of the item's
// attributes (commit info, etc). A single pathological run (e.g. a runaway
// tool-call loop) must never blow past this.
const MAX_EVENTS_BYTES = 300_000;

// Serializes AgentRun events into the single string DynamoDB stores. If the
// result exceeds the cap, drops events from the middle — keeping the earliest
// (initial context) and latest (most recent activity), which matter most for
// replaying a run — and splices in one marker event noting the gap.
export function serializeEventsCapped(events: AgentEvent[]): string {
  const json = JSON.stringify(events);
  if (Buffer.byteLength(json, 'utf8') <= MAX_EVENTS_BYTES) return json;

  const keepEach = Math.max(1, Math.floor(events.length / 4));
  const dropped = events.length - keepEach * 2;
  if (dropped <= 0) return json; // too few events to usefully trim; return as-is

  const marker: AgentEvent = {
    seq: -1,
    ts: new Date().toISOString(),
    kind: 'truncated',
    payload: { droppedCount: dropped, message: `${dropped} events omitted — run exceeded the ${MAX_EVENTS_BYTES}-byte cap` },
  };
  const trimmed = [...events.slice(0, keepEach), marker, ...events.slice(events.length - keepEach)];
  const trimmedJson = JSON.stringify(trimmed);
  if (Buffer.byteLength(trimmedJson, 'utf8') <= MAX_EVENTS_BYTES) return trimmedJson;

  // Still too big (a handful of pathologically large events) — trim harder, once.
  return JSON.stringify([events[0], marker, events[events.length - 1]]);
}
