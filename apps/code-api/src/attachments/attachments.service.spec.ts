import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadGatewayException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';

// 1x1 red pixel PNG.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeCfg(apiKey: string | undefined) {
  return { get: (key: string) => (key === 'groq.apiKey' ? apiKey : undefined) };
}

async function buildService(apiKey: string | undefined): Promise<AttachmentsService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [AttachmentsService, { provide: ConfigService, useValue: makeCfg(apiKey) }],
  }).compile();
  return module.get<AttachmentsService>(AttachmentsService);
}

describe('AttachmentsService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the parsed description on a successful Groq response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'A UI screenshot of a login form.' } }] }),
    }) as unknown as typeof fetch;

    const service = await buildService('test-groq-key');
    const description = await service.describeImage(TINY_PNG_DATA_URL);

    expect(description).toBe('A UI screenshot of a login form.');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-groq-key' }),
      }),
    );
  });

  it('throws ServiceUnavailableException when GROQ_API_KEY is empty', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = await buildService('');

    await expect(service.describeImage(TINY_PNG_DATA_URL)).rejects.toThrow(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws BadGatewayException on a non-200 Groq response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'upstream error',
    }) as unknown as typeof fetch;

    const service = await buildService('test-groq-key');

    await expect(service.describeImage(TINY_PNG_DATA_URL)).rejects.toThrow(BadGatewayException);
  });

  it('throws PayloadTooLargeException for an oversized data URL', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = await buildService('test-groq-key');

    // Base64 of ~5MB of raw bytes — well past the 4MB decoded cap.
    const hugeBase64 = 'A'.repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3));
    const hugeDataUrl = `data:image/png;base64,${hugeBase64}`;

    await expect(service.describeImage(hugeDataUrl)).rejects.toThrow(PayloadTooLargeException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
