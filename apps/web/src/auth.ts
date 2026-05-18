import NextAuth from 'next-auth';
import Cognito from 'next-auth/providers/cognito';

export const { handlers, signIn, signOut, auth } = NextAuth({
  debug: true,
  providers: [
    Cognito({
      clientId: process.env.COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: `https://cognito-idp.${process.env.AWS_REGION ?? 'ap-south-1'}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
      authorization: { params: { scope: 'openid' } },
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      // Persist the Cognito id_token — NestJS validates this on every request
      if (account?.id_token) token.idToken = account.id_token;
      return token;
    },
    session({ session, token }) {
      session.idToken = token.idToken;
      return session;
    },
  },
});
