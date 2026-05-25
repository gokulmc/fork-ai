import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LlmResponse, LlmSection } from './llm.types';

export type StreamEvent =
  | { type: 'meta'; title: string; emoji: string; lede: string }
  | { type: 'section'; heading: string; body: string }
  | { type: 'done' };

function extractMeta(text: string): { title: string; emoji: string; lede: string } | null {
  const title = text.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const emoji = text.match(/"emoji"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const lede  = text.match(/"lede"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!title || !emoji || !lede) return null;
  return {
    title: title.replace(/\\"/g, '"'),
    emoji,
    lede: lede.replace(/\\"/g, '"'),
  };
}

function extractCompletedSections(text: string): LlmSection[] {
  const match = text.match(/"sections"\s*:\s*\[/);
  if (!match) return [];
  const rest = text.slice(match.index! + match[0].length);
  const sections: LlmSection[] = [];
  let pos = 0;
  while (pos < rest.length) {
    while (pos < rest.length && /[\s,]/.test(rest[pos])) pos++;
    if (rest[pos] !== '{') break;
    let depth = 0, inStr = false, esc = false, end = pos;
    for (let i = pos; i < rest.length; i++) {
      const c = rest[i];
      if (esc)          { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"')    { inStr = !inStr; continue; }
      if (inStr)        continue;
      if (c === '{')    depth++;
      if (c === '}')    { depth--; if (depth === 0) { end = i; break; } }
    }
    if (depth !== 0) break;
    try {
      const obj = JSON.parse(rest.slice(pos, end + 1)) as LlmSection;
      sections.push(obj);
      pos = end + 1;
    } catch { break; }
  }
  return sections;
}

const CITATION_NOTE = `When you use web search results, cite sources inline as plain text — e.g. (Source: Name) or a bracketed number like [1] — never wrap cited sentences or paragraphs in *asterisks* or _underscores_. Do not italicise entire sentences to indicate attribution.`;

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

  async *streamAnswerQuery(query: string, sectionCount = 5, webSearch = false): AsyncGenerator<StreamEvent> {
    const prompt = `You are a research assistant. Answer this query as a structured study note with ${sectionCount} sections.

Query: "${query}"

${SECTIONS_SCHEMA}

Each section "body" should be 80-180 words. You MAY use GitHub-flavored markdown when it strengthens the explanation: paragraphs, **bold**, *italic*, \`inline code\`, fenced code blocks, tables, ordered/unordered lists, and > blockquotes. Use prose by default. Escape any double-quotes inside JSON strings.${webSearch ? `\n\n${CITATION_NOTE}` : ''}`;

    let accumulated = '';
    let metaEmitted = false;
    let emittedCount = 0;

    const streamParams: Parameters<typeof this.client.messages.stream>[0] = {
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    };
    if (webSearch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (streamParams as any).tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }

    const stream = this.client.messages.stream(streamParams);

    for await (const chunk of stream) {
      if (chunk.type !== 'content_block_delta') continue;
      const delta = chunk.delta as { type: string; text?: string };
      if (delta.type !== 'text_delta' || !delta.text) continue;
      accumulated += delta.text;

      if (!metaEmitted) {
        const meta = extractMeta(accumulated);
        if (meta) { metaEmitted = true; yield { type: 'meta', ...meta }; }
      }

      const sections = extractCompletedSections(accumulated);
      while (emittedCount < sections.length) {
        yield { type: 'section', ...sections[emittedCount++] };
      }
    }

    // Fallback: parse full response and emit any sections not yet streamed
    try {
      const full = this.parseJson(accumulated);
      while (emittedCount < full.sections.length) {
        yield { type: 'section', ...full.sections[emittedCount++] };
      }
      if (!metaEmitted) {
        yield { type: 'meta', title: full.title, emoji: full.emoji, lede: full.lede };
      }
    } catch (err) {
      this.logger.warn(`Stream fallback parse failed: ${(err as Error).message}`);
    }

    yield { type: 'done' };
  }

  async answerQuery(query: string, sectionCount = 4, webSearch = false): Promise<LlmResponse> {
    const prompt = `You are a research assistant. Answer this query as a structured study note. Use as many sections as the topic genuinely warrants — no more than ${sectionCount}. Do not pad with redundant or filler sections; fewer is better when the topic is focused.

Query: "${query}"

${SECTIONS_SCHEMA}

Each section "body" should be 80-180 words. You MAY use GitHub-flavored markdown when it strengthens the explanation: paragraphs, **bold**, *italic*, \`inline code\`, fenced code blocks, tables, ordered/unordered lists, and > blockquotes. Use prose by default. Escape any double-quotes inside JSON strings.`;

    return this.callJson(prompt, webSearch);
  }

  async expandSection(
    ancestors: Array<{ title: string; query: string }>,
    sectionHeading: string,
    sectionBody: string,
    sectionCount = 4,
    webSearch = false,
  ): Promise<LlmResponse> {
    const trail = ancestors
      .map((a, i) => `${ i === 0 ? 'Root query' : 'Sub-topic'}: "${a.query}" → "${a.title}"`)
      .join('\n');
    const prompt = `You are continuing a branching research session. Research trail (root → current):
${trail}

Go DEEPER on the section titled "${sectionHeading}" within this context.
Section content for reference: "${sectionBody.slice(0, 400)}"

Produce a focused deep-dive with as many sections as the topic warrants — no more than ${sectionCount}. Do not pad; fewer sections is better when the scope is narrow. Each section should be 80-180 words. Stay relevant to the full research trail.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the deep dive. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt, webSearch);
  }

  async followUpFromHighlight(
    ancestors: Array<{ title: string; query: string }>,
    highlight: string,
    question: string,
    sectionCount = 4,
    webSearch = false,
  ): Promise<LlmResponse> {
    const trail = ancestors
      .map((a, i) => `${i === 0 ? 'Root query' : 'Sub-topic'}: "${a.query}" → "${a.title}"`)
      .join('\n');
    const prompt = `You are continuing a branching research session. Research trail (root → current):
${trail}

The user highlighted this passage: "${highlight.slice(0, 800)}"
They asked: "${question}"

Answer with as many sections as the question warrants — no more than ${sectionCount}. Do not pad; fewer sections is better when the answer is focused. Each section should be 80-180 words. Keep the answer grounded in the research trail context.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the answer topic. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt, webSearch);
  }

  private async callJson(prompt: string, webSearch = false, retries = 1): Promise<LlmResponse> {
    const fullPrompt = webSearch ? `${prompt}\n\n${CITATION_NOTE}` : prompt;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any = {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: fullPrompt }],
        };
        if (webSearch) {
          params.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
        }
        const message = await this.client.messages.create(params) as Awaited<ReturnType<typeof this.client.messages.create>>;

        const raw = (message as { content: Array<{ type: string; text?: string }> }).content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
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
