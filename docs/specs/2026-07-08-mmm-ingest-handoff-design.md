# MMM → TPL Ingest Handoff — Design

**Date:** 2026-07-08 (amended 2026-07-09 after review of the MMM handoff
contract in `spheris-smart-stitch-live` PR #79)
**Status:** Approved for planning
**Participants:** Andy Roberts, Drew Roberts

## Purpose

The Meridian Media Manager (MMM, runs in the studio) organizes a shoot day's
output and lets the operator cull and select takes for the public catalog.
This design specifies how MMM hands selected clips to The Plate Lab (TPL, runs
on a VPS) and how TPL ingests, stages, and publishes them.

**Scope:** preview-grade handoff only. A clip's website deliverable is 9×
1080p camera feeds (or MMM's defined fallbacks) + GPS/IMU telemetry + stock
metadata. Full-resolution production media never travels this path — masters
stay on the studio server and ship to customers separately.

**Source contract:** MMM's side of this handoff is defined in
`spheris-smart-stitch-live` (`docs/MERIDIAN_MEDIA_MANAGER_FEATURE_SPEC.md`,
`docs/STOCK_CAPTURE_NAMING_CONTRACT.md`,
`Sources/…/MeridianWebsiteHandoffBuilder.swift`,
`Sources/…/MeridianStockWebsitePackage.swift`). TPL consumes MMM's handoff
format natively — MMM does not repackage for TPL.

## Key decisions

| Decision | Choice |
| --- | --- |
| Transport | rsync over SSH into a server inbox (Approach 1) — resumable, no upload code |
| Coordination | announce → upload → poll handshake via a small HTTP API; MMM does not mark upload complete until TPL acknowledges (per MMM feature spec) |
| Identity | MMM's **`stockClipId`** (e.g. `SPH-STK-20260708-GLENDORA-001-CLIP-0001`) is the immutable library key. TPL assigns an **opaque retail SKU** and returns the `{stockClipId, sku}` pair. |
| SKU scheme | **Opaque random + check digit** — `PL-<6 random digits><Damm check digit>` (e.g. `PL-4839208`), base drawn uniformly from 100000–999999, collision-checked, never reused. No dates, locations, or take identity encoded — and no sequence: sequential serials leak catalog size and growth rate to anyone who sees two SKUs (the German tank problem). The trailing Damm check digit catches any single mistyped digit and any adjacent transposition, so a fat-fingered SKU is rejected instead of resolving to the wrong plate. **This replaces TPL's current `PL<yy><jjj>-<nnnn>` scheme**, which encodes year/julian-day and violates the no-magic-numbers rule for the retail site. The `stockClipId` on the catalog entry carries all provenance. |
| Package shape | MMM's **day-level handoff root** (`spheris.stock.website_handoff.v1`) transferred as-is; TPL adapts internally |
| Publish gate | Plates land as **draft**; team is notified by email; a human publishes |
| Compute | Ingest (transcode, labeling, renditions) runs on the TPL server; VPS is right-sized for it (see Sizing) |
| Masters | Out of scope; studio server (S3-compatible cloud storage later as the business grows) |

## Flow

```
MMM (studio)                              TPL (VPS)
─────────────                             ─────────
POST /api/ingest/handoffs  ───────────▶   record created: state=announced
  {handoffId, bytes, manifestSha256,   ◀── {transferId}
   clipCount}
rsync handoff root/ ──────────────────▶   ingest-inbox/incoming/<handoffId>/
POST …/handoffs/:id/uploaded ─────────▶   state=uploaded
GET  …/handoffs/:id  (poll) ◀─────────    per-clip: verifying → ingesting →
                                          draft|failed|excluded
                                          daemon: verify manifest+checksums →
                                          adapt clip → existing pipeline →
                                          catalog (draft) → email team →
                                          archive handoff
```

Example exchange:

> MMM: "Announcing handoff `SPH-STK-20260708-GLENDORA-001-web`, 38 GB,
> 12 clips, manifest sha256 `ab12…`" → TPL: "transfer `t-0042`, send when
> ready."
> MMM rsyncs the handoff root, then: "done sending `t-0042`."
> MMM polls: per-clip states, finishing at e.g.
> `{stockClipId: "SPH-STK-20260708-GLENDORA-001-CLIP-0001", sku: "PL-4839208",
> state: "draft", preview: "/plate/PL-4839208?sig=…"}`

## Components

### 1. Ingest API (three routes on the existing Next app)

- `POST /api/ingest/handoffs` — announce. Body: `{handoffId, bytes,
  manifestSha256, clipCount}`. Returns `{transferId}`. Rejects (`507`) when
  free disk minus **reserved space** < 2.5× announced bytes, where reserved
  space = the summed bytes of every announced-but-not-yet-archived transfer.
  Counting in-flight reservations closes the check-then-act race when several
  announces arrive within seconds (a burst all seeing the same free-disk
  number and all passing).
- `POST /api/ingest/handoffs/:id/uploaded` — explicit "done sending" signal.
  Explicit beats file-watch heuristics for detecting a completed rsync.
- `GET /api/ingest/handoffs/:id` — status. Overall state plus a per-clip
  array: `{stockClipId, state, sku?, preview?, error?}` where state is one of
  `queued | verifying | ingesting | draft | failed | excluded` (excluded =
  listed in MMM's `excluded_clips`, echoed back for completeness).

Auth: single bearer token over HTTPS. Server side it lives in
`/home/andy/.platelab-env` (outside the repo, same as the screener secret);
MMM holds it in its config. One client — no user management needed.

### 2. Package format (MMM-native)

TPL ingests MMM's website handoff layout exactly as
`MeridianWebsiteHandoffBuilder` produces it:

```
<handoff root>/
  website_handoff_manifest.json     schema spheris.stock.website_handoff.v1
  clips/
    <CLIP-ID-token>/
      metadata/<token>.website.json schema spheris.stock.website_package.v1
      assets/<token>__NN_<role>.mov
```

Per-clip metadata carries: `stock_clip_id`, `selected_publish_asset_type`,
assets (role, `camera_number`, sha256, verified flag), `gps_imu_availability`,
operator tags/notes, fallback reason, and source-take info (job ID,
roll/clip, timecodes, duration).

**Asset types** (`selected_publish_asset_type`), per MMM's priority order:

| Type | TPL handling |
| --- | --- |
| `captured_nine_camera_feeds` / `rebuilt_nine_camera_proxies` | Full ingest. Adapter maps `camera_number` 1–9 → array positions A,B,C,D,E,F,G,H,J (fixed topology) to satisfy the pipeline's camera conventions. |
| `captured_live_stitch` | Ingest as stitched-master-only drop. The discover stage is relaxed to accept a stitched master with zero camera files (renditions already prefer the stitched master when present; the 9-tile view is simply absent). |
| `captured_nine_grid` | **Rejected in v1** — `failed(unsupported_asset_type)`. Rare fallback, poor preview source; revisit if it occurs in practice. |
| `unavailable` | `failed(no_publishable_asset)`, echoing MMM's fallback_reason. |

**Requirements enforced at verify time:** every asset must have
`checksum_sha256` present and `checksum_verified: true` (per MMM's own spec:
"checksums for every uploaded or packaged asset"). Missing/unverified →
that clip fails; the rest of the handoff proceeds.

**Optional inputs:** GPS/IMU telemetry export (consumed when present and
`gps_imu_availability` says usable; plate simply gets no telemetry badge
otherwise) and the day's PTGui `.pts` file. Neither blocks ingest.

### 3. Identity & SKU

- `stockClipId` is stored verbatim on the catalog entry (`mmm.stockClipId`,
  required for new entries) — the permanent library↔catalog link. Duplicate
  `stockClipId` ingest is rejected (`409`) once a clip has reached draft/live.
- TPL assigns the retail SKU at ingest: a 6-digit random base (uniform in
  100000–999999) plus a trailing **Damm check digit** computed over the base —
  7 digits total, e.g. base `483920` → `PL-4839208`. Collision-checked against
  every SKU ever issued — including rejected/removed plates, so identifiers
  are never recycled. The issued-SKU ledger lives with the catalog data and
  survives redeploys. 900k identifiers is decades of headroom; widen the base
  if the space ever tightens.
- Every surface that accepts a typed SKU (search, admin actions, CLI, future
  order entry) validates the check digit before lookup and rejects invalid
  SKUs outright — a mistyped SKU errors instead of silently resolving to the
  wrong plate. The Damm implementation lives in `shared/` next to the SKU
  generator so validation and generation cannot drift.
- The catalog schema (`shared/`) gains `mmm.stockClipId`, the new SKU format,
  and `status: "draft" | "live"`. The existing demo plates (old
  `PL<yy><jjj>-<nnnn>` SKUs) are demo data — regenerate or renumber; no
  migration path needed.

### 4. Transport

rsync over SSH of the handoff root into
`ingest-inbox/incoming/<handoffId>/`, using a dedicated key for the MMM
machine, restricted with `rrsync` to the inbox directory only (same
restricted-key philosophy as the CD deploy key). Retries are cheap: rsync
resumes partial transfers; re-announcing the same `handoffId` after a failure
is idempotent (replaces the failed transfer record).

### 5. Ingest daemon (`platelab-ingestd`)

New long-running process at `pipeline/src/daemon.ts`, run under pm2 in the
same repo and deployed by the same CD pipeline. Loop, one clip at a time
(transcode is CPU-bound):

1. Pick up the oldest `uploaded` handoff.
2. `verifying` — parse `website_handoff_manifest.json` (validate against the
   `spheris.stock.website_handoff.v1` schema), verify every clip asset's
   sha256. Per-clip failures don't block sibling clips.
3. Per clip, oldest first:
   a. **Adapt** — translate the MMM clip package into the pipeline's drop
      shape (camera number→position mapping, asset-type handling per the
      table above; synthesize the pipeline's shoot metadata from
      `stock_catalog` fields, the job-ID location slug, capture date →
      season, and operator tags; the AI labeling stage fills the rest from
      frames as it already does).
   b. **Ingest** — run the existing pipeline (probe → checksum → telemetry →
      label → describe → renditions → upload → publish) with
      `status: "draft"` and the new SKU assignment.
   c. Record `{stockClipId, sku}`; clip state → `draft`.
4. Email the team one summary per handoff (clips drafted, failures, preview +
   approve links); move the handoff to `archive/` (retained 14 days, then
   pruned); clean work dirs.

Transfer state is one JSON file per handoff under `sample-data/transfers/`,
updated by atomic rename (write temp + rename). The API routes and daemon
share it through the filesystem — no database at this volume. The daemon
catches up on restart; nothing is lost if it is down while packages arrive.

### 6. Draft → live

- Public site (home, browse, plate detail) filters to `status: "live"`.
- Drafts are viewable via signed preview links (reuse the existing HMAC
  screener pattern), included in the notification email.
- Approval UI: `/admin/drafts` — lists pending plates with watermarked preview
  and generated title/description, with **Publish** and **Reject** actions.
  Access via HMAC-signed expiring links; the email carries a fresh link.
  Reject moves the entry out of the catalog and records why.
- CLI fallback: `npx -w pipeline tsx src/cli.ts approve <sku>` /
  `reject <sku>`.

### 7. Notification

Pluggable notify hook fired per handoff completion (drafts + failures in one
summary) and on handoff-level failure. V1: **email to the team**; SMTP
settings live in `/home/andy/.platelab-env`; falls back to a log line when
unconfigured. The hook is one module — other channels can be added later.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Manifest invalid / package sha mismatch | handoff `failed(manifest)`; kept in `failed/`; MMM re-announces and re-sends |
| Asset checksum missing, unverified, or mismatched | that clip `failed(checksum)`; siblings proceed |
| Unsupported asset type (`captured_nine_grid`, `unavailable`) | clip `failed(unsupported_asset_type | no_publishable_asset)` with MMM's fallback_reason echoed |
| Pipeline stage error | clip `failed(stage, message)`; publish is atomic so nothing half-appears |
| Disk low at announce | `507` at announce time — MMM never starts a doomed upload |
| Daemon down during upload | Transfers are files; daemon catches up on restart |
| Duplicate `handoffId` announce | Idempotent: replaces a `failed` record; `409` if already ingested |
| Duplicate `stockClipId` (across handoffs) | Clip `failed(duplicate)` — `409` semantics; the existing plate wins |

Every daemon action appends to the existing `sample-data/audit.jsonl` chain of
custody.

## Concurrency (end-of-shoot burst)

MMM finishes review/selection and may kick off many transfers within seconds.
The design handles the burst without special cases:

- Announces are per-transfer state files written by atomic rename — no shared
  mutable state, safe under any number of simultaneous announces. The disk
  guard counts in-flight reservations (above), so a burst cannot collectively
  over-commit the disk.
- The daemon intentionally serializes ingest (one clip at a time — transcode
  is CPU-bound); a burst simply builds a FIFO queue with per-clip status
  visible throughout. SKU assignment and catalog publish are single-writer by
  construction.
- **Preferred MMM shape: one day-level handoff root per shoot** (one announce,
  one rsync) — the burst collapses into a single orderly transfer. If MMM
  instead sends per-clip transfers in parallel, it should cap upload
  concurrency at 2–4: parallel rsyncs share the studio uplink and finish no
  sooner beyond that, and >10 simultaneous fresh SSH connections can trip
  sshd's default `MaxStartups` throttle.

## Flagged back to MMM (PR #79 follow-ups, not TPL blockers)

1. The feature spec promises "accompanying GPS/IMU data exports" in the
   website package, but `MeridianStockWebsitePackage` currently carries only
   the availability *state* — no telemetry file asset. TPL treats telemetry
   as optional; the GPS/IMU badge only lights up once MMM ships the export.
2. The PTGui `.pts` stitch file is in the archive lane but not the website
   package. Small and useful (preview re-stitching); worth adding.
3. `checksum_sha256` is nullable in the model; TPL requires present +
   verified, matching MMM's own spec text.

## Server sizing

Ingest of 1080p proxies is CPU-bound (ffmpeg renditions). Target: **4 vCPU /
8 GB RAM / 160 GB disk** (upgrade of the current 1 vCPU / 2 GB / 48 GB box, or
a dedicated instance). Disk math: a 12-clip day at 2–4 GB/clip ≈ 25–50 GB in
flight × 2.5 working overhead fits; archives prune at 14 days. Right-size the
disk to the expected shoot cadence before first real use.

## Testing

- Unit: handoff manifest validation, camera number→position adapter,
  asset-type routing, SKU counter, transfer state machine,
  announce/uploaded/status routes (auth, disk guard, idempotency, duplicate
  stockClipId).
- Integration: synthetic MMM handoff root (built to the v1 schemas) through
  daemon → draft entries in a temp catalog.
- Manual acceptance: real handoff from MMM through to a published plate.

## Out of scope (explicitly)

- Production/master media movement and customer fulfillment.
- S3 vault migration (the daemon consumes an inbox; whether packages arrive by
  rsync or a future bucket-sync does not change its design).
- Multi-tenant auth on the ingest API.
- `captured_nine_grid` ingest support (revisit if the fallback occurs in
  practice).
