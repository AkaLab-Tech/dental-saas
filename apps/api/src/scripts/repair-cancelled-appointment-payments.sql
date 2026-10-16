-- Task #597: SQL twin of repair-cancelled-appointment-payments.ts.
--
-- Why this file exists: the production image ships neither tsx nor src/scripts/,
-- and dental-postgres publishes no ports. This is the half that can reach
-- production, run with psql INSIDE the dental-postgres container.
--
-- Population (the same as the script's):
--   patient_payments where isActive AND kind = 'APPOINTMENT'
--   and its appointment has isActive AND status = 'CANCELLED'.
-- A cancelled appointment with no earmarked payment is not in it and is not
-- touched.
--
-- It COUNTS BY DEFAULT. It mutates only with -v apply=1. Patient names are never
-- selected; rows are identified by patient id.
--
--   count:  psql -U <user> -d <db> -f repair-cancelled-appointment-payments.sql
--   apply:  psql -U <user> -d <db> -v apply=1 -f repair-cancelled-appointment-payments.sql
--
-- Run it from the operator's own shell. Nothing in the automated chain runs it
-- against production.
--
-- What it does when applied, mirroring convertAppointmentPaymentsToAdvance plus
-- the isPaid write: kind -> ADVANCE, note gets the ' (cita cancelada)' suffix, one
-- CONVERTED_TO_ADVANCE event per payment (actor 'system:repair-597'), and
-- appointments.isPaid -> false.
--
-- Differences from the script, deliberate:
--   * ONE transaction for the whole run instead of one per patient. It is
--     stricter (all or nothing); the script's per-patient shape exists to bound
--     a partial failure, which a single transaction cannot have.
--   * It does NOT re-run the FIFO allocation: that lives in application code.
--     Converting an earmark on an item outside the billable set is expected to
--     flip no other row (the script reports this as "Paid-status columns
--     changed", expected 0). If the script half reports otherwise on a copy of
--     production data, that is a reason not to rely on this file alone.
--
-- Idempotent: a converted payment is kind = 'ADVANCE' and no longer matches.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;

CREATE TEMP TABLE repair_597_rows ON COMMIT DROP AS
SELECT p."id" AS "paymentId",
       p."tenantId",
       p."patientId",
       p."appointmentId",
       p."amount",
       a."isPaid" AS "appointmentIsPaid"
FROM "patient_payments" p
JOIN "appointments" a ON a."id" = p."appointmentId"
WHERE p."isActive" = true
  AND p."kind" = 'APPOINTMENT'
  AND a."isActive" = true
  AND a."status" = 'CANCELLED';

SELECT "tenantId", "patientId", "appointmentId", "paymentId",
       to_char("amount", 'FM999999990.00') AS "amount", "appointmentIsPaid"
FROM repair_597_rows
ORDER BY "tenantId", "patientId", "appointmentId", "paymentId";

SELECT count(*) AS "paymentCount",
       count(DISTINCT "appointmentId") AS "appointmentCount",
       count(DISTINCT "appointmentId") FILTER (WHERE "appointmentIsPaid") AS "frozenIsPaidCount",
       count(DISTINCT ("tenantId", "patientId")) AS "patientCount"
FROM repair_597_rows;

\if :apply
  INSERT INTO "patient_payment_events" ("id", "tenantId", "paymentId", "type", "actorUserId")
  SELECT gen_random_uuid()::text, "tenantId", "paymentId", 'CONVERTED_TO_ADVANCE', 'system:repair-597'
  FROM repair_597_rows;

  UPDATE "patient_payments" p
  SET "kind" = 'ADVANCE',
      "note" = COALESCE(p."note", '') || ' (cita cancelada)',
      "updatedAt" = now()
  FROM repair_597_rows r
  WHERE p."id" = r."paymentId";

  UPDATE "appointments" a
  SET "isPaid" = false,
      "updatedAt" = now()
  WHERE a."id" IN (SELECT "appointmentId" FROM repair_597_rows);

  \echo Applied.
\else
  \echo Nothing was modified. Re-run with -v apply=1 to repair.
\endif

COMMIT;
