-- #602: a DRAFT budget can no longer be associated to an appointment. Budgets
-- that already carry an EXECUTED or SCHEDULED link were accepted in fact, so
-- they are promoted to APPROVED, but only when at least one item is neither
-- EXECUTED nor CANCELLED: with every active item EXECUTED, the next
-- recalculation would derive COMPLETED and release a held reserved advance,
-- and such a budget has no associable line anyway. Only the status column
-- changes (no updatedAt, no aggregate recalculation, no retention change).
-- Idempotent: re-running matches nothing.
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
  )
  AND EXISTS (
    SELECT 1
    FROM "budget_items" i
    WHERE i."budgetId" = b."id"
      AND i."status" NOT IN ('EXECUTED', 'CANCELLED')
  );
