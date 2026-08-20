import sharp from 'sharp';
import {
  SHOP_IMAGE_MASTER_MAX_PX,
  SHOP_IMAGE_THUMB_MAX_PX,
  SHOP_IMAGE_WEBP_QUALITY,
} from './donations.shop';

export type ProcessedShopImage = {
  master: Buffer;
  thumb: Buffer;
  ext: 'webp';
  mime: 'image/webp';
};

function resizeWebp(buffer: Buffer, maxPx: number): Promise<Buffer> {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: SHOP_IMAGE_WEBP_QUALITY, effort: 4 })
    .toBuffer();
}

export async function normalizeShopImage(buffer: Buffer): Promise<ProcessedShopImage> {
  const [master, thumb] = await Promise.all([
    resizeWebp(buffer, SHOP_IMAGE_MASTER_MAX_PX),
    resizeWebp(buffer, SHOP_IMAGE_THUMB_MAX_PX),
  ]);
  return { master, thumb, ext: 'webp', mime: 'image/webp' };
}

export async function buildShopThumbFromMaster(master: Buffer): Promise<Buffer> {
  return resizeWebp(master, SHOP_IMAGE_THUMB_MAX_PX);
}
