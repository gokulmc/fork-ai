import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { EmailService } from '@/email/email.service';
import type { CreateSupportTicketDto } from './dto/create-support-ticket.dto';

const SUPPORT_TO = 'info@stemlabs.co.in';
const SUPPORT_FROM = 'support@forkai.in';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly email: EmailService) {}

  async send(dto: CreateSupportTicketDto): Promise<void> {
    const subject = `[fork ai Support] ${dto.subject} — ${dto.name}`;
    const body = [
      `From: ${dto.name} <${dto.email}>`,
      `Subject: ${dto.subject}`,
      '',
      dto.message,
    ].join('\n');

    try {
      await this.email.send({
        to: SUPPORT_TO,
        from: SUPPORT_FROM,
        replyTo: dto.email,
        subject,
        text: body,
      });
    } catch (err) {
      this.logger.error('SES send failed', err);
      throw new InternalServerErrorException('Failed to send support email');
    }
  }
}
