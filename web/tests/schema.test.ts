import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SCHEMA_PATH, buildSchema } from '../scripts/schema.mjs';

// The Python tests validate the exported JSON against src/lib/types.schema.json, so that file
// must always match src/lib/types.ts. Fix a failure with `npm run schema`.
it('types.schema.json is up to date with types.ts', () => {
  const committed = readFileSync(SCHEMA_PATH, 'utf8').replace(/\r\n/g, '\n');
  expect(committed).toBe(buildSchema());
}, 60_000);
