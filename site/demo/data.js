/* Mock data for the static Mastermind demo. Everything here is fictional. */
window.MM_DATA = (function () {
  const now = Date.now();
  const min = 60000;
  const ago = (m) => now - m * min;

  const servers = [
    { id: 'srv-1', name: 'Navezgane Survival', world: 'Navezgane', host: 'do-nyc-01', status: 'online', day: 42, time: '14:20', players: 9, max: 16, version: 'V 2.2 (b9)', fps: 58, zombies: 143, animals: 31 },
    { id: 'srv-2', name: 'Pregen10k PvE', world: 'Pregen10k-Rekt', host: 'do-nyc-01', status: 'online', day: 119, time: '21:05', players: 14, max: 24, version: 'V 2.2 (b9)', fps: 49, zombies: 212, animals: 58 },
    { id: 'srv-3', name: 'Darkness Falls Test', world: 'RWG-Arid', host: 'lab-eu-02', status: 'offline', day: 7, time: '03:40', players: 0, max: 8, version: 'V 2.1 (b30)', fps: 0, zombies: 0, animals: 0 },
  ];

  const hosts = [
    { id: 'h1', name: 'do-nyc-01', os: 'Ubuntu 24.04', agent: 'v0.0.15', ip: '10.78.0.2', status: 'online', lastSeen: 'just now', servers: 2 },
    { id: 'h2', name: 'lab-eu-02', os: 'Debian 12', agent: 'v0.0.14', ip: '10.78.0.7', status: 'offline', lastSeen: '3 h ago', servers: 1 },
  ];

  const names = ['IronMike', 'ZedHunter_77', 'NightOwl', 'SavageSally', 'PixelPaul', 'BoneCollector', 'RustyNail', 'DrWasteland', 'Kestrel', 'MossyOak', 'BrassKnuckle', 'LuckyLou', 'Tinker', 'Gravel', 'Vesper', 'Moth', 'Anvil', 'Juniper'];
  const players = names.map((n, i) => ({
    id: 'p' + i,
    name: n,
    steam: '7656119' + (8000000000 + i * 91731).toString().slice(0, 10),
    online: i < 11,
    level: 8 + ((i * 17) % 71),
    kills: 40 + ((i * 131) % 1900),
    pkills: (i * 3) % 5,
    deaths: 2 + ((i * 7) % 31),
    ping: 18 + ((i * 13) % 90),
    playtime: 3 + ((i * 11) % 160),
    ip: '203.0.113.' + (10 + i),
    country: ['US', 'US', 'CA', 'GB', 'DE', 'AU', 'US', 'NL', 'SE', 'US', 'FR', 'US', 'BR', 'PL', 'US', 'NO', 'US', 'CA'][i],
    admin: i === 0 || i === 3,
    last: i < 11 ? 'online now' : (i * 37) % 600 + ' min ago',
    x: Math.round((Math.sin(i * 2.1) * 0.8) * 3000),
    z: Math.round((Math.cos(i * 1.7) * 0.8) * 3000),
  }));

  const mods = [
    { id: 'm1', name: 'ServerTools', version: '25.4.1', author: 'Xyth', status: 'active', size: '4.2 MB', activated: '2026-10-28', note: 'Admin tooling, chat commands, rewards' },
    { id: 'm2', name: 'Allocs Server Fixes', version: '52.0', author: 'Alloc', status: 'active', size: '1.1 MB', activated: '2026-10-28', note: 'WebInterface, live map API' },
    { id: 'm3', name: 'PrismaCore', version: '3.8.0', author: 'ClaimCreator', status: 'active', size: '6.7 MB', activated: '2026-11-02', note: 'Claims, homes, traders overlay' },
    { id: 'm4', name: 'RegionHealer-v2', version: '2.0.3', author: 'community', status: 'active', size: '0.4 MB', activated: '2026-11-05', note: 'Corrupt region recovery' },
    { id: 'm5', name: 'BetterBackpack', version: '1.4.0', author: 'Rook', status: 'pending', size: '0.9 MB', activated: '-', note: 'Requested by player Kestrel — awaiting review' },
    { id: 'm6', name: 'ExtraStorage', version: '0.9.2', author: 'Vesper', status: 'quarantined', size: '2.3 MB', activated: '-', note: 'Quarantined: conflicts with PrismaCore loot XML' },
    { id: 'm7', name: 'NightVision', version: '2.1.0', author: 'Moth', status: 'quarantined', size: '0.3 MB', activated: '-', note: 'Quarantined update, config diff ready' },
  ];

  const jobs = [
    { id: 'j-1042', type: 'safe-restart', server: 'srv-1', by: 'demo.admin', status: 'succeeded', at: ago(190), out: 'Countdown 5m → save → backup → kick verified → restart OK' },
    { id: 'j-1041', type: 'backup', server: 'srv-2', by: 'scheduler', status: 'succeeded', at: ago(245), out: 'Full backup 1.8 GB written, retention pruned 1' },
    { id: 'j-1040', type: 'rcon', server: 'srv-1', by: 'ops.sam', status: 'succeeded', at: ago(300), out: 'say "Horde night tonight, stock up!"' },
    { id: 'j-1039', type: 'mod-quarantine', server: 'srv-2', by: 'demo.admin', status: 'succeeded', at: ago(980), out: 'ExtraStorage moved to quarantine' },
    { id: 'j-1038', type: 'kick', server: 'srv-1', by: 'auto-mod', status: 'succeeded', at: ago(1400), out: 'Kicked player (ping > 300ms for 5 samples)' },
  ];

  const logs = [
    '2026-11-13T14:18:02 INF GMSG: Player \'Kestrel\' joined the game',
    '2026-11-13T14:18:44 INF Spawned zombie: zombieScreamer at (412, 71, -906)',
    '2026-11-13T14:19:10 INF Player \'IronMike\' died: killed by zombieDemolition',
    '2026-11-13T14:19:31 INF GMSG: Player \'IronMike\' respawned',
    '2026-11-13T14:19:58 INF AIDirector: Scout scouting around (-212, 66, 548)',
    '2026-11-13T14:20:11 WRN Entity collision budget at 87%',
    '2026-11-13T14:20:40 INF Chat (from \'NightOwl\'): "anyone got spare wood?"',
    '2026-11-13T14:21:05 INF Mastermind: stability sample RSS 11.2 GiB (limit 16 GiB) — OK',
    '2026-11-13T14:21:33 INF Region r.4.-3 saved (0.12s)',
    '2026-11-13T14:22:01 INF Mastermind: agent heartbeat ok (18 ms)',
  ];

  const chat = [
    { t: '14:09', who: 'SavageSally', msg: 'Trader Jen has the new schematics!', src: 'player' },
    { t: '14:11', who: 'ZedHunter_77', msg: 'horde at 22:00 who is in', src: 'player' },
    { t: '14:12', who: 'Server', msg: 'Horde Night in 7 game days. Stock up!', src: 'server' },
    { t: '14:16', who: 'NightOwl', msg: 'anyone got spare wood?', src: 'player' },
    { t: '14:17', who: 'PixelPaul', msg: 'dropping some at the bridge base', src: 'player' },
  ];

  const schedules = [
    { id: 's1', name: 'Nightly safe restart', server: 'srv-1', cron: '0 5 * * *', kind: 'safe-restart', next: 'in 14h 38m', enabled: true },
    { id: 's2', name: 'Full backup every 6h', server: 'srv-1', cron: '0 */6 * * *', kind: 'backup', next: 'in 1h 38m', enabled: true },
    { id: 's3', name: 'Pregen nightly restart', server: 'srv-2', cron: '30 4 * * *', kind: 'safe-restart', next: 'in 14h 08m', enabled: true },
    { id: 's4', name: 'Weekly world backup', server: 'srv-2', cron: '0 3 * * 0', kind: 'backup', next: 'in 2d 12h', enabled: false },
  ];

  const saves = [
    { id: 'b1', server: 'srv-1', kind: 'Full backup', day: 42, size: '1.8 GB', at: '2026-11-13 12:00', by: 'scheduler' },
    { id: 'b2', server: 'srv-1', kind: 'Full backup', day: 41, size: '1.8 GB', at: '2026-11-13 06:00', by: 'scheduler' },
    { id: 'b3', server: 'srv-1', kind: 'RegionHealer snapshot', day: 41, size: '312 MB', at: '2026-11-12 22:40', by: 'region-healer' },
    { id: 'b4', server: 'srv-2', kind: 'Full backup', day: 119, size: '3.4 GB', at: '2026-11-13 04:30', by: 'scheduler' },
    { id: 'b5', server: 'srv-2', kind: 'Full backup', day: 118, size: '3.3 GB', at: '2026-11-12 04:30', by: 'demo.admin' },
  ];

  const alerts = [
    { id: 'a1', name: 'Server offline > 2 min', channel: 'Discord #ops', kind: 'server-event', last: '2 days ago', enabled: true },
    { id: 'a2', name: 'Log keyword: "NullReferenceException"', channel: 'Discord #ops', kind: 'log-keyword', last: '6 h ago', enabled: true },
    { id: 'a3', name: 'Player joined / left', channel: 'Discord #players', kind: 'player-event', last: '4 min ago', enabled: true },
    { id: 'a4', name: 'Memory > 14 GiB', channel: 'Email', kind: 'stability', last: 'never', enabled: false },
  ];

  const triggers = [
    { id: 't1', name: 'Level 25 reward', on: 'player.level >= 25', action: 'give 1x Steel Pickaxe (Q4)', fired: 37 },
    { id: 't2', name: 'Level 50 land-claim', on: 'player.level >= 50', action: 'give land-claim block', fired: 12 },
    { id: 't3', name: 'Vehicle recovery', on: 'vehicle.lost', action: 'return vehicle to owner', fired: 5 },
  ];

  const accounts = [
    { id: 'u1', email: 'demo.admin@mastermind.demo', role: 'admin', status: 'active', steam: 'linked', last: 'just now' },
    { id: 'u2', email: 'ops.sam@mastermind.demo', role: 'operator', status: 'active', steam: 'linked', last: '3 h ago' },
    { id: 'u3', email: 'viewer.jo@mastermind.demo', role: 'viewer', status: 'active', steam: 'not linked', last: '2 days ago' },
    { id: 'u4', email: 'new.user@mastermind.demo', role: 'viewer', status: 'pending', steam: 'not linked', last: 'never' },
  ];

  const pois = ['Abandoned Cabin 01', 'Army Camp 03', 'Bar & Grill', 'Bell Tower', 'Bunker Complex', 'Burnt Forest Farm', 'Carnival Fairgrounds', 'Clinic Hospital 02', 'Crack-a-Book 04', 'Downtown Highrise 7', 'Factory Complex', 'Farm Silo 02', 'Gas Station 11', 'Grain Mill', 'Hotel Grand', 'Lumber Yard', 'Mall Plaza', 'Oil Refinery', 'Pass-n-Gas 08', 'Police Station', 'Prison Yard', 'School Campus', 'Trader Joel Compound', 'Water Treatment Plant'].map((n, i) => ({
    name: n, tier: 1 + (i * 3) % 5, size: [48, 64, 96, 128][i % 4] + 'x' + [48, 64, 96, 128][(i + 1) % 4],
  }));

  const shop = [
    { id: 'sh1', name: 'Survivor Pack', price: 10, gifts: '5x Water, 5x Canned Stew', sold: 41 },
    { id: 'sh2', name: 'Builder Supporter', price: 25, gifts: 'Supporter status + chat color', sold: 18 },
    { id: 'sh3', name: 'Gold Patron', price: 50, gifts: 'Supporter + Steel Toolkit Q5', sold: 6 },
  ];

  return { servers, hosts, players, mods, jobs, logs, chat, schedules, saves, alerts, triggers, accounts, pois, shop };
})();
