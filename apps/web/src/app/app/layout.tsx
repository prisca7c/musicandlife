import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import type { JwtPayload } from '@music-life/types';
import { AppShell } from '@/components/app-shell';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

async function getUser() {
  const store = await cookies();
  const token = store.get('access_token')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify<JwtPayload>(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return <AppShell role={user.role}>{children}</AppShell>;
}
