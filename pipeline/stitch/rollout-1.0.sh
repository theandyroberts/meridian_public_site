#!/usr/bin/env bash
# 1.0 ring-stitch rollout: stitch -> report -> publish -> promote -> swap,
# for every catalog clip except DTLA (pro-stitched) and viaduct (already done).
set -euo pipefail
cd "$(dirname "$0")"

PTS=../../sample-data/reference/mercy01/mercy01.pts
HOST="ubuntu@51.81.202.126"
PY=./.venv/bin/python

declare -a JOBS=(
  "mateo-signal PL-5042477"
  "santa-fe-underpass PL-3699491"
  "second-street-tunnel PL-3259988"
  "pch-malibu PL-5742139"
  "topanga-beach PL-2527442"
  "pch-topanga-roll PL-7600232"
)

for job in "${JOBS[@]}"; do
  read -r DROP SKU <<<"$job"
  RUN="reports/${DROP}-1.0"
  echo "=== [$DROP -> $SKU] ==="

  FREE_GB=$(df -g / | tail -1 | awk '{print $4}')
  if [ "$FREE_GB" -lt 8 ]; then echo "ABORT: only ${FREE_GB}GB free"; exit 3; fi

  $PY -m stitchlab stitch --drop "$PWD/../../sample-data/drops/$DROP" --pts "$PTS" --out "$RUN" --full
  $PY -m stitchlab report --run "$RUN"
  ./publish-report.sh "$RUN" "${DROP}-1.0"
  $PY -m stitchlab promote --run "$RUN" --pts "$PTS" --sku "$SKU" --label "RING STITCH 1.0"

  TS=$(date +%Y%m%d-%H%M%S)
  cp "$RUN/promoted_preview.mp4" "../../web/public/media/$SKU/stitched_preview.mp4"
  ssh -o BatchMode=yes "$HOST" "cp /var/www/platelab/web/public/media/$SKU/stitched_preview.mp4 /var/www/platelab/web/public/media/$SKU/stitched_preview.mp4.bak-$TS"
  rsync -az --partial "$RUN/promoted_preview.mp4" "$HOST:/var/www/platelab/web/public/media/$SKU/stitched_preview.mp4"
  echo "LIVE: $SKU $(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://theplatelab.site/media/$SKU/stitched_preview.mp4)"
done
echo "ROLLOUT COMPLETE"
