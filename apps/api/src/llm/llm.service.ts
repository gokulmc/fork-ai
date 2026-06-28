import { HttpException, Injectable, InternalServerErrorException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LlmResponse, LlmSection, LlmUsage, CitationSource, OutlineNode, DocumentOutline } from './llm.types';
import { ROOT_MODEL, BRANCH_DEFAULT_MODEL, providerNameFor, ProviderName, supportsWebSearch, outputBudget, NON_STREAMING_MAX_TOKENS } from './models';
import { LlmProvider } from './providers/provider.types';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { GlmProvider } from './providers/glm.provider';
import { extractAnthropicSources, processCitations, sanitizeGlmSources, processGlmCitations, applyGeminiGrounding, GeminiGroundingMetadata } from './citations';

export type StreamEvent =
  | { type: 'meta'; title: string; emoji: string; lede: string }
  | { type: 'section'; heading: string; body: string }
  | { type: 'done'; usage: LlmUsage; sections?: LlmSection[]; sources?: CitationSource[] };

// Map raw provider/SDK failures to a short, safe reason the UI can show next
// to its Retry button. Never leaks keys, URLs, or stack traces.
export function friendlyLlmError(err?: Error): string {
  const msg = err?.message ?? '';
  const status = (err as { status?: number; statusCode?: number } | undefined)?.status
    ?? (err as { status?: number; statusCode?: number } | undefined)?.statusCode;
  if (status === 429 || /rate.?limit/i.test(msg)) return 'The AI provider is rate-limiting requests';
  if (status === 529 || /overloaded/i.test(msg)) return 'The AI model is overloaded right now';
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(msg)) return 'The AI provider took too long to respond';
  if (/json|parse/i.test(msg)) return 'The AI returned an unreadable answer';
  if (status === 401 || status === 403) return 'The AI provider rejected the request';
  return 'The AI request failed';
}

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

// Prepended to every prompt once the user has saved a persona. Empty (inert)
// until then, so behaviour is unchanged for anyone who never sets one.
const personaPreamble = (persona?: string): string =>
  persona && persona.trim()
    ? `The person you are helping has described how they'd like you to respond:
"${persona.trim()}"
Keep this in mind throughout — match the requested tone and tailor depth, examples, and framing to them. Still obey all formatting and JSON-shape rules below.

`
    : '';

// Soft nudge so nearby branches don't all land on the same emoji (e.g. 🧠).
const avoidEmojiNote = (usedEmojis: string[]): string =>
  usedEmojis.length
    ? `\n\nThe "emoji" must be a DISTINCT single emoji — do NOT reuse any of these already used by sibling or ancestor topics: ${usedEmojis.join(' ')}.`
    : '';

const CITATION_NOTE = `When you use web search results, cite sources inline as plain text — e.g. (Source: Name) or a bracketed number like [1] — never wrap cited sentences or paragraphs in *asterisks* or _underscores_. Do not italicise entire sentences to indicate attribution.`;

// GLM's endpoint returns no structured search results, so we make GLM self-report
// them: number cited claims inline ([1], [2], … in order of first use) AND list each
// source in a top-level "sources" array aligned to those numbers. processGlmCitations
// then turns the [N] markers into the same superscript footnotes used for Claude/Gemini.
const GLM_CITATION_NOTE = `When you use web search results, cite them. Mark each sourced claim inline with a sequential bracketed number in order of first appearance: [1], [2], [3], and so on. Then add a top-level "sources" field to your JSON — an array of {"title": "...", "url": "..."} objects, where the first entry is the source for [1], the second for [2], etc. List only sources you actually cite, in citation order. Never wrap cited text in *asterisks* or _underscores_.`;

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

