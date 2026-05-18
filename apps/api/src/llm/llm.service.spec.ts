import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { LlmService } from './llm.service';

const mockCreate = jest.fn();

// __esModule: true is required so TypeScript's __importDefault interop picks up .default correctly
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const mockCfg = { get: (key: string) => (key === 'anthropic.apiKey' ? 'test-key' : undefined) };

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
  return { content: [{ type: 'text', text: JSON.stringify(json) }] };
}

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(async () => {
    mockCreate.mockReset();
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
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: fenced }] });
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
      await service.expandSection('Root query', 'Section heading', 'Section body text.');
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(prompt).toContain('Root query');
      expect(prompt).toContain('Section heading');
    });
  });

  describe('followUpFromHighlight', () => {
    it('includes highlight and question in prompt', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      await service.followUpFromHighlight('Parent topic', 'highlighted text', 'User question?');
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(prompt).toContain('highlighted text');
      expect(prompt).toContain('User question?');
    });

    it('truncates very long highlights to 800 chars', async () => {
      mockCreate.mockResolvedValue(sdkResponse(validResponse));
      const longText = 'x'.repeat(1000);
      await service.followUpFromHighlight('Parent', longText, 'Q?');
      const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
      expect(prompt).not.toContain('x'.repeat(801));
    });
  });

  describe('parseJson (via answerQuery)', () => {
    it('throws on missing sections array', async () => {
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"title":"t","emoji":"e","lede":"l"}' }] });
      await expect(service.answerQuery('test')).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('extracts JSON embedded in surrounding prose', async () => {
      const text = 'Here is the answer: ' + JSON.stringify(validResponse) + ' Hope that helps!';
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: text }] });
      const result = await service.answerQuery('test');
      expect(result.sections).toHaveLength(2);
    });
  });
});
