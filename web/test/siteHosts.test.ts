import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWebHostname,
  hostnameFromHost,
  isComingSoonHostname,
} from "@/lib/siteHosts";

test("normalizes host headers", () => {
  assert.equal(
    hostnameFromHost("STAGING.THEPLATELAB.STUDIO:443"),
    "staging.theplatelab.studio",
  );
});

test("recognizes the studio launch host", () => {
  assert.equal(isComingSoonHostname("theplatelab.studio"), true);
});

test("maps only legacy web hosts to their studio replacements", () => {
  assert.equal(canonicalWebHostname("theplatelab.site"), "theplatelab.studio");
  assert.equal(
    canonicalWebHostname("www.theplatelab.site"),
    "theplatelab.studio",
  );
  assert.equal(
    canonicalWebHostname("staging.theplatelab.site"),
    "staging.theplatelab.studio",
  );
  assert.equal(canonicalWebHostname("supabase-staging.theplatelab.site"), null);
});
