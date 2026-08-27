import { parseGrantItemList, formatGrantSummary, type GrantItemSpec } from '../donations/shop-grants';

export const TRIGGER_EVENT_PLAYER_LEVEL = 'player_level';
export const TRIGGER_ACTION_LAND_CLAIM = 'land_claim_reward';
export const TRIGGER_ACTION_GRANT_ITEMS = 'grant_items';

export const TRIGGER_EVENTS = [{ type: TRIGGER_EVENT_PLAYER_LEVEL, label: 'Player level' }] as const;
export const TRIGGER_ACTIONS = [
  { type: TRIGGER_ACTION_LAND_CLAIM, label: 'Land claim reward' },
  { type: TRIGGER_ACTION_GRANT_ITEMS, label: 'Grant items' },
] as const;

export type PlayerLevelConfig = { level: number; comparison: 'gte' | 'eq' };
export type LandClaimActionConfig = { claimCount: number; notifyPlayer: boolean; message: string };
export type GrantItemsActionConfig = { items: GrantItemSpec[]; notifyPlayer: boolean; message: string };

export function parsePlayerLevelConfig(raw: unknown): PlayerLevelConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const level = Number(data.level);
  if (!Number.isInteger(level) || level < 1 || level > 300) {
    throw new Error('Level must be a whole number from 1 to 300');
  }
  const comparison = data.comparison === 'eq' ? 'eq' : 'gte';
  return { level, comparison };
}

export function parseLandClaimActionConfig(raw: unknown): LandClaimActionConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const claimCount = Number(data.claimCount);
  if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > 50) {
    throw new Error('Land claim count must be a whole number from 1 to 50');
  }
  const message = typeof data.message === 'string' ? data.message.trim().slice(0, 200) : '';
  return {
    claimCount,
    notifyPlayer: data.notifyPlayer === true,
    message: message || '{name} reached level {level} and can now place {claims} land claims.',
  };
}

export function parseGrantItemsActionConfig(raw: unknown): GrantItemsActionConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = parseGrantItemList(data.items);
  if (items === false) {
    throw new Error('Each grant must be a 7DTD item name, quantity 1–9999, and optional quality 1–6. Maximum 8 items.');
  }
  if (!items.length) {
    throw new Error('Select at least one item to grant');
  }
  const message = typeof data.message === 'string' ? data.message.trim().slice(0, 200) : '';
  return {
    items,
    notifyPlayer: data.notifyPlayer === true,
    message: message || 'You reached a reward level.',
  };
}

export function eventKeyForLevel(level: number): string {
  return `level:${level}`;
}

export function grantItemsSummary(items: GrantItemSpec[]): string {
  return formatGrantSummary(items);
}
