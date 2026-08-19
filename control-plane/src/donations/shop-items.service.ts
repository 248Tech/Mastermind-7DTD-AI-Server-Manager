import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createReadStream } from 'fs';
import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { PrismaService } from '../prisma.service';
import {
  MAX_SHOP_IMAGE_BYTES,
  MAX_SHOP_ITEMS,
  detectShopImage,
  parseActiveFlag,
  parseShopDescription,
  parseShopName,
  parseShopPriceDollars,
  shopImagePath,
  type ShopImageSize,
} from './donations.shop';
import { parseChatColor, parseGrantItemName, parseGrantQuality, parseGrantQuantity } from './shop-grants';
import { buildShopThumbFromMaster, normalizeShopImage } from './shop-image-process';

export type ShopItemView = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  active: boolean;
  hasImage: boolean;
  sortOrder: number;
  createdAt: string;
  grantItemName: string | null;
  grantQuantity: number;
  grantQuality: number | null;
  chatColor: string | null;
};

@Injectable()
export class ShopItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdmin(orgId: string): Promise<ShopItemView[]> {
    const rows = await this.prisma.shopItem.findMany({
      where: { orgId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toView);
  }

  async listCatalog(orgId: string): Promise<ShopItemView[]> {
    const rows = await this.prisma.shopItem.findMany({
      where: { orgId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toView);
  }

  async getCatalogItem(orgId: string, itemId: string): Promise<ShopItemView> {
    const item = await this.prisma.shopItem.findFirst({
      where: { id: itemId, orgId, active: true },
    });
    if (!item) throw new NotFoundException('Shop item not found');
    return toView(item);
  }

  async create(
    orgId: string,
    userId: string,
    input: { name?: unknown; description?: unknown; price?: unknown; active?: unknown; grantItemName?: unknown; grantQuantity?: unknown; grantQuality?: unknown; chatColor?: unknown },
    file?: { buffer?: Buffer },
  ) {
    const count = await this.prisma.shopItem.count({ where: { orgId } });
    if (count >= MAX_SHOP_ITEMS) throw new ConflictException('Shop is limited to 50 items');
    const name = parseShopName(input.name);
    const priceCents = parseShopPriceDollars(input.price);
    if (!name) throw new ConflictException('Enter a name up to 80 characters');
    if (priceCents == null) throw new ConflictException('Enter a price between $1.00 and $500.00');
    const grants = parseShopGrantFields(input);
    const image = await requireProcessedImage(file);
    const item = await this.prisma.shopItem.create({
      data: {
        orgId,
        name,
        description: parseShopDescription(input.description),
        priceCents,
        active: parseActiveFlag(input.active, true),
        imageExt: image.ext,
        imageMime: image.mime,
        sortOrder: count,
        ...grants,
      },
    });
    await this.writeImage(orgId, item.id, image);
    await this.audit(orgId, userId, 'shop_item_created', item.id, { name, priceCents });
    return toView(item);
  }

  async update(
    orgId: string,
    userId: string,
    itemId: string,
    input: { name?: unknown; description?: unknown; price?: unknown; active?: unknown; grantItemName?: unknown; grantQuantity?: unknown; grantQuality?: unknown; chatColor?: unknown },
    file?: { buffer?: Buffer },
  ) {
    const existing = await this.prisma.shopItem.findFirst({ where: { id: itemId, orgId } });
    if (!existing) throw new NotFoundException('Shop item not found');
    const name = input.name == null || input.name === '' ? existing.name : parseShopName(input.name);
    const priceCents = input.price == null || input.price === '' ? existing.priceCents : parseShopPriceDollars(input.price);
    if (!name) throw new ConflictException('Enter a name up to 80 characters');
    if (priceCents == null) throw new ConflictException('Enter a price between $1.00 and $500.00');
    const grants = parseShopGrantFields(input, existing);
    const image = file?.buffer?.length ? await requireProcessedImage(file) : null;
    const item = await this.prisma.shopItem.update({
      where: { id: existing.id },
      data: {
        name,
        description: input.description == null ? existing.description : parseShopDescription(input.description),
        priceCents,
        active: parseActiveFlag(input.active, existing.active),
        ...grants,
        ...(image ? { imageExt: image.ext, imageMime: image.mime } : {}),
      },
    });
    if (image) {
      if (existing.imageExt) {
        await unlink(shopImagePath(orgId, item.id, existing.imageExt, 'master')).catch(() => undefined);
        await unlink(shopImagePath(orgId, item.id, existing.imageExt, 'thumb')).catch(() => undefined);
      }
      await this.writeImage(orgId, item.id, image);
    }
    await this.audit(orgId, userId, 'shop_item_updated', item.id, { name, priceCents, imageReplaced: Boolean(image) });
    return toView(item);
  }

  async remove(orgId: string, userId: string, itemId: string) {
    const existing = await this.prisma.shopItem.findFirst({ where: { id: itemId, orgId } });
    if (!existing) throw new NotFoundException('Shop item not found');
    await this.prisma.shopItem.delete({ where: { id: existing.id } });
    if (existing.imageExt) {
      await unlink(shopImagePath(orgId, existing.id, existing.imageExt, 'master')).catch(() => undefined);
      await unlink(shopImagePath(orgId, existing.id, existing.imageExt, 'thumb')).catch(() => undefined);
    }
    await this.audit(orgId, userId, 'shop_item_deleted', existing.id, { name: existing.name });
    return { ok: true };
  }

  async image(orgId: string, itemId: string, activeOnly = false, size: ShopImageSize = 'full') {
    const item = await this.prisma.shopItem.findFirst({
      where: { id: itemId, orgId, ...(activeOnly ? { active: true } : {}) },
      select: { imageExt: true, imageMime: true },
    });
    if (!item?.imageExt || !item.imageMime) throw new NotFoundException('Image not found');
    const variant = size === 'thumb' ? 'thumb' : 'master';
    const path = await this.resolveImagePath(orgId, itemId, item.imageExt, variant);
    return {
      mime: item.imageMime,
      stream: createReadStream(path),
    };
  }

  async reprocessAllImages(): Promise<{ processed: number; skipped: number; failed: number }> {
    const rows = await this.prisma.shopItem.findMany({
      where: { imageExt: { not: null } },
      select: { id: true, orgId: true, imageExt: true },
    });
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      if (!row.imageExt) {
        skipped += 1;
        continue;
      }
      try {
        const masterPath = shopImagePath(row.orgId, row.id, row.imageExt, 'master');
        const buffer = await readFile(masterPath);
        const normalized = await normalizeShopImage(buffer);
        if (row.imageExt === normalized.ext) {
          await this.writeImage(row.orgId, row.id, normalized);
          processed += 1;
          continue;
        }
        await this.writeImage(row.orgId, row.id, normalized);
        await unlink(masterPath).catch(() => undefined);
        await unlink(shopImagePath(row.orgId, row.id, row.imageExt, 'thumb')).catch(() => undefined);
        await this.prisma.shopItem.update({
          where: { id: row.id },
          data: { imageExt: normalized.ext, imageMime: normalized.mime },
        });
        processed += 1;
      } catch {
        failed += 1;
      }
    }
    return { processed, skipped, failed };
  }

  private async resolveImagePath(orgId: string, itemId: string, ext: string, variant: 'master' | 'thumb') {
    const path = shopImagePath(orgId, itemId, ext, variant);
    if (variant === 'thumb') {
      try {
        await access(path);
        return path;
      } catch {
        const masterPath = shopImagePath(orgId, itemId, ext, 'master');
        const master = await readFile(masterPath);
        const thumb = await buildShopThumbFromMaster(master);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, thumb, { mode: 0o600 });
        return path;
      }
    }
    return path;
  }

  private async writeImage(orgId: string, itemId: string, image: { master: Buffer; thumb: Buffer }) {
    const masterPath = shopImagePath(orgId, itemId, 'webp', 'master');
    const thumbPath = shopImagePath(orgId, itemId, 'webp', 'thumb');
    await mkdir(dirname(masterPath), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(masterPath, image.master, { mode: 0o600 }),
      writeFile(thumbPath, image.thumb, { mode: 0o600 }),
    ]);
  }

