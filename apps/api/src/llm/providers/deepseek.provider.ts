import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider, CompleteOptions, CompleteResult } from './provider.types';

// DeepSeek via its Anthropic-compatible endpoint (https://api.deepseek.com/anthropic),
// so we reuse @anthropic-ai/sdk rather than adding a second SDK. Branch calls only.
// DeepSeek has no native web search, so the webSearch flag is ignored and no
// citations are returned. Reasoning is disabled for fast structured-JSON extraction.
export class DeepSeekProvider implements LlmProvider {
  private client?: Anthropic;

  // Lazy key so a missing key never crashes app boot — it only surfaces (as a
  // clear error) when a DeepSeek model is actually requested.
  constructor(private readonly getApiKey: () => string | undefined) {}

  private clientOrThrow(): Anthropic {
    if (!this.client) {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not configured but a DeepSeek model was requested');
      }
      this.client = new Anthropic({ apiKey, baseURL: 'https://api.deepseek.com/anthropic' });
    }
    return this.client;
  }

  async complete(prompt: string, { model, maxTokens }: CompleteOptions): Promise<CompleteResult> {
    const client = this.clientOrThrow();

    // No response_format on the Anthropic surface — rely on the SECTIONS_SCHEMA
    // prompt + the shared parseJson fallback (same as the Claude path). `thinking`
    // disabled skips V4 reasoning (cost + non-JSON preamble); cast since it's a
    // DeepSeek extension to the Anthropic params.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
    };

    const message = await client.messages.create(params);
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

    // No web search → no citations.
    return { rawText, usage };
  }
}
