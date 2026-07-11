# Re-rendering deleted ProRes masters (delete-and-re-render-on-demand policy, Andy 2026-07-11)

Masters are deterministic from (drop, pts, offsets, stitchlab git rev in metrics.json).

Ring 1.0 master:
  ./.venv/bin/python -m stitchlab stitch --drop ../../sample-data/drops/<drop> \
    --pts ../../sample-data/reference/mercy01/mercy01.pts --out reports/<run> --full

All-9 master (viaduct):
  ./.venv/bin/python -m stitchlab stitch9 --drop ../../sample-data/drops/viaduct-local9 \
    --pts ../../sample-data/reference/mercy01/mercy01.pts --out reports/<run> \
    --offsets reports/clip04-sky/round3/sky_offsets_polished.json --full
  (add --composite seam-cost to reproduce the rejected pre-ring-first candidate)

Each run dir keeps metrics.json (inputs, hashes, argv, git head) as the exact recipe.
