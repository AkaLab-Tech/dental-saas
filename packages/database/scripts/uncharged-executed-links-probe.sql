-- #681: the live DRAFT budgets whose EXECUTED link sits on an appointment that
-- bills nothing -- the only uncharged work among the 48 (#671's leftovers).
-- READ ONLY. Prints counts, money totals, ids, statuses, dates and booleans;
-- no patient name and no clinic-typed free text is selected.
--
-- Why here: it is a psql-run, operator-executed measurement over exactly the
-- population of promote-linkless-draft-budgets-dryrun.sql (#671's live DRAFTs),
-- whose CTE it reuses so both measure the same set (same predicates; the
-- layout is compacted to keep the repeated copies short). The other two homes
-- were rejected: apps/api/src/scripts/repair-cancelled-appointment-payments.sql
-- lives there as the twin of a TypeScript script, and this has no twin; a
-- TypeScript probe such as report-cost-budget-overlap.ts cannot reach
-- production, whose image ships neither tsx nor src/scripts/.
--
-- Questions -> sections: (1) rollup + appointment status of the 7 -> (1);
-- (2) the 7's patients' advances and balance -> (3); (3) overlap with the 89
-- credit-bearing records -> in_credit_census column of (3); (4) full link
-- inventory (role x isActive x status) per item -> (2).
-- Every section is followed by its control and what a bad value would mean.
-- The CTE is repeated per statement: SET TRANSACTION READ ONLY forbids CREATE
-- TEMP VIEW. The repetition is deliberate. No psql variables: pipe it on stdin.
--
-- Run (production, by the operator; the chain never touches it):
--   docker exec -i dental-postgres psql -U <user> -d dental_saas \
--     < packages/database/scripts/uncharged-executed-links-probe.sql
--
-- Dev validation, database dental_test, 2026-11-12 (run end to end through
-- docker exec psql; the transaction rolled back). dental_test is NOT the
-- production shape, so every figure below is a smoke value, not a finding:
--   (C)  draft_live 6, draft_inactive 0, budgets_all 153, matched_open_lines 0.
--   (1)  factura 6 (6 items, all SCHEDULED/active); 'tapado por #590' 0;
--        'inactive link: uncharged' 0 -- a bucket at 0 proves nothing on its
--        own, which is why the next line exists.
--   (1c) all_buckets 6 = draft_live 6; exec_links 6 = items 6; scheduled_links
--        6; inactive_appt_statuses_db 2 (> 1, so the group-by can tell
--        statuses apart); inactive_appts_db 3.
--   (3)  credit census 24 patients / 175257.36 over 45 enumerated -- NOT 89 /
--        523647.50: that figure exists only in production, so the formula's
--        reproduction of it is the operator's run; no target patient on dev.
-- Fabricated known positive (rolled-back transaction, guards 1 and 2 in
-- apps/api/src/services/uncharged-executed-links-probe.test.ts): each of the
-- three buckets moved from 0 to its fixture row, an active CANCELLED
-- appointment fell to 'factura' (not the inactive bucket), the inactive bucket
-- moved by exactly 1, and a 500 advance moved the patient's credit by exactly
-- 500 (the uncharged item adding no debt).

\set ON_ERROR_STOP on
\pset pager off
\timing off
BEGIN;
SET TRANSACTION READ ONLY;

\echo '####  (C) INDEPENDENT TOTALS, straight from the table, never from the CTE  ####'
\echo 'controls: (1) buckets must sum to draft_live; matched_open_lines must be 0 (#671 shipped: non-zero = not the 48 any more, distrust everything below)'
SELECT count(*) FILTER (WHERE "status" = 'DRAFT' AND "isActive" = true)  AS draft_live,
       count(*) FILTER (WHERE "status" = 'DRAFT' AND "isActive" = false) AS draft_inactive,
       count(*) FILTER (WHERE "status" = 'DRAFT')                        AS draft_all,
       count(*)                                                          AS budgets_all,
       (SELECT count(DISTINCT i."budgetId") FROM "budget_items" i JOIN "budgets" b ON b."id" = i."budgetId"
         WHERE b."status" = 'DRAFT' AND b."isActive" = true
           AND i."status" NOT IN ('EXECUTED','CANCELLED'))               AS matched_open_lines
FROM "budgets";

\echo
\echo '####  (1) ROLLUP: bucket x appointment status x appointment isActive, one GROUP BY  ####'
\echo 'expected 22 factura / 19 tapado por #590 / 7 inactive link; the TOTAL row must equal the item count in (1c)'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items
  FROM live_drafts d LEFT JOIN "budget_items" i ON i."budgetId" = d."id" GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
),
pop AS (
  SELECT budget_id FROM classified WHERE bucket = 'left: active items all EXECUTED (would derive COMPLETED)'
),
items AS (
  SELECT i."id" AS item_id, i."budgetId" AS budget_id, i."totalPrice"
  FROM pop JOIN "budget_items" i ON i."budgetId" = pop.budget_id WHERE i."status" <> 'CANCELLED'
),
links AS (
  SELECT it.*, l."role", a."isActive" AS appt_active, a."status" AS appt_status, a."cost" AS appt_cost,
         a."startTime" AS appt_start,
         -- Order is load-bearing: the inactive test comes BEFORE the cost/status clause.
         CASE
           WHEN l."role" IS DISTINCT FROM 'EXECUTED'                                  THEN NULL
           WHEN NOT a."isActive"                                                      THEN 'inactive link: uncharged'
           WHEN a."cost" IS NULL OR a."cost" <= 0 OR a."status" = 'CANCELLED'         THEN 'factura'
           ELSE                                                                            'tapado por #590'
         END AS bucket
  FROM items it
  LEFT JOIN "budget_item_appointments" l ON l."budgetItemId" = it.item_id
  LEFT JOIN "appointments" a ON a."id" = l."appointmentId"
)
SELECT coalesce(r.bucket, '** TOTAL **') AS bucket, r.appt_status, r.appt_active,
       count(*) AS links, count(DISTINCT r.item_id) AS items, round(sum(r."totalPrice"), 2) AS total_price
FROM (
  SELECT it.item_id, it."totalPrice", coalesce(x.bucket, 'no EXECUTED link') AS bucket,
         x.appt_status, x.appt_active
  FROM items it LEFT JOIN links x ON x.item_id = it.item_id AND x.bucket IS NOT NULL
) r
GROUP BY GROUPING SETS ((r.bucket, r.appt_status, r.appt_active), ())
ORDER BY 1, 2, 3;

\echo
\echo '####  (1c) CONTROLS for (1) and (2)  ####'
\echo 'all_buckets must equal draft_live in (C); exec_links must equal items (more = BUDGET_ITEM_ONCE_PER_ITEM broken by the join);'
\echo 'scheduled_links should be 48 (0 = the role join is wrong, not that links are missing);'
\echo 'inactive_appt_statuses_db = 1 means the group-by cannot tell statuses apart and the 2/5 split proves nothing'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items
  FROM live_drafts d LEFT JOIN "budget_items" i ON i."budgetId" = d."id" GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
),
pop AS (
  SELECT budget_id FROM classified WHERE bucket = 'left: active items all EXECUTED (would derive COMPLETED)'
),
items AS (
  SELECT i."id" AS item_id, i."budgetId" AS budget_id, i."totalPrice"
  FROM pop JOIN "budget_items" i ON i."budgetId" = pop.budget_id WHERE i."status" <> 'CANCELLED'
),
links AS (
  SELECT it.*, l."role", a."isActive" AS appt_active, a."status" AS appt_status, a."cost" AS appt_cost,
         a."startTime" AS appt_start,
         -- Order is load-bearing: the inactive test comes BEFORE the cost/status clause.
         CASE
           WHEN l."role" IS DISTINCT FROM 'EXECUTED'                                  THEN NULL
           WHEN NOT a."isActive"                                                      THEN 'inactive link: uncharged'
           WHEN a."cost" IS NULL OR a."cost" <= 0 OR a."status" = 'CANCELLED'         THEN 'factura'
           ELSE                                                                            'tapado por #590'
         END AS bucket
  FROM items it
  LEFT JOIN "budget_item_appointments" l ON l."budgetItemId" = it.item_id
  LEFT JOIN "appointments" a ON a."id" = l."appointmentId"
)
SELECT (SELECT count(*) FROM pop)                                         AS population_budgets,
       (SELECT count(*) FROM classified)                                  AS all_buckets,
       (SELECT count(DISTINCT item_id) FROM links)                        AS items,
       (SELECT count(*) FROM links WHERE "role" = 'EXECUTED')             AS exec_links,
       (SELECT count(*) FROM links WHERE "role" = 'SCHEDULED')            AS scheduled_links,
       (SELECT count(DISTINCT "status") FROM "appointments" WHERE NOT "isActive") AS inactive_appt_statuses_db,
       (SELECT count(*) FROM "appointments" WHERE NOT "isActive")         AS inactive_appts_db;

