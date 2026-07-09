# MMM → TPL Ingest Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MMM uploads a shoot day's website handoff to TPL; a daemon verifies, ingests, and stages plates as drafts; an admin dashboard is the single source of truth for status and publishing.

**Architecture:** MMM rsyncs its `spheris.stock.website_handoff.v1` root into a server inbox after an announce/uploaded/poll handshake over three API routes. A pm2 daemon (`platelab-ingestd`) adapts each clip package into the existing pipeline's drop shape and runs the existing stages, publishing `status:"draft"` entries with opaque `PL-<7 digits>` SKUs (random + Damm check digit). `/admin` renders the same transfer-state files the API serves. Spec: `docs/specs/2026-07-08-mmm-ingest-handoff-design.md`.

**Tech Stack:** TypeScript, Next.js 15 (app router), zod, node:test via tsx, ffmpeg, nodemailer, pm2.

## Global Constraints

- SKU format: `PL-` + 6 random digits (base uniform in 100000–999999) + 1 Damm check digit. Regex `^PL-\d{7}$`. Never reused; ledger survives redeploys.
- MMM package schemas are fixed by PR #79: `spheris.stock.website_handoff.v1` and `spheris.stock.website_package.v1`, snake_case JSON.
- Camera number → array position: `1→A, 2→B, 3→C, 4→D, 5→E, 6→F, 7→G, 8→H, 9→J`.
- Asset types: nine feeds/proxies → full ingest; `captured_live_stitch` → stitched-only ingest; `captured_nine_grid` → fail `unsupported_asset_type`; `unavailable` → fail `no_publishable_asset`.
- Every asset requires `checksum_sha256` present and `checksum_verified: true`.
- Publish gate: new plates land `status: "draft"`; public site shows only `"live"`.
- Disk guard at announce: `free − Σ(bytes of non-terminal transfers) ≥ 2.5 × announced bytes`, else 507.
- One clip ingests at a time (daemon serializes).
- Secrets live in env (`/home/andy/.platelab-env` on the server): `PLATELAB_INGEST_TOKEN`, `ADMIN_PASSWORD`, `PLATELAB_SCREENER_SECRET`, `SMTP_URL`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM`.
- All ingest actions append to `sample-data/audit.jsonl`.
- Tests: `node:test` via `tsx --test` (existing pattern in `pipeline/test/units.test.ts`).
- Run all commands from repo root (`meridian_public_site/`) unless stated.

## File Structure

```
shared/src/sku.ts                     REWRITE: Damm + opaque random SKU
shared/src/catalog.ts                 MODIFY: sku regex, status, mmm, optional gps/speedBand
shared/src/handoff.ts                 NEW: zod schemas for MMM package formats
shared/src/server/transferStore.ts    NEW: transfer state files (fs; server-only export)
shared/package.json                   MODIFY: add "./server" export
pipeline/src/paths.ts                 MODIFY: env overrides + inbox/archive/ledger paths
pipeline/src/mmm/skuLedger.ts         NEW: issued-SKU ledger + assignment
pipeline/src/mmm/verify.ts            NEW: manifest parse + checksum verification
pipeline/src/mmm/adapter.ts           NEW: MMM clip package → pipeline Drop
pipeline/src/daemon.ts                NEW: platelab-ingestd loop
pipeline/src/notify.ts                NEW: email notification hook
pipeline/src/ingest.ts                MODIFY: split ingestDiscovered(drop, opts)
pipeline/src/stages/discover.ts       MODIFY: allow stitched-only drops
pipeline/src/cli.ts                   MODIFY: approve/reject/retry commands
web/lib/catalog.ts                    MODIFY: mtime cache, live filter, SKU validation
web/lib/ingest/paths.ts               NEW: repo-root paths from web cwd
web/lib/ingest/auth.ts                NEW: bearer token check
web/lib/ingest/announce.ts            NEW: pure announce validation + disk guard math
web/lib/admin/session.ts              NEW: password login + HMAC session cookie
web/app/api/ingest/handoffs/route.ts              NEW: POST announce
web/app/api/ingest/handoffs/[id]/route.ts         NEW: GET status
web/app/api/ingest/handoffs/[id]/uploaded/route.ts NEW: POST done-sending
web/app/admin/login/page.tsx          NEW
web/app/admin/handoffs/page.tsx       NEW: transfer list
web/app/admin/handoffs/[id]/page.tsx  NEW: per-clip detail + retry/re-verify
web/app/admin/drafts/page.tsx         NEW: publish/reject queue
web/app/admin/actions.ts              NEW: server actions
web/app/page.tsx, browse/page.tsx, plate/[sku]/page.tsx  MODIFY: live filter + dynamic
pipeline/test/sku.test.ts, handoff.test.ts, transferStore.test.ts,
  adapter.test.ts, daemon.test.ts     NEW tests
pipeline/test/helpers/makeHandoff.ts  NEW: synthetic MMM handoff fixture (ffmpeg)
web/test/ingest.test.ts               NEW + web test script
```

---

### Task 1: Opaque SKU with Damm check digit (`shared/src/sku.ts`)

**Files:**
- Rewrite: `shared/src/sku.ts`
- Test: `pipeline/test/sku.test.ts`
- Modify: `pipeline/test/units.test.ts` (delete the two old SKU tests)

**Interfaces:**
- Produces: `dammCheckDigit(digits: string): number`, `makeRandomSku(rng?: () => number): string`, `isValidSku(sku: string): boolean`, `SKU_REGEX: RegExp`. Old `makeSku`/`nextSequence`/`julianDay` are deleted; Task 4 removes their last callers.

- [ ] **Step 1: Write the failing test**

Create `pipeline/test/sku.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { dammCheckDigit, makeRandomSku, isValidSku, SKU_REGEX } from "@platelab/shared";

test("damm check digit: known values and self-check property", () => {
  // Verified against the standard Damm quasigroup table.
  assert.equal(dammCheckDigit("483920"), 8);
  assert.equal(dammCheckDigit("100000"), 2);
  assert.equal(dammCheckDigit("999999"), 0);
  // Appending the check digit always yields interim digit 0.
  for (const base of ["483920", "100000", "999999", "572431"]) {
    assert.equal(dammCheckDigit(base + String(dammCheckDigit(base))), 0);
  }
  assert.throws(() => dammCheckDigit("12a4"));
  assert.throws(() => dammCheckDigit(""));
});

test("makeRandomSku: format, range, deterministic with injected rng", () => {
  const sku = makeRandomSku(() => 0.5);
  assert.match(sku, SKU_REGEX);
  // rng 0.5 → base 100000 + floor(0.5*900000) = 550000; damm(550000) computed by lib
  assert.equal(sku.slice(0, 9), `PL-550000`.slice(0, 9));
  assert.equal(isValidSku(sku), true);
});

test("isValidSku: rejects bad check digit, transpositions, format", () => {
  assert.equal(isValidSku("PL-4839208"), true);
  assert.equal(isValidSku("PL-4839207"), false); // wrong check digit
  assert.equal(isValidSku("PL-4893208"), false); // adjacent transposition
  assert.equal(isValidSku("PL-483920"), false);  // 6 digits
  assert.equal(isValidSku("PL26161-0042"), false); // legacy format
  assert.equal(isValidSku("pl-4839208"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx -w pipeline tsx --test test/sku.test.ts`
Expected: FAIL — `dammCheckDigit` is not exported.

- [ ] **Step 3: Rewrite `shared/src/sku.ts`**

Replace the entire file:

```ts
/**
 * Retail SKU: "PL-" + 6 random digits + 1 Damm check digit → PL-4839208.
 * Opaque by design: no dates, locations, or sequence (sequential serials
 * leak catalog size/growth — German tank problem). The Damm check digit
 * catches any single mistyped digit and any adjacent transposition; every
 * surface that accepts a typed SKU must call isValidSku() before lookup.
 */

export const SKU_REGEX = /^PL-\d{7}$/;

// Damm quasigroup table (standard, weakly totally anti-symmetric).
const DAMM: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

export function dammCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error(`digits only: "${digits}"`);
  let interim = 0;
  for (const ch of digits) interim = DAMM[interim][Number(ch)];
  return interim;
}

/** Random SKU. Inject rng for tests; collision checking is the ledger's job. */
export function makeRandomSku(rng: () => number = Math.random): string {
  const base = 100000 + Math.floor(rng() * 900000); // 100000..999999
  return `PL-${base}${dammCheckDigit(String(base))}`;
}

export function isValidSku(sku: string): boolean {
  if (!SKU_REGEX.test(sku)) return false;
  return dammCheckDigit(sku.slice(3)) === 0;
}
```

- [ ] **Step 4: Delete the old SKU tests from `pipeline/test/units.test.ts`**

Remove the two tests `"sku format and julian day"` and `"sku sequence collision check"` and remove `makeSku, nextSequence,` from its import list.

- [ ] **Step 5: Run tests**

Run: `npx -w pipeline tsx --test test/sku.test.ts test/units.test.ts`
Expected: sku.test.ts PASS. units.test.ts PASS (remaining tests). The workspace won't compile-fail yet — `pipeline/src/ingest.ts` still imports `makeSku`/`nextSequence`, which now don't exist; that breaks `npm run build`/ingest until Task 4. That's expected mid-plan; tasks land on a branch (see Task 15).

- [ ] **Step 6: Commit**

```bash
git add shared/src/sku.ts pipeline/test/sku.test.ts pipeline/test/units.test.ts
git commit -m "feat(shared): opaque random SKU with Damm check digit"
```

---

### Task 2: Catalog schema v2 — status, mmm linkage, optional gps

**Files:**
- Modify: `shared/src/catalog.ts`
- Modify: `web/components/GpsPanel.tsx` call site in `web/app/plate/[sku]/page.tsx` (conditional render)
- Modify: `web/components/BrowseClient.tsx` (speedBand filter handles undefined)
- Test: `pipeline/test/units.test.ts` (add schema test)

**Interfaces:**
- Produces on `plateSchema`: `sku` matches `SKU_REGEX`; `status: "draft" | "live"` (defaults `"live"` when absent so nothing else needs migration); `mmm?: { stockClipId: string }`; `gps` optional; `speedBand` optional.

- [ ] **Step 1: Write the failing test** (append to `pipeline/test/units.test.ts`)

```ts
import { plateSchema } from "@platelab/shared";

test("plate schema v2: opaque sku, status default, mmm block, optional gps", () => {
  const base = {
    sku: "PL-4839208",
    title: "t", description: "d", shootDate: "2026-07-08", rig: "Mercy01",
    media: { durationSec: 10, fps: 23.98, stitchedResolution: "3840x1920",
      colorPipeline: "c", masterFormat: "m", cameraOriginals: "o" },
    shotType: "urban", timeOfDay: "day", weather: "clear", season: "summer",
    tags: [], objects: [],
    location: { name: "n", city: "c", region: "r", country: "US" },
    imu: { collected: false },
    stageCompat: ["led-volume"], availability: "available",
    pricing: { perMinuteUsd: 8000, totalUsd: 8000, minimumMinutes: 1 },
    renditions: { stitchedPreview: "/m/s.mp4", cameraPreviews: {}, poster: "/m/p.jpg" },
    security: { masterSha256: "a".repeat(64), watermarked: true },
    ingestedAt: "2026-07-08T00:00:00Z",
  };
  const parsed = plateSchema.parse({ ...base, mmm: { stockClipId: "SPH-STK-20260708-GLENDORA-001-CLIP-0001" } });
  assert.equal(parsed.status, "live"); // default for legacy entries
  assert.equal(parsed.mmm?.stockClipId.startsWith("SPH-STK"), true);
  assert.equal(parsed.gps, undefined); // gps now optional
  assert.throws(() => plateSchema.parse({ ...base, sku: "PL26161-0042" }));
  assert.throws(() => plateSchema.parse({ ...base, sku: "PL-4839207" })); // bad check digit is format-valid; regex passes — see refine
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx -w pipeline tsx --test test/units.test.ts`
Expected: FAIL — old sku regex rejects `PL-4839208`.

- [ ] **Step 3: Modify `shared/src/catalog.ts`**

In `plateSchema` replace/add these fields (rest unchanged):

```ts
import { isValidSku } from "./sku";

export const PLATE_STATUS = ["draft", "live"] as const;

// inside plateSchema:
  sku: z.string().refine(isValidSku, "invalid SKU (format or check digit)"),
  status: z.enum(PLATE_STATUS).default("live"),
  /** Definitive library↔catalog link. MMM's immutable stock clip ID. */
  mmm: z.object({ stockClipId: z.string().min(1) }).optional(),
  // gps + speedBand become optional (MMM telemetry export not shipped yet):
  gps: gpsSchema.optional(),
  speedBand: z.enum(SPEED_BANDS).optional(),
```

Add exported type: `export type PlateStatus = (typeof PLATE_STATUS)[number];`

- [ ] **Step 4: Guard the two UI consumers of the now-optional fields**

`web/app/plate/[sku]/page.tsx` — find the `<GpsPanel` usage and wrap: `{plate.gps && <GpsPanel gps={plate.gps} … />}` (match the existing props). Where `plate.speedBand` renders as text, fall back: `{plate.speedBand ?? "—"}`.
`web/components/BrowseClient.tsx` — in `matches()`, the line `if (f.speedBand && p.speedBand !== f.speedBand) return false;` already handles `undefined` correctly (undefined ≠ selected band → filtered out). No change needed; verify by reading.

- [ ] **Step 5: Run tests**

Run: `npx -w pipeline tsx --test test/units.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/catalog.ts web/app/plate/\[sku\]/page.tsx web/components/BrowseClient.tsx pipeline/test/units.test.ts
git commit -m "feat(shared): catalog schema v2 — opaque SKUs, draft/live status, mmm linkage, optional gps"
```

---

### Task 3: SKU ledger (never reuse an identifier)

**Files:**
- Create: `pipeline/src/mmm/skuLedger.ts`
- Modify: `pipeline/src/paths.ts`
- Test: `pipeline/test/skuLedger.test.ts`

**Interfaces:**
- Consumes: `makeRandomSku(rng)` from Task 1.
- Produces: `assignSku(opts?: { rng?: () => number }): string` — generates, collision-checks against the ledger, appends, returns. Ledger file: `SKU_LEDGER` path (JSON `{ "issued": string[] }`). `loadLedger(): string[]`.
- Paths: `pipeline/src/paths.ts` gains `export const SKU_LEDGER` and honors `process.env.PLATELAB_ROOT` for all paths (tests point it at a temp dir).

- [ ] **Step 1: Modify `pipeline/src/paths.ts`** (env override first — the test needs it)

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (meridian_public_site). Override with PLATELAB_ROOT in tests/daemon. */
export const ROOT = process.env.PLATELAB_ROOT ?? path.resolve(here, "..", "..");
export const SAMPLE_DATA = path.join(ROOT, "sample-data");
export const DROPS_DIR = path.join(SAMPLE_DATA, "drops");
export const AUDIT_LOG = path.join(SAMPLE_DATA, "audit.jsonl");
export const TRANSFERS_DIR = path.join(SAMPLE_DATA, "transfers");
export const CATALOG_PATH = path.join(ROOT, "web", "data", "catalog.json");
export const SKU_LEDGER = path.join(ROOT, "web", "data", "sku-ledger.json");
/** Public renditions root — ONLY watermarked previews/posters may land here. */
export const PUBLIC_MEDIA = path.join(ROOT, "web", "public", "media");
/** MMM handoff inbox/archive (daemon-owned). */
export const INGEST_INBOX = path.join(ROOT, "ingest-inbox");
export const INBOX_INCOMING = path.join(INGEST_INBOX, "incoming");
export const INBOX_ARCHIVE = path.join(INGEST_INBOX, "archive");
export const INBOX_FAILED = path.join(INGEST_INBOX, "failed");
```

Note: `PLATELAB_ROOT` is read at import time — tests must set it **before** importing (use dynamic `import()` after setting env).

- [ ] **Step 2: Write the failing test**

Create `pipeline/test/skuLedger.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("sku ledger: assigns, persists, never reuses, retries collisions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-ledger-"));
  process.env.PLATELAB_ROOT = root;
  const { assignSku, loadLedger } = await import("../src/mmm/skuLedger.js");

  const a = assignSku({ rng: () => 0.5 }); // deterministic base 550000
  assert.match(a, /^PL-\d{7}$/);
  assert.deepEqual(loadLedger(), [a]);

  // Same rng would collide → assignSku must advance to a different SKU.
  let calls = 0;
  const b = assignSku({ rng: () => (calls++ < 1 ? 0.5 : 0.6) });
  assert.notEqual(b, a);
  assert.deepEqual(loadLedger(), [a, b]);

  // Ledger survives re-import (persisted to disk).
  const raw = JSON.parse(fs.readFileSync(path.join(root, "web/data/sku-ledger.json"), "utf8"));
  assert.deepEqual(raw.issued, [a, b]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx -w pipeline tsx --test test/skuLedger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `pipeline/src/mmm/skuLedger.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { makeRandomSku } from "@platelab/shared";
import { SKU_LEDGER } from "../paths.js";

/**
 * Every SKU ever issued, including rejected/removed plates — identifiers are
 * never recycled (old invoices/links must never resolve to a different
 * plate). Single-writer: only the daemon (or CLI) assigns SKUs.
 */

export function loadLedger(): string[] {
  if (!fs.existsSync(SKU_LEDGER)) return [];
  return JSON.parse(fs.readFileSync(SKU_LEDGER, "utf8")).issued as string[];
}

function saveLedger(issued: string[]): void {
  fs.mkdirSync(path.dirname(SKU_LEDGER), { recursive: true });
  const tmp = SKU_LEDGER + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ issued }, null, 2));
  fs.renameSync(tmp, SKU_LEDGER);
}

export function assignSku(opts: { rng?: () => number } = {}): string {
  const issued = loadLedger();
  const taken = new Set(issued);
  for (let i = 0; i < 10_000; i++) {
    const sku = makeRandomSku(opts.rng);
    if (!taken.has(sku)) {
      issued.push(sku);
      saveLedger(issued);
      return sku;
    }
  }
  throw new Error("SKU space exhausted — widen the base (see spec)");
}
```

- [ ] **Step 5: Run tests** — `npx -w pipeline tsx --test test/skuLedger.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/paths.ts pipeline/src/mmm/skuLedger.ts pipeline/test/skuLedger.test.ts
git commit -m "feat(pipeline): issued-SKU ledger with collision-checked random assignment"
```

---

### Task 4: Pipeline refactor — stitched-only drops, injected SKU/status, demo regen

**Files:**
- Modify: `pipeline/src/stages/discover.ts` (allow stitched-only)
- Modify: `pipeline/src/ingest.ts` (split; use ledger; status param)
- Modify: `pipeline/src/stages/publish.ts` (no change needed — verify)
- Modify: `pipeline/src/stages/renditions.ts` + `pipeline/src/stages/upload.ts` (tolerate missing cameras — inspect and guard iteration)
- Test: `pipeline/test/discover.test.ts`
- Regenerate: `web/data/catalog.json` + `web/public/media/` (demo data, new SKUs)

**Interfaces:**
- Consumes: `assignSku` (Task 3), `PlateStatus` (Task 2).
- Produces: `discover(dir)` returns `Drop` where `cameraFiles: Partial<Record<CameraId, string>>`; throws unless (all 9 cameras) OR (stitched master present). `ingestDrop(dropDir, opts?)` and new `ingestDiscovered(drop: Drop, opts?: IngestOpts)` where `IngestOpts = { sku?: string; status?: PlateStatus; stockClipId?: string }` (defaults: ledger-assigned SKU, `status: "live"` for the legacy CLI path). Plate gets `status`, `mmm: { stockClipId }` when provided, and `gps`/`speedBand` omitted when no telemetry (see below).
- `Drop.telemetryPath` becomes optional (`string | undefined`); when absent, plate has `imu: { collected: false }`, no `gps`, no `speedBand`.

- [ ] **Step 1: Write the failing test**

Create `pipeline/test/discover.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discover } from "../src/stages/discover.js";

const META = JSON.stringify({
  shootDate: "2026-07-08", rig: "Mercy01",
  location: { name: "n", city: "c", region: "r", country: "US" },
  timeOfDay: "day", weather: "clear", season: "summer", shotType: "urban",
  stageCompat: ["led-volume"], sceneHints: [],
});

function makeDir(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-drop-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f), "x");
  fs.writeFileSync(path.join(dir, "meta.json"), META);
  return dir;
}

