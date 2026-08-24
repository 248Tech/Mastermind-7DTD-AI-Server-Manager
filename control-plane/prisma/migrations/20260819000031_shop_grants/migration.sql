-- Shop kit grants: snapshot 7DTD item + optional donor chat color onto purchases.

ALTER TABLE "ShopItem" ADD COLUMN "grant_item_name" TEXT;
ALTER TABLE "ShopItem" ADD COLUMN "grant_quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ShopItem" ADD COLUMN "grant_quality" INTEGER;
ALTER TABLE "ShopItem" ADD COLUMN "chat_color" TEXT;

ALTER TABLE "DonationLine" ADD COLUMN "grant_item_name" TEXT;
ALTER TABLE "DonationLine" ADD COLUMN "grant_quantity" INTEGER;
ALTER TABLE "DonationLine" ADD COLUMN "grant_quality" INTEGER;
ALTER TABLE "DonationLine" ADD COLUMN "chat_color" TEXT;
ALTER TABLE "DonationLine" ADD COLUMN "grant_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "DonationLine" ADD COLUMN "chat_color_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "DonationLine" ADD COLUMN "grant_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DonationLine" ADD COLUMN "grant_queued_at" TIMESTAMP(3);
ALTER TABLE "DonationLine" ADD COLUMN "granted_at" TIMESTAMP(3);
ALTER TABLE "DonationLine" ADD COLUMN "grant_error" TEXT;

CREATE INDEX "DonationLine_grant_status_idx" ON "DonationLine"("grant_status");
CREATE INDEX "DonationLine_chat_color_status_idx" ON "DonationLine"("chat_color_status");
