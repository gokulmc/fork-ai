import { translateAgentMessage, extractResult } from './claude-events';

// All fixtures below are shaped after the real @anthropic-ai/claude-agent-sdk
// .d.ts (SDKAssistantMessage.message is a BetaMessage with content blocks;
// SDKUserMessage.message is a MessageParam whose content can carry
// tool_result blocks; SDKResultMessage.usage is snake_case input_tokens/
// output_tokens) — not invented shapes.

function assistantMsg(content: unknown[]) {
  return { type: 'assistant', message: { content } };
}
function userMsg(content: unknown) {
  return { type: 'user', message: { content } };
}

describe('translateAgentMessage', () => {
  it('translates an assistant text block to a text event', () => {
    const events = translateAgentMessage(assistantMsg([{ type: 'text', text: 'Reading the repo layout' }]));
    expect(events).toEqual([expect.objectContaining({ kind: 'text', payload: 'Reading the repo layout' })]);
  });

  it('translates a Bash tool_use block to a terminal event', () => {
    const events = translateAgentMessage(
      assistantMsg([{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }]),
    );
    expect(events).toEqual([expect.objectContaining({ kind: 'terminal', payload: '$ npm test' })]);
  });

  it.each(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])('translates a %s tool_use block to a file_edit event', (name) => {
    const events = translateAgentMessage(assistantMsg([{ type: 'tool_use', name, input: { file_path: 'src/foo.ts' } }]));
    expect(events).toEqual([expect.objectContaining({ kind: 'file_edit', payload: `${name} src/foo.ts` })]);
  });

  it('translates any other tool_use block to a tool_call event with a stringified summary', () => {
    const events = translateAgentMessage(assistantMsg([{ type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } }]));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('tool_call');
    expect(typeof events[0].payload).toBe('string');
    expect(JSON.parse(events[0].payload as string)).toEqual({ name: 'Glob', inputSummary: { pattern: '**/*.ts' } });
  });

  it('produces multiple events from one assistant message with text + tool_use blocks', () => {
    const events = translateAgentMessage(
      assistantMsg([
        { type: 'text', text: 'Let me check the tests' },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/foo.ts' } },
      ]),
    );
    expect(events.map((e) => e.kind)).toEqual(['text', 'terminal', 'tool_call']);
  });

  it('skips non-text, non-tool_use blocks (e.g. thinking) without emitting an event', () => {
    const events = translateAgentMessage(assistantMsg([{ type: 'thinking', thinking: 'hmm' }]));
    expect(events).toEqual([]);
  });

  it('translates a tool_result block (string content) to a tool_result event', () => {
    const events = translateAgentMessage(
      userMsg([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'PASS src/foo.test.ts' }]),
    );
    expect(events).toEqual([expect.objectContaining({ kind: 'tool_result', payload: 'PASS src/foo.test.ts' })]);
  });

  it('translates a tool_result block (array-of-text-blocks content) to a tool_result event', () => {
    const events = translateAgentMessage(
      userMsg([{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }] }]),
    );
    expect(events).toEqual([expect.objectContaining({ kind: 'tool_result', payload: 'line 1\nline 2' })]);
  });

  it('ignores a plain-string user message (not a tool_result)', () => {
    const events = translateAgentMessage(userMsg('just some replayed text'));
    expect(events).toEqual([]);
  });

  it('caps a payload at ~2KB', () => {
    const huge = 'x'.repeat(5000);
    const events = translateAgentMessage(assistantMsg([{ type: 'text', text: huge }]));
    expect(events).toHaveLength(1);
    const payload = events[0].payload as string;
    // cap (2000 bytes) + the 3-byte UTF-8 '…' marker appended after slicing.
    expect(Buffer.byteLength(payload, 'utf8')).toBeLessThanOrEqual(2003);
    expect(payload.endsWith('…')).toBe(true);
  });

  it('translates a system/init message to a single text event noting the model', () => {
    const events = translateAgentMessage({ type: 'system', subtype: 'init', model: 'claude-sonnet-5' });
    expect(events).toEqual([expect.objectContaining({ kind: 'text', payload: 'session started (model claude-sonnet-5)' })]);
  });

  it('ignores other system subtypes as SDK-internal noise', () => {
    const events = translateAgentMessage({ type: 'system', subtype: 'rate_limit_event' });
    expect(events).toEqual([]);
  });

  it('returns [] for an unrecognized message type', () => {
    expect(translateAgentMessage({ type: 'task_notification' })).toEqual([]);
    expect(translateAgentMessage(null)).toEqual([]);
    expect(translateAgentMessage('not an object')).toEqual([]);
  });

  it('every emitted kind is one of the 5 real AgentEvent kinds', () => {
    const events = translateAgentMessage(
      assistantMsg([
        { type: 'text', text: 'a' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: 'x.ts' } },
        { type: 'tool_use', name: 'Glob', input: {} },
      ]),
    );
    const allowed = new Set(['text', 'tool_call', 'tool_result', 'terminal', 'file_edit']);
    for (const e of events) expect(allowed.has(e.kind)).toBe(true);
  });
});

describe('extractResult', () => {
  it('extracts usage, cost, and result text from a result message', () => {
    const result = extractResult({
      type: 'result',
      subtype: 'success',
      result: 'Added retry logic to the fetch client',
      total_cost_usd: 0.0421,
      usage: { input_tokens: 1200, output_tokens: 340 },
    });
    expect(result).toEqual({
      usage: { inputTokens: 1200, outputTokens: 340 },
      totalCostUsd: 0.0421,
      resultText: 'Added retry logic to the fetch client',
    });
  });

  it('defaults missing usage fields to 0 and omits totalCostUsd/resultText when absent (error result)', () => {
    const result = extractResult({ type: 'result', subtype: 'error_max_turns', usage: {} });
    expect(result).toEqual({ usage: { inputTokens: 0, outputTokens: 0 }, totalCostUsd: undefined, resultText: '' });
  });

  it('returns null for a non-result message', () => {
    expect(extractResult(assistantMsg([{ type: 'text', text: 'hi' }]))).toBeNull();
    expect(extractResult(null)).toBeNull();
  });
});
