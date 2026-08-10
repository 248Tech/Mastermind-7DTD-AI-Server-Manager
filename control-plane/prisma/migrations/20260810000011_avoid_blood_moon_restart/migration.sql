ALTER TABLE "Org"
  ADD COLUMN IF NOT EXISTS "avoid_blood_moon_restart" BOOLEAN NOT NULL DEFAULT false;
