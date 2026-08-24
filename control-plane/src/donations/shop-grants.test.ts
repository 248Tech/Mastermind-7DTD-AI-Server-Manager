import { parseGrantItemList, grantSpecsFromFields, lineGrantItems, aggregateGrantStatus, snapshotLineGrants } from './shop-grants';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const parsed = parseGrantItemList(JSON.stringify([
  { name: 'resourceWood', quantity: 10 },
  { name: 'resourceScrapIron', quantity: 5, quality: 3 },
]));
if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('parses multiple grant items');
assert(parsed[0].name === 'resourceWood' && parsed[0].quantity === 10 && parsed[0].quality === null, 'first grant item');
assert(parsed[1].name === 'resourceScrapIron' && parsed[1].quality === 3, 'second grant item quality');
assert(parseGrantItemList('[{ "name": "all", "quantity": 1 }]') === false, 'rejects giveplus all');
assert(parseGrantItemList('not-json') === false, 'rejects invalid json');
assert((grantSpecsFromFields('resourceWood', 2, '') as { name: string }[])[0].name === 'resourceWood', 'falls back to single grant fields');

const snap = snapshotLineGrants([{ name: 'resourceWood', quantity: 1, quality: null }, { name: 'resourceScrapIron', quantity: 2, quality: 4 }]);
assert(aggregateGrantStatus(snap) === 'pending', 'new snapshots are pending');
snap[0].status = 'delivered';
snap[1].status = 'delivered';
assert(aggregateGrantStatus(snap) === 'delivered', 'all delivered');
snap[1].status = 'failed';
assert(aggregateGrantStatus(snap) === 'partial', 'mixed delivered and failed');

const restored = lineGrantItems(snap);
assert(restored[1].status === 'failed' && restored[1].quantity === 2, 'preserves per-item grant state');
assert(lineGrantItems([], { grantItemName: 'resourceWood', grantQuantity: 4, grantQuality: null })[0].quantity === 4, 'legacy single-item lines still grant');

console.log('shop-grants multi-item tests passed');
