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
| `pipeline/` | Ingest CLI: drop → probe → SKU → checksum → telemetry → labeling → description → watermarked renditions → upload → catalog publish |
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

`npx -w pipeline tsx src/cli.ts ingest <drop-dir>` runs one drop through:

1. **discover** — stitched master (optional) + 9 camera files (`cam_X.mov` or
   RED first-letter convention) + `telemetry.json` + `meta.json`
2. **probe** (ffprobe) → **sku** (`PL<yy><jjj>-<nnnn>`, collision-checked) →
   **checksum** (sha256)
3. **telemetry** — F9R GPS/IMU sidecar → route, speed stats, IMU badge
4. **label** — frame sampling → Claude vision (`ANTHROPIC_API_KEY`) or
   deterministic offline stub
5. **describe** — title/description (Claude or template)
6. **renditions** — watermarked previews (stitched or 6-cam ring panorama),
   9 camera tiles, poster; preview-only viewing grade for log footage
7. **upload** — local (`web/public/media/`) or S3 (private vault bucket for
   originals, public bucket for renditions)
8. **publish** — schema-validated atomic upsert into `web/data/catalog.json`

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
