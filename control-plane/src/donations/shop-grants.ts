export const MAX_GRANT_QUANTITY = 9_999;
export const MAX_GRANT_ATTEMPTS = 8;
export const GRANT_ITEM_NAME = /^[A-Za-z][A-Za-z0-9_:]{0,79}$/;

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

export function classifyGrantOutput(output: string | null | undefined, jobStatus: string): GrantOutcome {
  const text = String(output || '');
  if (/player not found|must be online|could not get the player/i.test(text)) return 'retry';
  if (/item not found|invalid color|invalid value for|not a valid/i.test(text)) return 'failed';
  if (/error executing command/i.test(text)) return 'failed';
  if (jobStatus === 'success') return 'delivered';
  return 'retry';
}
