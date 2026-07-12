import type { AgentEvent } from '../agent-run.util';

// Structurally typed (not imported from the SDK) so this file — and its unit
// tests — never need the `@anthropic-ai/claude-agent-sdk` devDependency
// loaded. A claude-agent-sdk `SDKMessage` and a stream-json JSONL line are
// near-identical shapes at this level of detail, so one translator handles both.

// DynamoDB item budget is shared across the whole event stream
// (serializeEventsCapped, 300KB total) — 2KB per event keeps one runaway tool
// output from dominating that budget.
const PAYLOAD_CAP_BYTES = 2000;

function capPayload(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= PAYLOAD_CAP_BYTES) return text;
  return `${text.slice(0, PAYLOAD_CAP_BYTES)}…`;
}

function mkEvent(kind: AgentEvent['kind'], payload: unknown): AgentEvent {
  // seq is renumbered by the SSE consumer (NodesService) on arrival.
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
  if (block.type !== 'tool_use') return null; // thinking/server_tool_use/etc — not surfaced in the transcript

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

// tool_result content is either a plain string or a list of content blocks
// (text blocks in practice). Every shape is flattened to one string — the SDK
// doesn't cheaply expose which tool produced a given result on the user-message
// side, so this is always 'tool_result', never 'terminal', even for Bash output.
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

// Translates one streamed SDK message into zero or more AgentEvents. A single
// assistant message can produce several (e.g. a text block plus two tool_use
// blocks), so this always returns an array rather than a single event.
export function translateAgentMessage(msg: unknown): AgentEvent[] {
  if (!isRecord(msg)) return [];
  if (msg.type === 'assistant') return translateAssistant(msg);
  if (msg.type === 'user') return translateUser(msg);
  if (msg.type === 'system' && msg.subtype === 'init') {
    const model = typeof msg.model === 'string' ? msg.model : 'unknown';
    return [mkEvent('text', `session started (model ${model})`)];
  }
  // Every other system/control message (task notifications, rate limits, plugin
  // installs, etc.) is SDK-internal noise not worth surfacing in the run transcript.
  return [];
}

export interface AgentRunUsage {
  usage: { inputTokens: number; outputTokens: number };
  totalCostUsd?: number;
  resultText: string;
}

// The 'result' message carries no translatable event of its own — it's the
// run's final usage/cost/text, consumed directly by LocalAgentRunner instead.
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
