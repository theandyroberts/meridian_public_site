import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { plateSchema, type Plate } from "@platelab/shared";
import { PlateCard } from "@/components/PlateCard";
import { createQueryEmbedding } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import {
  addClipToScene,
  updateSceneClipStatus,
} from "@/app/projects/actions";

type ScenePageProps = {
  params: Promise<{ projectId: string; sceneId: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
};

type SelectedClip = {
  id: string;
  status:
    | "considering"
    | "shortlisted"
    | "selected"
    | "rejected"
    | "submitted";
  version: number;
  stockClipId: string;
  plate: Plate;
};

export const dynamic = "force-dynamic";

export default async function ScenePage({
  params,
  searchParams,
}: ScenePageProps) {
  const { projectId, sceneId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(
        `/projects/${projectId}/scenes/${sceneId}`,
      )}`,
    );
  }

  const [{ data: project }, { data: scene }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, project_id, scene_number, name, search_brief, vehicle, rough_shot, structured_filters",
      )
      .eq("id", sceneId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  if (!project || !scene) notFound();

  const queryEmbedding = await createQueryEmbedding(scene.search_brief);
  const [{ data: searchRows, error: searchError }, { data: selectedRows }] =
    await Promise.all([
      supabase.rpc("search_stock_clips", {
        query_text: scene.search_brief || undefined,
        query_embedding: queryEmbedding,
        filters: scene.structured_filters,
        match_count: 12,
      }),
      supabase
        .from("scene_clips")
        .select(
          "id, status, version, stock_clip_id, stock_clips(source_metadata)",
        )
        .eq("scene_id", sceneId)
        .order("sort_order")
        .order("created_at"),
    ]);

  if (searchError) {
    throw new Error(`Unable to search the catalog: ${searchError.message}`);
  }

  const suggested = (searchRows ?? []).map((row) => ({
    id: row.id,
    plate: plateSchema.parse(row.source_metadata),
    keywordScore: row.keyword_score,
    semanticScore: row.semantic_score,
  }));
  const selected: SelectedClip[] = (selectedRows ?? []).flatMap((row) => {
    const relation = Array.isArray(row.stock_clips)
      ? row.stock_clips[0]
      : row.stock_clips;
    if (!relation) return [];
    return [
      {
        id: row.id,
        status: row.status,
        version: row.version,
        stockClipId: row.stock_clip_id,
        plate: plateSchema.parse(relation.source_metadata),
      },
    ];
  });
  const selectedIds = new Set(selected.map((item) => item.stockClipId));
  const browseQuery = new URLSearchParams();
  if (scene.search_brief) browseQuery.set("q", scene.search_brief);

  return (
    <main className="workspace-shell scene-workspace">
      <Link href={`/projects/${project.id}`} className="mono dim back-link">
        ← {project.name}
      </Link>

      {query.created === "1" && (
        <p className="auth-alert success">
          Scene saved. Start with the suggested plates or search the full
          catalog.
        </p>
      )}
      {query.error && <p className="auth-alert">{query.error}</p>}

      <section className="scene-heading">
        <div>
          <p className="mono accent">
            Scene {String(scene.scene_number).padStart(2, "0")}
          </p>
          <h1>{scene.name}</h1>
          <p>
            {scene.search_brief ||
              "No plate brief yet. Browse the catalog and refine from there."}
          </p>
        </div>
        <div className="scene-context">
          <span className="mono dimmer">Vehicle</span>
          <strong>{scene.vehicle.replaceAll("_", " ")}</strong>
        </div>
      </section>

      {selected.length > 0 && (
        <section className="selection-stage">
          <div className="section-head compact">
            <div>
              <p className="mono accent">Scene collection</p>
              <h2>Saved clips ({selected.length})</h2>
            </div>
          </div>
          <div className="plate-grid">
            {selected.map((item) => (
              <div key={item.id}>
                <PlateCard plate={item.plate} />
                <form action={updateSceneClipStatus} className="scene-clip-form">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="sceneId" value={sceneId} />
                  <input type="hidden" name="sceneClipId" value={item.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={item.version}
                  />
                  <select name="status" defaultValue={item.status}>
                    <option value="considering">Considering</option>
                    <option value="shortlisted">Shortlisted</option>
                    <option value="selected">Selected</option>
                    <option value="rejected">Rejected</option>
                    <option value="submitted">Submitted</option>
                  </select>
                  <button type="submit" className="filter-chip">
                    Save status
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="selection-stage">
        <div className="section-head compact">
          <div>
            <p className="mono accent">Step 3 of 3 · Choose clips</p>
            <h2>Search results for this scene</h2>
            <p className="mono dimmer">
              Hybrid metadata search
              {queryEmbedding ? " + semantic similarity" : ""}
            </p>
          </div>
          <Link
            href={`/browse${browseQuery.size ? `?${browseQuery}` : ""}`}
            className="secondary-button"
          >
            Search the full catalog
          </Link>
        </div>

        {suggested.length ? (
          <div className="plate-grid">
            {suggested.map((result) => (
              <div key={result.plate.sku}>
                <PlateCard plate={result.plate} />
                <form action={addClipToScene} className="scene-clip-form">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="sceneId" value={sceneId} />
                  <input type="hidden" name="stockClipId" value={result.id} />
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={selectedIds.has(result.id)}
                  >
                    {selectedIds.has(result.id)
                      ? "Added to scene"
                      : "Add to scene"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <div className="workspace-empty">
            <p className="mono accent">Widen the search</p>
            <h2>No direct catalog match yet.</h2>
            <p>
              Search the full collection, adjust the scene language, or send
              the brief to the Plate Lab team for a custom capture.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