test("discover: stitched-only drop is accepted (no cameras, no telemetry)", () => {
  const dir = makeDir(["stitched.mov"]);
  const drop = discover(dir);
  assert.equal(drop.stitchedMaster, path.join(dir, "stitched.mov"));
  assert.deepEqual(drop.cameraFiles, {});
  assert.equal(drop.telemetryPath, undefined);
});

test("discover: no stitched master and missing cameras still throws", () => {
  const dir = makeDir(["cam_A.mov", "cam_B.mov"]);
  assert.throws(() => discover(dir), /missing cameras/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx -w pipeline tsx --test test/discover.test.ts`
Expected: FAIL — stitched-only currently throws `missing cameras` and `missing telemetry.json`.

- [ ] **Step 3: Modify `pipeline/src/stages/discover.ts`**

Change the `Drop` interface and the completeness/telemetry checks:

```ts
export interface Drop {
  dir: string;
  stitchedMaster?: string;
  /** Partial when the drop is stitched-only (MMM live-stitch fallback). */
  cameraFiles: Partial<Record<CameraId, string>>;
  telemetryPath?: string;
  calibrationPath?: string;
  meta: DropMeta;
}
```

In `discover()`: after collecting `cameraFiles`/`missing`, replace the throw with:

```ts
  // A drop is ingestible with all 9 cameras, or with a stitched master alone
  // (MMM captured_live_stitch fallback — no per-camera previews).
  if (missing.length > 0 && Object.keys(cameraFiles).length > 0 && !stitchedMaster) {
    throw new Error(`${dir}: missing cameras ${missing.join(",")}`);
  }
  if (missing.length === CAMERA_IDS.length && !stitchedMaster) {
    throw new Error(`${dir}: no media — need 9 cameras or a stitched master`);
  }
```

And make telemetry optional: `const telemetryPath = findOne(dir, ["telemetry.json"]);` — delete the throw; pass `telemetryPath` through as `string | undefined`.

- [ ] **Step 4: Modify `pipeline/src/ingest.ts`** — full replacement:

```ts
import path from "node:path";
import {
  priceForDuration,
  PER_MINUTE_USD,
  MINIMUM_MINUTES,
  type Plate,
  type PlateStatus,
} from "@platelab/shared";
import { audit } from "./audit.js";
import { PUBLIC_MEDIA } from "./paths.js";
import { discover, type Drop } from "./stages/discover.js";
import { probe } from "./stages/probe.js";
import { sha256File } from "./stages/checksum.js";
import { loadTelemetry } from "./stages/telemetry.js";
import { labelDrop } from "./stages/label.js";
import { describePlate } from "./stages/describe.js";
import { buildRenditions } from "./stages/renditions.js";
import { uploadRenditions } from "./stages/upload.js";
import { publishPlate } from "./stages/publish.js";
import { assignSku } from "./mmm/skuLedger.js";

export interface IngestOpts {
  sku?: string;
  status?: PlateStatus;
  stockClipId?: string;
}

export async function ingestDrop(dropDir: string, opts: IngestOpts = {}): Promise<Plate> {
  return ingestDiscovered(discover(dropDir), opts);
}

/**
 * Ingest one discovered drop end to end. Stages are sequential and each is
 * audited; a failure leaves the catalog untouched (publish is last + atomic).
 */
export async function ingestDiscovered(drop: Drop, opts: IngestOpts = {}): Promise<Plate> {
  const t0 = Date.now();
  audit("ingest.start", { dropDir: drop.dir });

  const masterFile = drop.stitchedMaster ?? drop.cameraFiles.A;
  if (!masterFile) throw new Error(`${drop.dir}: no master (stitched or cam A)`);
  const probed = await probe(masterFile);
  audit("ingest.probe", { dropDir: drop.dir, ...probed });

  const sku = opts.sku ?? assignSku();
  const status = opts.status ?? "live";
  audit("ingest.sku", { dropDir: drop.dir, sku, status });

  const masterSha256 = await sha256File(masterFile);
  audit("ingest.checksum", { sku, masterSha256 });

  const telemetry = drop.telemetryPath ? loadTelemetry(drop.telemetryPath) : undefined;
  const labels = await labelDrop(masterFile, probed.durationSec, drop.meta);
  audit("ingest.label", { sku, labeler: labels.labeler, count: labels.objects.length });

  const described = await describePlate(
    drop.meta,
    labels,
    telemetry ?? { gps: undefined, imu: { collected: false }, speedBand: undefined },
    probed.durationSec,
  );
  audit("ingest.describe", { sku, describer: described.describer });

  const renditions = await buildRenditions(drop, sku, path.join(PUBLIC_MEDIA, sku));
  const uploaded = await uploadRenditions(sku, renditions, [
    ...(drop.stitchedMaster ? [drop.stitchedMaster] : []),
    ...Object.values(drop.cameraFiles).filter((f): f is string => !!f),
  ]);
  audit("ingest.upload", { sku, mode: uploaded.mode });

  const plate: Plate = {
    sku,
    status,
    ...(opts.stockClipId ? { mmm: { stockClipId: opts.stockClipId } } : {}),
    title: described.title,
    description: described.description,
    shootDate: drop.meta.shootDate,
    rig: drop.meta.rig,
    media: {
      durationSec: Math.round(probed.durationSec * 100) / 100,
      fps: probed.fps,
      stitchedResolution: "3840x1920",
      colorPipeline: "Log3G10 / REDWideGamutRGB",
      masterFormat: drop.stitchedMaster
        ? "ProRes 4444 12-bit equirect"
        : "ProRes 4444 12-bit equirect · pro stitch on delivery",
      cameraOriginals: "9x RED Komodo 6K R3D",
      timecode: drop.meta.timecode,
    },
    shotType: drop.meta.shotType,
    timeOfDay: drop.meta.timeOfDay,
    weather: drop.meta.weather,
    season: drop.meta.season,
    ...(telemetry ? { speedBand: telemetry.speedBand, gps: telemetry.gps } : {}),
    tags: labels.tags,
    objects: labels.objects,
    location: drop.meta.location,
    imu: telemetry ? telemetry.imu : { collected: false },
    stageCompat: drop.meta.stageCompat,
    availability: "available",
    pricing: {
      perMinuteUsd: PER_MINUTE_USD,
      totalUsd: priceForDuration(probed.durationSec),
      minimumMinutes: MINIMUM_MINUTES,
    },
    renditions: {
      stitchedPreview: uploaded.stitchedPreviewUrl,
      cameraPreviews: uploaded.cameraPreviewUrls,
      poster: uploaded.posterUrl,
    },
    security: { masterSha256, watermarked: true },
    ingestedAt: new Date().toISOString(),
  };

  publishPlate(plate);
  audit("ingest.done", { sku, ms: Date.now() - t0 });
  return plate;
}
```

Note: `describePlate`'s telemetry parameter type — check its signature in `pipeline/src/stages/describe.ts`; if it types the summary strictly, widen that parameter to accept `{ gps?: …; imu: …; speedBand?: … }`. Same for the template it renders (speed text falls back to omitting the speed clause when `speedBand` is undefined).

- [ ] **Step 5: Guard camera iteration in renditions/upload**

Read `pipeline/src/stages/renditions.ts` and `pipeline/src/stages/upload.ts`; wherever they iterate `drop.cameraFiles` or `CAMERA_IDS` expecting 9 entries, iterate `Object.entries(drop.cameraFiles)` instead and skip absent ids. The 6-cam ring pano fallback (used when no stitched master) requires cameras — that path is unreachable for stitched-only drops (master present by definition), but guard with a clear error anyway: `if (!drop.stitchedMaster && !drop.cameraFiles.A) throw new Error("ring pano needs camera files")`.

- [ ] **Step 6: Run all pipeline tests + regenerate demo data**

```bash
npx -w pipeline tsx --test test/*.test.ts        # all PASS
rm -rf web/public/media web/data/catalog.json web/data/sku-ledger.json sample-data/drops sample-data/audit.jsonl
npm run demo:generate && npm run demo:ingest      # regenerates with PL-XXXXXXX SKUs
npm run build                                     # web builds against new catalog
```

Expected: catalog.json now contains 7 plates with `PL-\d{7}` SKUs and `"status": "live"`; build passes.

- [ ] **Step 7: Commit**

```bash
git add pipeline/src web/data/catalog.json pipeline/test/discover.test.ts
git commit -m "feat(pipeline): stitched-only drops, injected SKU/status, ledger-assigned SKUs; regenerate demo catalog"
```

---

### Task 5: MMM handoff schemas (`shared/src/handoff.ts`)

**Files:**
- Create: `shared/src/handoff.ts`
- Modify: `shared/src/index.ts` (add `export * from "./handoff";`)
- Test: `pipeline/test/handoff.test.ts`

**Interfaces:**
- Produces (zod, snake_case keys matching PR #79 Swift encoders): `websitePackageSchema` (`spheris.stock.website_package.v1`), `handoffManifestSchema` (`spheris.stock.website_handoff.v1`), types `WebsitePackage`, `HandoffManifest`, `HandoffClip`, and `CAMERA_NUMBER_TO_POSITION: Record<number, CameraId>`.

- [ ] **Step 1: Write the failing test**

Create `pipeline/test/handoff.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  handoffManifestSchema,
  websitePackageSchema,
  CAMERA_NUMBER_TO_POSITION,
} from "@platelab/shared";

const CLIP_META = {
  schema: "spheris.stock.website_package.v1",
  stock_clip_id: "SPH-STK-20260708-GLENDORA-001-CLIP-0001",
  selected_publish_asset_type: "captured_nine_camera_feeds",
  assets: [
    { role: "captured_camera_feed_01", path: "/src/a.mov", camera_number: 1,
      checksum_sha256: "a".repeat(64), checksum_verified: true },
  ],
  gps_imu_availability: "gps_imu_missing",
  operator_tags: ["KEEP"],
  operator_notes: "",
  fallback_reason: null,
  source_take: {
    mode: "stock", stock_job_id: "SPH-STK-20260708-GLENDORA-001",
    roll_number: 7, clip_number: 48, source_folder_name: "Roll_007_Clip_048",
    timecode_in: "14:32:10:00", timecode_out: "14:34:18:00", clip_count: 3072,
    duration_seconds: 128, raw_ready_for_repackage: true,
    raw_issue_kinds: [], live_asset_issue_kinds: [],
  },
};

test("website package schema parses PR#79 shape", () => {
  const p = websitePackageSchema.parse(CLIP_META);
  assert.equal(p.stock_clip_id, CLIP_META.stock_clip_id);
  assert.throws(() => websitePackageSchema.parse({ ...CLIP_META, schema: "wrong.v9" }));
});

test("handoff manifest parses and camera map is the array topology", () => {
  const m = handoffManifestSchema.parse({
    schema: "spheris.stock.website_handoff.v1",
    handoff_root_path: "/x", clips_root_relative_path: "clips", clips_root_path: "/x/clips",
    clip_count: 1, excluded_clip_count: 1,
    clips: [{
      stock_clip_id: CLIP_META.stock_clip_id, source_folder_name: "Roll_007_Clip_048",
      clip_package_relative_path: "clips/SPH-STK-20260708-GLENDORA-001-CLIP-0001",
      clip_package_path: "/x/clips/SPH-STK-20260708-GLENDORA-001-CLIP-0001",
      metadata_json_file_name: "SPH-STK-20260708-GLENDORA-001-CLIP-0001.website.json",
      metadata_relative_path: "clips/SPH-STK-20260708-GLENDORA-001-CLIP-0001/metadata/SPH-STK-20260708-GLENDORA-001-CLIP-0001.website.json",
      metadata_path: "/x/clips/…/metadata/….website.json",
      selected_publish_asset_type: "captured_nine_camera_feeds",
      gps_imu_availability: "gps_imu_missing", fallback_reason: null,
      metadata: CLIP_META,
      assets: [{ role: "captured_camera_feed_01", camera_number: 1,
        source_path: "/src/a.mov",
        package_relative_path: "clips/…/assets/…__01_captured_camera_feed_01.mov",
        package_path: "/x/clips/…", checksum_sha256: "a".repeat(64), checksum_verified: true }],
    }],
    excluded_clips: [{ stock_clip_id: "SPH-…-CLIP-0002", source_folder_name: "Roll_007_Clip_049",
      reason: "culled", detail: "cull" }],
  });
  assert.equal(m.clips.length, 1);
  assert.equal(CAMERA_NUMBER_TO_POSITION[1], "A");
  assert.equal(CAMERA_NUMBER_TO_POSITION[9], "J");
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx -w pipeline tsx --test test/handoff.test.ts` — FAIL (not exported).

- [ ] **Step 3: Implement `shared/src/handoff.ts`**

```ts
import { z } from "zod";
import { CAMERA_IDS, type CameraId } from "./catalog";

/**
 * MMM website handoff formats, fixed by spheris-smart-stitch-live PR #79
 * (MeridianWebsiteHandoffBuilder / MeridianStockWebsitePackage, snake_case
 * JSON encoders). TPL consumes these verbatim — never redefine them locally.
 */

export const ASSET_TYPES = [
  "captured_nine_camera_feeds",
  "rebuilt_nine_camera_proxies",
  "captured_live_stitch",
  "captured_nine_grid",
  "unavailable",
] as const;

export const GPS_IMU_STATES = [
  "gps_imu_available", "gps_imu_missing", "gps_imu_needs_review",
  "gps_only_available", "imu_only_available",
] as const;

/** MLS camera number (1–9) → Spheris array position letter. */
export const CAMERA_NUMBER_TO_POSITION: Record<number, CameraId> =
  Object.fromEntries(CAMERA_IDS.map((id, i) => [i + 1, id])) as Record<number, CameraId>;

const packageAssetSchema = z.object({
  role: z.string(),
  path: z.string(),
  camera_number: z.number().int().min(1).max(9).nullish(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  checksum_verified: z.boolean(),
});

const sourceTakeSchema = z.object({
  mode: z.string(),
  stock_job_id: z.string().nullish(),
  roll_number: z.number().int().nullish(),
  clip_number: z.number().int().nullish(),
  source_folder_name: z.string(),
  timecode_in: z.string().nullish(),
  timecode_out: z.string().nullish(),
  clip_count: z.number().int().nullish(),
  duration_seconds: z.number(),
  raw_ready_for_repackage: z.boolean(),
  raw_issue_kinds: z.array(z.string()),
  live_asset_issue_kinds: z.array(z.string()),
});

export const websitePackageSchema = z.object({
  schema: z.literal("spheris.stock.website_package.v1"),
  stock_clip_id: z.string().min(1),
  selected_publish_asset_type: z.enum(ASSET_TYPES),
  assets: z.array(packageAssetSchema),
  gps_imu_availability: z.enum(GPS_IMU_STATES),
  operator_tags: z.array(z.string()),
  operator_notes: z.string(),
  fallback_reason: z.string().nullish(),
  source_take: sourceTakeSchema,
});

const handoffAssetSchema = z.object({
  role: z.string(),
  camera_number: z.number().int().min(1).max(9).nullish(),
  source_path: z.string(),
  package_relative_path: z.string(),
  package_path: z.string(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  checksum_verified: z.boolean(),
});

const handoffClipSchema = z.object({
  stock_clip_id: z.string().min(1),
  source_folder_name: z.string(),
  clip_package_relative_path: z.string(),
  clip_package_path: z.string(),
  metadata_json_file_name: z.string(),
  metadata_relative_path: z.string(),
  metadata_path: z.string(),
  selected_publish_asset_type: z.enum(ASSET_TYPES),
  gps_imu_availability: z.enum(GPS_IMU_STATES),
  fallback_reason: z.string().nullish(),
  metadata: websitePackageSchema,
  assets: z.array(handoffAssetSchema),
});

export const handoffManifestSchema = z.object({
  schema: z.literal("spheris.stock.website_handoff.v1"),
  handoff_root_path: z.string(),
  clips_root_relative_path: z.string(),
  clips_root_path: z.string(),
  clip_count: z.number().int().nonnegative(),
  excluded_clip_count: z.number().int().nonnegative(),
  clips: z.array(handoffClipSchema),
  excluded_clips: z.array(z.object({
    stock_clip_id: z.string(),
    source_folder_name: z.string(),
    reason: z.enum(["culled", "undecided", "missing_stock_review"]),
    detail: z.string(),
  })),
});

export type WebsitePackage = z.infer<typeof websitePackageSchema>;
export type HandoffManifest = z.infer<typeof handoffManifestSchema>;
export type HandoffClip = z.infer<typeof handoffClipSchema>;
export type HandoffAssetType = (typeof ASSET_TYPES)[number];
```

Add to `shared/src/index.ts`: `export * from "./handoff";`

- [ ] **Step 4: Run tests** — `npx -w pipeline tsx --test test/handoff.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/handoff.ts shared/src/index.ts pipeline/test/handoff.test.ts
git commit -m "feat(shared): zod schemas for MMM website handoff v1 formats"
```

---

### Task 6: Transfer state store (`@platelab/shared/server`)

**Files:**
- Create: `shared/src/server/transferStore.ts`
- Create: `shared/src/server/index.ts` (`export * from "./transferStore";`)
- Modify: `shared/package.json` (exports map)
- Test: `pipeline/test/transferStore.test.ts`

**Interfaces:**
- Produces (all fs-backed on `<dataDir>/transfers/*.json`, one file per transfer, atomic tmp+rename writes):
  - Types: `TransferState = "announced"|"uploaded"|"verifying"|"ingesting"|"complete"|"failed"`, `ClipState = "queued"|"verifying"|"ingesting"|"draft"|"failed"|"excluded"`, `TransferRecord = { transferId, handoffId, bytes, manifestSha256, clipCount, state, error?: {code, message}, clips: ClipRecord[], announcedAt, uploadedAt?, updatedAt }`, `ClipRecord = { stockClipId, state, sku?, error?: {stage, message} }`.
  - `createTransfer(dir, input: {handoffId, bytes, manifestSha256, clipCount}): TransferRecord` — mints `transferId` (`t-` + 8 hex chars from `crypto.randomBytes`), throws `DuplicateHandoffError` if a non-failed record for `handoffId` exists (replaces a failed one).
  - `getTransfer(dir, id)`, `listTransfers(dir)` (newest first), `updateTransfer(dir, id, patch | (rec) => rec): TransferRecord`.
  - `reservedBytes(dir): number` — Σ bytes of non-terminal (`announced|uploaded|verifying|ingesting`) transfers.
- Note on overall state naming: the spec's status walk ends in `draft|failed` per clip; the **overall** transfer state uses `complete` when every clip is terminal (this refines the spec's shorthand — the API response includes both overall state and per-clip states).

- [ ] **Step 1: Update `shared/package.json` exports**

```json
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server/index.ts"
  }
```

(Server-only code is deliberately NOT in the "." barrel — client components import "." and must never pull `node:fs`.)

- [ ] **Step 2: Write the failing test**

Create `pipeline/test/transferStore.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTransfer, getTransfer, listTransfers, updateTransfer, reservedBytes,
  DuplicateHandoffError,
} from "@platelab/shared/server";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tpl-transfers-"));

test("create/get/list/update round-trip with atomic persistence", () => {
  const dir = tmp();
  const t = createTransfer(dir, {
    handoffId: "SPH-STK-20260708-GLENDORA-001-web",
    bytes: 40_000_000_000, manifestSha256: "b".repeat(64), clipCount: 12,
  });
  assert.match(t.transferId, /^t-[0-9a-f]{8}$/);
  assert.equal(t.state, "announced");
  assert.equal(getTransfer(dir, t.transferId)?.handoffId, t.handoffId);
  const u = updateTransfer(dir, t.transferId, { state: "uploaded" });
  assert.equal(u.state, "uploaded");
  assert.equal(listTransfers(dir)[0].state, "uploaded");
});

test("duplicate handoffId: rejected while active, replaces a failed record", () => {
  const dir = tmp();
  const input = { handoffId: "h1", bytes: 10, manifestSha256: "c".repeat(64), clipCount: 1 };
  const t1 = createTransfer(dir, input);
  assert.throws(() => createTransfer(dir, input), DuplicateHandoffError);
  updateTransfer(dir, t1.transferId, { state: "failed" });
  const t2 = createTransfer(dir, input); // replaces failed
  assert.notEqual(t2.transferId, t1.transferId);
  assert.equal(listTransfers(dir).length, 1);
});

test("reservedBytes sums only non-terminal transfers (burst disk guard)", () => {
  const dir = tmp();
  const a = createTransfer(dir, { handoffId: "a", bytes: 100, manifestSha256: "d".repeat(64), clipCount: 1 });
  const b = createTransfer(dir, { handoffId: "b", bytes: 50, manifestSha256: "e".repeat(64), clipCount: 1 });
  assert.equal(reservedBytes(dir), 150);
  updateTransfer(dir, a.transferId, { state: "complete" });
  assert.equal(reservedBytes(dir), 50);
  updateTransfer(dir, b.transferId, { state: "failed" });
  assert.equal(reservedBytes(dir), 0);
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx -w pipeline tsx --test test/transferStore.test.ts` — FAIL.

- [ ] **Step 4: Implement `shared/src/server/transferStore.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * One JSON file per transfer under <dir>. This is THE single source of
 * truth for handoff status: the daemon writes it, the MMM-facing API and
 * the admin dashboard read it. Writes are atomic (tmp + rename).
 */

export type TransferState =
  | "announced" | "uploaded" | "verifying" | "ingesting" | "complete" | "failed";
export type ClipState =
  | "queued" | "verifying" | "ingesting" | "draft" | "failed" | "excluded";

export interface ClipRecord {
  stockClipId: string;
  state: ClipState;
  sku?: string;
  error?: { stage: string; message: string };
}

export interface TransferRecord {
  transferId: string;
  handoffId: string;
  bytes: number;
  manifestSha256: string;
  clipCount: number;
  state: TransferState;
  error?: { code: string; message: string };
  clips: ClipRecord[];
  announcedAt: string;
  uploadedAt?: string;
  updatedAt: string;
}

export class DuplicateHandoffError extends Error {
  constructor(handoffId: string) { super(`handoff already active: ${handoffId}`); }
}

const NON_TERMINAL: TransferState[] = ["announced", "uploaded", "verifying", "ingesting"];
const file = (dir: string, id: string) => path.join(dir, `${id}.json`);

function write(dir: string, rec: TransferRecord): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file(dir, rec.transferId) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file(dir, rec.transferId));
}

export function getTransfer(dir: string, id: string): TransferRecord | undefined {
  const p = file(dir, id);
  if (!/^t-[0-9a-f]{8}$/.test(id) || !fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8")) as TransferRecord;
}

export function listTransfers(dir: string): TransferRecord[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as TransferRecord)
    .sort((a, b) => b.announcedAt.localeCompare(a.announcedAt));
}

export function createTransfer(
  dir: string,
  input: { handoffId: string; bytes: number; manifestSha256: string; clipCount: number },
): TransferRecord {
  const existing = listTransfers(dir).find((t) => t.handoffId === input.handoffId);
  if (existing && existing.state !== "failed") throw new DuplicateHandoffError(input.handoffId);
  if (existing) fs.rmSync(file(dir, existing.transferId));
  const now = new Date().toISOString();
  const rec: TransferRecord = {
    transferId: `t-${crypto.randomBytes(4).toString("hex")}`,
    ...input,
    state: "announced",
    clips: [],
    announcedAt: now,
    updatedAt: now,
  };
  write(dir, rec);
  return rec;
}

export function updateTransfer(
  dir: string,
  id: string,
  patch: Partial<TransferRecord> | ((rec: TransferRecord) => TransferRecord),
): TransferRecord {
  const rec = getTransfer(dir, id);
  if (!rec) throw new Error(`unknown transfer: ${id}`);
  const next = typeof patch === "function" ? patch(rec) : { ...rec, ...patch };
  next.updatedAt = new Date().toISOString();
  write(dir, next);
  return next;
}

export function reservedBytes(dir: string): number {
  return listTransfers(dir)
    .filter((t) => NON_TERMINAL.includes(t.state))
    .reduce((sum, t) => sum + t.bytes, 0);
}
```

Create `shared/src/server/index.ts`: `export * from "./transferStore";`

- [ ] **Step 5: Run tests** — `npx -w pipeline tsx --test test/transferStore.test.ts` — PASS. Also `npm run build` (web) to confirm the client bundle is unaffected.

- [ ] **Step 6: Commit**

```bash
git add shared/package.json shared/src/server pipeline/test/transferStore.test.ts
git commit -m "feat(shared): transfer state store — the handoff single source of truth"
```

---

### Task 7: Ingest API routes (announce / uploaded / status)

**Files:**
- Create: `web/lib/ingest/paths.ts`, `web/lib/ingest/auth.ts`, `web/lib/ingest/announce.ts`
- Create: `web/app/api/ingest/handoffs/route.ts`
- Create: `web/app/api/ingest/handoffs/[id]/route.ts`
- Create: `web/app/api/ingest/handoffs/[id]/uploaded/route.ts`
- Test: `web/test/ingest.test.ts`; Modify: `web/package.json` (test script + tsx devDep)

**Interfaces:**
- Consumes: transfer store (Task 6).
- Produces HTTP contract (bearer `Authorization: Bearer $PLATELAB_INGEST_TOKEN` on all three):
  - `POST /api/ingest/handoffs` `{handoffId, bytes, manifestSha256, clipCount}` → 201 `{transferId}` | 400 invalid | 401 | 409 duplicate | 507 disk.
  - `POST /api/ingest/handoffs/:id/uploaded` → 200 `{ok:true}` | 404 | 409 (not in `announced` state).
  - `GET /api/ingest/handoffs/:id` → 200 `{transferId, handoffId, state, error?, clips:[{stockClipId,state,sku?,preview?,error?}]}`; `preview` = `/plate/<sku>` for drafted clips (signed preview links come in Task 11).
- Produces for tests/UI: `web/lib/ingest/announce.ts` exports `announceBodySchema` (zod) and `checkDiskGuard(freeBytes, reserved, announced): boolean` (pure).
- `web/lib/ingest/paths.ts` exports `REPO_ROOT` (`process.env.PLATELAB_ROOT ?? path.join(process.cwd(), "..")`), `TRANSFERS_DIR`, `INBOX_INCOMING`.

- [ ] **Step 1: Add web test harness**

`web/package.json`: add `"test": "tsx --test test/*.test.ts"` to scripts and `"tsx": "^4.19.2"` to devDependencies. Run `npm install`.

- [ ] **Step 2: Write the failing test**

Create `web/test/ingest.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { announceBodySchema, checkDiskGuard } from "../lib/ingest/announce";

test("announce body validation", () => {
  const ok = announceBodySchema.safeParse({
    handoffId: "SPH-STK-20260708-GLENDORA-001-web",
    bytes: 1000, manifestSha256: "a".repeat(64), clipCount: 12,
  });
  assert.equal(ok.success, true);
  assert.equal(announceBodySchema.safeParse({ handoffId: "../etc", bytes: 1, manifestSha256: "a".repeat(64), clipCount: 1 }).success, false); // path-unsafe
  assert.equal(announceBodySchema.safeParse({ handoffId: "h", bytes: 0, manifestSha256: "a".repeat(64), clipCount: 1 }).success, false);
  assert.equal(announceBodySchema.safeParse({ handoffId: "h", bytes: 1, manifestSha256: "zz", clipCount: 1 }).success, false);
});

test("disk guard: reservation-aware 2.5x headroom", () => {
  assert.equal(checkDiskGuard(1000, 0, 100), true);   // 1000 ≥ 250
  assert.equal(checkDiskGuard(1000, 800, 100), false); // 200 < 250 after reservations
  assert.equal(checkDiskGuard(260, 0, 100), true);
  assert.equal(checkDiskGuard(240, 0, 100), false);
});
```

- [ ] **Step 3: Run test to verify it fails** — `npm test -w web` — FAIL (module not found).

- [ ] **Step 4: Implement the lib modules**

`web/lib/ingest/paths.ts`:

```ts
import path from "node:path";

/** web/ runs with cwd = web; the repo root is one level up (see pm2 config). */
export const REPO_ROOT = process.env.PLATELAB_ROOT ?? path.join(process.cwd(), "..");
export const TRANSFERS_DIR = path.join(REPO_ROOT, "sample-data", "transfers");
export const INBOX_INCOMING = path.join(REPO_ROOT, "ingest-inbox", "incoming");
```

`web/lib/ingest/auth.ts`:

```ts
import crypto from "node:crypto";

export function checkBearer(req: Request): boolean {
  const token = process.env.PLATELAB_INGEST_TOKEN;
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

`web/lib/ingest/announce.ts`:

```ts
import { z } from "zod";

/** handoffId becomes a directory name in the inbox — path-safe tokens only. */
export const announceBodySchema = z.object({
  handoffId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  bytes: z.number().int().positive(),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  clipCount: z.number().int().positive(),
});

/**
 * Burst-safe disk guard: free space minus bytes already promised to
 * in-flight transfers must cover 2.5x the new announcement.
 */
export function checkDiskGuard(freeBytes: number, reservedBytes: number, announcedBytes: number): boolean {
  return freeBytes - reservedBytes >= 2.5 * announcedBytes;
}
```

- [ ] **Step 5: Run lib tests** — `npm test -w web` — PASS.

- [ ] **Step 6: Implement the three routes**

`web/app/api/ingest/handoffs/route.ts`:

```ts
import fs from "node:fs";
import { NextResponse } from "next/server";
import { createTransfer, reservedBytes, DuplicateHandoffError } from "@platelab/shared/server";
import { checkBearer } from "@/lib/ingest/auth";
import { announceBodySchema, checkDiskGuard } from "@/lib/ingest/announce";
import { TRANSFERS_DIR, INBOX_INCOMING } from "@/lib/ingest/paths";

export async function POST(req: Request) {
  if (!checkBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = announceBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  fs.mkdirSync(INBOX_INCOMING, { recursive: true });
  const free = fs.statfsSync(INBOX_INCOMING).bavail * fs.statfsSync(INBOX_INCOMING).bsize;
  if (!checkDiskGuard(free, reservedBytes(TRANSFERS_DIR), parsed.data.bytes)) {
    return NextResponse.json({ error: "insufficient disk for transfer" }, { status: 507 });
  }
  try {
    const rec = createTransfer(TRANSFERS_DIR, parsed.data);
    return NextResponse.json({ transferId: rec.transferId }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateHandoffError) {
      return NextResponse.json({ error: "handoff already active or ingested" }, { status: 409 });
    }
    throw err;
  }
}
```

`web/app/api/ingest/handoffs/[id]/uploaded/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getTransfer, updateTransfer } from "@platelab/shared/server";
import { checkBearer } from "@/lib/ingest/auth";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const rec = getTransfer(TRANSFERS_DIR, id);
  if (!rec) return NextResponse.json({ error: "unknown transfer" }, { status: 404 });
  if (rec.state !== "announced") {
    return NextResponse.json({ error: `not awaiting upload (state: ${rec.state})` }, { status: 409 });
  }
  updateTransfer(TRANSFERS_DIR, id, { state: "uploaded", uploadedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
```

`web/app/api/ingest/handoffs/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getTransfer } from "@platelab/shared/server";
import { checkBearer } from "@/lib/ingest/auth";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const rec = getTransfer(TRANSFERS_DIR, id);
  if (!rec) return NextResponse.json({ error: "unknown transfer" }, { status: 404 });
  return NextResponse.json({
    transferId: rec.transferId,
    handoffId: rec.handoffId,
    state: rec.state,
    error: rec.error,
    clips: rec.clips.map((c) => ({
      stockClipId: c.stockClipId,
      state: c.state,
      sku: c.sku,
      preview: c.sku ? `/plate/${c.sku}` : undefined,
      error: c.error,
    })),
  });
}
```

- [ ] **Step 7: Smoke-test the routes end to end**

```bash
PLATELAB_INGEST_TOKEN=testtoken npm run dev -w web &   # wait for ready
curl -s -X POST localhost:3000/api/ingest/handoffs -H "Authorization: Bearer testtoken" \
  -H "content-type: application/json" \
  -d '{"handoffId":"h-test","bytes":1000,"manifestSha256":"'"$(printf 'a%.0s' {1..64})"'","clipCount":1}'
# expect: {"transferId":"t-…"} then, with that id:
curl -s -X POST localhost:3000/api/ingest/handoffs/t-XXXXXXXX/uploaded -H "Authorization: Bearer testtoken"
curl -s localhost:3000/api/ingest/handoffs/t-XXXXXXXX -H "Authorization: Bearer testtoken"
# expect state "uploaded"; unauthorized without header (401); kill dev server after
rm sample-data/transfers/t-*.json
```

- [ ] **Step 8: Commit**

```bash
git add web/lib/ingest web/app/api/ingest web/test web/package.json package-lock.json
git commit -m "feat(web): MMM ingest API — announce/uploaded/status with burst-safe disk guard"
```

---

### Task 8: Handoff fixture + verify + adapter

**Files:**
- Create: `pipeline/test/helpers/makeHandoff.ts`
- Create: `pipeline/src/mmm/verify.ts`
- Create: `pipeline/src/mmm/adapter.ts`
- Test: `pipeline/test/adapter.test.ts`

**Interfaces:**
- Consumes: schemas (Task 5), `CAMERA_NUMBER_TO_POSITION`, `Drop` (Task 4), `sha256File` from `pipeline/src/stages/checksum.ts`.
- Produces:
  - `makeHandoff(rootDir, opts: {clips: Array<{stockClipId: string; assetType?: HandoffAssetType; seconds?: number}>}): Promise<void>` — writes a schema-valid handoff root with real tiny videos (ffmpeg 160×80, `-f lavfi testsrc`), correct sha256s, `website_handoff_manifest.json` + per-clip `metadata/*.website.json`.
  - `verifyHandoff(rootDir): Promise<HandoffManifest>` — parses/validates the manifest, sha256s every asset file against `checksum_sha256`; throws `HandoffVerifyError { code: "manifest" | "checksum", detail }`.
  - `adaptClip(rootDir, clip: HandoffClip): AdaptedClip` where `AdaptedClip = { drop: Drop; stockClipId: string }`; throws `ClipAdaptError { stage: "unsupported_asset_type" | "no_publishable_asset", message }` for grid/unavailable.
  - Meta synthesis inside `adaptClip`: `shootDate` from stockClipId (`SPH-STK-YYYYMMDD-…` → `YYYY-MM-DD`), `season` from month (Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall), `location.name`/`city` from the job-ID location slug (title-cased), `region: ""` → use `"CA"`? No — synthesize `{ name: slug, city: slug, region: "", country: "US" }` is invalid (region min length not enforced — zod plain string, empty ok). Use `{ name: <slug title-case>, city: <slug title-case>, region: "—", country: "US" }`; operator review fixes wording at the draft gate. Defaults: `timeOfDay: "day"`, `weather: "clear"`, `shotType: "urban"`, `stageCompat: ["led-volume","green-screen","projection"]`, `sceneHints: operator_tags + operator_notes`, `rig: "Spheris XL 01"`.

- [ ] **Step 1: Write the fixture helper** (`pipeline/test/helpers/makeHandoff.ts`)

```ts
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import type { HandoffAssetType } from "@platelab/shared";

const exec = promisify(execFile);

async function tinyVideo(dest: string, seconds: number): Promise<void> {
  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc=size=160x80:rate=12:duration=${seconds}`,
    "-pix_fmt", "yuv420p", dest]);
}

const sha256 = (p: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

export async function makeHandoff(
  rootDir: string,
  opts: { clips: Array<{ stockClipId: string; assetType?: HandoffAssetType; seconds?: number }> },
): Promise<void> {
  const clips = [];
  for (const c of opts.clips) {
    const assetType = c.assetType ?? "captured_nine_camera_feeds";
    const token = c.stockClipId.replace(/[^A-Za-z0-9_-]/g, "_");
    const clipRel = path.join("clips", token);
    const assetsDir = path.join(rootDir, clipRel, "assets");
    const metaDir = path.join(rootDir, clipRel, "metadata");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(metaDir, { recursive: true });

    const assets = [];
    if (assetType === "captured_nine_camera_feeds" || assetType === "rebuilt_nine_camera_proxies") {
      const prefix = assetType === "captured_nine_camera_feeds" ? "captured_camera_feed" : "rebuilt_camera_proxy";
      for (let n = 1; n <= 9; n++) {
        const role = `${prefix}_${String(n).padStart(2, "0")}`;
        const rel = path.join(clipRel, "assets", `${token}__${String(n).padStart(2, "0")}_${role}.mp4`);
        await tinyVideo(path.join(rootDir, rel), c.seconds ?? 1);
        assets.push({ role, camera_number: n, source_path: `/mmm/${role}.mp4`,
          package_relative_path: rel, package_path: path.join(rootDir, rel),
          checksum_sha256: sha256(path.join(rootDir, rel)), checksum_verified: true });
      }
    } else if (assetType === "captured_live_stitch") {
      const rel = path.join(clipRel, "assets", `${token}__01_captured_live_stitch.mp4`);
      await tinyVideo(path.join(rootDir, rel), c.seconds ?? 1);
      assets.push({ role: "captured_live_stitch", camera_number: null, source_path: "/mmm/ls.mp4",
        package_relative_path: rel, package_path: path.join(rootDir, rel),
        checksum_sha256: sha256(path.join(rootDir, rel)), checksum_verified: true });
    } // captured_nine_grid / unavailable: no assets needed for tests

    const metadata = {
      schema: "spheris.stock.website_package.v1",
      stock_clip_id: c.stockClipId,
      selected_publish_asset_type: assetType,
      assets: assets.map((a) => ({ role: a.role, path: a.source_path, camera_number: a.camera_number,
        checksum_sha256: a.checksum_sha256, checksum_verified: a.checksum_verified })),
      gps_imu_availability: "gps_imu_missing",
      operator_tags: ["KEEP", "Great Location"],
      operator_notes: "bridge at dawn",
      fallback_reason: assetType === "captured_nine_camera_feeds" ? null : "fallback",
      source_take: { mode: "stock", stock_job_id: c.stockClipId.replace(/-CLIP-\d+$/, ""),
        roll_number: 7, clip_number: 48, source_folder_name: "Roll_007_Clip_048",
        timecode_in: null, timecode_out: null, clip_count: null,
        duration_seconds: c.seconds ?? 1, raw_ready_for_repackage: true,
        raw_issue_kinds: [], live_asset_issue_kinds: [] },
    };
    const metaFile = `${token}.website.json`;
    fs.writeFileSync(path.join(metaDir, metaFile), JSON.stringify(metadata, null, 2));

    clips.push({
      stock_clip_id: c.stockClipId, source_folder_name: "Roll_007_Clip_048",
      clip_package_relative_path: clipRel, clip_package_path: path.join(rootDir, clipRel),
      metadata_json_file_name: metaFile,
      metadata_relative_path: path.join(clipRel, "metadata", metaFile),
      metadata_path: path.join(rootDir, clipRel, "metadata", metaFile),
      selected_publish_asset_type: assetType,
      gps_imu_availability: "gps_imu_missing",
      fallback_reason: metadata.fallback_reason, metadata, assets,
    });
  }
  const manifest = {
    schema: "spheris.stock.website_handoff.v1",
    handoff_root_path: rootDir, clips_root_relative_path: "clips",
    clips_root_path: path.join(rootDir, "clips"),
    clip_count: clips.length, excluded_clip_count: 0, clips, excluded_clips: [],
  };
  fs.writeFileSync(path.join(rootDir, "website_handoff_manifest.json"), JSON.stringify(manifest, null, 2));
}
```

- [ ] **Step 2: Write the failing test**

Create `pipeline/test/adapter.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeHandoff } from "./helpers/makeHandoff.js";
import { verifyHandoff, HandoffVerifyError } from "../src/mmm/verify.js";
import { adaptClip, ClipAdaptError } from "../src/mmm/adapter.js";

const CLIP = "SPH-STK-20260708-GLENDORA-001-CLIP-0001";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tpl-handoff-"));

test("verify: valid handoff passes; corrupted asset fails with checksum code", async () => {
  const root = tmp();
  await makeHandoff(root, { clips: [{ stockClipId: CLIP }] });
  const manifest = await verifyHandoff(root);
  assert.equal(manifest.clip_count, 1);

  // Corrupt one asset → checksum failure
  const asset = manifest.clips[0].assets[0];
  fs.appendFileSync(path.join(root, asset.package_relative_path), "corrupt");
  await assert.rejects(verifyHandoff(root), (e: HandoffVerifyError) => e.code === "checksum");
});

test("adapt: nine feeds → full drop with A..J mapping and synthesized meta", async () => {
  const root = tmp();
  await makeHandoff(root, { clips: [{ stockClipId: CLIP }] });
  const manifest = await verifyHandoff(root);
  const { drop, stockClipId } = adaptClip(root, manifest.clips[0]);
  assert.equal(stockClipId, CLIP);
  assert.equal(Object.keys(drop.cameraFiles).length, 9);
  assert.ok(drop.cameraFiles.A!.endsWith("_captured_camera_feed_01.mp4"));
  assert.ok(drop.cameraFiles.J!.endsWith("_captured_camera_feed_09.mp4"));
  assert.equal(drop.meta.shootDate, "2026-07-08");
  assert.equal(drop.meta.season, "summer");
  assert.equal(drop.meta.location.city, "Glendora");
  assert.deepEqual(drop.meta.sceneHints, ["KEEP", "Great Location", "bridge at dawn"]);
});

test("adapt: live stitch → stitched-only drop; grid/unavailable rejected", async () => {
  const root = tmp();
  await makeHandoff(root, { clips: [
    { stockClipId: CLIP, assetType: "captured_live_stitch" },
    { stockClipId: CLIP.replace("0001", "0002"), assetType: "captured_nine_grid" },
    { stockClipId: CLIP.replace("0001", "0003"), assetType: "unavailable" },
  ]});
  const manifest = await verifyHandoff(root);
  const adapted = adaptClip(root, manifest.clips[0]);
  assert.ok(adapted.drop.stitchedMaster);
  assert.deepEqual(adapted.drop.cameraFiles, {});
  assert.throws(() => adaptClip(root, manifest.clips[1]),
    (e: ClipAdaptError) => e.stage === "unsupported_asset_type");
  assert.throws(() => adaptClip(root, manifest.clips[2]),
    (e: ClipAdaptError) => e.stage === "no_publishable_asset");
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx -w pipeline tsx --test test/adapter.test.ts` — FAIL.

- [ ] **Step 4: Implement `pipeline/src/mmm/verify.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { handoffManifestSchema, type HandoffManifest } from "@platelab/shared";
import { sha256File } from "../stages/checksum.js";

export class HandoffVerifyError extends Error {
  constructor(public code: "manifest" | "checksum", public detail: string) {
    super(`${code}: ${detail}`);
  }
}

/** Parse + schema-validate the manifest, then verify every asset checksum. */
export async function verifyHandoff(rootDir: string): Promise<HandoffManifest> {
  const manifestPath = path.join(rootDir, "website_handoff_manifest.json");
  if (!fs.existsSync(manifestPath)) throw new HandoffVerifyError("manifest", "website_handoff_manifest.json not found");
  let manifest: HandoffManifest;
  try {
    manifest = handoffManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch (err) {
    throw new HandoffVerifyError("manifest", (err as Error).message);
  }
  for (const clip of manifest.clips) {
    for (const asset of clip.assets) {
      if (!asset.checksum_sha256 || !asset.checksum_verified) {
        throw new HandoffVerifyError("checksum", `${clip.stock_clip_id}/${asset.role}: checksum missing or unverified`);
      }
      const file = path.join(rootDir, asset.package_relative_path);
      if (!fs.existsSync(file)) throw new HandoffVerifyError("checksum", `${asset.package_relative_path}: file missing`);
      const actual = await sha256File(file);
      if (actual !== asset.checksum_sha256) {
        throw new HandoffVerifyError("checksum", `${asset.package_relative_path}: sha256 mismatch`);
      }
    }
  }
  return manifest;
}
```

- [ ] **Step 5: Implement `pipeline/src/mmm/adapter.ts`**

```ts
import path from "node:path";
import {
  CAMERA_NUMBER_TO_POSITION,
  type HandoffClip,
  type CameraId,
} from "@platelab/shared";
import type { Drop } from "../stages/discover.js";
import type { DropMeta } from "../stages/discover.js";

export class ClipAdaptError extends Error {
  constructor(public stage: "unsupported_asset_type" | "no_publishable_asset", message: string) {
    super(message);
  }
}

const SEASONS_BY_MONTH = ["winter","winter","spring","spring","spring","summer",
  "summer","summer","fall","fall","fall","winter"] as const;

function titleCase(slug: string): string {
  return slug.toLowerCase().replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
}

/** SPH-STK-YYYYMMDD-LOCATION-### → { shootDate, locationSlug } */
function parseStockClipId(id: string): { shootDate: string; locationSlug: string } {
  const m = /^SPH-STK-(\d{4})(\d{2})(\d{2})-([A-Z0-9]+)-\d+/i.exec(id);
  if (!m) return { shootDate: "1970-01-01", locationSlug: "Unknown" };
  return { shootDate: `${m[1]}-${m[2]}-${m[3]}`, locationSlug: titleCase(m[4]) };
}

/**
 * Translate one MMM handoff clip into the pipeline's Drop shape. Synthesized
 * meta fields are best-effort defaults — the AI labeling stage refines from
 * frames, and the draft gate is the human backstop before anything goes live.
 */
export function adaptClip(rootDir: string, clip: HandoffClip): { drop: Drop; stockClipId: string } {
  const type = clip.selected_publish_asset_type;
  if (type === "captured_nine_grid") {
    throw new ClipAdaptError("unsupported_asset_type",
      `nine-grid fallback is not ingestible in v1 (${clip.fallback_reason ?? "no reason given"})`);
  }
  if (type === "unavailable") {
    throw new ClipAdaptError("no_publishable_asset", clip.fallback_reason ?? "no publishable asset");
  }

  const cameraFiles: Partial<Record<CameraId, string>> = {};
  let stitchedMaster: string | undefined;
  for (const asset of clip.assets) {
    const abs = path.join(rootDir, asset.package_relative_path);
    if (type === "captured_live_stitch") { stitchedMaster = abs; continue; }
    if (asset.camera_number != null) {
      cameraFiles[CAMERA_NUMBER_TO_POSITION[asset.camera_number]] = abs;
    }
  }

  const { shootDate, locationSlug } = parseStockClipId(clip.stock_clip_id);
  const month = Number(shootDate.slice(5, 7)) - 1;
  const meta: DropMeta = {
    shootDate,
    rig: "Spheris XL 01",
    location: { name: locationSlug, city: locationSlug, region: "—", country: "US" },
    timeOfDay: "day",
    weather: "clear",
    season: SEASONS_BY_MONTH[month] ?? "summer",
    shotType: "urban",
    stageCompat: ["led-volume", "green-screen", "projection"],
    sceneHints: [
      ...clip.metadata.operator_tags,
      ...(clip.metadata.operator_notes ? [clip.metadata.operator_notes] : []),
    ],
  };

  return {
    stockClipId: clip.stock_clip_id,
    drop: {
      dir: path.join(rootDir, clip.clip_package_relative_path),
      stitchedMaster,
      cameraFiles,
      telemetryPath: undefined, // MMM telemetry export not shipped yet (spec: flagged to MMM)
      meta,
    },
  };
}
```

Note: `DropMeta` must be exported from `discover.ts` (it already is — `export type DropMeta`). If `dropMetaSchema` defaults `sceneHints`, passing it explicitly is fine.

- [ ] **Step 6: Run tests** — `npx -w pipeline tsx --test test/adapter.test.ts` — PASS.

- [ ] **Step 7: Commit**

```bash
git add pipeline/test/helpers/makeHandoff.ts pipeline/src/mmm/verify.ts pipeline/src/mmm/adapter.ts pipeline/test/adapter.test.ts
git commit -m "feat(pipeline): MMM handoff verification and clip adapter"
```

---

### Task 9: The ingest daemon (`platelab-ingestd`)

**Files:**
- Create: `pipeline/src/daemon.ts`
- Modify: `pipeline/package.json` (add `"daemon": "tsx src/daemon.ts"` script)
- Test: `pipeline/test/daemon.test.ts`

**Interfaces:**
- Consumes: transfer store (`@platelab/shared/server`), `verifyHandoff`, `adaptClip`, `ingestDiscovered`, `assignSku`, paths (Task 3), `audit`, `notifyHandoffComplete` (Task 10 — daemon calls a no-op stub until Task 10 lands; define the import then).
- Produces: `processTransfer(transferId): Promise<void>` (exported for tests) and `runDaemon(): Promise<never>` (poll loop, 3s interval). Behavior:
  - Picks oldest `uploaded` transfer → state `verifying` → `verifyHandoff(INBOX_INCOMING/<handoffId>)`; manifest/checksum failure → transfer `failed` with `{code, message}`, move dir to `INBOX_FAILED`.
  - Seeds `clips[]` from manifest (`queued`) + `excluded_clips` (`excluded`) if clips array empty (retry keeps existing).
  - State `ingesting`; for each clip in `queued` order: `verifying→ingesting→draft` (via `adaptClip` + `ingestDiscovered(drop, { sku: assignSku(), status: "draft", stockClipId })`) or `failed {stage, message}`. Duplicate stockClipId (already in catalog) → `failed {stage: "duplicate", …}` before ingest.
  - All clips terminal → transfer `complete`, notify, move handoff dir to `INBOX_ARCHIVE/<transferId>`.
  - Startup: prune archive entries older than 14 days.

- [ ] **Step 1: Write the failing integration test**

Create `pipeline/test/daemon.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("daemon processes an uploaded handoff end to end into draft plates", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-daemon-"));
  process.env.PLATELAB_ROOT = root;
  // dynamic imports AFTER env is set (paths bind at import)
  const { makeHandoff } = await import("./helpers/makeHandoff.js");
  const { createTransfer, updateTransfer, getTransfer } = await import("@platelab/shared/server");
  const { processTransfer } = await import("../src/daemon.js");
  const { INBOX_INCOMING, TRANSFERS_DIR, CATALOG_PATH } = await import("../src/paths.js");

  const handoffId = "SPH-STK-20260708-GLENDORA-001-web";
  const CLIP = "SPH-STK-20260708-GLENDORA-001-CLIP-0001";
  const dir = path.join(INBOX_INCOMING, handoffId);
  fs.mkdirSync(dir, { recursive: true });
  await makeHandoff(dir, { clips: [
    { stockClipId: CLIP },
    { stockClipId: CLIP.replace("0001", "0002"), assetType: "unavailable" },
  ]});

  const rec = createTransfer(TRANSFERS_DIR, {
    handoffId, bytes: 1000, manifestSha256: "0".repeat(64), clipCount: 2,
  });
  updateTransfer(TRANSFERS_DIR, rec.transferId, { state: "uploaded" });

  await processTransfer(rec.transferId);

  const done = getTransfer(TRANSFERS_DIR, rec.transferId)!;
  assert.equal(done.state, "complete");
  const good = done.clips.find((c) => c.stockClipId === CLIP)!;
  assert.equal(good.state, "draft");
  assert.match(good.sku!, /^PL-\d{7}$/);
  const bad = done.clips.find((c) => c.stockClipId.endsWith("0002"))!;
  assert.equal(bad.state, "failed");
  assert.equal(bad.error!.stage, "no_publishable_asset");

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const plate = catalog.plates.find((p: any) => p.sku === good.sku);
  assert.equal(plate.status, "draft");
  assert.equal(plate.mmm.stockClipId, CLIP);
  // package archived out of incoming
  assert.equal(fs.existsSync(dir), false);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx -w pipeline tsx --test test/daemon.test.ts` — FAIL.

- [ ] **Step 3: Implement `pipeline/src/daemon.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import {
  getTransfer, listTransfers, updateTransfer,
  type TransferRecord, type ClipRecord,
} from "@platelab/shared/server";
import { audit } from "./audit.js";
import {
  TRANSFERS_DIR, INBOX_INCOMING, INBOX_ARCHIVE, INBOX_FAILED,
} from "./paths.js";
import { verifyHandoff, HandoffVerifyError } from "./mmm/verify.js";
import { adaptClip, ClipAdaptError } from "./mmm/adapter.js";
import { assignSku } from "./mmm/skuLedger.js";
import { ingestDiscovered } from "./ingest.js";
import { loadCatalog } from "./stages/publish.js";
import { notifyHandoffComplete, notifyHandoffFailed } from "./notify.js";

const POLL_MS = 3000;
const ARCHIVE_DAYS = 14;

function setClip(id: string, stockClipId: string, patch: Partial<ClipRecord>): void {
  updateTransfer(TRANSFERS_DIR, id, (rec) => ({
    ...rec,
    clips: rec.clips.map((c) => (c.stockClipId === stockClipId ? { ...c, ...patch } : c)),
  }));
}

/** Process one uploaded transfer to a terminal state. Exported for tests. */
export async function processTransfer(transferId: string): Promise<void> {
  const rec = getTransfer(TRANSFERS_DIR, transferId);
  if (!rec) return;
  const handoffDir = path.join(INBOX_INCOMING, rec.handoffId);

  updateTransfer(TRANSFERS_DIR, transferId, { state: "verifying" });
  audit("daemon.verify.start", { transferId, handoffId: rec.handoffId });

  let manifest;
  try {
    manifest = await verifyHandoff(handoffDir);
  } catch (err) {
    const e = err as HandoffVerifyError;
    updateTransfer(TRANSFERS_DIR, transferId, {
      state: "failed", error: { code: e.code ?? "manifest", message: e.message },
    });
    if (fs.existsSync(handoffDir)) {
      fs.mkdirSync(INBOX_FAILED, { recursive: true });
      fs.renameSync(handoffDir, path.join(INBOX_FAILED, `${transferId}-${rec.handoffId}`));
    }
    audit("daemon.verify.failed", { transferId, error: e.message });
    await notifyHandoffFailed(rec, e.message);
    return;
  }

  // Seed clip records on first pass; retries keep prior per-clip states.
  let current = getTransfer(TRANSFERS_DIR, transferId)!;
  if (current.clips.length === 0) {
    current = updateTransfer(TRANSFERS_DIR, transferId, {
      clips: [
        ...manifest.clips.map((c): ClipRecord => ({ stockClipId: c.stock_clip_id, state: "queued" })),
        ...manifest.excluded_clips.map((c): ClipRecord => ({
          stockClipId: c.stock_clip_id, state: "excluded",
          error: { stage: c.reason, message: c.detail },
        })),
      ],
    });
  }

  updateTransfer(TRANSFERS_DIR, transferId, { state: "ingesting" });
  const catalogIds = new Set(
    loadCatalog().plates.map((p) => p.mmm?.stockClipId).filter(Boolean),
  );

  for (const clipRec of current.clips.filter((c) => c.state === "queued")) {
    const clip = manifest.clips.find((c) => c.stock_clip_id === clipRec.stockClipId);
    if (!clip) continue;
    setClip(transferId, clip.stock_clip_id, { state: "verifying" });
    try {
      if (catalogIds.has(clip.stock_clip_id)) {
        throw new ClipAdaptError("no_publishable_asset", "duplicate stockClipId — already in catalog");
      }
      const { drop, stockClipId } = adaptClip(handoffDir, clip);
      setClip(transferId, stockClipId, { state: "ingesting" });
      const plate = await ingestDiscovered(drop, {
        sku: assignSku(), status: "draft", stockClipId,
      });
      setClip(transferId, stockClipId, { state: "draft", sku: plate.sku });
      audit("daemon.clip.draft", { transferId, stockClipId, sku: plate.sku });
    } catch (err) {
      const stage = err instanceof ClipAdaptError ? err.stage : "ingest";
      setClip(transferId, clip.stock_clip_id, {
        state: "failed", error: { stage, message: (err as Error).message },
      });
      audit("daemon.clip.failed", { transferId, stockClipId: clip.stock_clip_id, stage, message: (err as Error).message });
    }
  }

  const final = updateTransfer(TRANSFERS_DIR, transferId, { state: "complete" });
  fs.mkdirSync(INBOX_ARCHIVE, { recursive: true });
  if (fs.existsSync(handoffDir)) {
    fs.renameSync(handoffDir, path.join(INBOX_ARCHIVE, transferId));
  }
  audit("daemon.complete", {
    transferId,
    drafted: final.clips.filter((c) => c.state === "draft").length,
    failed: final.clips.filter((c) => c.state === "failed").length,
  });
  await notifyHandoffComplete(final);
}

function pruneArchive(): void {
  if (!fs.existsSync(INBOX_ARCHIVE)) return;
  const cutoff = Date.now() - ARCHIVE_DAYS * 86_400_000;
  for (const entry of fs.readdirSync(INBOX_ARCHIVE)) {
    const p = path.join(INBOX_ARCHIVE, entry);
    if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
  }
}

export async function runDaemon(): Promise<never> {
  audit("daemon.start", { pid: process.pid });
  pruneArchive();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = listTransfers(TRANSFERS_DIR)
      .filter((t) => t.state === "uploaded")
      .sort((a, b) => a.announcedAt.localeCompare(b.announcedAt))[0];
    if (next) {
      try { await processTransfer(next.transferId); }
      catch (err) {
        updateTransfer(TRANSFERS_DIR, next.transferId, {
          state: "failed", error: { code: "daemon", message: (err as Error).message },
        });
        audit("daemon.error", { transferId: next.transferId, message: (err as Error).message });
      }
    } else {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

if (process.argv[1]?.endsWith("daemon.ts") || process.argv[1]?.endsWith("daemon.js")) {
  runDaemon().catch((err) => { console.error(err); process.exit(1); });
}
```

Create a temporary `pipeline/src/notify.ts` stub (Task 10 replaces it):

```ts
import type { TransferRecord } from "@platelab/shared/server";
export async function notifyHandoffComplete(_rec: TransferRecord): Promise<void> {}
export async function notifyHandoffFailed(_rec: TransferRecord, _message: string): Promise<void> {}
```

Add to `pipeline/package.json` scripts: `"daemon": "tsx src/daemon.ts"`.

- [ ] **Step 4: Run the test** — `npx -w pipeline tsx --test test/daemon.test.ts` — PASS (needs ffmpeg; ~30s).

- [ ] **Step 5: Run the whole suite** — `npx -w pipeline tsx --test test/*.test.ts` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/daemon.ts pipeline/src/notify.ts pipeline/package.json pipeline/test/daemon.test.ts
git commit -m "feat(pipeline): platelab-ingestd daemon — verify, adapt, ingest to draft, archive"
```

---

### Task 10: Email notification

**Files:**
- Rewrite: `pipeline/src/notify.ts`
- Modify: `pipeline/package.json` (dependency `"nodemailer": "^6.9.16"`, devDep `"@types/nodemailer": "^6.4.17"`)
- Test: `pipeline/test/notify.test.ts`

**Interfaces:**
- Consumes: `TransferRecord`.
- Produces: `notifyHandoffComplete(rec)`, `notifyHandoffFailed(rec, message)`, and (for tests) `buildSummary(rec): { subject: string; text: string }`. Env: `SMTP_URL` (e.g. `smtp://user:pass@smtp.host:587`), `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM`, `PLATELAB_PUBLIC_URL` (e.g. `https://platelab.note15.com`). Unconfigured → log line only (never throws).

- [ ] **Step 1: Write the failing test**

Create `pipeline/test/notify.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../src/notify.js";

test("notification summary: one-line outcome + dashboard deep link, no state payload", () => {
  const { subject, text } = buildSummary({
    transferId: "t-abcd1234", handoffId: "SPH-STK-20260708-GLENDORA-001-web",
    bytes: 1, manifestSha256: "0".repeat(64), clipCount: 3, state: "complete",
    clips: [
      { stockClipId: "…CLIP-0001", state: "draft", sku: "PL-4839208" },
      { stockClipId: "…CLIP-0002", state: "failed", error: { stage: "ingest", message: "x" } },
      { stockClipId: "…CLIP-0003", state: "excluded" },
    ],
    announcedAt: "2026-07-09T00:00:00Z", updatedAt: "2026-07-09T01:00:00Z",
  });
  assert.match(subject, /SPH-STK-20260708-GLENDORA-001-web/);
  assert.match(text, /1 drafted/);
  assert.match(text, /1 failed/);
  assert.match(text, /\/admin\/handoffs\/t-abcd1234/); // pointer to the source of truth
  assert.doesNotMatch(text, /PL-4839208/); // details live on the dashboard, not in email
});
```

- [ ] **Step 2: Run to verify failure** — `npx -w pipeline tsx --test test/notify.test.ts` — FAIL.

- [ ] **Step 3: Implement `pipeline/src/notify.ts`** (replace stub)

```ts
import nodemailer from "nodemailer";
import type { TransferRecord } from "@platelab/shared/server";

/**
 * Notifications point at the dashboard; they never carry state of their own.
 * The dashboard (/admin/handoffs/<id>) is the single source of truth.
 */

export function buildSummary(rec: TransferRecord): { subject: string; text: string } {
  const drafted = rec.clips.filter((c) => c.state === "draft").length;
  const failed = rec.clips.filter((c) => c.state === "failed").length;
  const base = process.env.PLATELAB_PUBLIC_URL ?? "";
  const subject = `[Plate Lab] ${rec.handoffId}: ${drafted} drafted, ${failed} failed`;
  const text = [
    `Handoff ${rec.handoffId} finished: ${rec.clipCount} clips — ${drafted} drafted, ${failed} failed.`,
    ``,
    `Status and actions (single source of truth):`,
    `${base}/admin/handoffs/${rec.transferId}`,
    drafted > 0 ? `Review drafts: ${base}/admin/drafts` : ``,
  ].filter(Boolean).join("\n");
  return { subject, text };
}

async function send(subject: string, text: string): Promise<void> {
  const { SMTP_URL, NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM } = process.env;
  if (!SMTP_URL || !NOTIFY_EMAIL_TO || !NOTIFY_EMAIL_FROM) {
    console.log(`[notify:log-only] ${subject}\n${text}`);
    return;
  }
  try {
    await nodemailer.createTransport(SMTP_URL).sendMail({
      from: NOTIFY_EMAIL_FROM, to: NOTIFY_EMAIL_TO, subject, text,
    });
  } catch (err) {
    console.error(`[notify] email failed: ${(err as Error).message}`); // never block ingest
  }
}

export async function notifyHandoffComplete(rec: TransferRecord): Promise<void> {
  const { subject, text } = buildSummary(rec);
  await send(subject, text);
}

export async function notifyHandoffFailed(rec: TransferRecord, message: string): Promise<void> {
  const base = process.env.PLATELAB_PUBLIC_URL ?? "";
  await send(
    `[Plate Lab] ${rec.handoffId}: handoff FAILED`,
    `Handoff ${rec.handoffId} failed verification: ${message}\n\n${base}/admin/handoffs/${rec.transferId}`,
  );
}
```

- [ ] **Step 4: Install dep + run tests**

```bash
npm install -w pipeline nodemailer && npm install -w pipeline -D @types/nodemailer
npx -w pipeline tsx --test test/notify.test.ts test/daemon.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/notify.ts pipeline/package.json package-lock.json pipeline/test/notify.test.ts
git commit -m "feat(pipeline): email notification pointing at the dashboard"
```

---

### Task 11: Public site — live-only, fresh catalog, draft previews

**Files:**
- Modify: `web/lib/catalog.ts`
- Modify: `web/app/page.tsx`, `web/app/browse/page.tsx`, `web/app/plate/[sku]/page.tsx`

**Interfaces:**
- Produces in `web/lib/catalog.ts`: `getCatalog()` (all plates, mtime-cached), `getLivePlates(): Plate[]`, `getPlate(sku)` unchanged (any status — used by admin/preview), `getLivePlate(sku)`. Cache: re-read `catalog.json` when its `mtime` changes (the daemon writes it at runtime; the old `NODE_ENV==="production"` forever-cache would serve stale data until restart).
- Pages: home + browse use `getLivePlates()` and `export const dynamic = "force-dynamic"` (they must reflect daemon publishes without a rebuild). Plate page: live plates render normally; **draft** plates render only with a valid screener signature (`?exp=…&sig=…`, HMAC over `${sku}.${exp}` with `PLATELAB_SCREENER_SECRET` — same primitive as `/api/screener`), else `notFound()`. Remove `generateStaticParams` (SKUs now appear at runtime); keep the page dynamic.

- [ ] **Step 1: Rewrite the cache + accessors in `web/lib/catalog.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { catalogSchema, type Catalog, type Plate } from "@platelab/shared";

const CATALOG_PATH = path.join(process.cwd(), "data", "catalog.json");

let cached: Catalog | null = null;
let cachedMtime = 0;

export function getCatalog(): Catalog {
  if (!fs.existsSync(CATALOG_PATH)) return { generatedAt: "", plates: [] };
  const mtime = fs.statSync(CATALOG_PATH).mtimeMs;
  if (!cached || mtime !== cachedMtime) {
    cached = catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
    cachedMtime = mtime;
  }
  return cached;
}

export function getLivePlates(): Plate[] {
  return getCatalog().plates.filter((p) => p.status === "live");
}

export function getPlate(sku: string): Plate | undefined {
  return getCatalog().plates.find((p) => p.sku === sku);
}

export function getLivePlate(sku: string): Plate | undefined {
  const p = getPlate(sku);
  return p?.status === "live" ? p : undefined;
}
```

(Keep the existing `formatDuration` helper and any other exports intact.)

- [ ] **Step 2: Update the three pages**

- `web/app/page.tsx`: replace `const { plates } = getCatalog();` with `const plates = getLivePlates();` (adjust destructuring), add `export const dynamic = "force-dynamic";` at top.
- `web/app/browse/page.tsx`: same substitution + `export const dynamic = "force-dynamic";`.
- `web/app/plate/[sku]/page.tsx`: delete `generateStaticParams`. At the top of the component:

```ts
import crypto from "node:crypto";

function validPreviewSig(sku: string, exp?: string, sig?: string): boolean {
  const secret = process.env.PLATELAB_SCREENER_SECRET;
  if (!secret || !exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${sku}.${exp}`).digest("hex");
  const a = Buffer.from(sig, "hex"); const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Accept `searchParams` in the page props (`searchParams: Promise<{ exp?: string; sig?: string }>`), then:

```ts
const plate = getPlate(sku);
if (!plate) notFound();
if (plate.status === "draft") {
  const { exp, sig } = await searchParams;
  if (!validPreviewSig(sku, exp, sig)) notFound();
}
```

Related-plates strip: switch its source to `getLivePlates()`.

- [ ] **Step 3: Verify in the browser**

```bash
npm run build && PLATELAB_SCREENER_SECRET=s npm run start -w web &
# catalog demo plates are all live → home/browse render as before
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/           # 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/browse     # 200
# hand-edit one plate to "status":"draft" in web/data/catalog.json, then without restart:
curl -s localhost:3000/browse | grep -c "PL-"                      # one fewer card
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/plate/PL-XXXXXXX  # 404 (draft hidden)
# revert the hand-edit; kill server
```

Expected: draft disappears from browse **without a restart** (mtime cache works) and its detail page 404s without a signature.

- [ ] **Step 4: Commit**

```bash
git add web/lib/catalog.ts web/app/page.tsx web/app/browse/page.tsx web/app/plate/\[sku\]/page.tsx
git commit -m "feat(web): live-only public catalog with runtime freshness + signed draft previews"
```

---

### Task 12: Admin session auth

**Files:**
- Create: `web/lib/admin/session.ts`
- Create: `web/app/admin/login/page.tssx` → `page.tsx` and `web/app/admin/login/actions.ts`
- Test: `web/test/adminSession.test.ts`

**Interfaces:**
- Produces: `createSessionCookie(now?: number): string` (value `exp.hmac(exp)`, 7-day expiry, HMAC-SHA256 keyed by `ADMIN_PASSWORD`), `verifySessionCookie(value: string, now?: number): boolean`, `checkPassword(candidate: string): boolean` (timing-safe), cookie name `ADMIN_COOKIE = "tpl_admin"`. Server helper `requireAdmin(): Promise<void>` — reads `cookies()`, `redirect("/admin/login")` when invalid (used by every admin page and action).

- [ ] **Step 1: Write the failing test**

Create `web/test/adminSession.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
process.env.ADMIN_PASSWORD = "correct-horse";
const { createSessionCookie, verifySessionCookie, checkPassword } = await import("../lib/admin/session");

test("session cookie round-trips and expires", () => {
  const v = createSessionCookie(1_000_000);
  assert.equal(verifySessionCookie(v, 1_000_000), true);
  assert.equal(verifySessionCookie(v, 1_000_000 + 8 * 86400), false); // 8 days later
  assert.equal(verifySessionCookie("123.deadbeef", 1_000_000), false); // forged
});

test("password check is exact", () => {
  assert.equal(checkPassword("correct-horse"), true);
  assert.equal(checkPassword("wrong"), false);
  assert.equal(checkPassword(""), false);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w web` — FAIL.

- [ ] **Step 3: Implement `web/lib/admin/session.ts`**

```ts
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_COOKIE = "tpl_admin";
const TTL_SECONDS = 7 * 86400;

function secret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("ADMIN_PASSWORD not configured");
  return s;
}

const hmac = (payload: string) =>
  crypto.createHmac("sha256", secret()).update(payload).digest("hex");

export function createSessionCookie(now = Math.floor(Date.now() / 1000)): string {
  const exp = now + TTL_SECONDS;
  return `${exp}.${hmac(String(exp))}`;
}

export function verifySessionCookie(value: string, now = Math.floor(Date.now() / 1000)): boolean {
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < now) return false;
  const a = Buffer.from(sig, "hex"); const b = Buffer.from(hmac(exp), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function checkPassword(candidate: string): boolean {
  const a = Buffer.from(candidate); const b = Buffer.from(secret());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Call at the top of every admin page/action. */
export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  const v = jar.get(ADMIN_COOKIE)?.value;
  if (!v || !verifySessionCookie(v)) redirect("/admin/login");
}
```

Note: `session.ts` imports `next/headers` — the pure functions are still unit-testable because the test never calls `requireAdmin`. If the import breaks under `tsx --test` (Next runtime-only module), split the pure helpers into `web/lib/admin/sessionCore.ts` (no Next imports; the test targets this) and keep `requireAdmin` in `session.ts` re-exporting from core.

- [ ] **Step 4: Login page + action**

`web/app/admin/login/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, checkPassword, createSessionCookie } from "@/lib/admin/session";

export async function login(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) redirect("/admin/login?error=1");
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, createSessionCookie(), {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 7 * 86400,
  });
  redirect("/admin/handoffs");
}
```

`web/app/admin/login/page.tsx`:

```tsx
import { login } from "./actions";

export const metadata = { title: "Admin — The Plate Lab" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1 style={{ marginBottom: 24 }}>Admin</h1>
      {error && <p className="mono" style={{ color: "var(--orange)", marginBottom: 16 }}>Wrong password</p>}
      <form action={login}>
        <input className="search-input" type="password" name="password"
          placeholder="ADMIN PASSWORD" aria-label="Admin password" autoFocus />
        <button className="cta mono" type="submit" style={{ marginTop: 16 }}>Sign in →</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Run tests + manual check**

`npm test -w web` PASS. Then `ADMIN_PASSWORD=x npm run dev -w web`, visit `/admin/login`, wrong password shows error, right password redirects to `/admin/handoffs` (404 until Task 13 — expected).

- [ ] **Step 6: Commit**

```bash
git add web/lib/admin web/app/admin/login web/test/adminSession.test.ts
git commit -m "feat(web): admin session auth (password → HMAC cookie)"
```

---

### Task 13: Admin — handoffs dashboard with retry/re-verify

**Files:**
- Create: `web/app/admin/actions.ts`
- Create: `web/app/admin/handoffs/page.tsx`
- Create: `web/app/admin/handoffs/[id]/page.tsx`

**Interfaces:**
- Consumes: transfer store, `requireAdmin`, `TRANSFERS_DIR` from `@/lib/ingest/paths`.
- Produces server actions in `web/app/admin/actions.ts`:
  - `retryClip(transferId, stockClipId)` — sets that clip `queued` (clears error) and the transfer `uploaded` (daemon re-picks; already-drafted clips are skipped because the daemon only processes `queued`).
  - `reverifyHandoff(transferId)` — resets all `failed` clips to `queued`, clears transfer error, sets state `uploaded`. (For manifest-level failures, MMM re-sends first; the archived/failed package path is shown on the page.)
  - `publishPlate(sku)` / `rejectPlate(sku, reason)` — Task 14 adds these to the same file.

- [ ] **Step 1: Implement `web/app/admin/actions.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { updateTransfer } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export async function retryClip(transferId: string, stockClipId: string): Promise<void> {
  await requireAdmin();
  updateTransfer(TRANSFERS_DIR, transferId, (rec) => ({
    ...rec,
    state: "uploaded", // daemon re-picks; only `queued` clips are processed
    error: undefined,
    clips: rec.clips.map((c) =>
      c.stockClipId === stockClipId ? { ...c, state: "queued", error: undefined } : c),
  }));
  revalidatePath(`/admin/handoffs/${transferId}`);
}

export async function reverifyHandoff(transferId: string): Promise<void> {
  await requireAdmin();
  updateTransfer(TRANSFERS_DIR, transferId, (rec) => ({
    ...rec,
    state: "uploaded",
    error: undefined,
    clips: rec.clips.map((c) => (c.state === "failed" ? { ...c, state: "queued", error: undefined } : c)),
  }));
  revalidatePath(`/admin/handoffs/${transferId}`);
}
```

Note: retry re-runs ingest from `INBOX_ARCHIVE/<transferId>` — the daemon's `processTransfer` resolves the handoff dir as `INBOX_INCOMING/<handoffId>`; extend `processTransfer` (small edit in `pipeline/src/daemon.ts`): `const handoffDir = [path.join(INBOX_INCOMING, rec.handoffId), path.join(INBOX_ARCHIVE, rec.transferId)].find(fs.existsSync) ?? path.join(INBOX_INCOMING, rec.handoffId);` and skip the final archive `rename` when the dir already lives in the archive. Add a regression assertion to `pipeline/test/daemon.test.ts`: after completion, flip one failed clip back to `queued` + state `uploaded` via `updateTransfer`, run `processTransfer` again, and assert it completes without throwing.

- [ ] **Step 2: Implement `web/app/admin/handoffs/page.tsx`**

```tsx
import Link from "next/link";
import { listTransfers } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export const dynamic = "force-dynamic";
export const metadata = { title: "Handoffs — TPL Admin" };

export default async function HandoffsPage() {
  await requireAdmin();
  const transfers = listTransfers(TRANSFERS_DIR);
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <div className="section-head">
        <h2>Ingest handoffs</h2>
        <Link className="mono dim" href="/admin/drafts">Draft queue →</Link>
      </div>
      {transfers.length === 0 && <div className="empty-state"><p className="mono">No transfers yet</p></div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr className="mono dim" style={{ textAlign: "left" }}>
          <th>Handoff</th><th>State</th><th>Clips</th><th>Size</th><th>Announced</th>
        </tr></thead>
        <tbody>
          {transfers.map((t) => {
            const drafted = t.clips.filter((c) => c.state === "draft").length;
            const failed = t.clips.filter((c) => c.state === "failed").length;
            return (
              <tr key={t.transferId} style={{ borderTop: "1px solid var(--hairline)" }}>
                <td><Link href={`/admin/handoffs/${t.transferId}`} className="mono">{t.handoffId}</Link></td>
                <td className="mono" style={failed || t.state === "failed" ? { color: "var(--orange)" } : {}}>{t.state}</td>
                <td className="mono">{drafted}/{t.clipCount} drafted{failed ? `, ${failed} failed` : ""}</td>
                <td className="mono dim">{(t.bytes / 1e9).toFixed(1)} GB</td>
                <td className="mono dim">{t.announcedAt.slice(0, 16).replace("T", " ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Implement `web/app/admin/handoffs/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransfer } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";
import { retryClip, reverifyHandoff } from "../../actions";

export const dynamic = "force-dynamic";

export default async function HandoffDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const t = getTransfer(TRANSFERS_DIR, id);
  if (!t) notFound();
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <p className="mono dim"><Link href="/admin/handoffs">← handoffs</Link></p>
      <h2 style={{ margin: "12px 0" }}>{t.handoffId}</h2>
      <p className="mono">state: {t.state}{t.error ? ` — ${t.error.code}: ${t.error.message}` : ""}</p>
      {t.state === "failed" && (
        <form action={reverifyHandoff.bind(null, t.transferId)} style={{ margin: "12px 0" }}>
          <button className="cta mono" type="submit">Re-verify (after re-send)</button>
        </form>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}>
        <thead><tr className="mono dim" style={{ textAlign: "left" }}>
          <th>Stock clip ID</th><th>State</th><th>SKU</th><th>Error</th><th></th>
        </tr></thead>
        <tbody>
          {t.clips.map((c) => (
            <tr key={c.stockClipId} style={{ borderTop: "1px solid var(--hairline)" }}>
              <td className="mono">{c.stockClipId}</td>
              <td className="mono" style={c.state === "failed" ? { color: "var(--orange)" } : {}}>{c.state}</td>
              <td className="mono">{c.sku ? <Link href={`/plate/${c.sku}`}>{c.sku}</Link> : "—"}</td>
              <td className="mono dim">{c.error ? `${c.error.stage}: ${c.error.message}` : "—"}</td>
              <td>{c.state === "failed" && (
                <form action={retryClip.bind(null, t.transferId, c.stockClipId)}>
                  <button className="filter-chip" type="submit">Retry</button>
                </form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 4: Manual verification**

```bash
ADMIN_PASSWORD=x npm run dev -w web
# seed a transfer state file by hand into sample-data/transfers/ (copy the shape
# from the daemon test), then: /admin/handoffs shows it; detail page shows clips;
# Retry flips states in the JSON file (verify with cat). Delete the seed after.
```

Also run the daemon retry regression test added in Step 1: `npx -w pipeline tsx --test test/daemon.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/admin pipeline/src/daemon.ts pipeline/test/daemon.test.ts
git commit -m "feat(web): admin handoffs dashboard — single source of truth with retry/re-verify"
```

---

### Task 14: Admin — draft queue (publish/reject) + CLI

**Files:**
- Modify: `web/app/admin/actions.ts` (add publish/reject)
- Create: `web/app/admin/drafts/page.tsx`
- Modify: `pipeline/src/cli.ts` (approve/reject commands)
- Modify: `pipeline/src/stages/publish.ts` (add `setPlateStatus`, `removePlate`)

**Interfaces:**
- Produces in `pipeline/src/stages/publish.ts`: `setPlateStatus(sku: string, status: PlateStatus): Catalog` and `removePlate(sku: string, reason: string): Catalog` (removes entry, audits reason; the SKU stays in the ledger — never reused).
- Web actions can't import pipeline code; they operate on the catalog directly via a small mirror in `web/lib/admin/catalogAdmin.ts` with the same atomic tmp+rename write and zod validation (`catalogSchema`), plus an `audit` line appended to `sample-data/audit.jsonl`.
- CLI: `npx -w pipeline tsx src/cli.ts approve <sku>`, `reject <sku> <reason…>` — both validate the SKU with `isValidSku` first (typed-SKU surface → check digit enforced).

- [ ] **Step 1: Implement catalog admin helpers**

`web/lib/admin/catalogAdmin.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { catalogSchema, isValidSku, type Catalog } from "@platelab/shared";
import { REPO_ROOT } from "@/lib/ingest/paths";

const CATALOG = path.join(process.cwd(), "data", "catalog.json");
const AUDIT = path.join(REPO_ROOT, "sample-data", "audit.jsonl");

function load(): Catalog {
  return catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG, "utf8")));
}

function save(catalog: Catalog, event: string, detail: Record<string, unknown>): void {
  catalog.generatedAt = new Date().toISOString();
  catalogSchema.parse(catalog);
  const tmp = CATALOG + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2));
  fs.renameSync(tmp, CATALOG);
  fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
  fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n");
}

export function publishDraft(sku: string): void {
  if (!isValidSku(sku)) throw new Error(`invalid SKU: ${sku}`);
  const catalog = load();
  const plate = catalog.plates.find((p) => p.sku === sku);
  if (!plate) throw new Error(`unknown SKU: ${sku}`);
  plate.status = "live";
  save(catalog, "admin.publish", { sku });
}

export function rejectDraft(sku: string, reason: string): void {
  if (!isValidSku(sku)) throw new Error(`invalid SKU: ${sku}`);
  const catalog = load();
  const idx = catalog.plates.findIndex((p) => p.sku === sku);
  if (idx < 0) throw new Error(`unknown SKU: ${sku}`);
  catalog.plates.splice(idx, 1); // SKU stays in the ledger — never reused
  save(catalog, "admin.reject", { sku, reason });
}
```

- [ ] **Step 2: Add the server actions** (append to `web/app/admin/actions.ts`)

```ts
import { publishDraft, rejectDraft } from "@/lib/admin/catalogAdmin";

export async function publishPlateAction(sku: string): Promise<void> {
  await requireAdmin();
  publishDraft(sku);
  revalidatePath("/admin/drafts");
}

export async function rejectPlateAction(sku: string, formData: FormData): Promise<void> {
  await requireAdmin();
  rejectDraft(sku, String(formData.get("reason") ?? "rejected from admin"));
  revalidatePath("/admin/drafts");
}
```

- [ ] **Step 3: Implement `web/app/admin/drafts/page.tsx`**

```tsx
import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { requireAdmin } from "@/lib/admin/session";
import { publishPlateAction, rejectPlateAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drafts — TPL Admin" };

export default async function DraftsPage() {
  await requireAdmin();
  const drafts = getCatalog().plates.filter((p) => p.status === "draft");
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <div className="section-head">
        <h2>Draft plates ({drafts.length})</h2>
        <Link className="mono dim" href="/admin/handoffs">← handoffs</Link>
      </div>
      {drafts.length === 0 && <div className="empty-state"><p className="mono">Nothing pending</p></div>}
      <div className="plate-grid">
        {drafts.map((p) => (
          <div key={p.sku} style={{ border: "1px solid var(--hairline)", padding: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.renditions.poster} alt={p.title} style={{ width: "100%" }} />
            <p className="mono" style={{ margin: "10px 0 4px" }}>{p.sku} · {p.mmm?.stockClipId}</p>
            <h3>{p.title}</h3>
            <p className="dim" style={{ fontSize: 14, margin: "6px 0 12px" }}>{p.description}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <form action={publishPlateAction.bind(null, p.sku)}>
                <button className="cta mono" type="submit">Publish</button>
              </form>
              <form action={rejectPlateAction.bind(null, p.sku)} style={{ display: "flex", gap: 6 }}>
                <input className="search-input" name="reason" placeholder="reason" style={{ width: 140 }} />
                <button className="filter-chip" type="submit">Reject</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: CLI approve/reject** (extend the `switch` in `pipeline/src/cli.ts`)

```ts
    case "approve":
    case "reject": {
      if (!arg) throw new Error(`usage: cli.ts ${command} <sku> [reason]`);
      const { isValidSku } = await import("@platelab/shared");
      if (!isValidSku(arg)) throw new Error(`invalid SKU (check digit): ${arg}`);
      const { loadCatalog, publishPlate: upsert } = await import("./stages/publish.js");
      const catalog = loadCatalog();
      const plate = catalog.plates.find((p) => p.sku === arg);
      if (!plate) throw new Error(`unknown SKU: ${arg}`);
      if (command === "approve") {
        upsert({ ...plate, status: "live" });
        console.log(`✓ ${arg} → live`);
      } else {
        const { removePlate } = await import("./stages/publish.js");
        removePlate(arg, process.argv.slice(4).join(" ") || "rejected via cli");
        console.log(`✗ ${arg} removed (SKU retired, never reused)`);
      }
      break;
    }
```

Add to `pipeline/src/stages/publish.ts`:

```ts
export function removePlate(sku: string, reason: string): Catalog {
  const catalog = loadCatalog();
  const idx = catalog.plates.findIndex((p) => p.sku === sku);
  if (idx < 0) throw new Error(`unknown SKU: ${sku}`);
  catalog.plates.splice(idx, 1);
  catalog.generatedAt = new Date().toISOString();
  catalogSchema.parse(catalog);
  const tmp = CATALOG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2));
  fs.renameSync(tmp, CATALOG_PATH);
  return catalog;
}
```

(Import `audit` and add `audit("cli.reject", { sku, reason })` in the CLI branch.)

- [ ] **Step 5: End-to-end manual check**

```bash
# with the daemon test artifacts or a hand-edited draft in catalog.json:
ADMIN_PASSWORD=x npm run dev -w web
# /admin/drafts shows the draft with poster + stockClipId; Publish flips it live
# (appears on /browse immediately); Reject removes it. CLI:
npx -w pipeline tsx src/cli.ts approve PL-0000000   # → "invalid SKU (check digit)"
```

- [ ] **Step 6: Run everything**

```bash
npx -w pipeline tsx --test test/*.test.ts && npm test -w web && npm run build
```
Expected: all PASS, build clean.

- [ ] **Step 7: Commit**

```bash
git add web/lib/admin/catalogAdmin.ts web/app/admin pipeline/src/cli.ts pipeline/src/stages/publish.ts
git commit -m "feat: draft publish/reject — admin queue + check-digit-validated CLI"
```

---

### Task 15: Ops — runtime data out of git, deploy, daemon under pm2

This task is server + repo plumbing; no unit tests — each step has its own verification command. **Branch note:** Tasks 1–14 should have been developed on a branch (`mmm-ingest`) — pushing `main` auto-deploys. This task merges and rolls out.

**Files:**
- Modify: `.gitignore`, `README.md` (ingest section pointer to spec)
- Server: `/home/andy/deploy-platelab.sh`, `~/.ssh/authorized_keys`, `/home/andy/.platelab-env`, pm2

- [ ] **Step 1: Move runtime data out of git**

The daemon writes `web/data/catalog.json` + `web/data/sku-ledger.json` on the **server**; the CD deploy runs `git reset --hard`, which would clobber them. Untrack:

```bash
printf 'web/data/catalog.json\nweb/data/sku-ledger.json\nsample-data/transfers/\ningest-inbox/\n' >> .gitignore
git rm --cached web/data/catalog.json
git commit -am "chore: catalog + sku ledger become server-side runtime state (untracked)"
```

Local dev seeds it with `npm run demo:generate && npm run demo:ingest`. Document that in `README.md`'s quick start (one line: "catalog.json is runtime state — generate demo data first").

- [ ] **Step 2: Merge + deploy code**

```bash
git checkout main && git merge --no-ff mmm-ingest && git push origin main
gh run watch $(gh run list -R theandyroberts/meridian_public_site --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') -R theandyroberts/meridian_public_site --exit-status
```

Expected: deploy green (the deploy script's `git reset --hard` no longer touches catalog data; the server keeps its existing catalog.json since it's now untracked — verify it still exists after deploy).

- [ ] **Step 3: Server env + dirs + pm2 daemon**

```bash
ssh andy@143.244.188.235 '
set -e
# secrets (append; generate real values)
grep -q PLATELAB_INGEST_TOKEN ~/.platelab-env || cat >> ~/.platelab-env <<EOF
PLATELAB_INGEST_TOKEN=$(openssl rand -hex 32)
ADMIN_PASSWORD=$(openssl rand -base64 18)
PLATELAB_PUBLIC_URL=https://platelab.note15.com
# SMTP_URL=smtp://...        # fill when SMTP account exists (log-only until then)
# NOTIFY_EMAIL_TO=team@...
# NOTIFY_EMAIL_FROM=plates@...
EOF
mkdir -p /var/www/platelab/ingest-inbox/incoming
# daemon under pm2, same env file, cwd = repo root
set -a; . ~/.platelab-env; set +a
pm2 start npm --name platelab-ingestd --cwd /var/www/platelab -- run daemon -w pipeline
pm2 save
'
```

Also update `/home/andy/deploy-platelab.sh`: after `pm2 restart platelab --update-env`, add `pm2 restart platelab-ingestd --update-env || true`. And the web app needs the new env vars — restart `platelab` once with the refreshed env.

- [ ] **Step 4: MMM transport — restricted rsync key**

```bash
ssh andy@143.244.188.235 '
sudo apt-get install -y rrsync 2>/dev/null || sudo cp /usr/share/doc/rsync/scripts/rrsync /usr/local/bin/rrsync && sudo chmod +x /usr/local/bin/rrsync || true
ssh-keygen -t ed25519 -N "" -C "mmm-ingest" -f ~/.ssh/mmm_ingest_key
LINE="command=\"rrsync /var/www/platelab/ingest-inbox/incoming\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat ~/.ssh/mmm_ingest_key.pub)"
grep -q mmm-ingest ~/.ssh/authorized_keys || echo "$LINE" >> ~/.ssh/authorized_keys
echo "Private key for Drew/MMM config:"; cat ~/.ssh/mmm_ingest_key
'
```

Hand the private key + `PLATELAB_INGEST_TOKEN` to the MMM side out-of-band. Verify the key is inbox-jailed: `rsync -e "ssh -i key" somefile andy@server:/etc/` must fail; `…:/somefile` lands in the inbox.

- [ ] **Step 5: Acceptance run (synthetic handoff through production)**

```bash
# Local: build a synthetic handoff with the fixture helper
npx -w pipeline tsx -e 'import("./pipeline/test/helpers/makeHandoff.js").then(m => m.makeHandoff("/tmp/hx", {clips:[{stockClipId:"SPH-STK-20260709-TESTVILLE-001-CLIP-0001"}]}))'
TOKEN=<PLATELAB_INGEST_TOKEN>
SIZE=$(du -sb /tmp/hx | cut -f1); SHA=$(shasum -a 256 /tmp/hx/website_handoff_manifest.json | cut -d" " -f1)
TID=$(curl -s -X POST https://platelab.note15.com/api/ingest/handoffs -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\"handoffId\":\"test-accept-001\",\"bytes\":$SIZE,\"manifestSha256\":\"$SHA\",\"clipCount\":1}" | jq -r .transferId)
rsync -az -e "ssh -i mmm_ingest_key" /tmp/hx/ andy@143.244.188.235:test-accept-001/
curl -s -X POST https://platelab.note15.com/api/ingest/handoffs/$TID/uploaded -H "Authorization: Bearer $TOKEN"
watch -n 5 "curl -s https://platelab.note15.com/api/ingest/handoffs/$TID -H 'Authorization: Bearer $TOKEN' | jq .state,.clips"
```

Expected: state walks `uploaded → verifying → ingesting → complete`; clip reaches `draft` with a `PL-\d{7}` SKU; `/admin/handoffs` shows the transfer; `/admin/drafts` shows the plate; **Publish** puts it on `/browse`; **Reject** it afterward to clean up the test plate.

- [ ] **Step 6: Commit + final green**

```bash
git add .gitignore README.md
git commit -m "chore: ops wiring for MMM ingest — runtime data untracked, daemon + restricted rsync key"
git push origin main
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** announce/uploaded/status API (T7), burst disk guard (T6+T7), MMM-native package + adapter + camera map + asset-type routing (T5, T8), checksum enforcement (T8), opaque random SKU + Damm + ledger + typed-SKU validation (T1, T3, T14), draft gate + live filtering + signed previews (T2, T4, T11), daemon serialization + archive + retention + audit (T9), email→dashboard notification (T10), admin dashboard with retry/re-verify + drafts queue + CLI (T12–T14), duplicate stockClipId (T9), idempotent re-announce (T6), transport/rrsync + env/secrets + pm2 + deploy interaction (T15), telemetry-optional handling (T2, T4, T8).
- **Deliberate scope cuts (match spec):** `captured_nine_grid` rejected; telemetry export consumed only when MMM ships it (adapter sets `telemetryPath: undefined` today — wiring it later is a small adapter change); GPS/IMU badge stays dark until then.
- **Type consistency check:** `TransferRecord`/`ClipRecord` shapes match across store (T6), API (T7), daemon (T9), notify (T10), admin (T13). `ingestDiscovered(drop, {sku, status, stockClipId})` matches daemon call. `Drop.cameraFiles` is `Partial<…>` everywhere after T4.
- **Known sequencing hazard:** Tasks 1–4 break `main`'s build mid-stream (old SKU callers) — hence the branch + merge in T15.
