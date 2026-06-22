-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "createdBy" TEXT;

-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "labworks" ADD COLUMN     "createdBy" TEXT;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "createdBy" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "doctors_userId_key" ON "doctors"("userId");

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
