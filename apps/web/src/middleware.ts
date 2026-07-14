import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, errors } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/app')) return NextResponse.next();

  const token = req.headers.get('authorization')?.slice(7) ??
    req.cookies.get('access_token')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch (err) {
    // An expired — but validly signed — token still means "recently signed in".
    // Let the page render; apiFetch will silently refresh on its first request
    // (or bounce to /login if the refresh token is gone). Only a bad/forged
    // signature is redirected here.
    if (err instanceof errors.JWTExpired) return NextResponse.next();
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/app/:path*'],
};
