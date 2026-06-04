import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const DEFAULT_FROM = 'fork ai <hello@forkai.in>';

interface SendParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ses: SESClient;

  constructor(private readonly cfg: ConfigService) {
    this.ses = new SESClient({ region: this.cfg.get<string>('aws.region') ?? 'ap-south-1' });
  }

  // Low-level send. Callers that must not block on email failures should wrap
  // this in their own try/catch and swallow — this rethrows.
  async send(params: SendParams): Promise<void> {
    const body: Record<string, { Data: string; Charset: string }> = {};
    if (params.html) body.Html = { Data: params.html, Charset: 'UTF-8' };
    if (params.text) body.Text = { Data: params.text, Charset: 'UTF-8' };

    await this.ses.send(new SendEmailCommand({
      Source: params.from ?? DEFAULT_FROM,
      Destination: { ToAddresses: Array.isArray(params.to) ? params.to : [params.to] },
      ReplyToAddresses: params.replyTo ? [params.replyTo] : undefined,
      Message: {
        Subject: { Data: params.subject, Charset: 'UTF-8' },
        Body: body,
      },
    }));
  }

  // Fire-and-forget welcome email for a brand-new user. Never throws.
  async sendWelcome(to: string, creditUsd: number): Promise<void> {
    const url = this.cfg.get<string>('frontendUrl') ?? 'https://forkai.in';
    try {
      await this.send({
        to,
        subject: 'Welcome to fork ai 🌱',
        text: welcomeText(creditUsd, url),
        html: welcomeHtml(creditUsd, url),
      });
    } catch (err) {
      this.logger.error(`Welcome email to ${to} failed`, err);
    }
  }

  // Fire-and-forget payment receipt. Never throws.
  async sendPaymentReceipt(to: string, amountUsd: number, paymentId: string): Promise<void> {
    const url = this.cfg.get<string>('frontendUrl') ?? 'https://forkai.in';
    try {
      await this.send({
        to,
        subject: `Your fork ai receipt — $${amountUsd.toFixed(2)} added`,
        text: receiptText(amountUsd, paymentId, url),
        html: receiptHtml(amountUsd, paymentId, url),
      });
    } catch (err) {
      this.logger.error(`Receipt email to ${to} failed`, err);
    }
  }
}

function welcomeText(creditUsd: number, url: string): string {
  return [
    'Welcome to fork ai 🌱',
    '',
    `We've added $${creditUsd.toFixed(2)} of free credit to your account to get you started.`,
    '',
    `Ask a question, then branch any part of the answer to explore deeper — every branch becomes a node on your live mind map.`,
    '',
    `Start exploring: ${url}`,
  ].join('\n');
}

function welcomeHtml(creditUsd: number, url: string): string {
  return shell(`
    <p style="margin:0 0 6px;font-size:22px;font-weight:600;color:#1c1917;letter-spacing:-0.3px;line-height:1.3">
      Welcome to fork ai 🌱
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#78716c;line-height:1.65">
      We've added <strong style="color:#57534e">$${creditUsd.toFixed(2)}</strong> of free credit to get you started. Ask a question, then branch any part of the answer to explore deeper — every branch becomes a node on your live mind map.
    </p>
    ${button('Start exploring', url)}
  `);
}

function receiptText(amountUsd: number, paymentId: string, url: string): string {
  return [
    'Thanks for your top-up!',
    '',
    `Amount added: $${amountUsd.toFixed(2)}`,
    `Payment ID: ${paymentId}`,
    '',
    `Back to fork ai: ${url}`,
  ].join('\n');
}

function receiptHtml(amountUsd: number, paymentId: string, url: string): string {
  return shell(`
    <p style="margin:0 0 6px;font-size:22px;font-weight:600;color:#1c1917;letter-spacing:-0.3px;line-height:1.3">
      Payment received
    </p>
    <p style="margin:0 0 28px;font-size:14px;color:#78716c;line-height:1.65">
      Thanks for your top-up — your credit balance has been updated.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:10px;padding:24px 20px">
          <span style="display:block;font-size:32px;font-weight:700;letter-spacing:-0.5px;color:#1c1917;line-height:1">+ $${amountUsd.toFixed(2)}</span>
          <span style="display:block;margin-top:8px;font-size:12px;color:#a8a29e">Payment ID: ${paymentId}</span>
        </td>
      </tr>
    </table>

    <div style="margin-top:28px">${button('Back to fork ai', url)}</div>
  `);
}

function button(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px;font-weight:600;letter-spacing:-0.2px">${label}</a>`;
}

function shell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>fork ai</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f4;padding:48px 16px">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4">

          <!-- Header -->
          <tr>
            <td style="padding:24px 36px;border-bottom:1px solid #f0efee">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align:middle;padding-right:11px">
                    <img src="https://forkai.in/mark-72.png" width="34" height="34" alt="fork ai" style="display:block;border-radius:8px">
                  </td>
                  <td style="vertical-align:middle">
                    <span style="font-size:18px;font-weight:700;color:#1c1917;letter-spacing:-0.4px">fork ai</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 32px">
              ${inner}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 36px;background:#fafaf9;border-top:1px solid #f0efee">
              <p style="margin:0;font-size:12px;color:#a8a29e;line-height:1.6">
                fork ai &nbsp;·&nbsp;
                <a href="https://forkai.in" style="color:#78716c;text-decoration:none">forkai.in</a>
                &nbsp;·&nbsp;
                <span>This is an automated message — please do not reply.</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
