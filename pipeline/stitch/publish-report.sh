#!/usr/bin/env bash
# Publish a stitch review report to the production admin gallery.
#
#   ./publish-report.sh reports/clip04-full [run-name]
#
# Uploads index.html + previews + metrics (NEVER the ProRes master — that is
# vault material) to /var/www/platelab/web/data/stitch-reports/<run-name>/ on
# the OVH box. Reports are served only behind the /admin session.

set -euo pipefail

RUN_DIR="${1:?usage: publish-report.sh <run-dir> [run-name]}"
RUN_NAME="${2:-$(basename "$RUN_DIR")}"
HOST="${PLATELAB_DEPLOY_HOST:-ubuntu@51.81.202.126}"
DEST="/var/www/platelab/web/data/stitch-reports/${RUN_NAME}"

test -f "$RUN_DIR/index.html" || { echo "no index.html in $RUN_DIR" >&2; exit 1; }

ssh "$HOST" "mkdir -p '$DEST'"
rsync -az --partial --progress \
  --include='index.html' --include='*.mp4' \
  --include='metrics.json' --include='approved.json' --include='promoted.json' \
  --exclude='*' \
  "$RUN_DIR"/ "$HOST:$DEST/"

echo "published: https://theplatelab.site/admin/stitch (run: $RUN_NAME)"
