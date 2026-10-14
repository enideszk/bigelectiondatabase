// Builds the JSON Schema of every exported type in src/lib/types.ts.
// Used by `npm run schema` (writes src/lib/types.schema.json) and by tests/schema.test.ts
// (fails when the committed schema is out of date). The Python tests validate the exported data
// against the committed schema.
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

export const TYPES_PATH = fileURLToPath(new URL('../src/lib/types.ts', import.meta.url));
export const SCHEMA_PATH = fileURLToPath(new URL('../src/lib/types.schema.json', import.meta.url));

export function buildSchema() {
  const generator = createGenerator({
    path: TYPES_PATH,
    type: '*',
    expose: 'export',
    topRef: true,
    jsDoc: 'extended',
    additionalProperties: false,
    skipTypeCheck: true,
    sortProps: true,
  });
  return JSON.stringify(generator.createSchema('*'), null, 2) + '\n';
}
