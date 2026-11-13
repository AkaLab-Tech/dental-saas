#!/bin/sh
# #685 part 2: emit the conflict dry-run SQL for the 6 blocked stranded
# EXECUTED items on stdout, with the credit-census control and the per-patient
# held figures spliced in FROM THE COMMITTED PROBE at run time. Writes nothing
# and connects to nothing: the caller pipes the output into psql.
#
#   packages/database/scripts/stranded-executed-conflict-dryrun.sh \
#     | docker exec -i dental-postgres psql -U <user> -d dental_saas
#
# Why a wrapper instead of one more copy of the formula: on 2026-11-13 the
# credit census rewritten from memory returned 92 patients / 546,847.50 instead
# of 89 / 523,647.50, because it omitted held advances and labwork debt (#633,
# comment of 2026-11-13). So the formula is never retyped -- it is cut out of
# uncharged-executed-links-probe.sql, which produced the 89 / 523,647.50 figure
# in the first place, and this script refuses to emit anything if the cut
# fragment has lost any of the three parts that went missing that day. Same
# contract as the part-1 wrapper stranded-executed-restore-dryrun.sh.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROBE="$DIR/uncharged-executed-links-probe.sql"
BODY="$DIR/stranded-executed-conflict-dryrun.sql"
MARKER='-- >>> CREDIT_CENSUS_SPLICE_POINT <<<'

for f in "$PROBE" "$BODY"; do
  [ -r "$f" ] || { echo "stranded-executed-conflict-dryrun: cannot read $f" >&2; exit 1; }
done

# The formula is the CTE run from the `getPatientBalance` comment down to the
# `),` that closes `census AS (`, i.e. everything before `target AS (` -- which
# is the only part of the probe's section (3) that depends on its `links` CTE.
CENSUS=$(awk '
  /^-- getPatientBalance, per ITEM never per link/ { on = 1 }
  on && /^target AS \($/                           { exit }
  on                                               { print }
' "$PROBE")

[ -n "$CENSUS" ] || {
  echo "stranded-executed-conflict-dryrun: credit-census formula not found in $PROBE" >&2
  exit 1
}

# The three parts the from-memory rewrite dropped. Each is asserted on its own,
# so the message names which one went missing.
assert_fragment() {
  printf '%s' "$CENSUS" | grep -qF -- "$1" || {
    echo "stranded-executed-conflict-dryrun: the credit-census formula in $PROBE no longer contains $2" >&2
    echo "  Refusing to emit: without it the census does not reproduce 89 / 523647.50 (#633)." >&2
    exit 1
  }
}
assert_fragment 'x.held'      'the held-advance term (x.held)'
assert_fragment 'labworks'    'the labwork debt term (labworks)'
assert_fragment '"status" <> '"'"'CANCELLED'"'"' AND "cost" > 0' \
                'the appointment CANCELLED clause of the debt term'
# fin is what (N3h) reads its per-patient columns off; the census fragment must
# still define it, or the spliced statement would be a silent SQL error.
assert_fragment 'fin AS ('    'the per-patient fin CTE that (N3h) reads'

grep -qF -- "$MARKER" "$BODY" || {
  echo "stranded-executed-conflict-dryrun: splice point missing from $BODY" >&2
  exit 1
}

# Emitted in pieces (head / spliced statements / tail) rather than through an
# awk variable: awk -v mangles a multi-line value, and the formula must be
# spliced byte for byte. A terminal no-op CTE absorbs its trailing comma, so not
# even its last character is edited.
#
# (N3h)'s own population is deliberately NOT the 45-line stranded CTE but the
# 4-line superset "patients holding an EXECUTED link on an inactive
# appointment": it needs no copy of the chain, it cannot miss a stranded
# patient, and its row count being >= (N3)'s distinct patients is the control
# that it did not.
#
# The join to `fin` is a LEFT join, measured on dental_test 2026-11-13: `fin`
# enumerates only patients with debt OR payments (its `ids` CTE), and a patient
# whose ONLY money is a stranded item has neither -- the stranded item bills
# nothing, which is the whole defect. An inner join silently dropped 7 of 11
# fabricated stranded patients. enumerated_by_census prints which side a row
# came from, so "no held, no credit" is distinguishable from "not measured".
awk -v m="$MARKER" 'index($0, m) { exit } { print }' "$BODY"
printf 'WITH\n%s\nsplice_tail AS (SELECT 1 AS one)\nSELECT c.credit_patients, c.credit_total, c.patients_enumerated\nFROM census c, splice_tail;\n' "$CENSUS"
printf '\n\\echo\n\\echo %s\n\\echo %s\nWITH\n%s\nstranded_patients AS (\n  SELECT DISTINCT a."patientId" AS pid\n  FROM "appointments" a\n  JOIN "budget_item_appointments" l ON l."appointmentId" = a."id" AND l."role" = %s\n  WHERE NOT a."isActive"\n)\nSELECT s.pid AS patient_id, (f.pid IS NOT NULL) AS enumerated_by_census,\n       round(coalesce(f.debt, 0), 2) AS debt, round(coalesce(f.paid, 0), 2) AS paid,\n       round(coalesce(f.held, 0), 2) AS held, round(coalesce(f.credit, 0), 2) AS credit,\n       round(coalesce(f.outstanding, 0), 2) AS outstanding\nFROM stranded_patients s LEFT JOIN fin f ON f.pid = s.pid\nORDER BY coalesce(f.held, 0) DESC, s.pid;\n' \
  "'####  (N3h) HELD / CREDIT per patient holding an EXECUTED link on an inactive appointment  ####'" \
  "'enumerated_by_census false = the patient has neither debt nor payments, so the census never enumerated them: no held, nothing to reconcile.'" \
  "$CENSUS" "'EXECUTED'"
awk -v m="$MARKER" 'p { print } index($0, m) { p = 1 }' "$BODY"
