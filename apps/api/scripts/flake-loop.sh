#!/usr/bin/env bash
# Run the API suite N times, keeping per-run logs, diagnostics, load average and
# TIME_WAIT samples, then print a summary table. Written for task #394.
#
#   bash scripts/flake-loop.sh 10          # plain runs
#   API_TEST_DIAG=1 bash scripts/flake-loop.sh 15   # with instrumentation
#
# Artifacts land in apps/api/.flake-diag/ (gitignored).
set -uo pipefail

RUNS="${1:-10}"
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# One directory per invocation, so a fresh loop can never be read as a mix of
# its own results and a previous loop's leftovers.
OUT_DIR="$API_DIR/.flake-diag/$(date +%Y%m%dT%H%M%S)"
mkdir -p "$OUT_DIR"

green=0
red=0
declare -a results=()

for i in $(seq 1 "$RUNS"); do
  run_id="$(printf 'run-%03d' "$i")"
  log="$OUT_DIR/$run_id.log"
  export API_TEST_DIAG_RUN="$run_id"
  export API_TEST_DIAG_DIR="$OUT_DIR"

  # Sample TIME_WAIT throughout the run so a failure can be correlated with
  # loopback socket pressure.
  tw_file="$OUT_DIR/$run_id.timewait"
  (
    while true; do
      echo "$(date +%s) $(netstat -an -p tcp | grep -c TIME_WAIT)" >>"$tw_file"
      sleep 1
    done
  ) &
  tw_pid=$!

  start=$(date +%s)
  (cd "$API_DIR" && pnpm exec vitest run) >"$log" 2>&1
  status=$?
  end=$(date +%s)

  kill "$tw_pid" 2>/dev/null
  wait "$tw_pid" 2>/dev/null

  tw_max=$(awk '{ if ($2 > m) m = $2 } END { print m+0 }' "$tw_file" 2>/dev/null)
  load=$(uptime | sed 's/.*load averages*: //')
  tests=$(grep -E '^ *Tests +' "$log" | tail -1 | sed 's/^ *//')
  files=$(grep -E '^ *Test Files +' "$log" | tail -1 | sed 's/^ *//')

  if [ "$status" -eq 0 ]; then
    green=$((green + 1))
    verdict=PASS
  else
    red=$((red + 1))
    verdict=FAIL
  fi

  results+=("$run_id|$verdict|$((end - start))s|${files}|${tests}|TW_max=${tw_max}|load=${load}")
  echo "[flake-loop] $run_id $verdict in $((end - start))s  ($files / $tests)"
done

echo
echo "=============== flake-loop summary ==============="
printf '%s\n' "${results[@]}"
echo "-------------------------------------------------"
echo "green=$green red=$red of $RUNS runs"
echo "logs + diagnostics: $OUT_DIR"
[ "$red" -eq 0 ]
