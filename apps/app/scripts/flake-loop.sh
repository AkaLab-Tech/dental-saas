#!/usr/bin/env bash
# Run the apps/app suite N times while the apps/api suite runs concurrently in
# the background, keeping per-run logs, JSON timings and load-average/colima
# snapshots, then print a summary table. Written for task #398, adapted from
# apps/api/scripts/flake-loop.sh (task #394).
#
#   bash scripts/flake-loop.sh 10
#
# Artifacts land in apps/app/.flake-diag/ (gitignored).
set -uo pipefail

RUNS="${1:-10}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
# One directory per invocation, so a fresh loop can never be read as a mix of
# its own results and a previous loop's leftovers.
OUT_DIR="$APP_DIR/.flake-diag/$(date +%Y%m%dT%H%M%S)"
mkdir -p "$OUT_DIR"

# Driving the app suite directly (not via `turbo test`) preserves per-test
# timings, but that bypasses turbo.json's `dependsOn: ["build"]` — without
# packages/shared/dist, 21/93 files fail to resolve "@dental/shared" and a
# "10 consecutive green runs" claim would measure nothing.
if [ ! -d "$ROOT_DIR/packages/shared/dist" ]; then
  echo "[flake-loop] packages/shared/dist is missing — run: pnpm --filter @dental/shared build" >&2
  exit 1
fi

green=0
red=0
declare -a results=()

for i in $(seq 1 "$RUNS"); do
  run_id="$(printf 'run-%03d' "$i")"
  log="$OUT_DIR/$run_id.log"
  api_log="$OUT_DIR/$run_id.api.log"
  json_out="$OUT_DIR/$run_id.json"
  load_file="$OUT_DIR/$run_id.load"

  {
    uptime
    colima list
  } >"$load_file" 2>&1

  # Concurrent load: the api suite runs in the background so the app suite
  # sees the same CPU contention that made #398 flake under `pnpm test`.
  (cd "$ROOT_DIR" && pnpm --filter @dental/api test) >"$api_log" 2>&1 &
  api_pid=$!

  start=$(date +%s)
  (cd "$APP_DIR" && pnpm exec vitest run --reporter=default --reporter=json --outputFile.json="$json_out") >"$log" 2>&1
  status=$?
  end=$(date +%s)

  wait "$api_pid"
  api_status=$?

  tests=$(grep -E '^ *Tests +' "$log" | tail -1 | sed 's/^ *//')
  files=$(grep -E '^ *Test Files +' "$log" | tail -1 | sed 's/^ *//')

  if [ "$status" -eq 0 ]; then
    green=$((green + 1))
    verdict=PASS
  else
    red=$((red + 1))
    verdict=FAIL
  fi

  api_verdict=PASS
  [ "$api_status" -eq 0 ] || api_verdict=FAIL

  results+=("$run_id|$verdict|$((end - start))s|${files}|${tests}|api=${api_verdict}")
  echo "[flake-loop] $run_id $verdict in $((end - start))s  ($files / $tests)  api=$api_verdict"
done

echo
echo "=============== flake-loop summary ==============="
printf '%s\n' "${results[@]}"
echo "-------------------------------------------------"
echo "green=$green red=$red of $RUNS runs"
echo "logs + diagnostics: $OUT_DIR"
[ "$red" -eq 0 ]
