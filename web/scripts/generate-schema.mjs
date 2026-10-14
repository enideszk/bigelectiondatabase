// npm run schema  ->  src/lib/types.schema.json
import { writeFileSync } from 'node:fs';
import { SCHEMA_PATH, buildSchema } from './schema.mjs';

writeFileSync(SCHEMA_PATH, buildSchema());
console.log(`wrote ${SCHEMA_PATH}`);
