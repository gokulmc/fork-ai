import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LlmResponse } from './llm.types';

const SECTIONS_SCHEMA = `Return ONLY valid JSON, no prose, no markdown fences. Shape:
{
  "title": "<=5 words capturing topic",
  "emoji": "single emoji that best represents this topic",
  "lede": "one sentence framing the answer (max 25 words)",
  "sections": [
    { "heading": "Section heading", "body": "1-2 paragraph markdown discussion" }
  ]
}`;

@Injectable()
export class LlmService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly cfg: ConfigService) {
    this.client = new Anthropic({ apiKey: cfg.get<string>('anthropic.apiKey') });
  }

  async answerQuery(query: string, sectionCount = 5): Promise<LlmResponse> {
    const prompt = `You are a research assistant. Answer this query as a structured study note with ${sectionCount} sections.

Query: "${query}"

${SECTIONS_SCHEMA}

Each section "body" should be 80-180 words. You MAY use GitHub-flavored markdown when it strengthens the explanation: paragraphs, **bold**, *italic*, \`inline code\`, fenced code blocks, tables, ordered/unordered lists, and > blockquotes. Use prose by default. Escape any double-quotes inside JSON strings.`;

    return this.callJson(prompt);
  }

  async expandSection(
    rootQuery: string,
    sectionHeading: string,
    sectionBody: string,
  ): Promise<LlmResponse> {
    const prompt = `Continue research. The parent topic was: "${rootQuery}".
We want to go DEEPER on the section titled "${sectionHeading}".

Produce a focused deep-dive with 3-4 sections, each 80-180 words.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown when it helps. The "title" should be a 5-word-max phrase capturing the deep dive. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt);
  }

  async followUpFromHighlight(
    rootQuery: string,
    highlight: string,
    question: string,
  ): Promise<LlmResponse> {
    const prompt = `Continue research. The parent topic was: "${rootQuery}".
The user highlighted this passage: "${highlight.slice(0, 800)}"
They asked: "${question}"

Answer with 3-4 sections, each 80-180 words.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the answer topic. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt);
  }

  private async callJson(prompt: string, retries = 1): Promise<LlmResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const message = await this.client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        });

        const raw = message.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { type: 'text'; text: string }).text)
          .join('');

        return this.parseJson(raw);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`LLM attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    throw new InternalServerErrorException(`LLM call failed: ${lastError?.message}`);
  }

  private parseJson(raw: string): LlmResponse {
    let text = raw.trim();
    // strip ```json ... ``` fences if the model wraps output
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    const parsed = JSON.parse(text) as LlmResponse;
    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      throw new Error('Invalid LLM response shape — missing sections array');
    }
    return parsed;
  }
}
