# MMM → TPL Ingest Handoff — Design

**Date:** 2026-07-08
**Status:** Approved for planning
**Participants:** Andy Roberts, Drew Roberts

## Purpose

The Meridian Media Manager (MMM, runs in the studio) organizes a shoot day's
output and lets the operator cull and select takes for the public catalog.
This design specifies how MMM hands selected clips to The Plate Lab (TPL, runs
on a VPS) and how TPL ingests, stages, and publishes them.

**Scope:** preview-grade handoff only. A drop is 9× 1080p camera proxies +
telemetry + shoot metadata + the day's PTGui stitch file. Full-resolution
production media never travels this path — masters stay on the studio server
and ship to customers separately.

## Key decisions

| Decision | Choice |
| --- | --- |
| Transport | rsync over SSH into a server inbox (Approach 1) — resumable, no upload code |
| Coordination | announce → upload → poll handshake via a small HTTP API |
| Identity | MMM's **library serial number** is the handoff key; TPL assigns the SKU and returns the `{librarySerial, sku}` pair. The catalog entry stores the serial permanently — the definitive library↔catalog link, owned by MMM. |
| Publish gate | Plates land as **draft**; team is notified; a human publishes |
| Compute | Ingest (transcode, labeling, renditions) runs on the TPL server; VPS is right-sized for it (see Sizing) |
| Masters | Out of scope; studio server (S3-compatible cloud storage later as the business grows) |

## Flow

```
MMM (studio)                              TPL (VPS)
─────────────                             ─────────
POST /api/ingest/transfers  ──────────▶   record created: state=announced
  {librarySerial, bytes, sha256}  ◀────   {transferId}
rsync <package>.tar ──────────────────▶   ingest-inbox/incoming/
POST …/transfers/:id/uploaded ────────▶   state=uploaded
GET  …/transfers/:id  (poll) ◀────────    verifying → ingesting → draft|failed
                                          daemon: checksum ✓ → unpack →
                                          existing pipeline → catalog (draft)
                                          → notify team → archive package
```

Example exchange:

> MMM: "Announcing `LIB-2026-0714-T14`, 4.2 GB, sha256 `ab12…`" → TPL: "transfer `t-0042`, send when ready."
> MMM rsyncs, then: "done sending `t-0042`."
> MMM polls: `verifying` → `ingesting` → `draft`, `{librarySerial: "LIB-2026-0714-T14", sku: "PL26189-0003", preview: "/plate/PL26189-0003?sig=…"}`

## Components

### 1. Ingest API (three routes on the existing Next app)

- `POST /api/ingest/transfers` — announce. Body: `{librarySerial, bytes,
  sha256, clips}`. Returns `{transferId}`. Rejects (`507`) when free disk
  < 2.5× announced bytes.
- `POST /api/ingest/transfers/:id/uploaded` — explicit "done sending" signal.
  Explicit beats file-watch heuristics for detecting a completed rsync.
- `GET /api/ingest/transfers/:id` — status: one of `announced | uploaded |
  verifying | ingesting | draft | failed`, plus `sku` and a signed preview URL
  once assigned, plus structured `{stage, message}` on failure.

Auth: single bearer token over HTTPS. Server side it lives in
`/home/andy/.platelab-env` (outside the repo, same as the screener secret);
MMM holds it in its config. One client — no user management needed.

### 2. Package format

One `.tar` per clip (media is already compressed — no gzip), named
`<librarySerial>.tar`, containing the existing drop contract:

```
manifest.json          per-file sha256s, librarySerial, packageVersion: 1
cam_A..J.(mov|mp4)     9× 1080p proxies (existing discover-stage conventions)
telemetry.json         F9R GPS/IMU sidecar
meta.json              operator shoot metadata (existing dropMetaSchema)
                       + mmm: { librarySerial, batchId? }
*.pts                  PTGui stitch file from the shoot day (optional)
```

The `mmm` block is carried verbatim onto the catalog entry by the publish
stage. The catalog schema (`shared/`) gains `mmm.librarySerial` (required for
new entries) and `status: "draft" | "live"`.

