import assert from "node:assert/strict";
import test from "node:test";
import { siteTitle } from "../lib/siteTitle";

test("staging uses an unmistakable browser title", () => {
  for (const url of [
    "https://staging.theplatelab.site",
    "https://staging.theplatelab.studio",
  ]) {
    assert.equal(
      siteTitle("The Plate Lab — 360×180 Environments", url),
      "TPL staging",
    );
  }
});

test("production and invalid URLs keep the requested title", () => {
  assert.equal(
    siteTitle("Browse plates — The Plate Lab", "https://theplatelab.studio"),
    "Browse plates — The Plate Lab",
  );
  assert.equal(siteTitle("The Plate Lab", "not a URL"), "The Plate Lab");
});
