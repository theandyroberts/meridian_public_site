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
| `web/` | Next.js site: Supabase catalog, projects, imported detail with synchronized Lab 360, panorama, GPS/IMU and evidence |
| `viewer/` | Standalone Three.js LED-wall stage viewer; built into `web/public/stage/`, served at `/stage` |
| `sample-data/` | Drop staging, audit log, demo reservations (gitignored media) |

## Quick start

Requires **Node 22**. `main` is the shared development baseline for the full
product, including the latest imported detail page, stage viewer and ingest
pipeline. Start feature branches from an up-to-date `main`.

The website reads its catalog from Supabase, not `web/data/catalog.json`.
Configure `web/.env.local` from `web/.env.example` and provision the approved
import snapshots described below before starting the app.

```bash
npm ci
npm run build
npm run dev              # site at http://localhost:3000
npm test                 # pipeline unit tests
npm test -w web          # website unit tests
npm test --prefix viewer # stage viewer unit tests
```

`/stage` (the LED-wall stage viewer) is a committed static build. Browsing uses
the Supabase public configuration in `web/.env.local`; `/admin` also needs
`ADMIN_PASSWORD` (and `ADMIN_COOKIE_INSECURE=1` for localhost over http) plus
server-only Supabase admin configuration in `web/.env.local`. To edit the viewer
itself, run `npm ci --prefix viewer`, then `npm run build --prefix viewer` and
`npm run build:imported --prefix viewer` to update both committed static builds.

### Local preview of staging

`main` incorporates the full staging application from
`codex/imported-production-catalog` at revision `a016772`, plus the legacy MMM
import work. The public launch-page branch `agent/studio-coming-soon` is not the
full product baseline.

Use staging's public Supabase URL and anon/publishable key in `web/.env.local`.
Set `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to keep authentication callbacks
local. For catalog assets with `/media/` paths, set `NEXT_PUBLIC_MEDIA_BASE_URL`
to the staging Supabase Storage `plate-previews` public bucket URL. This override
does not change already-hosted URLs or the composite-media rewrite.

Imported detail pages additionally require the matching approved JSON snapshots
under `web/public/media/imported-catalog/<release>/`. These runtime files are
provisioned from staging and remain ignored by Git. On the staging server the
source directory is
`/srv/platelab-coolify/public-media/imported-catalog/`. Ask the deployment
maintainer for read access or a snapshot archive; preserve its release directory
and filenames. The app validates snapshot identity and approval against each
catalog record. See [the imported catalog runbook](docs/runbooks/imported-catalog.md).
Composite videos stream through
the existing `/composite-review/media/` rewrite in `web/next.config.mjs`.

Run the quick-start commands above.
The app runs locally against staging data; this is not an offline database copy.
No admin or service-role key is required to browse published clips.

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
8. **upload** — local (`web/public/media/`), S3 (private vault bucket for
   originals, public bucket for renditions), or Hippius S3-compatible storage
9. **publish** — schema-validated Supabase upsert when `CATALOG_BACKEND=supabase`;
   otherwise an atomic write to the local JSON compatibility catalog

The website uses Supabase even when the CLI's JSON compatibility backend is
selected. For a connected ingest environment, configure `CATALOG_BACKEND`,
`SUPABASE_URL` and a server-only service-role key as described in the
[catalog cutover runbook](docs/runbooks/catalog-supabase-cutover.md). Do not run
demo ingestion against shared staging just to set up a local preview.

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

### Hippius upload

The pipeline reads root `.env.local` before uploading. To send MMM output to
Hippius, set:

```bash
HIPPIUS_BUCKET=your-bucket
HIPPIUS_ACCESS_KEY=...
HIPPIUS_SECRET=...
```

With `HIPPIUS_BUCKET` present, upload defaults to `hippius` mode. Optional
overrides: `HIPPIUS_ENDPOINT_URL` (defaults to `https://s3.hippius.com`) and
`HIPPIUS_REGION` (defaults to `decentralized`). The upload stage still shells
out to the AWS CLI.

## Pricing

$8,000 per stitched minute, prorated per second after a 1-minute minimum
(`shared/src/pricing.ts`). Custom volumetric-stage delivery is a quote CTA.

## Deploy

Coolify deployments select their own branches. As verified on 2026-10-24,
staging runs `codex/imported-production-catalog` and the public coming-soon site
runs `agent/studio-coming-soon`. Merging the shared product into `main` does not
change those deployment selections. Coordinate deployment-branch changes
separately, preserving the media mount, database configuration and staging gate.

[The July deployment notes](docs/2026-07-22-deploy-coolify.md) are historical;
their statement that the public app tracks `main` no longer describes the
current deployment.
