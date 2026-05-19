import { AdminGetUserCommand, CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
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
  const { email, password } = (await req.json()) as { email: string; password: string };
  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: secretHash(email) },
      }),
    );
    if (result.ChallengeName) {
      console.error('[cognito/login] challenge required:', result.ChallengeName);
      return Response.json({ error: 'ChallengeRequired', message: result.ChallengeName }, { status: 400 });
    }
    return Response.json({ idToken: result.AuthenticationResult!.IdToken });
  } catch (e) {
    const err = e as Error;
    console.error('[cognito/login]', err.name, err.message);
    // When "prevent user existence errors" is on, Cognito returns NotAuthorizedException
    // for both wrong password AND unknown user. Use AdminGetUser to disambiguate.
    if (err.name === 'NotAuthorizedException') {
      try {
        const { UserStatus } = await client.send(new AdminGetUserCommand({
          UserPoolId: process.env.COGNITO_USER_POOL_ID!,
          Username: email,
        }));
        if (UserStatus === 'UNCONFIRMED') {
          return Response.json({ error: 'UserNotConfirmedException' }, { status: 400 });
        }
        // User exists and confirmed → wrong password
        return Response.json({ error: 'NotAuthorizedException', message: 'Incorrect password' }, { status: 400 });
      } catch {
        // User not found → treat as new user
        return Response.json({ error: 'UserNotFoundException', message: 'User does not exist' }, { status: 400 });
      }
    }
    return Response.json({ error: err.name, message: err.message }, { status: 400 });
  }
}
