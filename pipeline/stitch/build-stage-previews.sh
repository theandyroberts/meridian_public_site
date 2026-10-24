#!/usr/bin/env bash
set -euo pipefail

# Build the watermarked, 2:1 equirectangular previews consumed by /stage.
#
# The plate-page ring player intentionally keeps using stitched_preview.mp4.
# This script creates a separate stage_preview.mp4 with the sky tier present,
# padding the unobserved lower hemisphere rather than stretching a ring crop.

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STITCH_ROOT="$ROOT/pipeline/stitch"
PY="${TPL_STAGE_PYTHON:-$STITCH_ROOT/.venv/bin/python}"
PTS="${TPL_STAGE_PTS:-$ROOT/../spheris-smart-stitch-live/config/mercy01/mercy01.pts}"
REPORT_ROOT="$STITCH_ROOT/reports/stage-fullsphere"
CACHE_ROOT="$STITCH_ROOT/source-cache/stage-fullsphere"
FONT="${TPL_STAGE_FONT:-/System/Library/Fonts/Helvetica.ttc}"
ONLY_SKU=${1:-}

if [[ ! -x "$PY" ]]; then
  echo "Missing stitchlab Python: $PY" >&2
  exit 1
fi
if [[ ! -f "$PTS" ]]; then
  echo "Missing PTGui calibration: $PTS" >&2
  exit 1
fi

mkdir -p "$REPORT_ROOT"

plate_rows=(
  "PL-2527442|topanga-beach"
  "PL-3259988|second-street-tunnel"
  "PL-3699491|santa-fe-underpass"
  "PL-4106099|viaduct-approach"
  "PL-5042477|mateo-signal"
  "PL-5742139|pch-malibu"
  "PL-7600232|pch-topanga-roll"
)

watermark_stage_preview() {
  local source=$1
  local sku=$2
  local destination=$3
  local source_width source_height canvas_height

  source_width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$source")
  source_height=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$source")
  canvas_height=$((source_width / 2))
  if (( source_height > canvas_height )); then
    echo "$sku source is taller than a 2:1 canvas: ${source_width}x${source_height}" >&2
    return 1
  fi

  ffmpeg -v error -nostdin -y -i "$source" -vf \
    "pad=${source_width}:${canvas_height}:0:0:black,"\
"scale=2048:1024:flags=lanczos,"\
"eq=contrast=1.22:saturation=1.45:gamma=1.06,"\
"drawtext=fontfile=${FONT}:text='PLATE LAB · PREVIEW':fontsize=h/18:fontcolor=white@0.16:x=(w-text_w)/2:y=(h-text_h)/2,"\
"drawtext=fontfile=${FONT}:text='${sku} · NOT FOR PRODUCTION':fontsize=h/48:fontcolor=white@0.55:x=24:y=h-text_h-20,"\
"drawtext=fontfile=${FONT}:text='360 STAGE PREVIS · FULL SPHERE':fontsize=h/36:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=10:x=24:y=20,"\
"setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited" \
    -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p \
    -movflags +faststart -an "$destination"
}

