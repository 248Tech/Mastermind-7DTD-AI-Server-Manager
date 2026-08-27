import { parseGrantItemsActionConfig, parseLandClaimActionConfig } from './catalog';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const land = parseLandClaimActionConfig({ claimCount: 5, notifyPlayer: true, message: 'Hi' });
assert(land.claimCount === 5 && land.notifyPlayer, 'parses land claim action');

const grants = parseGrantItemsActionConfig({
  items: [{ name: 'resourceWood', quantity: 4 }, { name: 'gunM60', quantity: 1, quality: 6 }],
  notifyPlayer: true,
  message: 'Level reward',
});
assert(grants.items.length === 2 && grants.items[0].name === 'resourceWood' && grants.items[1].quality === 6, 'parses grant items');

let threw = false;
try {
  parseGrantItemsActionConfig({ items: [] });
} catch {
  threw = true;
}
assert(threw, 'requires at least one item');

threw = false;
try {
  parseGrantItemsActionConfig({ items: [{ name: 'all', quantity: 1 }] });
} catch {
  threw = true;
}
assert(threw, 'rejects giveplus all');

console.log('trigger catalog grant-items tests passed');
