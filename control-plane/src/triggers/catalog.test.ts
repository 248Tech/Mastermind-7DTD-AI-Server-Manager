import { parseGrantItemsActionConfig, parseLandClaimActionConfig, playerReachedLevel } from './catalog';

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

assert(playerReachedLevel('eq', 69, 111, 100), 'exact trigger still fires when a player jumps past the level');
assert(playerReachedLevel('gte', 69, 111, 100), 'at-least trigger fires when jumping past the level');
assert(!playerReachedLevel('eq', 111, 111, 100), 'does not re-fire after the player is already past the level');
assert(!playerReachedLevel('eq', 99, 99, 100), 'does not fire below the level');
assert(playerReachedLevel('eq', 99, 100, 100), 'fires when landing exactly on the level');

console.log('trigger catalog grant-items tests passed');
