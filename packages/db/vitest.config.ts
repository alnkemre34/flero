import { defineConfig } from 'vitest/config';

// Real PostgreSQL 17 in Docker via Testcontainers: container start can take a while on first pull.
export default defineConfig({
  test: { hookTimeout: 180_000, testTimeout: 30_000, fileParallelism: false },
});
