import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePlateTitle } from "../src/stages/describe.js";
import { normalizeEnrichment } from "../src/stages/label.js";

test("sanitizePlateTitle removes capture-system prefixes without flattening the title", () => {
  assert.equal(sanitizePlateTitle("GA — 6th Street Viaduct at Dawn"), "6th Street Viaduct at Dawn");
  assert.equal(sanitizePlateTitle("Roll01_Clip04: Arts District Night Drive"), "Arts District Night Drive");
  assert.equal(sanitizePlateTitle("CAM_A / Downtown Los Angeles"), "Downtown Los Angeles");
});

test("normalizeEnrichment keeps the strongest duplicate and promotes labels to tags", () => {
  const result = normalizeEnrichment({
    objects: [
      { label: "  Concrete Viaduct ", confidence: 0.7, category: "infrastructure", evidence: "visual" },
      { label: "concrete viaduct", confidence: 0.94, category: "landmark", evidence: "combined" },
    ],
    tags: [" Bridge ", "bridge"],
  });
  assert.deepEqual(result.objects, [
    { label: "concrete viaduct", confidence: 0.94, category: "landmark", evidence: "combined" },
  ]);
  assert.deepEqual(result.tags, ["bridge", "concrete viaduct"]);
});
