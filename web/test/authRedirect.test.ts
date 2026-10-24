import assert from "node:assert/strict";
import test from "node:test";
import { safeRedirectPath } from "../lib/auth/redirect";

test("safeRedirectPath accepts local application paths", () => {
  assert.equal(
    safeRedirectPath("/projects/abc?tab=scenes#active"),
    "/projects/abc?tab=scenes#active",
  );
});

test("safeRedirectPath rejects external and protocol-relative redirects", () => {
  assert.equal(safeRedirectPath("https://example.com"), "/projects");
  assert.equal(safeRedirectPath("//example.com/projects"), "/projects");
  assert.equal(safeRedirectPath(null), "/projects");
});
