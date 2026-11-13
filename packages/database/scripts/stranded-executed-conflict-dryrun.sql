-- #685 part 2: the 6 conflict-blocked stranded EXECUTED items (77,000) -- the
-- dry-run that must be read and signed off BEFORE a single appointment is
-- soft-deleted or restored.
-- READ ONLY. Prints counts, money totals, ids, statuses, dates and booleans;
-- no patient name and no clinic-typed free text is selected (only whether the
-- text is empty).
--
-- Part 1 (merged as e314b21) measured the 7 stranded items and classified them:
-- 1 recoverable by the merged runbook, 6 'blocked: TIME_CONFLICT' across 5
-- appointments. This script measures what part 1 left open, so the route of
-- part 2 (soft-delete the empty re-creation -> restore the original -> clear
-- the typed Costo -> mark done) can be signed off per record:
--   (N1) is the blocking appointment really EMPTY, so that soft-deleting it
--        loses nothing;
--   (N2) is it really a RE-CREATION of the same visit (same patient, same
--        doctor, same start minute) rather than an unrelated visit;
--   (N3) what the money looks like per record -- item price against the typed
--        appointment cost, so the product lead can decide per record whether
--        clearing that cost is a correction or a write-off;
--   (N4) whether a SECOND overlapper remains once the identified replacement
--        is excluded, i.e. whether step 1 actually unblocks the restore;
--   (N5) how WIDE the delete -> re-create pattern is tenant-wide, which is the
--        scope figure for the prevention issue (#685 half 2) and NOT a reason
--        to widen this part.
--
-- The CTE chain (live_drafts -> counted -> classified -> pop -> items -> links
-- -> stranded) is a verbatim copy of the one in
-- stranded-executed-restore-dryrun.sql, which copied it from
-- uncharged-executed-links-probe.sql. All three scripts therefore measure the
-- same set; changing a predicate in one without the others silently forks the
-- populations, and (C)/(R)/(Rc) stop agreeing.
--
-- The CTE is repeated per statement: SET TRANSACTION READ ONLY forbids CREATE
-- TEMP VIEW. The repetition is deliberate. No psql variables: pipe it on stdin.
--
-- Run (production, by the operator; the chain never touches production):
--   packages/database/scripts/stranded-executed-conflict-dryrun.sh \
--     | docker exec -i dental-postgres psql -U <user> -d dental_saas
-- Running this .sql on its own is also valid -- it just drops the two spliced
-- sections (K) and (N3h), which are the ones that need the committed
-- credit-census formula.
--
-- Controls carried forward from part 1, and what a bad value means:
--   (C)  draft_live must be 48; matched_open_lines must be 0 (#671 shipped;
--        non-zero = this is not the 48 any more, distrust everything below).
--   (R)  the bucket rollup must be 22 factura / 19 tapado por #590 / 7
--        inactive link, and must sum to draft_live.
--   (Rc) all_buckets must equal draft_live; exec_links must equal items;
--        scheduled_links must be 41.
--   (K)  the credit census must reproduce 89 patients / 523,647.50 (one tenant,
--        2026-11-10). It is NOT typed into this file: the wrapper
--        stranded-executed-conflict-dryrun.sh extracts the formula from
--        uncharged-executed-links-probe.sql at run time and refuses to run if
--        the fragment has lost `x.held`, `labworks` or the appointment
--        CANCELLED clause. On 2026-11-13 that formula rewritten from memory
--        returned 92 / 546,847.50 because it omitted held advances and labwork
--        debt -- see #633 (comment, 2026-11-13). Do not retype it here.
--
-- A note on `updatedAt` as the delete timestamp: there is no deletedAt column
-- (prisma/schema.prisma), and the soft delete is the write that sets
-- isActive = false, so the original's `updatedAt` is the best available proxy
-- for when it was deleted. Any later write to the original moves it, so
-- minutes_created_after_original_update is a proxy and is printed as such: the
-- identity axes (same patient / same doctor / same start minute) are the
-- load-bearing ones, the interval is corroboration.
--
-- ============================================================================
-- EXPECTATIONS, to be posted to #685 BEFORE anything is applied
-- ----------------------------------------------------------------------------
-- The postable text lives beside this script, ready to paste verbatim:
--   packages/database/scripts/stranded-executed-conflict-expectations-685.md
-- In short, so that a reader of this file alone can check the run:
--   * rows: 7 stranded items (6 blocked + 1 recoverable) -- (R)'s inactive-link
--     count and (N3)'s row count must both be 7.
--   * end-state money moving into billed debt: 86,500 (77,000 from this part's
--     6 items + 9,500 from the item part 1 already covers), MINUS the price of
--     any record the product lead decides to leave with its typed cost.
--   * intermediate figure, between step 2 (restore) and step 3 (clear Costo):
--     the restored visits bill their typed costs, up to 28,800 across the five
--     records that carry one (15,000 / 5,000 / 5,000 / 2,300 / 1,500), while
--     the items still read 0. That window is expected and is NOT a regression;
--     the 86,500 is the END STATE.
--   * falsifiers: see the .md -- one per section, each of which stops the apply
--     rather than being worked around.
-- ============================================================================
--
-- Dev validation, database dental_test, 2026-11-13 (docker exec psql, every run
-- inside a rolled-back transaction, fixtures inserted in the same transaction).
-- dental_test is NOT the production shape, so every figure here is a smoke
-- value, not a finding.
--   baseline, no fixtures (matches part 1's own dev run, which is the evidence
--   that the copied CTE still measures #681's population): (C) draft_live 6,
--   budgets_all 153, matched_open_lines 0; (R) 6 links / 6 items / 33,000, all
--   'factura'; (Rc) all_buckets 6, exec_links 6 = items 6, scheduled_links 6,
--   inactive_appts_db 3; (N1)-(N4) 0 rows and (N5) 0 pairs -- which on their own
--   prove NOTHING, hence the fabricated positives; (K) 24 / 175,257.36 over 45.
--   fabricated known positives: 12 live DRAFT budgets, one EXECUTED item each
--   (11 stranded on a soft-deleted original + 1 vacuity row whose link sits on
--   an ACTIVE appointment), 10 blockers, and one delete -> re-create pair with
--   no link at all. Every new column was varied on its own axis. With them in:
--     (C) draft_live 18, budgets_all 166, matched_open_lines 0
--     (R) factura 7 / 35,000 + 'inactive link: uncharged' 11 / 15,650 = 18 items
--     (Rc) all_buckets 18 = draft_live, exec_links 18 = items 18,
--          scheduled_links 6, inactive_appts_db 15
--     (N1) 10 pair rows, one verdict per axis: empty (plain blocker) / carries
--          payments (active kind=APPOINTMENT; and, varied separately, an
--          INACTIVE payment -- the clause is deliberately inclusive) / carries
--          labwork / carries budget-item links / carries clinic-written notes
--          (notes and privateNotes varied separately) / carries a typed cost
--     (N2) 8 're-creation of the same visit' + 2 'NOT a re-creation', one for a
--          different patient and one for a 10-minute start offset
--     (N3) 11 rows; (N3t) 11 items / 15,650, with_typed_cost 2 / 2,700,
--          is_paid_records 1
--     (N4) 8 'unblocked by step 1' + 2 'STILL BLOCKED after step 1' + 1 'no
--          conflict today' (that original has no blocker at all)
--     (N5) 9 pairs: 8 'within 5 min' (all 8 with_executed_link and stranding)
--          + 1 'more than 1 day later' (no link)
--     (K) 27 / 177,257.36 over 51 -- moved from the baseline by exactly +2,000
--         of credit and +6 enumerated patients, which is the three fabricated
--         payments plus the vacuity row's 2,000 of real billable debt: the 11
--         STRANDED items added no debt at all, which is the defect this task
--         repairs.
--     (N3h) 11 rows, one per stranded patient, held 1,900 on the one patient
--         given an advance reserved to its own live DRAFT budget.
--   Then each verdict was watched failing, one perturbation at a time, with
--   nothing else in the output moving except what that perturbation implies:
--     blocker deactivated / set CANCELLED / moved out of the overlap
--       -> its pair leaves (N1) and (N2), and (N4) reads 'no conflict today'
--     blocker's typed cost cleared, labwork deleted, link deleted, notes
--       blanked to whitespace, privateNotes nulled, payment DELETED
--       -> each flips that blocker alone to 'empty'
--     blocker's payment merely DEACTIVATED -> pay_active_appointment 1 -> 0 and
--       pay_inactive_any 0 -> 1, verdict still NOT EMPTY (inclusive clause)
--     the different-patient blocker given the original's patient, and the
--       offset blocker aligned to the minute -> both flip (N2) to 're-creation'
--       and (N4) to 'unblocked by step 1'
--     the re-created pair's createdAt moved to +3 min -> (N5) bucket moves from
--       'more than 1 day later' to 'within 5 min', pairs unchanged at 9
--     patient payment changed from exactly the typed cost to cost + 1
--       -> payment_equal_to_appt_cost t -> f
--     the advance earmarked to the original deactivated
--       -> appt_active_advances 1 -> 0 and its total 300 -> 0
--     the original's typed cost cleared -> (N3t) with_typed_cost 2 -> 1
--     VACUITY: the stranded original made ACTIVE -> that item moves to (R)'s
--       'factura' (7 -> 8) and leaves (N1), (N2), (N3) (11 -> 10 items), (N4),
--       (N5) and (N3h) at once. An empty (N1)-(N4) is what a correct script
--       prints on a database with no stranded items, so the sections were only
--       believed after this row proved they can be non-empty and after each
--       verdict was seen to flip.

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
\echo 'expected 22 factura / 19 tapado por #590 / 7 inactive link; the inactive-link count is the population of (N1)-(N4)'
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
\echo '####  (N1) REPLACEMENT EMPTINESS CENSUS, one row per (original, blocker) pair  ####'
\echo 'the verdict is keyed on the three models that can reference an appointment (patient_payments, labworks, budget_item_appointments),'
\echo 'on the appointment own typed cost, and on whether notes/privateNotes carry text. repl_is_paid is PRINTED but not part of the verdict:'
\echo 'it is a derived FIFO cache, so it can be true with no payment of its own.'
\echo 'FALSIFIER: any non-zero count, any non-empty note, or a typed cost means the blocker is NOT empty -- soft-deleting it would lose data,'
\echo 'so that record leaves the batch and goes back to the product lead.'
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
  SELECT it.*, l."role",
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
originals AS (
  SELECT DISTINCT s.appointment_id, a."tenantId", a."patientId", a."doctorId",
         a."startTime", a."endTime", a."updatedAt"
  FROM stranded s JOIN "appointments" a ON a."id" = s.appointment_id
),
blockers AS (
  SELECT o.appointment_id AS original_id, r."id" AS replacement_id,
         (r."patientId" = o."patientId")                                              AS same_patient,
         (r."doctorId"  = o."doctorId")                                               AS same_doctor,
         (date_trunc('minute', r."startTime") = date_trunc('minute', o."startTime"))  AS same_start_minute
  FROM originals o
  JOIN "appointments" r ON r."tenantId" = o."tenantId" AND r."doctorId" = o."doctorId"
       AND r."id" <> o.appointment_id AND r."isActive"
       AND r."status" NOT IN ('CANCELLED','NO_SHOW')
       AND r."startTime" < o."endTime" AND r."endTime" > o."startTime"
),
repl_census AS (
  SELECT b.original_id, b.replacement_id, b.same_patient, b.same_start_minute,
         r."status" AS repl_status, r."type" AS repl_type, r."cost" AS repl_cost,
         r."isPaid" AS repl_is_paid,
         (coalesce(btrim(r."notes"), '') <> '')        AS has_notes,
         (coalesce(btrim(r."privateNotes"), '') <> '') AS has_private_notes,
         (SELECT count(*) FROM "patient_payments" p
           WHERE p."appointmentId" = r."id" AND p."isActive" AND p."kind" = 'APPOINTMENT')
                                                       AS pay_active_appointment,
         (SELECT count(*) FROM "patient_payments" p
           WHERE p."appointmentId" = r."id" AND p."isActive" AND p."kind" = 'ADVANCE')
                                                       AS pay_active_advance,
         (SELECT count(*) FROM "patient_payments" p
           WHERE p."appointmentId" = r."id" AND NOT p."isActive")
                                                       AS pay_inactive_any,
         (SELECT count(*) FROM "labworks" w WHERE w."appointmentId" = r."id")
                                                       AS labworks_any,
         (SELECT count(*) FROM "budget_item_appointments" l
           WHERE l."appointmentId" = r."id" AND l."role" = 'SCHEDULED')
                                                       AS link_scheduled,
         (SELECT count(*) FROM "budget_item_appointments" l
           WHERE l."appointmentId" = r."id" AND l."role" = 'EXECUTED')
                                                       AS link_executed,
         (SELECT count(*) FROM "budget_item_appointments" l
           WHERE l."appointmentId" = r."id" AND l."role" NOT IN ('SCHEDULED','EXECUTED'))
                                                       AS link_other_role
  FROM blockers b JOIN "appointments" r ON r."id" = b.replacement_id
)
SELECT c.*,
       CASE
         WHEN c.pay_active_appointment + c.pay_active_advance + c.pay_inactive_any > 0
                                                  THEN 'NOT EMPTY: carries payments'
         WHEN c.labworks_any > 0                  THEN 'NOT EMPTY: carries labwork'
         WHEN c.link_scheduled + c.link_executed + c.link_other_role > 0
                                                  THEN 'NOT EMPTY: carries budget-item links'
         WHEN c.has_notes OR c.has_private_notes  THEN 'NOT EMPTY: carries clinic-written notes'
         WHEN c.repl_cost IS NOT NULL             THEN 'NOT EMPTY: carries a typed cost'
         ELSE                                          'empty: soft-deleting it loses nothing'
       END AS emptiness_verdict
FROM repl_census c
ORDER BY c.original_id, c.replacement_id;

\echo
\echo '####  (N2) IDENTITY MATCH per (original, blocker) pair  ####'
\echo 'same_doctor is true BY CONSTRUCTION (the blocker join is checkTimeConflict own same-doctor predicate): a false there means the CTE has forked.'
\echo 'minutes_created_after_original_update is a PROXY -- there is no deletedAt column, so the original updatedAt stands for the delete time.'
\echo 'FALSIFIER: a pair that fails same_patient or same_start_minute is NOT a re-creation of the same visit; the "same visit" premise does not'
\echo 'hold for it and it must not be batched.'
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
  SELECT it.*, l."role",
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
originals AS (
  SELECT DISTINCT s.appointment_id, a."tenantId", a."patientId", a."doctorId",
         a."startTime", a."endTime", a."updatedAt"
  FROM stranded s JOIN "appointments" a ON a."id" = s.appointment_id
),
blockers AS (
  SELECT o.appointment_id AS original_id, o."startTime" AS original_start,
         o."updatedAt" AS original_updated,
         r."id" AS replacement_id, r."startTime" AS replacement_start,
         r."createdAt" AS replacement_created,
         (r."patientId" = o."patientId")                                              AS same_patient,
         (r."doctorId"  = o."doctorId")                                               AS same_doctor,
         (date_trunc('minute', r."startTime") = date_trunc('minute', o."startTime"))  AS same_start_minute,
         round(EXTRACT(EPOCH FROM (r."createdAt" - o."updatedAt")) / 60.0, 1)          AS minutes_created_after_original_update
  FROM originals o
  JOIN "appointments" r ON r."tenantId" = o."tenantId" AND r."doctorId" = o."doctorId"
       AND r."id" <> o.appointment_id AND r."isActive"
       AND r."status" NOT IN ('CANCELLED','NO_SHOW')
       AND r."startTime" < o."endTime" AND r."endTime" > o."startTime"
)
SELECT b.*,
       CASE
         WHEN b.same_patient AND b.same_doctor AND b.same_start_minute
           THEN 're-creation of the same visit'
         ELSE 'NOT a re-creation: do not batch this record'
       END AS identity_verdict
FROM blockers b
ORDER BY b.original_id, b.replacement_id;

\echo
\echo '####  (N3) MONEY SIDE BY SIDE, one row per stranded item  ####'
\echo 'delta_if_cost_cleared is what the END STATE moves for that record: the item price minus the typed visit cost that would be cleared.'
\echo 'payment_equal_to_appt_cost is the ENTREGA question of the plan: an active payment of exactly the typed cost suggests the clinic typed a'
\echo 'payment amount into Costo rather than a visit fee. It is a HINT for the product lead, never a decision.'
\echo 'FALSIFIER: cost figures other than 15000 / 5000 / 5000 / 2300 / 1500 (28800 total) mean the population moved since 2026-11-13.'
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
  SELECT it.*, l."role",
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
money AS (
  SELECT s.budget_id, s.item_id, round(s."totalPrice", 2) AS item_price, s.appointment_id,
         a."patientId" AS patient_id, a."cost" AS appt_cost, a."isPaid" AS appt_is_paid,
         a."status" AS appt_status,
         (SELECT count(*) FROM "patient_payments" p
           WHERE p."appointmentId" = a."id" AND p."kind" = 'ADVANCE' AND p."isActive")
                                                                        AS appt_active_advances,
         (SELECT round(coalesce(sum(p."amount"), 0), 2) FROM "patient_payments" p
           WHERE p."appointmentId" = a."id" AND p."kind" = 'ADVANCE' AND p."isActive")
                                                                        AS appt_active_advance_total,
         (SELECT round(coalesce(sum(p."amount"), 0), 2) FROM "patient_payments" p
           WHERE p."patientId" = a."patientId" AND p."isActive")         AS patient_active_payments,
         EXISTS (SELECT 1 FROM "patient_payments" p
                  WHERE p."patientId" = a."patientId" AND p."isActive"
                    AND a."cost" IS NOT NULL AND p."amount" = a."cost") AS payment_equal_to_appt_cost,
         round(s."totalPrice" - coalesce(a."cost", 0), 2)               AS delta_if_cost_cleared
  FROM stranded s JOIN "appointments" a ON a."id" = s.appointment_id
)
SELECT * FROM money ORDER BY appt_cost DESC NULLS LAST, item_id;

\echo
\echo '####  (N3t) MONEY ROLLUP for (N3)  ####'
\echo 'items must be 7; item_price_total must be 86500; appt_cost_total must be 28800 over 5 records with a cost (plan, 2026-11-13).'
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
  SELECT it.*, l."role",
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
)
SELECT count(*)                                                              AS items,
       count(DISTINCT s.appointment_id)                                      AS appointments,
       round(sum(s."totalPrice"), 2)                                         AS item_price_total,
       count(*) FILTER (WHERE a."cost" IS NOT NULL AND a."cost" > 0)         AS with_typed_cost,
       round(coalesce(sum(a."cost") FILTER (WHERE a."cost" > 0), 0), 2)      AS appt_cost_total,
       count(*) FILTER (WHERE a."isPaid")                                    AS is_paid_records
FROM stranded s JOIN "appointments" a ON a."id" = s.appointment_id;

\echo
\echo '####  (N4) POST-EXCLUSION CONFLICT RECHECK, one row per stranded original  ####'
\echo 'blockers_total is checkTimeConflict own count today; identified_replacements are the blockers that pass (N2) identity;'
\echo 'blockers_remaining is what is still in the way AFTER step 1 soft-deletes those.'
\echo 'FALSIFIER: blockers_remaining > 0 means step 1 does NOT unblock that restore and the record is not recoverable by this route.'
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
  SELECT it.*, l."role",
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
originals AS (
  SELECT DISTINCT s.appointment_id, a."tenantId", a."patientId", a."doctorId",
         a."startTime", a."endTime", a."updatedAt"
  FROM stranded s JOIN "appointments" a ON a."id" = s.appointment_id
),
blockers AS (
  SELECT o.appointment_id AS original_id, r."id" AS replacement_id,
         (r."patientId" = o."patientId")                                              AS same_patient,
         (date_trunc('minute', r."startTime") = date_trunc('minute', o."startTime"))  AS same_start_minute
  FROM originals o
  JOIN "appointments" r ON r."tenantId" = o."tenantId" AND r."doctorId" = o."doctorId"
       AND r."id" <> o.appointment_id AND r."isActive"
       AND r."status" NOT IN ('CANCELLED','NO_SHOW')
       AND r."startTime" < o."endTime" AND r."endTime" > o."startTime"
),
recheck AS (
  SELECT o.appointment_id AS original_id,
         (SELECT count(*) FROM blockers b WHERE b.original_id = o.appointment_id)
                                                                       AS blockers_total,
         (SELECT count(*) FROM blockers b
           WHERE b.original_id = o.appointment_id AND b.same_patient AND b.same_start_minute)
                                                                       AS identified_replacements,
         (SELECT count(*) FROM blockers b
           WHERE b.original_id = o.appointment_id
             AND NOT (b.same_patient AND b.same_start_minute))         AS blockers_remaining
  FROM originals o
)
SELECT r.*,
       CASE
         WHEN r.blockers_total = 0            THEN 'no conflict today: restorable as part 1 describes'
         WHEN r.blockers_remaining > 0        THEN 'STILL BLOCKED after step 1: not recoverable by this route'
         WHEN r.identified_replacements = 0   THEN 'blocked by something that is not a re-creation: do not batch'
         ELSE                                      'unblocked by step 1: soft-delete the identified replacement first'
       END AS recheck_verdict
FROM recheck r
ORDER BY r.original_id;

\echo
\echo '####  (N5) PATTERN WIDTH: delete -> re-create pairs, tenant-wide  ####'
\echo 'measured, not assumed: same patient + same doctor + same start minute, one row inactive and one active, bucketed by how long after the'
\echo 'original last write the replacement was created. with_executed_link counts the originals that hold an EXECUTED link at all;'
\echo 'stranding_originals counts those whose link is uncharged (the inactive-link bucket of (R)).'
\echo 'FALSIFIER either way: ~5 pairs means this batch is the whole problem and prevention stays half 2 of #685; materially larger means the'
\echo 'figure goes into the half-2 issue AS ITS SCOPE -- this part is not widened.'
WITH pairs AS (
  SELECT a."tenantId", a."id" AS original_id, r."id" AS replacement_id,
         EXTRACT(EPOCH FROM (r."createdAt" - a."updatedAt")) / 60.0 AS minutes_after,
         EXISTS (SELECT 1 FROM "budget_item_appointments" l
                  WHERE l."appointmentId" = a."id" AND l."role" = 'EXECUTED')  AS has_executed_link,
         EXISTS (SELECT 1 FROM "budget_item_appointments" l
                  JOIN "budget_items" i ON i."id" = l."budgetItemId"
                  JOIN "budgets" b ON b."id" = i."budgetId"
                  WHERE l."appointmentId" = a."id" AND l."role" = 'EXECUTED'
                    AND b."isActive" AND i."status" <> 'CANCELLED'
                    AND i."totalPrice" > 0)                                    AS strands_money
  FROM "appointments" a
  JOIN "appointments" r ON r."tenantId" = a."tenantId" AND r."patientId" = a."patientId"
       AND r."doctorId" = a."doctorId" AND r."id" <> a."id" AND r."isActive"
       AND date_trunc('minute', r."startTime") = date_trunc('minute', a."startTime")
  WHERE NOT a."isActive"
),
bucketed AS (
  SELECT p.*,
         CASE
           WHEN p.minutes_after < 0      THEN 'created BEFORE the original last write'
           WHEN p.minutes_after <= 5     THEN 'within 5 min'
           WHEN p.minutes_after <= 60    THEN 'within 1 h'
           WHEN p.minutes_after <= 1440  THEN 'within 1 day'
           ELSE                               'more than 1 day later'
         END AS window_bucket
  FROM pairs p
)
SELECT coalesce(window_bucket, '** TOTAL **')          AS window_bucket,
       count(*)                                        AS pairs,
       count(DISTINCT original_id)                     AS originals,
       count(DISTINCT "tenantId")                      AS tenants,
       count(*) FILTER (WHERE has_executed_link)       AS with_executed_link,
       count(DISTINCT original_id) FILTER (WHERE strands_money)
                                                       AS stranding_originals
FROM bucketed
GROUP BY GROUPING SETS ((window_bucket), ())
ORDER BY 1;

\echo
\echo '####  (K) KNOWN POSITIVE: the tenant-wide credit census, and (N3h) held per stranded patient  ####'
\echo '(K) must reproduce 89 patients / 523647.50 (one tenant, 2026-11-10). Anything else and the formula is mistranslated:'
\echo 'stop, and treat the disagreement itself as the finding. The formula is spliced in at run time from'
\echo 'uncharged-executed-links-probe.sql by stranded-executed-conflict-dryrun.sh -- NEVER retyped (#633, 2026-11-13: 92 / 546847.50).'
\echo '(N3h) reads held/credit/outstanding off that same formula, for every patient holding an EXECUTED link on an inactive appointment --'
\echo 'a deliberate SUPERSET of (N3) patient_id values, so its row count must be >= the distinct patients of (N3). It answers risk 5 of the'
\echo 'plan: whether a patient held equals that patient uncharged item price, which is a coincidence until measured.'
-- >>> CREDIT_CENSUS_SPLICE_POINT <<<
-- The wrapper replaces this line with the committed formula plus the two
-- statements that need it. Without the wrapper both are skipped and (K)/(N3h)
-- print nothing; the rest of the script is unaffected.

ROLLBACK;
