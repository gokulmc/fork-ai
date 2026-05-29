import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    username?: string;
  }
  interface Session {
    idToken?: string;
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
    username?: string;
  }
}
