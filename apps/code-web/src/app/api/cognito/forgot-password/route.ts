import { CognitoIdentityProviderClient, ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';
import { computeSecretHash } from '@/lib/cognito-secrets';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Public Cognito API (authenticated by SecretHash, not IAM creds) — sends a reset code
// to the account email. Works on the Amplify SSR Lambda, unlike any Admin* command.
export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email: string };
  try {
    await client.send(
      new ForgotPasswordCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        SecretHash: computeSecretHash(email),
        Username: email,
      }),
    );
    return Response.json({ ok: true });
  } catch (e) {
    const err = e as Error;
    // Federated (Google) accounts have no native password — Cognito rejects the reset with
    // NotAuthorizedException "... cannot be reset in the current state". The frontend keys on
    // err.name + message to show a Google-specific hint.
    return Response.json({ error: err.name, message: err.message }, { status: 400 });
  }
}
