import { z } from 'zod';

/** Validated runtime configuration. Secrets come only from the environment (never from code or logs). */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(2).max(200).default(20),
  /** Ed25519 private key as PKCS8 PEM. In development a key is generated at boot if absent. */
  JWT_PRIVATE_KEY_PEM: z.string().optional(),
  JWT_ISSUER: z.string().default('flero'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Comma-separated browser origins allowed to call the API (development web preview only). */
  CORS_ORIGINS: z.string().optional(),
  /** Base URL the API is reachable at (dev media + upload URLs). */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  /** Development object storage directory (production: S3 integration). */
  STORAGE_DIR: z.string().default('.dev-storage'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Print only the failing keys, never values (they may be secrets).
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`invalid configuration: ${keys}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.JWT_PRIVATE_KEY_PEM) {
    throw new Error('invalid configuration: JWT_PRIVATE_KEY_PEM is required in production');
  }
  return parsed.data;
}
