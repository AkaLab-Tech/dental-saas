-- CreateEnum
CREATE TYPE "PatientPaymentKind" AS ENUM ('APPOINTMENT', 'ADVANCE');

-- AlterTable
ALTER TABLE "patient_payments" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "kind" "PatientPaymentKind" NOT NULL DEFAULT 'ADVANCE';

-- CreateIndex
CREATE INDEX "patient_payments_appointmentId_idx" ON "patient_payments"("appointmentId");

-- CreateIndex
CREATE INDEX "patient_payments_patientId_kind_idx" ON "patient_payments"("patientId", "kind");

-- AddForeignKey
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the only marker existing appointment-driven payments carry is the
-- fixed note string written by appointment.service.ts's applyPaidTransition.
UPDATE "patient_payments"
SET "kind" = 'APPOINTMENT'
WHERE "note" = 'Pago en consulta';

-- Best-effort link: attach the appointment when exactly one same-tenant,
-- same-patient, same-calendar-day, paid appointment exists. Ambiguous
-- (2+) or unmatched (0) rows are left with a null appointmentId rather
-- than risk mis-linking.
WITH candidates AS (
  SELECT
    pp."id" AS payment_id,
    a."id" AS appointment_id,
    COUNT(*) OVER (PARTITION BY pp."id") AS candidate_count
  FROM "patient_payments" pp
  JOIN "appointments" a
    ON a."tenantId" = pp."tenantId"
    AND a."patientId" = pp."patientId"
    AND a."isPaid" = true
    AND DATE(a."startTime") = DATE(pp."date")
  WHERE pp."kind" = 'APPOINTMENT'
)
UPDATE "patient_payments" pp
SET "appointmentId" = c.appointment_id
FROM candidates c
WHERE pp."id" = c.payment_id
  AND c.candidate_count = 1;
