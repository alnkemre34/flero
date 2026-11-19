import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_API, COOKIE } from '@/lib/session';

/** Login through the BFF: the staff token lives only in an httpOnly, SameSite=Strict cookie (never in JS). */
export async function POST(req: Request) {
  const { remember = false, ...creds } = (await req.json().catch(() => ({}))) as { remember?: boolean; email?: string; password?: string };
  const res = await fetch(`${ADMIN_API}/admin/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds), cache: 'no-store' }).catch(() => null);
  if (!res) return NextResponse.json({ code: 'TEMPORARILY_UNAVAILABLE' }, { status: 503 });
  if (!res.ok) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  const data = (await res.json()) as { token: string; expires_in: number; staff: unknown };
  (await cookies()).set(COOKIE, data.token, {
    // "Beni hatırla": persistent for the staff session lifetime; otherwise a browser-session cookie
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', ...(remember ? { maxAge: data.expires_in } : {}),
  });
  return NextResponse.json({ staff: data.staff });
}

export async function DELETE() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await fetch(`${ADMIN_API}/admin/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  jar.delete(COOKIE);
  return new NextResponse(null, { status: 204 });
}
