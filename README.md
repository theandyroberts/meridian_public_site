# The Plate Lab — public site & ingest pipeline

Storefront for 360×180 driving-plate environments captured on the Spheris
9-camera array (Meridian Live Stitch). Art directors browse, preview, reserve,
and license plates; the pipeline turns capture-day drops into a secure,
watermarked, metadata-rich catalog.

Design spec: [docs/specs/2026-06-10-platelab-design.md](docs/specs/2026-06-10-platelab-design.md)

## Layout

| Path | What |
| --- | --- |
| `shared/` | Catalog schema (zod) + SKU & pricing rules, used by both sides |
| `pipeline/` | Ingest CLI: drop → preflight → calibrated full-sphere stitch/QC → telemetry → AI enrichment → watermarked renditions → upload → catalog publish |
| `web/` | Next.js site: home, faceted browse, plate detail with frame-synced stitched + 9-grid player |
| `viewer/` | Standalone Three.js LED-wall stage viewer; built into `web/public/stage/`, served at `/stage` |
| `sample-data/` | Drop staging, audit log, demo reservations (gitignored media) |

## Quick start

Requires **Node 22**. `web/data/catalog.json` is runtime state (untracked) —
generate demo data first or the site starts empty.

```bash
npm ci

# Option A — synthetic demo footage (no real media needed)
npm run demo:generate

# Option B — real Spheris capture folders (symlinked, nothing copied)
npx -w pipeline tsx src/demo/import-real.ts

npm run demo:ingest      # run the full pipeline over every drop
npm run dev              # site at http://localhost:3000
npm test                 # pipeline unit tests
```

`/stage` (the LED-wall stage viewer) works out of the box — it's a committed
static build, no extra step. Env vars are optional for browsing; `/admin` needs
`ADMIN_PASSWORD` (and `ADMIN_COOKIE_INSECURE=1` for localhost over http) in
`web/.env.local`. To edit the viewer itself: `cd viewer && npm install && npm run build`.

## Ingest pipeline

Run the read-only check before spending stitch time or changing the catalog:

```bash
npm run ingest:preflight -- /path/to/one/drop
npm run ingest:preflight:all -- /path/to/folder/of/drops
```

The check verifies the camera set, media dimensions/rates/durations, 2:1 master
geometry, rig calibration, telemetry, and AI configuration. It reports every
drop as `READY` or `BLOCKED` and returns a non-zero exit code if any batch item
is blocked. The root `.env` is loaded automatically.

`npm run ingest -w pipeline -- <drop-dir>` then runs one ready drop through:

1. **discover** — stitched master (optional) + 9 camera files (`cam_X.mov` or
   RED first-letter convention) + `telemetry.json` + `meta.json`
2. **master** — verify a supplied 2:1 full sphere, or run all nine cameras
   through `stitchlab stitch9`; seam/phase/regression QC is a publication gate
3. **probe** (ffprobe) → **sku** (collision-checked) → **checksum** (sha256)
4. **telemetry** — F9R GPS/IMU → route, speed stats, OpenStreetMap endpoint
   names, and a street-map route preview
5. **label** — representative full-sphere frames → structured OpenAI vision
   enrichment for objects, architecture, infrastructure, and named locations
6. **describe** — OpenAI-generated title/description; capture prefixes are
   removed. Production ingest fails closed if `OPENAI_API_KEY` is unavailable
7. **renditions** — watermarked full-sphere previews, Studio preview, nine
   camera tiles, and poster; an unstitched camera grid is never published
8. **upload** — local (`web/public/media/`) or S3 (private vault bucket for
   originals, public bucket for renditions)
9. **publish** — schema-validated atomic upsert into `web/data/catalog.json`

Mercy01 drops may use the bundled `mercy01-v1` calibration. Any other rig must
include a `.pts` file, set `calibrationProfile` in `meta.json`, or provide
`PLATELAB_CALIBRATION_PATH`; this prevents legacy clips from silently using the
wrong lens/camera geometry. A supplied 2:1 master without stitchlab metrics is
accepted only when `meta.trustedStitchedMaster` is explicitly `true` after
operator review; otherwise nine available cameras are rebuilt and QC-gated.

Every stage appends to `sample-data/audit.jsonl` (chain of custody).
Originals never reach a web-served path; previews are burned with SKU +
`NOT FOR PRODUCTION`. Screening-room access to masters uses HMAC-signed
expiring links (`pipeline/src/sign.ts`, verified by `/api/screener`).

## Pricing

$8,000 per stitched minute, prorated per second after a 1-minute minimum
(`shared/src/pricing.ts`). Custom volumetric-stage delivery is a quote CTA.

## Deploy

Auto-deploys via Coolify on push to `main` (a GitHub webhook triggers the build).
See [docs/2026-07-22-deploy-coolify.md](docs/2026-07-22-deploy-coolify.md).
