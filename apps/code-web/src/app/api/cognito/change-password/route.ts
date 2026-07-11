import {
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { computeSecretHash } from '@/lib/cognito-secrets';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = session.user.email;
  const { currentPassword, newPassword } = (await req.json()) as {
    currentPassword: string;
    newPassword: string;
  };

  // Verify current password and capture the AccessToken — ChangePassword below is a
  // user-scoped (non-admin) call, so it works on Amplify where the Lambda has no IAM creds.
  // AdminSetUserPassword would 500 with CredentialsProviderError in that environment.
  let accessToken: string | undefined;
  try {
    const auth = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: { USERNAME: email, PASSWORD: currentPassword, SECRET_HASH: computeSecretHash(email) },
      }),
    );
    accessToken = auth.AuthenticationResult?.AccessToken;
  } catch {
    return Response.json({ error: 'CurrentPasswordIncorrect' }, { status: 400 });
  }

  if (!accessToken) {
    // No AccessToken means Cognito returned a challenge (e.g. NEW_PASSWORD_REQUIRED) instead
    // of completing auth — the account can't self-service a password change in this state.
    return Response.json({ error: 'CurrentPasswordIncorrect' }, { status: 400 });
  }

  try {
    await client.send(
      new ChangePasswordCommand({
        AccessToken: accessToken,
        PreviousPassword: currentPassword,
        ProposedPassword: newPassword,
      }),
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
