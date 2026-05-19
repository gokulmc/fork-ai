import { CognitoIdentityProviderClient, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as { email: string; password: string };
  try {
    await client.send(
      new SignUpCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }],
      }),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
