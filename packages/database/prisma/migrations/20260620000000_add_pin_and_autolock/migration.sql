-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "autoLockMinutes" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinHash" VARCHAR(255);
