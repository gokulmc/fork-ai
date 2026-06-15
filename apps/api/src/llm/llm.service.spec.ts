import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException, UnprocessableEntityException } from '@nestjs/common';
import { LlmService } from './llm.service';

const mockCreate = jest.fn();
const mockStream = jest.fn();
const mockGenerate = jest.fn();

// __esModule: true is required so TypeScript's __importDefault interop picks up .default correctly
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate, stream: mockStream },
  })),
}));

jest.mock('@google/genai', () => ({
  __esModule: true,
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerate },
  })),
}));

const mockCfg = {
  get: (key: string) =>
    key === 'anthropic.apiKey' || key === 'gemini.apiKey' || key === 'deepseek.apiKey' ? 'test-key' : undefined,
};

const USAGE = { input_tokens: 100, output_tokens: 50 };

const validResponse = {
  title: 'Test Title',
  emoji: '🧠',
  lede: 'One sentence.',
  sections: [
    { heading: 'Section One', body: 'Body text here.' },
    { heading: 'Section Two', body: 'More body text.' },
  ],
};

function sdkResponse(json: object) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }], usage: USAGE };
}

// Gemini SDK response: text is a getter, usage in usageMetadata.
function geminiResponse(json: object, groundingMetadata?: object) {
  return {
    text: JSON.stringify(json),
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    candidates: groundingMetadata ? [{ groundingMetadata }] : [{}],
  };
}

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    mockCreate.mockReset();
    mockGenerate.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [LlmService, { provide: ConfigService, useValue: mockCfg }],
    }).compile();
    service = module.get<LlmService>(LlmService);
  });

  describe('answerQuery', () => {
    it('parses a clean JSON response', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      const result = await service.answerQuery('What is ML?');
      expect(result.title).toBe('Test Title');
      expect(result.sections).toHaveLength(2);
    });

    it('strips markdown code fences', async () => {
      const fenced = '```json\n' + JSON.stringify(validResponse) + '\n```';
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: fenced }], usage: USAGE });
      const result = await service.answerQuery('test');
      expect(result.emoji).toBe('🧠');
    });

    it('retries once on failure then throws', async () => {
      mockCreate.mockRejectedValue(new Error('network error'));
      await expect(service.answerQuery('test')).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('succeeds on second attempt after first failure', async () => {
      mockCreate
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(sdkResponse(validResponse));
      const result = await service.answerQuery('test');
      expect(result.lede).toBe('One sentence.');
    });
  });

  describe('expandSection', () => {
    it('calls LLM with heading and body context', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      await service.expandSection(
        [{ title: 'Neural Nets', query: 'What is ML?' }],
        'Section heading',
        'Section body text.',
      );
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(prompt).toContain('What is ML?');
      expect(prompt).toContain('Section heading');
    });
  });

  describe('followUpFromHighlight', () => {
    it('includes highlight and question in prompt', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      await service.followUpFromHighlight(
        [{ title: 'Parent topic', query: 'Parent query' }],
        'highlighted text',
        'User question?',
      );
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(prompt).toContain('highlighted text');
      expect(prompt).toContain('User question?');
    });

    it('truncates very long highlights to 800 chars', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      const longText = 'x'.repeat(1000);
      await service.followUpFromHighlight([{ title: 'P', query: 'Q' }], longText, 'Q?');
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(prompt).not.toContain('x'.repeat(801));
    });
  });

  describe('web search / citations', () => {
    it('injects web_search tool when webSearch=true', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      await service.answerQuery('test', 4, true);
      const params = mockCreate.mock.calls[0][0];
      expect(params.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'web_search_20250305' })]),
      );
    });

    it('does not inject tool when webSearch=false', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      await service.answerQuery('test', 4, false);
      const params = mockCreate.mock.calls[0][0];
      expect(params.tools).toBeUndefined();
    });

    it('processes <cite> tags into numbered superscripts and returns cited sources', async () => {
      const responseWithCite = {
        ...validResponse,
        sections: [
          { heading: 'S1', body: 'Text <cite index="1-0">fact one</cite> here.' },
          { heading: 'S2', body: 'Other <cite index="2-0">fact two</cite> end.' },
        ],
      };
      const blocks = [
        {
          type: 'web_search_tool_result',
          content: [
            { type: 'web_search_result', title: 'Source A', url: 'https://a.com' },
            { type: 'web_search_result', title: 'Source B', url: 'https://b.com' },
          ],
        },
        { type: 'text', text: JSON.stringify(responseWithCite) },
      ];
      mockCreate.mockResolvedValue({ content: blocks, usage: USAGE });
      const result = await service.answerQuery('test', 4, true);
      expect(result.sections[0].body).toContain('cite-ref');
      expect(result.sections[0].body).toContain('[1]');
      expect(result.sections[1].body).toContain('[2]');
      expect(result.sources).toHaveLength(2);
      expect(result.sources![0].url).toBe('https://a.com');
      expect(result.sources![1].url).toBe('https://b.com');
    });

    it('discards uncited sources from the output list', async () => {
      const responseOneCite = {
        ...validResponse,
        sections: [{ heading: 'S1', body: '<cite index="1-0">fact</cite>.' }],
      };
      const blocks = [
        {
          type: 'web_search_tool_result',
          content: [
            { type: 'web_search_result', title: 'Used', url: 'https://used.com' },
            { type: 'web_search_result', title: 'Unused', url: 'https://unused.com' },
          ],
        },
        { type: 'text', text: JSON.stringify(responseOneCite) },
      ];
      mockCreate.mockResolvedValue({ content: blocks, usage: USAGE });
      const result = await service.answerQuery('test', 4, true);
      expect(result.sources).toHaveLength(1);
      expect(result.sources![0].url).toBe('https://used.com');
    });

    // REGRESSION: a long web search makes Anthropic return stop_reason 'pause_turn'
    // with no final answer yet. Pre-fix the provider made a single call, got no JSON,
    // and parseJson failed into "The AI returned an unreadable answer". The provider
    // must feed the paused content back and finish the turn.
    it('continues a paused web-search turn (pause_turn) instead of failing as unreadable', async () => {
      const paused = {
        content: [
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'x' } },
          {
            type: 'web_search_tool_result',
            content: [{ type: 'web_search_result', title: 'Src', url: 'https://src.com' }],
          },
        ],
        usage: USAGE,
        stop_reason: 'pause_turn',
      };
      const finished = {
        content: [{ type: 'text', text: JSON.stringify({
          ...validResponse,
          sections: [{ heading: 'S1', body: '<cite index="1-0">fact</cite>.' }],
        }) }],
        usage: USAGE,
        stop_reason: 'end_turn',
      };
      mockCreate.mockResolvedValueOnce(paused).mockResolvedValueOnce(finished);

      const result = await service.answerQuery('latest news?', 4, true);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      // The second call carries the paused assistant turn so the model can resume.
      const secondMessages = mockCreate.mock.calls[1][0].messages;
      expect(secondMessages).toHaveLength(2);
      expect(secondMessages[1].role).toBe('assistant');
      // Sources surfaced across the paused + finished turns; usage is summed.
      expect(result.sources).toHaveLength(1);
      expect(result.sources![0].url).toBe('https://src.com');
      expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100 });
    });

    // REGRESSION: a failed web search returns the tool_result block with `content`
    // as an error OBJECT, not a results array. Iterating it threw "object is not
    // iterable", crashing the whole branch call so no node was ever persisted.
    it('does not crash when a web_search_tool_result is an error object', async () => {
      const blocks = [
        { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
        { type: 'text', text: JSON.stringify(validResponse) },
      ];
      mockCreate.mockResolvedValue({ content: blocks, usage: USAGE, stop_reason: 'end_turn' });
      const result = await service.answerQuery('latest?', 4, true);
      expect(result.title).toBe('Test Title');
      expect(result.sections).toHaveLength(2);
      expect(result.sources).toBeUndefined(); // no usable sources from a failed search
    });

    it('cite superscript contains anchor with correct href', async () => {
      const responseWithCite = {
        ...validResponse,
        sections: [{ heading: 'S1', body: '<cite index="1-0">claim</cite>.' }],
      };
      const blocks = [
        {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', title: 'Ref', url: 'https://ref.example.com' }],
        },
        { type: 'text', text: JSON.stringify(responseWithCite) },
      ];
      mockCreate.mockResolvedValue({ content: blocks, usage: USAGE });
      const result = await service.answerQuery('test', 4, true);
      expect(result.sections[0].body).toContain('href="https://ref.example.com"');
    });
  });

  describe('gemini provider (branch calls)', () => {
    it('routes a gemini-flash model to the Gemini SDK, not Anthropic', async () => {
      mockGenerate.mockResolvedValue(geminiResponse(validResponse));
      const result = await service.expandSection(
        [{ title: 'T', query: 'Q' }], 'Heading', 'Body', 4, false, 'gemini-2.5-flash',
      );
      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.title).toBe('Test Title');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('uses JSON mode when webSearch is off (no grounding tool)', async () => {
      mockGenerate.mockResolvedValue(geminiResponse(validResponse));
      await service.expandSection([{ title: 'T', query: 'Q' }], 'H', 'B', 4, false, 'gemini-2.5-flash');
      const { config } = mockGenerate.mock.calls[0][0];
      expect(config.responseMimeType).toBe('application/json');
      expect(config.tools).toBeUndefined();
    });

    it('enables googleSearch grounding and omits JSON mode when webSearch is on', async () => {
      mockGenerate.mockResolvedValue(geminiResponse(validResponse));
      await service.expandSection([{ title: 'T', query: 'Q' }], 'H', 'B', 4, true, 'gemini-2.5-flash');
      const { config } = mockGenerate.mock.calls[0][0];
      expect(config.tools).toEqual([{ googleSearch: {} }]);
      expect(config.responseMimeType).toBeUndefined();
    });

    it('maps grounding metadata to footnotes and cited sources', async () => {
      const grounded = {
        ...validResponse,
        sections: [{ heading: 'S1', body: 'Solar output rose sharply last year.' }],
      };
      const groundingMetadata = {
        groundingChunks: [{ web: { uri: 'https://energy.example', title: 'Energy Report' } }],
        groundingSupports: [
          { segment: { text: 'Solar output rose sharply last year.' }, groundingChunkIndices: [0] },
        ],
      };
      mockGenerate.mockResolvedValue(geminiResponse(grounded, groundingMetadata));
      const result = await service.expandSection([{ title: 'T', query: 'Q' }], 'H', 'B', 4, true, 'gemini-2.5-flash');
      expect(result.sections[0].body).toContain('cite-ref');
      expect(result.sections[0].body).toContain('[1]');
      expect(result.sources).toHaveLength(1);
      expect(result.sources![0].url).toBe('https://energy.example');
    });
  });

  describe('deepseek provider (branch calls)', () => {
    it('routes via the Anthropic-compat client, disables thinking, and drops web search', async () => {
      // DeepSeek uses @anthropic-ai/sdk pointed at its /anthropic endpoint, so it
      // shares the mocked Anthropic client (mockCreate).
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      const result = await service.expandSection(
        [{ title: 'T', query: 'Q' }], 'H', 'B', 4, true, 'deepseek-v4-flash',
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const params = mockCreate.mock.calls[0][0];
      expect(params.model).toBe('deepseek-v4-flash');
      expect(params.thinking).toEqual({ type: 'disabled' });
      expect(params.tools).toBeUndefined(); // web search dropped for DeepSeek
      expect(params.messages[0].content).not.toContain('web search tool'); // guidance not appended
      expect(result.title).toBe('Test Title');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });
  });

  describe('output budget (branch calls)', () => {
    const CLAUDE = 'claude-haiku-4-5-20251001';
    const budgetFor = async (verbose: boolean, authed: boolean, boost: boolean): Promise<number> => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      await service.expandSection([{ title: 'T', query: 'Q' }], 'H', 'B', 4, false, CLAUDE, verbose, authed, boost);
      return mockCreate.mock.calls[0][0].max_tokens;
    };

    it('gives an authed Verbose answer 8192 tokens', async () => {
      expect(await budgetFor(true, true, false)).toBe(8192);
    });

    it('gives an authed Sectioned answer 4096 tokens', async () => {
      expect(await budgetFor(false, true, false)).toBe(4096);
    });

    it('caps a Guest/Trial answer at 2048 tokens regardless of style', async () => {
      expect(await budgetFor(true, false, false)).toBe(2048);
    });

    it('doubles the budget on a boosted authed retry, clamped to 16384', async () => {
      expect(await budgetFor(true, true, true)).toBe(16384); // 8192×2 = 16384 (ceiling)
      mockCreate.mockClear();
      expect(await budgetFor(false, true, true)).toBe(8192); // 4096×2
    });

    it('ignores boost for a Guest (stays at 2048)', async () => {
      expect(await budgetFor(true, false, true)).toBe(2048);
    });
  });

  describe('truncation (Cut-Off)', () => {
    const CLAUDE = 'claude-haiku-4-5-20251001';
    const truncatedSdk = (json: object) => ({ ...sdkResponse(json), stop_reason: 'max_tokens' });

    it('throws UnprocessableEntity with code OUTPUT_TRUNCATED and does not retry', async () => {
      mockCreate.mockResolvedValue(truncatedSdk(validResponse));
      expect.assertions(3);
      try {
        await service.expandSection([{ title: 'T', query: 'Q' }], 'H', 'B', 4, false, CLAUDE, true, true, false);
      } catch (err) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect((err as UnprocessableEntityException).getResponse()).toMatchObject({ code: 'OUTPUT_TRUNCATED' });
      }
      expect(mockCreate).toHaveBeenCalledTimes(1); // deterministic — no retry
    });
  });

  describe('parseJson (via answerQuery)', () => {
    it('throws on missing sections array', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"title":"t","emoji":"e","lede":"l"}' }], usage: USAGE });
      await expect(service.answerQuery('test')).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('extracts JSON embedded in surrounding prose', async () => {
      const text = 'Here is the answer: ' + JSON.stringify(validResponse) + ' Hope that helps!';
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: text }], usage: USAGE });
      const result = await service.answerQuery('test');
      expect(result.sections).toHaveLength(2);
    });
  });
});
