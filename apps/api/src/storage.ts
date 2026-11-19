import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Object storage. INTEGRATION STUB (doc 21): production uses S3 — presigned POST policies with a
 * content-length-range for uploads and CloudFront for reads — behind this same interface. Development stores
 * files on local disk and the API itself plays the role of the presigned endpoint and the CDN.
 */
export interface UploadTicket { url: string; fields: Record<string, string>; expires_in: number }
export interface ObjectStorage {
  /** A short-lived, single-object upload permission (presigned POST in S3). */
  createUpload(key: string, contentType: string, maxBytes: number, ttlSeconds: number): UploadTicket;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Public URL of a served object (avatars only; quarantine is never served). */
  publicUrl(key: string): string;
  /** Short-lived read URL for a private object (chat photos after unlock; presigned GET in S3). */
  signedReadUrl(key: string, ttlSeconds: number): string;
}

/** Signed upload token for the dev endpoint: binds key, type, size limit and expiry (HMAC, constant-time check). */
export class DevStorage implements ObjectStorage {
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly secret: Buffer;
  constructor(root: string, baseUrl: string, secret: string) {
    this.root = resolve(root);
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = Buffer.from(secret);
  }
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key'); // no path traversal
    return p;
  }
  private sign(payload: string) { return createHmac('sha256', this.secret).update(payload).digest('base64url'); }

  createUpload(key: string, contentType: string, maxBytes: number, ttlSeconds: number): UploadTicket {
    const expires = String(Math.floor(Date.now() / 1000) + ttlSeconds);
    const policy = `${key}|${contentType}|${maxBytes}|${expires}`;
    return { url: `${this.baseUrl}/dev-storage/upload`, fields: { key, 'Content-Type': contentType, max: String(maxBytes), expires, signature: this.sign(policy) }, expires_in: ttlSeconds };
  }
  /** Validates the fields a client posted back (what S3 would do with the policy). */
  verifyUpload(f: Record<string, string>): { key: string; contentType: string; maxBytes: number } | null {
    const { key, 'Content-Type': contentType, max, expires, signature } = f;
    if (!key || !contentType || !max || !expires || !signature) return null;
    if (Number(expires) * 1000 < Date.now()) return null;
    const expected = Buffer.from(this.sign(`${key}|${contentType}|${max}|${expires}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { key, contentType, maxBytes: Number(max) };
  }
  async get(key: string) { try { return await readFile(this.path(key)); } catch { return null; } }
  async put(key: string, body: Buffer) { const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, body); }
  async remove(key: string) { await rm(this.path(key), { force: true }); }
  publicUrl(key: string) { return `${this.baseUrl}/media/${key}`; }
  signedReadUrl(key: string, ttlSeconds: number) {
    const e = String(Math.floor(Date.now() / 1000) + ttlSeconds);
    return `${this.baseUrl}/media-private?k=${encodeURIComponent(key)}&e=${e}&s=${this.sign(`read|${key}|${e}`)}`;
  }
  /** Checks a signed read URL (what S3 does for a presigned GET); returns the key or null. */
  verifyRead(k: string, e: string, s: string): string | null {
    if (!k || !e || !s || Number(e) * 1000 < Date.now()) return null;
    const expected = Buffer.from(this.sign(`read|${k}|${e}`));
    const given = Buffer.from(s);
    return expected.length === given.length && timingSafeEqual(expected, given) ? k : null;
  }
}

/** Production placeholder until S3 is wired: uploads answer 503 instead of pretending to work. */
export class UnconfiguredStorage implements ObjectStorage {
  createUpload(): UploadTicket { throw Object.assign(new Error('storage not configured'), { retryable: true }); }
  async get() { return null; }
  async put() { throw new Error('storage not configured'); }
  async remove() {}
  publicUrl(key: string) { return `https://media.invalid/${key}`; }
  signedReadUrl(key: string) { return `https://media.invalid/${key}`; }
}

/** Avatar URL from the stored key (one size, 512×512 WebP). */
export const avatarKeyPath = (key: string) => `avatars/${key}.webp`;

let active: ObjectStorage | null = null;
/** Called once by buildServer; projections then render avatars without threading storage through every query. */
export const useStorage = (s: ObjectStorage) => { active = s; };
export const avatarView = (key: string | null | undefined) => (key && active ? { url: active.publicUrl(avatarKeyPath(key)) } : null);
