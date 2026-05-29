import crypto from 'crypto';

// Values are inlined at build time via next.config.ts env block (Amplify build env has them).
export function computeSecretHash(username: string): string {
  return crypto
    .createHmac('sha256', process.env.COGNITO_CLIENT_SECRET!)
    .update(username + process.env.COGNITO_CLIENT_ID!)
    .digest('base64');
}
