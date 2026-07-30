import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { SignedDataVerifier, Environment, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { PaymentItem, CreditEventItem } from '@/dynamo/dynamo.interfaces';
import { ulid } from 'ulid';
import { appleRootCertificates } from './apple-root-cert';

// Apple product identifiers are unique account-wide across all of a developer's
// apps, so these can't reuse the main fork.ai app's credits_5/credits_10 — hence
// the code_ prefix.
const IAP_PRODUCT_CREDIT_USD: Record<string, number> = {
  code_credits_5: 5.0,
  code_credits_10: 10.0,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _razorpay: Razorpay | null = null;
  private readonly appleVerifiers = new Map<Environment, SignedDataVerifier>();

  constructor(
    private readonly db: DynamoRepository,
    private readonly cfg: ConfigService,
  ) {}

  private get razorpay(): Razorpay {
    if (!this._razorpay) {
      const keyId = this.cfg.get<string>('razorpay.keyId') ?? '';
      const keySecret = this.cfg.get<string>('razorpay.keySecret') ?? '';
      if (!keyId) throw new HttpException('Payment gateway not configured', HttpStatus.SERVICE_UNAVAILABLE);
      this._razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    }
    return this._razorpay;
  }

  async createOrder(sub: string, amountUsd: number, currency: 'INR' | 'USD' = 'INR'): Promise<{
    orderId: string;
    amountInr: number;
    amountUsd: number;
    currency: string;
    keyId: string;
  }> {
    let orderAmount: number;
    let amountInr = 0;

    if (currency === 'USD') {
      orderAmount = Math.round(amountUsd * 100); // cents
    } else {
      const rate = await this.fetchUsdToInrRate();
      amountInr = Math.round(amountUsd * rate * 100); // paise
      orderAmount = amountInr;
    }

    const order = await this.razorpay.orders.create({
      amount: orderAmount,
      currency,
      notes: { sub, amountUsd: String(amountUsd) },
    });

    return {
      orderId: order.id,
      amountInr,
      amountUsd,
      currency,
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

  // App Review only ever transacts in the sandbox environment, while real
  // users transact in production — the JWS a client sends can be either, and
  // a verifier built for the wrong environment rejects it outright. Try
  // production first (the common case for a live user), fall back to sandbox.
  async verifyIapPurchase(sub: string, jws: string): Promise<{ credited: number }> {
    const bundleId = this.cfg.get<string>('apple.iapBundleId') ?? 'in.forkai.code';
    let payload: JWSTransactionDecodedPayload;
    try {
      payload = await this.appleVerifier(Environment.PRODUCTION, bundleId).verifyAndDecodeTransaction(jws);
    } catch {
      payload = await this.appleVerifier(Environment.SANDBOX, bundleId).verifyAndDecodeTransaction(jws);
    }

    if (payload.bundleId !== bundleId) {
      throw new HttpException('Invalid app bundle', HttpStatus.BAD_REQUEST);
    }

    const amountUsd = IAP_PRODUCT_CREDIT_USD[payload.productId ?? ''];
    if (amountUsd == null) {
      throw new HttpException(`Unknown product ${payload.productId}`, HttpStatus.BAD_REQUEST);
    }

    const transactionId = payload.transactionId;
    if (!transactionId) {
      throw new HttpException('Missing transaction id', HttpStatus.BAD_REQUEST);
    }

    // Reuses the same idempotent PaymentItem + addCredit path as Razorpay —
    // keyed on Apple's transactionId instead of a Razorpay paymentId/orderId
    // pair, since there's no separate "order" concept for an IAP.
    return this.idempotentCredit(sub, transactionId, `apple:${payload.productId}`, amountUsd);
  }

  private appleVerifier(environment: Environment, bundleId: string): SignedDataVerifier {
    let verifier = this.appleVerifiers.get(environment);
    if (!verifier) {
      verifier = new SignedDataVerifier(appleRootCertificates, true, environment, bundleId);
      this.appleVerifiers.set(environment, verifier);
    }
    return verifier;
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

    const creditEventId = ulid();
    const creditEvent: CreditEventItem = {
      PK: `USER#${sub}`,
      SK: `CREDITEVT#${creditEventId}`,
      creditEventId,
      sub,
      type: 'TOPUP',
      amountUsd,
      createdAt: now,
    };
    await Promise.all([
      this.db.addCredit(sub, amountUsd),
      this.db.putPayment(payment),
      this.db.putCreditEvent(creditEvent),
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
