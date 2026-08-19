export type MapEntity = {
  id: string | number;
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
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

function num(...values: unknown[]): number {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return false;
}

function positionOf(row: Record<string, unknown>) {
  const nested = asRecord(row.position) || asRecord(row.pos);
  const x = num(row.x, row.posX, nested?.x);
  const y = num(row.y, row.posY, nested?.y);
  const z = num(row.z, row.posZ, nested?.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 10_000 || Math.abs(z) > 1_000_000) return null;
  return { x, y, z };
}

export function normalizeAllocsEntities(json: unknown, type: string, keys: string[] = []): MapEntity[] {
  return asArray(json, keys).flatMap((row, index) => {
    const item = asRecord(row);
    if (!item || bool(item.dead) || bool(item.offline)) return [];
    const position = positionOf(item);
    if (!position) return [];
    const name = text(item.name, item.entityName, item.type, type) || type;
    const id = text(item.id, item.entityid, item.entityId) || `${type}:${index}`;
    const numeric = Number(id);
    return [{
      id: Number.isInteger(numeric) ? numeric : id,
      name,
      type: text(item.type, type) || type,
      position,
    }];
  }).slice(0, 500);
}

export function normalizeAllocsPlayers(json: unknown): MapEntity[] {
  return asArray(json, ['Players', 'players', 'data', 'result']).flatMap((row, index) => {
    const item = asRecord(row);
    if (!item) return [];
    if (item.online === false || bool(item.offline)) return [];
    const position = positionOf(item);
    if (!position) return [];
    const name = text(item.name, item.playername, item.playerName) || 'Player';
    const id = text(item.entityid, item.entityId, item.id) || `player:${index}`;
    const numeric = Number(id);
    return [{
      id: Number.isInteger(numeric) ? numeric : id,
      name,
      type: 'EntityPlayer',
      position,
    }];
  }).slice(0, 128);
}

export function publicMapEntities(input: {
  players: MapEntity[];
  animals: MapEntity[];
  hostiles: MapEntity[];
  errors?: { players?: string; animals?: string; hostiles?: string };
  playerVisibility?: 'verified' | 'hidden';
}) {
  const errors: { players?: string; animals?: string; hostiles?: string } = {};
  if (input.errors?.players) errors.players = input.errors.players;
  if (input.errors?.animals) errors.animals = input.errors.animals;
  if (input.errors?.hostiles) errors.hostiles = input.errors.hostiles;
  return {
    players: input.players,
    animals: input.animals,
    hostiles: input.hostiles,
    ...(input.playerVisibility ? { playerVisibility: input.playerVisibility } : {}),
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

export function allocsUserId(steamId?: string | null, eosId?: string | null): string | null {
  const steam = (steamId || '').trim();
  if (steam) return steam.startsWith('Steam_') ? steam : `Steam_${steam}`;
  const eos = (eosId || '').trim();
  if (eos) return eos.startsWith('EOS_') ? eos : `EOS_${eos}`;
  return null;
}
