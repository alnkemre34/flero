// Regenerates the committed contract documents. Run: pnpm --filter @flero/contracts generate
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAsyncApi, buildOpenApi } from '../src/documents.ts';

const out = fileURLToPath(new URL('../generated/', import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(`${out}openapi.v1.json`, JSON.stringify(buildOpenApi(), null, 2) + '\n');
writeFileSync(`${out}asyncapi.v1.json`, JSON.stringify(buildAsyncApi(), null, 2) + '\n');
console.log(`wrote ${out}openapi.v1.json and asyncapi.v1.json`);
