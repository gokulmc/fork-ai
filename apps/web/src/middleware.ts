import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth(req => {
  if (!req.auth) {
    const signIn = new URL('/api/auth/signin', req.url);
    return NextResponse.redirect(signIn);
  }
});

export const config = {
  // Protect everything except next-auth endpoints and Next.js internals
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
