import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWebHostname,
  hostnameFromHost,
  isComingSoonHostname,
  isStagingHostname,
} from "@/lib/siteHosts";

test("normalizes host headers", () => {
  assert.equal(
    hostnameFromHost("STAGING.THEPLATELAB.STUDIO:443"),
    "staging.theplatelab.studio",
  );
});

test("recognizes the studio launch and staging hosts", () => {
  assert.equal(isComingSoonHostname("theplatelab.studio"), true);
  assert.equal(isStagingHostname("staging.theplatelab.studio"), true);
  assert.equal(isStagingHostname("staging.platelabstudio.com"), true);
});

test("maps only legacy web hosts to their studio replacements", () => {
  assert.equal(canonicalWebHostname("theplatelab.site"), "theplatelab.studio");
  assert.equal(
    canonicalWebHostname("www.theplatelab.site"),
    "theplatelab.studio",
  );
  assert.equal(
    canonicalWebHostname("staging.theplatelab.site"),
    "staging.platelabstudio.com",
  );
  assert.equal(canonicalWebHostname("staging.theplatelab.studio"), "staging.platelabstudio.com");
  assert.equal(canonicalWebHostname("staging.platelabstudio.com"), null);
  assert.equal(canonicalWebHostname("supabase-staging.theplatelab.site"), null);
});
