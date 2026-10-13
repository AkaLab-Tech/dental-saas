-- Task #529: an advance can be reserved to a budget. Strictly additive: one
-- nullable column, no default, no backfill. Every existing row keeps
-- budget_id NULL, i.e. ordinary money in the general pool, so no existing
-- figure changes.
ALTER TABLE "patient_payments" ADD COLUMN "budgetId" TEXT;

CREATE INDEX "patient_payments_budgetId_idx" ON "patient_payments"("budgetId");

ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
