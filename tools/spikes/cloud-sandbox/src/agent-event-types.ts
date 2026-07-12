// Copied from apps/code-api/src/agent/agent-run.util.ts (AgentEvent only — the
// serializeEventsCapped DynamoDB-budget logic isn't relevant to this spike's
// console-printing client). Keep in sync by hand; this is a throwaway spike,
// not a shared package.
export interface AgentEvent {
  seq: number;
  ts: string;
  kind: 'text' | 'tool_call' | 'tool_result' | 'terminal' | 'file_edit' | 'truncated';
  payload: unknown;
}