// Branch answers (Go Deeper / Ask AI) are NOT sectioned — they read as one
// flowing essay. We still return the section array shape so the rest of the
// pipeline (parseJson, citations, persistence, highlights keyed by sectionId)
// is unchanged: exactly one section, empty heading, the whole answer in body.
const VERBOSE_SCHEMA = `Return ONLY valid JSON, no prose, no markdown fences. Shape:
{
  "title": "<=5 words capturing topic",
  "emoji": "single emoji that best represents this topic",
  "lede": "one sentence framing the answer (max 25 words)",
  "sections": [
    { "heading": "", "body": "the entire answer as rich GitHub-flavored markdown" }
  ]
}
Return EXACTLY ONE item in the "sections" array, with an empty "heading". Put the WHOLE answer in that single "body", formatted as rich GitHub-flavored markdown exactly like a chat assistant replies: use markdown headings (## / ###), **bold**, *italic*, bullet and numbered lists, tables, > blockquotes, and fenced code blocks wherever they aid clarity. Do NOT add more than one entry to the "sections" array — the markdown structure lives entirely inside the one body. The double-quotes and newlines inside the body must be valid JSON-escaped (\\" and \\n).`;

@Injectable()
export class LlmService {
  private readonly client: Anthropic;
  private readonly providers: Record<ProviderName, LlmProvider>;
  // Typed reference to the Gemini provider so the streaming root-query path can
  // call generateContentStream() without going through the LlmProvider interface
  // (which only exposes the non-streaming complete()). The same instance is also
  // registered in providers for branch calls.
  private readonly gemini: GeminiProvider;
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly cfg: ConfigService) {
    this.client = new Anthropic({ apiKey: cfg.get<string>('anthropic.apiKey') });
    this.gemini = new GeminiProvider(() => cfg.get<string>('gemini.apiKey'));
    this.providers = {
      anthropic: new AnthropicProvider(this.client),
      gemini: this.gemini,
      deepseek: new DeepSeekProvider(() => cfg.get<string>('deepseek.apiKey')),
      glm: new GlmProvider(() => cfg.get<string>('glm.apiKey')),
    };
  }

  private providerFor(modelId: string): LlmProvider {
    return this.providers[providerNameFor(modelId)];
  }

  async *streamAnswerQuery(query: string, sectionCount = 5, webSearch = false, persona?: string): AsyncGenerator<StreamEvent> {
    const prompt = `${personaPreamble(persona)}You are a research assistant. Answer this query as a structured study note with ${sectionCount} sections.

Query: "${query}"

${SECTIONS_SCHEMA}

Each section "body" should be 80-180 words. You MAY use GitHub-flavored markdown when it strengthens the explanation: paragraphs, **bold**, *italic*, \`inline code\`, fenced code blocks, tables, ordered/unordered lists, and > blockquotes. Use prose by default. Escape any double-quotes inside JSON strings.${webSearch ? `\n\n${WEB_SEARCH_GUIDANCE}\n\n${CITATION_NOTE}` : ''}`;

    let accumulated = '';
    let metaEmitted = false;
    let emittedCount = 0;

    // All root-query behaviour is controlled by ROOT_MODEL. Switching that constant
    // back to a Claude id automatically re-routes streaming to the Anthropic branch.
    if (providerNameFor(ROOT_MODEL) === 'gemini') {
      // --- Gemini streaming path ---
      const stream = await this.gemini.generateContentStream(prompt, {
        model: ROOT_MODEL,
        maxTokens: 4096,
        webSearch,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastChunk: any;
      for await (const chunk of stream) {
        accumulated += chunk.text ?? '';
        lastChunk = chunk;

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const um = (lastChunk as any)?.usageMetadata;
      const usage = {
        inputTokens: (um?.promptTokenCount ?? 0) as number,
        outputTokens: (um?.candidatesTokenCount ?? 0) as number,
      };

      // Citations: Gemini grounding metadata arrives on the final chunk.
      let processedSections: LlmSection[] | undefined;
      let sources: CitationSource[] | undefined;
      if (webSearch) {
        const groundingMeta = lastChunk?.candidates?.[0]?.groundingMetadata as GeminiGroundingMetadata | undefined;
        if (groundingMeta?.groundingSupports?.length && groundingMeta?.groundingChunks?.length) {
          try {
            const full = this.parseJson(accumulated);
            const cited = applyGeminiGrounding(full.sections, groundingMeta);
            processedSections = cited.sections;
            if (cited.sources.length) sources = cited.sources;
          } catch (err) {
            this.logger.warn(`Gemini citation post-processing failed: ${(err as Error).message}`);
          }
        }
      }

      yield { type: 'done', usage, sections: processedSections, sources };

    } else {
      // --- Anthropic streaming path (default when ROOT_MODEL is a Claude id) ---
      const streamParams: Parameters<typeof this.client.messages.stream>[0] = {
        model: ROOT_MODEL,
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

      // Citations can only be resolved once the full message (with web_search_tool_result
      // blocks) is known. Sections streamed above still carry the raw <cite> tags; emit the
      // processed bodies + cited sources here so the persist/UI layer can swap them in.
      let processedSections: LlmSection[] | undefined;
      let sources: CitationSource[] | undefined;
      if (webSearch) {
        const blocks = ((finalMsg as unknown as { content?: unknown[] }).content ?? []) as Array<{ type: string; content?: unknown[] }>;
        const allSources = extractAnthropicSources(blocks);
        if (allSources.length) {
          try {
            const full = this.parseJson(accumulated);
            const cited = processCitations(full.sections, allSources);
            processedSections = cited.sections;
            if (cited.sources.length) sources = cited.sources;
          } catch (err) {
            this.logger.warn(`Citation post-processing failed: ${(err as Error).message}`);
          }
        }
      }

      yield {
        type: 'done',
        usage: { inputTokens: finalMsg.usage.input_tokens, outputTokens: finalMsg.usage.output_tokens },
        sections: processedSections,
        sources,
      };
    }
  }

  async answerQuery(query: string, sectionCount = 4, webSearch = false, persona?: string): Promise<LlmResponse> {
    const prompt = `${personaPreamble(persona)}You are a research assistant. Answer this query as a structured study note. Use as many sections as the topic genuinely warrants — no more than ${sectionCount}. Do not pad with redundant or filler sections; fewer is better when the topic is focused.

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
    model: string = BRANCH_DEFAULT_MODEL,
    verbose = false,
    authed = false,
    boost = false,
    usedEmojis: string[] = [],
    persona?: string,
  ): Promise<LlmResponse> {
    const trail = ancestors
      .map((a, i) => `${ i === 0 ? 'Root query' : 'Sub-topic'}: "${a.query}" → "${a.title}"`)
      .join('\n');
    const intro = `${personaPreamble(persona)}You are continuing a branching research session. Research trail (root → current):
${trail}

Go DEEPER on the section titled "${sectionHeading}" within this context.
Section content for reference: "${sectionBody.slice(0, 400)}"`;

    const prompt = verbose
      ? `${intro}

Write a thorough, well-structured deep-dive — like a chat assistant answering in depth. Use rich markdown (headings, lists, bold, code, tables) inside one continuous answer, NOT the app's section cards. Stay relevant to the full research trail.

${VERBOSE_SCHEMA}

The "title" should be a 5-word-max phrase capturing the deep dive.`
      : `${intro}

Produce a focused deep-dive with as many sections as the topic warrants — no more than ${sectionCount}. Do not pad; fewer sections is better when the scope is narrow. Each section should be 80-180 words. Stay relevant to the full research trail.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the deep dive. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt + avoidEmojiNote(usedEmojis), webSearch, model, { authed, verbose, boost });
  }

  async followUpFromHighlight(
    ancestors: Array<{ title: string; query: string }>,
    highlight: string,
    question: string,
    sectionCount = 4,
    webSearch = false,
    model: string = BRANCH_DEFAULT_MODEL,
    verbose = false,
    authed = false,
    boost = false,
    usedEmojis: string[] = [],
    persona?: string,
  ): Promise<LlmResponse> {
    const trail = ancestors
      .map((a, i) => `${i === 0 ? 'Root query' : 'Sub-topic'}: "${a.query}" → "${a.title}"`)
      .join('\n');
    const intro = `${personaPreamble(persona)}You are continuing a branching research session. Research trail (root → current):
${trail}

The user highlighted this passage: "${highlight.slice(0, 800)}"
They asked: "${question}"`;

    const prompt = verbose
      ? `${intro}

Answer thoroughly — like a chat assistant replying in depth. Use rich markdown (headings, lists, bold, code, tables) inside one continuous answer, NOT the app's section cards. Keep the answer grounded in the research trail context.

${VERBOSE_SCHEMA}

The "title" should be a 5-word-max phrase capturing the answer topic.`
      : `${intro}

Answer with as many sections as the question warrants — no more than ${sectionCount}. Do not pad; fewer sections is better when the answer is focused. Each section should be 80-180 words. Keep the answer grounded in the research trail context.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the answer topic. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt + avoidEmojiNote(usedEmojis), webSearch, model, { authed, verbose, boost });
  }

  // ── Document → mind-map ───────────────────────────────────────────────────
  // Read the uploaded document ONCE and design the whole tree: a root overview
  // plus descendant topics, each with an information-dense `description`. The
  // per-node content pass (generateFromBrief) expands those descriptions without
  // re-reading the document. Always runs on ROOT_MODEL (strong comprehension).
  async extractDocumentOutline(
    documentText: string,
    maxNodes = 8,
    model: string = ROOT_MODEL,
  ): Promise<DocumentOutline> {
    const prompt = `You are building a mind map from a document. Read it and design a TREE of topics.

DOCUMENT:
"""
${documentText}
"""

Return ONLY valid JSON, no prose, no markdown fences. Shape:
{
  "title": "<=5 words naming the document's overall subject",
  "emoji": "single emoji for the whole document",
  "lede": "one sentence (max 25 words) framing the document",
  "rootDescription": "3-5 sentence DENSE overview of the whole document: its thesis, scope, and main takeaways — enough to write an overview without re-reading",
  "nodes": [
    {
      "tempId": "short id you assign, e.g. t1",
      "parentTempId": "tempId of the parent topic, or null to attach directly under the root",
      "title": "<=5 words naming this subtopic",
      "emoji": "single distinct emoji",
      "description": "2-4 sentence INFORMATION-DENSE brief of what the document says about THIS subtopic: key claims, terms, figures, facts — enough for a later step to expand it into full prose without re-reading the document"
    }
  ]
}

Rules:
- Produce between 3 and ${maxNodes} subtopic nodes. Let the document's structure decide the count and shape — do not pad.
- Build a real TREE up to 3 levels deep: nest a node under another by setting its parentTempId to that node's tempId; attach top-level themes directly under the root with parentTempId null. Not every node needs children.
- Every emoji must be a single DISTINCT emoji — do not repeat one across nodes.
- Descriptions must be self-contained and factual to the document; the expansion step will NOT see the document, only your description.`;

    const { rawText, usage, truncated } = await this.providerFor(model).complete(prompt, {
      model,
      maxTokens: 4096,
      webSearch: false,
    });
    if (truncated) {
      throw new UnprocessableEntityException({
        message: 'The document outline was cut off — the document may be too large',
        code: 'OUTPUT_TRUNCATED',
      });
    }
    return { ...this.parseOutline(rawText), usage };
  }

  // Expand one outline topic into a full sectioned note, grounded ONLY in its
  // brief + ancestor briefs (the raw document is never re-sent). Reuses the
  // shared callJson path so budgets, parsing, and citations behave like a branch.
  async generateFromBrief(
    ancestors: Array<{ title: string; description: string }>,
    title: string,
    description: string,
    sectionCount = 4,
    webSearch = false,
    model: string = BRANCH_DEFAULT_MODEL,
    verbose = false,
    authed = false,
    persona?: string,
  ): Promise<LlmResponse> {
    const trail = ancestors.length
      ? `Context trail (document → parent topic):\n${ancestors
          .map((a, i) => `${i === 0 ? 'Document' : 'Subtopic'}: "${a.title}" — ${a.description}`)
          .join('\n')}\n\n`
      : 'This is the ROOT overview note of a mind map built from a document.\n\n';

    const intro = `${personaPreamble(persona)}You are writing one note in a mind map built from a document. ${trail}Write the note for the topic "${title}".
Source brief — cover exactly this, expanding it faithfully into full prose; do NOT invent facts beyond it, and do NOT repeat what ancestor topics already covered:
"${description}"`;

    const prompt = verbose
      ? `${intro}

Write a thorough, well-structured note — like a chat assistant answering in depth. Use rich markdown (headings, lists, bold, code, tables) inside one continuous answer, NOT the app's section cards.

${VERBOSE_SCHEMA}

The "title" should be a 5-word-max phrase capturing the topic.`
      : `${intro}

Produce a focused note with as many sections as the brief warrants — no more than ${sectionCount}. Do not pad; fewer sections is better when the scope is narrow. Each section should be 80-180 words.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the topic. Escape double-quotes inside JSON strings.`;

    return this.callJson(prompt, webSearch, model, { authed, verbose });
  }

  async mixNodes(
    ancestors: Array<{ title: string; query: string }>,
    sourceNodes: Array<{ title: string; sections: Array<{ heading: string; body: string }> }>,
    question: string,
    sectionCount = 4,
    model: string = BRANCH_DEFAULT_MODEL,
    authed = false,
    usedEmojis: string[] = [],
    persona?: string,
  ): Promise<LlmResponse> {
    const trail = ancestors
      .map((a, i) => `${i === 0 ? 'Root query' : 'Sub-topic'}: "${a.query}" → "${a.title}"`)
      .join('\n');

    const nodeBlocks = sourceNodes
      .map((n, i) => {
        const sections = n.sections
          .map((s) => `  ${s.heading ? `**${s.heading}**: ` : ''}${s.body.slice(0, 600)}`)
          .join('\n');
        return `Branch ${i + 1}: "${n.title}"\n${sections}`;
      })
      .join('\n\n');

    const prompt = `${personaPreamble(persona)}You are a synthesis research assistant. Your task is to combine insights from multiple research branches into one coherent answer.

Research trail (root → base node):
${trail}

The user selected ${sourceNodes.length} branch${sourceNodes.length > 1 ? 'es' : ''} to synthesize:

${nodeBlocks}

The user's synthesis question: "${question}"

Synthesize a focused answer that weaves together the key insights from all branches above, drawing on their shared themes, contrasts, and connections. Stay grounded in the research trail context.

Produce a focused synthesis with as many sections as the question warrants — no more than ${sectionCount}. Each section should be 80-180 words.

${SECTIONS_SCHEMA}

You MAY use GitHub-flavored markdown. The "title" should be a 5-word-max phrase capturing the synthesis. Escape double-quotes inside JSON strings.`;

    // MIX calls always run at the non-streaming ceiling — they consume more input
    // tokens (up to 6 nodes of content) and need room to produce a rich synthesis.
    const provider = this.providerFor(model);
    const { rawText, usage, truncated } = await provider.complete(
      prompt + avoidEmojiNote(usedEmojis),
      { model, maxTokens: NON_STREAMING_MAX_TOKENS, webSearch: false },
    );

    if (truncated) {
      throw new UnprocessableEntityException({
        message: 'The synthesis answer was cut off — it hit the length limit',
        code: 'OUTPUT_TRUNCATED',
      });
    }

    const result = this.parseJson(rawText);
    result.usage = usage;
    return result;
  }

  async getTrendingTopics(): Promise<string[]> {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = `Today is ${today}. Use web search to find 4 trending topics from RIGHT NOW in science, technology, or politics/world affairs.

Return ONLY valid JSON, no prose, no markdown fences:
{
  "topics": [
    "Question one",
    "Question two",
    "Question three",
    "Question four"
  ]
}

Rules:
- Each topic is a full, natural question a curious person would ask
- Must be newsworthy within the last 2 weeks, not evergreen
- Mix: roughly 2 science/technology + 2 politics/world affairs
- Name the specific thing: "How does OpenAI's o3 reasoning model work?", "What's in the new Iran nuclear deal?" — not "AI advances" or "Middle East conflict"`;

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

  // Pick a single emoji for a user-submitted blog post. Cheap, best-effort —
  // falls back to a default so a submission never fails on this.
  async pickEmoji(title: string, body: string): Promise<string> {
    const prompt = `Pick the single emoji that best represents this blog post. Reply with ONLY the emoji and nothing else.\n\nTitle: ${title}\n\n${body.slice(0, 600)}`;
    try {
      const provider = this.providerFor(ROOT_MODEL);
      const { rawText } = await provider.complete(prompt, { model: ROOT_MODEL, maxTokens: 16, webSearch: false });
      const match = rawText.trim().match(new RegExp('\\p{Extended_Pictographic}(\\uFE0F|\\u200D\\p{Extended_Pictographic})*', 'u'));
      return match ? match[0] : '📝';
    } catch (err) {
      this.logger.warn(`pickEmoji failed: ${(err as Error).message}`);
      return '📝';
    }
  }

  private async callJson(
    prompt: string,
    webSearch = false,
    model: string = ROOT_MODEL,
    opts: { authed?: boolean; verbose?: boolean; boost?: boolean } = {},
    retries = 1,
  ): Promise<LlmResponse> {
    // Drop web search for providers that don't support it (DeepSeek) — no
    // grounding tool, so don't append the web-search guidance/citation prompt.
    const ws = webSearch && supportsWebSearch(model);
    const isGlm = providerNameFor(model) === 'glm';
    const citationNote = isGlm ? GLM_CITATION_NOTE : CITATION_NOTE;
    const fullPrompt = ws ? `${prompt}\n\n${WEB_SEARCH_GUIDANCE}\n\n${citationNote}` : prompt;
    const provider = this.providerFor(model);

    // Output budget tiered by auth + answer style. A boosted retry (authed Retry
    // of a Cut-Off) doubles it, clamped to the non-streaming ceiling. See ADR-0009.
    const authed = opts.authed ?? false;
    let maxTokens = outputBudget(authed, opts.verbose ?? false);
    if (opts.boost && authed) maxTokens = Math.min(maxTokens * 2, NON_STREAMING_MAX_TOKENS);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { rawText, usage, applyCitations, truncated } = await provider.complete(fullPrompt, {
          model,
          maxTokens,
          webSearch: ws,
        });
        // A length-limit cut-off is deterministic — retrying at the same budget
        // would just truncate again, so surface it immediately as its own error
        // rather than letting parseJson fail into the generic "unreadable" path.
        if (truncated) {
          throw new UnprocessableEntityException({
            message: 'The answer was cut off — it hit the length limit',
            code: 'OUTPUT_TRUNCATED',
          });
        }
        const result = this.parseJson(rawText);
        result.usage = usage;
        if (ws && applyCitations) {
          const cited = applyCitations(result.sections);
          result.sections = cited.sections;
          if (cited.sources.length) result.sources = cited.sources;
        } else if (ws && isGlm) {
          // GLM has no structured-source hook; it self-reports sources in its JSON,
          // which we validate and then resolve its inline [N] markers against.
          const sources = sanitizeGlmSources((result as { sources?: unknown }).sources);
          if (sources.length) {
            const cited = processGlmCitations(result.sections, sources);
            result.sections = cited.sections;
            // Fall back to the full list if GLM listed sources but didn't number inline.
            result.sources = cited.sources.length ? cited.sources : sources;
          } else {
            delete (result as { sources?: unknown }).sources;
          }
        }
        return result;
      } catch (err) {
        // The truncation error is deterministic — propagate it, don't retry.
        if (err instanceof HttpException) throw err;
        lastError = err as Error;
        this.logger.warn(`LLM attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }

    throw new InternalServerErrorException(friendlyLlmError(lastError));
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

  private parseOutline(raw: string): Omit<DocumentOutline, 'usage'> {
    let text = raw.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    const parsed = JSON.parse(text) as Partial<DocumentOutline>;
    if (!parsed.title || !parsed.lede || !Array.isArray(parsed.nodes)) {
      throw new Error('Invalid document outline shape — missing title/lede/nodes');
    }
    const nodes: OutlineNode[] = parsed.nodes
      .filter((n): n is OutlineNode => !!n && typeof n.tempId === 'string' && typeof n.title === 'string')
      .map((n) => ({
        tempId: n.tempId,
        parentTempId: n.parentTempId ?? null,
        title: n.title,
        emoji: n.emoji || '',
        // Fall back to the title so a node never carries an empty brief into the expansion step.
        description: n.description || n.title,
      }));
    if (!nodes.length) throw new Error('Document outline produced no topics');
    return {
      title: parsed.title,
      emoji: parsed.emoji || '',
      lede: parsed.lede,
      rootDescription: parsed.rootDescription || parsed.lede,
      nodes,
    };
  }
}
