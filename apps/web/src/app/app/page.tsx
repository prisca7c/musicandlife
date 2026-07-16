import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { decodeJwt } from 'jose';
import type { JwtPayload } from '@music-life/types';

// Bare /app has no UI of its own. Previously it 404'd (no page here) — now it
// sends people to the right home screen: staff to the studio dashboard, parents
// and students to their family portal. If they aren't signed in, the layout's
// own guard has already redirected them to /login before this runs.
export default async function AppIndex() {
  const token = (await cookies()).get('access_token')?.value;
  if (!token) redirect('/login');

  let role: string | undefined;
  try {
    role = decodeJwt<JwtPayload>(token).role;
  } catch {
    redirect('/login');
  }

  const familyRoles = ['guardian', 'student'];
  redirect(familyRoles.includes(role ?? '') ? '/app/family/dashboard' : '/app/dashboard');
}
