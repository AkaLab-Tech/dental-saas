-- CreateEnum
CREATE TYPE "PatientCoverageType" AS ENUM ('PARTICULAR', 'CONVENIO');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "convenioName" VARCHAR(120),
ADD COLUMN     "coverageType" "PatientCoverageType" NOT NULL DEFAULT 'PARTICULAR';
