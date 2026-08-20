import { cleanRosterIp, parseAllocsPlayersOnline, parseLpRoster, rosterIdentityKey } from './player-roster.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(rosterIdentityKey('76561198000000000', null, 'Ada') === 'steam:76561198000000000', 'prefers steam identity');
assert(rosterIdentityKey(null, 'aabbccddeeff00112233445566778899aabbccdd', 'Ada') === 'eos:aabbccddeeff00112233445566778899aabbccdd', 'uses eos when steam missing');
assert(cleanRosterIp('203.0.113.10:26900') === '203.0.113.10', 'strips ipv4 port');
assert(cleanRosterIp('[2001:db8::1]:26900') === '2001:db8::1', 'strips ipv6 brackets');
assert(cleanRosterIp('unknown') === null, 'drops unknown ip');

const lp = parseLpRoster(`
0. id=171, Builder, pos=(-1123.4, 62.0, 456.7), rot=(0.0, 180.0, 0.0), remote=True, health=100, deaths=2, zombies=10, players=0, score=0, level=12, ping=40, ip=203.0.113.10:26900, pltfmid=Steam_76561198000000000
Total of 1 in the game
`);
assert(lp && lp.length === 1, 'parses lp footer and one row');
assert(lp[0].entityId === 171 && lp[0].steamId === '76561198000000000', 'parses lp steam and entity');
assert(lp[0].ping === 40 && lp[0].zombieKills === 10 && lp[0].ipAddress === '203.0.113.10', 'parses lp ping kills ip');
assert(lp[0].position && lp[0].position.x === -1123.4, 'parses lp position');
assert(parseLpRoster('0. id=1, NoFooter, ping=1') === null, 'rejects lp without total footer');

assert(parseAllocsPlayersOnline([])?.length === 0, 'empty allocs roster is usable');
assert(parseAllocsPlayersOnline({ hello: true }) === null, 'unknown object falls back');
assert(parseAllocsPlayersOnline([{ name: 'NoId' }]) === null, 'rows without entity id fall back');

const allocs = parseAllocsPlayersOnline([{
  entityid: 12,
  name: 'Wolfie',
  online: true,
  ping: 37,
  ip: '198.51.100.20:12345',
  steamid: 'Steam_76561198000000000',
  crossplatformid: 'EOS_aabbccddeeff00112233445566778899aabbccdd',
  level: 18,
  zombiekills: 44,
  playerkills: 1,
  playerdeaths: 3,
  position: { x: 5, y: 6, z: 7 },
}]);
assert(allocs && allocs[0].steamId === '76561198000000000', 'strips Steam_ prefix');
assert(allocs[0].eosId === 'aabbccddeeff00112233445566778899aabbccdd', 'strips EOS_ prefix');
assert(allocs[0].identityKey === 'steam:76561198000000000', 'allocs identity prefers steam');
assert(allocs[0].ping === 37 && allocs[0].level === 18 && allocs[0].zombieKills === 44, 'copies combat counters');
assert(allocs[0].ipAddress === '198.51.100.20', 'strips allocs ip port');
assert(allocs[0].position && allocs[0].position.z === 7, 'copies nested position');
assert(!JSON.stringify(allocs).includes('Steam_'), 'stored steam id has no Steam_ prefix');

const wrapped = parseAllocsPlayersOnline({
  data: [{ entityid: 9, name: 'Ada', online: true, steamid: '76561198000000001', ping: 12, position: { x: 1, y: 2, z: 3 } }],
});
assert(wrapped && wrapped[0].name === 'Ada' && wrapped[0].ping === 12, 'unwraps data array');
assert(parseAllocsPlayersOnline([{ entityid: 3, name: 'Gone', online: false, ping: 1 }])?.length === 0, 'skips offline allocs rows');
assert(parseAllocsPlayersOnline(null) === null, 'null json falls back');
assert(parseAllocsPlayersOnline({ result: 'not a list' }) === null, 'string result falls back');
const nested = parseAllocsPlayersOnline({
  data: { result: [{ entityid: 4, name: 'Nested', online: true, steamid: '76561198000000002', ping: 9, position: { x: 1, y: 2, z: 3 } }] },
});
assert(nested && nested[0].name === 'Nested' && nested[0].ping === 9, 'unwraps nested data.result');

console.log('player roster tests passed');
