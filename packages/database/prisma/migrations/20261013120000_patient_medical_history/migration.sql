-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "conditions" TEXT,
ADD COLUMN     "currentMedication" TEXT,
ADD COLUMN     "medicalNotes" TEXT,
ADD COLUMN     "previousSurgeries" TEXT;
