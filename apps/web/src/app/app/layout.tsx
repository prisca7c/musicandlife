import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { jwtVerify, decodeJwt, errors } from 'jose';
import type { JwtPayload } from '@music-life/types';
import { AppShell } from '@/components/app-shell';
import { SWRProvider } from '@/lib/swr';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

async function getUser() {
  const store = await cookies();
  const token = store.get('access_token')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify<JwtPayload>(token, JWT_SECRET);
    return payload;
  } catch (err) {
    // Token expired but validly signed: still render the shell using the decoded
    // claims (for the role) — the client refreshes the token on its first API
    // call. A forged/invalid token returns null and is redirected to /login.
    if (err instanceof errors.JWTExpired) return decodeJwt<JwtPayload>(token);
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <SWRProvider>
      <AppShell role={user.role}>{children}</AppShell>
    </SWRProvider>
  );
}
