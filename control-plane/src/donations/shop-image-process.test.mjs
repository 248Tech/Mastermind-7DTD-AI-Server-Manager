import sharp from 'sharp';
import { normalizeShopImage } from './shop-image-process.ts';
import { SHOP_IMAGE_MASTER_MAX_PX, SHOP_IMAGE_THUMB_MAX_PX } from './donations.shop.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = await sharp({
  create: { width: 2400, height: 1200, channels: 3, background: { r: 200, g: 80, b: 40 } },
})
  .png()
  .toBuffer();

const processed = await normalizeShopImage(source);
assert(processed.ext === 'webp', 'outputs webp');
assert(processed.master.length > 0 && processed.thumb.length > 0, 'writes buffers');
assert(processed.thumb.length < processed.master.length, 'thumb is smaller than master');

const masterMeta = await sharp(processed.master).metadata();
const thumbMeta = await sharp(processed.thumb).metadata();
assert((masterMeta.width ?? 0) <= SHOP_IMAGE_MASTER_MAX_PX, 'master width capped');
assert((masterMeta.height ?? 0) <= SHOP_IMAGE_MASTER_MAX_PX, 'master height capped');
assert((thumbMeta.width ?? 0) <= SHOP_IMAGE_THUMB_MAX_PX, 'thumb width capped');
assert((thumbMeta.height ?? 0) <= SHOP_IMAGE_THUMB_MAX_PX, 'thumb height capped');

console.log('shop image process tests passed');
