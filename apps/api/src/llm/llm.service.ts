import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LlmResponse, LlmSection, LlmUsage, CitationSource } from './llm.types';

export type StreamEvent =
  | { type: 'meta'; title: string; emoji: string; lede: string }
  | { type: 'section'; heading: string; body: string }
  | { type: 'done'; usage: LlmUsage };

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

const WEB_SEARCH_GUIDANCE = `You have access to a web search tool. Use it only when the question genuinely requires information that may have changed after your training cutoff — current events, recent developments, live prices, newly released products, or breaking news. For foundational concepts, historical facts, established science, or explanations you already know well, answer directly from your knowledge without searching.`;

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

Each section "body" should be 80-180 words. You MAY use GitHub-flavored markdown when it strengthens the explanation: paragraphs, **bold**, *italic*, \`inline code\`, fenced code blocks, tables, ordered/unordered lists, and > blockquotes. Use prose by default. Escape any double-quotes inside JSON strings.${webSearch ? `\n\n${WEB_SEARCH_GUIDANCE}\n\n${CITATION_NOTE}` : ''}`;

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
    const finalMsgPromise = stream.finalMessage();

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

    const finalMsg = await finalMsgPromise;
    yield { type: 'done', usage: { inputTokens: finalMsg.usage.input_tokens, outputTokens: finalMsg.usage.output_tokens } };
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

  async getTrendingTopics(): Promise<string[]> {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = `Today is ${today}. Use web search to find 4 compelling, specific research questions that are trending RIGHT NOW in science, technology, or politics/world affairs.

Return ONLY valid JSON, no prose, no markdown fences:
{
  "topics": [
    "Question one?",
    "Question two?",
    "Question three?",
    "Question four?"
  ]
}

Rules:
- Each question must be about something newsworthy within the last 2 weeks — not evergreen
- Phrase as a question a curious reader would type into a research tool (5-12 words)
- Mix: roughly 2 science/technology + 2 politics/world affairs
- Be specific: name the technology, event, or actor (e.g. "What is OpenAI's new o3 model?" not "How does AI work?")`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any = {
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    };

    const message = await this.client.messages.create(params);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = (message as any).content ?? [];
    const raw = blocks
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');

    let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    const parsed = JSON.parse(text) as { topics: string[] };
    if (!Array.isArray(parsed.topics)) throw new Error('Invalid topics response shape');
    return parsed.topics.slice(0, 4);
  }

  private async callJson(prompt: string, webSearch = false, retries = 1): Promise<LlmResponse> {
    const fullPrompt = webSearch ? `${prompt}\n\n${WEB_SEARCH_GUIDANCE}\n\n${CITATION_NOTE}` : prompt;
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
        const message = await this.client.messages.create(params);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blocks: any[] = (message as any).content ?? [];

        const raw: string = blocks
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text ?? '')
          .join('');

        const result = this.parseJson(raw);
        result.usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
        if (webSearch) {
          const allSources = this.extractAllSources(blocks);
          if (allSources.length) {
            const cited = this.processCitations(result.sections, allSources);
            result.sections = cited.sections;
            if (cited.sources.length) result.sources = cited.sources;
          }
        }
        return result;
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(`LLM attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    throw new InternalServerErrorException(`LLM call failed: ${lastError?.message}`);
  }

  // Collect all web search results (title + url) in order from all tool result blocks.
  // The <cite index="N-..."> first number is the 1-based index into this list.
  private extractAllSources(blocks: Array<{ type: string; content?: unknown[] }>): CitationSource[] {
    const sources: CitationSource[] = [];
    for (const block of blocks) {
      if (block.type !== 'web_search_tool_result') continue;
      for (const item of (block.content ?? []) as Array<{ type: string; title?: string; url?: string }>) {
        if (item.type === 'web_search_result' && item.title && item.url) {
          sources.push({ title: item.title, url: item.url });
        }
      }
    }
    return sources;
  }

  // Process all sections in one pass with a shared footnote map so that:
  // - numbering is sequential across all sections in order of first appearance
  // - only sources that are actually cited in the text are included in the output
  private processCitations(
    sections: LlmSection[],
    allSources: CitationSource[],
  ): { sections: LlmSection[]; sources: CitationSource[] } {
    const docToFootnote = new Map<number, number>();
    let nextFootnote = 1;

    const processed = sections.map(s => ({
      ...s,
      body: s.body.replace(
        /<cite\s+index="([^"]+)">([^<]*)<\/cite>/g,
        (_match, indexAttr: string, text: string) => {
          const docIdx = parseInt(indexAttr.split('-')[0], 10);
          if (docIdx < 1 || docIdx > allSources.length) return text;
          if (!docToFootnote.has(docIdx)) {
            docToFootnote.set(docIdx, nextFootnote++);
          }
          const fn = docToFootnote.get(docIdx)!;
          const url = allSources[docIdx - 1].url;
          return `${text}<sup class="cite-ref"><a href="${url}" target="_blank" rel="noopener noreferrer">[${fn}]</a></sup>`;
        },
      ),
    }));

    // Build cited-only sources array ordered by footnote number (1-based)
    const citedSources: CitationSource[] = new Array(docToFootnote.size);
    docToFootnote.forEach((footnoteNum, docIdx) => {
      citedSources[footnoteNum - 1] = allSources[docIdx - 1];
    });

    return { sections: processed, sources: citedSources };
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
