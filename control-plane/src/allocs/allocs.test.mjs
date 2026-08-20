import { allocsAuthHeaders, allocsConfig, allocsRequestUrl, allocsTokenConfigured, mapPayloadHasNoSecrets } from './allocs.client.ts';
import { allowedAllocsConsoleCommand } from './allocs.console.ts';
import { allocsUserId, normalizeAllocsEntities, normalizeAllocsPlayers, publicMapEntities } from './allocs.normalize.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(allocsConfig({ SEVENDTD_WEB_URL: '' }) === null, 'blank url is unconfigured');
assert(allocsConfig({ SEVENDTD_WEB_URL: 'http://10.78.0.2:8080' }).url.endsWith(':8080'), 'reads env url');
assert(!allocsTokenConfigured({ SEVENDTD_WEB_URL: 'http://10.78.0.2:8080', SEVENDTD_WEB_API_TOKEN_NAME: 'mastermind' }), 'secret required for token');
assert(allocsTokenConfigured({
  SEVENDTD_WEB_URL: 'http://10.78.0.2:8080',
  SEVENDTD_WEB_API_TOKEN_NAME: 'mastermind',
  SEVENDTD_WEB_API_SECRET: 'secret',
}), 'token configured when name and secret set');

const url = allocsRequestUrl(
  { url: 'http://10.78.0.2:8080', tokenName: 'mastermind', secret: 's3cret' },
  'gethostilelocation',
);
assert(url.pathname === '/api/gethostilelocation', 'keeps allocs path');
assert(allocsRequestUrl({ url: 'http://10.78.0.2:8080', tokenName: 'u', secret: 'p' }, 'getplayersonline').pathname === '/api/getplayersonline', 'allows getplayersonline');
assert(allocsRequestUrl({ url: 'http://10.78.0.2:8080', tokenName: 'u', secret: 'p' }, 'getplayerinventories').pathname === '/api/getplayerinventories', 'allows getplayerinventories');
assert(!url.searchParams.has('adminuser'), 'does not put token name on the query string');
assert(!url.searchParams.has('admintoken'), 'does not put token secret on the query string');
const headers = allocsAuthHeaders({ url: 'http://10.78.0.2:8080', tokenName: 'mastermind', secret: 's3cret' });
assert(headers['X-SDTD-API-TOKENNAME'] === 'mastermind', 'sets token name header');
assert(headers['X-SDTD-API-SECRET'] === 's3cret', 'sets token secret header');
assert(!allocsAuthHeaders({ url: 'http://10.78.0.2:8080', tokenName: '', secret: '' })['X-SDTD-API-SECRET'], 'omits secret header when unconfigured');
try {
  allocsRequestUrl({ url: 'http://10.78.0.2:8080', tokenName: 'u', secret: 'p' }, 'getwebuiupdates');
  throw new Error('unknown endpoint should be blocked');
} catch (error) {
  assert(/not allowed/i.test(error.message), 'blocks unknown allocs endpoints');
}

assert(allowedAllocsConsoleCommand('visitmap stop') === 'visitmap stop', 'allows visitmap stop');
assert(allowedAllocsConsoleCommand('visitmap -512 0 512 1024') === 'visitmap -512 0 512 1024', 'allows numeric visitmap bounds');
assert(allowedAllocsConsoleCommand('  visitmap   1   2   3   4 ') === 'visitmap 1 2 3 4', 'normalizes visitmap spacing');
assert(allowedAllocsConsoleCommand('visitmap full') === null, 'rejects visitmap full');
assert(allowedAllocsConsoleCommand('kick 1') === null, 'rejects kick');
assert(allowedAllocsConsoleCommand('give 1 resourceWood') === null, 'rejects give');
assert(allowedAllocsConsoleCommand('st-pil 12') === null, 'rejects st-pil');
assert(allowedAllocsConsoleCommand('visitmap stop; kick 1') === null, 'rejects command chaining');
assert(allowedAllocsConsoleCommand('execute visitmap stop') === null, 'rejects prefixed commands');

const hostiles = normalizeAllocsEntities({
  hostiles: [{ id: 9, name: 'zombieBoe', position: { x: 11, y: 42, z: -8 } }],
}, 'hostile', ['hostiles']);
assert(hostiles[0].name === 'zombieBoe' && hostiles[0].position.z === -8, 'normalizes hostile locations');

const animals = normalizeAllocsEntities([
  { entityid: 4, name: 'animalBoar', x: 1, y: 2, z: 3, dead: false },
], 'animal');
assert(animals[0].id === 4 && animals[0].position.x === 1, 'normalizes animal arrays');
assert(normalizeAllocsEntities([{ id: 1, name: 'dead', x: 1, y: 1, z: 1, dead: true }], 'hostile').length === 0, 'skips dead entities');

const players = normalizeAllocsPlayers({
  players: [{ entityid: 12, name: 'Wolfie', online: true, position: { x: 5, y: 6, z: 7 } }],
});
assert(players[0].type === 'EntityPlayer' && players[0].position.y === 6, 'normalizes player locations');
assert(normalizeAllocsPlayers({ players: [{ name: 'Offline', online: false, x: 1, y: 1, z: 1 }] }).length === 0, 'skips offline players');
assert(allocsUserId('76561198000000000', null) === 'Steam_76561198000000000', 'prefixes Steam userid');
assert(allocsUserId(null, '0001') === 'EOS_0001', 'prefixes EOS userid');

const map = publicMapEntities({
  players,
  animals,
  hostiles,
  playerVisibility: 'hidden',
  errors: { hostiles: 'hostile locations unavailable' },
});
assert(map.playerVisibility === 'hidden', 'player portal can hide players');
assert(map.errors.hostiles === 'hostile locations unavailable', 'returns feed errors without throwing');
assert(!JSON.stringify(map).includes('s3cret'), 'map payload has no webtoken');
assert(!JSON.stringify(map).includes('admintoken'), 'map payload has no admintoken key');
assert(!JSON.stringify(map).includes('7656119'), 'map payload has no steam ids');
assert(mapPayloadHasNoSecrets(map), 'secret scanner rejects webtoken material');
assert(!mapPayloadHasNoSecrets({ admintoken: 's3cret' }), 'secret scanner catches admintoken');

const shop = { serverName: 'Builder Friendly PvE', checkoutEnabled: true, serverReachable: true, playersOnline: 2 };
assert(mapPayloadHasNoSecrets(shop), 'shop status has no webtoken');
assert(!JSON.stringify(shop).includes('adminuser'), 'shop status has no adminuser');

console.log('allocs tests passed');
