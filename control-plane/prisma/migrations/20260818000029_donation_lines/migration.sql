-- DonationLine tracks individual shop items purchased in a checkout (including multi-item carts).

CREATE TABLE "DonationLine" (
    "id" TEXT NOT NULL,
    "donation_id" TEXT NOT NULL,
    "shop_item_id" TEXT,
    "item_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DonationLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DonationLine_donation_id_idx" ON "DonationLine"("donation_id");
CREATE INDEX "DonationLine_shop_item_id_idx" ON "DonationLine"("shop_item_id");

ALTER TABLE "DonationLine" ADD CONSTRAINT "DonationLine_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "Donation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DonationLine" ADD CONSTRAINT "DonationLine_shop_item_id_fkey" FOREIGN KEY ("shop_item_id") REFERENCES "ShopItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
