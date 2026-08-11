import { createReadStream } from "node:fs";

const [sku, filePath] = process.argv.slice(2);
if (!sku || !filePath) {
  throw new Error("Usage: node upload-stage-preview.mjs <SKU> <file-path>");
}

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SERVICE_SUPABASESERVICE_KEY;
if (!serviceRoleKey) {
  throw new Error("Supabase service-role key is unavailable in this container");
}

const storageUrl = process.env.TPL_STORAGE_URL ?? "http://127.0.0.1:5000";
const response = await fetch(
  `${storageUrl}/object/plate-previews/${sku}/stage_preview.mp4`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "video/mp4",
      "cache-control": "public, max-age=31536000",
      "x-upsert": "true",
    },
    body: createReadStream(filePath),
    duplex: "half",
  },
);

const responseBody = await response.text();
if (!response.ok) {
  throw new Error(`Storage upload failed (${response.status}): ${responseBody}`);
}
console.log(`${sku}: storage upload returned ${response.status}`);
