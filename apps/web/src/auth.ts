import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    // Accepts a pre-validated Cognito id_token (from our /api/cognito/* routes)
    Credentials({
      id: 'cognito-token',
      credentials: { idToken: {} },
      authorize({ idToken }) {
        if (!idToken) return null;
        try {
          const payload = JSON.parse(
            Buffer.from((idToken as string).split('.')[1], 'base64url').toString(),
          ) as { sub: string; email: string };
          return { id: payload.sub, email: payload.email, idToken: idToken as string };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, account, user }) {
      // Cognito OAuth provider
      if (account?.id_token) token.idToken = account.id_token;
      // Credentials provider (cognito-token)
      if (user?.idToken) token.idToken = user.idToken;
      return token;
    },
    session({ session, token }) {
      session.idToken = token.idToken;
      return session;
    },
  },
});
