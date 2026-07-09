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
