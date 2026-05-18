import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Auth disabled for local testing — re-enable before prod
export default function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
