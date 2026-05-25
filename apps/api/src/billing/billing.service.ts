import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { PaymentItem } from '@/dynamo/dynamo.interfaces';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly razorpay: Razorpay;

  constructor(
    private readonly db: DynamoRepository,
    private readonly cfg: ConfigService,
  ) {
    this.razorpay = new Razorpay({
      key_id: this.cfg.get<string>('razorpay.keyId') ?? '',
      key_secret: this.cfg.get<string>('razorpay.keySecret') ?? '',
    });
  }

  async createOrder(sub: string, amountUsd: number): Promise<{
    orderId: string;
    amountInr: number;
    amountUsd: number;
    currency: string;
    keyId: string;
  }> {
    const rate = await this.fetchUsdToInrRate();
    const amountInr = Math.round(amountUsd * rate * 100); // paise

    const order = await this.razorpay.orders.create({
      amount: amountInr,
      currency: 'INR',
      notes: { sub, amountUsd: String(amountUsd) },
    });

    return {
      orderId: order.id,
      amountInr,
      amountUsd,
      currency: 'INR',
      keyId: this.cfg.get<string>('razorpay.keyId') ?? '',
    };
  }

  async verifyAndCredit(
    sub: string,
    orderId: string,
    paymentId: string,
    signature: string,
  ): Promise<{ credited: number }> {
    const keySecret = this.cfg.get<string>('razorpay.keySecret') ?? '';
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (expected !== signature) {
      throw new HttpException('Invalid payment signature', HttpStatus.BAD_REQUEST);
    }

    return this.idempotentCredit(sub, paymentId, orderId);
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.cfg.get<string>('razorpay.webhookSecret') ?? '';
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
      throw new HttpException('Invalid webhook signature', HttpStatus.BAD_REQUEST);
    }

    const payload = JSON.parse(rawBody.toString()) as {
      event: string;
      payload: {
        payment: {
          entity: {
            id: string;
            order_id: string;
            notes: { sub?: string; amountUsd?: string };
          };
        };
      };
    };

    if (payload.event !== 'payment.captured') return;

    const entity = payload.payload.payment.entity;
    const sub = entity.notes?.sub;
    const amountUsd = parseFloat(entity.notes?.amountUsd ?? '0');

    if (!sub || !amountUsd) {
      this.logger.warn('Webhook missing sub or amountUsd in notes', { id: entity.id });
      return;
    }

    await this.idempotentCredit(sub, entity.id, entity.order_id, amountUsd);
  }

  private async idempotentCredit(
    sub: string,
    paymentId: string,
    orderId: string,
    amountUsdOverride?: number,
  ): Promise<{ credited: number }> {
    const existing = await this.db.getPayment(sub, paymentId);
    if (existing) {
      return { credited: existing.amountUsd };
    }

    // Fetch order to get the authoritative USD amount if not provided
    let amountUsd = amountUsdOverride;
    if (amountUsd == null) {
      const order = await this.razorpay.orders.fetch(orderId);
      amountUsd = parseFloat((order.notes as Record<string, string>)?.amountUsd ?? '0');
    }

    if (!amountUsd) {
      throw new HttpException('Cannot determine credit amount from order', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const amountInr = 0; // not critical to re-fetch for the record
    const now = new Date().toISOString();
    const payment: PaymentItem = {
      PK: `USER#${sub}`,
      SK: `PAYMENT#${paymentId}`,
      paymentId,
      orderId,
      sub,
      amountUsd,
      amountInr,
      createdAt: now,
    };

    await Promise.all([
      this.db.addCredit(sub, amountUsd),
      this.db.putPayment(payment),
    ]);

    return { credited: amountUsd };
  }

  private async fetchUsdToInrRate(): Promise<number> {
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      if (!res.ok) throw new Error(`Exchange rate API returned ${res.status}`);
      const data = (await res.json()) as { rates: Record<string, number> };
      const rate = data.rates['INR'];
      if (!rate) throw new Error('INR rate missing from response');
      return rate;
    } catch (err) {
      this.logger.error('Failed to fetch exchange rate, using fallback 84', err);
      return 84; // conservative fallback
    }
  }
}
