import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { PaymentItem, CreditEventItem } from '@/dynamo/dynamo.interfaces';
import { EmailService } from '@/email/email.service';
import { ulid } from 'ulid';
import { appleRootCAs } from './apple-root-ca';

// iOS IAP product ids → USD credit amount. Unknown productId is rejected (400).
const IAP_PRODUCT_CREDIT_USD: Record<string, number> = {
  credits_5: 5.0,
  credits_10: 10.0,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _razorpay: Razorpay | null = null;
  private _sandboxVerifier: SignedDataVerifier | null = null;
  private _productionVerifier: SignedDataVerifier | null = null;

  constructor(
    private readonly db: DynamoRepository,
    private readonly cfg: ConfigService,
    private readonly email: EmailService,
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

  private get sandboxVerifier(): SignedDataVerifier {
    if (!this._sandboxVerifier) {
      const bundleId = this.cfg.get<string>('apple.iapBundleId') ?? 'in.forkai.app';
      this._sandboxVerifier = new SignedDataVerifier(appleRootCAs, true, Environment.SANDBOX, bundleId);
    }
    return this._sandboxVerifier;
  }

  // null until APPLE_APP_APPLE_ID is configured — the library's constructor throws
  // synchronously without it for Environment.PRODUCTION. App Review only ever exercises
  // Sandbox, so this stays unset (and production verification simply isn't attempted)
  // until the numeric App Store Connect app id is added post-approval.
  private get productionVerifier(): SignedDataVerifier | null {
    const appAppleId = this.cfg.get<string>('apple.appAppleId');
    if (!appAppleId) return null;
    if (!this._productionVerifier) {
      const bundleId = this.cfg.get<string>('apple.iapBundleId') ?? 'in.forkai.app';
      this._productionVerifier = new SignedDataVerifier(appleRootCAs, true, Environment.PRODUCTION, bundleId, Number(appAppleId));
    }
    return this._productionVerifier;
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

  // Verifies a StoreKit 2 signed transaction (JWS) from the iOS app and credits
  // the buyer. Tries production first (real purchases), then sandbox — App
  // Review's test purchases are always Sandbox, so both must be accepted.
  async verifyIapPurchase(sub: string, jws: string): Promise<{ credited: number }> {
    const decoded = await this.decodeIapTransaction(jws);

    const bundleId = this.cfg.get<string>('apple.iapBundleId') ?? 'in.forkai.app';
    if (decoded.bundleId !== bundleId) {
      throw new HttpException('Purchase bundle id mismatch', HttpStatus.BAD_REQUEST);
    }

    const amountUsd = decoded.productId ? IAP_PRODUCT_CREDIT_USD[decoded.productId] : undefined;
    if (!amountUsd) {
      throw new HttpException(`Unknown IAP product: ${decoded.productId}`, HttpStatus.BAD_REQUEST);
    }
    if (!decoded.transactionId) {
      throw new HttpException('Purchase missing transaction id', HttpStatus.BAD_REQUEST);
    }

    // Keyed on Apple's transactionId (in place of a Razorpay paymentId) so a
    // replayed/retried verify call for the same purchase credits only once.
    return this.idempotentCredit(sub, decoded.transactionId, 'apple-iap', amountUsd);
  }

  private async decodeIapTransaction(jws: string): Promise<{ bundleId?: string; productId?: string; transactionId?: string }> {
    const production = this.productionVerifier;
    if (production) {
      try {
        return await production.verifyAndDecodeTransaction(jws);
      } catch {
        // Fall through to sandbox — a Sandbox-signed JWS fails INVALID_ENVIRONMENT here.
      }
    }
    try {
      return await this.sandboxVerifier.verifyAndDecodeTransaction(jws);
    } catch (err) {
      this.logger.warn(`IAP verification failed: ${(err as Error).message}`);
      throw new HttpException('Invalid purchase receipt', HttpStatus.BAD_REQUEST);
    }
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

    // Fire-and-forget receipt — must never block or fail crediting. Only on a
    // fresh credit (the existing-payment early-return above guarantees no dupes).
    void this.sendReceipt(sub, amountUsd, paymentId);

    return { credited: amountUsd };
  }

  private async sendReceipt(sub: string, amountUsd: number, paymentId: string): Promise<void> {
    try {
      const user = await this.db.getUserMeta(sub);
      if (user?.email) await this.email.sendPaymentReceipt(user.email, amountUsd, paymentId);
    } catch (err) {
      this.logger.error(`Receipt lookup/send failed for ${sub}`, err);
    }
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
