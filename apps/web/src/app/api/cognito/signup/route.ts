import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';
import { computeSecretHash } from '@/lib/cognito-secrets';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

async function doSignUp(email: string, password: string) {
  await client.send(
    new SignUpCommand({
      ClientId: process.env.COGNITO_CLIENT_ID!,
      SecretHash: await computeSecretHash(email),
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    }),
  );
}

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as { email: string; password: string };
  try {
    await doSignUp(email, password);
    return Response.json({ ok: true });
  } catch (e) {
    const name = (e as { name?: string }).name;

    if (name === 'UsernameExistsException') {
      // Check if the existing user is unconfirmed — if so, purge and retry
      try {
        const { UserStatus } = await client.send(
          new AdminGetUserCommand({
            UserPoolId: process.env.COGNITO_USER_POOL_ID!,
            Username: email,
          }),
        );
        if (UserStatus === 'UNCONFIRMED') {
          await client.send(
            new AdminDeleteUserCommand({
              UserPoolId: process.env.COGNITO_USER_POOL_ID!,
              Username: email,
            }),
          );
          await doSignUp(email, password);
          return Response.json({ ok: true });
        }
      } catch {
        // fall through to the original error
      }
      return Response.json({ error: 'UsernameExistsException' }, { status: 400 });
    }

    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
