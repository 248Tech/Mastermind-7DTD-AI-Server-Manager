import { gzipSync } from 'zlib';
import { catalogFromAgentResult } from './item-catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const catalogGz = gzipSync(Buffer.from('resourceWood\nall\ngunHandgunT1Pistol\nbad name\n', 'utf8')).toString('base64');
const catalog = catalogFromAgentResult({ catalogGz, files: 2, truncated: false });
assert(catalog.items.join(',') === 'gunHandgunT1Pistol,resourceWood', 'inflates gzip names and drops invalid rows');
assert(catalog.count === 2, 'counts sanitized names');
assert(catalog.files === 2, 'preserves scanned file count');
assert(catalogFromAgentResult({ catalogGz: 'not-valid-base64!!!' }).items.length === 0, 'ignores corrupt payloads');
assert(catalogFromAgentResult({ items: ['resourceWood', 'all', '../x'] }).items.join(',') === 'resourceWood', 'sanitizes plaintext names');

console.log('item-catalog tests passed');
