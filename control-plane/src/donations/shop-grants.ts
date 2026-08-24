export const MAX_GRANT_QUANTITY = 9_999;
export const MAX_GRANT_ATTEMPTS = 8;
export const MAX_GRANT_ITEMS = 8;
export const GRANT_ITEM_NAME = /^[A-Za-z][A-Za-z0-9_:]{0,79}$/;

export type GrantItemSpec = {
  name: string;
  quantity: number;
  quality: number | null;
};

export type LineGrantItem = GrantItemSpec & {
  status: string;
  attempts: number;
  error: string | null;
};

export type GrantOutcome = 'delivered' | 'retry' | 'failed';

export function parseGrantItemName(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!GRANT_ITEM_NAME.test(name)) return null;
  if (/^all$/i.test(name)) return null;
  return name;
}

export function parseGrantQuantity(raw: unknown, fallback = 1): number | null {
  if (raw == null || raw === '') return fallback;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > MAX_GRANT_QUANTITY) return null;
  return value;
}

export function parseGrantQuality(raw: unknown): number | null | false {
  if (raw == null || raw === '') return null;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > 6) return false;
  return value;
}

export function parseChatColor(raw: unknown): string | null | false {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return false;
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(raw.trim());
  return match ? match[1].toUpperCase() : false;
}

export function grantSteamTarget(steamId: string | null | undefined): string | null {
  if (!steamId) return null;
  const match = /^(?:Steam_)?([0-9]{15,20})$/i.exec(steamId.trim());
  return match ? `Steam_${match[1]}` : null;
}

export function buildGivePlusCommand(
  steamId: string | null | undefined,
  itemName: string | null | undefined,
  amount: number | null | undefined,
  quality?: number | null,
): string | null {
  const target = grantSteamTarget(steamId);
  const item = parseGrantItemName(itemName);
  const count = parseGrantQuantity(amount);
  if (!target || !item || count == null) return null;
  if (/^all$/i.test(target.replace(/^Steam_/i, ''))) return null;
  const qualityArg = quality === undefined ? null : parseGrantQuality(quality);
  if (qualityArg === false) return null;
  if (qualityArg == null) return `giveplus ${target} ${item} ${count}`;
  return `giveplus ${target} ${item} ${count} ${qualityArg}`;
}

export function buildChatColorCommand(
  steamId: string | null | undefined,
  color: string | null | undefined,
  nameOnly = true,
): string | null {
  const target = grantSteamTarget(steamId);
  const hex = parseChatColor(color);
  if (!target || !hex) return null;
  return `playerchatcolor ${target} ${hex} ${nameOnly ? 1 : 0}`;
}

export function parseGrantItemList(raw: unknown): GrantItemSpec[] | false {
  if (raw == null || raw === '') return [];
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text || text === '[]') return [];
    try { value = JSON.parse(text); } catch { return false; }
  }
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_GRANT_ITEMS) return false;
  const items: GrantItemSpec[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return false;
    const record = row as Record<string, unknown>;
    const nameRaw = record.name ?? record.itemName ?? record.grantItemName;
    if (nameRaw == null || String(nameRaw).trim() === '') continue;
    const name = parseGrantItemName(nameRaw);
    const quantity = parseGrantQuantity(record.quantity ?? record.grantQuantity, 1);
    const quality = parseGrantQuality(record.quality ?? record.grantQuality);
    if (!name || quantity == null || quality === false) return false;
    items.push({ name, quantity, quality });
  }
  return items;
}

export function grantSpecsFromFields(
  itemName: unknown,
  quantity: unknown,
  quality: unknown,
  grantItems?: unknown,
): GrantItemSpec[] | false {
  if (grantItems != null && grantItems !== '') {
    return parseGrantItemList(grantItems);
  }
  const name = parseGrantItemName(itemName);
  if (!name) return [];
  const count = parseGrantQuantity(quantity, 1);
  const grade = parseGrantQuality(quality);
  if (count == null || grade === false) return false;
  return [{ name, quantity: count, quality: grade }];
}

export function snapshotLineGrants(items: GrantItemSpec[]): LineGrantItem[] {
  return items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    quality: item.quality,
    status: 'pending',
    attempts: 0,
    error: null,
  }));
}

export function lineGrantItems(raw: unknown, fallback?: { grantItemName?: string | null; grantQuantity?: number | null; grantQuality?: number | null }): LineGrantItem[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { value = []; }
  }
  if (Array.isArray(value) && value.length) {
    const items: LineGrantItem[] = [];
    for (const row of value) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const name = parseGrantItemName(record.name ?? record.itemName ?? record.grantItemName);
      const quantity = parseGrantQuantity(record.quantity ?? record.grantQuantity, 1);
      const quality = parseGrantQuality(record.quality ?? record.grantQuality);
      if (!name || quantity == null || quality === false) continue;
      const attempts = Number(record.attempts);
      items.push({
        name,
        quantity,
        quality,
        status: typeof record.status === 'string' && record.status ? record.status : 'pending',
        attempts: Number.isInteger(attempts) && attempts >= 0 ? Math.min(attempts, 99) : 0,
        error: typeof record.error === 'string' ? record.error.slice(0, 180) : null,
      });
    }
    if (items.length) return items.slice(0, MAX_GRANT_ITEMS);
  }
  const specs = grantSpecsFromFields(fallback?.grantItemName, fallback?.grantQuantity, fallback?.grantQuality);
  return snapshotLineGrants(specs === false ? [] : specs);
}

export function aggregateGrantStatus(items: LineGrantItem[]): string {
  if (!items.length) return 'none';
  const statuses = items.map((item) => item.status);
  if (statuses.every((status) => status === 'delivered')) return 'delivered';
  if (statuses.every((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => status === 'queued')) return 'queued';
  if (statuses.some((status) => status === 'delivered') && statuses.some((status) => status === 'failed')) return 'partial';
  return 'pending';
}

export function formatGrantSummary(items: GrantItemSpec[]): string {
  return items.map((item) => `${item.quantity}× ${item.name}${item.quality ? ` Q${item.quality}` : ''}`).join(', ');
}

export function classifyGrantOutput(output: string | null | undefined, jobStatus: string): GrantOutcome {
  const text = String(output || '');
  if (/player not found|must be online|could not get the player/i.test(text)) return 'retry';
  if (/item not found|invalid color|invalid value for|not a valid/i.test(text)) return 'failed';
  if (/error executing command/i.test(text)) return 'failed';
  if (jobStatus === 'success') return 'delivered';
  return 'retry';
}
