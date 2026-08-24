-- Optional password so a player can buy from the shop using their in-game name
-- without a Steam OpenID session. Profile and live-map players stay Steam-only.

ALTER TABLE "Player" ADD COLUMN "portal_password_hash" TEXT;
CREATE INDEX "Player_server_instance_id_name_idx" ON "Player"("server_instance_id", "name");
