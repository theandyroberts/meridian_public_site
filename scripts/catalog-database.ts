import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CATALOG_IMPORT_SOURCE,
  catalogDatabaseRecordForPlate,
  catalogSchema,
  plateSchema,
  type Catalog,
} from "@platelab/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const action = process.argv[2] ?? "check";
const target = process.argv[3] ?? "local";
const allowedActions = new Set(["import", "check", "embed"]);
const allowedTargets = new Set(["local", "staging"]);
const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = `${projectDirectory}/web/data/catalog.json`;

if (!allowedActions.has(action) || !allowedTargets.has(target)) {
  throw new Error(
    "Usage: catalog-database.ts <import|check|embed> <local|staging>",
  );
}

const credentials = await supabaseCredentials(target);
const supabase = createClient(credentials.url, credentials.serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

if (action === "import") {
  const catalog = await loadCatalog();
  await importCatalog(supabase, catalog);
  await reconcileCatalog(supabase, catalog);
  console.log(
    `Imported and reconciled ${catalog.plates.length} catalog clips in ${target}.`,
  );
}

if (action === "check") {
  const catalog = await loadCatalog();
  await reconcileCatalog(supabase, catalog);
  console.log(
    `Catalog reconciliation passed for ${catalog.plates.length} clips in ${target}.`,
  );
}

if (action === "embed") {
  const apiKey = requireEnvironment("OPENAI_API_KEY");
  const processed = await processEmbeddingJobs(supabase, apiKey);
  console.log(`Completed ${processed} embedding jobs in ${target}.`);
}

async function loadCatalog(): Promise<Catalog> {
  const body = await readFile(catalogPath, "utf8");
  return catalogSchema.parse(JSON.parse(body));
}

async function importCatalog(
  client: SupabaseClient,
  catalog: Catalog,
): Promise<void> {
  for (const plate of catalog.plates) {
    const sourceVersion = `${catalog.generatedAt}:${plate.ingestedAt}`;
    const record = catalogDatabaseRecordForPlate(plate, sourceVersion);
    const { data: stockClip, error: stockClipError } = await client
      .from("stock_clips")
      .upsert(record.stockClip, { onConflict: "sku" })
      .select("id, sku")
      .single();
    assertNoError(stockClipError, `upsert stock clip ${plate.sku}`);

    const stockClipId = stockClip.id as string;

    const { error: deleteAssetsError } = await client
      .from("clip_assets")
      .delete()
      .eq("stock_clip_id", stockClipId)
      .eq("source", CATALOG_IMPORT_SOURCE);
    assertNoError(deleteAssetsError, `replace assets for ${plate.sku}`);

    const { error: assetsError } = await client.from("clip_assets").insert(
      record.assets.map((asset) => ({
        ...asset,
        stock_clip_id: stockClipId,
      })),
    );
    assertNoError(assetsError, `insert assets for ${plate.sku}`);

    const { error: deleteDescriptorsError } = await client
      .from("clip_descriptors")
      .delete()
      .eq("stock_clip_id", stockClipId)
      .eq("source", CATALOG_IMPORT_SOURCE);
    assertNoError(
      deleteDescriptorsError,
      `replace descriptors for ${plate.sku}`,
    );

    const { error: descriptorsError } = await client
      .from("clip_descriptors")
      .insert(
        record.descriptors.map((descriptor) => ({
          ...descriptor,
          stock_clip_id: stockClipId,
        })),
      );
    assertNoError(descriptorsError, `insert descriptors for ${plate.sku}`);

    const { data: segment, error: segmentError } = await client
      .from("clip_segments")
      .upsert(
        {
          ...record.segment,
          stock_clip_id: stockClipId,
        },
        { onConflict: "stock_clip_id,segment_index" },
      )
      .select("id")
      .single();
    assertNoError(segmentError, `upsert full segment for ${plate.sku}`);

    await enqueueEmbeddingJob(client, {
      entityType: "clip",
      entityId: stockClipId,
      stockClipId,
      inputText: record.clipEmbeddingInput,
    });
    await enqueueEmbeddingJob(client, {
      entityType: "segment",
      entityId: segment.id as string,
      stockClipId,
      inputText: record.segmentEmbeddingInput,
    });
  }
}

async function enqueueEmbeddingJob(
  client: SupabaseClient,
  input: {
    entityType: "clip" | "segment";
    entityId: string;
    stockClipId: string;
    inputText: string;
  },
): Promise<void> {
  const inputHash = sha256(input.inputText);
  const { error } = await client.from("embedding_jobs").upsert(
    {
      entity_type: input.entityType,
      entity_id: input.entityId,
      stock_clip_id: input.stockClipId,
      input_text: input.inputText,
      input_hash: inputHash,
      model: "text-embedding-3-large",
      dimensions: 1536,
      status: "pending",
    },
    {
      onConflict: "entity_type,entity_id,input_hash,model,dimensions",
      ignoreDuplicates: true,
    },
  );
  assertNoError(error, `queue ${input.entityType} embedding`);
}

async function reconcileCatalog(
  client: SupabaseClient,
  catalog: Catalog,
): Promise<void> {
  const { data, error } = await client
    .from("stock_clips")
    .select("sku, source_metadata")
    .eq("source", CATALOG_IMPORT_SOURCE)
    .order("sku");
  assertNoError(error, "load imported catalog rows");

  const expected = new Map(
    catalog.plates.map((plate) => [plate.sku, plateSchema.parse(plate)]),
  );
  const actual = new Map(
    (data ?? []).map((row) => [
      row.sku as string,
      plateSchema.parse(row.source_metadata),
    ]),
  );
  const missing = [...expected.keys()].filter((sku) => !actual.has(sku));
  const extra = [...actual.keys()].filter((sku) => !expected.has(sku));
  const changed = [...expected.entries()]
    .filter(([sku, plate]) => {
      const databasePlate = actual.get(sku);
      return databasePlate && stableJson(databasePlate) !== stableJson(plate);
    })
    .map(([sku]) => sku);

  if (missing.length || extra.length || changed.length) {
    throw new Error(
      [
        "Catalog reconciliation failed.",
        `Missing: ${missing.join(", ") || "none"}`,
        `Extra import-owned rows: ${extra.join(", ") || "none"}`,
        `Metadata mismatch: ${changed.join(", ") || "none"}`,
      ].join("\n"),
    );
  }

  const { count: pendingJobs, error: jobsError } = await client
    .from("embedding_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "failed"]);
  assertNoError(jobsError, "count embedding jobs");
  console.log(
    `Reconciled ${actual.size} rows; ${pendingJobs ?? 0} embedding jobs await processing.`,
  );
}

async function processEmbeddingJobs(
  client: SupabaseClient,
  apiKey: string,
): Promise<number> {
  const batchSize = Number(process.env.TPL_EMBED_BATCH_SIZE ?? "32");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 128) {
    throw new Error("TPL_EMBED_BATCH_SIZE must be an integer from 1 to 128");
  }

  const { data: jobs, error } = await client
    .from("embedding_jobs")
    .select(
      "id, entity_type, entity_id, stock_clip_id, input_text, input_hash, model, dimensions, attempts",
    )
    .in("status", ["pending", "failed"])
    .order("created_at")
    .limit(batchSize);
  assertNoError(error, "load pending embedding jobs");
  if (!jobs?.length) return 0;

  const model = jobs[0].model as string;
  const dimensions = jobs[0].dimensions as number;
  if (
    jobs.some(
      (job) => job.model !== model || job.dimensions !== dimensions,
    )
  ) {
    throw new Error("Embedding jobs in one batch must use one model and size");
  }

  const jobIds = jobs.map((job) => job.id as string);
  const { error: lockError } = await client
    .from("embedding_jobs")
    .update({ status: "processing", locked_at: new Date().toISOString() })
    .in("id", jobIds);
  assertNoError(lockError, "lock embedding jobs");

  try {
    const embeddings = await createEmbeddings({
      apiKey,
      model,
      dimensions,
      inputs: jobs.map((job) => job.input_text as string),
    });

    for (const [index, job] of jobs.entries()) {
      const entityType = job.entity_type as "clip" | "segment";
      const segmentId =
        entityType === "segment" ? (job.entity_id as string) : null;
      const kind =
        entityType === "segment" ? "segment_search" : "clip_search";

      let duplicateDelete = client
        .from("clip_embeddings")
        .delete()
        .eq("stock_clip_id", job.stock_clip_id)
        .eq("kind", kind)
        .eq("model", model)
        .eq("input_hash", job.input_hash);
      duplicateDelete = segmentId
        ? duplicateDelete.eq("segment_id", segmentId)
        : duplicateDelete.is("segment_id", null);
      const { error: duplicateDeleteError } = await duplicateDelete;
      assertNoError(duplicateDeleteError, "replace matching embedding");

      let deactivate = client
        .from("clip_embeddings")
        .update({ active: false })
        .eq("stock_clip_id", job.stock_clip_id)
        .eq("kind", kind);
      deactivate = segmentId
        ? deactivate.eq("segment_id", segmentId)
        : deactivate.is("segment_id", null);
      const { error: deactivateError } = await deactivate;
      assertNoError(deactivateError, "deactivate superseded embeddings");

      const { error: embeddingError } = await client
        .from("clip_embeddings")
        .insert({
          stock_clip_id: job.stock_clip_id,
          segment_id: segmentId,
          kind,
          model,
          dimensions,
          embedding: JSON.stringify(embeddings[index]),
          input_hash: job.input_hash,
          active: true,
        });
      assertNoError(embeddingError, "store embedding");

      const { error: completeError } = await client
        .from("embedding_jobs")
        .update({
          status: "completed",
          attempts: Number(job.attempts) + 1,
          last_error: null,
          completed_at: new Date().toISOString(),
          locked_at: null,
        })
        .eq("id", job.id);
      assertNoError(completeError, "complete embedding job");
    }
  } catch (embeddingError) {
    const message =
      embeddingError instanceof Error
        ? embeddingError.message.slice(0, 2000)
        : "Unknown embedding error";
    for (const job of jobs) {
      await client
        .from("embedding_jobs")
        .update({
          status: "failed",
          attempts: Number(job.attempts) + 1,
          last_error: message,
          locked_at: null,
        })
        .eq("id", job.id);
    }
    throw embeddingError;
  }

  return jobs.length;
}

async function createEmbeddings(input: {
  apiKey: string;
  model: string;
  dimensions: number;
  inputs: string[];
}): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: input.inputs,
      model: input.model,
      dimensions: input.dimensions,
      encoding_format: "float",
    }),
  });
  const body = (await response.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      `OpenAI embeddings request failed (${response.status}): ${
        body.error?.message ?? "unknown error"
      }`,
    );
  }

  const ordered = [...(body.data ?? [])].sort(
    (left, right) => Number(left.index) - Number(right.index),
  );
  if (
    ordered.length !== input.inputs.length ||
    ordered.some(
      (item) =>
        !Array.isArray(item.embedding) ||
        item.embedding.length !== input.dimensions,
    )
  ) {
    throw new Error("OpenAI returned an unexpected embedding response");
  }
  return ordered.map((item) => item.embedding as number[]);
}