### 3. Transport

rsync over SSH to `ingest-inbox/incoming/` using a dedicated key for the MMM
machine, restricted with `rrsync` to the inbox directory only (same
restricted-key philosophy as the CD deploy key). Retries are cheap: rsync
resumes partial transfers; a re-announce of the same `librarySerial` after a
failure is idempotent (replaces the failed transfer record).

### 4. Ingest daemon (`platelab-ingestd`)

New long-running process at `pipeline/src/daemon.ts`, run under pm2 in the
same repo and deployed by the same CD pipeline. Loop, one transfer at a time
(transcode is CPU-bound):

1. Pick up the oldest `uploaded` transfer.
2. `verifying` — sha256 the package, compare to the announcement. Mismatch →
   `failed(checksum)`.
3. Unpack to a work dir; verify per-file manifest checksums.
4. `ingesting` — run the **existing ingest pipeline unchanged**
   (discover → probe → SKU → checksum → telemetry → label → describe →
   renditions → upload → publish), publishing with `status: "draft"`.
5. Record `{librarySerial, sku}` on the transfer; state → `draft`.
6. Notify the team; move the package to `archive/` (retained 14 days, then
   pruned); clean the work dir.

Transfer state is one JSON file per transfer under
`sample-data/transfers/`, updated by atomic rename (write temp + rename). The
API routes and daemon share it through the filesystem — no database at this
volume. The daemon catches up on restart; nothing is lost if it is down while
packages arrive.

### 5. Draft → live

- Public site (home, browse, plate detail) filters to `status: "live"`.
- Drafts are viewable via signed preview links (reuse the existing HMAC
  screener pattern), included in the notification.
- Approval UI: `/admin/drafts` — lists pending plates with watermarked preview
  and generated title/description, with **Publish** and **Reject** actions.
  Access via HMAC-signed expiring links (the existing screener mechanism);
  the notification message carries a fresh link. Reject moves the entry out
  of the catalog and records why.
- CLI fallback: `npx -w pipeline tsx src/cli.ts approve <sku>` /
  `reject <sku>`.

### 6. Notification

Pluggable notify hook fired on `draft` and on `failed`. V1: **email to the
team** with title, SKU, library serial, preview link, and approve link; falls
back to a log line when unconfigured. SMTP settings live in
`/home/andy/.platelab-env` alongside the other secrets. The hook is one
module — other channels (Telegram, etc.) can be added later.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Checksum mismatch (package or file) | `failed(checksum)`; package kept in `failed/`; MMM re-announces and re-sends |
| Pipeline stage error | `failed(stage, message)`; package kept in `failed/`; publish is atomic so nothing half-appears |
| Disk low at announce | `507` at announce time — MMM never starts a doomed upload |
| Daemon down during upload | Transfers are files; daemon catches up on restart |
| Duplicate `librarySerial` announce | Idempotent: replaces a `failed` record; rejected (`409`) if the serial already reached `draft`/live |

Every daemon action appends to the existing `sample-data/audit.jsonl` chain of
custody.

## Server sizing

Ingest of 1080p proxies is CPU-bound (ffmpeg renditions). Target: **4 vCPU /
8 GB RAM / 160 GB disk** (upgrade of the current 1 vCPU / 2 GB / 48 GB box, or
a dedicated instance). Disk math: 2–4 GB per package × 2.5 working overhead ×
14-day archive at several shoots/week stays comfortably under 100 GB.

## Testing

- Unit: manifest verification, transfer state machine, announce/uploaded/status
  routes (auth, disk guard, idempotency).
- Integration: end-to-end sample package through daemon → draft entry in a
  temp catalog, using the existing synthetic demo footage.
- Manual acceptance: real package from MMM through to a published plate.

## Out of scope (explicitly)

- Production/master media movement and customer fulfillment.
- S3 vault migration (the daemon consumes an inbox; whether packages arrive by
  rsync or a future bucket-sync does not change its design).
- Multi-tenant auth on the ingest API.
