import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_API, COOKIE } from '@/lib/session';

/**
 * BFF proxy to the admin API. Mutations must carry `x-flero-admin: 1` — a custom header a cross-site page cannot
 * send without CORS — on top of the SameSite=Strict cookie (defence in depth against CSRF).
 */
async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return NextResponse.json({ code: 'UNAUTHENTICATED' }, { status: 401 });
  if (req.method !== 'GET' && req.headers.get('x-flero-admin') !== '1') return NextResponse.json({ code: 'VALIDATION_FAILED' }, { status: 400 });
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const upstream = await fetch(`${ADMIN_API}/admin/v1/${path.map(encodeURIComponent).join('/')}${url.search}`, {
    method: req.method,
    headers: { authorization: `Bearer ${token}`, ...(req.method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
    ...(req.method !== 'GET' ? { body: await req.text() } : {}),
    cache: 'no-store',
  }).catch(() => null);
  if (!upstream) return NextResponse.json({ code: 'TEMPORARILY_UNAVAILABLE' }, { status: 503 });
  const headers = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
  const next = upstream.headers.get('x-next-cursor');
  if (next) headers.set('x-next-cursor', next);
  return new NextResponse(upstream.status === 204 ? null : await upstream.text(), { status: upstream.status, headers });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
