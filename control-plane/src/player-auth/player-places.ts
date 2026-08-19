export type PlacePosition = { x: number; y: number; z: number };

export type PlayerPlaces = {
  auth: 'steam' | 'name';
  reachable: boolean;
  claims: Array<{ id: string; position: PlacePosition; size: number }>;
  homes: Array<{ id: string; position: PlacePosition; active: boolean }>;
  vehicles: Array<{ id: string; name: string; position: PlacePosition }>;
  drones: Array<{ id: string; name: string; position: PlacePosition }>;
};

const PLACE_CAP = 32;

export function placeSteamId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = /(?:^|Steam_)([0-9]{15,20})$/i.exec(String(value).trim());
  return match ? match[1] : null;
}

export function placeEosId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /(?:^|EOS_)([a-f0-9]{20,64})$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function ownedByPlayer(
  row: { steamId?: unknown; eosId?: unknown; extra?: unknown },
  player: { steamId?: string | null; eosId?: string | null },
): boolean {
  const steam = placeSteamId(player.steamId);
  const eos = placeEosId(player.eosId) ?? (typeof player.eosId === 'string' && /^[a-f0-9]{20,64}$/i.test(player.eosId) ? player.eosId.toLowerCase() : null);
  const rowSteam = placeSteamId(row.steamId) ?? placeSteamId(row.extra);
  const rowEos = placeEosId(row.eosId) ?? placeEosId(row.extra);
  if (steam && rowSteam && steam === rowSteam) return true;
  if (eos && rowEos && eos.toLowerCase() === rowEos.toLowerCase()) return true;
  return false;
}

export function emptyPlayerPlaces(auth: 'steam' | 'name', reachable = false): PlayerPlaces {
  return { auth, reachable, claims: [], homes: [], vehicles: [], drones: [] };
}

function positionOf(row: { position?: PlacePosition }): PlacePosition | null {
  const position = row.position;
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
  if (Math.abs(position.x) > 1_000_000 || Math.abs(position.y) > 10_000 || Math.abs(position.z) > 1_000_000) return null;
  return { x: position.x, y: position.y, z: position.z };
}

export function filterPlayerPlaces(
  layers: {
    reachable?: boolean;
    claims?: Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; position?: PlacePosition; size?: number }>;
    homes?: Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; position?: PlacePosition; active?: boolean }>;
    vehicles?: Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; name?: string; position?: PlacePosition }>;
    drones?: Array<{ steamId?: unknown; eosId?: unknown; extra?: unknown; name?: string; position?: PlacePosition }>;
  },
  player: { steamId?: string | null; eosId?: string | null },
): PlayerPlaces {
  const claims: PlayerPlaces['claims'] = [];
  for (const row of layers.claims ?? []) {
    if (!ownedByPlayer(row, player)) continue;
    const position = positionOf(row);
    if (!position) continue;
    const size = Number(row.size);
    claims.push({
      id: `claim:${Math.round(position.x)}:${Math.round(position.z)}:${claims.length}`,
      position,
      size: Number.isFinite(size) && size >= 1 ? Math.min(size, 256) : 41,
    });
    if (claims.length >= PLACE_CAP) break;
  }
  const homes: PlayerPlaces['homes'] = [];
  for (const row of layers.homes ?? []) {
    if (!ownedByPlayer(row, player)) continue;
    const position = positionOf(row);
    if (!position) continue;
    homes.push({
      id: `home:${Math.round(position.x)}:${Math.round(position.z)}:${homes.length}`,
      position,
      active: row.active !== false,
    });
    if (homes.length >= PLACE_CAP) break;
  }
  const vehicles: PlayerPlaces['vehicles'] = [];
  for (const row of layers.vehicles ?? []) {
    if (!ownedByPlayer(row, player)) continue;
    const position = positionOf(row);
    if (!position) continue;
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 80) : 'Vehicle';
    vehicles.push({
      id: `vehicle:${Math.round(position.x)}:${Math.round(position.z)}:${vehicles.length}`,
      name,
      position,
    });
    if (vehicles.length >= PLACE_CAP) break;
  }
  const drones: PlayerPlaces['drones'] = [];
  for (const row of layers.drones ?? []) {
    if (!ownedByPlayer(row, player)) continue;
    const position = positionOf(row);
    if (!position) continue;
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 80) : 'Drone';
    drones.push({
      id: `drone:${Math.round(position.x)}:${Math.round(position.z)}:${drones.length}`,
      name,
      position,
    });
    if (drones.length >= PLACE_CAP) break;
  }
  return {
    auth: 'steam',
    reachable: Boolean(layers.reachable),
    claims,
    homes,
    vehicles,
    drones,
  };
}

export function placesPayloadHasNoSecrets(payload: unknown): boolean {
  const blob = JSON.stringify(payload);
  return !/admintoken|adminuser|apiuser|password=|SEVENDTD_WEB_API|webtoken|X-SDTD-API-SECRET|7656119|Steam_|EOS_/i.test(blob);
}
