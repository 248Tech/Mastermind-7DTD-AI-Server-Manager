export type PlayerRosterRow = {
  entityId: number;
  name: string;
  identityKey: string;
  steamId: string | null;
  eosId: string | null;
  ipAddress: string | null;
  ping: number | null;
  level: number;
  zombieKills: number;
  playerKills: number;
  deaths: number;
  position: { x: number; y: number; z: number } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function int(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isInteger(n)) return n;
  }
  return NaN;
}

function finite(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function steamIdOf(value: string): string | null {
  const match = /(?:^|Steam_)([0-9]{15,20})$/i.exec(value.trim());
  return match ? match[1] : null;
}

function eosIdOf(value: string): string | null {
  const match = /(?:^|EOS_)([a-f0-9]{20,64})$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function rosterIdentityKey(steamId: string | null, eosId: string | null, name: string): string {
  if (steamId) return `steam:${steamId}`;
  if (eosId) return `eos:${eosId}`;
  return `name:${name.toLowerCase()}`;
}

export function cleanRosterIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^\[|\]$/g, '');
  if (!trimmed || /^(unknown|none|null|n\/a)$/i.test(trimmed)) return null;
  const host = trimmed.includes(']:') ? trimmed.replace(/^\[/, '').replace(/\]:\d+$/, '') : trimmed.replace(/:(\d+)$/, (match, port) => {
    return Number(port) > 0 && Number(port) < 65536 && !trimmed.includes('::') ? '' : match;
  });
  const ip = host || trimmed.split('%')[0];
  return ip.slice(0, 64) || null;
}

function positionFromRecord(row: Record<string, unknown>) {
  const nested = asRecord(row.position) || asRecord(row.pos);
  const x = finite(row.x, row.posX, nested?.x);
  const y = finite(row.y, row.posY, nested?.y);
  const z = finite(row.z, row.posZ, nested?.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z };
}

export function parseLpRoster(output: string): PlayerRosterRow[] | null {
  if (!/Total of\s+\d+\s+in the game/i.test(output)) return null;
  const rows: PlayerRosterRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const head = line.match(/^\s*\d+\.\s+id=(\d+),\s*([^,]+),/i);
    if (!head) continue;
    const steam = line.match(/(?:pltfmid|steamid)=Steam_([0-9]{15,20})/i)?.[1] ?? null;
    const eos = line.match(/(?:crossid|pltfmid)=EOS_([a-f0-9]{20,64})/i)?.[1] ?? null;
    const name = head[2].trim();
    if (!name) continue;
    const ping = int(line.match(/\bping\s*=\s*(\d+)/i)?.[1]);
    rows.push({
      entityId: Number(head[1]),
      name,
      steamId: steam,
      eosId: eos,
      identityKey: rosterIdentityKey(steam, eos, name),
      ipAddress: cleanRosterIp(line.match(/\bip\s*=\s*(\[[^\]]+\]|[^,\s]+)/i)?.[1]),
      ping: Number.isInteger(ping) ? ping : null,
      zombieKills: Number(line.match(/(?:zombies|zombiekills)\s*=\s*(\d+)/i)?.[1] ?? 0),
      playerKills: Number(line.match(/(?:players|playerkills)\s*=\s*(\d+)/i)?.[1] ?? 0),
      deaths: Number(line.match(/deaths\s*=\s*(\d+)/i)?.[1] ?? 0),
      level: Number(line.match(/level\s*=\s*(\d+)/i)?.[1] ?? 1),
      position: positionFromLpLine(line),
    });
  }
  return rows.slice(0, 256);
}

function positionFromLpLine(line: string) {
  const match = /\bpos=\((-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\)/i.exec(line);
  if (!match) return null;
  const x = Number(match[1]), y = Number(match[2]), z = Number(match[3]);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z };
}

export function parseAllocsPlayersOnline(json: unknown): PlayerRosterRow[] | null {
  if (json == null) return null;
  const items = asArray(json, ['Players', 'players', 'data', 'result']);
  if (!Array.isArray(json) && items.length === 0 && asRecord(json) && !('Players' in (json as object) || 'players' in (json as object) || 'data' in (json as object))) {
    return null;
  }
  const rows: PlayerRosterRow[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    if (item.online === false) continue;
    const name = text(item.name, item.playername, item.playerName, item.Name);
    const entityId = int(item.entityid, item.entityId, item.id);
    if (!name || !Number.isInteger(entityId) || entityId < 1) continue;
    const steam = steamIdOf(text(item.steamid, item.steamId, item.PlatformId, item.platformId, item.pltfmid));
    const eos = eosIdOf(text(item.crossplatformid, item.crossPlatformId, item.eossid, item.eosId, item.userid, item.crossid));
    const ping = int(item.ping, item.Ping);
    rows.push({
      entityId,
      name,
      steamId: steam,
      eosId: eos,
      identityKey: rosterIdentityKey(steam, eos, name),
      ipAddress: cleanRosterIp(text(item.ip, item.ipAddress, item.IP)),
      ping: Number.isInteger(ping) ? ping : null,
      zombieKills: Number.isInteger(int(item.zombiekills, item.zombieKills, item.zombies)) ? int(item.zombiekills, item.zombieKills, item.zombies) : 0,
      playerKills: Number.isInteger(int(item.playerkills, item.playerKills, item.players)) ? int(item.playerkills, item.playerKills, item.players) : 0,
      deaths: Number.isInteger(int(item.playerdeaths, item.playerDeaths, item.deaths)) ? int(item.playerdeaths, item.playerDeaths, item.deaths) : 0,
      level: Number.isInteger(int(item.level, item.Level)) ? Math.max(1, int(item.level, item.Level)) : 1,
      position: positionFromRecord(item),
    });
  }
  if (items.length > 0 && rows.length === 0) return null;
  return rows.slice(0, 256);
}
