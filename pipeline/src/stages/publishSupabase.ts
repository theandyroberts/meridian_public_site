import { createHash } from "node:crypto";
import {
  catalogDatabaseRecordForPlate,
  plateSchema,
  type Plate,
} from "@platelab/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PIPELINE_SOURCE = "ingest-pipeline";

export function usesSupabaseCatalog(): boolean {
  return process.env.CATALOG_BACKEND === "supabase";
}

export async function publishPlateToSupabase(plate: Plate): Promise<void> {
  const client = catalogClient();
  const record = catalogDatabaseRecordForPlate(
    plate,
    plate.ingestedAt,
    PIPELINE_SOURCE,
  );
  const { data: stockClip, error: stockClipError } = await client
    .from("stock_clips")
    .upsert(record.stockClip, { onConflict: "sku" })
    .select("id")
    .single();
  assertNoError(stockClipError, `upsert stock clip ${plate.sku}`);
  const stockClipId = stockClip.id as string;

  const { error: deleteAssetsError } = await client
    .from("clip_assets")
    .delete()
    .eq("stock_clip_id", stockClipId)
    .eq("source", PIPELINE_SOURCE);
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
    .eq("source", PIPELINE_SOURCE);
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

  await enqueueJob(client, {
    entityType: "clip",
    entityId: stockClipId,
    stockClipId,
    inputText: record.clipEmbeddingInput,
  });
  await enqueueJob(client, {
    entityType: "segment",
    entityId: segment.id as string,
    stockClipId,
    inputText: record.segmentEmbeddingInput,
  });
}

export async function removePlateFromSupabase(sku: string): Promise<void> {
  const { error } = await catalogClient()
    .from("stock_clips")
    .delete()
    .eq("sku", sku);
  assertNoError(error, `remove stock clip ${sku}`);
}

export async function plateFromSupabase(
  sku: string,
): Promise<Plate | undefined> {
  const { data, error } = await catalogClient()
    .from("stock_clips")
    .select("source_metadata")
    .eq("sku", sku)
    .maybeSingle();
  assertNoError(error, `load stock clip ${sku}`);
  return data ? plateSchema.parse(data.source_metadata) : undefined;
}

export async function publishedMmmIdsFromSupabase(): Promise<string[]> {
  const { data, error } = await catalogClient()
    .from("stock_clips")
    .select("mmm_stock_clip_id")
    .not("mmm_stock_clip_id", "is", null);
  assertNoError(error, "load published MMM IDs");
  return (data ?? []).flatMap((row) =>
    row.mmm_stock_clip_id ? [row.mmm_stock_clip_id as string] : [],
  );
}

async function enqueueJob(
  client: SupabaseClient,
  input: {
    entityType: "clip" | "segment";
    entityId: string;
    stockClipId: string;
    inputText: string;
  },
): Promise<void> {
  const { error } = await client.from("embedding_jobs").upsert(
    {
      entity_type: input.entityType,
      entity_id: input.entityId,
      stock_clip_id: input.stockClipId,
      input_text: input.inputText,
      input_hash: createHash("sha256").update(input.inputText).digest("hex"),
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

function catalogClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase catalog backend requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function assertNoError(
  error: { message: string } | null,
  operation: string,
): asserts error is null {
  if (error) throw new Error(`${operation}: ${error.message}`);
}
