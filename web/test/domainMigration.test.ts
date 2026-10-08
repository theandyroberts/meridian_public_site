import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function request(host: string, path = "/") {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

test("new apex preserves the coming-soon restriction across app routes", () => {
  for (const path of ["/", "/browse", "/admin", "/auth/login", "/api/reserve"]) {
    const response = middleware(request("platelabstudio.com", path));
    assert.equal(response.headers.get("x-middleware-rewrite"), "https://platelabstudio.com/coming-soon");
    assert.equal(response.headers.get("location"), null);
  }
  const page = middleware(request("platelabstudio.com", "/coming-soon"));
  assert.equal(page.headers.get("x-middleware-rewrite"), null);
  assert.equal(page.headers.get("location"), null);
});

test("legacy and www redirects preserve path and query without loops", () => {
  for (const host of ["theplatelab.site", "www.theplatelab.site", "theplatelab.studio", "www.theplatelab.studio", "www.platelabstudio.com"]) {
    const response = middleware(request(host, "/browse?q=city%20night&stage=led-volume"));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "https://platelabstudio.com/browse?q=city%20night&stage=led-volume");
  }
});

test("staging redirect and unrelated hosts retain their behavior", () => {
  assert.equal(middleware(request("staging.theplatelab.site", "/auth/callback?code=test")).headers.get("location"), "https://staging.theplatelab.studio/auth/callback?code=test");
  for (const host of ["staging.theplatelab.studio", "supabase-staging.theplatelab.site", "localhost"]) {
    const response = middleware(request(host));
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
  }
});

test("forwarded hostname governs rewrites behind the production proxy", () => {
  const incoming = new NextRequest("http://localhost:3000/browse", {
    headers: { host: "localhost:3000", "x-forwarded-host": "PLATELABSTUDIO.COM:443" },
  });
  assert.equal(middleware(incoming).headers.get("x-middleware-rewrite"), "http://localhost:3000/coming-soon");
});
