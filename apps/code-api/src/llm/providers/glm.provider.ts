import { LlmProvider, CompleteOptions, CompleteResult } from './provider.types';

const GLM_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';
// GLM 5.2 with web search runs ~25s non-streamed; cap the wait so a hung socket
// fails cleanly into the retry/friendly-error path instead of spinning forever
// (raw fetch has no built-in timeout, unlike the Anthropic SDK).
const GLM_TIMEOUT_MS = 120_000;

// Z.ai GLM via its OpenAI-style chat-completions endpoint. Unlike DeepSeek, GLM is
// NOT on the Anthropic-compatible surface here — its web search is a built-in tool
// that lives on this endpoint — so we hand-roll the request/response (no SDK), the
// same way the Gemini provider owns its own client. Branch calls only.
//
// Citations: the v4 endpoint does NOT return a structured results array, so we have
// GLM embed sources in its own JSON instead (inline markdown links + a top-level
// `sources` array — see GLM_CITATION_NOTE in llm.service). The provider therefore
// does no citation post-processing; llm.service sanitises the model-emitted sources.
export class GlmProvider implements LlmProvider {
  // Lazy key so a missing key never crashes app boot — it only surfaces (as a
  // clear error) when a GLM model is actually requested.
  constructor(private readonly getApiKey: () => string | undefined) {}

  private apiKeyOrThrow(): string {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('GLM_API_KEY is not configured but a GLM model was requested');
    }
    return apiKey;
  }

  async complete(prompt: string, { model, maxTokens, webSearch }: CompleteOptions): Promise<CompleteResult> {
    const apiKey = this.apiKeyOrThrow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      // GLM reasoning is ON by default and eats the whole token budget on
      // reasoning_content, leaving an EMPTY answer that trips the truncation guard
      // — disable it for fast structured-JSON extraction (verified against the API).
      thinking: { type: 'disabled' },
      // Unlike Gemini, GLM allows json_object response_format AND the web_search
      // tool together, so we always force clean JSON.
      response_format: { type: 'json_object' },
    };
    if (webSearch) {
      body.tools = [{ type: 'web_search', web_search: { enable: true, search_engine: 'search_pro_jina', search_result: true } }];
    }

    const res = await fetch(GLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GLM_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`GLM request failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const choice = json.choices?.[0];
    const rawText: string = choice?.message?.content ?? '';
    const usage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
    const truncated = choice?.finish_reason === 'length';

    return { rawText, usage, truncated };
  }
}
