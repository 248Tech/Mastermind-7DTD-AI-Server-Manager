import { prismacoreConfig, prismacoreRequestUrl, publicShopLive, shopStatusHasOnlyPublicKeys } from './prismacore.client.ts';
import { normalizeClaims, normalizeHomes, normalizeMarkers, normalizePlayers, normalizePois, normalizeRects, parseAdvClaimType } from './prismacore.normalize.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(prismacoreConfig({ PRISMACORE_WEB_URL: '', PRISMACORE_API_USER: 'u', PRISMACORE_API_PASSWORD: 'p' }) === null, 'blank url is unconfigured');
assert(prismacoreConfig({ PRISMACORE_WEB_URL: 'http://10.77.0.2:11111', PRISMACORE_API_USER: 'mastermind', PRISMACORE_API_PASSWORD: 'secret' }).url.endsWith(':11111'), 'reads env url');

const url = prismacoreRequestUrl(
  { url: 'http://10.77.0.2:11111', user: 'mastermind', password: 'secret' },
  '/api/getplayersonline',
);
assert(url.pathname === '/api/getplayersonline', 'keeps api path');
assert(url.searchParams.get('apiuser') === 'mastermind', 'sets apiuser');
assert(url.searchParams.get('password') === 'secret', 'sets password');
assert(!url.href.includes('createadvclaims'), 'read path only');
try {
  prismacoreRequestUrl({ url: 'http://10.77.0.2:11111', user: 'u', password: 'p' }, '/api/createadvclaims');
  throw new Error('write api should be blocked');
} catch (error) {
  assert(/not allowed/i.test(error.message), 'blocks createadvclaims');
}

const players = normalizePlayers({
  Players: [
    { name: 'Wolfie', entityid: 12, steamid: '76561198000000000', eossid: 'EOS_1', x: 10, y: 2, z: -4 },
  ],
});
assert(players.length === 1 && players[0].name === 'Wolfie' && players[0].position.x === 10, 'normalizes getplayersonline');

const vehicles = normalizeMarkers({ Vehicles: [{ name: 'EntityMotorcycle', posX: 8, posY: 40, posZ: 12, steamid: 'Steam_76561198000000000' }] }, ['Vehicles', 'vehicles'], 'vehicle');
assert(vehicles[0].position.x === 8 && vehicles[0].position.z === 12, 'normalizes getvehicles');
assert(vehicles[0].steamId === '76561198000000000', 'keeps vehicle steam id');

const claims = normalizeClaims({
  claimsize: 41,
  claimowners: [{ playername: 'Wolfie', steamid: 's1', eossid: 'e1', claims: [{ x: 1, y: 2, z: 3 }] }],
});
assert(claims[0].owner === 'Wolfie' && claims[0].size === 41 && claims[0].eosId === 'e1', 'normalizes getlandclaims');

const claimIdentityFallback = normalizeClaims({
  claimSize: 41,
  claimOwners: [{ steamId: 'Steam_76561198000000000', claims: [
    { x: 4, y: 2, z: 8, owner: { playerName: 'Builder' }, eosId: 'EOS_abcdef0123456789012345' },
  ] }],
});
assert(claimIdentityFallback[0].owner === 'Builder', 'uses claim-level owner name');
assert(claimIdentityFallback[0].steamId === '76561198000000000', 'normalizes claim Steam prefix');
assert(claimIdentityFallback[0].eosId === 'abcdef0123456789012345', 'normalizes claim EOS prefix');

const claimIdLabel = normalizeClaims([{ x: 9, y: 1, z: 3, steamid: 'Steam_76561198000000000' }]);
assert(claimIdLabel[0].owner === 'Steam …000000', 'labels claims with known id when name is absent');

const homes = normalizeHomes({ homeowners: [{ steamid: '76561198000000000', x: 4, y: 5, z: 6, active: true }] });
assert(homes[0].active === true && homes[0].position.z === 6, 'normalizes getplayerhomes');
assert(homes[0].steamId === '76561198000000000', 'keeps home steam id');

const pois = normalizePois({ QuestPOIs: [{ name: 'hospital', x: 20, z: 30, minx: 10, maxx: 30, minz: 20, maxz: 40, containsbed: true }] }, ['QuestPOIs']);
assert(pois[0].containsBed === true && pois[0].minx === 10, 'normalizes quest pois');

const regions = normalizeRects([{ E: 512, W: 0, N: 512, S: 0, Name: 'r.0.0' }], 'reset');
assert(regions[0].e === 512 && regions[0].w === 0, 'normalizes reset regions');
assert(parseAdvClaimType('HostileFree') === 'hostilefree', 'parses adv claim type');
assert(parseAdvClaimType('nope') === null, 'rejects unknown adv claim type');

const live = publicShopLive({ reachable: true, playersOnline: 2 });
assert(live.serverReachable === true && live.playersOnline === 2, 'shop live count only');
assert(publicShopLive({ reachable: true, playersOnline: 999 }).playersOnline === 256, 'caps public player count');

const status = { serverName: 'Builder Friendly PvE', checkoutEnabled: true, serverReachable: true, playersOnline: 2 };
assert(shopStatusHasOnlyPublicKeys(status), 'shop status allows only public keys');
assert(!shopStatusHasOnlyPublicKeys({ ...status, players: players }), 'shop status rejects player rows');
assert(!shopStatusHasOnlyPublicKeys({ ...status, password: 'secret' }), 'shop status rejects credentials');
assert(!JSON.stringify(status).includes('apiuser'), 'serialized shop status has no apiuser');
assert(!JSON.stringify(status).includes('7656119'), 'serialized shop status has no steam ids');

console.log('prismacore tests passed');
