-- #671 step 0: dry-run of the promotion predicate against a database.
-- READ ONLY. Prints figures, counts and ids; no patient name is selected.
-- Committed so the production measurement is re-derivable and so a test can
-- run the `classified` CTE against a fixture.
--
-- Measurements: (A) per-budget classification, (B) matched/left x derived
-- status rollup, (C) independent totals straight from "budgets" (matched +
-- left must sum to draft_live), (D) reserved advance held against the matched
-- budgets, with (D2) the whole-database reserved count as a known-positive
-- control. COMPLETED in a matched row must be 0.
--
-- The classification is a CTE repeated per statement: SET TRANSACTION READ ONLY
-- forbids CREATE TEMP VIEW. The repetition is deliberate.

\pset pager off
\timing off
BEGIN;
SET TRANSACTION READ ONLY;

\echo '####  (C) INDEPENDENT TOTALS: taken from the table, never from the CTE  ####'
SELECT count(*) FILTER (WHERE "status" = 'DRAFT' AND "isActive" = true)  AS draft_live,
       count(*) FILTER (WHERE "status" = 'DRAFT' AND "isActive" = false) AS draft_inactive_excluded,
       count(*) FILTER (WHERE "status" = 'DRAFT')                        AS draft_all,
       count(*)                                                          AS budgets_all
FROM "budgets";

\echo
\echo '####  (B) BUCKETS: matched/left x derived status after promotion  ####'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b
  WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" = 'EXECUTED')                     AS executed_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items,
         coalesce(sum(i."totalPrice") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED')), 0)
                                                                                  AS projection_delta
  FROM live_drafts d
  LEFT JOIN "budget_items" i ON i."budgetId" = d."id"
  GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         (c.open_items > 0) AS matched,
         -- deriveBudgetStatus with currentStatus = 'APPROVED' (post-promotion).
         -- The DRAFT short-circuit is deliberately NOT applied here.
         CASE
           WHEN c.active_items = 0                 THEN 'APPROVED'
           WHEN c.executed_items = 0               THEN 'APPROVED'
           WHEN c.executed_items = c.active_items  THEN 'COMPLETED'
           ELSE 'PARTIAL'
         END AS derived_after_promotion,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
)
SELECT bucket,
       derived_after_promotion,
       count(*)                        AS budgets,
       round(sum(projection_delta), 2) AS projection_delta,
       sum(all_items)                  AS items_total,
       sum(active_items)               AS items_active,
       sum(executed_items)             AS items_executed
FROM classified
GROUP BY 1, 2
ORDER BY 1, 2;

\echo
\echo '####  (B2) CONTROL: same CTE summed ungrouped; budgets_total must equal draft_live in (C)  ####'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b
  WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" = 'EXECUTED')                     AS executed_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items,
         coalesce(sum(i."totalPrice") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED')), 0)
                                                                                  AS projection_delta
  FROM live_drafts d
  LEFT JOIN "budget_items" i ON i."budgetId" = d."id"
  GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         (c.open_items > 0) AS matched,
         -- deriveBudgetStatus with currentStatus = 'APPROVED' (post-promotion).
         -- The DRAFT short-circuit is deliberately NOT applied here.
         CASE
           WHEN c.active_items = 0                 THEN 'APPROVED'
           WHEN c.executed_items = 0               THEN 'APPROVED'
           WHEN c.executed_items = c.active_items  THEN 'COMPLETED'
           ELSE 'PARTIAL'
         END AS derived_after_promotion,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
)
SELECT count(*)                                                                AS budgets_total,
       count(*) FILTER (WHERE matched)                                         AS matched_total,
       count(*) FILTER (WHERE NOT matched)                                     AS left_total,
       round(sum(projection_delta) FILTER (WHERE matched), 2)                  AS projection_delta_matched
FROM classified;

\echo
\echo '####  (D) RESERVED ADVANCE held against the MATCHED budgets  ####'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b
  WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" = 'EXECUTED')                     AS executed_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items,
         coalesce(sum(i."totalPrice") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED')), 0)
                                                                                  AS projection_delta
  FROM live_drafts d
  LEFT JOIN "budget_items" i ON i."budgetId" = d."id"
  GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         (c.open_items > 0) AS matched,
         -- deriveBudgetStatus with currentStatus = 'APPROVED' (post-promotion).
         -- The DRAFT short-circuit is deliberately NOT applied here.
         CASE
           WHEN c.active_items = 0                 THEN 'APPROVED'
           WHEN c.executed_items = 0               THEN 'APPROVED'
           WHEN c.executed_items = c.active_items  THEN 'COMPLETED'
           ELSE 'PARTIAL'
         END AS derived_after_promotion,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
)
SELECT count(p."id")                              AS reserved_payments_in_matched,
       coalesce(round(sum(p."amount"), 2), 0)     AS reserved_amount_in_matched,
       count(DISTINCT p."budgetId")               AS budgets_with_reservation
FROM classified m
LEFT JOIN "patient_payments" p
       ON p."budgetId" = m.budget_id AND p."isActive" = true
WHERE m.matched;

\echo
\echo '####  (D2) CONTROL / KNOWN POSITIVE: reservations in the WHOLE database; 0 means (D) measured nothing  ####'
SELECT count(*)                             AS reserved_payments_total,
       round(coalesce(sum("amount"),0), 2)  AS reserved_amount_total,
       count(DISTINCT "budgetId")           AS budgets_with_reservation_total
FROM "patient_payments"
WHERE "isActive" = true AND "budgetId" IS NOT NULL;

\echo
\echo '####  (A) PER-BUDGET DETAIL: ids and figures, to re-derive by hand  ####'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b
  WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" = 'EXECUTED')                     AS executed_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items,
         coalesce(sum(i."totalPrice") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED')), 0)
                                                                                  AS projection_delta
  FROM live_drafts d
  LEFT JOIN "budget_items" i ON i."budgetId" = d."id"
  GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         (c.open_items > 0) AS matched,
         -- deriveBudgetStatus with currentStatus = 'APPROVED' (post-promotion).
         -- The DRAFT short-circuit is deliberately NOT applied here.
         CASE
           WHEN c.active_items = 0                 THEN 'APPROVED'
           WHEN c.executed_items = 0               THEN 'APPROVED'
           WHEN c.executed_items = c.active_items  THEN 'COMPLETED'
           ELSE 'PARTIAL'
         END AS derived_after_promotion,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
)
SELECT budget_id, bucket, derived_after_promotion,
       all_items, active_items, executed_items, open_items,
       round(projection_delta, 2) AS projection_delta
FROM classified
ORDER BY bucket, projection_delta DESC, budget_id;

ROLLBACK;
