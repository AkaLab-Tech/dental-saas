-- #602: a DRAFT budget can no longer be associated to an appointment. Budgets
-- that already carry an EXECUTED or SCHEDULED link were accepted in fact, so
-- they are promoted to APPROVED. Only the status column changes: DRAFT ->
-- APPROVED keeps the budget open, so no retained advance moves, and no
-- aggregate is recalculated. Idempotent: re-running matches nothing.
UPDATE "budgets" b
SET "status" = 'APPROVED'
WHERE b."status" = 'DRAFT'
  AND b."isActive" = true
  AND EXISTS (
    SELECT 1
    FROM "budget_items" i
    JOIN "budget_item_appointments" l ON l."budgetItemId" = i."id"
    WHERE i."budgetId" = b."id"
      AND l."role" IN ('SCHEDULED', 'EXECUTED')
  );
