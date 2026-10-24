import "server-only";

import { isValidSku, plateSchema } from "@platelab/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export async function publishDraft(sku: string): Promise<void> {
  if (!isValidSku(sku)) throw new Error(`invalid SKU: ${sku}`);
  const supabase = createAdminClient();
  const { data: row, error: loadError } = await supabase
    .from("stock_clips")
    .select("id, source_metadata, version")
    .eq("sku", sku)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error(`unknown SKU: ${sku}`);

  const plate = plateSchema.parse(row.source_metadata);
  const { error: updateError } = await supabase
    .from("stock_clips")
    .update({
      status: "live",
      source_metadata: { ...plate, status: "live" },
      version: row.version + 1,
    })
    .eq("id", row.id)
    .eq("version", row.version);
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await supabase.from("audit_events").insert({
    entity_type: "stock_clip",
    entity_id: row.id,
    event_type: "admin.catalog_published",
    payload: { sku },
  });
  if (auditError) throw new Error(auditError.message);
}

export async function rejectDraft(
  sku: string,
  reason: string,
): Promise<void> {
  if (!isValidSku(sku)) throw new Error(`invalid SKU: ${sku}`);
  const supabase = createAdminClient();
  const { data: row, error: loadError } = await supabase
    .from("stock_clips")
    .select("id")
    .eq("sku", sku)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!row) throw new Error(`unknown SKU: ${sku}`);

  const { error: auditError } = await supabase.from("audit_events").insert({
    entity_type: "stock_clip",
    entity_id: row.id,
    event_type: "admin.catalog_rejected",
    payload: { sku, reason },
  });
  if (auditError) throw new Error(auditError.message);

  const { error: deleteError } = await supabase
    .from("stock_clips")
    .delete()
    .eq("id", row.id);
  if (deleteError) throw new Error(deleteError.message);
}