async function supabaseCredentials(
  environment: string,
): Promise<{ url: string; serviceRoleKey: string }> {
  if (environment === "staging") {
    return {
      url:
        process.env.TPL_STAGING_SUPABASE_URL ??
        "https://supabase-staging.theplatelab.site",
      serviceRoleKey: await environmentOrSecretPrompt(
        "TPL_STAGING_SERVICE_ROLE_KEY",
        "Paste staging service-role key: ",
      ),
    };
  }

  const url = process.env.TPL_SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.TPL_SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && serviceRoleKey) return { url, serviceRoleKey };

  const status = parseEnvironmentOutput(
    execFileSync("supabase", ["status", "-o", "env"], {
      cwd: projectDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  return {
    url: url ?? requireValue(status.API_URL, "local Supabase API URL"),
    serviceRoleKey:
      serviceRoleKey ??
      requireValue(status.SERVICE_ROLE_KEY, "local service-role key"),
  };
}

function parseEnvironmentOutput(body: string): Record<string, string> {
  return Object.fromEntries(
    body
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [
        match[1],
        match[2].trim().replace(/^(['"])(.*)\1$/, "$2"),
      ]),
  );
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireValue(
  value: string | undefined,
  description: string,
): string {
  if (!value) throw new Error(`Unable to resolve ${description}`);
  return value;
}

function assertNoError(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function environmentOrSecretPrompt(
  name: string,
  prompt: string,
): Promise<string> {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${name} is required`);
  }
  return promptForSecret(prompt);
}

function promptForSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let secret = "";
    const input = process.stdin;
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();

    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (characters: string) => {
      for (const character of characters) {
        if (character === "\r" || character === "\n") {
          finish();
          resolve(secret.trim());
          return;
        }
        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f") {
          secret = secret.slice(0, -1);
          continue;
        }
        secret += character;
      }
    };
    input.on("data", onData);
  });
}
