import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { plateSchema, type Plate } from "@platelab/shared";
import { InfoTooltip } from "@/components/InfoTooltip";
import { PlateCard } from "@/components/PlateCard";
import { SceneClipStatusControl } from "@/components/SceneClipStatusControl";
import { SceneDeleteForm } from "@/components/SceneDeleteForm";
import { SceneKeywordPriorities } from "@/components/SceneKeywordPriorities";
import {
  PlateStageCompatibilityWarning,
  SceneSearchGuidance,
} from "@/components/SceneSearchGuidance";
import { createQueryEmbedding } from "@/lib/search";
import { matchClosenessPercent } from "@/lib/matchCloseness";
import { publicMediaUrl } from "@/lib/publicMediaUrl";
import { formatSceneClipSelectionDuration } from "@/lib/sceneClipSelection";
import { rankPrioritizedSceneMatches } from "@/lib/sceneSearchRanking";
import {
  SCENE_PRODUCTION_FIELD_LABELS,
  SCENE_PRODUCTION_LIST_FIELDS,
  SCENE_PRODUCTION_TEXT_FIELDS,
  STAGE_USE_OPTIONS,
  normalizeSceneProductionMetadata,
  sceneProductionSearchText,
  stageUseTypeLabel,
} from "@/lib/sceneProduction";
import { buildStudioHref, type StudioSceneContext } from "@/lib/studioHref";
import { createClient } from "@/lib/supabase/server";
import {
  ROUGH_SHOT_OPTIONS,
  VEHICLE_OPTIONS,
  roughShotLabel,
} from "@/lib/sceneConfiguration";
import {
  addClipToScene,
  refreshSceneKeywords,
  updateScene,
} from "@/app/projects/actions";

type ScenePageProps = {
  params: Promise<{ projectId: string; sceneId: string }>;
  searchParams: Promise<{
    created?: string;
    error?: string;
    keywords?: string;
    priorities?: string;
    updated?: string;
  }>;
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
  inFrame: number | null;
  outFrame: number | null;
  stockClipId: string;
  plate: Plate;
};

export const dynamic = "force-dynamic";

type StudioSelectionContext = Pick<
  SelectedClip,
  "id" | "version" | "inFrame" | "outFrame"
>;

function studioHref(
  plate: Plate,
  context: StudioSceneContext,
  selection?: StudioSelectionContext,
): string | null {
  if (
    !plate.stageCompat.includes("led-volume") ||
    !plate.renditions.stagePreview
  ) {
    return null;
  }

  return buildStudioHref({
    video: publicMediaUrl(plate.renditions.stagePreview),
    label: `${plate.sku} · ${plate.title}`,
    fps: plate.media.fps,
    sourceTimecode: plate.media.timecode,
    sku: plate.sku,
    scene: context,
    selection: selection
      ? {
          sceneClipId: selection.id,
          version: selection.version,
          inFrame: selection.inFrame,
          outFrame: selection.outFrame,
        }
      : undefined,
  });
}

