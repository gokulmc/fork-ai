import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider, CompleteOptions, CompleteResult } from './provider.types';
import { extractAnthropicSources, processCitations } from '../citations';

// Wraps the Anthropic SDK behind the provider interface. This is a lift of the
// former inline body of LlmService.callJson — behaviour is unchanged.
export class AnthropicProvider implements LlmProvider {
  constructor(private readonly client: Anthropic) {}

  async complete(prompt: string, { model, maxTokens, webSearch }: CompleteOptions): Promise<CompleteResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (webSearch) {
      params.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }

    const message = await this.client.messages.create(params);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = (message as any).content ?? [];
    const rawText: string = blocks
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');

    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
    const truncated = (message as { stop_reason?: string }).stop_reason === 'max_tokens';

    let applyCitations: CompleteResult['applyCitations'];
    if (webSearch) {
      const allSources = extractAnthropicSources(blocks);
      if (allSources.length) applyCitations = sections => processCitations(sections, allSources);
    }

    return { rawText, usage, truncated, applyCitations };
  }
}
