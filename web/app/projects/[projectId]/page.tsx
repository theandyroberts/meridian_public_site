import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createScene } from "../actions";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
  }

  const [{ data: project }, { data: scenes }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, production_name, client_name, production_approach",
      )
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("scenes")
      .select("id, scene_number, name, search_brief, vehicle")
      .eq("project_id", projectId)
      .is("archived_at", null)
      .order("sort_order")
      .order("scene_number"),
  ]);

  if (!project) notFound();

  return (
    <main className="workspace-shell">
      <Link href="/projects" className="mono dim back-link">
        ← Projects
      </Link>

      <section className="workspace-intro project-heading">
        <div>
          <p className="mono accent">Project</p>
          <h1>{project.name}</h1>
          <p className="dim">
            {[project.production_name, project.client_name]
              .filter(Boolean)
              .join(" · ") || "Add scenes, then choose the plates for each shot."}
          </p>
        </div>
        <span className="status-chip mono">
          {project.production_approach === "undecided"
            ? "Stage undecided"
            : project.production_approach.replaceAll("_", " ")}
        </span>
      </section>

      {query.error && <p className="auth-alert error">{query.error}</p>}

      <section className="project-detail-grid">
        <div>
          <div className="section-head compact">
            <div>
              <p className="mono accent">Step 2 of 3</p>
              <h2>Scenes</h2>
            </div>
            <span className="mono dim">
              {scenes?.length ?? 0} total
            </span>
          </div>

          <div className="scene-list">
            {scenes?.map((scene) => (
              <Link
                href={`/projects/${project.id}/scenes/${scene.id}`}
                className="scene-row"
                key={scene.id}
              >
                <span className="scene-number mono">
                  {String(scene.scene_number).padStart(2, "0")}
                </span>
                <span>
                  <strong>{scene.name}</strong>
                  <small>
                    {scene.search_brief || "Add a search brief"}
                  </small>
                </span>
                <span className="scene-arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="add-scene-card">
          <p className="mono accent">Add another scene</p>
          <h2>What else is on the shot list?</h2>
          <form action={createScene} className="workspace-form compact-form">
            <input type="hidden" name="projectId" value={project.id} />
            <label>
              <span>Scene name</span>
              <input
                name="sceneName"
                type="text"
                placeholder="Day coastal drive"
                maxLength={200}
                required
              />
            </label>
            <label>
              <span>Plate brief</span>
              <textarea
                name="searchBrief"
                placeholder="Open coast, clear horizon, late afternoon…"
                rows={4}
              />
            </label>
            <button type="submit" className="primary-button">
              Add scene
            </button>
          </form>
        </aside>
      </section>
    </main>
  );
}
