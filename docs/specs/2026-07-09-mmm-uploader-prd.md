# PRD-lite: MMM → The Plate Lab Website Uploader

**Audience:** the agent/engineer building the uploader inside Meridian Media
Manager (MMM, macOS app in `spheris-smart-stitch-live`).
**Status of the receiving side:** TPL's ingest system is **built, deployed,
and production-verified**. This document is the complete client contract —
nothing on the server side is pending.

## 1. What you are building

After Stock Pre-Export Review, MMM already plans a **website handoff
package** (`MeridianWebsiteHandoffBuilder` / `MeridianStockWebsitePackage`,
schemas `spheris.stock.website_handoff.v1` and
`spheris.stock.website_package.v1`). You are building the piece that moves
that package to The Plate Lab and tracks the result:

1. Write the handoff root to disk (builder output, one root per export).
2. **Announce** it to TPL's API.
3. **rsync** the root to TPL's inbox over SSH.
4. Signal **uploaded**.
5. **Poll** until every clip is terminal; surface per-clip results
   (drafted + retail SKU + preview link, or failure reason) in the MMM UI.

MMM must not mark the upload complete until TPL acknowledges (step 5) —
TPL's dashboard is the single source of truth for handoff status.

## 2. Endpoints & credentials

| | Production | Dev/demo box |
|---|---|---|
| API base | `https://theplatelab.site` | `https://platelab.note15.com` |
| rsync target | `ubuntu@51.81.202.126` | `andy@143.244.188.235` |

- **API auth:** `Authorization: Bearer <PLATELAB_INGEST_TOKEN>` on every call.
- **Transport auth:** SSH private key (`mmm_ingest_key`, ed25519). The key is
  jailed server-side: it can ONLY rsync into the ingest inbox — no shell, no
  other paths. Get both secrets from Andy out-of-band; same values work on
  both boxes today. Store them in MMM's config, not in the repo.
- **Build/test against the dev box first**; production only for the final
  acceptance pass.

## 3. Package requirements (what TPL verifies)

The handoff root you rsync must match the builder's layout exactly:

```
<handoffRoot>/
  website_handoff_manifest.json          spheris.stock.website_handoff.v1
  clips/<CLIP-ID-token>/
    metadata/<token>.website.json        spheris.stock.website_package.v1
    assets/<token>__NN_<role>.<ext>
```

Hard requirements enforced server-side:

1. **Every asset must have `checksum_sha256` (hex64) and
   `checksum_verified: true`.** A clip with a missing/unverified/mismatched
   checksum fails — sibling clips still ingest. (The current
   `MeridianStockWebsiteAsset` model allows null checksums; the uploader
   must guarantee they are computed and verified before announce.)
2. **Supported `selected_publish_asset_type`:**
   `captured_nine_camera_feeds` and `rebuilt_nine_camera_proxies` (full
   ingest; camera_number 1–9 maps to array positions A…J), and
   `captured_live_stitch` (ingested as stitched-only).
   `captured_nine_grid` is **rejected** in v1 (`unsupported_asset_type`);
   `unavailable` fails with `no_publishable_asset`. Don't ship those
   expecting success.
3. **Stock clip IDs** are preserved verbatim and become the permanent
   library↔catalog link. Hyphenated location slugs (`SAN-FRANCISCO`,
   `PRIVATE-001`) are fully supported.
4. Only confirmed-**Keep** clips belong in `clips/`; excluded clips listed in
   `excluded_clips` are echoed back in status as `state: "excluded"`.

Nice-to-have (TPL consumes them when present, ignores absence):
- GPS/IMU telemetry export per clip (the badge stays dark without it).
- The day's PTGui `.pts` stitch file.

## 4. The wire protocol

### 4.1 Announce

```
POST {base}/api/ingest/handoffs
Authorization: Bearer <token>
Content-Type: application/json

{ "handoffId": "SPH-STK-20260708-GLENDORA-001-web",
  "bytes": 38000000000,          // total size of the handoff root
  "manifestSha256": "<hex64 of website_handoff_manifest.json>",
  "clipCount": 12 }

201 → { "transferId": "t-4f9609f9" }
400   invalid body (handoffId must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$ —
      it becomes the inbox directory name)
401   bad/missing token
409   this handoffId is already active or already ingested
507   server disk can't take the transfer right now — retry later, do NOT rsync
```

