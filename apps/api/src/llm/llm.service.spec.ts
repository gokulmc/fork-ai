import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
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
    key === 'anthropic.apiKey' || key === 'gemini.apiKey' ? 'test-key' : undefined,
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
