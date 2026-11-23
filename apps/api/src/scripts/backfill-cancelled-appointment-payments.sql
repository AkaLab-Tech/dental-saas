-- Task #715: SQL twin of backfill-cancelled-appointment-payments.ts (#406).
--
-- Why this file exists: the production image ships neither tsx nor src/scripts/,
-- and dental-postgres publishes no ports, so
-- `pnpm --filter @dental/api backfill:cancelled-payments` cannot reach
-- production by design. This is the half that can, run with psql INSIDE the
-- dental-postgres container.
--
-- Population (the same as the script's
-- `{ isActive: true, kind: 'APPOINTMENT', appointment: { isActive: false } }`):
--   patient_payments where isActive AND kind = 'APPOINTMENT'
--   and its appointment has isActive = false, ANY status.
-- These are the payments earmarked to appointments deleted before #391 taught
-- deleteAppointment to convert them. An inactive appointment with no earmarked
-- payment is not in the population and is not touched.
--
-- This is NOT the #597 population. repair-cancelled-appointment-payments.sql
-- selects `a."isActive" = true AND a."status" = 'CANCELLED'` — appointments
-- cancelled through the ordinary edit, which stay rendered. The two files are
-- disjoint and neither predicate may be carried into the other.
--
-- It COUNTS BY DEFAULT. It mutates only with -v apply=1. Patient names are
-- never selected; rows are identified by tenant, patient, appointment and
-- payment id plus the amount, so the output can be pasted into an issue.
--
-- Output contract, so a test can parse it under `psql -A -t -F '|'`: one
-- 5-field line per matched payment (tenantId|patientId|appointmentId|paymentId|
-- amount), then one 6-field totals line
-- (TOTALS|paymentCount|appointmentCount|patientCount|tenantCount|totalAmount).
-- The counts are what make the production figure readable — 17 payments / 14
-- patient records / 92,200 in one tenant, measured 2026-11-23. That figure is a
-- property of that day, not an invariant of this file.
--
--   count:  psql -U <user> -d <db> -f backfill-cancelled-appointment-payments.sql
--   apply:  psql -U <user> -d <db> -v apply=1 -f backfill-cancelled-appointment-payments.sql
--
-- Run it from the operator's own shell: run the count, read it, then apply.
-- Nothing in the automated chain runs this file against production.
--
-- What it does when applied, mirroring convertAppointmentPaymentsToAdvance
-- exactly: kind -> ADVANCE, note gets the ' (cita cancelada)' suffix
-- (CANCELLED_APPOINTMENT_NOTE_SUFFIX), and one CONVERTED_TO_ADVANCE event per
-- payment with actor 'system:backfill-406' (SYSTEM_ACTOR_BACKFILL_406).
--
-- Differences from the script, deliberate:
--   * ONE transaction for the whole run instead of one per appointment. It is
--     stricter (all or nothing); the script's per-appointment shape exists to
--     bound a partial failure, which a single transaction cannot have.
--   * It does NOT re-derive the FIFO allocation: that lives in application
--     code. Converting an earmark on an appointment already outside the
--     billable set is expected to flip no other row (the script runs
--     recalculatePaidStatus anyway and reports "Paid-status columns changed",
--     expected 0). If the script half reports otherwise on a copy of
--     production data, that is a reason not to rely on this file alone.
--   * It does NOT write appointments.isPaid, and that is parity, not an
--     omission. The shared helper never touches the column; the #597 twin's
--     isPaid write is an addition its own header declares, needed because its
--     rows have isActive = true and keep a frozen isPaid = true that is still
--     rendered. Here every row's appointment has isActive = false, and every
--     appointment-level isPaid reader in apps/api filters isActive = true
--     (the monthly accrual aggregate, the COMPLETED revenue series and doctor
--     performance in stats.service.ts; the appointment export in
--     export.service.ts; the receipt findFirst and the patient-history summary
--     in pdf.service.ts), while restoreAppointment re-derives the column for
--     the whole patient if such a row becomes readable again. The #406 suite
--     asserts the pass leaves every cached isPaid identical, so clearing the
--     column would break agreement with the TS half, which is the spec.
--
-- Idempotent by construction: a converted payment is kind = 'ADVANCE' and no
-- longer matches, so a second apply lists nothing and appends no second suffix.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;

CREATE TEMP TABLE backfill_406_rows ON COMMIT DROP AS
SELECT p."id" AS "paymentId",
       p."tenantId",
       p."patientId",
       p."appointmentId",
       p."amount"
FROM "patient_payments" p
JOIN "appointments" a ON a."id" = p."appointmentId"
WHERE p."isActive" = true
  AND p."kind" = 'APPOINTMENT'
  AND a."isActive" = false;

SELECT "tenantId", "patientId", "appointmentId", "paymentId",
       to_char("amount", 'FM999999990.00') AS "amount"
FROM backfill_406_rows
ORDER BY "tenantId", "patientId", "appointmentId", "paymentId";

-- The leading 'TOTALS' label is load-bearing, not decoration: under
-- `psql -A -t -F '|'` a listing row carries 5 fields, and without the label the
-- totals line would carry 5 too, so a parser that tells the two apart by field
-- count (the way repair-cancelled-appointment-payments.sql.test.ts does for the
-- #597 file) could not. With it, listing = 5 fields, totals = 6.
SELECT 'TOTALS' AS "label",
       count(*) AS "paymentCount",
       count(DISTINCT "appointmentId") AS "appointmentCount",
       count(DISTINCT ("tenantId", "patientId")) AS "patientCount",
       count(DISTINCT "tenantId") AS "tenantCount",
       to_char(COALESCE(sum("amount"), 0), 'FM999999990.00') AS "totalAmount"
FROM backfill_406_rows;

\if :apply
  INSERT INTO "patient_payment_events" ("id", "tenantId", "paymentId", "type", "actorUserId")
  SELECT gen_random_uuid()::text, "tenantId", "paymentId", 'CONVERTED_TO_ADVANCE', 'system:backfill-406'
  FROM backfill_406_rows;

  UPDATE "patient_payments" p
  SET "kind" = 'ADVANCE',
      "note" = COALESCE(p."note", '') || ' (cita cancelada)',
      "updatedAt" = now()
  FROM backfill_406_rows r
  WHERE p."id" = r."paymentId";

  \echo Applied.
\else
  \echo Nothing was modified. Re-run with -v apply=1 to backfill.
\endif

COMMIT;
