import { NextResponse } from "next/server";
import { plateSchema, type Json } from "@platelab/shared";
import { createQueryEmbedding } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const filters: { [key: string]: Json | undefined } = {};
  const scalarFilters = [
    ["shot_type", "shotType"],
    ["time_of_day", "timeOfDay"],
    ["weather", "weather"],
    ["speed_band", "speedBand"],
    ["stage_compat", "stage"],
  ] as const;

  for (const [databaseName, parameterName] of scalarFilters) {
    const value = params.get(parameterName)?.trim();
    if (value) filters[databaseName] = value;
  }
  if (params.get("imu") === "1") filters.imu_collected = true;
  const tag = params.get("tag")?.trim();
  if (tag) filters.tags = [tag];

  const queryEmbedding = await createQueryEmbedding(query);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_stock_clips", {
    query_text: query || undefined,
    query_embedding: queryEmbedding,
    filters,
    match_count: 100,
  });

  if (error) {
    return NextResponse.json(
      { error: "Catalog search is temporarily unavailable." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    plates: (data ?? []).map((row) =>
      plateSchema.parse(row.source_metadata),
    ),
    semantic: Boolean(queryEmbedding),
    degraded: Boolean(query && !queryEmbedding),
  });
}
