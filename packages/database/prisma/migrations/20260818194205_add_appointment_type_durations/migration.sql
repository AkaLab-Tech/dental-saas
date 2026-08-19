-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "appointmentTypeDurations" JSONB NOT NULL DEFAULT '[]';