function StudioLink({
  plate,
  context,
  selection,
}: {
  plate: Plate;
  context: StudioSceneContext;
  selection?: StudioSelectionContext;
}) {
  const href = studioHref(plate, context, selection);
  if (!href) return null;

  return (
    <Link
      href={href}
      className="secondary-button"
      style={{ width: "100%", marginTop: 12 }}
    >
      Open in Studio →
    </Link>
  );
}

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

  const [{ data: project }, { data: scene }, { data: stages }] =
    await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, production_approach, stage_profile_id, custom_stage_name",
      )
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, project_id, scene_number, name, search_brief, search_intent_summary, continuity_group, stage_use_type, production_metadata, vehicle, rough_shot, structured_filters, production_approach_override, stage_profile_id_override, custom_stage_name_override, script_scene_number, script_pages, generated_keywords, nice_to_have_keywords, keyword_generation_status",
      )
      .eq("id", sceneId)
      .eq("project_id", projectId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("stage_profiles")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ]);

  if (!project || !scene) notFound();

  const stageName = (stageId: string | null) =>
    stages?.find((stage) => stage.id === stageId)?.name;
  const projectStageLabel =
    project.production_approach === "listed_led_stage"
      ? stageName(project.stage_profile_id) || "Listed LED stage"
      : project.production_approach === "custom_led_stage"
        ? project.custom_stage_name || "Custom LED stage"
        : project.production_approach === "vfx_no_led_wall"
          ? "VFX / no LED wall"
          : "Stage undecided";
  const sceneStageLabel =
    scene.production_approach_override === null
      ? `${projectStageLabel} · project default`
      : scene.production_approach_override === "listed_led_stage"
        ? stageName(scene.stage_profile_id_override) || "Listed LED stage"
        : scene.production_approach_override === "custom_led_stage"
          ? scene.custom_stage_name_override || "Custom LED stage"
          : scene.production_approach_override === "vfx_no_led_wall"
            ? "VFX / no LED wall"
            : "Stage undecided";
  const sceneStageChoice =
    scene.production_approach_override === null
      ? "inherit"
      : scene.production_approach_override === "listed_led_stage" &&
          scene.stage_profile_id_override
        ? `stage:${scene.stage_profile_id_override}`
        : scene.production_approach_override === "custom_led_stage"
          ? "keep_custom"
          : scene.production_approach_override;
  const selectedListedStageIsUnavailable =
    scene.production_approach_override === "listed_led_stage" &&
    Boolean(scene.stage_profile_id_override) &&
    !stageName(scene.stage_profile_id_override);
  const effectiveProductionApproach =
    scene.production_approach_override ?? project.production_approach;
  const productionMetadata = normalizeSceneProductionMetadata(
    scene.production_metadata,
  );

  const { data: continuityPeers, error: continuityPeersError } =
    scene.continuity_group
      ? await supabase
          .from("scenes")
          .select("search_intent_summary, production_metadata")
          .eq("project_id", project.id)
          .eq("continuity_group", scene.continuity_group)
          .neq("id", scene.id)
          .is("archived_at", null)
      : { data: [], error: null };
  if (continuityPeersError) {
    console.warn(
      `Continuity guidance unavailable: ${continuityPeersError.message}`,
    );
  }
  const continuitySearchText = (continuityPeers ?? [])
    .flatMap((peer) => [
      peer.search_intent_summary,
      sceneProductionSearchText(peer.production_metadata),
    ])
    .filter(Boolean)
    .join(" ");

  const primarySearchText = [
    scene.search_intent_summary,
    scene.search_brief,
    sceneProductionSearchText(scene.production_metadata),
    ...scene.generated_keywords,
  ]
    .filter(Boolean)
    .join(" ");
  const niceToHaveSearchText = scene.nice_to_have_keywords.join(" ");
  const sceneSearchText = [primarySearchText, niceToHaveSearchText]
    .filter(Boolean)
    .join(" ");
  const queryEmbedding = await createQueryEmbedding(primarySearchText);
  const [
    { data: primarySearchRows, error: primarySearchError },
    { data: niceToHaveRows, error: niceToHaveError },
    { data: continuitySearchRows, error: continuitySearchError },
    { data: selectedRows },
    { data: catalogFallback, error: catalogFallbackError },
  ] = await Promise.all([
      supabase.rpc("search_stock_clips", {
        query_text: primarySearchText || undefined,
        query_embedding: queryEmbedding,
        filters: scene.structured_filters,
        match_count: 12,
      }),
      supabase.rpc("search_stock_clips", {
        query_text: niceToHaveSearchText || undefined,
        filters: scene.structured_filters,
        match_count: 12,
      }),
      continuitySearchText
        ? supabase.rpc("search_stock_clips", {
            query_text: continuitySearchText,
            filters: scene.structured_filters,
            match_count: 12,
          })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("scene_clips")
        .select(
          "id, status, version, in_frame, out_frame, stock_clip_id, stock_clips(source_metadata)",
        )
        .eq("scene_id", sceneId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("stock_clips")
        .select("id, source_metadata")
        .eq("status", "live")
        .order("title")
        .limit(6),
    ]);

  if (primarySearchError) {
    console.warn(
      `Primary catalog search unavailable: ${primarySearchError.message}`,
    );
  }
  if (niceToHaveError) {
    console.warn(
      `Nice to Have search unavailable: ${niceToHaveError.message}`,
    );
  }
  if (continuitySearchError) {
    console.warn(
      `Continuity search unavailable: ${continuitySearchError.message}`,
    );
  }
  if (catalogFallbackError) {
    console.warn(
      `Catalog fallback unavailable: ${catalogFallbackError.message}`,
    );
  }

  const prioritizedRows = rankPrioritizedSceneMatches(
    primarySearchRows ?? [],
    niceToHaveRows ?? [],
    continuitySearchRows ?? [],
  );
  const rankedMatches = prioritizedRows.map((row) => ({
    id: row.id,
    plate: plateSchema.parse(row.source_metadata),
    keywordScore: row.keyword_score,
    semanticScore: row.semantic_score,
  }));
  const rankedIds = new Set(rankedMatches.map((result) => result.id));
  const suggested = [
    ...rankedMatches,
    ...(catalogFallback ?? [])
      .filter((row) => !rankedIds.has(row.id))
      .map((row) => ({
        id: row.id,
        plate: plateSchema.parse(row.source_metadata),
        keywordScore: 0,
        semanticScore: 0,
      })),
  ].slice(0, 6);
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
        inFrame: row.in_frame,
        outFrame: row.out_frame,
        stockClipId: row.stock_clip_id,
        plate: plateSchema.parse(relation.source_metadata),
      },
    ];
  });
  const selectedIds = new Set(selected.map((item) => item.stockClipId));
  const studioSceneContext: StudioSceneContext = {
    projectId: project.id,
    projectName: project.name,
    sceneId: scene.id,
    sceneName: scene.name,
  };
  const browseQuery = new URLSearchParams();
  if (sceneSearchText) browseQuery.set("q", sceneSearchText);

  return (
    <main className="workspace-shell scene-workspace">
      <div className="scene-nav">
        <Link href={`/projects/${project.id}`} className="mono dim back-link">
          ← {project.name}
        </Link>
        <Link
          href={`/projects/${project.id}#add-scene`}
          className="secondary-button"
        >
          + Add scene
        </Link>
      </div>

      {query.created === "1" && (
        <p className="auth-alert success">
          Scene saved. Start with the suggested plates or search the full
          catalog.
        </p>
      )}
      {query.updated === "1" && (
        <p className="auth-alert success">
          Scene details saved.
        </p>
      )}
      {query.keywords === "1" && (
        <p className="auth-alert success">
          AI search keywords generated and saved.
        </p>
      )}
      {query.priorities === "1" && (
        <p className="auth-alert success">
          Search descriptor priority updated.
        </p>
      )}
      {query.error && <p className="auth-alert">{query.error}</p>}

      <section className="scene-heading">
        <div>
          <p className="mono accent">
            {scene.script_scene_number
              ? `Script scene ${scene.script_scene_number}`
              : `Scene ${String(scene.scene_number).padStart(2, "0")}`}
          </p>
          <h1>{scene.name}</h1>
          <p>
            <strong>Search intent:</strong>{" "}
            {scene.search_intent_summary ||
              "Not generated yet. Open Edit scene details to add it or use AI search guidance."}
          </p>
          <p>
            {scene.search_brief ||
              "No plate brief yet. Browse the catalog and refine from there."}
          </p>
          <div className="scene-metadata-line">
            {scene.script_pages && (
              <span className="metadata-chip mono">
                Script p. {scene.script_pages}
              </span>
            )}
            {scene.keyword_generation_status === "pending" && (
              <span className="metadata-chip pending mono">
                AI keywords pending
              </span>
            )}
          </div>
        </div>
        <div className="scene-context">
          <span className="mono dimmer">Vehicle</span>
          <strong>{scene.vehicle.replaceAll("_", " ")}</strong>
          <span className="mono dimmer">Stage</span>
          <strong>{sceneStageLabel}</strong>
          <span className="mono dimmer">Rough camera shot</span>
          <strong>{roughShotLabel(scene.rough_shot)}</strong>
          <span className="mono dimmer">Stage use</span>
          <strong>{stageUseTypeLabel(scene.stage_use_type)}</strong>
          {productionMetadata.location_signature && (
            <>
              <span className="mono dimmer">Environment</span>
              <strong>{productionMetadata.location_signature}</strong>
            </>
          )}
          {productionMetadata.time_of_day && (
            <>
              <span className="mono dimmer">Time of day</span>
              <strong>{productionMetadata.time_of_day}</strong>
            </>
          )}
          {productionMetadata.weather && (
            <>
              <span className="mono dimmer">Weather</span>
              <strong>{productionMetadata.weather}</strong>
            </>
          )}
          {productionMetadata.movement && (
            <>
              <span className="mono dimmer">Movement</span>
              <strong>{productionMetadata.movement}</strong>
            </>
          )}
          {scene.continuity_group && (
            <>
              <span className="mono dimmer">Continuity group</span>
              <strong>{scene.continuity_group}</strong>
            </>
          )}
        </div>
      </section>

      <SceneSearchGuidance
        structuredFilters={scene.structured_filters}
        productionApproach={effectiveProductionApproach}
        stageLabel={sceneStageLabel}
      />

      <SceneKeywordPriorities
        projectId={project.id}
        sceneId={scene.id}
        mustHave={scene.generated_keywords}
        niceToHave={scene.nice_to_have_keywords}
      />

      <details className="scene-editor">
        <summary>Edit scene details</summary>
        <div className="scene-editor-body">
          <form action={updateScene} className="workspace-form compact-form">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="sceneId" value={scene.id} />
            <label>
              <span>Scene title</span>
              <input
                name="sceneName"
                type="text"
                defaultValue={scene.name}
                maxLength={200}
                required
              />
            </label>
            <div className="form-grid">
              <label>
                <span>Script scene number <em>optional</em></span>
                <input
                  name="scriptSceneNumber"
                  type="text"
                  defaultValue={scene.script_scene_number ?? ""}
                  placeholder="41 or 41A"
                  maxLength={40}
                />
              </label>
              <label>
                <span>Script page(s) <em>optional</em></span>
                <input
                  name="scriptPages"
                  type="text"
                  defaultValue={scene.script_pages ?? ""}
                  placeholder="74–75"
                  maxLength={80}
                />
              </label>
              <label>
                <span>Vehicle</span>
                <select name="vehicle" defaultValue={scene.vehicle}>
                  {VEHICLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rough camera shot <em>optional</em></span>
                <select name="roughShot" defaultValue={scene.rough_shot ?? ""}>
                  <option value="">Not specified</option>
                  {ROUGH_SHOT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Stage-use type</span>
                <select
                  name="stageUseType"
                  defaultValue={scene.stage_use_type}
                >
                  {STAGE_USE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Continuity group <em>optional</em></span>
                <input
                  name="continuityGroup"
                  type="text"
                  defaultValue={scene.continuity_group ?? ""}
                  placeholder="night drive sequence"
                  maxLength={120}
                />
                <small>
                  Matching gently favors visual continuity with scenes using
                  the same label; it never excludes candidates.
                </small>
              </label>
              <label>
                <span>Stage</span>
                <select name="stageChoice" defaultValue={sceneStageChoice}>
                  <option value="inherit">
                    Project default · {projectStageLabel}
                  </option>
                  {selectedListedStageIsUnavailable && (
                    <option value={`stage:${scene.stage_profile_id_override}`}>
                      Previously selected LED stage
                    </option>
                  )}
                  {stages?.map((stage) => (
                    <option key={stage.id} value={`stage:${stage.id}`}>
                      {stage.name}
                    </option>
                  ))}
                  {scene.production_approach_override ===
                    "custom_led_stage" && (
                    <option value="keep_custom">
                      {scene.custom_stage_name_override || "Custom LED stage"}
                    </option>
                  )}
                  <option value="undecided">Undecided</option>
                  <option value="vfx_no_led_wall">VFX / no LED wall</option>
                </select>
              </label>
            </div>
            <label>
              <span>One-sentence search intent</span>
              <textarea
                name="searchIntentSummary"
                defaultValue={scene.search_intent_summary ?? ""}
                rows={2}
                maxLength={320}
                required
              />
              <small>
                The at-a-glance statement collaborators use to understand
                what environment or plate this scene needs.
              </small>
            </label>
            <label>
              <span>Scene description / plate brief</span>
              <textarea
                name="searchBrief"
                defaultValue={scene.search_brief ?? ""}
                rows={4}
              />
              <small>
                Saving refreshes the searchable keyword list from this
                narrative.
              </small>
            </label>
            <fieldset>
              <legend>Structured production metadata</legend>
              <div className="form-grid">
                {SCENE_PRODUCTION_TEXT_FIELDS.map((field) => (
                  <label key={field}>
                    <span>{SCENE_PRODUCTION_FIELD_LABELS[field]}</span>
                    <input
                      name={field}
                      type="text"
                      defaultValue={productionMetadata[field]}
                      placeholder="Unspecified"
                      maxLength={300}
                    />
                  </label>
                ))}
              </div>
              {SCENE_PRODUCTION_LIST_FIELDS.map((field) => (
                <label key={field}>
                  <span>{SCENE_PRODUCTION_FIELD_LABELS[field]}</span>
                  <textarea
                    name={field}
                    defaultValue={productionMetadata[field].join("\n")}
                    rows={2}
                    placeholder="One item per line or comma-separated"
                  />
                </label>
              ))}
            </fieldset>
            <div className="form-actions">
              <button type="submit" className="primary-button">
                Save scene
              </button>
            </div>
          </form>
          {(scene.keyword_generation_status === "pending" ||
            !scene.search_intent_summary) && (
            <form
              action={refreshSceneKeywords}
              className="keyword-retry-form"
            >
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="sceneId" value={scene.id} />
              <p>
                The description is saved, but OpenAI has not generated all
                search guidance yet.
              </p>
              <button type="submit" className="secondary-button">
                Generate AI search guidance
              </button>
            </form>
          )}
          <div className="scene-danger-zone">
            <p className="mono dimmer">Delete scene</p>
            <SceneDeleteForm
              projectId={project.id}
              sceneId={scene.id}
              sceneName={scene.name}
            />
          </div>
        </div>
      </details>

      {selected.length > 0 && (
        <section className="selection-stage">
          <div className="section-head compact">
            <div>
              <p className="mono accent">Scene collection</p>
              <h2>Saved clips ({selected.length})</h2>
            </div>
            <Link
              href={`/projects/${project.id}/scenes/${scene.id}/clips`}
              className="secondary-button"
            >
              Review saved clips
            </Link>
          </div>
          <div className="plate-grid">
            {selected.map((item) => {
              const selectedDuration = formatSceneClipSelectionDuration(
                item.inFrame,
                item.outFrame,
                item.plate.media.fps,
              );
              return (
                <div key={item.id}>
                  <PlateCard plate={item.plate} />
                  <StudioLink
                    plate={item.plate}
                    context={studioSceneContext}
                    selection={item}
                  />
                  {selectedDuration && (
                    <p className="mono dimmer" style={{ margin: "10px 0 0" }}>
                      Selected duration: {selectedDuration}
                    </p>
                  )}
                  <SceneClipStatusControl
                    projectId={projectId}
                    sceneId={sceneId}
                    sceneClipId={item.id}
                    status={item.status}
                    version={item.version}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="selection-stage">
        <div className="section-head compact">
          <div>
            <div className="matched-plates-heading">
              <h2>Top plate matches</h2>
              <InfoTooltip text="Match closeness is a conservative blend of semantic similarity and exact metadata or keyword evidence. Low percentages are shown intentionally when the current library is not a close fit." />
            </div>
            <p className="mono dimmer">
              Six closest plates · hybrid metadata search
              {queryEmbedding ? " + semantic similarity" : ""}
            </p>
          </div>
          <div className="expand-search-action">
            <Link
              href={`/browse${browseQuery.size ? `?${browseQuery}` : ""}`}
              className="secondary-button"
            >
              Expand search
            </Link>
            <InfoTooltip text="Opens the full catalog with this scene’s description and generated keywords prefilled. The scene remains saved while you adjust terms and filters." />
          </div>
        </div>

        {suggested.length ? (
          <div className="plate-grid">
            {suggested.map((result) => (
              <div className="plate-match-result" key={result.plate.sku}>
                <div className="match-closeness mono">
                  <span>Match closeness</span>
                  <strong>
                    {matchClosenessPercent({
                      keywordScore: result.keywordScore,
                      semanticScore: result.semanticScore,
                    })}
                    %
                  </strong>
                </div>
                <PlateCard plate={result.plate} />
                <PlateStageCompatibilityWarning
                  plateStageCompat={result.plate.stageCompat}
                  productionApproach={effectiveProductionApproach}
                  stageLabel={sceneStageLabel}
                />
                <StudioLink
                  plate={result.plate}
                  context={studioSceneContext}
                />
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
            <p className="mono accent">Catalog unavailable</p>
            <h2>No plates can be loaded right now.</h2>
            <p>
              The scene is saved. Try again shortly or open the full catalog.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
