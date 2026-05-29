import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import crypto from 'crypto';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
});

function secretHash(username: string) {
  return crypto
    .createHmac('sha256', process.env.COGNITO_CLIENT_SECRET!)
    .update(username + process.env.COGNITO_CLIENT_ID!)
    .digest('base64');
}

async function refreshIdToken(
  refreshToken: string,
  username: string,
): Promise<{ idToken: string; expiresAt: number } | null> {
  try {
    const result = await cognitoClient.send(
      new InitiateAuthCommand({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
          // SECRET_HASH for REFRESH_TOKEN_AUTH must use the canonical Cognito username
          // (the cognito:username UUID), NOT the email alias. The pool uses
          // UsernameAttributes: ["email"], so login (USER_PASSWORD_AUTH) accepts a hash of the
          // submitted email, but refresh validates the hash against the real username —
          // secretHash(email) here fails with NotAuthorizedException and logs the user out.
          SECRET_HASH: secretHash(username),
        },
      }),
    );
    if (!result.AuthenticationResult?.IdToken) return null;
    return {
      idToken: result.AuthenticationResult.IdToken,
      expiresAt: Date.now() + (result.AuthenticationResult.ExpiresIn ?? 3600) * 1000,
    };
  } catch (e) {
    const err = e as Error;
    console.error('[auth/refresh]', err.name, err.message);
    return null;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  // Required for serverless/CDN deployments where AUTH_URL isn't set at runtime
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days — matches Cognito refresh token lifetime
  },
  providers: [
    Credentials({
      id: 'cognito-token',
      credentials: { idToken: {}, refreshToken: {}, expiresAt: {} },
      authorize({ idToken, refreshToken, expiresAt }) {
        if (!idToken) return null;
        try {
          const payload = JSON.parse(
            Buffer.from((idToken as string).split('.')[1], 'base64url').toString(),
          ) as { sub: string; email: string; 'cognito:username': string };
          return {
            id: payload.sub,
            email: payload.email,
            username: payload['cognito:username'],
            idToken: idToken as string,
            refreshToken: (refreshToken as string | undefined) ?? undefined,
            expiresAt: expiresAt ? Number(expiresAt) : Date.now() + 3600 * 1000,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      // Cognito OAuth provider (Google login)
      if (account?.id_token) {
        token.idToken = account.id_token;
        token.expiresAt = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000;
        return token;
      }

      // Credentials provider — initial sign-in
      if (user?.idToken) {
        token.idToken = user.idToken;
        token.refreshToken = user.refreshToken;
        token.expiresAt = user.expiresAt;
        token.username = user.username;
        return token;
      }

      // Token still valid (refresh 60s before actual expiry)
      if (Date.now() < (token.expiresAt ?? 0) - 60_000) {
        return token;
      }

      // Refresh token
      if (!token.refreshToken || !token.username) {
        return { ...token, error: 'RefreshTokenExpired' };
      }
      const refreshed = await refreshIdToken(token.refreshToken, token.username);
      if (!refreshed) {
        return { ...token, error: 'RefreshTokenExpired' };
      }
      return { ...token, idToken: refreshed.idToken, expiresAt: refreshed.expiresAt, error: undefined };
    },
    session({ session, token }) {
      session.idToken = token.idToken;
      session.error = token.error;
      return session;
    },
  },
});
