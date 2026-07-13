// COPY of apps/code-api/src/agent/local/claude-events.ts, verbatim aside from
// the AgentEvent import path. Copied (not relative-imported) because this spike
// lives outside the npm workspace under tools/spikes/ with its own tsconfig/
// package.json — a relative import across that boundary would work today but
// silently couples this throwaway spike's build to apps/code-api's module
// graph. Keep in sync by hand if the original changes.
import type { AgentEvent } from './agent-event-types.js';

const PAYLOAD_CAP_BYTES = 2000;

function capPayload(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= PAYLOAD_CAP_BYTES) return text;
  return `${text.slice(0, PAYLOAD_CAP_BYTES)}…`;
}

function mkEvent(kind: AgentEvent['kind'], payload: unknown): AgentEvent {
  return { seq: 0, ts: new Date().toISOString(), kind, payload };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function fileEditTarget(input: Record<string, unknown>): string {
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.notebook_path === 'string') return input.notebook_path;
  return 'unknown file';
}

function translateAssistantBlock(block: Record<string, unknown>): AgentEvent | null {
  if (block.type === 'text') {
    return typeof block.text === 'string' ? mkEvent('text', capPayload(block.text)) : null;
  }
  if (block.type !== 'tool_use') return null;

  const name = typeof block.name === 'string' ? block.name : 'unknown_tool';
  const input = isRecord(block.input) ? block.input : {};
  if (name === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    return mkEvent('terminal', capPayload(`$ ${command}`));
  }
  if (FILE_EDIT_TOOLS.has(name)) {
    return mkEvent('file_edit', `${name} ${fileEditTarget(input)}`);
  }
  return mkEvent('tool_call', capPayload(JSON.stringify({ name, inputSummary: input })));
}

function translateAssistant(msg: Record<string, unknown>): AgentEvent[] {
  const message = msg.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const events: AgentEvent[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    const event = translateAssistantBlock(block);
    if (event) events.push(event);
  }
  return events;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (isRecord(b) && typeof b.text === 'string' ? b.text : JSON.stringify(b))).join('\n');
  }
  return JSON.stringify(content ?? '');
}

function translateUser(msg: Record<string, unknown>): AgentEvent[] {
  const message = msg.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const events: AgentEvent[] = [];
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_result') continue;
    events.push(mkEvent('tool_result', capPayload(extractToolResultText(block.content))));
  }
  return events;
}

export function translateAgentMessage(msg: unknown): AgentEvent[] {
  if (!isRecord(msg)) return [];
  if (msg.type === 'assistant') return translateAssistant(msg);
  if (msg.type === 'user') return translateUser(msg);
  if (msg.type === 'system' && msg.subtype === 'init') {
    const model = typeof msg.model === 'string' ? msg.model : 'unknown';
    return [mkEvent('text', `session started (model ${model})`)];
  }
  return [];
}

export interface AgentRunUsage {
  usage: { inputTokens: number; outputTokens: number };
  totalCostUsd?: number;
  resultText: string;
}

export function extractResult(msg: unknown): AgentRunUsage | null {
  if (!isRecord(msg) || msg.type !== 'result') return null;
  const usage = isRecord(msg.usage) ? msg.usage : {};
  return {
    usage: {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
    },
    totalCostUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
    resultText: typeof msg.result === 'string' ? msg.result : '',
  };
}
