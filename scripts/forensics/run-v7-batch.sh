#!/usr/bin/env bash
# Sequential runner for all 8 remaining v7 briefs.
set -uo pipefail

cd "$(dirname "$0")/../.."
export BUILDFLOW_IFC_KEY_FILE=/tmp/.bf_ifc_key

BRIEFS=(
  "v7-baseline-home-office"
  "v7-baseline-clinic-reception"
  "v7-baseline-l-shape-office"
  "v7-baseline-coworking-space"
  "v7-baseline-bedroom"
  "v7-baseline-sol-booth"
  "v7-a-l-shape"
  "v7-b-2bedroom"
)

OUT=prod-eval-outputs-v7/postfix
mkdir -p "$OUT"

for label in "${BRIEFS[@]}"; do
  echo ""
  echo "=== $label ===" | tee -a "$OUT/batch.log"
  date +"%H:%M:%S start" | tee -a "$OUT/batch.log"
  npx tsx scripts/forensics/run-brief-direct.ts \
    --brief "scripts/forensics/briefs/${label}.txt" \
    --out-dir "$OUT" \
    --label "$label" \
    --cost-cap 1.5 \
    2>&1 | tee -a "$OUT/batch.log" \
    || echo "  [non-fatal: $label failed; continuing]" | tee -a "$OUT/batch.log"
  date +"%H:%M:%S done" | tee -a "$OUT/batch.log"
done

echo ""
echo "ALL DONE"
