import { createHash, randomBytes } from 'node:crypto';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** Opaque public id: prefix + 26 random base32 chars (130 bits). Never derived from internal ids (REQ-ID-01). */
export function publicId(prefix: 'usr' | 'cnv' | 'msg' | 'med' | 'bst' | 'txn' | 'ntf'): string {
  const bytes = randomBytes(26);
  let out = `${prefix}_`;
  for (const b of bytes) out += B32[b & 31];
  return out;
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();

/** Stable payload fingerprint for idempotency (sorted keys so key order never matters). */
const canon = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : Array.isArray(v) ? v.map(canon) : v;

/** JSON with sorted keys at every level: stable across jsonb round-trips (jsonb reorders keys). */
export const canonicalJson = (v: unknown) => JSON.stringify(canon(v) ?? null);

export function fingerprint(payload: unknown): Buffer {
  return sha256(canonicalJson(payload));
}

/** Turkish-aware handle normalisation: lower-case with tr locale, then the strict handle alphabet. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLocaleLowerCase('tr-TR').normalize('NFKC');
}

export const normalizeEmail = (raw: string) => raw.trim().normalize('NFC').toLowerCase();
