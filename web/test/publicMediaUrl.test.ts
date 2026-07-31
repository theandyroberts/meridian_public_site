import assert from "node:assert/strict";
import test from "node:test";
import { publicMediaUrl } from "../lib/publicMediaUrl";

test("staging resolves local catalog paths through Supabase Storage", () => {
  assert.equal(
    publicMediaUrl("/media/PL-4180192/poster.jpg", {
      siteUrl: "https://staging.theplatelab.site",
      supabaseUrl: "https://supabase-staging.theplatelab.site",
    }),
    "https://supabase-staging.theplatelab.site/storage/v1/object/public/plate-previews/PL-4180192/poster.jpg",
  );
});

test("production and already-hosted assets are unchanged", () => {
  assert.equal(
    publicMediaUrl("/media/PL-4180192/poster.jpg", {
      siteUrl: "https://theplatelab.site",
      supabaseUrl: "https://supabase.theplatelab.site",
    }),
    "/media/PL-4180192/poster.jpg",
  );
  assert.equal(
    publicMediaUrl("https://cdn.example.com/poster.jpg", {
      siteUrl: "https://staging.theplatelab.site",
      supabaseUrl: "https://supabase-staging.theplatelab.site",
    }),
    "https://cdn.example.com/poster.jpg",
  );
});