  private async audit(orgId: string, userId: string, action: string, resourceId: string, details: Prisma.InputJsonObject) {
    await this.prisma.auditLog.create({
      data: { orgId, actorId: userId, action, resourceType: 'shop_item', resourceId, details },
    });
  }
}

async function requireProcessedImage(file?: { buffer?: Buffer }) {
  if (!file?.buffer?.length) throw new ConflictException('Upload a JPEG, PNG, or WebP picture');
  if (file.buffer.length > MAX_SHOP_IMAGE_BYTES) throw new ConflictException('Pictures must be 2 MB or smaller');
  const image = detectShopImage(file.buffer);
  if (!image) throw new ConflictException('Upload a JPEG, PNG, or WebP picture');
  return normalizeShopImage(file.buffer);
}

function parseShopGrantFields(
  input: { grantItemName?: unknown; grantQuantity?: unknown; grantQuality?: unknown; chatColor?: unknown },
  existing?: { grantItemName: string | null; grantQuantity: number; grantQuality: number | null; chatColor: string | null },
) {
  const grantItemName = input.grantItemName == null
    ? existing?.grantItemName ?? null
    : String(input.grantItemName).trim()
      ? parseGrantItemName(input.grantItemName)
      : null;
  if (input.grantItemName != null && String(input.grantItemName).trim() && !grantItemName) {
    throw new ConflictException('Grant item must be a 7DTD item name such as resourceWood');
  }
  const grantQuantity = input.grantQuantity == null || input.grantQuantity === ''
    ? existing?.grantQuantity ?? 1
    : parseGrantQuantity(input.grantQuantity, 1);
  if (grantQuantity == null) throw new ConflictException('Grant quantity must be between 1 and 9999');
  const grantQuality = input.grantQuality == null
    ? existing?.grantQuality ?? null
    : parseGrantQuality(input.grantQuality);
  if (grantQuality === false) throw new ConflictException('Grant quality must be 1–6 or blank');
  const chatColor = input.chatColor == null
    ? existing?.chatColor ?? null
    : String(input.chatColor).trim()
      ? parseChatColor(input.chatColor)
      : null;
  if (chatColor === false) throw new ConflictException('Chat color must be 6 hex characters such as FF00FF');
  return { grantItemName, grantQuantity, grantQuality, chatColor };
}

function toView(item: {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  active: boolean;
  imageExt: string | null;
  sortOrder: number;
  createdAt: Date;
  grantItemName?: string | null;
  grantQuantity?: number;
  grantQuality?: number | null;
  chatColor?: string | null;
}): ShopItemView {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    priceCents: item.priceCents,
    active: item.active,
    hasImage: Boolean(item.imageExt),
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    grantItemName: item.grantItemName ?? null,
    grantQuantity: item.grantQuantity ?? 1,
    grantQuality: item.grantQuality ?? null,
    chatColor: item.chatColor ?? null,
  };
}
