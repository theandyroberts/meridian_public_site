import "server-only";

import {
  catalogSchema,
  plateSchema,
  type Catalog,
  type Plate,
} from "@platelab/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function getCatalog(options?: {
  includeDrafts?: boolean;
}): Promise<Catalog> {
  const supabase = options?.includeDrafts
    ? createAdminClient()
    : await createClient();
  const { data, error } = await supabase
    .from("stock_clips")
    .select("source_metadata, updated_at")
    .order("sku");

  if (error) {
    throw new Error(`Unable to load the catalog: ${error.message}`);
  }

  const generatedAt = (data ?? []).reduce(
    (latest, row) =>
      row.updated_at && row.updated_at > latest ? row.updated_at : latest,
    "",
  );
  return catalogSchema.parse({
    generatedAt,
    plates: (data ?? []).map((row) =>
      plateSchema.parse(row.source_metadata),
    ),
  });
}

export async function getLivePlates(): Promise<Plate[]> {
  return (await getCatalog()).plates;
}

export async function getPlate(
  sku: string,
  options?: { includeDrafts?: boolean },
): Promise<Plate | undefined> {
  const supabase = options?.includeDrafts
    ? createAdminClient()
    : await createClient();
  const { data, error } = await supabase
    .from("stock_clips")
    .select("source_metadata")
    .eq("sku", sku)
    .maybeSingle();

  if (error) throw new Error(`Unable to load ${sku}: ${error.message}`);
  return data ? plateSchema.parse(data.source_metadata) : undefined;
}

export async function getLivePlate(sku: string): Promise<Plate | undefined> {
  return getPlate(sku);
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
