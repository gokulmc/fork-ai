import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as http2 from 'http2';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

// Apple requires the auth JWT to be 20-60 minutes old; refresh a bit before
// the ceiling so we never send an expired token.
const JWT_TTL_MS = 50 * 60 * 1000;

@Injectable()
export class ApnsService {
  private readonly logger = new Logger(ApnsService.name);
  private cachedJwt?: { token: string; issuedAt: number };
  private warnedUnconfigured = false;

  constructor(
    private readonly cfg: ConfigService,
    private readonly db: DynamoRepository,
  ) {}

  // Config is read lazily (never at boot) so a missing/incomplete APNs config
  // never crashes app startup — sendToUser just no-ops until it's configured,
  // matching the Gemini/DeepSeek provider pattern.
  private getKey(): string | undefined {
    const raw = this.cfg.get<string>('apns.key');
    if (!raw) return undefined;
    // Secrets managers / env files often store the PEM with literal "\n" sequences.
    return raw.replace(/\\n/g, '\n');
  }

  private isConfigured(): boolean {
    return !!(this.getKey() && this.cfg.get<string>('apns.keyId') && this.cfg.get<string>('apns.teamId'));
  }

  private base64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
  }

  private buildJwt(): string {
    const keyId = this.cfg.get<string>('apns.keyId')!;
    const teamId = this.cfg.get<string>('apns.teamId')!;
    const key = this.getKey()!;

    const header = { alg: 'ES256', kid: keyId };
    const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };
    const signingInput = `${this.base64url(JSON.stringify(header))}.${this.base64url(JSON.stringify(claims))}`;

    // dsaEncoding: 'ieee-p1363' is required to get the raw r||s signature APNs'
    // ES256 JWT expects — Node's default is DER, which Apple rejects.
    const signature = crypto
      .createSign('SHA256')
      .update(signingInput)
      .sign({ key, dsaEncoding: 'ieee-p1363' });

    return `${signingInput}.${this.base64url(signature)}`;
  }

  private getJwt(): string {
    if (this.cachedJwt && Date.now() - this.cachedJwt.issuedAt < JWT_TTL_MS) {
      return this.cachedJwt.token;
    }
    const token = this.buildJwt();
    this.cachedJwt = { token, issuedAt: Date.now() };
    return token;
  }

  private async sendOne(sub: string, deviceToken: string, title: string, body: string): Promise<void> {
    const env = this.cfg.get<string>('apns.env');
    const host = env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const bundleId = this.cfg.get<string>('apns.bundleId') || 'in.forkai.app';
    const jwt = this.getJwt();

    const client = http2.connect(host);
    // A connect-level failure (DNS, TLS, etc.) emits 'error' asynchronously; without
    // a listener that crashes the process. The request-level promise below still
    // rejects via its own 'error' handler.
    client.on('error', () => {});

    let status = 0;
    let responseBody = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const req = client.request({
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          authorization: `bearer ${jwt}`,
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
        });
        req.on('response', (headers) => { status = Number(headers[':status'] ?? 0); });
        req.on('data', (chunk) => { responseBody += chunk; });
        req.on('end', () => resolve());
        req.on('error', reject);
        req.end(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } }));
      });
    } finally {
      client.close();
    }

    // Stale-token cleanup: 410 always means unregistered; a 400 with these
    // specific reasons means the token is no longer valid.
    if (status === 410) {
      await this.db.deleteDevice(sub, deviceToken);
      return;
    }
    if (status === 400) {
      let reason: string | undefined;
      try { reason = JSON.parse(responseBody || '{}').reason; } catch { /* malformed body, ignore */ }
      if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
        await this.db.deleteDevice(sub, deviceToken);
      }
      return;
    }
    if (status !== 200) {
      this.logger.warn(`APNs push failed: status=${status} body=${responseBody}`);
    }
  }

  // Never throws — a push-notification failure must never break the caller's
  // (e.g. root-query streaming) request flow.
  async sendToUser(sub: string, title: string, body: string): Promise<void> {
    if (!this.isConfigured()) {
      if (!this.warnedUnconfigured) {
        this.logger.debug('APNs not configured — skipping push notification');
        this.warnedUnconfigured = true;
      }
      return;
    }

    try {
      const devices = await this.db.listDevices(sub);
      await Promise.all(
        devices.map((d) =>
          this.sendOne(sub, d.token, title, body).catch((err) => {
            this.logger.warn(`APNs send to device failed: ${err instanceof Error ? err.message : String(err)}`);
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(`APNs sendToUser failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
