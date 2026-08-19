-- Steam-tied supporter donations: ledger rows plus denormalized player totals.
ALTER TABLE "Player" ADD COLUMN "supporter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Player" ADD COLUMN "supporter_since" TIMESTAMP(3);
ALTER TABLE "Player" ADD COLUMN "total_donated_cents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "server_instance_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "steam_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "stripe_checkout_session_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Donation_stripe_checkout_session_id_key" ON "Donation"("stripe_checkout_session_id");
CREATE INDEX "Donation_player_id_created_at_idx" ON "Donation"("player_id", "created_at" DESC);
CREATE INDEX "Donation_org_id_created_at_idx" ON "Donation"("org_id", "created_at" DESC);
CREATE INDEX "Donation_stripe_payment_intent_id_idx" ON "Donation"("stripe_payment_intent_id");

ALTER TABLE "Donation" ADD CONSTRAINT "Donation_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_server_instance_id_fkey" FOREIGN KEY ("server_instance_id") REFERENCES "ServerInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
