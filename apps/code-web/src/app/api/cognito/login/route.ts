import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { NextRequest } from 'next/server';
import { computeSecretHash } from '@/lib/cognito-secrets';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as { email: string; password: string };
  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: computeSecretHash(email) },
      }),
    );
    if (result.ChallengeName) {
      console.error('[cognito/login] challenge required:', result.ChallengeName);
      return Response.json({ error: 'ChallengeRequired', message: result.ChallengeName }, { status: 400 });
    }
    return Response.json({
      idToken: result.AuthenticationResult!.IdToken,
      refreshToken: result.AuthenticationResult!.RefreshToken,
      expiresIn: result.AuthenticationResult!.ExpiresIn ?? 3600,
    });
  } catch (e) {
    const err = e as Error;
    console.error('[cognito/login]', err.name, err.message);
    // With PreventUserExistenceErrors=LEGACY the pool returns distinct errors we map
    // straight through — no IAM-only AdminGetUser disambiguation (that throws on the
    // Amplify Lambda, which has no IAM credentials, and wrongly reported every failed
    // login as UserNotFoundException → the signup step):
    //   NotAuthorizedException     → wrong password (frontend shows the reset link)
    //   UserNotFoundException      → no account     (frontend routes to signup)
    //   UserNotConfirmedException  → needs email verification
    return Response.json({ error: err.name, message: err.message }, { status: 400 });
  }
}
