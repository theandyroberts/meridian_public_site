# The Plate Lab — Public Site & Ingest Pipeline Design

2026-06-10 · v1

## What this is

The Plate Lab is the storefront for 360×180 driving-plate environments captured by the
Spheris 9-camera array (Meridian Live Stitch). Art directors browse, preview, reserve,
rent, and buy footage. This repo holds the public site, the shared catalog schema, and
the backend ingest pipeline that turns a capture-day drop into a secure, sellable
catalog entry.

Success metric: how fast an art director can find a plate that fits their brief.
Everything serves search/filter speed and preview fidelity.

## Brand (from platelab-brand-kit.pdf)

- Colors: Ink `#0E0E10`, Paper `#F4F1EA`, Horizon Orange `#C56B3E` (single rare accent),
  Signal Grey `#8A8780`. Dark UI preferred.
- Type: grotesk for display/body (Hanken Grotesk), spaced uppercase mono for labels,
  tags, and data (IBM Plex Mono).
- Mark: wireframe globe, orange horizon line, warm wires above the horizon.
  No shadows/glows/gradients on the mark; orange is the only accent anywhere.

## Capture facts the catalog reflects (from spheris-smart-stitch-live, reference only)

- 9 cameras: horizontal ring A–F (RED Komodo 6K, Laowa 12mm), sky tier G/H/J (Laowa 9mm).
- 9-grid display order is Drew's spec: `J G H / F A B / C D E` (sky top, front middle).
- Stitched master: 3840×1920 equirectangular ProRes, 23.98 fps. Per-camera 6K R3D
  originals exist; color pipeline is Log3G10 / REDWideGamutRGB.
- Telemetry: u-blox F9R (RTK GNSS + fused IMU). NAV-PVT position/velocity, NAV-ATT
  attitude, ESF-INS fused inertial. IMU presence is a per-plate badge and filter.
- Calibration is PTGui `.pts` with a `spheris` extension block; rig name (e.g. Mercy01)
  travels into plate metadata.

## Architecture

```
meridian_public_site/
├── shared/        catalog schema (TS types + validation) used by pipeline and web
├── pipeline/      ingest CLI: drop folder → catalog entry + renditions + upload
├── web/           Next.js site: home, browse, plate detail
├── sample-data/   demo drops + generated catalog (media files gitignored)
└── docs/specs/    this document
```

TypeScript end to end so the catalog schema is one set of types. ffmpeg/ffprobe do all
media work. No database for v1: the catalog is a schema-validated `catalog.json`
artifact published by the pipeline and statically imported by the site. The schema is
deliberately flat so a later Postgres migration is a column-per-field exercise.

## SKU format

`PL<yy><jjj>-<nnnn>` — e.g. `PL26161-0042`: capture year + Julian day + 4-digit clip
sequence within that shoot day. Deterministic from shoot date + sequence,
collision-checked against the existing catalog at ingest.

## Catalog entry (per plate)

- Identity: `sku`, `title`, `description` (generated, human-editable), `shootDate`, `rig`.
- Media: duration, fps 23.98, stitched resolution 3840×1920 + camera-original specs,
  color (`Log3G10 / RWG`, 12-bit ProRes 4444 master), formats list.
- Discovery: `shotType` (highway/urban/residential/tunnel/bridge/coastal/rural),
  `timeOfDay`, `weather`, `season`, `speedBand`, free `tags[]`,
  `objects[]` `{label, confidence}` from the vision labeling run.
- Location: place name + `gps` {start, end, simplified path, avg/max speed, source
  "u-blox F9R RTK"} and `imu` {collected, source "F9R ESF-INS", rateHz}.
- Stage compatibility badges: LED Volume, Green Screen, Projection.
- Pricing: $8,000 per stitched minute, prorated per second after a 1-minute minimum;
  total precomputed per plate. "Custom built for your volumetric stage" is a quote CTA,
  not a SKU price.
- Commerce state: `available | reserved | licensed | exclusive-sold`.
- Security: sha256 of originals, watermarked preview paths only. Original media paths
  never appear in the catalog.

## Ingest pipeline (`pipeline/`, CLI: `platelab ingest <drop-dir>`)

Stages, each idempotent, with a JSONL audit log:

1. **discover** — find stitched master, per-camera proxies, telemetry sidecar, `.pts`.
2. **probe** — ffprobe → duration/fps/resolution/codec; reject malformed drops.
3. **sku** — generate + collision-check.
4. **checksum** — sha256 every original.
5. **telemetry** — parse GPS/IMU JSON sidecar; compute speed stats + simplified path.
6. **label** — sample frames via ffmpeg → vision labeler. Pluggable: Anthropic vision
   (claude-haiku) when `ANTHROPIC_API_KEY` is set, deterministic stub otherwise, so the
   pipeline runs offline and in CI.
7. **describe** — title/description/tags from metadata + labels (Claude or template).
8. **renditions** — watermarked 960-wide preview MP4s (stitched + 9 per-camera tiles,
   SKU + PLATE LAB burn-in, diagonal wash), poster JPEG, all via ffmpeg.
9. **upload** — `local` mode copies renditions into `web/public/media/<sku>/` for the
   demo; `s3` mode puts originals in a private bucket and renditions in a public one.
   Originals are never written anywhere web-served.
10. **publish** — validate against the shared schema, atomic write to `catalog.json`.

Screening access to full-res originals is by HMAC-signed expiring URL
(`pipeline/src/sign.ts`), verified server-side; the web demo includes the verify route.

## Web (`web/`, Next.js App Router + TypeScript, hand-rolled CSS tokens)

- `/` — hero with panoramic stitched strip, value props ($8k/min pro-stitched, custom
  volumetric delivery), featured plates.
- `/browse` — the core page. Filter rail: shot type, time of day, weather, location,
  speed band, IMU-collected, stage compatibility, object tags; instant client-side
  filtering over the static catalog; result cards with poster, SKU, key specs.
- `/plate/[sku]` — stitched preview as master player; 9-grid (`J G H / F A B / C D E`)
  frame-synced to it (drift-corrected `currentTime` follower loop, all tiles muted);
  spec table; tag chips that link back into browse filters; GPS path drawn as inline
  SVG with start/end + speed stats; IMU badge; pricing block (duration × $8k/min) with
  reserve/license CTAs hitting a demo `/api/reserve` route (JSONL log).

## Demo data

`sample-data/` ships 6 synthetic drops (ffmpeg-generated stitched + 9 tiles, distinct
palettes/locations, ~10 s each) with synthetic F9R-style telemetry JSON, so the whole
pipeline → site path runs end to end on a laptop with no real footage and no API keys.

## Out of scope for v1 (documented so nobody wonders)

Payments, auth/accounts, Postgres, real R3D handling, server-side search, CMS. The
schema and pipeline stage boundaries are designed so each bolts on without rework.
