import { GoogleGenAI } from '@google/genai';
import { LlmProvider, CompleteOptions, CompleteResult } from './provider.types';
import { applyGeminiGrounding, GeminiGroundingMetadata } from '../citations';

// Wraps the Google GenAI SDK behind the provider interface (branch calls only).
export class GeminiProvider implements LlmProvider {
  private client?: GoogleGenAI;

  // The API key is read lazily so a missing key never crashes app boot — it only
  // surfaces (as a clear error) when a Gemini model is actually requested.
  constructor(private readonly getApiKey: () => string | undefined) {}

  private clientOrThrow(): GoogleGenAI {
    if (!this.client) {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured but a Gemini model was requested');
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async complete(prompt: string, { model, maxTokens, webSearch }: CompleteOptions): Promise<CompleteResult> {
    const ai = this.clientOrThrow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      // Generous headroom: Gemini 2.5 may spend output tokens on "thinking", and
      // we only pay for tokens actually produced, so an unused ceiling is free.
      maxOutputTokens: Math.max(maxTokens, 4096),
      // We don't want reasoning for structured JSON extraction. Flash/Flash-Lite
      // accept thinkingBudget 0 (off); 2.5 Pro cannot fully disable it (min 128).
      thinkingConfig: { thinkingBudget: model.includes('2.5-pro') ? 128 : 0 },
    };
    if (webSearch) {
      // Grounding and JSON-output mode are mutually exclusive on Gemini 2.5 — do
      // NOT set responseMimeType here; rely on the prompt + parseJson fallback.
      config.tools = [{ googleSearch: {} }];
    } else {
      config.responseMimeType = 'application/json';
    }

    const response = await ai.models.generateContent({ model, contents: prompt, config });

    const rawText = response.text ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const um = (response as any).usageMetadata;
    const usage = {
      inputTokens: um?.promptTokenCount ?? 0,
      outputTokens: um?.candidatesTokenCount ?? 0,
    };
    const truncated = (response.candidates?.[0]?.finishReason as string | undefined) === 'MAX_TOKENS';

    let applyCitations: CompleteResult['applyCitations'];
    if (webSearch) {
      const meta = response.candidates?.[0]?.groundingMetadata as GeminiGroundingMetadata | undefined;
      if (meta?.groundingSupports?.length && meta?.groundingChunks?.length) {
        applyCitations = sections => applyGeminiGrounding(sections, meta);
      }
    }

    return { rawText, usage, truncated, applyCitations };
  }
}
