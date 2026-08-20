-- Donator shop catalog and optional donation line-item link.
CREATE TABLE "ShopItem" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "image_ext" TEXT,
    "image_mime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShopItem_org_id_active_sort_order_idx" ON "ShopItem"("org_id", "active", "sort_order");

ALTER TABLE "ShopItem" ADD CONSTRAINT "ShopItem_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Donation" ADD COLUMN "shop_item_id" TEXT;

CREATE INDEX "Donation_shop_item_id_idx" ON "Donation"("shop_item_id");

ALTER TABLE "Donation" ADD CONSTRAINT "Donation_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "ShopItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
