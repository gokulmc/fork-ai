import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

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
        Username: email,
        ConfirmationCode: code,
      }),
    );
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    );
    return Response.json({ idToken: result.AuthenticationResult!.IdToken });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
