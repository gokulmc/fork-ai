import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email: string };
  try {
    await client.send(new AdminGetUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID!,
      Username: email,
    }));
    return Response.json({ exists: true });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'UserNotFoundException') return Response.json({ exists: false });
    return Response.json({ error: err.name }, { status: 500 });
  }
}
