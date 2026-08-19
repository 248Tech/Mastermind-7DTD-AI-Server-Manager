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

function steamIdOf(value: string): string {
  return /(?:^|Steam_)([0-9]{15,20})$/i.exec(value.trim())?.[1] ?? '';
}

function eosIdOf(value: string): string {
  return /(?:^|EOS_)([a-f0-9]{20,64})$/i.exec(value.trim())?.[1] ?? '';
}

function claimIdentity(row: Record<string, unknown>): { name: string; steamId: string; eosId: string } {
  const nestedOwner = asRecord(row.owner) || asRecord(row.Owner) || asRecord(row.player) || asRecord(row.Player) || {};
  const name = text(
    row.playername, row.playerName, row.PlayerName, row.ownername, row.ownerName,
    row.username, row.userName, row.displayname, row.displayName, row.name, row.Name,
    typeof row.owner === 'string' ? row.owner : undefined,
    typeof row.player === 'string' ? row.player : undefined,
    nestedOwner.playername, nestedOwner.playerName, nestedOwner.name, nestedOwner.Name,
    nestedOwner.username, nestedOwner.userName,
  );
  const rawSteam = text(
    row.steamid, row.steamId, row.SteamID, row.nativeuserid, row.platformid, row.platformId,
    nestedOwner.steamid, nestedOwner.steamId, nestedOwner.SteamID, nestedOwner.nativeuserid,
  );
  const rawEos = text(
    row.eossid, row.eosId, row.EOSID, row.userid, row.userId, row.crossid,
    row.crossplatformid, row.crossPlatformId,
    nestedOwner.eossid, nestedOwner.eosId, nestedOwner.EOSID, nestedOwner.userid,
    nestedOwner.userId, nestedOwner.crossplatformid,
  );
  return {
    name,
    steamId: steamIdOf(rawSteam) || rawSteam,
    eosId: eosIdOf(rawEos) || rawEos,
  };
}

function identityLabel(identity: { name: string; steamId: string; eosId: string }): string {
  if (identity.name) return identity.name;
  if (identity.steamId) return `Steam …${identity.steamId.slice(-6)}`;
  if (identity.eosId) return `EOS …${identity.eosId.slice(-6)}`;
  return 'Unknown player';
}

function positionOf(row: Record<string, unknown>, fallbackIndex = 0) {
  const nested = asRecord(row.position) || asRecord(row.Position) || asRecord(row.pos) || asRecord(row.Pos);
  return {
    x: num(row.x, row.X, row.posX, row.PosX, nested?.x, nested?.X, fallbackIndex),
    y: num(row.y, row.Y, row.posY, row.PosY, nested?.y, nested?.Y),
    z: num(row.z, row.Z, row.posZ, row.PosZ, nested?.z, nested?.Z),
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
    const ownerIdentity = claimIdentity(owner);
    const nestedClaims = asArray(owner.claims, ['Claims', 'landclaims', 'LandClaims', 'claimlist', 'ClaimList']);
    nestedClaims.forEach((claimRaw, claimIndex) => {
      const claim = asRecord(claimRaw) || {};
      const identity = claimIdentity(claim);
      const merged = {
        name: identity.name || ownerIdentity.name,
        steamId: identity.steamId || ownerIdentity.steamId,
        eosId: identity.eosId || ownerIdentity.eosId,
      };
      const position = positionOf(claim, claimIndex);
      claims.push({
        id: `${merged.eosId || merged.steamId || ownerIndex}:${position.x}:${position.y}:${position.z}`,
        owner: identityLabel(merged),
        eosId: merged.eosId,
        steamId: merged.steamId,
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
      const identity = claimIdentity(item);
      claims.push({
        id: `${identity.eosId || identity.steamId || identity.name || index}:${position.x}:${position.y}:${position.z}`,
        owner: identityLabel(identity),
        eosId: identity.eosId,
        steamId: identity.steamId,
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
    const steamId = steamIdOf(text(item.steamid, item.steamId, item.owner));
    const eosId = eosIdOf(text(item.eossid, item.eosId, item.userid, item.crossplatformid));
    return {
      id: `${fallbackName}:${name}:${position.x}:${position.z}:${index}`,
      name,
      position,
      extra: text(item.owner, item.steamid, item.steamId) || undefined,
      ...(steamId ? { steamId } : {}),
      ...(eosId ? { eosId } : {}),
    };
  });
}

export function normalizeHomes(json: unknown): PrismaCoreHome[] {
  return asArray(json, ['homeowners', 'HomeOwners', 'homes', 'data']).map((row, index) => {
    const item = asRecord(row) || {};
    const steamId = steamIdOf(text(item.steamid, item.steamId, item.owner));
    const eosId = eosIdOf(text(item.eossid, item.eosId, item.userid));
    const position = positionOf(item, index);
    return {
      id: `${steamId || eosId || 'home'}:${position.x}:${position.z}:${index}`,
      owner: text(item.playername, item.name, steamId) || 'Unknown player',
      steamId,
      ...(eosId ? { eosId } : {}),
      position,
      active: bool(item.active ?? item.Active ?? true),
    };
  });
}

export function normalizePois(json: unknown, keys: string[]): PrismaCorePoi[] {
  const rows = asArray(json, [...keys, 'POIs', 'Pois', 'POI', 'data', 'results', 'items']);
  return rows.map((row, index) => {
    const item = asRecord(row) || {};
    const name = text(item.name, item.Name, item.poiName, item.POIName) || `POI ${index + 1}`;
    const x = num(item.x, item.X, item.posX, item.PosX, asRecord(item.position)?.x, asRecord(item.position)?.X, asRecord(item.Position)?.x, asRecord(item.Position)?.X);
    const z = num(item.z, item.Z, item.posZ, item.PosZ, asRecord(item.position)?.z, asRecord(item.position)?.Z, asRecord(item.Position)?.z, asRecord(item.Position)?.Z);
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
