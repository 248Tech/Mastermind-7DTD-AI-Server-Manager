import type { AdvClaimType, PrismaCoreClaim, PrismaCoreHome, PrismaCoreMarker, PrismaCorePlayer, PrismaCorePoi, PrismaCoreRect } from './prismacore.types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function asArray(value: unknown, keys: string[] = []): unknown[] {
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

function num(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return Boolean(value);
}

function positionOf(row: Record<string, unknown>, fallbackIndex = 0) {
  const nested = asRecord(row.position) || asRecord(row.pos);
  return {
    x: num(row.x, row.posX, nested?.x, fallbackIndex),
    y: num(row.y, row.posY, nested?.y),
    z: num(row.z, row.posZ, nested?.z),
  };
}

export function normalizePlayers(json: unknown): PrismaCorePlayer[] {
  return asArray(json, ['Players', 'players', 'PlayerList', 'data']).map((row, index) => {
    const item = asRecord(row) || {};
    const name = text(item.name, item.playername, item.playerName, item.Name) || 'Player';
    const steamId = text(item.steamid, item.steamId, item.PlatformId, item.platformId, item.nativeuserid);
    const eosId = text(item.eossid, item.eosId, item.crossid, item.userid);
    const id = text(item.entityid, item.entityId, item.id) || `${steamId || eosId || name}:${index}`;
    return { id, name, steamId, eosId, position: positionOf(item, index) };
  });
}

export function normalizeClaims(json: unknown): PrismaCoreClaim[] {
  const record = asRecord(json);
  const size = Math.max(1, num(record?.claimsize, record?.claimSize, record?.ClaimSize, 41));
  const owners = asArray(json, ['claimowners', 'claimOwners', 'ClaimOwners', 'owners', 'data']);
  const claims: PrismaCoreClaim[] = [];
  owners.forEach((ownerRaw, ownerIndex) => {
    const owner = asRecord(ownerRaw) || {};
    const name = text(owner.playername, owner.playerName, owner.name, owner.Name) || 'Unknown player';
    const steamId = text(owner.steamid, owner.steamId, owner.nativeuserid);
    const eosId = text(owner.eossid, owner.eosId, owner.userid);
    asArray(owner.claims, ['Claims']).forEach((claimRaw, claimIndex) => {
      const claim = asRecord(claimRaw) || {};
      const position = positionOf(claim, claimIndex);
      claims.push({
        id: `${eosId || steamId || ownerIndex}:${position.x}:${position.y}:${position.z}`,
        owner: name,
        eosId,
        steamId,
        position,
        size,
      });
    });
  });
  if (claims.length === 0) {
    asArray(json).forEach((row, index) => {
      const item = asRecord(row) || {};
      if (item.x == null && item.posX == null && !asRecord(item.position)) return;
      const position = positionOf(item, index);
      const owner = text(item.owner, item.playername, item.name) || 'Unknown player';
      const steamId = text(item.steamid, item.steamId);
      const eosId = text(item.eossid, item.eosId);
      claims.push({
        id: `${eosId || steamId || owner}:${position.x}:${position.y}:${position.z}`,
        owner,
        eosId,
        steamId,
        position,
        size: Math.max(1, num(item.size, size)),
      });
    });
  }
  return claims;
}

export function normalizeMarkers(json: unknown, keys: string[], fallbackName: string): PrismaCoreMarker[] {
  return asArray(json, keys).map((row, index) => {
    const item = asRecord(row) || {};
    const name = text(item.name, item.Name) || `${fallbackName} ${index + 1}`;
    const position = positionOf(item, index);
    return {
      id: `${fallbackName}:${name}:${position.x}:${position.z}:${index}`,
      name,
      position,
      extra: text(item.owner, item.steamid, item.steamId) || undefined,
    };
  });
}

export function normalizeHomes(json: unknown): PrismaCoreHome[] {
  return asArray(json, ['homeowners', 'HomeOwners', 'homes', 'data']).map((row, index) => {
    const item = asRecord(row) || {};
    const steamId = text(item.steamid, item.steamId, item.owner);
    const position = positionOf(item, index);
    return {
      id: `${steamId || 'home'}:${position.x}:${position.z}:${index}`,
      owner: text(item.playername, item.name, steamId) || 'Unknown player',
      steamId,
      position,
      active: bool(item.active ?? item.Active ?? true),
    };
  });
}

export function normalizePois(json: unknown, keys: string[]): PrismaCorePoi[] {
  return asArray(json, keys).map((row, index) => {
    const item = asRecord(row) || {};
    const name = text(item.name, item.Name) || `POI ${index + 1}`;
    const x = num(item.x, item.posX);
    const z = num(item.z, item.posZ);
    const minx = num(item.minx, item.minX, x);
    const maxx = num(item.maxx, item.maxX, x);
    const minz = num(item.minz, item.minZ, z);
    const maxz = num(item.maxz, item.maxZ, z);
    return {
      id: `${name}:${x}:${z}:${index}`,
      name,
      x,
      z,
      minx,
      maxx,
      minz,
      maxz,
      containsBed: bool(item.containsbed ?? item.containsBed),
    };
  });
}

export function normalizeRects(json: unknown, type: string): PrismaCoreRect[] {
  return asArray(json, ['regions', 'Regions', 'data']).map((row, index) => {
    const item = asRecord(row) || {};
    const e = num(item.E, item.e, item.maxx, item.maxX);
    const w = num(item.W, item.w, item.minx, item.minX);
    const n = num(item.N, item.n, item.maxz, item.maxZ);
    const s = num(item.S, item.s, item.minz, item.minZ);
    const name = text(item.Name, item.name) || `${type} ${index + 1}`;
    return {
      id: `${type}:${name}:${w}:${s}:${e}:${n}:${index}`,
      name,
      type: text(item.Type, item.type) || type,
      e,
      w,
      n,
      s,
    };
  });
}

const ADV_CLAIM_TYPE_SET = new Set([
  'normal',
  'reversed',
  'hostilefree',
  'timed',
  'leveled',
  'portal',
  'openhours',
  'notify',
  'command',
  'playerlevel',
  'lcbfree',
  'antiblock',
  'reset',
  'problock',
  'landclaim',
]);

export function parseAdvClaimType(raw: unknown): AdvClaimType | null {
  if (typeof raw !== 'string') return null;
  const type = raw.trim().toLowerCase();
  return ADV_CLAIM_TYPE_SET.has(type) ? type as AdvClaimType : null;
}
