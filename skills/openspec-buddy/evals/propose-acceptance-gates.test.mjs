import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const lifecycle = read('skills/openspec-buddy/references/core-lifecycle.md');
const relationships = read('skills/openspec-buddy/references/issue-relationships.md');
const metadata = read('skills/openspec-buddy/references/metadata-schema.md');

assert.match(lifecycle, /model owns proposal quality;\s+Buddy owns only coordination identity and dependencies/i);
for (const removedGate of [
  '\\.buddy/triage\\.json',
  '\\.buddy/proposal-review\\.yaml',
  'prescribed\\s+Testing Strategy schema',
  'task-to-AC mapping',
  'Project membership',
  'independent\\s+proposal review',
]) {
  assert.match(lifecycle, new RegExp(`${removedGate}[\\s\\S]*not default propose gates`, 'i'));
}
assert.match(relationships, /native GitHub `blockedBy` is authoritative/i);
assert.match(metadata, /lightweight marker/i);
assert.match(metadata, /legacy full metadata contract/i);

console.log('propose acceptance gates eval passed');
