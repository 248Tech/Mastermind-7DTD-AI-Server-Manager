-- Persist last known world position, logout time, and inventory snapshot for player profiles.
ALTER TABLE "Player" ADD COLUMN "last_pos_x" DOUBLE PRECISION;
ALTER TABLE "Player" ADD COLUMN "last_pos_y" DOUBLE PRECISION;
ALTER TABLE "Player" ADD COLUMN "last_pos_z" DOUBLE PRECISION;
ALTER TABLE "Player" ADD COLUMN "last_logout_at" TIMESTAMP(3);
ALTER TABLE "Player" ADD COLUMN "last_inventory" JSONB;
ALTER TABLE "Player" ADD COLUMN "last_inventory_at" TIMESTAMP(3);