Re-announcing a handoffId whose previous transfer **failed** is allowed and
replaces the failed record (that's the retry path).

### 4.2 Transfer

```
rsync -az -e "ssh -i <mmm_ingest_key> -o IdentitiesOnly=yes" \
  <handoffRoot>/  <user>@<host>:<handoffId>/
```

- The jail drops you inside the inbox — the destination path is just
  `<handoffId>/` (relative), and it MUST equal the announced `handoffId`.
- **⚠️ macOS gotcha:** the stock `/usr/bin/rsync` on modern macOS is
  **openrsync and does NOT work** against the server's rrsync jail
  ("invalid rsync-command syntax"). Bundle or require real rsync ≥3.x
  (`brew install rsync`, typically `/opt/homebrew/bin/rsync`). Detect and
  hard-fail with a clear message if only openrsync is available.
- rsync is resumable: on interruption, just run it again before signaling
  uploaded.
- Send **one handoff root per shoot** as a single rsync job. If you
  parallelize anything, cap concurrency at 2–4 (shared uplink; >10
  simultaneous SSH connections can trip the server's connection throttle).

### 4.3 Done sending

```
POST {base}/api/ingest/handoffs/{transferId}/uploaded
200 → { "ok": true }
409   transfer is not awaiting upload (already signaled, or failed)
```

Only signal this after rsync exits 0.

### 4.4 Poll

```
GET {base}/api/ingest/handoffs/{transferId}

200 → {
  "transferId": "t-…",
  "handoffId": "…",
  "state": "announced" | "uploaded" | "verifying" | "ingesting"
         | "complete" | "failed",
  "error":  { "code": "manifest"|"checksum"|"daemon", "message": "…" },   // when failed
  "clips": [ {
     "stockClipId": "SPH-STK-…-CLIP-0001",
     "state": "queued"|"verifying"|"ingesting"|"draft"|"failed"|"excluded",
     "sku": "PL-4839208",                                   // once assigned
     "preview": "/plate/PL-4839208?exp=…&sig=…",            // signed, ~7-day expiry
     "error": { "stage": "checksum"|"unsupported_asset_type"|
                "no_publishable_asset"|"duplicate"|"ingest", "message": "…" }
  } ] }
```

- Poll every 10–30 s. Terminal states: transfer `complete` or `failed`;
  clip `draft`, `failed`, or `excluded`.
- **Persist the returned `sku` against the stockClipId in MMM's library
  index** — the pair `{stockClipId, sku}` is the definitive linkage. The SKU
  is opaque (`PL-` + 7 digits, the last one a check digit); never parse
  meaning out of it.
- `preview` is a signed link (prepend the API base). It shows the
  watermarked draft page; drafts are otherwise invisible on the public site
  until a human publishes them from TPL's admin dashboard.
- Handoff-level `failed` (bad manifest / package): fix, re-announce the same
  handoffId, re-rsync, re-signal. Clip-level `failed`: surfaced in MMM UI;
  remediation happens on TPL's dashboard (retry) or via a fresh handoff.
- `duplicate` means that stockClipId is already in the catalog — MMM should
  treat this as "already delivered", not an error to retry.

## 5. UX requirements (MMM side)

- Per-handoff progress: announced → transferring (rsync progress) →
  server-processing (per-clip states from polling) → done summary
  (`11 drafted, 1 failed`).
- Per-clip results persisted: stockClipId, sku, preview URL, failure
  stage+message.
- A handoff/clip must be re-sendable from the UI after failure.
- Never delete local source data based on upload success; drafts still await
  human review on TPL.

## 6. Acceptance test (definition of done)

Run against the **dev box** end to end:

1. Export a real (or synthetic) 2-clip handoff where clip 2 uses asset type
   `unavailable`.
2. Announce → rsync → uploaded → poll to terminal.
3. Expect: transfer `complete`; clip 1 `draft` with a `PL-\d{7}` sku and a
   working preview link (HTTP 200, watermarked page); clip 2 `failed` with
   stage `no_publishable_asset`.
4. Corrupt one asset file (append a byte after checksumming) and repeat with
   a fresh handoffId: expect that clip `failed` stage `checksum`, siblings
   unaffected.
5. Re-send test: kill rsync mid-transfer, rerun rsync, signal uploaded —
   expect normal completion (resume works).
6. Announce the same handoffId again after success: expect `409`.

TPL's admin dashboard (`{base}/admin/handoffs`) shows every transfer and
clip — use it to cross-check what your client displays. When all six pass on
the dev box, run 1–3 once against production and have a human verify the
draft on `https://theplatelab.site/admin/drafts`, then reject it.

## 7. Reference

- TPL-side design (authoritative contract):
  `meridian_public_site/docs/specs/2026-07-08-mmm-ingest-handoff-design.md`
- Manifest/package schemas TPL validates against (zod mirrors of the Swift
  encoders): `meridian_public_site/shared/src/handoff.ts`
- A working synthetic-handoff generator you can port for tests:
  `meridian_public_site/pipeline/test/helpers/makeHandoff.ts`
