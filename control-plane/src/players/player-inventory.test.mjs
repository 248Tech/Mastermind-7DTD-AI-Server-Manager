import { parseInventoryOutput, parseLpPosition, parseAllocsInventoryJson, parseAllocsInventoriesJson } from './player-inventory.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const lp = '0. id=171, Builder, pos=(-1123.4, 62.0, 456.7), rot=(0.0, 180.0, 0.0), remote=True, health=100, deaths=2, zombies=10, players=0, score=0, level=12, ping=40, pltfmid=Steam_76561198000000000';
const position = parseLpPosition(lp);
assert(position && position.x === -1123.4 && position.y === 62 && position.z === 456.7, 'parses lp pos= coordinates');
assert(parseLpPosition('0. id=1, NoPos, health=100') === null, 'returns null without pos=');
assert(parseLpPosition('pos=(9999999, 1, 1)') === null, 'rejects out-of-range X');
assert(parseLpPosition('pos=(1, 20000, 1)') === null, 'rejects out-of-range Y');
assert(parseLpPosition('pos=(not, a, number)') === null, 'rejects non-numeric coordinates');

const inventory = parseInventoryOutput(`
Bag of player Builder:
0. 12 * resourceWood
1. 1 * foodCanChili (fresh)
Belt of player Builder:
0. 1 * meleeToolAxeT1IronAxe
Equipment of player Builder:
head. 1 * armorClothHat
slot 3: 4 * ammo9mmBulletBall
other:
5 * resourceScrapIron
`);
assert(inventory.bag.length === 2, 'parses bag items');
assert(inventory.bag[0].slot === '0' && inventory.bag[0].count === 12 && inventory.bag[0].name === 'resourceWood', 'parses numbered bag slot');
assert(inventory.bag[1].name === 'foodCanChili', 'strips parenthetical quality from item names');
assert(inventory.belt.length === 1 && inventory.belt[0].name === 'meleeToolAxeT1IronAxe', 'parses belt section');
assert(inventory.equipment.length === 2 && inventory.equipment[0].slot === 'head', 'parses equipment slot names');
assert(inventory.equipment[1].slot === '3' && inventory.equipment[1].count === 4, 'parses slot N: items into current section');
assert(inventory.other.length === 1 && inventory.other[0].name === 'resourceScrapIron', 'parses count * name fallback');

const playerLog = parseInventoryOutput(`
Belt:
Slot 2: 11764 * resourceClayLump
Backpack:
Slot 7: 002 * frameShapes:VariantHelper
Equipment:
Slot : armorPrimitiveOutfit - quality: 1
`);
assert(playerLog.belt[0].count === 11764 && playerLog.belt[0].name === 'resourceClayLump', 'parses ServerTools Slot stack quantities');
assert(playerLog.bag[0].count === 2 && playerLog.bag[0].name === 'frameShapes:VariantHelper', 'preserves stack quantity and section');
assert(playerLog.equipment[0].count === 1 && playerLog.equipment[0].name === 'armorPrimitiveOutfit', 'parses empty equipment slot');

const aliases = parseInventoryOutput(`
Backpack:
0. 1 * resourceYuccaFibers
Toolbelt:
0. 1 * gunHandgunT1Pistol
Worn:
0. 1 * armorIronChest
`);
assert(aliases.bag.length === 1, 'maps backpack to bag');
assert(aliases.belt.length === 1, 'maps toolbelt to belt');
assert(aliases.equipment.length === 1, 'maps worn to equipment');

const allocs = parseInventoryOutput(`
Belt of player Frosty:
 Slot 0: 001 * meleeToolAxeT1IronAxe - quality: 4
Bagpack of player Frosty:
 Slot 3: 012 * resourceWood
Equipment of player Frosty:
 Slot head: armorMilitaryHelmet - quality: 6
`);
assert(allocs.belt[0].count === 1 && allocs.belt[0].name === 'meleeToolAxeT1IronAxe', 'parses Allocs belt output');
assert(allocs.bag[0].count === 12 && allocs.bag[0].name === 'resourceWood', 'parses Allocs bag output');
assert(allocs.equipment[0].name === 'armorMilitaryHelmet', 'parses Allocs equipment output');

const serverTools = parseInventoryOutput(`
Inventory, Bag and Equipment of player named 'Frosty'
Inventory Slot: '1' ItemName: 'meleeToolSalvageT1Wrench'
Bag Slot: '3' ItemName: 'resourceWood'
Equipment Slot: 'head' ItemName: 'armorMilitaryHelmet'
`);
assert(serverTools.belt[0].name === 'meleeToolSalvageT1Wrench', 'parses ServerTools inventory output');
assert(serverTools.bag[0].name === 'resourceWood', 'parses ServerTools bag output');
assert(serverTools.equipment[0].name === 'armorMilitaryHelmet', 'parses ServerTools equipment output');

const empty = parseInventoryOutput('Player not found\n');
assert(empty.bag.length + empty.belt.length + empty.equipment.length + empty.other.length === 0, 'ignores non-item lines');

