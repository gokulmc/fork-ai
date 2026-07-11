import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';
import { computeSecretHash } from '@/lib/cognito-secrets';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// Confirms the emailed reset code + new password, then auto-logs-in (same pattern as
// /confirm for signup) so the user lands straight in the app. Both calls are public APIs.
export async function POST(req: NextRequest) {
  const { email, code, password } = (await req.json()) as {
    email: string;
    code: string;
    password: string;
  };
  try {
    const secretHash = computeSecretHash(email);
    await client.send(
      new ConfirmForgotPasswordCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        SecretHash: secretHash,
        Username: email,
        ConfirmationCode: code,
        Password: password,
      }),
    );
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: secretHash },
      }),
    );
    return Response.json({
      idToken: result.AuthenticationResult!.IdToken,
      refreshToken: result.AuthenticationResult!.RefreshToken,
      expiresIn: result.AuthenticationResult!.ExpiresIn ?? 3600,
    });
  } catch (e) {
    const err = e as Error;
    return Response.json({ error: err.name, message: err.message }, { status: 400 });
  }
}
