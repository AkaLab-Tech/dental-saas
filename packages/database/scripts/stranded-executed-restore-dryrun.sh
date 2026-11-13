#!/bin/sh
# #685: emit the dry-run SQL for the stranded EXECUTED budget items on stdout,
# with the credit-census control spliced in FROM THE COMMITTED PROBE at run
# time. Writes nothing and connects to nothing: the caller pipes the output
# into psql.
#
#   packages/database/scripts/stranded-executed-restore-dryrun.sh \
#     | docker exec -i dental-postgres psql -U <user> -d dental_saas
#
# Why a wrapper instead of one more copy of the formula: on 2026-11-13 the
# credit census rewritten from memory returned 92 patients / 546,847.50 instead
# of 89 / 523,647.50, because it omitted held advances and labwork debt (#633,
# comment of 2026-11-13). So the formula is never retyped -- it is cut out of
# uncharged-executed-links-probe.sql, which produced the 89 / 523,647.50 figure
# in the first place, and this script refuses to emit anything if the cut
# fragment has lost any of the three parts that went missing that day.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROBE="$DIR/uncharged-executed-links-probe.sql"
BODY="$DIR/stranded-executed-restore-dryrun.sql"
MARKER='-- >>> CREDIT_CENSUS_SPLICE_POINT <<<'

for f in "$PROBE" "$BODY"; do
  [ -r "$f" ] || { echo "stranded-executed-restore-dryrun: cannot read $f" >&2; exit 1; }
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
  echo "stranded-executed-restore-dryrun: credit-census formula not found in $PROBE" >&2
  exit 1
}

# The three parts the from-memory rewrite dropped. Each is asserted on its own,
# so the message names which one went missing.
assert_fragment() {
  printf '%s' "$CENSUS" | grep -qF -- "$1" || {
    echo "stranded-executed-restore-dryrun: the credit-census formula in $PROBE no longer contains $2" >&2
    echo "  Refusing to emit: without it the census does not reproduce 89 / 523647.50 (#633)." >&2
    exit 1
  }
}
assert_fragment 'x.held'      'the held-advance term (x.held)'
assert_fragment 'labworks'    'the labwork debt term (labworks)'
assert_fragment '"status" <> '"'"'CANCELLED'"'"' AND "cost" > 0' \
                'the appointment CANCELLED clause of the debt term'

grep -qF -- "$MARKER" "$BODY" || {
  echo "stranded-executed-restore-dryrun: splice point missing from $BODY" >&2
  exit 1
}

# Emitted in three pieces (head / formula / tail) rather than through an awk
# variable: awk -v mangles a multi-line value, and the formula must be spliced
# byte for byte. A terminal no-op CTE absorbs its trailing comma, so not even
# its last character is edited.
awk -v m="$MARKER" 'index($0, m) { exit } { print }' "$BODY"
printf 'WITH\n%s\nsplice_tail AS (SELECT 1 AS one)\nSELECT c.credit_patients, c.credit_total, c.patients_enumerated\nFROM census c, splice_tail;\n' "$CENSUS"
awk -v m="$MARKER" 'p { print } index($0, m) { p = 1 }' "$BODY"
