import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import crypto from 'crypto';
import type { NextRequest } from 'next/server';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

function secretHash(username: string) {
  return crypto
    .createHmac('sha256', process.env.COGNITO_CLIENT_SECRET!)
    .update(username + process.env.COGNITO_CLIENT_ID!)
    .digest('base64');
}

export async function POST(req: NextRequest) {
  const { email, code, password } = (await req.json()) as {
    email: string;
    code: string;
    password: string;
  };
  try {
    await client.send(
      new ConfirmSignUpCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        SecretHash: secretHash(email),
        Username: email,
        ConfirmationCode: code,
      }),
    );
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: secretHash(email) },
      }),
    );
    return Response.json({
      idToken: result.AuthenticationResult!.IdToken,
      refreshToken: result.AuthenticationResult!.RefreshToken,
      expiresIn: result.AuthenticationResult!.ExpiresIn ?? 3600,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
