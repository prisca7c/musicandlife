import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, decodeJwt, errors } from 'jose';
import type { JwtPayload } from '@music-life/types';
import { canAccess, homeFor } from '@/lib/nav-access';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

// A signed-in user who isn't allowed on this route is bounced to their own home
// rather than shown the admin page's chrome over an empty/403 body. Nav already
// hid the link; this stops the same page being reached by typing the URL.
function gate(req: NextRequest, role: JwtPayload['role'] | undefined) {
  const { pathname } = req.nextUrl;
  if (role && !canAccess(role, pathname)) {
    return NextResponse.redirect(new URL(homeFor(role), req.url));
  }
  return NextResponse.next();
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith('/app')) return NextResponse.next();

  const token = req.headers.get('authorization')?.slice(7) ??
    req.cookies.get('access_token')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify<JwtPayload>(token, JWT_SECRET);
    return gate(req, payload.role);
  } catch (err) {
    // An expired — but validly signed — token still means "recently signed in".
    // Let the page render (apiFetch refreshes on its first request, or bounces
    // to /login if the refresh token is gone) — but still enforce the role from
    // its decoded claims. Only a bad/forged signature is redirected to /login.
    if (err instanceof errors.JWTExpired) {
      try { return gate(req, decodeJwt<JwtPayload>(token).role); }
      catch { return NextResponse.next(); }
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/app/:path*'],
};
