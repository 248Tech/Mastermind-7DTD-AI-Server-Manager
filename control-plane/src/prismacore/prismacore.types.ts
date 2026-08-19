export const PRISMACORE_LAYERS = [
  'status',
  'playersonline',
  'landclaims',
  'playerhomes',
  'vehicles',
  'drones',
  'traders',
  'questpois',
  'allpois',
  'resetregions',
  'advclaims',
] as const;

export type PrismaCoreLayer = (typeof PRISMACORE_LAYERS)[number];

export const ADV_CLAIM_TYPES = [
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
] as const;

export type AdvClaimType = (typeof ADV_CLAIM_TYPES)[number];

export type Position = { x: number; y: number; z: number };

export type PrismaCorePlayer = {
  id: string;
  name: string;
  steamId: string;
  eosId: string;
  position: Position;
};

export type PrismaCoreClaim = {
  id: string;
  owner: string;
  eosId: string;
  steamId: string;
  position: Position;
  size: number;
};

export type PrismaCoreMarker = {
  id: string;
  name: string;
  position: Position;
  extra?: string;
};

export type PrismaCoreHome = {
  id: string;
  owner: string;
  steamId: string;
  position: Position;
  active: boolean;
};

export type PrismaCorePoi = {
  id: string;
  name: string;
  x: number;
  z: number;
  minx: number;
  maxx: number;
  minz: number;
  maxz: number;
  containsBed: boolean;
};

export type PrismaCoreRect = {
  id: string;
  name: string;
  type: string;
  e: number;
  w: number;
  n: number;
  s: number;
};

export type ShopLiveStatus = {
  serverReachable: boolean;
  playersOnline: number;
};
