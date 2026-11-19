import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { err } from './errors.ts';

const Uuid = z.uuid();

/** Economic POSTs require an Idempotency-Key (doc 07 §1); retries with the same key replay, never re-charge. */
export function idempotencyKey(req: FastifyRequest): string {
  const raw = req.headers['idempotency-key'];
  const parsed = Uuid.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.success) throw err.validation({ header: 'Idempotency-Key' });
  return parsed.data.toLowerCase();
}

/** Cursor pagination: opaque base64url cursor + bounded limit (rules/backend-data.md: every list paginates). */
export const ListQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const encodeCursor = (v: Record<string, string | number>) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodeCursor<T extends Record<string, string | number>>(c: string | undefined, shape: z.ZodType<T>): T | null {
  if (!c) return null;
  try {
    return shape.parse(JSON.parse(Buffer.from(c, 'base64url').toString('utf8')));
  } catch {
    throw err.validation({ query: 'cursor' });
  }
}
