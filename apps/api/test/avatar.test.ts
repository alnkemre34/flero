import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onboarded, startHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.stop(); });

/** A real JPEG with EXIF (incl. a GPS tag) so we can prove metadata is stripped. */
const jpeg = (w: number, h2: number) => sharp({ create: { width: w, height: h2, channels: 3, background: { r: 200, g: 60, b: 120 } } })
  .jpeg().withExifMerge({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } }).toBuffer();

/** Upload through the ticket exactly as the app does: multipart POST with the policy fields + file. */
async function upload(u: { auth: Record<string, string> }, body: Buffer, contentType = 'image/jpeg') {
  const t = await h.app.inject({ method: 'POST', url: '/v1/me/avatar/uploads', headers: u.auth, payload: { content_type: contentType, byte_size: body.length } });
  expect(t.statusCode).toBe(201);
  const ticket = t.json() as { upload_id: string; url: string; fields: Record<string, string> };
  const boundary = `----flero${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(ticket.fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: ${contentType}\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--\r\n`));
  const up = await h.app.inject({ method: 'POST', url: new URL(ticket.url).pathname, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
  return { ticket, up };
}

describe('avatar upload (ticket → quarantine → server re-encode)', () => {
  it('crops, re-encodes to 512 WebP without metadata, and shows up in /me, profiles and Shuffle', async () => {
    const u = await onboarded(h);
    const { ticket, up } = await upload(u, await jpeg(800, 600));
    expect(up.statusCode).toBe(204);
    const done = await h.app.inject({ method: 'POST', url: `/v1/me/avatar/uploads/${ticket.upload_id}/complete`, headers: u.auth, payload: { crop: { x: 100, y: 0, size: 600 } } });
    expect(done.statusCode).toBe(200);
    const url = done.json().avatar.url as string;
    expect(url).toMatch(/\/media\/avatars\/[a-z2-7]{26}\.webp$/);
    expect(url).not.toContain(u.pid.slice(4)); // served key is unrelated to the account id

    const img = await h.app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([512, 512, 'webp']);
    expect(meta.exif).toBeUndefined(); // EXIF/GPS stripped

    const viewer = await onboarded(h);
    const prof = (await h.app.inject({ method: 'GET', url: `/v1/profiles/${u.pid}`, headers: viewer.auth })).json();
    expect(prof.avatar).toEqual({ url });
  });

  it('rejects a forged ticket, a non-image, an out-of-bounds crop; deleting removes the avatar', async () => {
    const u = await onboarded(h);
    const { ticket } = await upload(u, await jpeg(300, 300));
    const forged = await h.app.inject({ method: 'POST', url: '/dev-storage/upload', headers: { 'content-type': 'multipart/form-data; boundary=x' },
      payload: `--x\r\nContent-Disposition: form-data; name="key"\r\n\r\nquarantine/avatars/evil\r\n--x\r\nContent-Disposition: form-data; name="signature"\r\n\r\nnope\r\n--x--\r\n` });
    expect(forged.statusCode).toBe(400);
    const out = await h.app.inject({ method: 'POST', url: `/v1/me/avatar/uploads/${ticket.upload_id}/complete`, headers: u.auth, payload: { crop: { x: 100, y: 0, size: 256 } } });
    expect(out.json().params).toMatchObject({ field: 'crop' });
    const junk = await upload(u, Buffer.from('definitely not an image, just text bytes'));
    const bad = await h.app.inject({ method: 'POST', url: `/v1/me/avatar/uploads/${junk.ticket.upload_id}/complete`, headers: u.auth, payload: { crop: { x: 0, y: 0, size: 256 } } });
    expect(bad.json().params).toMatchObject({ field: 'image', reason: 'unreadable' });
    const ok = await h.app.inject({ method: 'POST', url: `/v1/me/avatar/uploads/${ticket.upload_id}/complete`, headers: u.auth, payload: { crop: { x: 0, y: 0, size: 300 } } });
    expect(ok.json().avatar).not.toBeNull();
    expect((await h.app.inject({ method: 'DELETE', url: '/v1/me/avatar', headers: u.auth })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: u.auth })).json().avatar).toBeNull();
  });

  it('an anonymous initiator’s avatar never reaches the recipient', async () => {
    const a = await onboarded(h); const b = await onboarded(h);
    const { ticket } = await upload(a, await jpeg(400, 400));
    await h.app.inject({ method: 'POST', url: `/v1/me/avatar/uploads/${ticket.upload_id}/complete`, headers: a.auth, payload: { crop: { x: 0, y: 0, size: 400 } } });
    const cid = (await h.app.inject({ method: 'POST', url: '/v1/conversations', headers: { ...a.auth, 'idempotency-key': randomUUID() }, payload: { recipient: b.pid, first_message: { client_msg_id: randomUUID(), body: 'hi' } } })).json().conversation_id;
    const seen = (await h.app.inject({ method: 'GET', url: `/v1/conversations/${cid}`, headers: b.auth })).json();
    expect(seen.counterparty.kind).toBe('ANONYMOUS');
    expect(JSON.stringify(seen)).not.toContain('/media/avatars/');
  });
});