\echo
\echo '####  (2) PER-ITEM DETAIL: every link of every item, to audit by hand  ####'
\echo 'bucket is set on EXECUTED rows only; a SCHEDULED row beside an EXECUTED one answers "does the SCHEDULED link survive on an active COMPLETED appointment"'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items
  FROM live_drafts d LEFT JOIN "budget_items" i ON i."budgetId" = d."id" GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
),
pop AS (
  SELECT budget_id FROM classified WHERE bucket = 'left: active items all EXECUTED (would derive COMPLETED)'
),
items AS (
  SELECT i."id" AS item_id, i."budgetId" AS budget_id, i."totalPrice"
  FROM pop JOIN "budget_items" i ON i."budgetId" = pop.budget_id WHERE i."status" <> 'CANCELLED'
),
links AS (
  SELECT it.*, l."role", a."isActive" AS appt_active, a."status" AS appt_status, a."cost" AS appt_cost,
         a."startTime" AS appt_start,
         -- Order is load-bearing: the inactive test comes BEFORE the cost/status clause.
         CASE
           WHEN l."role" IS DISTINCT FROM 'EXECUTED'                                  THEN NULL
           WHEN NOT a."isActive"                                                      THEN 'inactive link: uncharged'
           WHEN a."cost" IS NULL OR a."cost" <= 0 OR a."status" = 'CANCELLED'         THEN 'factura'
           ELSE                                                                            'tapado por #590'
         END AS bucket
  FROM items it
  LEFT JOIN "budget_item_appointments" l ON l."budgetItemId" = it.item_id
  LEFT JOIN "appointments" a ON a."id" = l."appointmentId"
)
SELECT budget_id, item_id, bucket, "totalPrice", "role", appt_active, appt_status, appt_cost, appt_start
FROM links
ORDER BY bucket NULLS LAST, budget_id, item_id, "role";

