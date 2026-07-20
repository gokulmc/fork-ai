import { createSign } from 'crypto';
import * as http2 from 'http2';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

// APNs JWTs are valid up to 1h server-side; cache for 50 min so a send never
// races an expiry near the boundary (same margin-caching pattern as
// GithubAppService's installation-token cache).
const JWT_CACHE_MS = 50 * 60_000;

interface CachedJwt {
  token: string;
  mintedAt: number; // epoch ms
}

// Hand-rolled APNs HTTP/2 push, no new SDK (node:http2 + node:crypto only —
// same "no dependency for one endpoint" precedent as GithubAppService's
// RS256 App JWT and the GLM provider's raw fetch). Lazily configured: any
// missing env var makes sendToUser a silent no-op rather than crashing boot.
@Injectable()
export class ApnsService {
  private readonly logger = new Logger(ApnsService.name);
  private cachedJwt: CachedJwt | null = null;

  constructor(
    private readonly cfg: ConfigService,
    private readonly db: DynamoRepository,
  ) {}

  // Never throws — a push-notification failure must never affect the agent
  // run pipeline that triggers it (see NodesService.createCodeNodeStreaming).
  async sendToUser(sub: string, title: string, body: string): Promise<void> {
    try {
      const jwt = this.buildJwt();
      if (!jwt) return; // APNs not configured — no-op
      const devices = await this.db.listDevices(sub);
      if (!devices.length) return;
      await Promise.all(devices.map((d) => this.sendToDevice(sub, d.token, jwt, title, body)));
    } catch (err) {
      this.logger.warn(`sendToUser failed for ${sub}: ${String(err)}`);
    }
  }

  private buildJwt(): string | null {
    const keyId = this.cfg.get<string>('apns.keyId');
    const teamId = this.cfg.get<string>('apns.teamId');
    const key = this.cfg.get<string>('apns.key');
    if (!keyId || !teamId || !key) return null;

    const now = Date.now();
    if (this.cachedJwt && now - this.cachedJwt.mintedAt < JWT_CACHE_MS) {
      return this.cachedJwt.token;
    }

    const iat = Math.floor(now / 1000);
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = b64url(JSON.stringify({ iss: teamId, iat }));
    const signingInput = `${header}.${claims}`;
    // ieee-p1363 is required — APNs rejects the default DER-encoded ECDSA
    // signature crypto.createSign produces for ES256 JWTs.
    const signature = createSign('SHA256').update(signingInput).sign({ key, dsaEncoding: 'ieee-p1363' });
    const token = `${signingInput}.${b64url(signature)}`;
    this.cachedJwt = { token, mintedAt: now };
    return token;
  }

  private sendToDevice(sub: string, token: string, jwt: string, title: string, body: string): Promise<void> {
    const host = this.cfg.get<string>('apns.env') === 'sandbox'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com';
    const bundleId = this.cfg.get<string>('apns.bundleId');

    return new Promise((resolve) => {
      const session = http2.connect(host);
      session.setTimeout(5000, () => session.close());
      session.on('error', (err) => {
        this.logger.warn(`APNs session error for device ${token}: ${String(err)}`);
        resolve();
      });

      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });

      let status = 0;
      let responseBody = '';
      req.on('response', (headers) => { status = Number(headers[':status'] ?? 0); });
      req.setEncoding('utf8');
      req.on('data', (chunk) => { responseBody += chunk; });
      req.on('error', (err) => {
        this.logger.warn(`APNs request error for device ${token}: ${String(err)}`);
        session.close();
        resolve();
      });
      req.on('end', () => {
        session.close();
        // 410 Gone / 400 BadDeviceToken|Unregistered mean the token is dead —
        // remove it so future sends don't keep retrying a stale token.
        const stale = status === 410 || (status === 400 && /BadDeviceToken|Unregistered/.test(responseBody));
        (stale ? this.db.deleteDevice(sub, token) : Promise.resolve())
          .catch((err) => this.logger.warn(`failed to delete stale device ${token}: ${String(err)}`))
          .finally(() => resolve());
      });

      req.write(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' } }));
      req.end();
    });
  }
}

function b64url(input: string | Buffer): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64url');
}
