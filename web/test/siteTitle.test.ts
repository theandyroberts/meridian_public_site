import assert from "node:assert/strict";
import test from "node:test";
import { siteTitle } from "../lib/siteTitle";

test("staging uses an unmistakable browser title", () => {
  assert.equal(
    siteTitle(
      "The Plate Lab — 360×180 Environments",
      "https://staging.theplatelab.site",
    ),
    "TPL staging",
  );
});

test("production and invalid URLs keep the requested title", () => {
  assert.equal(
    siteTitle("Browse plates — The Plate Lab", "https://theplatelab.site"),
    "Browse plates — The Plate Lab",
  );
  assert.equal(siteTitle("The Plate Lab", "not a URL"), "The Plate Lab");
});
