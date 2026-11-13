-- #685: the 7 stranded EXECUTED budget items -- the dry-run that must be read
-- and signed off BEFORE a single appointment is restored.
-- READ ONLY. Prints counts, money totals, ids, statuses, dates and booleans;
-- no patient name and no clinic-typed free text is selected.
--
-- Population: #681's "inactive link: uncharged" bucket -- a live DRAFT budget
-- whose item is EXECUTED through a link onto a soft-deleted appointment, so
-- getBillableItems' `appointment: { isActive: true }` clause skips it and the
-- item bills nothing. The CTE chain below (live_drafts -> counted ->
-- classified -> pop -> items -> links) is a verbatim copy of
-- uncharged-executed-links-probe.sql's, so both scripts measure the same set.
-- Changing a predicate here without changing it there silently forks the two
-- populations; if that happens, (C) stops agreeing with (R) and (Rc), and
-- this script's numbers are not #681's numbers.
--
-- Why a dry-run at all: #671's precedent. A migration that only moved statuses
-- armed a derivation that released 7,000 later. Here the recovery
-- (restoreAppointment, apps/api/src/services/appointment.service.ts) moves
-- money on the spot: it writes { isActive: true, status: 'SCHEDULED' }, then
-- restoreAppointmentPaymentsFromAdvance converts the appointment's active
-- ADVANCE payments back to kind = 'APPOINTMENT', then recalculatePaidStatus
-- rewrites the cached isPaid columns of the whole patient.
--
-- Four things this script answers that #681's probe does not, one column each:
--   (1) appointment_id      -- which record the clinic has to restore.
--   (2) appt_cost, appt_is_paid
--                           -- a typed visit cost SUPERSEDES the items (#590):
--                              restoring such an appointment bills the cost and
--                              leaves the item at 0, so Option A does not
--                              recover it. Whether any of the 7 is in that
--                              subset is the open question; it is the product
--                              lead's call, not this script's.
--   (3) convertible_advance -- an ACTIVE patient_payment with kind = 'ADVANCE'
--                              on that appointment: exactly what
--                              restoreAppointmentPaymentsFromAdvance matches,
--                              so money will move at restore time.
--                              legacy_inactive_appt_payment is printed beside
--                              it because a deleted APPOINTMENT-kind payment is
--                              what restore deliberately does NOT revive.
--   (4) doctor_overlaps     -- checkTimeConflict's own predicate: another
--                              ACTIVE appointment of the SAME doctor, status
--                              not in (CANCELLED, NO_SHOW), overlapping
--                              [startTime, endTime). Non-zero means the restore
--                              is refused with TIME_CONFLICT.
-- Plus budget_active, so "the budget is still live" is read off the row rather
-- than inferred. It is true by construction -- live_drafts filters isActive,
-- so a dead budget never reaches (S) -- which makes it a check on the CTE, not
-- a property of the 7: a false there means the population has forked.
--
-- Controls, and what a bad value means:
--   (C)  matched_open_lines must be 0 (#671 shipped; non-zero = this is not the
--        48 any more, distrust everything below). draft_live must be 48.
--   (R)  the bucket rollup must sum to draft_live; exec_links must equal items.
--   (S2) stranded_items must equal the (R) count of 'inactive link: uncharged';
--        the verdict buckets must sum to it.
--   (K)  the credit census must reproduce 89 patients / 523,647.50 (one tenant,
--        2026-11-10). It is NOT typed into this file: the wrapper
--        stranded-executed-restore-dryrun.sh extracts the formula from
--        uncharged-executed-links-probe.sql at run time and refuses to run if
--        the fragment has lost `x.held`, `labworks` or the appointment
--        CANCELLED clause. On 2026-11-13 that formula rewritten from memory
--        returned 92 / 546,847.50 because it omitted held advances and labwork
--        debt -- see #633 (comment, 2026-11-13). Do not retype it here.
--
-- Run (production, by the operator; the chain never touches production):
--   packages/database/scripts/stranded-executed-restore-dryrun.sh \
--     | docker exec -i dental-postgres psql -U <user> -d dental_saas
-- Running this .sql on its own is also valid -- it just drops control (K).
--
-- The CTE is repeated per statement: SET TRANSACTION READ ONLY forbids CREATE
-- TEMP VIEW. The repetition is deliberate. No psql variables: pipe it on stdin.
--
-- Dev validation, database dental_test, 2026-11-13 (docker exec psql, every
-- run inside a rolled-back transaction). dental_test is NOT the production
-- shape, so every figure here is a smoke value, not a finding:
--   baseline (matches #681's own dev run, which is the evidence that the
--   copied CTE still measures #681's population): (C) draft_live 6,
--   draft_inactive 0, budgets_all 153, matched_open_lines 0; (R) 6 links /
--   6 items / 33,000, all 'factura'; (Rc) all_buckets 6, exec_links 6 =
--   items 6, scheduled_links 6, inactive_appts_db 3; (S) 0 rows -- which on
--   its own proves NOTHING, hence the fabricated positives; (K) 24 /
--   175,257.36 over 45 enumerated.
--   fabricated known positive: 5 budgets, one EXECUTED item each, each new
--   column varied on its own axis. Observed:
--     (a) inactive appointment, cost NULL
--           -> 'recoverable: restore + mark done', doctor_overlaps 0
--     (b) inactive, cost 1500
--           -> 'superseded by #590: restore bills the visit cost, item stays
--              at 0'
--     (c) inactive, cost NULL, ACTIVE overlapping appointment of the same
--         doctor -> 'blocked: TIME_CONFLICT', doctor_overlaps 1
--     (d) inactive, cost NULL, ACTIVE ADVANCE payment on the appointment
--           -> 'recoverable', convertible_advance true (a,b,c: false)
--     (e) vacuity row: EXECUTED link on an ACTIVE appointment, cost NULL
--           -> absent from (S); (R)'s 'factura' went 6 -> 7
--   rollups with the fixtures in: (C) draft_live 11, budgets_all 158,
--   matched_open_lines 0; (R) factura 7 + 'inactive link: uncharged' 4 = 11 =
--   draft_live; (S) 4 rows; (S2) TOTAL 4 items / 10,000 = recoverable 2 /
--   5,000 + superseded 1 / 2,000 + blocked 1 / 3,000, with_convertible_advance
--   1, on_dead_budget 0; (K) 24 / 170,757.36 -- moved by exactly -4,500 from
--   the baseline, which is the vacuity row's 5,000 of new billable debt minus
--   (d)'s 500 advance: the four STRANDED items added no debt at all, which is
--   the defect this task repairs.
--   then each assertion was watched failing, one perturbation at a time, and
--   nothing else in the output moved: (a)'s appointment set isActive = true
--   dropped it from (S) (4 rows -> 3); (b)'s cost cleared moved it to
--   'recoverable'; (c)'s overlapping appointment deleted moved it to
--   'recoverable' with doctor_overlaps 0; (d)'s payment deactivated flipped
--   convertible_advance to false; (d)'s payment set to kind = 'APPOINTMENT'
--   and inactive flipped legacy_inactive_appt_payment to true and
--   convertible_advance to false; (d)'s BUDGET deactivated removed the row
--   from the population entirely -- which is why on_dead_budget is a
--   structural 0 and not a measurement (see (S2)).
--   (K) on dev reports its own small census, never 89 / 523,647.50 -- that
--   figure exists only in production, so reproducing it is the operator's run.

\set ON_ERROR_STOP on
\pset pager off
\timing off
BEGIN;
SET TRANSACTION READ ONLY;

\echo '####  (C) INDEPENDENT TOTALS, straight from the table, never from the CTE  ####'
\echo 'controls: draft_live must be 48; matched_open_lines must be 0 (#671 shipped: non-zero = not the 48 any more, distrust everything below)'
SELECT count(*) FILTER (WHERE "status" = 'DRAFT' AND "isActive" = true)  AS draft_live,
       count(*) FILTER (WHERE "status" = 'DRAFT' AND "isActive" = false) AS draft_inactive,
       count(*) FILTER (WHERE "status" = 'DRAFT')                        AS draft_all,
       count(*)                                                          AS budgets_all,
       (SELECT count(DISTINCT i."budgetId") FROM "budget_items" i JOIN "budgets" b ON b."id" = i."budgetId"
         WHERE b."status" = 'DRAFT' AND b."isActive" = true
           AND i."status" NOT IN ('EXECUTED','CANCELLED'))               AS matched_open_lines
FROM "budgets";

\echo
\echo '####  (R) #681 ROLLUP, reproduced so this run is anchored to #681 s numbers  ####'
\echo 'expected 22 factura / 19 tapado por #590 / 7 inactive link; the inactive-link count is the population of (S)'
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
SELECT coalesce(r.bucket, '** TOTAL **') AS bucket,
       count(*) AS links, count(DISTINCT r.item_id) AS items, round(sum(r."totalPrice"), 2) AS total_price
FROM (
  SELECT it.item_id, it."totalPrice", coalesce(x.bucket, 'no EXECUTED link') AS bucket
  FROM items it LEFT JOIN links x ON x.item_id = it.item_id AND x.bucket IS NOT NULL
) r
GROUP BY GROUPING SETS ((r.bucket), ())
ORDER BY 1;

\echo
\echo '####  (Rc) CONTROLS for (R)  ####'
\echo 'all_buckets must equal draft_live in (C); exec_links must equal items (more = BUDGET_ITEM_ONCE_PER_ITEM broken by the join);'
\echo 'scheduled_links must be 41, which is 48 - 7: none of the seven stranded items retains its SCHEDULED link (#681). 0 = the role join is wrong, not that links are missing;'
\echo 'inactive_appts_db 0 = there is nothing to strand'
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
       (SELECT count(*) FROM "appointments" WHERE NOT "isActive")         AS inactive_appts_db;

\echo
\echo '####  (S) THE STRANDED ITEMS, one row per item, with the four recovery columns  ####'
\echo 'verdict order is load-bearing: a time conflict is tested BEFORE the cost, because a refused restore never reaches the #590 question'
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
stranded AS (
  SELECT DISTINCT x.item_id, x.budget_id, x."totalPrice", l."appointmentId" AS appointment_id
  FROM links x
  JOIN "budget_item_appointments" l ON l."budgetItemId" = x.item_id AND l."role" = 'EXECUTED'
  WHERE x.bucket = 'inactive link: uncharged'
),
detail AS (
  SELECT s.budget_id, b."isActive" AS budget_active, s.item_id, round(s."totalPrice", 2) AS total_price,
         s.appointment_id, a."status" AS appt_status, a."cost" AS appt_cost, a."isPaid" AS appt_is_paid,
         a."startTime" AS appt_start,
         EXISTS (SELECT 1 FROM "patient_payments" p
                  WHERE p."appointmentId" = a."id" AND p."kind" = 'ADVANCE' AND p."isActive")
                                                                      AS convertible_advance,
         EXISTS (SELECT 1 FROM "patient_payments" p
                  WHERE p."appointmentId" = a."id" AND p."kind" = 'APPOINTMENT' AND NOT p."isActive")
                                                                      AS legacy_inactive_appt_payment,
         (SELECT count(*) FROM "appointments" o
           WHERE o."tenantId" = a."tenantId" AND o."doctorId" = a."doctorId" AND o."id" <> a."id"
             AND o."isActive" AND o."status" NOT IN ('CANCELLED','NO_SHOW')
             AND o."startTime" < a."endTime" AND o."endTime" > a."startTime") AS doctor_overlaps
  FROM stranded s
  JOIN "budgets" b ON b."id" = s.budget_id
  JOIN "appointments" a ON a."id" = s.appointment_id
),
verdicted AS (
  SELECT d.*,
         CASE
           WHEN d.doctor_overlaps > 0                                THEN 'blocked: TIME_CONFLICT'
           WHEN d.appt_cost IS NOT NULL AND d.appt_cost > 0           THEN 'superseded by #590: restore bills the visit cost, item stays at 0'
           ELSE                                                           'recoverable: restore + mark done'
         END AS verdict
  FROM detail d
)
SELECT budget_id, budget_active, item_id, total_price, appointment_id, appt_status, appt_cost,
       appt_is_paid, convertible_advance, legacy_inactive_appt_payment, doctor_overlaps,
       appt_start, verdict
FROM verdicted
ORDER BY verdict, budget_id, item_id;

\echo
\echo '####  (S2) STRANDED ROLLUP by verdict, and the money each bucket is worth  ####'
\echo 'the TOTAL row must equal the inactive-link item count in (R), and the verdict rows must sum to it.'
\echo 'on_dead_budget is 0 BY CONSTRUCTION (live_drafts filters isActive, so a dead budget leaves the population): non-zero means the CTE has forked from #681.'
\echo 'the recoverable row total_price is the money the restores are expected to move into billed debt -- the figure to sign off'
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
stranded AS (
  SELECT DISTINCT x.item_id, x.budget_id, x."totalPrice", l."appointmentId" AS appointment_id
  FROM links x
  JOIN "budget_item_appointments" l ON l."budgetItemId" = x.item_id AND l."role" = 'EXECUTED'
  WHERE x.bucket = 'inactive link: uncharged'
),
detail AS (
  SELECT s.budget_id, b."isActive" AS budget_active, s.item_id, round(s."totalPrice", 2) AS total_price,
         s.appointment_id, a."status" AS appt_status, a."cost" AS appt_cost, a."isPaid" AS appt_is_paid,
         a."startTime" AS appt_start,
         EXISTS (SELECT 1 FROM "patient_payments" p
                  WHERE p."appointmentId" = a."id" AND p."kind" = 'ADVANCE' AND p."isActive")
                                                                      AS convertible_advance,
         EXISTS (SELECT 1 FROM "patient_payments" p
                  WHERE p."appointmentId" = a."id" AND p."kind" = 'APPOINTMENT' AND NOT p."isActive")
                                                                      AS legacy_inactive_appt_payment,
         (SELECT count(*) FROM "appointments" o
           WHERE o."tenantId" = a."tenantId" AND o."doctorId" = a."doctorId" AND o."id" <> a."id"
             AND o."isActive" AND o."status" NOT IN ('CANCELLED','NO_SHOW')
             AND o."startTime" < a."endTime" AND o."endTime" > a."startTime") AS doctor_overlaps
  FROM stranded s
  JOIN "budgets" b ON b."id" = s.budget_id
  JOIN "appointments" a ON a."id" = s.appointment_id
),
verdicted AS (
  SELECT d.*,
         CASE
           WHEN d.doctor_overlaps > 0                                THEN 'blocked: TIME_CONFLICT'
           WHEN d.appt_cost IS NOT NULL AND d.appt_cost > 0           THEN 'superseded by #590: restore bills the visit cost, item stays at 0'
           ELSE                                                           'recoverable: restore + mark done'
         END AS verdict
  FROM detail d
)
SELECT coalesce(verdict, '** TOTAL **')                      AS verdict,
       count(*)                                              AS items,
       count(DISTINCT appointment_id)                        AS appointments,
       count(DISTINCT budget_id)                             AS budgets,
       round(sum(total_price), 2)                            AS total_price,
       count(*) FILTER (WHERE convertible_advance)           AS with_convertible_advance,
       count(*) FILTER (WHERE NOT budget_active)             AS on_dead_budget
FROM verdicted
GROUP BY GROUPING SETS ((verdict), ())
ORDER BY 1;

\echo
\echo '####  (K) KNOWN POSITIVE: the tenant-wide credit census  ####'
\echo 'must reproduce 89 patients / 523647.50 (one tenant, 2026-11-10). Anything else and the formula is mistranslated:'
\echo 'stop, and treat the disagreement itself as the finding. The formula is spliced in at run time from'
\echo 'uncharged-executed-links-probe.sql by stranded-executed-restore-dryrun.sh -- NEVER retyped (#633, 2026-11-13: 92 / 546847.50).'
-- >>> CREDIT_CENSUS_SPLICE_POINT <<<
-- The wrapper replaces this line with the committed formula. Without the
-- wrapper the next statement is skipped and (K) prints nothing; the rest of
-- the script is unaffected.

ROLLBACK;
