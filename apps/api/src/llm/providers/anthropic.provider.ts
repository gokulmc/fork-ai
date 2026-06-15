import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider, CompleteOptions, CompleteResult } from './provider.types';
import { extractAnthropicSources, processCitations } from '../citations';

// Wraps the Anthropic SDK behind the provider interface. This is a lift of the
// former inline body of LlmService.callJson — behaviour is unchanged.
export class AnthropicProvider implements LlmProvider {
  constructor(private readonly client: Anthropic) {}

  async complete(prompt: string, { model, maxTokens, webSearch }: CompleteOptions): Promise<CompleteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: 'user', content: prompt }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any = webSearch
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
      : undefined;

    // A long-running web search makes Anthropic pause the turn with
    // stop_reason 'pause_turn' and only the partial assistant content (the search
    // tool blocks, no final answer). We must feed that content back to let the
    // model finish — otherwise the JSON answer never arrives and parseJson fails
    // into the generic "unreadable answer". MAX_TURNS is a backstop; max_uses
    // already bounds the number of searches.
    const MAX_TURNS = 5;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allBlocks: any[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = { model, max_tokens: maxTokens, messages };
      if (tools) params.tools = tools;

      const message = await this.client.messages.create(params);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = (message as any).content ?? [];
      allBlocks.push(...blocks);
      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;
      stopReason = (message as { stop_reason?: string }).stop_reason;

      if (stopReason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: blocks });
    }

    const rawText: string = allBlocks
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');

    const usage = { inputTokens, outputTokens };
    const truncated = stopReason === 'max_tokens';

    let applyCitations: CompleteResult['applyCitations'];
    if (webSearch) {
      const allSources = extractAnthropicSources(allBlocks);
      if (allSources.length) applyCitations = sections => processCitations(sections, allSources);
    }

    return { rawText, usage, truncated, applyCitations };
  }
}
