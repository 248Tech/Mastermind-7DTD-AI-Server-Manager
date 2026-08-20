const { PrismaClient } = require('@prisma/client');
const { mkdir, readFile, unlink, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { shopImagePath } = require('../dist/src/donations/donations.shop');
const { normalizeShopImage } = require('../dist/src/donations/shop-image-process');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.shopItem.findMany({
    where: { imageExt: { not: null } },
    select: { id: true, orgId: true, imageExt: true },
  });
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.imageExt) continue;
    try {
      const masterPath = shopImagePath(row.orgId, row.id, row.imageExt, 'master');
      const buffer = await readFile(masterPath);
      const normalized = await normalizeShopImage(buffer);
      const masterOut = shopImagePath(row.orgId, row.id, normalized.ext, 'master');
      const thumbOut = shopImagePath(row.orgId, row.id, normalized.ext, 'thumb');
      await mkdir(dirname(masterOut), { recursive: true, mode: 0o700 });
      await Promise.all([
        writeFile(masterOut, normalized.master, { mode: 0o600 }),
        writeFile(thumbOut, normalized.thumb, { mode: 0o600 }),
      ]);
      if (row.imageExt !== normalized.ext) {
        await unlink(masterPath).catch(() => undefined);
        await unlink(shopImagePath(row.orgId, row.id, row.imageExt, 'thumb')).catch(() => undefined);
        await prisma.shopItem.update({
          where: { id: row.id },
          data: { imageExt: normalized.ext, imageMime: normalized.mime },
        });
      }
      processed += 1;
      console.log(`ok ${row.id}`);
    } catch (error) {
      failed += 1;
      console.error(`fail ${row.id}`, error instanceof Error ? error.message : error);
    }
  }
  console.log(JSON.stringify({ processed, failed, total: rows.length }));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
