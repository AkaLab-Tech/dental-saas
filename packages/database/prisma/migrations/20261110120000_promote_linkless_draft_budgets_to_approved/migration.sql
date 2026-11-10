-- #671: promote the live DRAFT budgets that can still be worked, so their items
-- become associable. A DRAFT budget's items can never carry an EXECUTED
-- appointment link, so the clinic could not turn budgeted work into a charge on
-- them; #667 stopped new budgets from being born DRAFT but changed nothing
-- retroactively. This is #602's predicate with the link clause deleted and the
-- open-line clause kept, so it is a strict superset of #602's.
--
-- Each clause, and what it excludes:
--   1. status = 'DRAFT'  excludes every APPROVED / PARTIAL / COMPLETED /
--      CANCELLED budget. It is also what makes this idempotent: a row stops
--      matching once written.
--   2. isActive = true   excludes soft-deleted budgets. A deleted budget is not
--      something the clinic will associate, and it is #639's territory (deleted
--      budgets carrying billed lines); promotion must not disturb it.
--   3. EXISTS (an item that is neither EXECUTED nor CANCELLED)  is the safety
--      clause. deriveBudgetStatus short-circuits on DRAFT, returning
--      currentStatus before it looks at items, so promotion is what arms the
--      derivation. After promotion currentStatus = 'APPROVED' and the full
--      predicate applies: with at least one active item that is not EXECUTED,
--      executedCount < activeItems.length, so the derivation can only return
--      APPROVED or PARTIAL, never COMPLETED. COMPLETED is what releases a held
--      reserved advance; a prior status-only migration armed exactly that and
--      released 7,000 (it moved no money when it ran, the release fired on a
--      later recalculation). This clause excludes three populations: budgets
--      with no items at all, budgets whose every item is CANCELLED, and budgets
--      whose active items are all EXECUTED (the only COMPLETED-deriving one).
--
-- No NOT EXISTS (link) clause on purpose: it buys no safety and loses a
-- legitimate case, an APPROVED budget with a SCHEDULED link reverted to DRAFT
-- (updateBudget refuses -> DRAFT only when the budget has an EXECUTED link).
--
-- Only the status column changes (no updatedAt, no aggregate recalculation, no
-- retention change). The dry-run that measured this against production is
-- packages/database/scripts/promote-linkless-draft-budgets-dryrun.sql.
UPDATE "budgets" b
SET "status" = 'APPROVED'
WHERE b."status" = 'DRAFT'
  AND b."isActive" = true
  AND EXISTS (
    SELECT 1
    FROM "budget_items" i
    WHERE i."budgetId" = b."id"
      AND i."status" NOT IN ('EXECUTED', 'CANCELLED')
  );
