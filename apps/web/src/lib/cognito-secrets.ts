import crypto from 'crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
let cachedSecret: string | undefined;

async function getClientSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  if (process.env.COGNITO_CLIENT_SECRET) {
    cachedSecret = process.env.COGNITO_CLIENT_SECRET;
    return cachedSecret;
  }
  // Amplify WEB_COMPUTE Lambda doesn't inject branch env vars — read from Secrets Manager
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'forkai/cognito-client-secret' }));
  cachedSecret = res.SecretString!;
  return cachedSecret;
}

export async function computeSecretHash(username: string): Promise<string> {
  const secret = await getClientSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(username + process.env.COGNITO_CLIENT_ID!)
    .digest('base64');
}
