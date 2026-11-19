import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * Applies pending `NNNN_name.sql` migrations in order, each in its own transaction, recording them in
 * public.schema_migrations. Idempotent: already-applied versions are skipped. `.down.sql` files are
 * never applied automatically (local rollback only). A changed checksum of an applied migration is an
 * error — applied migrations must never be edited (rules/backend-data.md).
 */
export async function migrate(client: ClientBase, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
  const { rows } = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM public.schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const done: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const sql = await readFile(join(dir, file), 'utf8');
    const checksum = await sha256(sql);
    const prior = applied.get(version);
    if (prior !== undefined) {
      if (prior !== checksum) throw new Error(`migration ${version} was edited after being applied`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum]);
      await client.query('COMMIT');
      done.push(version);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${version} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return done;
}

async function sha256(text: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}