\echo
\echo '####  (3)+(4) MONEY of the 7 patients, and the tenant-wide credit census as its known positive  ####'
\echo 'credit_patients / credit_total must reproduce 89 / 523647.50 (one tenant, 2026-11-10); if not, the credit formula is mistranslated'
\echo 'and the per-patient figures below are not to be trusted -- that disagreement is then the finding. active_payments = 0 means (3) measured nothing.'
WITH live_drafts AS (
  SELECT b."id" FROM "budgets" b WHERE b."status" = 'DRAFT' AND b."isActive" = true
),
counted AS (
  SELECT d."id" AS budget_id,
         count(i."id")                                                           AS all_items,
         count(i."id") FILTER (WHERE i."status" <> 'CANCELLED')                   AS active_items,
         count(i."id") FILTER (WHERE i."status" NOT IN ('EXECUTED','CANCELLED'))  AS open_items
  FROM live_drafts d LEFT JOIN "budget_items" i ON i."budgetId" = d."id" GROUP BY d."id"
),
classified AS (
  SELECT c.*,
         CASE
           WHEN c.open_items > 0   THEN 'matched'
           WHEN c.all_items = 0    THEN 'left: no items at all'
           WHEN c.active_items = 0 THEN 'left: every item CANCELLED'
           ELSE                         'left: active items all EXECUTED (would derive COMPLETED)'
         END AS bucket
  FROM counted c
),
pop AS (
  SELECT budget_id FROM classified WHERE bucket = 'left: active items all EXECUTED (would derive COMPLETED)'
),
items AS (
  SELECT i."id" AS item_id, i."budgetId" AS budget_id, i."totalPrice"
  FROM pop JOIN "budget_items" i ON i."budgetId" = pop.budget_id WHERE i."status" <> 'CANCELLED'
),
links AS (
  SELECT it.*, l."role", a."isActive" AS appt_active, a."status" AS appt_status, a."cost" AS appt_cost,
         a."startTime" AS appt_start,
         -- Order is load-bearing: the inactive test comes BEFORE the cost/status clause.
         CASE
           WHEN l."role" IS DISTINCT FROM 'EXECUTED'                                  THEN NULL
           WHEN NOT a."isActive"                                                      THEN 'inactive link: uncharged'
           WHEN a."cost" IS NULL OR a."cost" <= 0 OR a."status" = 'CANCELLED'         THEN 'factura'
           ELSE                                                                            'tapado por #590'
         END AS bucket
  FROM items it
  LEFT JOIN "budget_item_appointments" l ON l."budgetItemId" = it.item_id
  LEFT JOIN "appointments" a ON a."id" = l."appointmentId"
),
-- getPatientBalance, per ITEM never per link (BUDGET_ITEM_ONCE_PER_ITEM): an item
-- with no EXECUTED link on an active appointment is not charged (BUDGET_ITEM_DATELESS).
item_debt AS (
  SELECT b."patientId" AS pid, b."id" AS budget_id, i."totalPrice"
  FROM "budget_items" i JOIN "budgets" b ON b."id" = i."budgetId" AND b."isActive"
  WHERE i."totalPrice" > 0 AND EXISTS (
    SELECT 1 FROM "budget_item_appointments" l JOIN "appointments" a ON a."id" = l."appointmentId"
    WHERE l."budgetItemId" = i."id" AND l."role" = 'EXECUTED' AND a."isActive"
      AND (a."cost" IS NULL OR a."cost" <= 0 OR a."status" = 'CANCELLED'))
),
charged AS (
  SELECT budget_id, sum("totalPrice") AS charged FROM item_debt GROUP BY budget_id
),
reserved AS (
  SELECT p."patientId" AS pid, p."budgetId" AS budget_id, sum(p."amount") AS reserved
  FROM "patient_payments" p JOIN "budgets" b ON b."id" = p."budgetId"
  WHERE p."isActive" AND b."isActive" AND b."status" NOT IN ('COMPLETED','CANCELLED')
  GROUP BY p."patientId", p."budgetId"
),
held AS (
  SELECT r.pid, sum(r.reserved - least(r.reserved, coalesce(c.charged, 0))) AS held
  FROM reserved r LEFT JOIN charged c ON c.budget_id = r.budget_id GROUP BY r.pid
),
debt AS (
  SELECT pid, sum(v) AS debt FROM (
    SELECT "patientId" AS pid, "cost" AS v FROM "appointments"
      WHERE "isActive" AND "status" <> 'CANCELLED' AND "cost" > 0
    UNION ALL
    SELECT "patientId", "price" FROM "labworks"
      WHERE "isActive" AND "price" > 0 AND NOT "priceIncludedInAppointment" AND "patientId" IS NOT NULL
    UNION ALL
    SELECT pid, "totalPrice" FROM item_debt
  ) d GROUP BY pid
),
paid AS (
  SELECT "patientId" AS pid, sum("amount") AS paid FROM "patient_payments" WHERE "isActive" GROUP BY "patientId"
),
-- Over payments UNION debt: a patient with payments and no debt is a credit holder.
ids AS (
  SELECT pid FROM debt UNION SELECT pid FROM paid
),
fin AS (
  SELECT x.pid, x.debt, x.paid, x.held,
         greatest(0, x.paid - x.held - x.debt) AS credit,
         greatest(0, x.debt - (x.paid - x.held)) AS outstanding
  FROM (
    SELECT ids.pid, coalesce(debt.debt, 0) AS debt, coalesce(paid.paid, 0) AS paid, coalesce(held.held, 0) AS held
    FROM ids LEFT JOIN debt ON debt.pid = ids.pid LEFT JOIN paid ON paid.pid = ids.pid LEFT JOIN held ON held.pid = ids.pid
  ) x
),
census AS (
  SELECT count(*) FILTER (WHERE credit > 0)                                  AS credit_patients,
         round(coalesce(sum(credit) FILTER (WHERE credit > 0), 0), 2)        AS credit_total,
         count(*)                                                            AS patients_enumerated
  FROM fin
),
target AS (
  SELECT b."patientId" AS pid, count(*) AS uncharged_items, sum(u."totalPrice") AS uncharged_total
  FROM (SELECT DISTINCT item_id, budget_id, "totalPrice" FROM links WHERE bucket = 'inactive link: uncharged') u
  JOIN "budgets" b ON b."id" = u.budget_id GROUP BY b."patientId"
)
SELECT census.credit_patients, census.credit_total, census.patients_enumerated,
       t.pid AS patient_id, t.uncharged_items, t.uncharged_total,
       (SELECT count(*) FROM "patient_payments" p WHERE p."patientId" = t.pid AND p."isActive") AS active_payments,
       round(f.debt, 2) AS debt, round(f.paid, 2) AS paid, round(f.held, 2) AS held,
       round(f.outstanding, 2) AS outstanding, round(f.credit, 2) AS credit,
       (f.credit > 0) AS in_credit_census,
       count(*) FILTER (WHERE f.credit > 0) OVER () AS targets_in_credit_census
FROM census LEFT JOIN target t ON true LEFT JOIN fin f ON f.pid = t.pid
ORDER BY t.pid;

ROLLBACK;