const json = parseAllocsInventoryJson({
  bag: [{ count: 12, name: 'resourceWood' }, { name: 'air' }, null, { item: { name: 'foodCanChili' }, count: 2 }],
  belt: [{ Slot: '0', count: 1, name: 'meleeToolAxeT1IronAxe' }],
  equipment: { head: { name: 'armorClothHat' }, chest: { count: 0, name: 'armorIronChest' } },
});
assert(json.bag.length === 2 && json.bag[0].count === 12 && json.bag[0].name === 'resourceWood', 'parses Allocs bag JSON');
assert(json.bag[1].name === 'foodCanChili' && json.bag[1].count === 2, 'parses nested Allocs item JSON');
assert(json.belt[0].name === 'meleeToolAxeT1IronAxe', 'parses Allocs belt JSON');
assert(json.equipment.length === 1 && json.equipment[0].slot === 'head' && json.equipment[0].name === 'armorClothHat', 'parses named Allocs equipment JSON and skips empty slots');

const wrapped = parseAllocsInventoryJson({
  inventory: {
    Bag: [{ name: 'resourceScrapIron', count: 4 }],
    Belt: [],
    Equipment: [{ slot: 'hands', name: 'meleeToolSalvageT1Wrench', count: 1 }],
  },
});
assert(wrapped.bag[0].name === 'resourceScrapIron', 'unwraps inventory.Bag JSON');
assert(wrapped.equipment[0].slot === 'hands', 'keeps equipment slot from JSON');

const allocs52 = parseAllocsInventoryJson({
  bag: [{ count: 3, icon: 'wood', iconcolor: '255,255,255', name: 'resourceWood', quality: 0 }],
  belt: [{ count: 1, icon: 'axe', name: 'meleeToolAxeT1IronAxe', quality: 4, qualitycolor: '1,1,1' }],
  equipment: { armor: { name: 'armorClothJacket', count: 1 }, boots: { name: 'armorClothBoots', count: 1 }, gloves: null, head: { name: 'armorClothHat' } },
  playername: 'Example',
  userid: 'Steam_76561198000000000',
  entityid: 12,
  crossplatformid: 'EOS_0001',
});
assert(allocs52.bag[0].count === 3 && allocs52.bag[0].name === 'resourceWood', 'parses Allocs 52 bag rows');
assert(allocs52.belt[0].name === 'meleeToolAxeT1IronAxe', 'parses Allocs 52 belt rows');
assert(allocs52.equipment.some((item) => item.slot === 'head' && item.name === 'armorClothHat'), 'parses Allocs 52 equipment object');
assert(!JSON.stringify(allocs52).includes('7656119'), 'inventory snapshot drops platform ids');

const batch = parseAllocsInventoriesJson([
  {
    bag: [{ count: 3, name: 'resourceWood' }],
    belt: [],
    equipment: {},
    playername: 'Example',
    userid: 'Steam_76561198000000000',
    crossplatformid: 'EOS_0001abcdef0001abcdef0001abcdef0001',
  },
  {
    bag: [{ count: 1, name: 'resourceScrapIron' }],
    userid: 'EOS_0002abcdef0002abcdef0002abcdef0002',
  },
  { bag: [{ name: 'resourceClayLump', count: 4 }], playername: 'Nameless' },
]);
assert(batch.length === 2, 'batch inventories skip rows without steam/eos');
assert(batch[0].steamId === '76561198000000000' && batch[0].eosId === '0001abcdef0001abcdef0001abcdef0001', 'batch row keeps steam and eos for matching');
assert(batch[0].snapshot.bag[0].name === 'resourceWood' && batch[0].snapshot.bag[0].count === 3, 'batch row reuses inventory parser');
assert(batch[1].steamId === null && batch[1].eosId === '0002abcdef0002abcdef0002abcdef0002', 'userid EOS_ is matching identity');
assert(!JSON.stringify(batch.map((row) => row.snapshot)).includes('7656119'), 'batch snapshots drop platform ids');
assert(!JSON.stringify(batch.map((row) => row.snapshot)).includes('Example'), 'batch snapshots drop player names');

const wrappedBatch = parseAllocsInventoriesJson({
  data: {
    Players: [{ bag: [{ name: 'foodCanChili', count: 1 }], steamid: 'Steam_76561198000000000' }],
  },
});
assert(wrappedBatch.length === 1 && wrappedBatch[0].snapshot.bag[0].name === 'foodCanChili', 'unwraps nested Players inventories');

const single = parseAllocsInventoriesJson({
  bag: [{ name: 'resourceYuccaFibers', count: 2 }],
  userid: '76561198000000000',
});
assert(single.length === 1 && single[0].steamId === '76561198000000000', 'single inventory object is one batch row');
assert(parseAllocsInventoriesJson({ error: 'nope' }).length === 0, 'ignores non-inventory objects');

console.log('player inventory parser tests passed');
