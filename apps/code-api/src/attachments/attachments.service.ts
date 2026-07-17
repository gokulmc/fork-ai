import { BadGatewayException, Injectable, Logger, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DESCRIBE_PROMPT =
  "Describe this image for a software engineer in 2-4 sentences — note whether it's a UI screenshot, diagram, chart, or code, and call out anything relevant to performance or optimisation.";

// Raw fetch against Groq's OpenAI-compatible endpoint, mirroring how the GLM
// provider hand-rolls its request (no extra SDK dep for a single call type).
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(private readonly cfg: ConfigService) {}

  async describeImage(dataUrl: string): Promise<string> {
    this.assertWithinSizeCap(dataUrl);

    const apiKey = this.cfg.get<string>('groq.apiKey');
    if (!apiKey) {
      throw new ServiceUnavailableException('Image description not configured');
    }

    let res: Response;
    try {
      res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GROQ_VISION_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: DESCRIBE_PROMPT },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`Groq request failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadGatewayException('Image description failed');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.error(`Groq request failed (${res.status}): ${detail.slice(0, 500)}`);
      throw new BadGatewayException('Image description failed');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json().catch(() => null);
    const description: string | undefined = json?.choices?.[0]?.message?.content;
    if (!description || typeof description !== 'string' || !description.trim()) {
      this.logger.error(`Groq response missing description content: ${JSON.stringify(json).slice(0, 500)}`);
      throw new BadGatewayException('Image description failed');
    }

    return description.trim();
  }

  private assertWithinSizeCap(dataUrl: string): void {
    const commaIdx = dataUrl.indexOf(',');
    const base64Part = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const padding = base64Part.endsWith('==') ? 2 : base64Part.endsWith('=') ? 1 : 0;
    const decodedBytes = Math.floor((base64Part.length * 3) / 4) - padding;
    if (decodedBytes > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Image exceeds the 4MB limit');
    }
  }
}
