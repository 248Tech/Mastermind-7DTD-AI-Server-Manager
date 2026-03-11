-- Add password_hash column to User table for local auth
ALTER TABLE "User" ADD COLUMN "password_hash" TEXT;
