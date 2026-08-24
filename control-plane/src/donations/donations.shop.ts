import { join } from 'path';

export const MIN_SHOP_PRICE_CENTS = 100;
export const MAX_SHOP_PRICE_CENTS = 50_000;
export const MAX_SHOP_ITEMS = 50;
export const MAX_SHOP_IMAGE_BYTES = 2 * 1024 * 1024;
/** Max edge for detail/lightbox (2× 960px display). */
export const SHOP_IMAGE_MASTER_MAX_PX = 1920;
/** Max edge for grid/cart thumbnails (2× 200px display). */
export const SHOP_IMAGE_THUMB_MAX_PX = 400;
export const SHOP_IMAGE_WEBP_QUALITY = 88;

export type ShopImageVariant = 'master' | 'thumb';
export type ShopImageSize = 'full' | 'thumb';

export function parseShopImageSize(raw: unknown): ShopImageSize {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'thumb') return 'thumb';
  return 'full';
}
export const MAX_SHOP_NAME = 80;
export const MAX_SHOP_DESCRIPTION = 500;

export type ShopImageKind = { ext: 'jpg' | 'png' | 'webp'; mime: string };

export function parseShopName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > MAX_SHOP_NAME) return null;
  return name;
}

export function parseShopDescription(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_SHOP_DESCRIPTION);
}

export function parseShopPriceDollars(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!Number.isInteger(cents) || cents < MIN_SHOP_PRICE_CENTS || cents > MAX_SHOP_PRICE_CENTS) return null;
  return cents;
}

export function parseShopItemId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!/^[a-z0-9_-]{10,40}$/i.test(id)) return null;
  return id;
}

export const MAX_CART_ITEMS = 20;

export function parseShopItemIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > MAX_CART_ITEMS) return null;
  const ids: string[] = [];
  for (const entry of raw) {
    const id = parseShopItemId(entry);
    if (!id || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
}

export function parseMetadataIdList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map((part) => part.trim()).filter((id) => parseShopItemId(id)).slice(0, MAX_CART_ITEMS) as string[];
}

export function parseMetadataAmountList(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map((part) => {
    const value = Number(part.trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  }).filter((value): value is number => value != null);
}

export function detectShopImage(buffer: Buffer): ShopImageKind | null {
  if (!buffer?.length || buffer.length > MAX_SHOP_IMAGE_BYTES) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export function shopUploadRoot(): string {
  return process.env.MOD_UPLOAD_DIR || '/var/lib/mastermind/uploads';
}

export function shopImagePath(orgId: string, itemId: string, ext: string, variant: ShopImageVariant = 'master'): string {
  if (!/^[a-z0-9_-]{10,40}$/i.test(orgId) || !/^[a-z0-9_-]{10,40}$/i.test(itemId)) {
    throw new Error('invalid shop image path');
  }
  if (!/^(jpg|png|webp)$/.test(ext)) throw new Error('invalid shop image extension');
  const file = variant === 'thumb' ? `${itemId}.thumb.${ext}` : `${itemId}.${ext}`;
  return join(shopUploadRoot(), 'shop', orgId, file);
}

export function parseActiveFlag(raw: unknown, fallback = true): boolean {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw === 'true' || raw === '1' || raw === 'on';
  return fallback;
}
