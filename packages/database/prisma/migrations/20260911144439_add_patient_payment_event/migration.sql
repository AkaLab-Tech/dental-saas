-- CreateEnum
CREATE TYPE "PatientPaymentEventType" AS ENUM ('REVERSED', 'CONVERTED_TO_ADVANCE', 'RESTORED_TO_APPOINTMENT');

-- CreateTable
CREATE TABLE "patient_payment_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" "PatientPaymentEventType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_payment_events_paymentId_idx" ON "patient_payment_events"("paymentId");

-- CreateIndex
CREATE INDEX "patient_payment_events_tenantId_occurredAt_idx" ON "patient_payment_events"("tenantId", "occurredAt");

-- AddForeignKey
ALTER TABLE "patient_payment_events" ADD CONSTRAINT "patient_payment_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_payment_events" ADD CONSTRAINT "patient_payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "patient_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
