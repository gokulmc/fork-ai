import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

const SUPPORT_TO = 'info@stemlabs.co.in';
const SUPPORT_FROM = 'support@forkai.in';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly ses: SESClient;

  constructor(private readonly cfg: ConfigService) {
    this.ses = new SESClient({ region: this.cfg.get<string>('aws.region') ?? 'ap-south-1' });
  }

  async send(dto: CreateSupportTicketDto): Promise<void> {
    const subject = `[fork.ai Support] ${dto.subject} — ${dto.name}`;
    const body = [
      `From: ${dto.name} <${dto.email}>`,
      `Subject: ${dto.subject}`,
      '',
      dto.message,
    ].join('\n');

    try {
      await this.ses.send(new SendEmailCommand({
        Source: SUPPORT_FROM,
        Destination: { ToAddresses: [SUPPORT_TO] },
        ReplyToAddresses: [dto.email],
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }));
    } catch (err) {
      this.logger.error('SES send failed', err);
      throw new InternalServerErrorException('Failed to send support email');
    }
  }
}
