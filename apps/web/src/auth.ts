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

type RefreshResult =
  | { status: 'ok'; idToken: string; expiresAt: number; refreshToken?: string }
  | { status: 'expired' } // refresh token genuinely dead → must log out
  | { status: 'transient' }; // network/throttle blip → keep the session, retry later

// Only these mean the refresh token itself is invalid. Everything else (network errors,
// TooManyRequestsException, 5xx, timeouts) is transient and must NOT log the user out of a
// still-valid 30-day refresh token — that was the intermittent "forced login after ~1h" bug.
const FATAL_REFRESH_ERRORS = new Set([
  'NotAuthorizedException',
  'InvalidParameterException',
  'UserNotFoundException',
]);

async function refreshIdToken(refreshToken: string, username: string): Promise<RefreshResult> {
  let lastErr: (Error & { name?: string }) | undefined;
  // The refresh fires 60s before expiry, so the id_token is still valid during these retries —
  // a momentary blip recovers within the same request instead of forcing a re-login.
  for (let attempt = 0; attempt < 3; attempt++) {
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
      const auth = result.AuthenticationResult;
      if (!auth?.IdToken) return { status: 'transient' }; // unexpected empty — retryable
      return {
        status: 'ok',
        idToken: auth.IdToken,
        expiresAt: Date.now() + (auth.ExpiresIn ?? 3600) * 1000,
        // If the pool rotates refresh tokens, persist the new one — otherwise the next
        // refresh would reuse the now-invalidated token and force a logout.
        refreshToken: auth.RefreshToken ?? undefined,
      };
    } catch (e) {
      lastErr = e as Error & { name?: string };
      if (FATAL_REFRESH_ERRORS.has(lastErr.name ?? '')) {
        console.error('[auth/refresh] fatal', lastErr.name, lastErr.message);
        return { status: 'expired' };
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  console.error('[auth/refresh] transient (exhausted)', lastErr?.name, lastErr?.message);
  return { status: 'transient' };
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  // Required for serverless/CDN deployments where AUTH_URL isn't set at runtime
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days — matches Cognito refresh token lifetime
  },
  // Dev only: localhost cookies are shared across ports, so another next-auth
  // app (e.g. p2p-lending-tracker on :3001) writing the default
  // `authjs.session-token` cookie makes this app throw "no matching decryption
  // secret" on every request. Namespace ours in dev; prod keeps the default so
  // existing forkai.in sessions aren't invalidated.
  ...(process.env.NODE_ENV !== 'production' && {
    cookies: { sessionToken: { name: 'forkai.session-token' } },
  }),
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
      if (refreshed.status === 'expired') {
        return { ...token, error: 'RefreshTokenExpired' };
      }
      if (refreshed.status === 'transient') {
        // Keep the (still-recent) session. expiresAt stays in the past, so the next session
        // refetch retries — far better than logging out on a blip. SessionProvider's
        // refetchInterval guarantees that retry happens even if the tab never refocuses.
        return { ...token, error: undefined };
      }
      return {
        ...token,
        idToken: refreshed.idToken,
        expiresAt: refreshed.expiresAt,
        refreshToken: refreshed.refreshToken ?? token.refreshToken,
        error: undefined,
      };
    },
    session({ session, token }) {
      session.idToken = token.idToken;
      session.error = token.error;
      return session;
    },
  },
});
