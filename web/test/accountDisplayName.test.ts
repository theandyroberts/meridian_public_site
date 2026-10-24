import assert from "node:assert/strict";
import test from "node:test";
import { accountDisplayName } from "../lib/auth/displayName";

test("prefers the saved profile name", () => {
  assert.equal(
    accountDisplayName("Andrew Roberts", {
      email: "andrew@example.com",
      userMetadata: { full_name: "Andy R." },
    }),
    "Andrew Roberts",
  );
});

test("uses common identity-provider name fields before email", () => {
  assert.equal(
    accountDisplayName(null, {
      email: "andrew@example.com",
      userMetadata: { full_name: "Andrew Roberts" },
    }),
    "Andrew Roberts",
  );
});

test("falls back to email when no name is available", () => {
  assert.equal(
    accountDisplayName(null, {
      email: "andrew@example.com",
      userMetadata: {},
    }),
    "andrew@example.com",
  );
});
