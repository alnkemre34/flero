import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signup, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });

describe('auth engine (ADR-007, REQ-ID-04)', () => {
  it('signup returns a token pair and onboarding status; /v1/me works with the access token', async () => {
    const s = await signup(h.app);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.public_user_id).toMatch(/^usr_[a-z2-7]{26}$/);
    expect(body.onboarding).toEqual({ email_verified: false, age_assured: false, consents_current: false, home_region_set: false });
    expect(body.home_city_label_key).toBeNull();
    expect(Object.keys(body)).not.toContain('id'); // contract serializer: no internal ids
  });

  it('rejects requests without or with a forged token', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer abc.def.ghi' } })).statusCode).toBe(401);
  });

  it('duplicate email/handle is rejected without saying which (no enumeration)', async () => {
    await signup(h.app, { email: 'dup@test.flero', handle: 'dup_one' });
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'dup@test.flero', password: 'correct horse battery', handle: 'dup_two', display_name: 'X', gender: 'MALE', locale: 'tr' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().params).toEqual({ field: 'email_or_handle' });
  });

  it('login: right password works; wrong password and unknown email give the same 401', async () => {
    await signup(h.app, { email: 'login@test.flero', handle: 'login_user' });
    const ok = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'LOGIN@test.flero', password: 'correct horse battery' } });
    expect(ok.statusCode).toBe(200);
    const bad = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'login@test.flero', password: 'wrong password!!' } });
    const unknown = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@test.flero', password: 'whatever pass' } });
    expect([bad.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(bad.json().code).toBe(unknown.json().code);
  });

  it('refresh rotates; re-using a spent refresh token revokes the session', async () => {
    const s = await signup(h.app);
    const r1 = await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(r1.statusCode).toBe(200);
    const fresh = r1.json();
    expect(fresh.refresh_token).not.toBe(s.refresh_token);
    // replay the OLD token → theft signal → session revoked
    const replay = await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(replay.statusCode).toBe(401);
    // the NEW token's session is the same family → now also dead
    const after = await h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: fresh.refresh_token } });
    expect(after.statusCode).toBe(401);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${fresh.access_token}` } });
    expect(me.statusCode).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const s = await signup(h.app);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: s.auth })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: s.auth })).statusCode).toBe(401);
  });

  it('strict request schemas reject unknown fields', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@b.co', password: 'x', is_admin: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });
});
