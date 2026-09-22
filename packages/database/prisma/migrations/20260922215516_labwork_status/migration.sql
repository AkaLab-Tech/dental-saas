-- CreateEnum
CREATE TYPE "LabworkStatus" AS ENUM ('PENDING', 'SENT', 'IN_PROGRESS', 'RECEIVED');

-- AlterTable
ALTER TABLE "labworks" ADD COLUMN     "status" "LabworkStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: preserve existing delivery state as the initial lifecycle status.
-- Rows created after this migration already default to PENDING via the column
-- default above; only pre-existing rows need this explicit backfill.
UPDATE "labworks" SET "status" = 'RECEIVED' WHERE "isDelivered" = true;
UPDATE "labworks" SET "status" = 'SENT' WHERE "isDelivered" = false;

-- CreateIndex
CREATE INDEX "labworks_status_idx" ON "labworks"("status");
