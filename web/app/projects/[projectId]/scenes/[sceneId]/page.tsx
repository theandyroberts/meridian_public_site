import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Plate } from "@platelab/shared";
import { PlateCard } from "@/components/PlateCard";
import { getLivePlates } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";

type ScenePageProps = {
  params: Promise<{ projectId: string; sceneId: string }>;
  searchParams: Promise<{ created?: string }>;
};

export const dynamic = "force-dynamic";

const BRIEF_STOP_WORDS = new Set([
  "about",
  "along",
  "from",
  "into",
  "needs",
  "outside",
  "scene",
  "sparse",
  "that",
  "the",
  "this",
  "through",
  "travel",
  "what",
  "with",
]);

function briefScore(plate: Plate, brief: string): number {
  const words = [...new Set(brief
    .toLowerCase()
    .split(/\W+/)
    .filter(
      (word) => word.length > 3 && !BRIEF_STOP_WORDS.has(word),
    ))];
  if (!words.length) return 0;

  const searchable = [
    plate.title,
    plate.description,
    plate.location.name,
    plate.location.city,
    plate.location.region,
    plate.shotType,
    plate.timeOfDay,
    plate.weather,
    ...plate.tags,
  ]
    .join(" ")
    .toLowerCase();

  return words.reduce(
    (score, word) => score + (searchable.includes(word) ? 1 : 0),
    0,
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

  const [{ data: project }, { data: scene }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, project_id, scene_number, name, search_brief, vehicle, rough_shot",
      )
      .eq("id", sceneId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  if (!project || !scene) notFound();

  const plates = getLivePlates();
  const suggested = scene.search_brief
    ? plates
        .map((plate) => ({
          plate,
          score: briefScore(plate, scene.search_brief!),
        }))
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map((result) => result.plate)
    : plates.slice(0, 6);
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

      <section className="selection-stage">
        <div className="section-head compact">
          <div>
            <p className="mono accent">Step 3 of 3 · Choose clips</p>
            <h2>Plates for this scene</h2>
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
            {suggested.map((plate) => (
              <PlateCard key={plate.sku} plate={plate} />
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
