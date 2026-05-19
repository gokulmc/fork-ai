import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    idToken?: string;
  }
  interface Session {
    idToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    idToken?: string;
  }
}
