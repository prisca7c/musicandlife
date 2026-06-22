import { cookies } from 'next/headers';
import { apiFetch } from './api';

export async function serverApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const store = await cookies();
  const token = store.get('access_token')?.value;
  return apiFetch<T>(path, { ...init, token });
}
