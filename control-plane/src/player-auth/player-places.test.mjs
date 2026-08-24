import { emptyPlayerPlaces, filterPlayerPlaces, ownedByPlayer, placeEosId, placesPayloadHasNoSecrets, placeSteamId } from './player-places.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(placeSteamId('Steam_76561198000000000') === '76561198000000000', 'strips Steam_ prefix');
assert(placeSteamId('76561198000000000') === '76561198000000000', 'accepts raw steam id');
assert(placeSteamId('Wolfie') === null, 'rejects display names');
assert(placeEosId('EOS_aabbccddeeff00112233445566778899aabbccdd') === 'aabbccddeeff00112233445566778899aabbccdd', 'strips EOS_ prefix');

const player = { steamId: '76561198000000000', eosId: 'aabbccddeeff00112233445566778899aabbccdd' };
assert(ownedByPlayer({ steamId: 'Steam_76561198000000000' }, player), 'matches Steam_ owner');
assert(ownedByPlayer({ eosId: 'EOS_aabbccddeeff00112233445566778899aabbccdd' }, player), 'matches EOS_ owner');
assert(!ownedByPlayer({ steamId: '76561198000000001', extra: 'Wolfie' }, player), 'does not match by name');
assert(ownedByPlayer({ extra: 'Steam_76561198000000000' }, player), 'matches steam id in extra');

const nameSession = emptyPlayerPlaces('name');
assert(nameSession.auth === 'name' && nameSession.claims.length === 0 && nameSession.homes.length === 0, 'name session is empty');

const filtered = filterPlayerPlaces({
  reachable: true,
  claims: [
    { steamId: 'Steam_76561198000000000', eosId: 'other', position: { x: 10, y: 2, z: 30 }, size: 41 },
    { steamId: '76561198000000001', position: { x: 99, y: 2, z: 99 }, size: 41 },
  ],
  homes: [{ steamId: '76561198000000000', position: { x: 4, y: 5, z: 6 }, active: true }],
  vehicles: [{ extra: 'Steam_76561198000000000', name: 'EntityMotorcycle', position: { x: 8, y: 40, z: 12 } }],
  drones: [{ name: 'SomeoneElse', steamId: '76561198000000001', position: { x: 1, y: 2, z: 3 } }],
}, player);

assert(filtered.claims.length === 1 && filtered.claims[0].position.x === 10, 'keeps own claim');
assert(filtered.homes.length === 1 && filtered.homes[0].active === true, 'keeps own home');
assert(filtered.vehicles.length === 1 && filtered.vehicles[0].name === 'EntityMotorcycle', 'keeps own vehicle');
assert(filtered.drones.length === 0, 'drops other drones');
assert(!JSON.stringify(filtered).includes('7656119'), 'public ids omit steam');
assert(!JSON.stringify(filtered).includes('Steam_'), 'public payload omits Steam_ prefix');
assert(placesPayloadHasNoSecrets(filtered), 'places payload has no secrets');
assert(!placesPayloadHasNoSecrets({ ...filtered, steamId: '76561198000000000' }), 'rejects leaked steam id');

console.log('player places tests passed');