prepare_preview_drop() {
  local sku=$1
  local source_drop=$2
  local output_dir=$3

  if [[ "$sku" != "PL-5042477" ]]; then
    printf '%s\n' "$source_drop"
    return
  fi

  # The archived J007 source ends at 100.29s while the other eight cameras run
  # to roughly 147.75s. For the watermarked staging previs only, hold J's final
  # frame so the complete plate remains navigable. This is not a replacement
  # for recovering the missing source and must never be promoted to production.
  local repaired_drop="$output_dir/repaired-drop"
  local repaired_j
  repaired_j="$repaired_drop/cam_J.mov"
  local target_duration j_duration hold_duration
  mkdir -p "$repaired_drop"
  for camera in A B C D E F G H; do
    ln -sfn "$source_drop/cam_${camera}.mov" "$repaired_drop/cam_${camera}.mov"
  done
  ln -sfn "$source_drop/meta.json" "$repaired_drop/meta.json"
  ln -sfn "$source_drop/telemetry.json" "$repaired_drop/telemetry.json"

  target_duration=$(for camera in A B C D E F G H; do
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$source_drop/cam_${camera}.mov"
  done | sort -n | tail -1)
  j_duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$source_drop/cam_J.mov")
  hold_duration=$(awk -v target="$target_duration" -v actual="$j_duration" 'BEGIN { printf "%.6f", target - actual }')

  if awk -v hold="$hold_duration" 'BEGIN { exit !(hold > 0.25) }'; then
    if [[ ! -f "$repaired_j" || "${TPL_FORCE_STAGE_STITCH:-0}" == "1" ]]; then
      echo "$sku: J camera is ${hold_duration}s short; creating a staging-only held-frame repair" >&2
      ffmpeg -v error -nostdin -y -i "$source_drop/cam_J.mov" \
        -vf "tpad=stop_mode=clone:stop_duration=${hold_duration},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited" \
        -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -an "$repaired_j"
    fi
  else
    ln -sfn "$source_drop/cam_J.mov" "$repaired_j"
  fi

  printf '%s\n' "$repaired_drop"
}

for row in "${plate_rows[@]}"; do
  IFS='|' read -r sku drop_name <<<"$row"
  if [[ -n "$ONLY_SKU" && "$sku" != "$ONLY_SKU" ]]; then
    continue
  fi

  drop="$ROOT/sample-data/drops/$drop_name"
  if [[ -d "$CACHE_ROOT/$drop_name" ]]; then
    drop="$CACHE_ROOT/$drop_name"
  fi
  out="$REPORT_ROOT/$sku"
  destination="$ROOT/web/public/media/$sku/stage_preview.mp4"
  mkdir -p "$out" "$(dirname "$destination")"

  missing=0
  for camera in A B C D E F G H J; do
    if [[ ! -f "$drop/cam_${camera}.mov" ]]; then
      echo "$sku missing camera $camera: $drop/cam_${camera}.mov" >&2
      missing=1
    fi
  done
  if (( missing )); then
    echo "$sku cannot render until its nine camera sources are mounted" >&2
    continue
  fi

  preview_drop=$(prepare_preview_drop "$sku" "$drop" "$out") || {
    echo "$sku could not prepare its staging-preview sources" >&2
    continue
  }

  # PL-4106099 has already completed the expensive full render and its latest
  # ring-first/parallax candidate is the best available source for stage QA.
  if [[ "$sku" == "PL-4106099" ]]; then
    master="$STITCH_ROOT/reports/clip04-sky/parallax/full/viaduct-local9_nineband_prores.mov"
  else
    master="$out/${drop_name}_nineband_prores.mov"
    if [[ ! -f "$master" || "${TPL_FORCE_STAGE_STITCH:-0}" == "1" ]]; then
      calibration_args=(--refine)
      if [[ -f "$out/sky_offsets_final.json" && "${TPL_FORCE_STAGE_REFINE:-0}" != "1" ]]; then
        echo "$sku: reusing completed sky calibration"
        calibration_args=(--offsets "$out/sky_offsets_final.json" --no-polish)
      fi
      echo "$sku: rendering nine-camera full-sphere band"
      PYTHONPATH="$STITCH_ROOT" "$PY" -m stitchlab stitch9 \
        --drop "$preview_drop" \
        --pts "$PTS" \
        --out "$out" \
        --eq 2048 1024 \
        --sample 4 \
        "${calibration_args[@]}" \
        --full \
        --scan-crossing 0 \
        --no-temporal-qc \
        --parallax off \
        --no-structure-first || {
          if [[ ! -f "$master" ]]; then
            echo "$sku stitch failed before producing a master" >&2
            continue
          fi
          echo "$sku produced a master but did not clear the automated QC gate; retaining it for visual stage QA" >&2
        }
    fi
  fi

  echo "$sku: encoding Studio preview"
  watermark_stage_preview "$master" "$sku" "$destination"
done

echo "Stage-preview build pass complete."
