import test from "node:test";
import assert from "node:assert/strict";

import { parseDotEnv, resolveRemoteUploadConfig } from "../src/stages/upload.js";

test("parseDotEnv: parses root .env.local style values without comments", () => {
  assert.deepEqual(parseDotEnv(`
    # secret config
    HIPPIUS_BUCKET=mmm-output
    HIPPIUS_ACCESS_KEY="abc123"
    HIPPIUS_SECRET='shh'
    IGNORED LINE
    HIPPIUS_REGION=decentralized # default region
  `), {
    HIPPIUS_BUCKET: "mmm-output",
    HIPPIUS_ACCESS_KEY: "abc123",
    HIPPIUS_SECRET: "shh",
    HIPPIUS_REGION: "decentralized",
  });
});

test("resolveRemoteUploadConfig: HIPPIUS_BUCKET selects Hippius mode", () => {
  const config = resolveRemoteUploadConfig({
    HIPPIUS_BUCKET: "mmm-output",
    HIPPIUS_ACCESS_KEY: "access",
    HIPPIUS_SECRET: "secret",
  });

  assert.equal(config.mode, "hippius");
  assert.equal(config.publicBucket, "mmm-output");
  assert.equal(config.vaultBucket, "mmm-output");
  assert.deepEqual(config.awsArgsPrefix, ["--endpoint-url", "https://s3.hippius.com"]);
  assert.equal(config.env?.AWS_ACCESS_KEY_ID, "access");
  assert.equal(config.env?.AWS_SECRET_ACCESS_KEY, "secret");
  assert.equal(config.env?.AWS_DEFAULT_REGION, "decentralized");
});

test("resolveRemoteUploadConfig: s3 mode keeps separate public and vault buckets", () => {
  const config = resolveRemoteUploadConfig({
    PLATELAB_UPLOAD_MODE: "s3",
    PLATELAB_PUBLIC_BUCKET: "public",
    PLATELAB_VAULT_BUCKET: "vault",
    PLATELAB_S3_ENDPOINT_URL: "https://example.test",
  });

  assert.equal(config.mode, "s3");
  assert.equal(config.publicBucket, "public");
  assert.equal(config.vaultBucket, "vault");
  assert.deepEqual(config.awsArgsPrefix, ["--endpoint-url", "https://example.test"]);
});
